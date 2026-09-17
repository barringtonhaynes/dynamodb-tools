import json
import os
import sys
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings


def default_preferences_path():
    if sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    elif os.name == "nt":
        root = Path(os.getenv("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
    else:
        root = Path(os.getenv("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    return str(root / "dynamodb-tools" / "connection.json")


class ConnectionPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dynamodb_mode: Literal["local", "aws"] = "aws"
    aws_profile: str | None = Field(default=None, max_length=255)
    aws_region: str | None = Field(default=None, max_length=80)
    dynamodb_endpoint_url: str = Field(default="http://localhost:8000", max_length=2048)
    read_only: bool = True


class Settings(BaseSettings):
    dynamodb_mode: Literal["local", "aws"] = "local"
    aws_region: str | None = None
    connection_settings_path: str = Field(default_factory=default_preferences_path)
    connection_saved: bool = False
    aws_profile: str | None = None
    read_only: bool | None = None
    log_level: str = "INFO"
    data_path: str = "/data"
    delete_tables_on_startup: bool = False
    purge_tables_on_startup: bool = False
    create_tables_on_startup: bool = True
    update_tables_on_startup: bool = True
    seed_tables_on_startup: bool = True
    dynamodb_endpoint_url: str = "http://dynamodb:8000"

    @property
    def is_read_only(self):
        return (
            self.read_only
            if self.read_only is not None
            else self.dynamodb_mode == "aws"
        )

    def effective_settings(self):
        values = self.model_dump()
        values["read_only"] = self.is_read_only
        if self.dynamodb_mode == "aws" or self.is_read_only or self.connection_saved:
            for key in values:
                if key.endswith("_on_startup"):
                    values[key] = False
        if self.dynamodb_mode == "aws":
            values["dynamodb_endpoint_url"] = "AWS regional endpoints"
        return values


settings = Settings()
preferences_path = Path(settings.connection_settings_path).expanduser()
if preferences_path.is_file():
    saved = ConnectionPreferences.model_validate(
        json.loads(preferences_path.read_text())
    )
    for key, value in saved.model_dump().items():
        setattr(settings, key, value)
    settings.connection_saved = True
