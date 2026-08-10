from datetime import datetime, timezone
from typing import Optional, Dict, Any


class ActiveTimerState:
    def __init__(self):
        self.is_running: bool = False
        self.task_id: Optional[int] = None
        self.task_title: Optional[str] = None
        self.start_time: Optional[datetime] = None
        self.tags: str = ""
        self.notes: str = ""
        self.mode: str = "flowtime"
        self.target_minutes: Optional[int] = None

    def start(
        self,
        task_id: Optional[int] = None,
        task_title: Optional[str] = None,
        tags: str = "",
        notes: str = "",
        mode: str = "flowtime",
        target_minutes: Optional[int] = None,
    ) -> Dict[str, Any]:
        if self.is_running:
            raise ValueError(
                "Timer is already running. Stop or split current timer first."
            )
        self.is_running = True
        self.task_id = task_id
        self.task_title = task_title
        self.start_time = datetime.now(timezone.utc)
        self.tags = tags
        self.notes = notes
        self.mode = mode
        self.target_minutes = target_minutes
        return self.get_status()

    def split(self, new_tags: str, new_notes: str) -> Dict[str, Any]:
        if not self.is_running or not self.start_time:
            raise ValueError("No active timer to split.")

        stopped_summary = self.stop()
        self.start(
            task_id=stopped_summary["task_id"],
            task_title=stopped_summary.get("task_title"),
            tags=new_tags,
            notes=new_notes,
            mode=self.mode,
        )
        return stopped_summary

    def stop(self) -> Dict[str, Any]:
        if not self.is_running or not self.start_time:
            raise ValueError("No timer is currently active.")

        end_time = datetime.now(timezone.utc)
        duration = int((end_time - self.start_time).total_seconds())

        session_summary = {
            "task_id": self.task_id,
            "task_title": self.task_title,
            "start_time": self.start_time,
            "end_time": end_time,
            "duration_seconds": duration,
            "tags": self.tags,
            "notes": self.notes,
        }

        self.is_running = False
        self.task_id = None
        self.task_title = None
        self.start_time = None
        self.tags = ""
        self.notes = ""
        self.mode = "flowtime"
        self.target_minutes = None

        return session_summary

    def get_status(self) -> Dict[str, Any]:
        if not self.is_running or not self.start_time:
            return {
                "is_running": False,
                "elapsed_seconds": 0,
                "remaining_seconds": None,
                "task_id": None,
                "task_title": None,
                "tags": "",
                "notes": "",
                "mode": "flowtime",
            }

        elapsed = int((datetime.now(timezone.utc) - self.start_time).total_seconds())
        remaining = None
        if self.mode == "pomodoro" and self.target_minutes:
            target_secs = self.target_minutes * 60
            remaining = max(0, target_secs - elapsed)

        return {
            "is_running": True,
            "elapsed_seconds": elapsed,
            "remaining_seconds": remaining,
            "task_id": self.task_id,
            "task_title": self.task_title,
            "start_time": self.start_time.isoformat(),
            "tags": self.tags,
            "notes": self.notes,
            "mode": self.mode,
            "target_minutes": self.target_minutes,
        }


timer_manager = ActiveTimerState()
