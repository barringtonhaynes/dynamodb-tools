import json
import os
from enum import Enum

from .config import settings


class UnknownDataFileTypeError(Exception):
    pass


class DataFileType(str, Enum):
    CSV = "csv"
    JSON = "json"
    DYNAMODB_JSON = "dynamodb_json"


class DataService:
    def get_create_schemas(self) -> list[dict]:
        for file in os.listdir(f"{settings.data_path}/create"):
            if file.endswith(".json"):
                with open(f"{settings.data_path}/create/{file}", "r") as f:
                    yield json.load(f)

    def get_update_schemas(self) -> list[dict]:
        for file in os.listdir(f"{settings.data_path}/update"):
            if file.endswith(".json"):
                with open(f"{settings.data_path}/update/{file}", "r") as f:
                    yield json.load(f)

    def get_seed_files(self) -> list[tuple[str, str]]:
        for table_name in os.listdir(f"{settings.data_path}/seed"):
            for file_name in self.get_seed_files_for_table(table_name):
                yield table_name, file_name

    def get_seed_files_for_table(self, table_name: str) -> list[str]:
        for file in os.listdir(f"{settings.data_path}/seed/{table_name}"):
            yield f"{settings.data_path}/seed/{table_name}/{file}"

    def get_data_files_for_table(self, table_name: str) -> list[str]:
        for file in os.listdir(f"{settings.data_path}/import/{table_name}"):
            yield f"{settings.data_path}/import/{table_name}/{file}"

    @classmethod
    def get_file_type(cls, file_name: str) -> str:
        if file_name.endswith(".csv"):
            return DataFileType.CSV
        if file_name.endswith(".dynamodb.json"):
            return DataFileType.DYNAMODB_JSON
        if file_name.endswith(".json"):
            return DataFileType.JSON
        raise UnknownDataFileTypeError(f"Unknown file type for file {file_name}")
