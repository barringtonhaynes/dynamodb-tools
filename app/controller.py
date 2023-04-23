import csv
import logging
from typing import Annotated

from fastapi import FastAPI, Form, Path, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import settings
from .data_service import DataFileType, DataService
from .startup_tasks import get_startup_tasks_status
from .table_service import TableService
from .table_stats import table_stats

logger = logging.getLogger(__name__)

data_service = DataService()
table_service = TableService()


app = FastAPI()

app.mount("/static", StaticFiles(directory="app/ui/static"), name="static")

templates = Jinja2Templates(directory="app/ui/templates")


def is_html(request: Request):
    return "text/html" in request.headers["accept"].split(",")


@app.exception_handler(404)
async def custom_http_exception_handler(request, exc):
    return templates.TemplateResponse("404.html", {"request": request})


@app.get("/")
async def homepage(request: Request, id: str = "hello") -> HTMLResponse:
    tables = sorted(table_service.list_tables())
    return templates.TemplateResponse(
        "index.html", {"request": request, "tables": tables}
    )


@app.post("/")
async def form_submit(request: Request) -> HTMLResponse:
    logger.info(vars(await request.form()))
    return templates.TemplateResponse("404.html", {"request": request})


@app.get("/health")
async def health(request: Request) -> JSONResponse | HTMLResponse:
    """
    Returns a JSONResponse object containing the health status of the application.
    This includes the status of startup tasks, the stats of the tables, and the application settings.
    """
    health_status = {
        "startupTasksStatus": get_startup_tasks_status(),
        "stats": table_stats.dict(),
        "settings": settings.dict(),
    }

    if is_html(request):
        return templates.TemplateResponse(
            "health.html", {"request": request, "health_status": health_status}
        )
    else:
        return JSONResponse(content=health_status)


@app.get("/tables", response_model=list[str])
async def list_tables() -> list[str]:
    """
    Returns a list of table names in the database.
    """
    tables = table_service.list_tables()
    return sorted(tables)


@app.get("/tables/{table_name}")
async def list_tables(
    request: Request, table_name: str = Path(..., description="The name of the table")
) -> list[str]:
    """
    Returns data about the table.
    """
    item_count = table_service.get_item_count(table_name)

    if is_html(request):
        return templates.TemplateResponse(
            "table.html", {"request": request, "table": table_name, "item_count": item_count}
        )
    else:
        return JSONResponse(content={"table": table_name})


@app.get("/tables/{table_name}/data")
async def get_data_files(
    request: Request, table_name: str = Path(..., description="The name of the table")
) -> JSONResponse | HTMLResponse:
    """
    Returns a list of data files for a given table.
    """
    data_files = sorted(
        [file_name for file_name in data_service.get_data_files_for_table(table_name)]
    )

    message = {
        "style": "positive",
        "title": "Test message",
        "text": "This is the text"
    }

    if is_html(request):
        return templates.TemplateResponse(
            "table_data.html",
            {"request": request, "table": table_name, "data_files": data_files, "messages": [message]},
        )
    else:
        return JSONResponse(content=data_files)


@app.post("/tables/{table_name}/data")
async def table_data_file_action(
    request: Request,
    table_name: Annotated[str, Path(description="The name of the table")],
    # action: Annotated[str, Form()],
    # data_file: Annotated[str, Form()],
    # import_data:
):
    logger.info(vars(await request.form()))
    # logger.warning(import_data)
    # data_file_path = f"{settings.data_path}/load/{table_name}/{data_file}"
    # table_service.seed_table(table_name, data_file_path)

    # response = {
    #     "status": "success",
    #     "message": f"Data file {data_file} loaded into table {table_name}.",
    # }

    # return JSONResponse(content=response)
    return {}


@app.get("/tables/{table_name}/data/{data_file}")
async def show_data_file(
    request: Request,
    table_name: str = Path(..., description="The name of the table"),
    data_file: str = Path(..., description="The name of the data file to load"),
) -> HTMLResponse:
    """
    Render a preview of the data file.
    """

    data_file_path = f"{settings.data_path}/load/{table_name}/{data_file}"
    match DataService.get_file_type(data_file):
        case DataFileType.CSV:
            with open(data_file_path) as csvfile:
                data = list(csv.reader(csvfile))
            return templates.TemplateResponse(
                "file_preview_csv.html", {"request": request, "csv": data}
            )
        case _:
            raise NotImplementedError()


@app.post("/tables/{table_name}/data/{data_file}")
async def load_data_file(
    table_name: str = Path(..., description="The name of the table"),
    data_file: str = Path(..., description="The name of the data file to load"),
) -> JSONResponse | HTMLResponse:
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
