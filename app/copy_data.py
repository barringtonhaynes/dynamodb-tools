"""Bounded immutable transfer batches; all writes use the active connection guard."""
import json
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from threading import Event, Lock
from typing import Literal
from uuid import uuid4

from botocore.exceptions import ClientError
from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import connection
from .console_service import ConsoleService
from .data_codec import item_from_wire, to_wire
from .editor_codec import convert_item
from .item_insights import table_checks
from .operations import OperationStopped, operations

MAX_BYTES = 10 * 1024 * 1024
LIFETIME = 30 * 60


class Transform(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["remove", "rename", "set", "timestamp"]
    attribute: str = Field(min_length=1, max_length=255)
    target: str = Field(default="", max_length=255)
    value: str = Field(default="", max_length=65536)
    format: Literal["iso", "seconds", "milliseconds"] = "iso"

    @model_validator(mode="after")
    def valid_rule(self):
        if self.operation == "rename" and (
            not self.target or self.target == self.attribute
        ):
            raise ValueError("Rename needs a different destination attribute")
        if self.operation == "set":
            constant(self.value)
        return self


def constant(text):
    return convert_item('{"value":' + text + "}", "json")["item"]["value"]


def transform_item(item, rules, now):
    item = deepcopy(item)
    for rule in rules:
        name = rule.attribute
        if rule.operation == "remove":
            item.pop(name, None)
        elif rule.operation == "rename" and name in item:
            if rule.target in item:
                raise ValueError(f"Cannot rename {name}: {rule.target} already exists")
            item[rule.target] = item.pop(name)
        elif rule.operation == "set":
            item[name] = constant(rule.value)
        elif rule.operation == "timestamp":
            item[name] = (
                {"S": now.isoformat(timespec="milliseconds").replace("+00:00", "Z")}
                if rule.format == "iso"
                else {
                    "N": str(
                        int(
                            now.timestamp()
                            * (1000 if rule.format == "milliseconds" else 1)
                        )
                    )
                }
            )
    # Checks precision, recursive types, nesting and the 400 KiB item limit.
    return convert_item(json.dumps(item), "ddb")["item"]


def scope(info):
    return (
        info["mode"],
        info.get("account") if info["mode"] == "aws" else info["endpoint"].rstrip("/"),
        info["region"],
    )


def binding(info):
    return (*scope(info), info.get("principal"), connection.connection_revision)


def schema_signature(table):
    fields = [
        "TableId",
        "TableArn",
        "CreationDateTime",
        "KeySchema",
        "AttributeDefinitions",
        "GlobalSecondaryIndexes",
        "LocalSecondaryIndexes",
    ]
    stable = {key: table.get(key) for key in fields[:5]}
    for field in fields[5:]:
        stable[field] = [
            {
                key: index.get(key)
                for key in ("IndexName", "KeySchema", "Projection", "IndexStatus")
            }
            for index in table.get(field, [])
        ]
    return sha256(json.dumps(to_wire(stable), sort_keys=True).encode()).hexdigest()


class TransferStore:
    def __init__(self):
        self.lock = Lock()
        self.batches = {}
        self.plans = {}
        self.jobs = {}

    def prune(self):
        now = time.monotonic()
        self.batches = {
            key: value for key, value in self.batches.items() if value["deadline"] > now
        }
        self.plans = {
            key: value
            for key, value in self.plans.items()
            if value["deadline"] > now and value["batch"] in self.batches
        }
        self.jobs = {
            key: value for key, value in self.jobs.items() if not value["done"].is_set()
        }

    def add(self, batch):
        with self.lock:
            self.prune()
            if len(self.batches) >= 4:
                raise ValueError(
                    "Four copy batches are already staged. Discard an unused batch first."
                )
            batch = {
                **batch,
                "id": uuid4().hex,
                "deadline": time.monotonic() + LIFETIME,
            }
            self.batches[batch["id"]] = batch
            return batch

    def get(self, key):
        with self.lock:
            self.prune()
            if key not in self.batches:
                raise ValueError(
                    "Copy batch expired or was discarded. Capture it again or use your exported file."
                )
            return self.batches[key]

    def summaries(self):
        with self.lock:
            self.prune()
            return [summary(batch) for batch in reversed(list(self.batches.values()))]

    def discard(self, key):
        with self.lock:
            self.batches.pop(key, None)
            self.prune()

    def plan(self, data):
        with self.lock:
            self.prune()
            if data["batch"] not in self.batches:
                raise ValueError("Copy batch expired. Capture it again.")
            if len(self.plans) >= 32:
                self.plans.pop(next(iter(self.plans)))
            token = uuid4().hex
            self.plans[token] = {**data, "deadline": time.monotonic() + 300}
            return token

    def claim(self, token):
        with self.lock:
            self.prune()
            plan = self.plans.pop(token, None)
            if not plan:
                raise ValueError(
                    "Destination preview expired or was already used. Preview again."
                )
            return plan, self.batches[plan["batch"]]


store = TransferStore()


def summary(batch):
    return {
        key: value for key, value in batch.items() if key not in {"items", "deadline"}
    }


def capture(name, request):
    service = ConsoleService()
    table = service.describe(name)
    identity = connection.connection_info(service.client)
    query = request.query.model_copy(deep=True)
    indexes = table.get("GlobalSecondaryIndexes", []) + table.get(
        "LocalSecondaryIndexes", []
    )
    selected = next(
        (index for index in indexes if index["IndexName"] == query.index), table
    )
    if query.mode == "query" and (
        sum(key["KeyType"] == "HASH" for key in selected["KeySchema"]) != 1
        or sum(key["KeyType"] == "RANGE" for key in selected["KeySchema"]) > 1
    ):
        raise ValueError(
            "Native multi-attribute queries are not supported by this copy builder"
        )
    now = datetime.now(timezone.utc)
    items, before = [], []
    evaluated = pages = missing = size = 0
    capacity = 0
    while pages < request.maxPages and len(items) < request.maxItems:
        query.limit = min(100, request.maxItems - len(items))
        page = service.search(name, query)
        pages += 1
        evaluated += page["scanned"]
        capacity += page["capacity"]
        for item in page["items"]:
            if query.index or query.projection:
                response = service.client.get_item(
                    TableName=name,
                    Key=item_from_wire(
                        {
                            key["AttributeName"]: item[key["AttributeName"]]
                            for key in table["KeySchema"]
                        }
                    ),
                    ConsistentRead=True,
                    ReturnConsumedCapacity="TOTAL",
                )
                capacity += response.get("ConsumedCapacity", {}).get("CapacityUnits", 0)
                if not response.get("Item"):
                    missing += 1
                    continue
                item = to_wire(response["Item"])
            transformed = transform_item(item, request.transforms, now)
            size += len(json.dumps(transformed, ensure_ascii=False).encode())
            if size > MAX_BYTES:
                raise ValueError(
                    "Transformed data exceeds 10 MiB. Nothing was staged or written. Choose fewer items."
                )
            items.append(transformed)
            if len(before) < 3:
                before.append(item)
        query.cursor = page["cursor"]
        if not query.cursor:
            break
    batch = store.add(
        {
            "source": {
                "table": name,
                "connection": identity,
                "query": request.query.model_dump(),
            },
            "transforms": [rule.model_dump() for rule in request.transforms],
            "items": items,
            "before": before,
            "after": items[:3],
            "count": len(items),
            "bytes": size,
            "evaluated": evaluated,
            "pages": pages,
            "capacity": capacity,
            "missing": missing,
            "complete": not bool(query.cursor),
            "cursor": query.cursor,
            "capturedAt": now.isoformat(),
            "expiresAt": (now + timedelta(seconds=LIFETIME)).isoformat(),
            "hydrated": bool(query.index or query.projection),
        }
    )
    return summary(batch)


def validate_items(items, table):
    seen = set()
    for position, item in enumerate(items, 1):
        errors = table_checks(item, table)["errors"]
        if errors:
            raise ValueError(f"Item {position}: " + "; ".join(errors))
        decoded = item_from_wire(item)
        values = []
        for field in table["KeySchema"]:
            kind, value = next(iter(decoded[field["AttributeName"]].items()))
            values.append((kind, Decimal(value) if kind == "N" else value))
        key = tuple(values)
        if key in seen:
            raise ValueError(
                f"Item {position}: transformed destination key occurs more than once. Nothing was written."
            )
        seen.add(key)


def preview(name, batch_id, policy):
    batch = store.get(batch_id)
    if not batch["items"]:
        raise ValueError("This batch has no items to copy")
    service = ConsoleService()
    info = connection.connection_info(service.client)
    table = service.describe(name)
    if name == batch["source"]["table"] and scope(info) == scope(
        batch["source"]["connection"]
    ):
        raise ValueError(
            "Choose a different destination table or connection; copying back into the source table is disabled"
        )
    if table.get("TableStatus") != "ACTIVE":
        raise ValueError("The destination table must be ACTIVE")
    validate_items(batch["items"], table)
    token = store.plan(
        {
            "batch": batch_id,
            "table": name,
            "policy": policy,
            "binding": binding(info),
            "schema": schema_signature(table),
        }
    )
    return {
        "token": token,
        "count": batch["count"],
        "bytes": batch["bytes"],
        "items": batch["after"],
        "destination": {"table": name, "connection": info},
        "policy": policy,
        "expiresSeconds": 300,
    }


def execute(name, token, confirmation):
    if confirmation != f"COPY {name}":
        raise ValueError(f"Type COPY {name} to confirm this destination")
    plan, batch = store.claim(token)
    service = ConsoleService()
    info = connection.connection_info(service.client)
    table = service.describe(name)
    if (
        plan["table"] != name
        or plan["binding"] != binding(info)
        or plan["schema"] != schema_signature(table)
    ):
        raise ValueError(
            "Destination connection or schema changed. Preview again; nothing was written."
        )
    if table.get("TableStatus") != "ACTIVE":
        raise ValueError("The destination table must be ACTIVE")
    signal = {"stop": Event(), "done": Event()}
    items = batch["items"]

    def work(update):
        written = skipped = 0
        capacity = 0

        def report():
            detail = (
                f"Copied {written}; skipped existing {skipped}; "
                f"remaining {len(items) - written - skipped}; {capacity:g} reported WCU."
            )
            update(
                detail=detail,
                progress={
                    "written": written,
                    "skipped": skipped,
                    "total": len(items),
                    "capacity": capacity,
                },
            )
            return detail

        try:
            # Schema changes between preview and queued execution also invalidate the copy.
            if plan["binding"] != binding(
                connection.connection_info(service.client)
            ) or plan["schema"] != schema_signature(service.describe(name)):
                raise ValueError("Destination changed while queued; preview again")
            for item in items:
                if signal["stop"].is_set():
                    raise OperationStopped(
                        "Stopped by user. " + report() + " Earlier writes remain."
                    )
                arguments = {
                    "TableName": name,
                    "Item": item_from_wire(item),
                    "ReturnConsumedCapacity": "TOTAL",
                }
                if plan["policy"] == "skip":
                    arguments.update(
                        ConditionExpression="attribute_not_exists(#pk)",
                        ExpressionAttributeNames={
                            "#pk": table["KeySchema"][0]["AttributeName"]
                        },
                    )
                try:
                    result = service.client.put_item(**arguments)
                    written += 1
                    capacity += result.get("ConsumedCapacity", {}).get(
                        "CapacityUnits", 0
                    )
                except ClientError as error:
                    if (
                        plan["policy"] == "skip"
                        and error.response["Error"]["Code"]
                        == "ConditionalCheckFailedException"
                    ):
                        skipped += 1
                    else:
                        raise
                report()
            return report() + " Source items were not changed."
        except OperationStopped:
            raise
        except Exception as error:
            raise ValueError(
                report()
                + " Copy stopped. Earlier writes remain; the failed request may have written. "
                + str(error)
            ) from error
        finally:
            signal["done"].set()

    job = operations.submit("Copy data", name, work, with_progress=True)
    with store.lock:
        store.prune()
        if not signal["done"].is_set():
            store.jobs[job["id"]] = signal
    return job


def stop_job(job_id):
    with store.lock:
        store.prune()
        signal = store.jobs.get(job_id)
        if signal:
            signal["stop"].set()
    return {"stopping": bool(signal)}
