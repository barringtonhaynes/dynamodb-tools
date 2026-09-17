import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.console_api import router
from app.editor_codec import convert_item
from app.item_insights import attribute_size, check_contract, item_metrics, table_checks
from app.model_insights import inspect_model

TABLE = {
    "AttributeDefinitions": [
        {"AttributeName": k, "AttributeType": "S"} for k in ("pk", "sk", "openKey")
    ],
    "KeySchema": [
        {"AttributeName": "pk", "KeyType": "HASH"},
        {"AttributeName": "sk", "KeyType": "RANGE"},
    ],
    "GlobalSecondaryIndexes": [
        {
            "IndexName": "open_orders",
            "KeySchema": [
                {"AttributeName": "openKey", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
        }
    ],
}
ITEM = {
    "pk": {"S": "CUSTOMER#123"},
    "sk": {"S": "ORDER#1"},
    "entityType": {"S": "Order"},
}


def test_size_uses_utf8_decoded_binary_and_nested_overhead():
    assert (
        item_metrics({"shirt-color": {"S": "R"}, "shirt-size": {"S": "M"}})[
            "estimatedBytes"
        ]
        == 23
    )
    assert attribute_size({"S": "é🐍"}) == 6
    assert attribute_size({"B": "AAEC/w=="}) == 4
    assert attribute_size({"M": {"é": {"L": [{"BOOL": True}, {"NULL": True}]}}}) == 13
    assert attribute_size({"SS": ["é", "abc"]}) == 5
    assert attribute_size({"NS": ["1000000", "12.345"]}) == 6
    assert attribute_size({"BS": ["YQ==", "Yg=="]}) == 2
    assert attribute_size({"N": "12345678901234567890123456789012345678"}) == 20
    assert item_metrics({"b": {"B": "AAEC/w=="}})["jsonBytes"] > 5


def test_index_membership_and_key_schema_violations():
    assert table_checks(ITEM, TABLE)["indexes"][0]["status"] == "excluded"
    assert (
        table_checks({**ITEM, "openKey": {"S": "OPEN"}}, TABLE)["indexes"][0]["status"]
        == "included"
    )
    for value in ({"S": ""}, {"N": "2"}, {"S": "é" * 1025}):
        checks = table_checks({**ITEM, "openKey": value}, TABLE)
        assert checks["errors"] and checks["indexes"][0]["status"] == "invalid"
    assert "required" in table_checks({"sk": {"S": "a"}}, TABLE)["errors"][0]
    assert "1024" in table_checks({**ITEM, "sk": {"S": "é" * 513}}, TABLE)["errors"][0]


def test_model_groups_entities_prefixes_sparse_coverage_and_queries():
    items = [
        ITEM,
        {**ITEM, "sk": {"S": "ORDER#2"}, "openKey": {"S": "OPEN"}},
        {"pk": {"S": "CUSTOMER#123"}, "sk": {"S": "PROFILE"}},
    ]
    result = inspect_model(items, TABLE)
    assert result["count"] == 3
    assert result["entities"][0]["name"] == "Order"
    assert result["entities"][0]["attributes"]["openKey"]["count"] == 1
    assert result["partitions"][0]["count"] == 3
    assert result["partitions"][0]["prefixes"] == ["ORDER#"]
    assert result["indexes"][0]["included"] == 1
    assert result["indexes"][0]["excluded"] == 2
    assert result["indexes"][0]["examples"] == [{"S": "OPEN"}]
    assert inspect_model([], TABLE)["count"] == 0


def test_contract_uses_exact_numbers_and_entity_conditions():
    item = {**ITEM, "total": {"N": "9007199254740993"}}
    schema = (
        '{"type":"object","required":["entityType"],"properties":'
        '{"total":{"type":"integer","minimum":9007199254740993},'
        '"entityType":{"type":"string","minLength":1}},'
        '"if":{"properties":{"entityType":{"const":"Order"}}},'
        '"then":{"required":["total"]}}'
    )
    assert check_contract(item, schema) == []
    assert "total" in check_contract(ITEM, schema)[0]
    assert check_contract({**item, "total": {"N": "9007199254740992"}}, schema)
    assert (
        check_contract({"n": {"N": "0.3"}}, '{"properties":{"n":{"multipleOf":0.1}}}')
        == []
    )
    assert check_contract(item, "false")
    for schema in (
        '{"$ref":"http://localhost/private"}',
        '{"properties":{"x":{"$ref":"#/$defs/x"}}}',
        '{"type":"nonsense"}',
        "[]",
    ):
        with pytest.raises(ValueError):
            check_contract(item, schema)


def test_depth_and_oversized_draft_diagnostics():
    attr = {"S": "x"}
    for _ in range(33):
        attr = {"L": [attr]}
    with pytest.raises(ValueError, match="32 nested"):
        convert_item(json.dumps({"deep": attr}), "ddb")
    result = convert_item(json.dumps({"large": {"S": "x" * (400 * 1024)}}), "ddb")
    assert result["warnings"]


def test_api_sizes_contract_enforcement_and_bounded_model(service):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        item = {"name": {"S": "person"}, "value": {"N": "123"}}
        response = client.put("/api/tables/test_table/items", json={"item": item})
        assert response.status_code == 200, response.text
        assert response.json()["metrics"]["estimatedBytes"] > 0
        assert "capacity" in response.json()
        page = client.post("/api/tables/test_table/items/search", json={}).json()
        assert page["returnedBytes"] == sum(page["itemBytes"])
        read = client.post(
            "/api/tables/test_table/items/get",
            json={"key": {"name": {"S": "person"}}, "includeMetrics": True},
        ).json()
        assert (
            read["item"] == item
            and read["metrics"]["estimatedBytes"] == page["returnedBytes"]
        )
        bad = client.post(
            "/api/items/convert",
            json={"text": '{"value":2}', "view": "json", "table": "test_table"},
        ).json()
        assert bad["checks"]["errors"]
        assert (
            client.put(
                "/api/tables/test_table/items",
                json={"item": item, "itemSchema": '{"required":["missing"]}'},
            ).status_code
            == 400
        )
        sample = client.post("/api/tables/test_table/model", json={"limit": 1}).json()
        assert sample["count"] == 1 and sample["entities"]
        assert (
            client.post("/api/tables/test_table/model", json={"limit": 101}).status_code
            == 422
        )


def test_schema_integer_and_multiple_of_keep_large_values_exact():
    assert (
        check_contract(
            {"n": {"N": "1E+100"}}, '{"properties":{"n":{"type":"integer"}}}'
        )
        == []
    )
    assert check_contract(
        {"n": {"N": "90071992547409931234567890123456789"}},
        '{"properties":{"n":{"multipleOf":2}}}',
    )


def test_binary_set_duplicates_are_compared_after_decoding():
    with pytest.raises(ValueError, match="duplicate"):
        convert_item('{"files":{"BS":["YQ==","YR=="]}}', "ddb")
