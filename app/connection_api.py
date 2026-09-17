"""Connection preferences only: credentials remain with the AWS SDK providers."""
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import boto3
from fastapi import APIRouter

from . import connection
from .config import ConnectionPreferences, settings
from .console_api import ConsoleRoute
from .operations import operations
from .table_stats import TableStats, table_stats

router = APIRouter(prefix="/api/connection", route_class=ConsoleRoute)


def candidate(preferences):
    values = preferences.model_dump()
    for name in ("aws_profile", "aws_region"):
        values[name] = (values[name] or "").strip() or None
    if preferences.dynamodb_mode == "local":
        url = urlsplit(preferences.dynamodb_endpoint_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
        ):
            raise ValueError(
                "Use an HTTP(S) local endpoint without embedded credentials"
            )
    return settings.model_copy(update=values)


def probe(config):
    database = connection.client(config=config)
    info = connection.connection_info(database, config)
    database.list_tables(Limit=1)
    return info


@router.get("")
def get_preferences():
    try:
        profiles = boto3.Session().available_profiles
    except Exception:
        profiles = []
    return {
        "preferences": {
            key: getattr(settings, key) for key in ConnectionPreferences.model_fields
        },
        "profiles": profiles,
        "path": str(Path(settings.connection_settings_path).expanduser()),
        "saved": settings.connection_saved,
    }


@router.post("/test")
def test_connection(request: ConnectionPreferences):
    return probe(candidate(request))


@router.put("")
def save_connection(request: ConnectionPreferences):
    config = candidate(request)
    info = probe(config)  # Nothing is persisted or switched unless sign-in succeeds.
    path = Path(settings.connection_settings_path).expanduser()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    values = {key: getattr(config, key) for key in ConnectionPreferences.model_fields}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", dir=path.parent, prefix=".connection-", delete=False
        ) as file:
            temporary = file.name
            json.dump(values, file, indent=2)
            file.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    for key, value in values.items():
        setattr(settings, key, value)
    settings.connection_saved = True
    connection.connection_revision = uuid4().hex
    operations.clear()
    for name in TableStats.model_fields:
        setattr(table_stats, name, 0)
    return {**info, "id": connection.connection_revision, "saved": True}
