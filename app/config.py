from pydantic import BaseSettings


class Settings(BaseSettings):
    log_level: str = "INFO"
    data_path: str = "/data"
    delete_tables_on_startup: bool = False
    purge_tables_on_startup: bool = False
    create_tables_on_startup: bool = True
    update_tables_on_startup: bool = True
    seed_tables_on_startup: bool = True
    dynamodb_endpoint_url: str = "http://dynamodb:8000"


settings = Settings()
