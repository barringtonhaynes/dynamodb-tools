import json
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError
from botocore.stub import Stubber

from app.table_service import UnknownDataFileTypeError
from app.table_stats import table_stats


def test_json_decimals_nested_values_and_multiple_batches(service, tmp_path):
    path = tmp_path / "data.json"
    path.write_text(
        json.dumps(
            [
                {"name": str(i), "price": 1.25, "nested": {"value": 0.1}}
                for i in range(60)
            ]
        )
    )
    service.seed_table("test_table", str(path))
    items = service.resource.Table("test_table").scan()["Items"]
    assert len(items) == 60
    assert items[0]["price"] == Decimal("1.25")
    assert items[0]["nested"]["value"] == Decimal("0.1")
    assert table_stats.seeded == 1


@pytest.mark.parametrize(
    "suffix,content",
    [
        (".csv", '\ufeffname,description\r\nAda,"two, words"\r\n'),
        (".dynamodb.json", '[{"name":{"S":"Ada"},"description":{"S":"two, words"}}]'),
    ],
)
def test_supported_formats(service, tmp_path, suffix, content):
    path = tmp_path / f"data{suffix}"
    path.write_bytes(content.encode("utf-8"))
    service.seed_table("test_table", str(path))
    assert service.resource.Table("test_table").get_item(Key={"name": "Ada"})[
        "Item"
    ] == {"name": "Ada", "description": "two, words"}


def test_duplicate_keys_keep_last_value(service, tmp_path):
    path = tmp_path / "data.json"
    path.write_text('[{"name":"Ada","value":1},{"name":"Ada","value":2}]')
    service.seed_table("test_table", str(path))
    assert service.resource.Table("test_table").scan()["Items"] == [
        {"name": "Ada", "value": 2}
    ]


@pytest.mark.parametrize("content", ['{"name":"Ada"}', "[1]", "invalid"])
def test_invalid_json_is_not_counted(service, tmp_path, content):
    path = tmp_path / "data.json"
    path.write_text(content)
    with pytest.raises(ValueError):
        service.seed_table("test_table", str(path))
    assert table_stats.seeded == 0


def test_failed_write_is_not_reported_as_success(service, tmp_path):
    path = tmp_path / "data.json"
    path.write_text('[{"missing_key":true}]')
    with pytest.raises(ValueError):
        service.seed_table("test_table", str(path))
    assert table_stats.seeded == 0


def test_unknown_file_type_fails(service):
    with pytest.raises(UnknownDataFileTypeError):
        service.seed_table("test_table", "data.txt")
    assert table_stats.seeded == 0


def test_purge_handles_reserved_key_name(service):
    table = service.resource.Table("test_table")
    table.put_item(Item={"name": "Ada", "other": True})
    service.purge_table("test_table")
    assert table.scan()["Items"] == []
    assert table_stats.purged == 1


def test_purge_follows_every_scan_page_including_empty_pages(service):
    table = MagicMock()
    service.resource = MagicMock()
    service.resource.Table.return_value = table
    service.get_keys = lambda _: ["name", "sort.key"]
    cursor = {"name": "Ada", "sort.key": "1"}
    table.scan.side_effect = [
        {"Items": [], "LastEvaluatedKey": cursor},
        {"Items": [cursor]},
    ]
    service.purge_table("test_table")
    assert "ExclusiveStartKey" not in table.scan.call_args_list[0].kwargs
    assert table.scan.call_args_list[1].kwargs["ExclusiveStartKey"] == cursor
    assert table.scan.call_args.kwargs["ExpressionAttributeNames"] == {
        "#key0": "name",
        "#key1": "sort.key",
    }
    table.batch_writer.return_value.__enter__.return_value.delete_item.assert_called_once_with(
        Key=cursor
    )


def test_invalid_update_propagates(service):
    schema = {"TableName": "test_table", "BillingMode": "INVALID"}
    with Stubber(service.client) as stub:
        stub.add_client_error(
            "update_table", "ValidationException", expected_params=schema
        )
        with pytest.raises(ClientError):
            service.update_table(schema)
        stub.assert_no_pending_responses()
    assert table_stats.updated == 0


def test_existing_table_is_not_counted_twice(service):
    service.create_table(
        {
            "TableName": "test_table",
            "KeySchema": [{"AttributeName": "name", "KeyType": "HASH"}],
            "AttributeDefinitions": [{"AttributeName": "name", "AttributeType": "S"}],
            "BillingMode": "PAY_PER_REQUEST",
        }
    )
    assert table_stats.created == 1


def test_repository_examples_create_update_seed_and_load(service):
    root = Path(__file__).resolve().parents[1] / "examples/basic"
    service.create_table(json.loads((root / "create/notable_people.json").read_text()))
    schema = json.loads((root / "update/notable_people.json").read_text())
    service.update_table(schema)
    table = service.client.describe_table(TableName="notable_people")["Table"]
    description = {
        "Table": {
            key: table[key]
            for key in ("AttributeDefinitions", "GlobalSecondaryIndexes")
        }
    }
    with Stubber(service.client) as stub:
        stub.add_client_error(
            "update_table", "ValidationException", expected_params=schema
        )
        stub.add_response(
            "describe_table", description, {"TableName": "notable_people"}
        )
        service.update_table(schema)
        stub.assert_no_pending_responses()
    assert table_stats.updated == 1
    for folder in ("seed", "load"):
        for path in sorted((root / folder / "notable_people").iterdir()):
            service.seed_table("notable_people", str(path))
    assert table_stats.seeded == 5
    assert len(service.resource.Table("notable_people").scan()["Items"]) > 20


def test_batch_write_failure_is_propagated(service, tmp_path):
    path = tmp_path / "data.json"
    path.write_text('[{"name":"Ada"}]')
    description = {
        "Table": {"KeySchema": [{"AttributeName": "name", "KeyType": "HASH"}]}
    }
    with Stubber(service.client) as stub:
        stub.add_response("describe_table", description, {"TableName": "test_table"})
        stub.add_client_error("batch_write_item", "AccessDeniedException")
        with pytest.raises(ClientError, match="AccessDeniedException"):
            service.seed_table("test_table", str(path))
        stub.assert_no_pending_responses()
    assert table_stats.seeded == 0


def test_conflicting_index_definition_is_not_skipped(service):
    schema = {
        "TableName": "test_table",
        "GlobalSecondaryIndexUpdates": [
            {
                "Create": {
                    "IndexName": "existing_index",
                    "KeySchema": [{"AttributeName": "name", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"},
                }
            }
        ],
    }
    description = {
        "Table": {
            "GlobalSecondaryIndexes": [
                {
                    "IndexName": "existing_index",
                    "KeySchema": [{"AttributeName": "name", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "KEYS_ONLY"},
                    "IndexStatus": "ACTIVE",
                }
            ]
        }
    }
    with Stubber(service.client) as stub:
        stub.add_client_error(
            "update_table", "ValidationException", expected_params=schema
        )
        stub.add_response("describe_table", description, {"TableName": "test_table"})
        with pytest.raises(ClientError):
            service.update_table(schema)
        stub.assert_no_pending_responses()
    assert table_stats.updated == 0
