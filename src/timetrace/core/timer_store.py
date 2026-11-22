"""Durable JSON and local advisory lock, without database or HTTP dependencies."""

import fcntl
import json
import os
from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile


class TimerStore:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.with_suffix(".lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def read(self):
        if not self.path.exists():
            return {"version": 2, "revision": 0, "timers": {}, "pending_operation": None}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def write(self, state):
        temporary = None
        try:
            with NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(state, stream, sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
