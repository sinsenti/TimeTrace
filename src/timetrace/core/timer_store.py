"""Durable JSON and local advisory lock, without database or HTTP dependencies."""

import fcntl
import json
import os
from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid7


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
        state = json.loads(self.path.read_text(encoding="utf-8"))
        if state.get("version") == 2:
            return state
        if "is_running" not in state:
            raise ValueError("Unknown timer state format; refusing to overwrite.")
        backup = TimerStore(self.path.with_suffix(".v1.backup"))
        if not backup.path.exists():
            backup.write(state)
        upgraded = {
            "version": 2,
            "revision": 0,
            "timers": {},
            "pending_operation": None,
            "idle_detection_enabled": state.get("idle_detection_enabled", True),
            "idle_threshold_seconds": state.get("idle_threshold_seconds", 300),
        }
        if state.get("is_running") or state.get("is_frozen_idle"):
            timer = {
                "id": str(uuid7()),
                "revision": 1,
                "state": "frozen" if state.get("is_frozen_idle") else "running",
                "task_id": state.get("task_id"),
                "task_title": state.get("task_title"),
                "scheduled_session_id": None,
                "tags": state.get("tags", ""),
                "notes": state.get("notes", ""),
                "mode": state.get("mode", "flowtime"),
                "target_minutes": state.get("target_minutes"),
                "pause_when_idle": True,
                "running_start": state.get("start_time") if state.get("is_running") else None,
                "segments": [],
                "idle_gaps": [],
                "legacy_payload": state,
            }
            gap = state.get("pending_idle_gap")
            if gap:
                timer["running_start"] = None
                timer["state"] = "frozen"
                saved = gap.get("saved_session") or {}
                if saved.get("start_time") and saved.get("end_time") and saved["end_time"] > saved["start_time"]:
                    timer["segments"].append(
                        {
                            "id": str(uuid7()),
                            "start_time": saved["start_time"],
                            "end_time": saved["end_time"],
                            "task_id": timer["task_id"],
                            "scheduled_session_id": None,
                            "tags": saved.get("tags", timer["tags"]),
                            "notes": saved.get("notes", timer["notes"]),
                        }
                    )
                timer["idle_gaps"].append(
                    {
                        "id": str(uuid7()),
                        "onset": gap.get("idle_start"),
                        "return_at": None,
                        "decision": None,
                        "boundary_source": "legacy_uncertain",
                        "legacy_payload": gap,
                        "task_id": timer["task_id"],
                        "scheduled_session_id": None,
                        "tags": timer["tags"],
                        "notes": timer["notes"],
                    }
                )
            upgraded["timers"][timer["id"]] = timer
        self.write(upgraded)
        return upgraded

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
