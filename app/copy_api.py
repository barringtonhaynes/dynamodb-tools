"""Read-only capture/preview and protected destination execution."""
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from . import copy_data
from .console_api import ConsoleRoute, SearchRequest

router = APIRouter(prefix="/api", route_class=ConsoleRoute)


class CaptureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: SearchRequest = Field(default_factory=SearchRequest)
    transforms: list[copy_data.Transform] = Field(default_factory=list, max_length=20)
    maxItems: int = Field(default=100, ge=1, le=1000)
    maxPages: int = Field(default=10, ge=1, le=20)


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    batch: str = Field(min_length=1, max_length=64)
    policy: Literal["skip", "replace"] = "skip"


class ExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=1, max_length=64)
    confirmation: str = Field(max_length=300)


@router.get("/copies")
def batches():
    return copy_data.store.summaries()


@router.get("/copies/{batch_id}/export")
def export(batch_id: str):
    return copy_data.store.get(batch_id)["items"]


@router.post("/copies/{batch_id}/discard")
def discard(batch_id: str):
    copy_data.store.discard(batch_id)
    return {"discarded": True}


@router.post("/copies/jobs/{job_id}/stop")
def stop(job_id: str):
    return copy_data.stop_job(job_id)


@router.post("/tables/{name}/copies/capture")
def capture(name: str, request: CaptureRequest):
    return copy_data.capture(name, request)


@router.post("/tables/{name}/copies/preview")
def preview(name: str, request: PreviewRequest):
    return copy_data.preview(name, request.batch, request.policy)


@router.post("/tables/{name}/copies/execute", status_code=202)
def execute(name: str, request: ExecuteRequest):
    return copy_data.execute(name, request.token, request.confirmation)
