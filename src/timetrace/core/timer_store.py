"""Durable JSON and local advisory lock, without database or HTTP dependencies."""

import json
import os
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid7

from timetrace.core.exceptions import ConflictError


def utc_iso(value):
    if value is None:
        return None
    instant = datetime.fromisoformat(value)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=UTC)
    return instant.astimezone(UTC).isoformat()


class TimerStore:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def locked(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.with_suffix(".lock").open("a+b") as lock:
            if os.name == "nt":
                import msvcrt

                if os.fstat(lock.fileno()).st_size == 0:
                    lock.write(b"\x00")
                    lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl

                fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                yield
            finally:
                if os.name == "nt":
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock, fcntl.LOCK_UN)

    def read(self):
        if not self.path.exists():
            return {"version": 2, "revision": 0, "timers": {}, "pending_operation": None}
        try:
            state = json.loads(self.path.read_text(encoding="utf-8"))
        except (ValueError, TypeError) as exc:
            raise ConflictError(
                "Timer JSON is corrupt; preserve it for recovery.", code="reconciliation_required"
            ) from exc
        if not isinstance(state, dict):
            raise ConflictError("Timer state is not an object.", code="reconciliation_required")
        if state.get("version") == 2:
            if (
                not isinstance(state.get("revision"), int)
                or state["revision"] < 0
                or not isinstance(state.get("timers"), dict)
                or "pending_operation" not in state
            ):
                raise ConflictError("Timer generation/state is invalid.", code="reconciliation_required")
            for timer_id, timer in state["timers"].items():
                if (
                    not isinstance(timer, dict)
                    or timer.get("id") != timer_id
                    or timer.get("state") not in {"running", "paused", "frozen", "stopped"}
                    or not isinstance(timer.get("segments"), list)
                    or not isinstance(timer.get("idle_gaps"), list)
                ):
                    raise ConflictError("Timer identity/state is invalid.", code="reconciliation_required")
            return state
        if "is_running" not in state:
            raise ConflictError("Unknown timer format; refusing to overwrite.", code="reconciliation_required")
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
                "running_start": utc_iso(state.get("start_time"))
                if state.get("is_running") and not state.get("is_frozen_idle")
                else None,
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
                            "start_time": utc_iso(saved["start_time"]),
                            "end_time": utc_iso(saved["end_time"]),
                            "task_id": timer["task_id"],
                            "scheduled_session_id": None,
                            "tags": saved.get("tags", timer["tags"]),
                            "notes": saved.get("notes", timer["notes"]),
                        }
                    )
                timer["idle_gaps"].append(
                    {
                        "id": str(uuid7()),
                        "onset": utc_iso(gap.get("idle_start")),
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
            if os.name == "nt":
                # Request replace + write-through from the kernel; do not emulate a POSIX
                # directory fsync by silently swallowing an unsupported directory open.
                import ctypes
                from ctypes import wintypes

                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                move = kernel.MoveFileExW
                move.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD)
                move.restype = wintypes.BOOL
                if not move(str(temporary), str(self.path), 0x1 | 0x8):
                    raise ctypes.WinError(ctypes.get_last_error())
            else:
                os.replace(temporary, self.path)
                directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
