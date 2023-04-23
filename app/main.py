import asyncio
import logging
import os
import threading

from .controller import app
from .startup_tasks import startup_tasks

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)


thread = threading.Thread(target=lambda: asyncio.run(startup_tasks()))
thread.start()
