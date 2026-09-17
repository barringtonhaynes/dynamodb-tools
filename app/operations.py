"""Bounded operation history for this single-worker development container."""
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Lock
from uuid import uuid4


class OperationStopped(Exception):
    """A cooperative stop preserves all previously applied writes."""


class OperationStore:
    def __init__(self):
        self._items = deque()
        self._lock = Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="dynamodb-tools"
        )

    def clear(self):
        with self._lock:
            self._items.clear()

    def list(self):
        with self._lock:
            return [dict(item) for item in reversed(self._items)]

    def record(self, action, table, status="completed", detail=""):
        item = {
            "id": uuid4().hex,
            "action": action,
            "table": table,
            "status": status,
            "detail": detail,
            "startedAt": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            if (
                status == "queued"
                and sum(item["status"] in {"queued", "running"} for item in self._items)
                >= 10
            ):
                raise ValueError(
                    "The operation queue is full. Wait for a running operation to finish."
                )
            if len(self._items) >= 100:
                removable = next(
                    (
                        saved
                        for saved in self._items
                        if saved["status"] not in {"queued", "running"}
                    ),
                    None,
                )
                if removable:
                    self._items.remove(removable)
            self._items.append(item)
        return dict(item)

    def update(self, operation_id, **values):
        with self._lock:
            for saved in self._items:
                if saved["id"] == operation_id:
                    saved.update(values)
                    return

    def submit(self, action, table, function, with_progress=False):
        item = self.record(action, table, "queued")

        def update(**values):
            self.update(item["id"], **values)

        def run():
            update(status="running")
            try:
                detail = function(update) if with_progress else function()
                update(status="completed", detail=detail or "Operation completed")
            except OperationStopped as error:
                update(status="cancelled", detail=str(error))
            except Exception as error:
                update(status="failed", detail=str(error))
            finally:
                update(finishedAt=datetime.now(timezone.utc).isoformat())

        self._executor.submit(run)
        return item


operations = OperationStore()
