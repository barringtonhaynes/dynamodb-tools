"""Versioned, host-owned saved definitions. No AWS secrets or database items."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import host_runtime

PREFIX = "dynamodb-tools.saved-queries.v1:"
MAX_BYTES = 2 * 1024 * 1024
router = APIRouter(prefix="/api/local")


class Definition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(max_length=2048)
    value: str = Field(max_length=MAX_BYTES)
    revision: int = Field(ge=0)

    @field_validator("key")
    @classmethod
    def key_valid(cls, value):
        if not value.startswith(PREFIX):
            raise ValueError("Only saved queries and item schemas can be stored")
        suffix = value.removeprefix(PREFIX)
        scope = suffix.removesuffix(":item-schema")
        parts = json.loads(scope)
        if (
            not isinstance(parts, list)
            or len(parts) != 3
            or not all(isinstance(part, str) and part for part in parts)
        ):
            raise ValueError("Invalid connection/table scope")
        return value

    @field_validator("value")
    @classmethod
    def value_valid(cls, value):
        if len(value.encode("utf-8")) > MAX_BYTES:
            raise ValueError("Definition is too large")
        if value:
            json.loads(value)
        return value


class StateStore:
    def __init__(self, directory):
        root = Path(directory)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = root / "workspace.sqlite3"
        with self.connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > 1:
                raise ValueError(
                    "Workspace was created by a newer app. Upgrade before opening it."
                )
            db.execute(
                "CREATE TABLE IF NOT EXISTS definitions (key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL)"
            )
            db.execute("PRAGMA user_version=1")
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def read(self):
        with self.connect() as db:
            return {
                key: {"value": value, "revision": rev}
                for key, value, rev in db.execute(
                    "SELECT key, value, revision FROM definitions"
                )
            }

    def write(self, definition):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT revision FROM definitions WHERE key=?", (definition.key,)
            ).fetchone()
            if (row[0] if row else 0) != definition.revision:
                raise HTTPException(
                    409,
                    "Saved definitions changed in another window. Reload before saving.",
                )
            total = db.execute(
                "SELECT COALESCE(SUM(length(CAST(value AS BLOB))),0) FROM definitions WHERE key != ?",
                (definition.key,),
            ).fetchone()[0]
            if total + len(definition.value.encode("utf-8")) > 16 * MAX_BYTES:
                raise HTTPException(
                    413, "Saved definitions exceed the 32 MiB workspace limit."
                )
            revision = definition.revision + 1
            db.execute(
                "INSERT INTO definitions VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE "
                "SET value=excluded.value, revision=excluded.revision",
                (definition.key, definition.value, revision),
            )
        return {"value": definition.value, "revision": revision}


def store():
    if host_runtime.state_directory is None:
        raise HTTPException(404, "Browser mode uses browser storage")
    return StateStore(host_runtime.state_directory)


@router.get("")
def local_info():
    if host_runtime.state_directory is None:
        return {"installed": False}
    return {"installed": True, "version": "0.2.0", "definitions": store().read()}


@router.put("/definition")
def save_definition(definition: Definition):
    if definition.key.endswith(":item-schema"):
        if definition.value and not isinstance(
            json.loads(definition.value), (dict, bool)
        ):
            raise HTTPException(422, "An item schema must be an object or boolean")
    elif not isinstance(json.loads(definition.value or "null"), list):
        raise HTTPException(422, "Saved queries must be a JSON array")
    return store().write(definition)


@router.get("/openapi")
def local_api_reference(request: Request):
    return request.app.openapi()
