import pytest
from moto import mock_aws

from app.config import settings
from app.table_stats import TableStats, table_stats


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch, tmp_path):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    monkeypatch.setattr(
        settings, "dynamodb_endpoint_url", "https://dynamodb.us-east-1.amazonaws.com"
    )
    monkeypatch.setattr(settings, "data_path", str(tmp_path))
    monkeypatch.setattr(settings, "dynamodb_mode", "local")
    monkeypatch.setattr(settings, "read_only", None)
    monkeypatch.setattr(settings, "aws_profile", None)
    monkeypatch.setattr(settings, "aws_region", None)
    monkeypatch.setattr(settings, "connection_saved", False)
    monkeypatch.setattr(
        settings, "connection_settings_path", str(tmp_path / "connection.json")
    )
    for field in TableStats.model_fields:
        setattr(table_stats, field, 0)


@pytest.fixture
def service():
    from app.table_service import TableService

    with mock_aws():
        service = TableService()
        service.create_table(
            {
                "TableName": "test_table",
                "KeySchema": [{"AttributeName": "name", "KeyType": "HASH"}],
                "AttributeDefinitions": [
                    {"AttributeName": "name", "AttributeType": "S"}
                ],
                "BillingMode": "PAY_PER_REQUEST",
            }
        )
        yield service
