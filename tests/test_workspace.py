from concurrent.futures import Future
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import console_api, workspace_api
from app.console_api import SearchRequest
from app.operations import OperationStore
from app.query_filters import apply_read_options


@pytest.fixture
def client(service, monkeypatch):
    store = OperationStore()
    store._executor.shutdown()

    class Immediate:
        def submit(self, function):
            result = Future()
            function()
            result.set_result(None)
            return result

    store._executor = Immediate()
    monkeypatch.setattr(console_api, "operations", store)
    monkeypatch.setattr(workspace_api, "operations", store)
    app = FastAPI()
    app.include_router(console_api.router)
    app.include_router(workspace_api.router)
    with TestClient(app) as client:
        yield client


def test_filtered_pages_keep_cursor_and_projections_keep_keys(client, service):
    table = service.resource.Table("test_table")
    for i in range(6):
        table.put_item(
            Item={"name": f"item{i}", "status": "yes" if i == 5 else "no", "size": i}
        )
    request = {
        "limit": 1,
        "filters": [{"attribute": "status", "value": {"S": "yes"}}],
        "projection": ["size"],
    }
    response = client.post("/api/tables/test_table/items/search", json=request)
    first = response.json()
    assert response.status_code == 200
    assert first["items"] == [] and first["cursor"] and first["scanned"] == 1
    result = first
    found = []
    while True:
        found.extend(result["items"])
        if not result["cursor"]:
            break
        result = client.post(
            "/api/tables/test_table/items/search",
            json={**request, "cursor": result["cursor"]},
        ).json()
    assert found == [{"name": {"S": "item5"}, "size": {"N": "5"}}]
    assert (
        client.post(
            "/api/tables/test_table/items/search",
            json={**request, "filters": [], "cursor": first["cursor"]},
        ).status_code
        == 400
    )


@pytest.mark.parametrize(
    "operator,value,end,expected",
    [
        ("between", {"N": "1"}, {"N": "2"}, 2),
        (">=", {"N": "2"}, None, 1),
        ("exists", None, None, 3),
        ("not_exists", None, None, 0),
        ("attribute_type", {"S": "N"}, None, 3),
    ],
)
def test_filter_operators(client, service, operator, value, end, expected):
    for i in range(3):
        service.resource.Table("test_table").put_item(
            Item={"name": f"row{i}", "count": i}
        )
    result = client.post(
        "/api/tables/test_table/items/search",
        json={
            "filters": [
                {"attribute": "count", "operator": operator, "value": value, "end": end}
            ]
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["count"] == expected


def test_expression_supports_nested_paths_and_reserved_attributes(client, service):
    service.resource.Table("test_table").put_item(
        Item={"name": "Ada", "data": {"size": 4}}
    )
    result = client.post(
        "/api/tables/test_table/items/search",
        json={
            "filterExpression": "#d.#s = :value",
            "expressionNames": {"#d": "data", "#s": "size"},
            "expressionValues": {":value": {"N": "4"}},
        },
    )
    assert result.status_code == 200 and result.json()["count"] == 1


def test_read_options_reject_gsi_consistency_and_mixed_filters():
    table = {
        "KeySchema": [{"AttributeName": "pk"}],
        "GlobalSecondaryIndexes": [{"IndexName": "gsi"}],
    }
    with pytest.raises(ValueError, match="eventually"):
        apply_read_options({}, SearchRequest(index="gsi", consistent=True), table)
    with pytest.raises(ValueError, match="either"):
        apply_read_options(
            {},
            SearchRequest(
                filters=[{"attribute": "x", "value": {"S": "a"}}],
                filterExpression="x = :v",
            ),
            table,
        )
    with pytest.raises(ValueError, match="range end"):
        apply_read_options(
            {},
            SearchRequest(
                filters=[{"attribute": "x", "operator": "between", "value": {"N": "1"}}]
            ),
            table,
        )


def test_bulk_delete_is_confirmed_and_atomic(client, service):
    table = service.resource.Table("test_table")
    for name in ["Ada", "Grace"]:
        table.put_item(Item={"name": name})
    endpoint = "/api/tables/test_table/items/delete-selected"
    body = {"confirmation": "wrong", "keys": [{"name": {"S": "Ada"}}]}
    assert client.post(endpoint, json=body).status_code == 400
    body["confirmation"] = "test_table"
    body["keys"].append({"name": {"S": "missing"}})
    assert client.post(endpoint, json=body).status_code == 409
    assert table.scan()["Count"] == 2
    body["keys"][1] = {"name": {"S": "Grace"}}
    assert client.post(endpoint, json=body).json() == {"deleted": 2}
    assert table.scan()["Count"] == 0


def test_ttl_settings_are_recorded(client):
    assert (
        client.get("/api/tables/test_table/ttl").json()["TimeToLiveStatus"]
        == "DISABLED"
    )
    result = client.put(
        "/api/tables/test_table/ttl", json={"enabled": True, "attribute": "expires_at"}
    )
    assert result.status_code == 202
    assert (
        client.get("/api/tables/test_table/ttl").json()["AttributeName"] == "expires_at"
    )
    job = client.get("/api/operations/" + result.json()["id"]).json()
    assert job["status"] == "completed" and isinstance(job["detail"], str)


class FakeStreams:
    def __init__(self):
        self.args = []

    def describe_stream(self, **kwargs):
        self.args.append(kwargs)
        result = {
            "TableName": "test_table",
            "StreamStatus": "ENABLED",
            "StreamViewType": "NEW_AND_OLD_IMAGES",
            "Shards": [
                {"ShardId": "second" if "ExclusiveStartShardId" in kwargs else "first"}
            ],
        }
        if "ExclusiveStartShardId" not in kwargs:
            result["LastEvaluatedShardId"] = "first"
        return {"StreamDescription": result}

    def get_shard_iterator(self, **kwargs):
        self.args.append(kwargs)
        return {"ShardIterator": "iterator"}

    def get_records(self, **kwargs):
        self.args.append(kwargs)
        return {"Records": [], "NextShardIterator": "next-iterator"}


def test_stream_shards_paginate_and_records_continue_on_empty_page(client, monkeypatch):
    streams = FakeStreams()
    monkeypatch.setattr(workspace_api, "streams_client", lambda: streams)
    result = client.get("/api/tables/test_table/streams/shards?arn=stream")
    assert len(result.json()["shards"]) == 2
    assert streams.args[1]["ExclusiveStartShardId"] == "first"
    request = {"arn": "stream", "shard": "first"}
    path = "/api/tables/test_table/streams/records"
    result = client.post(path, json=request).json()
    assert result["records"] == [] and result["cursor"]
    assert (
        client.post(path, json={**request, "cursor": result["cursor"]}).status_code
        == 200
    )
    assert streams.args[-1]["ShardIterator"] == "next-iterator"
    assert (
        client.post(
            path, json={**request, "shard": "other", "cursor": result["cursor"]}
        ).status_code
        == 400
    )
    assert (
        client.post(path, json={**request, "start": "AT_SEQUENCE_NUMBER"}).status_code
        == 400
    )
    assert (
        client.post("/api/tables/other/streams/records", json=request).status_code
        == 400
    )


def test_expired_stream_position_is_actionable(client, monkeypatch):
    streams = FakeStreams()

    def expired(**kwargs):
        raise ClientError(
            {
                "Error": {
                    "Code": "ExpiredIteratorException",
                    "Message": "Iterator expired",
                }
            },
            "GetRecords",
        )

    streams.get_records = expired
    monkeypatch.setattr(workspace_api, "streams_client", lambda: streams)
    result = client.post(
        "/api/tables/test_table/streams/records",
        json={"arn": "stream", "shard": "first"},
    )
    assert result.status_code == 410


def test_partiql_requires_write_confirmation_and_scopes_continuation(
    client, monkeypatch
):
    calls = []

    def execute(**kwargs):
        calls.append(kwargs)
        return {"Items": [{"n": {"N": "12345678901234567890"}}], "NextToken": "opaque"}

    monkeypatch.setattr(
        workspace_api,
        "ConsoleService",
        lambda: SimpleNamespace(client=SimpleNamespace(execute_statement=execute)),
    )
    assert (
        client.post(
            "/api/partiql", json={"statement": "DELETE FROM test_table"}
        ).status_code
        == 400
    )
    assert calls == []
    assert (
        client.post(
            "/api/partiql",
            json={"statement": "UPDATE test_table SET n=1", "allowWrite": True},
        ).status_code
        == 200
    )
    result = client.post(
        "/api/partiql", json={"statement": "SELECT * FROM test_table"}
    ).json()
    assert result["items"][0]["n"]["N"] == "12345678901234567890"
    assert (
        client.post(
            "/api/partiql",
            json={"statement": "SELECT * FROM test_table", "cursor": result["cursor"]},
        ).status_code
        == 200
    )
    assert calls[-1]["NextToken"] == "opaque"
    assert (
        client.post(
            "/api/partiql",
            json={"statement": "SELECT * FROM another", "cursor": result["cursor"]},
        ).status_code
        == 400
    )
