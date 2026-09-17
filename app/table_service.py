import csv
import json
import logging
from collections.abc import Iterable
from decimal import Decimal
from enum import Enum

from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import ClientError

from .connection import resource
from .data_codec import parse_import
from .table_stats import table_stats

logger = logging.getLogger(__name__)


class UnknownDataFileTypeError(ValueError):
    pass


class DataFileType(str, Enum):
    CSV = "csv"
    JSON = "json"
    DYNAMODB_JSON = "dynamodb_json"


class TableService:
    def __init__(self) -> None:
        self.resource = resource()
        self.client = self.resource.meta.client

    def list_tables(self) -> list[str]:
        return [table.name for table in self.resource.tables.all()]

    def get_keys(self, table_name: str) -> list[str]:
        description = self.client.describe_table(TableName=table_name)
        return [key["AttributeName"] for key in description["Table"]["KeySchema"]]

    def delete_tables(self) -> None:
        for table_name in self.list_tables():
            self.delete_table(table_name)

    def delete_table(self, table_name: str) -> None:
        logger.info("Deleting table %s", table_name)
        self.resource.Table(table_name).delete()
        self.client.get_waiter("table_not_exists").wait(TableName=table_name)
        table_stats.deleted += 1

    def purge_tables(self) -> None:
        for table_name in self.list_tables():
            self.purge_table(table_name)

    def purge_table(self, table_name: str) -> None:
        logger.info("Purging table %s", table_name)
        names = {f"#key{i}": key for i, key in enumerate(self.get_keys(table_name))}
        table = self.resource.Table(table_name)
        scan_args = {
            "ProjectionExpression": ", ".join(names),
            "ExpressionAttributeNames": names,
        }
        while True:
            response = table.scan(**scan_args)
            with table.batch_writer() as batch:
                for item in response.get("Items", []):
                    batch.delete_item(Key=item)
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            scan_args["ExclusiveStartKey"] = last_key
        table_stats.purged += 1

    def create_table(self, schema: dict) -> None:
        table_name = schema["TableName"]
        logger.info("Creating table %s", table_name)
        try:
            self.resource.create_table(**schema)
        except ClientError as error:
            if error.response["Error"]["Code"] != "ResourceInUseException":
                raise
            logger.info("Table %s already exists, skipping creation", table_name)
            self.client.get_waiter("table_exists").wait(TableName=table_name)
            return
        self.client.get_waiter("table_exists").wait(TableName=table_name)
        table_stats.created += 1

    def update_table(self, schema: dict) -> None:
        table_name = schema["TableName"]
        logger.info("Updating table %s", table_name)
        try:
            self.client.update_table(**schema)
        except ClientError as error:
            code = error.response["Error"]["Code"]
            if code == "ValidationException" and self._index_update_already_applied(
                schema
            ):
                logger.info("Index update for %s is already applied", table_name)
                return
            raise
        self.client.get_waiter("table_exists").wait(TableName=table_name)
        table_stats.updated += 1

    def _index_update_already_applied(self, schema: dict) -> bool:
        # Only skip an identical, single-index create; unrelated validation errors
        # must remain visible (including malformed schemas and conflicting indexes).
        if set(schema) - {
            "TableName",
            "AttributeDefinitions",
            "GlobalSecondaryIndexUpdates",
        }:
            return False
        updates = schema.get("GlobalSecondaryIndexUpdates", [])
        if len(updates) != 1 or set(updates[0]) != {"Create"}:
            return False
        desired = updates[0]["Create"]
        table = self.client.describe_table(TableName=schema["TableName"])["Table"]
        if any(
            attribute not in table.get("AttributeDefinitions", [])
            for attribute in schema.get("AttributeDefinitions", [])
        ):
            return False
        for index in table.get("GlobalSecondaryIndexes", []):
            if index["IndexName"] == desired.get("IndexName"):
                for key, value in desired.items():
                    actual = index.get(key)
                    if isinstance(value, dict) and isinstance(actual, dict):
                        if any(actual.get(k) != v for k, v in value.items()):
                            return False
                    elif actual != value:
                        return False
                return index.get("IndexStatus") == "ACTIVE"
        return False

    def seed_table(self, table_name: str, data_file: str) -> None:
        logger.info("Loading %s into table %s", data_file, table_name)
        file_type = self.get_file_type(data_file)
        loaders = {
            DataFileType.CSV: self.seed_table_from_csv,
            DataFileType.JSON: self.seed_table_from_json,
            DataFileType.DYNAMODB_JSON: self.seed_table_from_dynamodb_json,
        }
        loaders[file_type](table_name, data_file)
        table_stats.seeded += 1

    def _write_items(self, table_name: str, items: Iterable[dict]) -> None:
        table = self.resource.Table(table_name)
        # Deduplicate repeated keys in each batch; retry unprocessed items via boto3.
        keys = self.get_keys(table_name)
        with table.batch_writer(overwrite_by_pkeys=keys) as batch:
            for item in items:
                if any(key not in item for key in keys):
                    raise ValueError("Every data item must contain all table keys")
                batch.put_item(Item=item)

    @staticmethod
    def _read_json(data_file: str) -> list[dict]:
        with open(data_file, encoding="utf-8") as file:
            items = json.load(file, parse_float=Decimal)
        if not isinstance(items, list) or any(
            not isinstance(item, dict) for item in items
        ):
            raise ValueError("JSON data must be an array of objects")
        return items

    def seed_table_from_csv(self, table_name: str, data_file: str) -> None:
        with open(data_file, encoding="utf-8-sig", newline="") as file:
            self._write_items(table_name, csv.DictReader(file))

    def seed_table_from_json(self, table_name: str, data_file: str) -> None:
        self._write_items(table_name, self._read_json(data_file))

    def seed_table_from_dynamodb_json(self, table_name: str, data_file: str) -> None:
        deserializer = TypeDeserializer()
        with open(data_file, encoding="utf-8") as file:
            wire_items = parse_import(data_file, file.read())
        items = [
            {key: deserializer.deserialize(value) for key, value in item.items()}
            for item in wire_items
        ]
        self._write_items(table_name, items)

    def get_file_type(self, file_name: str) -> DataFileType:
        if file_name.endswith(".csv"):
            return DataFileType.CSV
        if file_name.endswith(".dynamodb.json"):
            return DataFileType.DYNAMODB_JSON
        if file_name.endswith(".json"):
            return DataFileType.JSON
        raise UnknownDataFileTypeError(f"Unknown file type for file {file_name}")
