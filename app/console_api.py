from typing import Literal

from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import BotoCoreError, ClientError, ParamValidationError
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field

from .config import settings
from .console_service import ConsoleService
from .data_codec import item_from_wire, parse_import, to_wire
from .data_service import DataService
from .operations import operations
from .startup_tasks import get_startup_tasks_status
from .table_service import TableService
from .table_stats import table_stats

MAX_IMPORT = 10 * 1024 * 1024


class ConsoleRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def wrapped(request):
            try:
                return await handler(request)
            except FileNotFoundError as error:
                raise HTTPException(404, "The requested file was not found") from error
            except ClientError as error:
                code = error.response["Error"]["Code"]
                status = {
                    "ResourceNotFoundException": 404,
                    "ValidationException": 400,
                    "ResourceInUseException": 409,
                    "ConditionalCheckFailedException": 409,
                }.get(code, 502)
                message = error.response["Error"].get("Message", code)
                if code == "ConditionalCheckFailedException":
                    message = "The item already exists, or the item you were editing no longer exists. Refresh and try again."
                raise HTTPException(status, message) from error
            except (
                ValueError,
                TypeError,
                KeyError,
                ParamValidationError,
                ArithmeticError,
            ) as error:
                raise HTTPException(400, str(error)) from error
            except BotoCoreError as error:
                raise HTTPException(
                    503,
                    "Cannot connect to DynamoDB. Check your endpoint and credentials.",
                ) from error

        return wrapped


router = APIRouter(prefix="/api", route_class=ConsoleRoute)


class SearchRequest(BaseModel):
    mode: Literal["scan", "query"] = "scan"
    index: str | None = None
    partition: dict | None = None
    sort: dict | None = None
    operator: Literal["=", "<", "<=", ">", ">=", "begins_with", "between"] = "="
    sortEnd: dict | None = None
    ascending: bool = True
    limit: int = Field(default=25, ge=1, le=100)
    cursor: str | None = Field(default=None, max_length=16384)


class SchemaRequest(BaseModel):
    definition: dict


class Confirmation(BaseModel):
    confirmation: str


class ItemRequest(BaseModel):
    item: dict
    originalKey: dict | None = None
    createOnly: bool = True


class KeyRequest(BaseModel):
    key: dict


class ImportRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(max_length=MAX_IMPORT)


class MountedRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


def check_confirmation(name, request):
    if request.confirmation != name:
        raise ValueError("Type the exact table name to confirm this operation")


def prepare_import(name, request):
    if len(request.content.encode("utf-8")) > MAX_IMPORT:
        raise ValueError("Files must be 10 MB or smaller")
    items = parse_import(request.filename, request.content)
    ConsoleService().validate_keys(name, items)
    return items


def run_import(name, filename, items):
    def write():
        deserializer = TypeDeserializer()
        service = TableService()
        service._write_items(
            name,
            [
                {key: deserializer.deserialize(value) for key, value in item.items()}
                for item in items
            ],
        )
        table_stats.seeded += 1
        return f"Loaded {len(items):,} records from {filename}. Repeated keys were overwritten."

    return operations.submit("Import data", name, write)


@router.get("/overview")
def overview():
    service = ConsoleService()
    tables = service.tables()
    files = sum(
        len(list(DataService().get_data_files_for_table(table["TableName"])))
        for table in tables
    )
    return {
        "tables": to_wire(tables),
        "files": files,
        "connection": {
            "endpoint": settings.dynamodb_endpoint_url,
            "region": service.client.meta.region_name,
        },
        "startup": get_startup_tasks_status(),
        "stats": table_stats.model_dump(),
        "operations": operations.list(),
    }


@router.get("/settings")
def configuration():
    return {
        "settings": settings.model_dump(),
        "maxImportBytes": MAX_IMPORT,
        "history": "Last 100 operations in this server session",
    }


@router.get("/operations")
def operation_history():
    return operations.list()


@router.get("/operations/{operation_id}")
def operation_detail(operation_id: str):
    for operation in operations.list():
        if operation["id"] == operation_id:
            return operation
    raise HTTPException(404, "Operation not found in this server session")


@router.post("/tables", status_code=202)
def create_table(request: SchemaRequest):
    name = request.definition.get("TableName", "")
    if not name:
        raise ValueError("A table name is required")
    definition = request.definition

    def create():
        client = ConsoleService().client
        client.create_table(**definition)
        client.get_waiter("table_exists").wait(TableName=name)
        table_stats.created += 1
        return "Table created and ready to use"

    return operations.submit("Create table", name, create)


@router.get("/tables/{name}")
def table_detail(name: str):
    return to_wire(ConsoleService().describe(name))


@router.patch("/tables/{name}", status_code=202)
def update_table(name: str, request: SchemaRequest):
    definition = dict(request.definition)
    if definition.get("TableName", name) != name:
        raise ValueError("The schema table name must match the selected table")
    definition["TableName"] = name
    return operations.submit(
        "Update table", name, lambda: TableService().update_table(definition)
    )


@router.delete("/tables/{name}", status_code=202)
def delete_table(name: str, request: Confirmation):
    check_confirmation(name, request)
    return operations.submit(
        "Delete table", name, lambda: TableService().delete_table(name)
    )


@router.post("/tables/{name}/purge", status_code=202)
def purge_table(name: str, request: Confirmation):
    check_confirmation(name, request)
    return operations.submit(
        "Purge table", name, lambda: TableService().purge_table(name)
    )


@router.post("/tables/{name}/items/search")
def search_items(name: str, request: SearchRequest):
    return ConsoleService().search(name, request)


@router.post("/tables/{name}/items/get")
def get_item(name: str, request: KeyRequest):
    service = ConsoleService()
    key = item_from_wire(request.key)
    service.validate_keys(name, [key], exact=True)
    result = service.client.get_item(TableName=name, Key=key, ConsistentRead=True)
    if "Item" not in result:
        raise HTTPException(404, "This item no longer exists")
    return to_wire(result["Item"])


@router.put("/tables/{name}/items")
def put_item(name: str, request: ItemRequest):
    ConsoleService().put_item(
        name, request.item, request.originalKey, request.createOnly
    )
    operations.record("Edit item" if request.originalKey else "Create item", name)
    return {"status": "success"}


@router.delete("/tables/{name}/items")
def delete_item(name: str, request: KeyRequest):
    ConsoleService().delete_item(name, request.key)
    operations.record("Delete item", name)
    return {"status": "success"}


@router.get("/tables/{name}/files")
def mounted_files(name: str):
    service = DataService()
    files = []
    for filename in service.get_data_files_for_table(name):
        path = service.get_data_file_path(name, filename)
        files.append(
            {
                "name": filename,
                "bytes": path.stat().st_size,
                "format": "DynamoDB JSON"
                if filename.endswith(".dynamodb.json")
                else path.suffix[1:].upper(),
            }
        )
    return files


@router.post("/tables/{name}/imports/preview")
def preview_import(name: str, request: ImportRequest):
    items = prepare_import(name, request)
    return {"count": len(items), "items": to_wire(items[:5])}


@router.post("/tables/{name}/imports", status_code=202)
def import_upload(name: str, request: ImportRequest):
    return run_import(name, request.filename, prepare_import(name, request))


@router.post("/tables/{name}/imports/mounted", status_code=202)
def import_mounted(name: str, request: MountedRequest):
    path = DataService().get_data_file_path(name, request.filename)
    if path.stat().st_size > MAX_IMPORT:
        raise ValueError(
            "Console imports must be 10 MB or smaller. Use startup seeding for larger files."
        )
    upload = ImportRequest(
        filename=request.filename, content=path.read_text(encoding="utf-8")
    )
    return run_import(name, request.filename, prepare_import(name, upload))


@router.get("/tables/{name}/export")
def export_table(name: str):
    content = ConsoleService().export(name)
    operation = operations.record(
        "Export table", name, status="running", detail="Streaming DynamoDB JSON"
    )

    def tracked_content():
        finished = False
        try:
            yield from content
            finished = True
        finally:
            operations.update(
                operation["id"],
                status="completed" if finished else "failed",
                detail="DynamoDB JSON exported"
                if finished
                else "Download interrupted; the file may be incomplete",
            )

    safe_name = "".join(char for char in name if char.isalnum() or char in "_.-")
    return StreamingResponse(
        tracked_content(),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}.dynamodb.json"'
        },
    )
