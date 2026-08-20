import json
from datetime import UTC, datetime, timedelta
from typing import Any

from timetrace.config import settings
from timetrace.interfaces.api.utils import ensure_utc


class ActiveTimerState:
    def __init__(self):
        self.state_file = settings.db_file.parent / "active_timer.json"
        self.is_running: bool = False
        self.task_id: str | None = None
        self.task_title: str | None = None
        self.start_time: datetime | None = None
        self.tags: str = ""
        self.notes: str = ""
        self.mode: str = "flowtime"
        self.target_minutes: int | None = None

        # Killer switch and idle state
        self.idle_detection_enabled: bool = settings.idle_detection_enabled
        self.idle_threshold_seconds: int = settings.idle_threshold_seconds
        self.is_frozen_idle: bool = False
        self.pending_idle_gap: dict[str, Any] | None = None

        self._load_state()

    def _save_state(self) -> None:
        """Persists current running timer state and idle status to disk."""
        data = {
            "is_running": self.is_running,
            "task_id": self.task_id,
            "task_title": self.task_title,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "tags": self.tags,
            "notes": self.notes,
            "mode": self.mode,
            "target_minutes": self.target_minutes,
            "idle_detection_enabled": self.idle_detection_enabled,
            "idle_threshold_seconds": self.idle_threshold_seconds,
            "is_frozen_idle": self.is_frozen_idle,
            "pending_idle_gap": self.pending_idle_gap,
        }
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps(data), encoding="utf-8")
        except Exception as e:
            print(f"Warning: Failed to persist timer state: {e}")

    def _load_state(self) -> None:
        """Loads running timer state from disk on daemon boot."""
        if not self.state_file.exists():
            return
        try:
            raw = json.loads(self.state_file.read_text(encoding="utf-8"))
            self.idle_detection_enabled = raw.get("idle_detection_enabled", settings.idle_detection_enabled)
            self.idle_threshold_seconds = raw.get("idle_threshold_seconds", settings.idle_threshold_seconds)
            self.is_frozen_idle = raw.get("is_frozen_idle", False)
            self.pending_idle_gap = raw.get("pending_idle_gap")

            if raw.get("is_running") and raw.get("start_time"):
                self.is_running = True
                self.task_id = raw.get("task_id")
                self.task_title = raw.get("task_title")
                self.start_time = ensure_utc(datetime.fromisoformat(raw["start_time"]))
                self.tags = raw.get("tags", "")
                self.notes = raw.get("notes", "")
                self.mode = raw.get("mode", "flowtime")
                self.target_minutes = raw.get("target_minutes")
        except Exception:
            pass

    def toggle_idle_detection(self, enabled: bool | None = None) -> bool:
        """Killer Switch: Toggles the idle detection feature on/off."""
        if enabled is None:
            self.idle_detection_enabled = not self.idle_detection_enabled
        else:
            self.idle_detection_enabled = enabled
        self._save_state()
        return self.idle_detection_enabled

    def freeze_for_idle(self, idle_seconds: float) -> dict[str, Any]:
        """Retroactively freezes the active timer at the exact start of idleness."""
        if not self.is_running or not self.start_time:
            return {}

        now = datetime.now(UTC)
        start_utc = ensure_utc(self.start_time)
        idle_start_time = now - timedelta(seconds=idle_seconds)

        if idle_start_time < start_utc:
            idle_start_time = start_utc

        duration_before_idle = int((idle_start_time - start_utc).total_seconds())

        saved_session = {
            "task_id": self.task_id,
            "task_title": self.task_title,
            "start_time": start_utc.isoformat(),
            "end_time": idle_start_time.isoformat(),
            "duration_seconds": duration_before_idle,
            "tags": self.tags,
            "notes": self.notes,
        }

        self.pending_idle_gap = {
            "idle_start": idle_start_time.isoformat(),
            "idle_end": now.isoformat(),
            "idle_seconds": int(idle_seconds),
            "saved_session": saved_session,
            "task_id": self.task_id,
            "task_title": self.task_title,
            "tags": self.tags,
            "notes": self.notes,
        }

        self.is_running = False
        self.is_frozen_idle = True
        self._save_state()
        return self.pending_idle_gap

    def resolve_idle_gap(self) -> dict[str, Any] | None:
        """Clears frozen idle status after user resolves AFK prompt."""
        gap = self.pending_idle_gap
        self.is_frozen_idle = False
        self.pending_idle_gap = None
        self.task_id = None
        self.task_title = None
        self.start_time = None
        self.tags = ""
        self.notes = ""
        self.mode = "flowtime"
        self.target_minutes = None
        self._save_state()
        return gap

    def start(
        self,
        task_id: str | None = None,
        task_title: str | None = None,
        tags: str = "",
        notes: str = "",
        mode: str = "flowtime",
        target_minutes: int | None = None,
    ) -> dict[str, Any]:
        if self.is_running:
            raise ValueError(
                "Timer is already running. Stop or split current timer first."
            )
        self.is_running = True
        self.is_frozen_idle = False
        self.pending_idle_gap = None
        self.task_id = task_id
        self.task_title = task_title
        self.start_time = datetime.now(UTC)
        self.tags = tags
        self.notes = notes
        self.mode = mode
        self.target_minutes = target_minutes

        self._save_state()
        return self.get_status()

    def split(self, new_tags: str, new_notes: str) -> dict[str, Any]:
        if not self.is_running or not self.start_time:
            raise ValueError("No active timer to split.")

        prev_task_id = self.task_id
        prev_task_title = self.task_title
        prev_mode = self.mode
        prev_target = self.target_minutes

        stopped_summary = self.stop()

        self.start(
            task_id=prev_task_id,
            task_title=prev_task_title,
            tags=new_tags,
            notes=new_notes,
            mode=prev_mode,
            target_minutes=prev_target,
        )
        return stopped_summary

    def stop(self) -> dict[str, Any]:
        if not self.is_running or not self.start_time:
            raise ValueError("No timer is currently active.")

        end_time = datetime.now(UTC)
        start_utc = ensure_utc(self.start_time)
        duration = int((end_time - start_utc).total_seconds())

        session_summary = {
            "task_id": self.task_id,
            "task_title": self.task_title,
            "start_time": start_utc,
            "end_time": end_time,
            "duration_seconds": duration,
            "tags": self.tags,
            "notes": self.notes,
        }

        self.is_running = False
        self.is_frozen_idle = False
        self.pending_idle_gap = None
        self.task_id = None
        self.task_title = None
        self.start_time = None
        self.tags = ""
        self.notes = ""
        self.mode = "flowtime"
        self.target_minutes = None

        self._save_state()
        return session_summary

    def get_status(self) -> dict[str, Any]:
        status_data = {
            "is_running": self.is_running,
            "idle_detection_enabled": self.idle_detection_enabled,
            "idle_threshold_seconds": self.idle_threshold_seconds,
            "is_frozen_idle": self.is_frozen_idle,
            "pending_idle_gap": self.pending_idle_gap,
            "elapsed_seconds": 0,
            "remaining_seconds": None,
            "task_id": self.task_id,
            "task_title": self.task_title,
            "tags": self.tags,
            "notes": self.notes,
            "mode": self.mode,
        }

        if not self.is_running or not self.start_time:
            return status_data

        start_utc = ensure_utc(self.start_time)
        elapsed = int((datetime.now(UTC) - start_utc).total_seconds())
        remaining = None
        if self.mode == "pomodoro" and self.target_minutes:
            target_secs = self.target_minutes * 60
            remaining = max(0, target_secs - elapsed)

        status_data.update({
            "elapsed_seconds": elapsed,
            "remaining_seconds": remaining,
            "start_time": start_utc.isoformat(),
            "target_minutes": self.target_minutes,
        })
        return status_data


timer_manager = ActiveTimerState()
