from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError
from botocore.stub import Stubber
from fastapi.testclient import TestClient

from app import connection, console_api
from app.config import settings
from app.console_service import ConsoleService
from app.main import app


def test_discovery_paginates_and_keeps_tables_with_restricted_details(service):
    console = ConsoleService()
    with Stubber(console.client) as stub:
        stub.add_response(
            "list_tables",
            {"TableNames": ["alpha"], "LastEvaluatedTableName": "alpha"},
            {},
        )
        stub.add_response(
            "list_tables",
            {"TableNames": ["bravo", "charlie"]},
            {"ExclusiveStartTableName": "alpha"},
        )
        stub.add_response(
            "describe_table",
            {"Table": {"TableName": "alpha", "TableStatus": "ACTIVE"}},
            {"TableName": "alpha"},
        )
        stub.add_client_error(
            "describe_table",
            "AccessDeniedException",
            expected_params={"TableName": "bravo"},
        )
        stub.add_client_error(
            "describe_table",
            "ResourceNotFoundException",
            expected_params={"TableName": "charlie"},
        )
        tables = console.tables()
        assert [t["TableName"] for t in tables] == ["alpha", "bravo", "charlie"]
        assert tables[0]["TableStatus"] == "ACTIVE"
        assert tables[1]["metadataUnavailable"]
        assert "not permitted" in tables[1]["accessMessage"]
        assert "no longer" in tables[2]["accessMessage"]
        assert console.discovery_error is None
        stub.assert_no_pending_responses()


def test_listing_denied_preserves_connection_and_direct_table_access(
    service, monkeypatch
):
    console = ConsoleService()
    paginator = MagicMock()
    paginator.paginate.side_effect = ClientError(
        {"Error": {"Code": "AccessDeniedException"}}, "ListTables"
    )
    monkeypatch.setattr(console.client, "get_paginator", lambda name: paginator)
    monkeypatch.setattr(console_api, "ConsoleService", lambda: console)
    with TestClient(app) as http:
        overview = http.get("/api/overview")
        assert overview.status_code == 200
        assert overview.json()["tables"] == []
        assert "known table name" in overview.json()["tableDiscoveryWarning"]
        assert http.get("/api/tables/test_table").status_code == 200


@pytest.mark.parametrize("operation", ["list_tables", "describe_table"])
def test_authentication_errors_are_not_hidden_as_permission_restrictions(
    service, operation
):
    console = ConsoleService()
    with Stubber(console.client) as stub:
        if operation == "describe_table":
            stub.add_response("list_tables", {"TableNames": ["alpha"]})
        stub.add_client_error(operation, "UnrecognizedClientException")
        with pytest.raises(ClientError):
            console.tables()


def test_connection_can_be_saved_without_list_permission(
    service, monkeypatch, tmp_path
):
    from app import connection_api

    monkeypatch.setattr(settings, "dynamodb_mode", "aws")
    database = connection.client()
    monkeypatch.setattr(
        connection_api.connection, "client", lambda *args, **kwargs: database
    )
    monkeypatch.setattr(
        connection_api.connection,
        "connection_info",
        lambda *args: {"account": "123456789012", "region": "us-east-1"},
    )
    with Stubber(database) as stub:
        for _ in range(2):
            stub.add_client_error(
                "list_tables", "AccessDeniedException", expected_params={"Limit": 1}
            )
        with TestClient(app) as http:
            payload = {"dynamodb_mode": "aws", "read_only": True}
            tested = http.post("/api/connection/test", json=payload)
            assert tested.status_code == 200
            assert "listing tables" in tested.json()["tableDiscoveryWarning"]
            assert not (tmp_path / "connection.json").exists()
            saved = http.put("/api/connection", json=payload)
            assert saved.status_code == 200
            assert (tmp_path / "connection.json").exists()
