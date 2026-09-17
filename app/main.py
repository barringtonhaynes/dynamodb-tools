import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import settings
from .controller import router
from .startup_tasks import startup_tasks

logging.basicConfig(level=settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await startup_tasks()
    yield


app = FastAPI(title="DynamoDB Tools", lifespan=lifespan)
app.include_router(router)
