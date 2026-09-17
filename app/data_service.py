import json
from collections.abc import Iterator
from pathlib import Path

from .config import settings


class DataService:
    @staticmethod
    def _files(directory: Path) -> Iterator[Path]:
        if directory.exists():
            for path in sorted(directory.iterdir()):
                if path.is_file() and path.suffix in {".csv", ".json"}:
                    yield path

    def _schemas(self, directory: str) -> Iterator[dict]:
        for path in self._files(Path(settings.data_path) / directory):
            if path.suffix == ".json":
                with path.open(encoding="utf-8") as file:
                    yield json.load(file)

    def get_create_schemas(self) -> Iterator[dict]:
        return self._schemas("create")

    def get_update_schemas(self) -> Iterator[dict]:
        return self._schemas("update")

    def get_seed_files(self) -> Iterator[tuple[str, str]]:
        directory = Path(settings.data_path) / "seed"
        if directory.exists():
            for table in sorted(directory.iterdir()):
                if table.is_dir():
                    for file_name in self.get_seed_files_for_table(table.name):
                        yield table.name, file_name

    def get_seed_files_for_table(self, table_name: str) -> Iterator[str]:
        for path in self._files(Path(settings.data_path) / "seed" / table_name):
            yield str(path)

    def get_data_file_path(self, table_name: str, file_name: str) -> Path:
        # Restrict API loads to files inside the table's mounted load directory,
        # including when a directory or file is a symlink.
        for name in (table_name, file_name):
            if not name or name in {".", ".."} or "/" in name or "\\" in name:
                raise ValueError("Table and file names must be single path components")
        root = (Path(settings.data_path) / "load").resolve()
        directory = (root / table_name).resolve()
        path = (directory / file_name).resolve()
        if not directory.is_relative_to(root) or not path.is_relative_to(directory):
            raise ValueError("Data file must be inside the table's load directory")
        if not path.is_file():
            raise FileNotFoundError(file_name)
        return path

    def get_data_files_for_table(self, table_name: str) -> Iterator[str]:
        for path in self._files(Path(settings.data_path) / "load" / table_name):
            try:
                self.get_data_file_path(table_name, path.name)
            except ValueError:
                continue
            yield path.name
