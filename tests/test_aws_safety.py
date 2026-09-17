from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import aws_safety, connection
from app.config import settings
from app.main import app


@pytest.fixture
def aws_http(service, monkeypatch):
    monkeypatch.setattr(settings, "dynamodb_mode", "aws")
    monkeypatch.setattr(settings, "read_only", False)
    monkeypatch.setattr(aws_safety, "challenges", {})
    clock = [1000.0]
    monkeypatch.setattr(aws_safety, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    with TestClient(app) as http:
        yield http, clock


def approval(response):
    assert response.status_code == 428, response.text
    prompt = response.json()["awsConfirmation"]
    assert prompt["account"] == "123456789012"
    return {
        "X-AWS-Challenge": prompt["token"],
        "X-AWS-Confirmation": prompt["phrase"],
    }


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("POST", "/api/tables", {"definition": {"TableName": "new_table"}}),
        ("PATCH", "/api/tables/test_table", {"definition": {}}),
        ("DELETE", "/api/tables/test_table", {"confirmation": "test_table"}),
        ("POST", "/api/tables/test_table/purge", {"confirmation": "test_table"}),
        ("PUT", "/api/tables/test_table/items", {"item": {"name": {"S": "safe"}}}),
        ("DELETE", "/api/tables/test_table/items", {"key": {"name": {"S": "safe"}}}),
        ("POST", "/api/tables/test_table/items/delete-selected", {}),
        ("PUT", "/api/tables/test_table/streams", {}),
        ("PUT", "/api/tables/test_table/ttl", {}),
        ("POST", "/api/tables/test_table/imports", {}),
        ("POST", "/api/tables/test_table/imports/mounted", {}),
        ("POST", "/tables/test_table/data/example.json", {}),
        (
            "POST",
            "/api/partiql",
            {"statement": 'DELETE FROM "test_table" WHERE name=?', "confirm": True},
        ),
    ],
)
def test_every_aws_write_is_blocked_before_dispatch(aws_http, method, path, body):
    http, _ = aws_http
    headers = approval(http.request(method, path, json=body))
    assert "test_table" in headers["X-AWS-Confirmation"] or path in {
        "/api/partiql",
        "/api/tables",
    }
    assert connection.client().scan(TableName="test_table")["Count"] == 0
    assert connection.client().describe_table(TableName="test_table")


def test_exact_write_requires_delay_then_runs_once(aws_http):
    http, clock = aws_http
    path = "/api/tables/test_table/items"
    body = {"item": {"name": {"S": "approved"}}}
    headers = approval(http.put(path, json=body))
    assert http.put(path, json=body, headers=headers).status_code == 409
    clock[0] += 6
    wrong = {**headers, "X-AWS-Confirmation": "yes"}
    assert http.put(path, json=body, headers=wrong).status_code == 409
    result = http.put(path, json=body, headers=headers)
    assert result.status_code == 200, result.text
    assert connection.client().scan(TableName="test_table")["Count"] == 1
    assert http.put(path, json=body, headers=headers).status_code == 409


@pytest.mark.parametrize(
    "changed", ["body", "path", "query", "revision", "identity", "expired"]
)
def test_approval_cannot_authorize_another_request(aws_http, monkeypatch, changed):
    http, clock = aws_http
    path = "/api/tables/test_table/items"
    body = {"item": {"name": {"S": "approved"}}}
    headers = approval(http.put(path, json=body))
    clock[0] += 6
    if changed == "body":
        body["item"]["name"]["S"] = "different"
    elif changed == "path":
        path = "/api/tables/another_table/items"
    elif changed == "query":
        path += "?different=true"
    elif changed == "revision":
        monkeypatch.setattr(connection, "connection_revision", "changed")
    elif changed == "identity":
        original = connection.connection_info
        monkeypatch.setattr(
            connection,
            "connection_info",
            lambda client: {**original(client), "account": "999999999999"},
        )
    else:
        clock[0] += 120
    assert http.put(path, json=body, headers=headers).status_code == 409
    assert connection.client().scan(TableName="test_table")["Count"] == 0


def test_reads_and_preferences_do_not_need_write_approval(aws_http):
    http, _ = aws_http
    for method, path, body in [
        ("GET", "/api/connection", None),
        ("POST", "/api/tables/test_table/items/search", {}),
        ("POST", "/api/partiql", {"statement": 'SELECT * FROM "test_table"'}),
    ]:
        result = http.request(method, path, json=body)
        assert result.status_code == 200, result.text
    assert not aws_safety.challenges


def test_read_only_cannot_be_unlocked_by_confirmation(aws_http, monkeypatch):
    http, clock = aws_http
    body = {"item": {"name": {"S": "approved"}}}
    headers = approval(http.put("/api/tables/test_table/items", json=body))
    clock[0] += 6
    monkeypatch.setattr(settings, "read_only", True)
    assert (
        http.put("/api/tables/test_table/items", json=body, headers=headers).status_code
        == 403
    )
    assert (
        http.post(
            "/api/partiql", json={"statement": 'DELETE FROM "test_table" WHERE name=?'}
        ).status_code
        == 403
    )


def test_unverified_identity_fails_closed(aws_http, monkeypatch):
    from botocore.exceptions import NoCredentialsError

    http, _ = aws_http

    def unavailable(client):
        raise NoCredentialsError()

    monkeypatch.setattr(connection, "connection_info", unavailable)
    result = http.delete("/api/tables/test_table")
    assert result.status_code == 503
    assert not aws_safety.challenges
