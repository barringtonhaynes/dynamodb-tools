import csv
import json
import logging
from enum import Enum

import boto3
from botocore.exceptions import ClientError
from mypy_boto3_dynamodb import DynamoDBClient, DynamoDBServiceResource

from .config import settings
from .table_stats import table_stats

logger = logging.getLogger(__name__)


class UnknownDataFileTypeError(Exception):
    pass


class DataFileType(str, Enum):
    CSV = "csv"
    JSON = "json"
    DYNAMODB_JSON = "dynamodb_json"


class TableService:
    def __init__(self) -> None:
        self.client: DynamoDBClient = boto3.client(
            "dynamodb", endpoint_url=settings.dynamodb_endpoint_url
        )
        self.resource: DynamoDBServiceResource = boto3.resource(
            "dynamodb", endpoint_url=settings.dynamodb_endpoint_url
        )

    def list_tables(self):
        return [table.name for table in self.resource.tables.all()]

    def get_keys(self, table_name: str) -> list[str]:
        key_attributes = []
        description = self.client.describe_table(TableName=table_name)
        for key in description["Table"]["KeySchema"]:
            if key["KeyType"] in ("HASH", "RANGE"):
                key_attributes.append(key["AttributeName"])
        return key_attributes

    def delete_tables(self) -> None:
        logger.info("Deleting tables")
        for table_name in self.list_tables():
            self.delete_table(table_name)

    def delete_table(self, table_name: str) -> None:
        logger.info(f"Deleting table {table_name}")
        try:
            table = self.resource.Table(table_name)
            table.delete()
            self.client.get_waiter("table_not_exists").wait(TableName=table_name)
            table_stats.deleted += 1
        except Exception:
            logger.exception(f"Error deleting table {table_name}")

    def purge_tables(self) -> None:
        logger.info("Purging tables")
        for table_name in self.list_tables():
            self.purge_table(table_name)

    def purge_table(self, table_name: str) -> None:
        logger.info(f"Purging table {table_name}")
        try:
            key_attributes = self.get_keys(table_name)
            table = self.resource.Table(table_name)
            while True:
                response = table.scan(
                    ProjectionExpression=", ".join(key_attributes),
                )
                with table.batch_writer() as batch:
                    for item in response["Items"]:
                        batch.delete_item(Key=item)
                if "LastEvaluatedKey" not in response:
                    break
            table_stats.purged += 1
        except Exception:
            logger.exception(f"Error purging table {table_name}")

    def create_table(self, schema: dict) -> None:
        table_name = schema["TableName"]
        logger.info(f"Creating table {table_name}")
        try:
            self.resource.create_table(**schema)
            self.client.get_waiter("table_exists").wait(TableName=table_name)
            table_stats.created += 1
        except ClientError as e:
            if e.response["Error"]["Code"] == "ResourceInUseException":
                logger.warn(f"Table {table_name} already exists, skipping creation...")
            else:
                logger.exception("Error creating table: %s", e)

    def update_table(self, schema: dict) -> None:
        table_name = schema["TableName"]
        logger.info(f"Updating table {table_name}")
        try:
            self.client.update_table(**schema)
            table_stats.updated += 1
        except ClientError as e:
            if e.response["Error"]["Code"] == "ValidationException":
                logger.warn(
                    f"Table {table_name} update already processed, skipping update..."
                )
            else:
                logger.exception("Error updating table: %s", e)

    def seed_table(self, table_name: str, data_file: str) -> None:
        try:
            file_type = self.get_file_type(data_file)
            if file_type == DataFileType.CSV:
                self.seed_table_from_csv(table_name, data_file)
            elif file_type == DataFileType.JSON:
                self.seed_table_from_json(table_name, data_file)
            elif file_type == DataFileType.DYNAMODB_JSON:
                self.seed_table_from_dynamodb_json(table_name, data_file)
            table_stats.seeded += 1
        except UnknownDataFileTypeError:
            logger.exception(
                f"Error seeding table {table_name} with data file {data_file}"
            )

    def seed_table_from_csv(self, table_name: str, data_file: str) -> None:
        logger.info(f"Seeding table {table_name} with data file {data_file} as CSV")
        with open(data_file, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    table = self.resource.Table(table_name)
                    table.put_item(Item=row)
                except Exception as e:
                    logger.exception(row)
                    logger.exception(e)

    def seed_table_from_json(self, table_name: str, data_file: str) -> None:
        logger.info(f"Seeding table {table_name} with data file {data_file} as JSON")
        with open(data_file, "r") as f:
            data = json.load(f)
            for row in data:
                try:
                    table = self.resource.Table(table_name)
                    table.put_item(Item=row)
                except Exception as e:
                    logger.exception(row)
                    logger.exception(e)

    def seed_table_from_dynamodb_json(self, table_name: str, data_file: str) -> None:
        logger.info(
            f"Seeding table {table_name} with data file {data_file} as DynamoDB JSON"
        )
        with open(data_file, "r") as f:
            items = json.load(f)
            for item in items:
                try:
                    self.client.put_item(TableName=table_name, Item=item)
                except Exception as e:
                    logger.exception(item)
                    logger.exception(e)

    def get_file_type(self, file_name: str) -> str:
        if file_name.endswith(".csv"):
            return DataFileType.CSV
        if file_name.endswith(".dynamodb.json"):
            return DataFileType.DYNAMODB_JSON
        if file_name.endswith(".json"):
            return DataFileType.JSON
        raise UnknownDataFileTypeError(f"Unknown file type for file {file_name}")
