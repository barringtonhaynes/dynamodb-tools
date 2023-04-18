import logging

from fastapi import Path
from fastapi.responses import JSONResponse
from fastapi.routing import APIRouter

from .config import settings
from .data_service import DataService
from .startup_tasks import get_startup_tasks_status
from .table_service import TableService
from .table_stats import table_stats

logger = logging.getLogger(__name__)

data_service = DataService()
table_service = TableService()

router = APIRouter()


@router.get("/health")
async def health() -> JSONResponse:
    """
    Returns a JSONResponse object containing the health status of the application.
    This includes the status of startup tasks, the stats of the tables, and the application settings.
    """
    health_status = {
        "startupTasksStatus": get_startup_tasks_status(),
        "stats": table_stats.dict(),
        "settings": settings.dict(),
    }

    return JSONResponse(content=health_status)


@router.get("/tables", response_model=list[str])
async def list_tables() -> list[str]:
    """
    Returns a list of table names in the database.
    """
    tables = table_service.list_tables()
    return tables


@router.get("/tables/{table_name}/data", response_model=list[str])
async def get_data_files(
    table_name: str = Path(..., description="The name of the table")
) -> list[str]:
    """
    Returns a list of data files for a given table name.
    """
    data_files = [
        file_name for file_name in data_service.get_data_files_for_table(table_name)
    ]
    return data_files


@router.post("/tables/{table_name}/data/{data_file}")
async def load_data_file(
    table_name: str = Path(..., description="The name of the table"),
    data_file: str = Path(..., description="The name of the data file to load"),
) -> JSONResponse:
    """
    Loads a data file into the specified table.
    """
    data_file_path = f"{settings.data_path}/load/{table_name}/{data_file}"
    table_service.seed_table(table_name, data_file_path)

    response = {
        "status": "success",
        "message": f"Data file {data_file} loaded into table {table_name}.",
    }

    return JSONResponse(content=response)
