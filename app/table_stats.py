from pydantic import BaseModel


class TableStats(BaseModel):
    deleted: int = 0
    purged: int = 0
    created: int = 0
    updated: int = 0
    seeded: int = 0


table_stats = TableStats()
