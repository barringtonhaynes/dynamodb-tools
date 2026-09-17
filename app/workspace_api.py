"""Streams, TTL, bulk item actions, and PartiQL for the local workspace."""
import base64
import json
import re
from hashlib import sha256
from typing import Literal

import boto3
from botocore.config import Config
from fastapi import APIRouter
from pydantic import BaseModel, Field

from .config import settings
from .console_api import ConsoleRoute
from .console_service import ConsoleService
from .data_codec import attribute_from_wire, item_from_wire, to_wire
from .item_insights import read_metrics
from .operations import operations

router = APIRouter(prefix="/api", route_class=ConsoleRoute)


def streams_client():
    return boto3.Session().client(
        "dynamodbstreams",
        endpoint_url=settings.dynamodb_endpoint_url,
        config=Config(connect_timeout=3, read_timeout=10, retries={"max_attempts": 2}),
    )


def pack_cursor(value, scope):
    return (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "value": value,
                    "scope": sha256(
                        json.dumps(scope, sort_keys=True).encode()
                    ).hexdigest(),
                }
            ).encode()
        ).decode()
        if value
        else None
    )


def unpack_cursor(token, scope):
    try:
        data = json.loads(base64.b64decode(token, altchars=b"-_", validate=True))
        if data["scope"] != sha256(
            json.dumps(scope, sort_keys=True).encode()
        ).hexdigest() or not isinstance(data["value"], str):
            raise ValueError("Wrong scope")
        return data["value"]
    except (ValueError, KeyError, TypeError) as error:
        raise ValueError(
            "This continuation belongs to another request. Start reading again."
        ) from error


class StreamConfiguration(BaseModel):
    enabled: bool
    view: Literal[
        "KEYS_ONLY", "NEW_IMAGE", "OLD_IMAGE", "NEW_AND_OLD_IMAGES"
    ] = "NEW_AND_OLD_IMAGES"


class StreamRead(BaseModel):
    arn: str = Field(min_length=1, max_length=1024)
    shard: str = Field(min_length=1, max_length=256)
    start: Literal[
        "TRIM_HORIZON", "LATEST", "AT_SEQUENCE_NUMBER", "AFTER_SEQUENCE_NUMBER"
    ] = "TRIM_HORIZON"
    sequence: str = Field(default="", max_length=128)
    cursor: str | None = Field(default=None, max_length=16384)
    limit: int = Field(default=50, ge=1, le=1000)


@router.get("/tables/{name}/streams")
def stream_overview(name: str):
    table = ConsoleService().describe(name)
    client, streams, args = streams_client(), [], {"TableName": name}
    while True:
        page = client.list_streams(**args)
        streams.extend(page.get("Streams", []))
        if not page.get("LastEvaluatedStreamArn"):
            break
        args["ExclusiveStartStreamArn"] = page["LastEvaluatedStreamArn"]
    return {
        "specification": table.get("StreamSpecification", {"StreamEnabled": False}),
        "latestArn": table.get("LatestStreamArn"),
        "streams": streams,
    }


@router.put("/tables/{name}/streams", status_code=202)
def configure_stream(name: str, request: StreamConfiguration):
    specification = {"StreamEnabled": request.enabled}
    if request.enabled:
        specification["StreamViewType"] = request.view

    def update():
        ConsoleService().client.update_table(
            TableName=name, StreamSpecification=specification
        )
        return "Stream configuration updated"

    return operations.submit("Configure stream", name, update)


@router.get("/tables/{name}/streams/shards")
def stream_shards(name: str, arn: str):
    client, shards, args = streams_client(), [], {"StreamArn": arn}
    while True:
        description = client.describe_stream(**args)["StreamDescription"]
        if description["TableName"] != name:
            raise ValueError("This stream belongs to another table")
        shards.extend(description.get("Shards", []))
        if not description.get("LastEvaluatedShardId"):
            break
        args["ExclusiveStartShardId"] = description["LastEvaluatedShardId"]
    return to_wire(
        {
            "status": description["StreamStatus"],
            "view": description["StreamViewType"],
            "shards": shards,
        }
    )


@router.post("/tables/{name}/streams/records")
def stream_records(name: str, request: StreamRead):
    client = streams_client()
    description = client.describe_stream(StreamArn=request.arn)["StreamDescription"]
    if description["TableName"] != name:
        raise ValueError("This stream belongs to another table")
    scope = {"table": name, "arn": request.arn, "shard": request.shard}
    if request.cursor:
        iterator = unpack_cursor(request.cursor, scope)
    else:
        arguments = {
            "StreamArn": request.arn,
            "ShardId": request.shard,
            "ShardIteratorType": request.start,
        }
        if "SEQUENCE" in request.start:
            if not request.sequence:
                raise ValueError("Enter a sequence number for this starting position")
            arguments["SequenceNumber"] = request.sequence
        iterator = client.get_shard_iterator(**arguments)["ShardIterator"]
    result = client.get_records(ShardIterator=iterator, Limit=request.limit)
    return {
        "records": to_wire(result.get("Records", [])),
        "cursor": pack_cursor(result.get("NextShardIterator"), scope),
    }


class TTLConfiguration(BaseModel):
    enabled: bool
    attribute: str = Field(min_length=1, max_length=255)


@router.get("/tables/{name}/ttl")
def describe_ttl(name: str):
    return ConsoleService().client.describe_time_to_live(TableName=name)[
        "TimeToLiveDescription"
    ]


@router.put("/tables/{name}/ttl", status_code=202)
def configure_ttl(name: str, request: TTLConfiguration):
    def update():
        ConsoleService().client.update_time_to_live(
            TableName=name,
            TimeToLiveSpecification={
                "Enabled": request.enabled,
                "AttributeName": request.attribute,
            },
        )
        return "TTL configuration updated"

    return operations.submit("Configure TTL", name, update)


class BulkDelete(BaseModel):
    keys: list[dict] = Field(min_length=1, max_length=100)
    confirmation: str


@router.post("/tables/{name}/items/delete-selected")
def delete_selected(name: str, request: BulkDelete):
    if request.confirmation != name:
        raise ValueError("Type the exact table name to confirm deletion")
    service = ConsoleService()
    keys = [item_from_wire(key) for key in request.keys]
    fields = service.validate_keys(name, keys, exact=True)
    service.client.transact_write_items(
        TransactItems=[
            {
                "Delete": {
                    "TableName": name,
                    "Key": key,
                    "ConditionExpression": "attribute_exists(#pk)",
                    "ExpressionAttributeNames": {"#pk": fields[0]},
                }
            }
            for key in keys
        ]
    )
    operations.record(
        "Delete selected items", name, detail=f"Deleted {len(keys)} items atomically"
    )
    return {"deleted": len(keys)}


class PartiQLRequest(BaseModel):
    statement: str = Field(min_length=1, max_length=8192)
    parameters: list[dict] = Field(default_factory=list, max_length=100)
    consistent: bool = False
    allowWrite: bool = False
    cursor: str | None = Field(default=None, max_length=65536)


@router.post("/partiql")
def execute_partiql(request: PartiQLRequest):
    match = re.match(r"^\s*(SELECT|INSERT|UPDATE|DELETE)\b", request.statement, re.I)
    if not match:
        raise ValueError(
            "Start with SELECT, INSERT, UPDATE, or DELETE (without leading comments)"
        )
    write = match.group(1).upper() != "SELECT"
    if write and not request.allowWrite:
        raise ValueError("Confirm the write before running this statement")
    if write and request.cursor:
        raise ValueError("Writes cannot use a continuation token")
    scope = {
        "statement": request.statement,
        "parameters": request.parameters,
        "consistent": request.consistent,
    }
    arguments = {"Statement": request.statement, "ReturnConsumedCapacity": "TOTAL"}
    if request.parameters:
        arguments["Parameters"] = [attribute_from_wire(p) for p in request.parameters]
    if not write:
        arguments["ConsistentRead"] = request.consistent
    if request.cursor:
        arguments["NextToken"] = unpack_cursor(request.cursor, scope)
    result = ConsoleService().client.execute_statement(**arguments)
    if write:
        operations.record("PartiQL write", None, detail="Statement completed")
    return {
        **read_metrics(to_wire(result.get("Items", []))),
        "items": to_wire(result.get("Items", [])),
        "cursor": pack_cursor(result.get("NextToken"), scope),
        "lastEvaluatedKey": to_wire(result.get("LastEvaluatedKey")),
        "write": write,
        "capacity": result.get("ConsumedCapacity", {}).get("CapacityUnits", 0),
    }
