from datetime import datetime, timezone
from typing import Optional, Dict, Any


class ActiveTimerState:
    def __init__(self):
        self.is_running: bool = False
        self.task_id: Optional[int] = None
        self.start_time: Optional[datetime] = None
        self.tags: str = ""
        self.notes: str = ""

    def start(self, task_id: Optional[int] = None, tags: str = "", notes: str = "") -> Dict[str, Any]:
        if self.is_running:
            raise ValueError("Timer is already running. Please stop current active timer first.")
        self.is_running = True
        self.task_id = task_id
        self.start_time = datetime.now(timezone.utc)
        self.tags = tags
        self.notes = notes
        return self.get_status()

    def stop(self) -> Dict[str, Any]:
        if not self.is_running or not self.start_time:
            raise ValueError("No timer is currently active.")
        
        end_time = datetime.now(timezone.utc)
        duration = int((end_time - self.start_time).total_seconds())

        session_summary = {
            "task_id": self.task_id,
            "start_time": self.start_time,
            "end_time": end_time,
            "duration_seconds": duration,
            "tags": self.tags,
            "notes": self.notes
        }

        self.is_running = False
        self.task_id = None
        self.start_time = None
        self.tags = ""
        self.notes = ""

        return session_summary

    def get_status(self) -> Dict[str, Any]:
        if not self.is_running or not self.start_time:
            return {
                "is_running": False,
                "elapsed_seconds": 0,
                "task_id": None,
                "tags": "",
                "notes": ""
            }
        
        elapsed = int((datetime.now(timezone.utc) - self.start_time).total_seconds())
        return {
            "is_running": True,
            "elapsed_seconds": elapsed,
            "task_id": self.task_id,
            "start_time": self.start_time.isoformat(),
            "tags": self.tags,
            "notes": self.notes
        }


timer_manager = ActiveTimerState()
