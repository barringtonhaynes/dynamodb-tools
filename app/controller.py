import logging

from botocore.exceptions import BotoCoreError, ClientError, ParamValidationError
from fastapi import HTTPException, Path
from fastapi.responses import JSONResponse
from fastapi.routing import APIRouter

from .config import settings
from .data_service import DataService
from .startup_tasks import get_startup_tasks_status
from .table_service import TableService
from .table_stats import table_stats

logger = logging.getLogger(__name__)
data_service = DataService()
router = APIRouter()


@router.get("/health")
def health() -> JSONResponse:
    """Return completed startup status, file counters, and application settings."""
    return JSONResponse(
        content={
            "startupTasksStatus": get_startup_tasks_status(),
            "stats": table_stats.model_dump(),
            "settings": settings.model_dump(),
        }
    )


@router.get("/tables", response_model=list[str])
def list_tables() -> list[str]:
    """List all DynamoDB tables."""
    return TableService().list_tables()


@router.get("/tables/{table_name}/data", response_model=list[str])
def get_data_files(
    table_name: str = Path(
        ..., pattern=r"^[a-zA-Z0-9_.-]{3,255}$", description="The name of the table"
    )
) -> list[str]:
    """List supported load files for the table in filename order."""
    return list(data_service.get_data_files_for_table(table_name))


@router.post("/tables/{table_name}/data/{data_file}")
def load_data_file(
    table_name: str = Path(
        ..., pattern=r"^[a-zA-Z0-9_.-]{3,255}$", description="The name of the table"
    ),
    data_file: str = Path(..., description="The name of the data file to load"),
) -> JSONResponse:
    """Import a mounted CSV or JSON file, reporting failures as HTTP errors."""
    try:
        data_file_path = data_service.get_data_file_path(table_name, data_file)
        TableService().seed_table(table_name, str(data_file_path))
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Data file not found") from error
    except (ValueError, TypeError, KeyError, ParamValidationError) as error:
        raise HTTPException(
            status_code=400, detail="Invalid data file or path"
        ) from error
    except ClientError as error:
        code = error.response["Error"]["Code"]
        status = {"ResourceNotFoundException": 404, "ValidationException": 400}.get(
            code, 502
        )
        logger.exception("DynamoDB data load failed")
        raise HTTPException(
            status_code=status, detail=f"DynamoDB load failed: {code}"
        ) from error
    except BotoCoreError as error:
        logger.exception("DynamoDB is unavailable")
        raise HTTPException(
            status_code=503, detail="DynamoDB is unavailable"
        ) from error
    return JSONResponse(
        content={
            "status": "success",
            "message": f"Data file {data_file} loaded into table {table_name}.",
        }
    )
