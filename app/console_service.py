"""Lossless DynamoDB operations for the browser console."""
import base64
import binascii
import json
from hashlib import sha256

import boto3
from botocore.config import Config

from .config import settings
from .data_codec import attribute_from_wire, item_from_wire, to_wire
from .editor_codec import convert_item
from .item_insights import item_metrics, read_metrics, table_checks
from .query_filters import apply_read_options


class ConsoleService:
    def __init__(self):
        self.client = boto3.Session().client(
            "dynamodb",
            endpoint_url=settings.dynamodb_endpoint_url,
            config=Config(
                connect_timeout=3, read_timeout=10, retries={"max_attempts": 2}
            ),
        )

    def describe(self, name):
        return self.client.describe_table(TableName=name)["Table"]

    def tables(self):
        names = []
        for page in self.client.get_paginator("list_tables").paginate():
            names.extend(page["TableNames"])
        return [self.describe(name) for name in sorted(names)]

    @staticmethod
    def cursor_encode(key, scope):
        if not key:
            return None
        payload = json.dumps(
            {"scope": scope, "key": to_wire(key)}, separators=(",", ":")
        )
        return base64.urlsafe_b64encode(payload.encode()).decode()

    @staticmethod
    def cursor_decode(token, scope):
        try:
            payload = json.loads(base64.b64decode(token, altchars=b"-_", validate=True))
            if payload["scope"] != scope:
                raise ValueError("Cursor belongs to a different query")
            return item_from_wire(payload["key"])
        except (ValueError, KeyError, TypeError, binascii.Error) as error:
            raise ValueError(
                "Invalid pagination cursor; run the query again"
            ) from error

    def search(self, name, request):
        arguments = {
            "TableName": name,
            "Limit": request.limit,
            "ReturnConsumedCapacity": "TOTAL",
        }
        if request.index:
            arguments["IndexName"] = request.index
        table = self.describe(name)
        scope = sha256(
            json.dumps(
                {"table": name, **request.model_dump(exclude={"cursor", "limit"})},
                sort_keys=True,
            ).encode()
        ).hexdigest()
        if request.cursor:
            arguments["ExclusiveStartKey"] = self.cursor_decode(request.cursor, scope)
        if request.mode == "query":
            schema = table["KeySchema"]
            if request.index:
                indexes = table.get("GlobalSecondaryIndexes", []) + table.get(
                    "LocalSecondaryIndexes", []
                )
                matches = [
                    index for index in indexes if index["IndexName"] == request.index
                ]
                if not matches:
                    raise ValueError("Index does not exist")
                schema = matches[0]["KeySchema"]
            keys = {key["KeyType"]: key["AttributeName"] for key in schema}
            if request.partition is None:
                raise ValueError("A partition key value is required for a query")
            arguments["KeyConditionExpression"] = "#pk = :pk"
            arguments["ExpressionAttributeNames"] = {"#pk": keys["HASH"]}
            arguments["ExpressionAttributeValues"] = {
                ":pk": attribute_from_wire(request.partition)
            }
            if request.sort is not None:
                if "RANGE" not in keys:
                    raise ValueError("This table or index has no sort key")
                arguments["ExpressionAttributeNames"]["#sk"] = keys["RANGE"]
                arguments["ExpressionAttributeValues"][":sk"] = attribute_from_wire(
                    request.sort
                )
                if request.operator == "between":
                    if request.sortEnd is None:
                        raise ValueError("A range end value is required for between")
                    arguments["ExpressionAttributeValues"][
                        ":end"
                    ] = attribute_from_wire(request.sortEnd)
                    expression = "#sk BETWEEN :sk AND :end"
                elif request.operator == "begins_with":
                    expression = "begins_with(#sk, :sk)"
                else:
                    expression = f"#sk {request.operator} :sk"
                arguments["KeyConditionExpression"] += " AND " + expression
            arguments["ScanIndexForward"] = request.ascending
            apply_read_options(arguments, request, table)
            result = self.client.query(**arguments)
        else:
            apply_read_options(arguments, request, table)
            result = self.client.scan(**arguments)
        return {
            **read_metrics(to_wire(result.get("Items", []))),
            "items": to_wire(result.get("Items", [])),
            "count": result.get("Count", 0),
            "scanned": result.get("ScannedCount", 0),
            "cursor": self.cursor_encode(result.get("LastEvaluatedKey"), scope),
            "capacity": result.get("ConsumedCapacity", {}).get("CapacityUnits", 0),
        }

    def validate_keys(self, name, items, exact=False):
        table = self.describe(name)
        types = {
            attribute["AttributeName"]: attribute["AttributeType"]
            for attribute in table["AttributeDefinitions"]
        }
        keys = [key["AttributeName"] for key in table["KeySchema"]]
        for item in items:
            if exact and set(item) != set(keys):
                raise ValueError("Supply exactly the table's primary key attributes")
            for key in keys:
                if (
                    key not in item
                    or set(item[key]) != {types[key]}
                    or item[key][types[key]] == ""
                ):
                    raise ValueError(f"Every item needs {key!r} with type {types[key]}")
        return keys

    def put_item(self, name, item, original=None, create_only=False):
        item = convert_item(json.dumps(item), "ddb")["item"]
        checks = table_checks(item, self.describe(name))
        if checks["errors"]:
            raise ValueError("\n".join(checks["errors"]))
        metrics = item_metrics(item)
        item = item_from_wire(item)
        keys = self.validate_keys(name, [item])
        arguments = {"TableName": name, "Item": item, "ReturnConsumedCapacity": "TOTAL"}
        if original is not None:
            original = item_from_wire(original)
            self.validate_keys(name, [original], exact=True)
            if {key: item[key] for key in keys} != original:
                raise ValueError(
                    "Primary keys cannot be changed while editing; create a new item instead"
                )
            arguments["ConditionExpression"] = "attribute_exists(#pk)"
            arguments["ExpressionAttributeNames"] = {"#pk": keys[0]}
        elif create_only:
            arguments["ConditionExpression"] = "attribute_not_exists(#pk)"
            arguments["ExpressionAttributeNames"] = {"#pk": keys[0]}
        result = self.client.put_item(**arguments)
        return {
            "metrics": metrics,
            "capacity": result.get("ConsumedCapacity", {}).get("CapacityUnits", 0),
        }

    def delete_item(self, name, key):
        key = item_from_wire(key)
        keys = self.validate_keys(name, [key], exact=True)
        self.client.delete_item(
            TableName=name,
            Key=key,
            ConditionExpression="attribute_exists(#pk)",
            ExpressionAttributeNames={"#pk": keys[0]},
        )

    def export(self, name):
        # Fetch the first page before the HTTP response starts, surfacing initial errors.
        first = self.client.scan(TableName=name)

        def chunks():
            yield "[\n"
            page, comma = first, ""
            while True:
                for item in page.get("Items", []):
                    yield comma + json.dumps(to_wire(item), ensure_ascii=False)
                    comma = ",\n"
                if not page.get("LastEvaluatedKey"):
                    break
                page = self.client.scan(
                    TableName=name, ExclusiveStartKey=page["LastEvaluatedKey"]
                )
            yield "\n]\n"

        return chunks()
