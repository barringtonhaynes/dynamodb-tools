import asyncio
import importlib
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import startup_tasks
from app.controller import router
from app.table_stats import table_stats


@pytest.fixture
def client(service):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


def test_api_missing_and_invalid_files(client, tmp_path):
    assert client.post("/tables/test_table/data/missing.json").status_code == 404
    folder = tmp_path / "load/test_table"
    folder.mkdir(parents=True)
    (folder / "bad.json").write_text("not json")
    assert client.post("/tables/test_table/data/bad.json").status_code == 400
    assert table_stats.seeded == 0


def test_api_database_failure_and_success(client, tmp_path):
    folder = tmp_path / "load/test_table"
    folder.mkdir(parents=True)
    path = folder / "data.json"
    path.write_text('[{"wrong_key":"Ada"}]')
    assert client.post("/tables/test_table/data/data.json").status_code == 400
    assert table_stats.seeded == 0
    path.write_text('[{"name":"Ada","score":1.25}]')
    response = client.post("/tables/test_table/data/data.json")
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert client.get("/tables/test_table/data").json() == ["data.json"]
    assert client.get("/health").json()["stats"]["seeded"] == 1


def test_startup_failure_sets_error_and_raises(monkeypatch):
    monkeypatch.setattr(
        startup_tasks, "TableService", MagicMock(side_effect=RuntimeError("offline"))
    )
    with pytest.raises(RuntimeError, match="offline"):
        asyncio.run(startup_tasks.startup_tasks())
    assert startup_tasks.get_startup_tasks_status() == "error"


def test_import_does_not_run_startup_and_lifespan_runs_once(monkeypatch, service):
    calls = []

    async def startup():
        calls.append("startup")

    monkeypatch.setattr(startup_tasks, "startup_tasks", startup)
    from app import main

    importlib.reload(main)
    assert calls == []
    with TestClient(main.app) as client:
        assert calls == ["startup"]
        assert client.get("/health").status_code == 200
    assert calls == ["startup"]


def test_empty_startup_finishes(service):
    asyncio.run(startup_tasks.startup_tasks())
    assert startup_tasks.get_startup_tasks_status() == "finished"


def test_api_upstream_failure_is_not_success(client, tmp_path, monkeypatch):
    from botocore.exceptions import EndpointConnectionError

    folder = tmp_path / "load/test_table"
    folder.mkdir(parents=True)
    (folder / "data.json").write_text("[]")
    monkeypatch.setattr(
        "app.controller.TableService",
        MagicMock(
            side_effect=EndpointConnectionError(endpoint_url="http://localhost:8000")
        ),
    )
    response = client.post("/tables/test_table/data/data.json")
    assert response.status_code == 503
    assert table_stats.seeded == 0
