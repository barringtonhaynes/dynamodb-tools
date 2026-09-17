import json
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.console_api import router
from app.editor_codec import convert_item

COMPLEX_ITEM = {
    "pk": {"S": "person#ada"},
    "precise": {"N": "12345678901234567890.123456789012345678"},
    "binary": {"B": "AAEC/w=="},
    "tags": {"SS": ["math", "code"]},
    "numbers": {"NS": ["0.12345678901234567890123456789012345678", "2"]},
    "files": {"BS": ["YQ==", "Yg=="]},
    "nested": {"M": {"flag": {"BOOL": False}, "nothing": {"NULL": True}}},
    "list": {"L": [{"M": {"set": {"SS": ["inside"]}}}, {"N": "42"}]},
    "empty": {"M": {}},
    "blank_list": {"L": []},
    "escaped": {"S": 'a "quote", a \\ slash, and\na new line'},
}


def test_all_types_survive_plain_json_round_trip():
    result = convert_item(json.dumps(COMPLEX_ITEM), "ddb")
    assert "12345678901234567890.123456789012345678" in result["json"]
    decoded = json.loads(result["json"], parse_float=Decimal)
    assert decoded["precise"] == Decimal(COMPLEX_ITEM["precise"]["N"])
    converted = convert_item(result["json"], "json", COMPLEX_ITEM)
    assert converted["item"] == COMPLEX_ITEM


def test_plain_edits_infer_types_and_preserve_nested_special_types():
    result = convert_item(
        '{"pk":"person#ada","new": [1, true, null, {"x": "text"}],'
        '"nested":{"new":3}, "list":[{"set":["changed"]}], "binary":"Yg=="}',
        "json",
        COMPLEX_ITEM,
    )["item"]
    assert result["new"] == {
        "L": [{"N": "1"}, {"BOOL": True}, {"NULL": True}, {"M": {"x": {"S": "text"}}}]
    }
    assert result["nested"] == {"M": {"new": {"N": "3"}}}
    assert result["list"] == {"L": [{"M": {"set": {"SS": ["changed"]}}}]}
    assert result["binary"] == {"B": "Yg=="}
    assert "tags" not in result


@pytest.mark.parametrize(
    "text,view,match",
    [
        ('{"x": 1, "x": 2}', "json", "Duplicate attribute"),
        ('{"x":{"M":{"a":{"S":"x"},"a":{"S":"y"}}}}', "ddb", "Duplicate attribute"),
        ('{\n"x":}', "json", "line 2, column"),
        ('{"x": NaN}', "json", "valid JSON number"),
        ('{"x": Infinity}', "json", "valid JSON number"),
        ('{"x": 123456789012345678901234567890123456789}', "json", "x: number exceeds"),
        ("[]", "json", "nonempty JSON object"),
        ("{}", "ddb", "nonempty JSON object"),
        ('{"": {"S":"x"}}', "ddb", "cannot be empty"),
        ('{"x":{"N":1}}', "ddb", "x: N values must be strings"),
        ('{"x":{"N":"Infinity"}}', "ddb", "x:"),
        ('{"x":{"N":"123456789012345678901234567890123456789"}}', "ddb", "x:"),
        ('{"x":{"M":{"y":{"B":"***"}}}}', "ddb", "x.y:"),
        ('{"x":{"SS":[]}}', "ddb", "x:"),
        ('{"x":{"NS":["1", "1.0"]}}', "ddb", "duplicate"),
        ('{"x":{"BOOL":"false"}}', "ddb", "x:"),
        ('{"x":{"NULL":false}}', "ddb", "x:"),
    ],
)
def test_invalid_editor_data_is_actionable(text, view, match):
    with pytest.raises(ValueError, match=match):
        convert_item(text, view)


def test_special_type_change_is_explicit():
    with pytest.raises(ValueError, match="Change this type"):
        convert_item('{"tags":"not a set"}', "json", COMPLEX_ITEM)
    with pytest.raises(ValueError, match="numbers: expected NS"):
        convert_item('{"numbers":["1"]}', "json", COMPLEX_ITEM)


def test_conversion_route_is_read_only_and_returns_errors_without_database():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        result = client.post(
            "/api/items/convert",
            json={
                "view": "json",
                "text": '{"score":0.12345678901234567890123456789012345678}',
            },
        )
        assert result.status_code == 200
        assert (
            result.json()["item"]["score"]["N"]
            == "0.12345678901234567890123456789012345678"
        )
        result = client.post("/api/items/convert", json={"text": '{"score":{"N":3}}'})
        assert result.status_code == 400
        assert "score" in result.json()["detail"]
