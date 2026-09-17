import logging
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import aws_safety, connection, host_runtime
from .config import settings
from .connection import READ_ONLY_MESSAGE, read_request
from .connection_api import router as connection_router
from .console_api import router as console_router
from .controller import router
from .copy_api import router as copy_router
from .operations import operations
from .startup_tasks import startup_tasks
from .user_state import router as user_state_router
from .workspace_api import router as workspace_router

logging.basicConfig(level=settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await startup_tasks()
    yield


active_requests = 0
switching_connection = False

app = FastAPI(title="DynamoDB Tools", lifespan=lifespan)
app.include_router(router)

app.include_router(connection_router)
app.include_router(console_router)
app.include_router(copy_router)
app.include_router(workspace_router)
app.include_router(user_state_router)
static_directory = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_directory), name="static")


@app.get("/", include_in_schema=False)
def console():
    return FileResponse(static_directory / "index.html")


@app.middleware("http")
async def console_security(request: Request, call_next):
    denied = host_runtime.protect(request)
    if denied is not None:
        return denied
    if request.method in {
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
    }:
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc != request.url.netloc:
            return JSONResponse(
                {"detail": "Cross-origin console writes are not allowed"},
                status_code=403,
            )
    if settings.is_read_only and not read_request(request.method, request.url.path):
        return JSONResponse({"detail": READ_ONLY_MESSAGE}, status_code=403)
    global active_requests, switching_connection
    dynamic = request.url.path.startswith(("/api/", "/tables", "/health"))
    changing = request.method == "PUT" and request.url.path == "/api/connection"
    if dynamic:
        revision = request.headers.get("x-connection-id")
        if (
            revision
            and revision != connection.connection_revision
            and not (
                request.method == "GET"
                and request.url.path
                in {"/api/overview", "/api/connection", "/api/settings"}
            )
        ):
            return JSONResponse(
                {
                    "detail": "The connection changed. Reload this page before continuing."
                },
                status_code=409,
            )
        if switching_connection or (
            changing
            and (
                active_requests
                or any(
                    job["status"] in {"queued", "running"} for job in operations.list()
                )
            )
        ):
            return JSONResponse(
                {
                    "detail": "Wait for current requests and operations to finish before changing connections."
                },
                status_code=409,
            )
        if changing:
            switching_connection = True
        active_requests += 1
    try:
        response = await aws_safety.protect(request) if dynamic else None
        if response is None:
            response = await call_next(request)
    finally:
        if dynamic:
            active_requests -= 1
        if changing:
            switching_connection = False
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path == "/":
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; base-uri 'self'; "
            "form-action 'self'; frame-ancestors 'none'"
        )
        response.headers["Cache-Control"] = "no-cache"
    return response
