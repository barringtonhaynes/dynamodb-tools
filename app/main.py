import asyncio
import logging
import os
import threading

from fastapi import FastAPI

from .controller import router
from .startup_tasks import startup_tasks

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

app = FastAPI()

app.include_router(router)

thread = threading.Thread(target=lambda: asyncio.run(startup_tasks()))
thread.start()
