import logging
from enum import Enum

from .config import settings
from .data_service import DataService
from .table_service import TableService

logger = logging.getLogger(__name__)

data_service = DataService()
table_service = TableService()


class StartupTaskStatus(str, Enum):
    NOT_STARTED = "not_started"
    STARTED = "started"
    DELETING_TABLES = "deleting_tables"
    PURGING_TABLES = "purging_tables"
    CREATING_TABLES = "creating_tables"
    UPDATING_TABLES = "updating_tables"
    SEEDING_TABLES = "seeding_tables"
    FINISHED = "finished"
    ERROR = "error"


startup_tasks_status: StartupTaskStatus = StartupTaskStatus.NOT_STARTED


def get_startup_tasks_status() -> StartupTaskStatus:
    return startup_tasks_status


def set_startup_tasks_status(status: StartupTaskStatus) -> None:
    global startup_tasks_status
    startup_tasks_status = status


async def startup_tasks() -> None:
    logger.info("Starting startup tasks")
    set_startup_tasks_status(StartupTaskStatus.STARTED)

    if settings.delete_tables_on_startup:
        logger.info("Deleting tables")
        set_startup_tasks_status(StartupTaskStatus.DELETING_TABLES)
        table_service.delete_tables()

    if settings.purge_tables_on_startup:
        logger.info("Purging tables")
        set_startup_tasks_status(StartupTaskStatus.PURGING_TABLES)
        table_service.purge_tables()

    if settings.create_tables_on_startup:
        logger.info("Creating tables")
        set_startup_tasks_status(StartupTaskStatus.CREATING_TABLES)
        for schema in data_service.get_create_schemas():
            table_service.create_table(schema)

    if settings.update_tables_on_startup:
        logger.info("Updating tables")
        set_startup_tasks_status(StartupTaskStatus.UPDATING_TABLES)
        for schema in data_service.get_update_schemas():
            table_service.update_table(schema)

    if settings.seed_tables_on_startup:
        logger.info("Seeding tables")
        set_startup_tasks_status(StartupTaskStatus.SEEDING_TABLES)
        for table_name, file_name in data_service.get_seed_files():
            table_service.seed_table(table_name, file_name)

    set_startup_tasks_status(StartupTaskStatus.FINISHED)
    logger.info("Finished startup tasks")
