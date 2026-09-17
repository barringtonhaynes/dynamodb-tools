from concurrent.futures import Future
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from app import aws_safety, connection, copy_data
from app.config import settings
from app.copy_api import CaptureRequest
from app.main import app
from app.operations import OperationStore


class ImmediateExecutor:
    def submit(self, function):
        future = Future()
        function()
        future.set_result(None)
        return future


@pytest.fixture
def env(service, monkeypatch):
    store = OperationStore()
    store._executor.shutdown()
    store._executor = ImmediateExecutor()
    monkeypatch.setattr(copy_data, "store", copy_data.TransferStore())
    monkeypatch.setattr(copy_data, "operations", store)
    monkeypatch.setattr("app.main.operations", store)
    monkeypatch.setattr("app.connection_api.operations", store)
    monkeypatch.setattr("app.console_api.operations", store)
    client = connection.client()
    client.create_table(
        TableName="destination",
        KeySchema=[{"AttributeName": "name", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "name", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    for name in ["A", "B", "C"]:
        client.put_item(
            TableName="test_table",
            Item={
                "name": {"S": name},
                "secret": {"S": "private"},
                "exact": {"N": "9007199254740993123456"},
                "set": {"NS": ["1", "2"]},
                "binary": {"B": b"abc"},
            },
        )
    return TestClient(app), client, store


def capture(http, **extra):
    result = http.post("/api/tables/test_table/copies/capture", json=extra)
    assert result.status_code == 200, result.text
    return result.json()


def preview(http, batch, **extra):
    result = http.post(
        "/api/tables/destination/copies/preview", json={"batch": batch["id"], **extra}
    )
    assert result.status_code == 200, result.text
    return result.json()


def execute(http, plan):
    return http.post(
        "/api/tables/destination/copies/execute",
        json={"token": plan["token"], "confirmation": "COPY destination"},
    )


def test_transforms_preserve_types_exact_values_and_one_timestamp(env):
    http, client, jobs = env
    batch = capture(
        http,
        transforms=[
            {"operation": "remove", "attribute": "secret"},
            {"operation": "rename", "attribute": "binary", "target": "payload"},
            {
                "operation": "set",
                "attribute": "large",
                "value": "9007199254740993123456789.123456",
            },
            {"operation": "timestamp", "attribute": "copiedAt"},
            {"operation": "timestamp", "attribute": "ttl", "format": "seconds"},
        ],
    )
    assert batch["complete"] and batch["count"] == 3
    assert len({item["copiedAt"]["S"] for item in batch["after"]}) == 1
    assert batch["after"][0]["large"] == {"N": "9007199254740993123456789.123456"}
    assert "secret" not in batch["after"][0]
    assert batch["before"][0]["secret"] == {"S": "private"}
    assert batch["after"][0]["payload"] == {"B": "YWJj"}
    plan = preview(http, batch)
    result = execute(http, plan)
    assert result.status_code == 202, result.text
    job = jobs.list()[0]
    assert job["status"] == "completed"
    assert job["progress"]["written"] == 3
    assert client.scan(TableName="test_table")["Items"][0]["secret"]
    target = client.scan(TableName="destination")["Items"][0]
    assert "secret" not in target
    assert target["payload"] == {"B": b"abc"}
    assert target["set"] == {"NS": ["1", "2"]}
    assert http.get(f'/api/copies/{batch["id"]}/export').json() == batch["after"]


def test_skip_is_conditional_and_replace_is_explicit(env):
    http, client, jobs = env
    batch = capture(http)
    plan = preview(http, batch)
    # Create the collision AFTER preview; skip must not race.
    client.put_item(
        TableName="destination", Item={"name": {"S": "A"}, "keep": {"S": "yes"}}
    )
    assert execute(http, plan).status_code == 202
    assert jobs.list()[0]["progress"]["skipped"] == 1
    assert client.get_item(TableName="destination", Key={"name": {"S": "A"}})["Item"][
        "keep"
    ]
    assert execute(http, plan).status_code == 400  # one-use preview
    replacement = preview(http, batch, policy="replace")
    assert execute(http, replacement).status_code == 202
    assert (
        "keep"
        not in client.get_item(TableName="destination", Key={"name": {"S": "A"}})[
            "Item"
        ]
    )


def test_capture_limits_and_continuation_do_not_skip_matching_items(env):
    http, _, _ = env
    first = capture(http, maxItems=1)
    assert first["count"] == 1 and not first["complete"] and first["cursor"]
    second = capture(http, maxItems=10, query={"cursor": first["cursor"]})
    assert second["count"] == 2 and second["complete"]
    assert {i["name"]["S"] for i in first["after"] + second["after"]} == {"A", "B", "C"}


def test_empty_filtered_pages_continue_until_limits(monkeypatch):
    fake = Mock()
    fake.describe.return_value = {
        "KeySchema": [{"KeyType": "HASH", "AttributeName": "name"}]
    }
    fake.search.side_effect = [
        {"items": [], "scanned": 100, "capacity": 1, "cursor": "next"},
        {
            "items": [{"name": {"S": "A"}}],
            "scanned": 1,
            "capacity": 0.5,
            "cursor": None,
        },
    ]
    monkeypatch.setattr(copy_data, "ConsoleService", lambda: fake)
    monkeypatch.setattr(
        connection,
        "connection_info",
        lambda _: {"mode": "local", "endpoint": "http://local", "region": "x"},
    )
    monkeypatch.setattr(copy_data, "store", copy_data.TransferStore())
    batch = copy_data.capture("test_table", CaptureRequest())
    assert batch["count"] == 1 and batch["pages"] == 2 and batch["evaluated"] == 101
    assert batch["capacity"] == 1.5


def test_projected_reads_hydrate_full_source_items(env):
    http, _, _ = env
    batch = capture(
        http,
        query={"projection": ["name"]},
        transforms=[{"operation": "remove", "attribute": "secret"}],
    )
    assert batch["hydrated"]
    assert batch["after"][0]["exact"]["N"] == "9007199254740993123456"
    assert batch["after"][0]["set"]


@pytest.mark.parametrize(
    "transform",
    [
        {"operation": "set", "attribute": "name", "value": '"same-key"'},
        {"operation": "remove", "attribute": "name"},
        {"operation": "set", "attribute": "name", "value": "42"},
    ],
)
def test_destination_rejects_duplicate_missing_or_wrong_type_keys_before_writes(
    env, transform
):
    http, client, _ = env
    batch = capture(http, transforms=[transform])
    result = http.post(
        "/api/tables/destination/copies/preview", json={"batch": batch["id"]}
    )
    assert result.status_code == 400
    assert client.scan(TableName="destination")["Count"] == 0


def test_numeric_duplicate_keys_canonicalized():
    table = {
        "KeySchema": [{"AttributeName": "id", "KeyType": "HASH"}],
        "AttributeDefinitions": [{"AttributeName": "id", "AttributeType": "N"}],
    }
    with pytest.raises(ValueError, match="more than once"):
        copy_data.validate_items([{"id": {"N": "1"}}, {"id": {"N": "1.0"}}], table)


def test_rename_collision_and_invalid_json_fail_without_staging(env):
    http, client, _ = env
    for rule in [
        {"operation": "rename", "attribute": "secret", "target": "name"},
        {"operation": "set", "attribute": "new", "value": '{"x":1,"x":2}'},
    ]:
        result = http.post(
            "/api/tables/test_table/copies/capture", json={"transforms": [rule]}
        )
        assert result.status_code in {400, 422}, result.text
    assert http.get("/api/copies").json() == []
    assert client.scan(TableName="destination")["Count"] == 0


def test_same_table_and_changed_destination_are_rejected(env, monkeypatch):
    http, client, _ = env
    batch = capture(http)
    assert (
        http.post(
            "/api/tables/test_table/copies/preview", json={"batch": batch["id"]}
        ).status_code
        == 400
    )
    plan = preview(http, batch)
    monkeypatch.setattr(connection, "connection_revision", "changed")
    assert execute(http, plan).status_code == 400
    assert client.scan(TableName="destination")["Count"] == 0
    assert http.get("/api/copies").json()[0]["id"] == batch["id"]


def test_schema_change_invalidates_preview(env):
    http, client, _ = env
    batch = capture(http)
    plan = preview(http, batch)
    client.delete_table(TableName="destination")
    client.create_table(
        TableName="destination",
        KeySchema=[{"AttributeName": "different", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "different", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    assert execute(http, plan).status_code == 400
    assert client.scan(TableName="destination")["Count"] == 0


def test_expiry_discard_and_wrong_confirmation(env, monkeypatch):
    http, _, _ = env
    batch = capture(http)
    plan = preview(http, batch)
    assert (
        http.post(
            "/api/tables/destination/copies/execute",
            json={"token": plan["token"], "confirmation": "yes"},
        ).status_code
        == 400
    )
    # Wrong confirmation does not consume the preview.
    assert plan["token"] in copy_data.store.plans
    assert http.post(f'/api/copies/{batch["id"]}/discard').status_code == 200
    assert execute(http, plan).status_code == 400
    batch = capture(http)
    deadline = copy_data.store.batches[batch["id"]]["deadline"]
    monkeypatch.setattr(
        copy_data, "time", SimpleNamespace(monotonic=lambda: deadline + 1)
    )
    assert http.get("/api/copies").json() == []
    assert http.get(f'/api/copies/{batch["id"]}/export').status_code == 400


def test_capture_byte_limit_and_memory_bound(env, monkeypatch):
    http, _, _ = env
    monkeypatch.setattr(copy_data, "MAX_BYTES", 1)
    assert (
        http.post("/api/tables/test_table/copies/capture", json={}).status_code == 400
    )
    assert not copy_data.store.batches
    monkeypatch.setattr(copy_data, "MAX_BYTES", 10 * 1024 * 1024)
    for _ in range(4):
        capture(http)
    assert (
        http.post("/api/tables/test_table/copies/capture", json={}).status_code == 400
    )
    assert len(copy_data.store.batches) == 4


def test_aws_preview_read_only_execution_requires_account_approval(env, monkeypatch):
    http, client, jobs = env
    batch = capture(http)
    monkeypatch.setattr(settings, "dynamodb_mode", "aws")
    monkeypatch.setattr(settings, "read_only", True)
    plan = preview(http, batch)
    assert execute(http, plan).status_code == 403
    monkeypatch.setattr(settings, "read_only", False)
    clock = [100.0]
    monkeypatch.setattr(aws_safety, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(aws_safety, "challenges", {})
    response = execute(http, plan)
    assert response.status_code == 428
    challenge = response.json()["awsConfirmation"]
    assert challenge["target"] == "destination"
    headers = {
        "X-AWS-Challenge": challenge["token"],
        "X-AWS-Confirmation": challenge["phrase"],
    }
    payload = {"token": plan["token"], "confirmation": "COPY destination"}
    assert (
        http.post(
            "/api/tables/destination/copies/execute", json=payload, headers=headers
        ).status_code
        == 409
    )
    clock[0] += 6
    assert (
        http.post(
            "/api/tables/destination/copies/execute", json=payload, headers=headers
        ).status_code
        == 202
    )
    assert jobs.list()[0]["status"] == "completed"
    assert client.scan(TableName="destination")["Count"] == 3


def test_partial_failure_reports_written_and_remaining(env, monkeypatch):
    http, client, jobs = env
    batch = capture(http)
    plan = preview(http, batch)
    real = copy_data.ConsoleService

    def service():
        result = real()
        original = result.client.put_item
        count = [0]

        def put(**kwargs):
            count[0] += 1
            if count[0] == 2:
                raise ClientError(
                    {"Error": {"Code": "AccessDeniedException", "Message": "Denied"}},
                    "PutItem",
                )
            return original(**kwargs)

        result.client.put_item = put
        return result

    monkeypatch.setattr(copy_data, "ConsoleService", service)
    assert execute(http, plan).status_code == 202
    job = jobs.list()[0]
    assert job["status"] == "failed"
    assert job["progress"]["written"] == 1
    assert "remaining 2" in job["detail"] and "may have written" in job["detail"]
    assert client.scan(TableName="destination")["Count"] == 1


def test_stop_queued_copy_prevents_writes(env):
    http, client, jobs = env
    callbacks = []
    jobs._executor = SimpleNamespace(submit=callbacks.append)
    result = execute(http, preview(http, capture(http)))
    job_id = result.json()["id"]
    assert http.post(f"/api/copies/jobs/{job_id}/stop").json()["stopping"]
    callbacks[0]()
    assert jobs.list()[0]["status"] == "cancelled"
    assert client.scan(TableName="destination")["Count"] == 0


def test_timestamp_and_transform_order():
    rules = [
        copy_data.Transform(operation="rename", attribute="x", target="y"),
        copy_data.Transform(operation="set", attribute="x", value='"new"'),
        copy_data.Transform(
            operation="timestamp", attribute="time", format="milliseconds"
        ),
    ]
    now = datetime(2026, 9, 17, tzinfo=timezone.utc)
    result = copy_data.transform_item({"x": {"S": "old"}}, rules, now)
    assert result == {
        "x": {"S": "new"},
        "y": {"S": "old"},
        "time": {"N": str(int(now.timestamp() * 1000))},
    }


def test_cross_region_connection_switch_preserves_batch(env):
    http, source, jobs = env
    batch = capture(http)
    preferences = {
        "dynamodb_mode": "local",
        "aws_region": "us-west-2",
        "dynamodb_endpoint_url": "https://dynamodb.us-west-2.amazonaws.com",
        "read_only": False,
    }
    result = http.put("/api/connection", json=preferences)
    assert result.status_code == 200, result.text
    target = connection.client()
    target.create_table(
        TableName="destination",
        KeySchema=[{"AttributeName": "name", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "name", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    assert http.get("/api/copies").json()[0]["id"] == batch["id"]
    plan = preview(http, batch)
    assert plan["destination"]["connection"]["region"] == "us-west-2"
    assert execute(http, plan).status_code == 202
    assert jobs.list()[0]["status"] == "completed"
    assert target.scan(TableName="destination")["Count"] == 3
    assert source.scan(TableName="destination")["Count"] == 0
    assert source.scan(TableName="test_table")["Count"] == 3


def test_gsi_query_hydrates_non_projected_attributes(env):
    http, client, _ = env
    client.create_table(
        TableName="gsi_source",
        KeySchema=[{"AttributeName": "name", "KeyType": "HASH"}],
        AttributeDefinitions=[
            {"AttributeName": "name", "AttributeType": "S"},
            {"AttributeName": "group", "AttributeType": "S"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "by_group",
                "KeySchema": [{"AttributeName": "group", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "KEYS_ONLY"},
            }
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    client.put_item(
        TableName="gsi_source",
        Item={
            "name": {"S": "A"},
            "group": {"S": "OPEN"},
            "unprojected": {"S": "full record"},
        },
    )
    result = http.post(
        "/api/tables/gsi_source/copies/capture",
        json={
            "query": {"mode": "query", "index": "by_group", "partition": {"S": "OPEN"}}
        },
    )
    assert result.status_code == 200, result.text
    batch = result.json()
    assert batch["after"][0]["unprojected"] == {"S": "full record"}
    assert batch["hydrated"]


def test_cancel_running_copy_keeps_earlier_writes(env, monkeypatch):
    http, client, jobs = env
    callbacks = []
    jobs._executor = SimpleNamespace(submit=callbacks.append)
    real = copy_data.ConsoleService
    job_id = [None]

    def service():
        result = real()
        original = result.client.put_item

        def put(**kwargs):
            response = original(**kwargs)
            copy_data.stop_job(job_id[0])
            return response

        result.client.put_item = put
        return result

    monkeypatch.setattr(copy_data, "ConsoleService", service)
    job_id[0] = execute(http, preview(http, capture(http))).json()["id"]
    callbacks[0]()
    assert jobs.list()[0]["status"] == "cancelled"
    assert jobs.list()[0]["progress"]["written"] == 1
    assert client.scan(TableName="destination")["Count"] == 1


def test_queued_copy_blocks_connection_switch(env):
    http, _, jobs = env
    callbacks = []
    jobs._executor = SimpleNamespace(submit=callbacks.append)
    job_id = execute(http, preview(http, capture(http))).json()["id"]
    preferences = {
        **http.get("/api/connection").json()["preferences"],
        "read_only": False,
    }
    assert http.put("/api/connection", json=preferences).status_code == 409
    http.post(f"/api/copies/jobs/{job_id}/stop")
    callbacks[0]()
    assert http.put("/api/connection", json=preferences).status_code == 200
