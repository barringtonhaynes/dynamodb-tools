import json
from concurrent.futures import Future
from decimal import Decimal

import pytest
from boto3.dynamodb.types import TypeDeserializer
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import console_api
from app.console_service import ConsoleService
from app.data_codec import item_from_wire, parse_import
from app.operations import OperationStore


class ImmediateExecutor:
    """Exercise queued operation state transitions without outliving Moto's fixture."""

    def submit(self, function):
        result = Future()
        function()
        result.set_result(None)
        return result


@pytest.fixture
def client(service, monkeypatch):
    store = OperationStore()
    store._executor.shutdown()
    store._executor = ImmediateExecutor()
    monkeypatch.setattr(console_api, "operations", store)
    app = FastAPI()
    app.include_router(console_api.router)
    with TestClient(app) as client:
        yield client


def test_overview_has_real_tables_and_connection(client):
    result = client.get("/api/overview")
    assert result.status_code == 200
    assert [table["TableName"] for table in result.json()["tables"]] == ["test_table"]
    assert result.json()["connection"]["region"] == "us-east-1"


def test_item_create_edit_conflict_and_delete(client):
    path = "/api/tables/test_table/items"
    item = {
        "name": {"S": "Ada"},
        "score": {"N": "12345678901234567890.123456789012345678"},
    }
    assert client.put(path, json={"item": item}).status_code == 200
    assert client.put(path, json={"item": item}).status_code == 409
    key = {"name": {"S": "Ada"}}
    assert client.post(path + "/get", json={"key": key}).json() == item
    item["active"] = {"BOOL": True}
    assert client.put(path, json={"item": item, "originalKey": key}).status_code == 200
    assert client.post(path + "/get", json={"key": key}).json() == item
    changed = {**item, "name": {"S": "Grace"}}
    assert (
        client.put(path, json={"item": changed, "originalKey": key}).status_code == 400
    )
    assert client.request("DELETE", path, json={"key": key}).status_code == 200
    assert client.post(path + "/get", json={"key": key}).status_code == 404
    assert client.put(path, json={"item": item, "originalKey": key}).status_code == 409


def test_scan_cursor_pages_without_duplicates_and_rejects_reuse(client, service):
    table = service.resource.Table("test_table")
    for i in range(7):
        table.put_item(Item={"name": f"person-{i}"})
    path = "/api/tables/test_table/items/search"
    first = client.post(path, json={"limit": 3}).json()
    second = client.post(path, json={"limit": 3, "cursor": first["cursor"]}).json()
    third = client.post(path, json={"limit": 3, "cursor": second["cursor"]}).json()
    assert (
        len(
            {
                row["name"]["S"]
                for page in [first, second, third]
                for row in page["items"]
            }
        )
        == 7
    )
    assert third["cursor"] is None
    assert client.post(path, json={"cursor": "broken"}).status_code == 400
    assert (
        client.post(
            path,
            json={
                "mode": "query",
                "partition": {"S": "person-0"},
                "cursor": first["cursor"],
            },
        ).status_code
        == 400
    )


def test_partition_query_and_validation(client, service):
    service.resource.Table("test_table").put_item(Item={"name": "Ada"})
    path = "/api/tables/test_table/items/search"
    result = client.post(path, json={"mode": "query", "partition": {"S": "Ada"}})
    assert result.status_code == 200
    assert result.json()["items"] == [{"name": {"S": "Ada"}}]
    assert client.post(path, json={"mode": "query"}).status_code == 400
    assert client.post(path, json={"limit": 10000}).status_code == 422
    assert (
        client.post(
            path, json={"mode": "query", "partition": {"S": "Ada"}, "sort": {"S": "x"}}
        ).status_code
        == 400
    )


def test_sort_query_and_secondary_index(client, service):
    service.create_table(
        {
            "TableName": "composite_table",
            "KeySchema": [
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "N"},
                {"AttributeName": "category", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
            "GlobalSecondaryIndexes": [
                {
                    "IndexName": "category_idx",
                    "KeySchema": [{"AttributeName": "category", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "KEYS_ONLY"},
                }
            ],
        }
    )
    for i in range(4):
        service.resource.Table("composite_table").put_item(
            Item={"pk": "group", "sk": i, "category": "test", "extra": "retained"}
        )
    path = "/api/tables/composite_table/items/search"
    result = client.post(
        path,
        json={
            "mode": "query",
            "partition": {"S": "group"},
            "sort": {"N": "1"},
            "operator": ">",
            "ascending": False,
        },
    ).json()
    assert [item["sk"]["N"] for item in result["items"]] == ["3", "2"]
    result = client.post(
        path,
        json={"mode": "query", "index": "category_idx", "partition": {"S": "test"}},
    ).json()
    assert len(result["items"]) == 4
    key = {k: result["items"][0][k] for k in ["pk", "sk"]}
    full = client.post(
        "/api/tables/composite_table/items/get", json={"key": key}
    ).json()
    assert full["extra"] == {"S": "retained"}


@pytest.mark.parametrize(
    "filename,content",
    [
        (
            "data.json",
            '[{"name":"Ada","price":0.12345678901234567890123456789012345678}]',
        ),
        ("data.csv", 'name,description\nAda,"two, words"\n'),
        (
            "data.dynamodb.json",
            '[{"name":{"S":"Ada"},"blob":{"B":"aGVsbG8="},"tags":{"SS":["math","code"]},'
            '"nested":{"M":{"numbers":{"NS":["1.1","2.2"]}}}}]',
        ),
    ],
)
def test_import_preview_write_and_export_round_trip(client, filename, content):
    path = "/api/tables/test_table"
    upload = {"filename": filename, "content": content}
    preview = client.post(path + "/imports/preview", json=upload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["count"] == 1
    assert client.post(path + "/items/search", json={}).json()["count"] == 0
    operation = client.post(path + "/imports", json=upload)
    assert operation.status_code == 202
    assert (
        client.get("/api/operations/" + operation.json()["id"]).json()["status"]
        == "completed"
    )
    exported = client.get(path + "/export")
    assert exported.status_code == 200
    assert "test_table.dynamodb.json" in exported.headers["Content-Disposition"]

    def native(rows):
        return [
            {
                key: TypeDeserializer().deserialize(value)
                for key, value in item_from_wire(row).items()
            }
            for row in rows
        ]

    assert native(exported.json()) == native(preview.json()["items"])
    again = client.post(
        path + "/imports/preview",
        json={"filename": "roundtrip.dynamodb.json", "content": exported.text},
    )
    assert again.json()["items"] == exported.json()


@pytest.mark.parametrize(
    "content",
    ['[{"wrong_key":1}]', '[{"name":123}]', "[1]", '{"name":"Ada"}', "not json"],
)
def test_bad_import_does_not_write(client, content):
    response = client.post(
        "/api/tables/test_table/imports",
        json={"filename": "bad.json", "content": content},
    )
    assert response.status_code == 400
    assert (
        client.post("/api/tables/test_table/items/search", json={}).json()["count"] == 0
    )


def test_bad_csv_structure():
    with pytest.raises(ValueError):
        parse_import("bad.csv", "name,score\nAda,1,extra\n")
    with pytest.raises(ValueError):
        parse_import("bad.csv", "name,name\nAda,Ada\n")


@pytest.mark.parametrize(
    "value",
    [
        {"S": 4},
        {"N": 1.5},
        {"NULL": False},
        {"BOOL": "yes"},
        {"B": "not base64"},
        {"NS": []},
    ],
)
def test_invalid_typed_values_are_rejected_at_preview(client, value):
    content = json.dumps([{"name": {"S": "Ada"}, "invalid": value}])
    result = client.post(
        "/api/tables/test_table/imports/preview",
        json={"filename": "bad.dynamodb.json", "content": content},
    )
    assert result.status_code == 400


def test_table_operations_require_confirmation_and_expose_failures(client):
    path = "/api/tables/test_table"
    assert (
        client.post(path + "/purge", json={"confirmation": "wrong"}).status_code == 400
    )
    assert (
        client.request("DELETE", path, json={"confirmation": "wrong"}).status_code
        == 400
    )
    operation = client.post(path + "/purge", json={"confirmation": "test_table"}).json()
    assert (
        client.get("/api/operations/" + operation["id"]).json()["status"] == "completed"
    )
    operation = client.patch(path, json={"definition": {"TableName": "different"}})
    assert operation.status_code == 400
    operation = client.post(
        "/api/tables", json={"definition": {"TableName": "bad_table"}}
    ).json()
    assert client.get("/api/operations/" + operation["id"]).json()["status"] == "failed"
    operation = client.request(
        "DELETE", path, json={"confirmation": "test_table"}
    ).json()
    assert (
        client.get("/api/operations/" + operation["id"]).json()["status"] == "completed"
    )
    assert client.get(path).status_code == 404


def test_mounted_file_import_cannot_escape(client, tmp_path):
    folder = tmp_path / "load/test_table"
    folder.mkdir(parents=True)
    (folder / "people.json").write_text('[{"name":"Ada"}]')
    assert client.get("/api/tables/test_table/files").json()[0]["name"] == "people.json"
    assert (
        client.post(
            "/api/tables/test_table/imports/mounted",
            json={"filename": "../people.json"},
        ).status_code
        == 400
    )
    response = client.post(
        "/api/tables/test_table/imports/mounted", json={"filename": "people.json"}
    )
    assert response.status_code == 202
    assert (
        client.get("/api/operations/" + response.json()["id"]).json()["status"]
        == "completed"
    )


def test_decimal_precision_is_preserved_in_plain_import():
    result = parse_import(
        "numbers.json", '[{"value":0.12345678901234567890123456789012345678}]'
    )
    assert Decimal(result[0]["value"]["N"]) == Decimal(
        "0.12345678901234567890123456789012345678"
    )


def test_export_paginates(service, monkeypatch):
    console = ConsoleService()
    calls = []

    def scan(**kwargs):
        calls.append(kwargs)
        if "ExclusiveStartKey" not in kwargs:
            return {
                "Items": [{"name": {"S": "Ada"}}],
                "LastEvaluatedKey": {"name": {"S": "Ada"}},
            }
        return {"Items": [{"name": {"S": "Grace"}}]}

    monkeypatch.setattr(console.client, "scan", scan)
    assert len(json.loads("".join(console.export("test_table")))) == 2
    assert calls[1]["ExclusiveStartKey"] == {"name": {"S": "Ada"}}


def test_operation_history_keeps_active_jobs_and_logs_writes_when_queue_is_full():
    store = OperationStore()
    try:
        queued = [store.record("Import", "test_table", "queued") for _ in range(10)]
        with pytest.raises(ValueError, match="queue is full"):
            store.record("Import", "test_table", "queued")
        for _ in range(110):
            store.record("Edit item", "test_table")
        assert len(store.list()) == 100
        assert {row["id"] for row in store.list()} >= {row["id"] for row in queued}
    finally:
        store._executor.shutdown()


def test_console_page_and_write_origin_protection(service):
    from app.main import app

    with TestClient(app) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert "Your local data workspace" in page.text
        assert "frame-ancestors 'none'" in page.headers["Content-Security-Policy"]
        assert client.get("/static/app.js").status_code == 200
        result = client.put(
            "/api/tables/test_table/items",
            json={"item": {"name": {"S": "Ada"}}},
            headers={"Origin": "https://untrusted.example"},
        )
        assert result.status_code == 403
        assert service.resource.Table("test_table").scan()["Count"] == 0
