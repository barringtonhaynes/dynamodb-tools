from copy import deepcopy
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import settings
from app.main import app
from app.query_planner import Condition, PlanRequest, plan_access


def rule(attribute, value, operator="=", kind="S", **extra):
    return {
        "attribute": attribute,
        "operator": operator,
        "value": {kind: value},
        **extra,
    }


@pytest.fixture
def table():
    return {
        "TableName": "orders",
        "KeySchema": [
            {"AttributeName": "pk", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": name, "AttributeType": "S"}
            for name in ["pk", "sk", "customer", "createdAt", "status", "openCustomer"]
        ],
        "GlobalSecondaryIndexes": [
            {
                "IndexName": "by_customer",
                "KeySchema": [
                    {"AttributeName": "customer", "KeyType": "HASH"},
                    {"AttributeName": "createdAt", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
                "IndexStatus": "ACTIVE",
            },
            {
                "IndexName": "by_status",
                "KeySchema": [{"AttributeName": "status", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "KEYS_ONLY"},
                "IndexStatus": "ACTIVE",
            },
            {
                "IndexName": "open_orders",
                "KeySchema": [{"AttributeName": "openCustomer", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
                "IndexStatus": "ACTIVE",
            },
        ],
        "LocalSecondaryIndexes": [
            {
                "IndexName": "by_date",
                "KeySchema": [
                    {"AttributeName": "pk", "KeyType": "HASH"},
                    {"AttributeName": "createdAt", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "KEYS_ONLY"},
            }
        ],
    }


def plans(table, **kwargs):
    return plan_access(table, PlanRequest(**kwargs))


def test_filter_moves_to_index_key_without_a_scan(table):
    result = plans(
        table,
        conditions=[
            rule("customer", "c1"),
            rule("createdAt", "2026-09", "begins_with"),
            rule("status", "OPEN"),
        ],
    )
    base, gsi = result["candidates"][:2]
    assert base["request"] is None
    assert "equality" in base["blockers"][0]
    assert gsi["keyConditions"] == ["customer", "createdAt"]
    assert gsi["filterAttributes"] == ["status"]
    assert gsi["request"]["mode"] == "query"
    assert gsi["request"]["filters"] == [rule("status", "OPEN")]
    assert (
        gsi["awsRequest"]["KeyConditionExpression"]
        == "#pk = :pk AND begins_with(#sk, :sk)"
    )
    assert gsi["awsRequest"]["FilterExpression"] == "(#f0 = :f0)"


def test_sparse_coverage_requires_explicit_acceptance(table):
    args = {"conditions": [rule("customer", "c1")]}
    gsi = plans(table, **args)["candidates"][1]
    assert gsi["request"] is None
    assert any("omit matching items" in b for b in gsi["blockers"])
    assert plans(table, **args, allowSparse=True)["candidates"][1]["request"]
    args["conditions"].append({"attribute": "createdAt", "operator": "exists"})
    gsi = plans(table, **args)["candidates"][1]
    assert gsi["request"]
    assert gsi["request"]["filters"] == []
    assert "FilterExpression" not in gsi["awsRequest"]


def test_gsi_projection_and_consistency_are_not_silently_changed(table):
    args = {"conditions": [rule("status", "OPEN")], "projection": ["total"]}
    gsi = plans(table, **args)["candidates"][2]
    assert gsi["request"] is None
    assert any("Not projected" in text for text in gsi["blockers"])
    args["projection"] = ["pk", "sk"]
    assert plans(table, **args)["candidates"][2]["request"]
    assert plans(table, **args, consistent=True)["candidates"][2]["request"] is None
    args["projection"] = []
    assert plans(table, **args)["candidates"][2]["request"] is None


def test_lsi_fetch_explained_and_requested_sort_enforced(table):
    args = {
        "conditions": [rule("pk", "c1"), rule("createdAt", "2026", "begins_with")],
        "projection": ["total"],
        "consistent": True,
        "orderBy": "createdAt",
    }
    result = plans(table, **args)
    assert result["candidates"][0]["request"] is None
    lsi = result["candidates"][-1]
    assert lsi["request"]["consistent"]
    assert any("LSI must fetch" in message for message in lsi["warnings"])


def test_invalid_key_types_status_and_native_multikey_are_blocked(table):
    assert (
        plans(table, conditions=[rule("pk", "1", kind="N")])["candidates"][0]["request"]
        is None
    )
    table["GlobalSecondaryIndexes"][0]["IndexStatus"] = "CREATING"
    assert (
        plans(table, conditions=[rule("customer", "c1")], allowSparse=True)[
            "candidates"
        ][1]["request"]
        is None
    )
    table["GlobalSecondaryIndexes"][0]["KeySchema"].append(
        {"AttributeName": "status", "KeyType": "HASH"}
    )
    result = plans(
        table,
        conditions=[rule("customer", "c1"), rule("status", "OPEN")],
        allowSparse=True,
    )
    assert "Multi-attribute" in result["candidates"][1]["blockers"][0]


@pytest.mark.parametrize("value", ["", "x" * 2049])
def test_invalid_partition_length_is_blocked(table, value):
    assert (
        plans(table, conditions=[rule("pk", value)])["candidates"][0]["request"] is None
    )


@pytest.mark.parametrize(
    "condition",
    [
        rule("sk", "2", "begins_with", "N"),
        rule("sk", "2", "between", "N", end={"N": "1"}),
        rule("sk", "1", "between", "N", end={"S": "2"}),
        rule("pk", "not-a-number", kind="N"),
        rule("pk", "not base64", kind="B"),
    ],
)
def test_invalid_scalar_conditions_rejected(condition):
    with pytest.raises((ValidationError, ValueError)):
        Condition(**condition)


def test_numbers_and_binary_are_lossless_and_names_are_aliased(table):
    table["AttributeDefinitions"][0]["AttributeType"] = "N"
    table["AttributeDefinitions"][1]["AttributeType"] = "B"
    result = plans(
        table,
        conditions=[
            rule("pk", "9007199254740993123456789", kind="N"),
            rule("sk", "YQ==", "begins_with", "B"),
            rule("literal.dot", "value"),
        ],
        projection=["order", "literal.dot"],
    )
    query = result["candidates"][0]["awsRequest"]
    assert query["ExpressionAttributeValues"][":pk"] == {
        "N": "9007199254740993123456789"
    }
    assert query["ExpressionAttributeValues"][":sk"] == {"B": "YQ=="}
    assert "literal.dot" in query["ExpressionAttributeNames"].values()
    assert "literal.dot" not in query["FilterExpression"]


def test_duplicate_conditions_are_rejected():
    with pytest.raises(ValidationError, match="one condition"):
        PlanRequest(conditions=[rule("pk", "a"), rule("pk", "b")])


def test_draft_is_a_design_not_an_update_request_and_suggests_reuse(table):
    result = plans(
        table,
        conditions=[
            rule("customer", "c1"),
            rule("createdAt", "2026", "begins_with"),
            rule("status", "OPEN"),
        ],
        draftPartition="customer",
        draftSort="createdAt",
        projection=["total"],
    )
    proposal = result["proposal"]
    assert proposal["reuse"] == ["by_customer"]
    assert proposal["definition"]["Projection"]["NonKeyAttributes"] == [
        "status",
        "total",
    ]
    assert "GlobalSecondaryIndexUpdates" not in proposal["definition"]
    assert "ProvisionedThroughput" not in proposal["definition"]


def test_planning_endpoint_is_read_only_and_calls_only_describe(monkeypatch, table):
    client = Mock()
    client.describe_table.return_value = {"Table": table}
    monkeypatch.setattr("app.console_service.client", lambda: client)
    monkeypatch.setattr(settings, "dynamodb_mode", "aws")
    monkeypatch.setattr(settings, "read_only", True)
    response = TestClient(app).post(
        "/api/tables/orders/query-plan", json={"conditions": [rule("pk", "c1")]}
    )
    assert response.status_code == 200, response.text
    assert client.method_calls == [("describe_table", (), {"TableName": "orders"})]


def test_suggested_plan_minimises_filters_without_mutating_inputs(table):
    original = deepcopy(table)
    result = plans(
        table,
        conditions=[
            rule("pk", "c1"),
            rule("sk", "ORDER#", "begins_with"),
            rule("status", "OPEN"),
        ],
        projection=["pk", "sk", "status"],
    )
    assert result["suggested"] == result["candidates"][0]["id"]
    assert table == original
