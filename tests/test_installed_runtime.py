import json
import os
import sqlite3

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import host_runtime
from app.main import app
from app.user_state import Definition, StateStore

KEY = 'dynamodb-tools.saved-queries.v1:["123456789012","eu-west-2","people"]'


def test_workspace_survives_upgrade_and_rejects_stale_writer(tmp_path):
    store = StateStore(tmp_path)
    written = store.write(Definition(key=KEY, value="[]", revision=0))
    assert written["revision"] == 1
    upgraded = StateStore(tmp_path)
    assert upgraded.read()[KEY] == written
    with pytest.raises(HTTPException) as error:
        upgraded.write(Definition(key=KEY, value='[{"name":"stale"}]', revision=0))
    assert error.value.status_code == 409
    assert upgraded.read()[KEY]["value"] == "[]"
    if os.name != "nt":
        assert (tmp_path / "workspace.sqlite3").stat().st_mode & 0o077 == 0


def test_future_or_corrupt_workspace_is_never_replaced(tmp_path):
    store = StateStore(tmp_path)
    store.write(Definition(key=KEY, value="[]", revision=0))
    with sqlite3.connect(store.path) as db:
        db.execute("PRAGMA user_version=99")
    with pytest.raises(ValueError, match="newer"):
        StateStore(tmp_path)
    with sqlite3.connect(store.path) as db:
        assert db.execute("SELECT value FROM definitions").fetchone()[0] == "[]"
    store.path.write_bytes(b"broken original")
    with pytest.raises(sqlite3.DatabaseError):
        StateStore(tmp_path)
    assert store.path.read_bytes() == b"broken original"


@pytest.mark.parametrize(
    "key", ["aws_secret_access_key", "../connection.json", KEY + ":invalid"]
)
def test_only_scoped_definitions_are_storable(key):
    with pytest.raises(ValidationError):
        Definition(key=key, value="[]", revision=0)


def test_installed_api_auth_host_and_aws_read_only(monkeypatch, tmp_path):
    from app.config import settings

    monkeypatch.setattr(host_runtime, "session_token", "a" * 43)
    monkeypatch.setattr(host_runtime, "host", "127.0.0.1:19421")
    monkeypatch.setattr(host_runtime, "state_directory", tmp_path)
    monkeypatch.setattr(settings, "dynamodb_mode", "aws")
    monkeypatch.setattr(settings, "read_only", True)
    client = TestClient(app, base_url="http://127.0.0.1:19421")
    for path in [
        "/api/local",
        "/api/connection",
        "/health",
        "/tables",
        "/openapi.json",
    ]:
        assert client.get(path).status_code == 401
    assert client.get("/").status_code == 200
    headers = {"Authorization": "Bearer " + "a" * 43}
    assert (
        client.get(
            "/api/local", headers={**headers, "Host": "evil.example"}
        ).status_code
        == 403
    )
    assert client.get("/api/local", headers=headers).json()["installed"]
    assert (
        "/api/local/definition"
        in client.get("/api/local/openapi", headers=headers).json()["paths"]
    )
    saved = client.put(
        "/api/local/definition",
        headers=headers,
        json={"key": KEY, "value": "[]", "revision": 0},
    )
    assert saved.status_code == 200
    assert (
        client.put(
            "/api/local/definition",
            headers={**headers, "Origin": "https://evil.example"},
            json={"key": KEY, "value": "[]", "revision": 1},
        ).status_code
        == 403
    )
    assert client.delete("/api/tables/example", headers=headers).status_code == 403
    assert (
        client.get("/api/local", headers=headers).json()["definitions"][KEY]["revision"]
        == 1
    )
    assert "a" * 43 not in json.dumps(client.get("/health", headers=headers).json())
