from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import connection, startup_tasks
from app.config import Settings, settings
from app.console_api import router
from app.console_service import ConsoleService


def test_aws_defaults_and_startup_are_non_mutating(monkeypatch):
    configured = Settings(dynamodb_mode="aws")
    assert configured.is_read_only
    assert not any(
        v
        for k, v in configured.effective_settings().items()
        if k.endswith("_on_startup")
    )
    monkeypatch.setattr(settings, "dynamodb_mode", "aws")
    monkeypatch.setattr(settings, "read_only", False)
    constructor = MagicMock(side_effect=AssertionError("Startup must not contact AWS"))
    monkeypatch.setattr(startup_tasks, "TableService", constructor)
    startup_tasks._run_startup_tasks()
    assert startup_tasks.get_startup_tasks_status() == "finished"
    constructor.assert_not_called()


def test_profile_and_service_specific_endpoints(monkeypatch):
    monkeypatch.setattr(settings, "dynamodb_mode", "aws")
    monkeypatch.setattr(settings, "aws_profile", "sso-development")
    constructor = MagicMock()
    monkeypatch.setattr(connection.boto3, "Session", constructor)
    for service in ["dynamodb", "dynamodbstreams", "sts"]:
        connection.client(service)
        constructor.assert_called_with(profile_name="sso-development")
        args, kwargs = constructor.return_value.client.call_args
        assert args == (service,) and kwargs["endpoint_url"] is None
        assert kwargs["config"].ignore_configured_endpoint_urls is True
    constructor.return_value.events.register.assert_called_with(
        "before-parameter-build", connection.guard_operation
    )


def test_local_defaults_do_not_need_aws_credentials(monkeypatch):
    for key in ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]:
        monkeypatch.delenv(key, raising=False)
    constructor = MagicMock()
    monkeypatch.setattr(connection.boto3, "Session", constructor)
    connection.client()
    assert constructor.call_args.kwargs["aws_access_key_id"] == "localaccesskey"
    assert (
        constructor.return_value.client.call_args.kwargs["endpoint_url"]
        == settings.dynamodb_endpoint_url
    )


@pytest.mark.parametrize(
    "operation,params",
    [
        ("PutItem", {}),
        ("DeleteTable", {}),
        ("BatchWriteItem", {}),
        ("TransactWriteItems", {}),
        ("UpdateTable", {}),
        ("UpdateTimeToLive", {}),
        ("ExecuteStatement", {"Statement": "UPDATE t SET x=1"}),
        ("BatchExecuteStatement", {"Statements": [{"Statement": "SELECT * FROM t"}]}),
    ],
)
def test_read_only_sdk_guard_rejects_mutations(monkeypatch, operation, params):
    monkeypatch.setattr(settings, "read_only", True)
    with pytest.raises(PermissionError, match="read-only"):
        connection.guard_operation(SimpleNamespace(name=operation), params)


def test_guard_allows_reads_and_explicit_write_opt_in(monkeypatch):
    monkeypatch.setattr(settings, "read_only", True)
    for operation in ["Scan", "Query", "GetRecords", "GetCallerIdentity"]:
        connection.guard_operation(SimpleNamespace(name=operation), {})
    connection.guard_operation(
        SimpleNamespace(name="ExecuteStatement"), {"Statement": " select * from t"}
    )
    monkeypatch.setattr(settings, "read_only", False)
    connection.guard_operation(SimpleNamespace(name="PutItem"), {})


def test_read_only_is_enforced_by_real_sdk_client(service, monkeypatch):
    monkeypatch.setattr(settings, "read_only", True)
    client = ConsoleService().client
    assert client.scan(TableName="test_table")["Items"] == []
    with pytest.raises(PermissionError):
        client.put_item(TableName="test_table", Item={"name": {"S": "blocked"}})
    with pytest.raises(PermissionError):
        connection.resource().Table("test_table").put_item(Item={"name": "blocked"})


def test_http_gate_blocks_queued_and_legacy_writes_but_allows_reads(
    service, monkeypatch
):
    from app.main import app

    monkeypatch.setattr(settings, "read_only", True)
    # Avoid lifespan writes; this also exercises the read-only startup branch.
    with TestClient(app) as client:
        for method, path, body in [
            ("POST", "/api/tables", {"definition": {}}),
            ("POST", "/tables/test_table/data/file.json", {}),
            ("POST", "/api/tables/test_table/items/delete-selected", {}),
            ("PUT", "/api/tables/test_table/streams", {}),
            ("PATCH", "/api/tables/test_table", {}),
        ]:
            assert client.request(method, path, json=body).status_code == 403
        assert (
            client.post("/api/tables/test_table/items/search", json={}).status_code
            == 200
        )
        assert (
            client.post(
                "/api/items/convert", json={"text": '{"x":{"S":"hi"}}'}
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/api/partiql",
                json={
                    "statement": "DELETE FROM test_table WHERE name='x'",
                    "allowWrite": True,
                },
            ).status_code
            == 403
        )


def test_aws_identity_visible_without_credentials(service, monkeypatch):
    monkeypatch.setattr(settings, "dynamodb_mode", "aws")
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        result = client.get("/api/overview")
        assert result.status_code == 200, result.text
        info = result.json()["connection"]
        assert info["account"] == "123456789012"
        assert info["mode"] == "aws" and info["readOnly"] is True
        assert info["endpoint"].startswith("https://dynamodb.")
        assert "secret" not in str(info).lower()


@pytest.mark.parametrize(
    "service_name, operation",
    [
        ("sts", "AssumeRole"),
        ("sts", "AssumeRoleWithWebIdentity"),
        ("sso", "GetRoleCredentials"),
        ("sso-oidc", "CreateToken"),
    ],
)
def test_read_only_does_not_block_credential_refresh(
    monkeypatch, service_name, operation
):
    monkeypatch.setattr(settings, "read_only", True)
    connection.guard_operation(
        SimpleNamespace(
            name=operation, service_model=SimpleNamespace(service_name=service_name)
        ),
        {},
    )


def test_aws_blank_preferences_use_sdk_defaults(monkeypatch):
    monkeypatch.setattr(settings, "dynamodb_mode", "aws")
    constructor = MagicMock()
    monkeypatch.setattr(connection.boto3, "Session", constructor)
    connection.session()
    constructor.assert_called_once_with()


def test_saved_connection_is_tested_atomic_and_survives_restart(
    service, monkeypatch, tmp_path
):
    import json
    import os
    import subprocess
    import sys

    from app import connection_api
    from app.main import app

    probe = MagicMock(
        return_value={"mode": "aws", "account": "123456789012", "readOnly": True}
    )
    monkeypatch.setattr(connection_api, "probe", probe)
    old_revision = connection.connection_revision
    preferences = {
        "dynamodb_mode": "aws",
        "aws_profile": None,
        "aws_region": None,
        "read_only": True,
    }
    with TestClient(app) as http:
        tested = http.post("/api/connection/test", json=preferences)
        assert tested.status_code == 200
        assert settings.dynamodb_mode == "local"
        assert not (tmp_path / "connection.json").exists()
        saved = http.put("/api/connection", json=preferences)
        assert saved.status_code == 200, saved.text
        assert settings.dynamodb_mode == "aws" and settings.is_read_only
        assert saved.json()["id"] != old_revision
        assert (
            http.post(
                "/api/tables/test_table/items/search",
                json={},
                headers={"X-Connection-Id": old_revision},
            ).status_code
            == 409
        )
        assert (
            http.put(
                "/api/connection",
                json=preferences,
                headers={"X-Connection-Id": old_revision},
            ).status_code
            == 409
        )
    content = json.loads((tmp_path / "connection.json").read_text())
    assert content["aws_profile"] is None and "aws_access_key_id" not in content
    run = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.config import settings; print(settings.dynamodb_mode, settings.connection_saved, settings.is_read_only)",
        ],
        env={
            **os.environ,
            "CONNECTION_SETTINGS_PATH": str(tmp_path / "connection.json"),
            "DYNAMODB_MODE": "local",
        },
        text=True,
        capture_output=True,
        check=True,
    )
    assert run.stdout.strip() == "aws True True"


def test_connection_failure_preserves_current_settings(service, monkeypatch, tmp_path):
    from app import connection_api
    from app.main import app

    monkeypatch.setattr(
        connection_api, "probe", MagicMock(side_effect=ValueError("Sign-in failed"))
    )
    old = settings.model_dump()
    with TestClient(app) as http:
        assert (
            http.put("/api/connection", json={"dynamodb_mode": "aws"}).status_code
            == 400
        )
        assert (
            http.put(
                "/api/connection", json={"aws_access_key_id": "never-store-this"}
            ).status_code
            == 422
        )
    assert settings.model_dump() == old
    assert not (tmp_path / "connection.json").exists()


def test_connection_switch_waits_for_background_work(service, monkeypatch):
    from app import main

    monkeypatch.setattr(main.operations, "list", lambda: [{"status": "running"}])
    with TestClient(main.app) as http:
        response = http.put("/api/connection", json={"dynamodb_mode": "aws"})
        assert response.status_code == 409
        assert settings.dynamodb_mode == "local"


def test_invalid_aws_token_has_actionable_auth_error(service, monkeypatch):
    from botocore.exceptions import ClientError

    from app import connection_api
    from app.main import app

    monkeypatch.setattr(
        connection_api,
        "probe",
        MagicMock(
            side_effect=ClientError(
                {
                    "Error": {
                        "Code": "InvalidClientTokenId",
                        "Message": "The security token included in the request is invalid.",
                    }
                },
                "GetCallerIdentity",
            )
        ),
    )
    with TestClient(app) as http:
        result = http.post("/api/connection/test", json={"dynamodb_mode": "aws"})
        assert result.status_code == 401
        assert "Refresh your AWS sign-in" in result.json()["detail"]
