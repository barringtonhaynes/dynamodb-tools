from pathlib import Path

import pytest

from app.data_service import DataService


def test_missing_optional_directories():
    service = DataService()
    assert list(service.get_create_schemas()) == []
    assert list(service.get_update_schemas()) == []
    assert list(service.get_seed_files()) == []
    assert list(service.get_data_files_for_table("missing")) == []


def test_discovery_is_sorted_and_ignores_unsupported_files(tmp_path):
    folder = tmp_path / "seed/test_table"
    folder.mkdir(parents=True)
    for name in ("b.json", "a.csv", "notes.txt"):
        (folder / name).touch()
    (folder / "directory.json").mkdir()
    (tmp_path / "seed/README").touch()
    assert [
        (table, Path(path).name) for table, path in DataService().get_seed_files()
    ] == [("test_table", "a.csv"), ("test_table", "b.json")]


@pytest.mark.parametrize(
    "table,file",
    [("..", "a.json"), ("test_table", "../a.json"), ("test_table", "..\\a.json")],
)
def test_rejects_traversal(table, file):
    with pytest.raises(ValueError):
        DataService().get_data_file_path(table, file)


def test_symlink_outside_load_directory_is_rejected(tmp_path):
    folder = tmp_path / "load/test_table"
    folder.mkdir(parents=True)
    outside = tmp_path / "private.json"
    outside.write_text("[]")
    (folder / "escape.json").symlink_to(outside)
    with pytest.raises(ValueError):
        DataService().get_data_file_path("test_table", "escape.json")
    assert list(DataService().get_data_files_for_table("test_table")) == []


def test_missing_file():
    with pytest.raises(FileNotFoundError):
        DataService().get_data_file_path("test_table", "missing.json")
