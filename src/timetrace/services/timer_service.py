from datetime import datetime
from typing import Any

from sqlmodel import Session

from timetrace.core.exceptions import TimerError, ValidationError
from timetrace.core.timer import timer_manager
from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task
from timetrace.interfaces.api.schemas import IdleResolveRequest, IdleToggleRequest, TimerSplitRequest, TimerStartRequest
from timetrace.interfaces.api.utils import ensure_utc


class TimerService:
    def __init__(self, db: Session):
        self.db = db

    def get_status(self) -> dict[str, Any]:
        status_data = timer_manager.get_status()
        if status_data.get("task_id") and not status_data.get("task_title"):
            task_obj = self.db.get(Task, status_data["task_id"])
            if task_obj:
                status_data["task_title"] = task_obj.title
        return status_data

    def start_timer(self, req: TimerStartRequest) -> dict[str, Any]:
        try:
            task_title = None
            if req.task_id:
                t = self.db.get(Task, req.task_id)
                if t:
                    task_title = t.title
            return timer_manager.start(
                task_id=req.task_id,
                task_title=task_title,
                tags=req.tags,
                notes=req.notes,
                mode=req.mode,
                target_minutes=req.target_minutes,
            )
        except ValueError as exc:
            raise TimerError(str(exc)) from exc

    def split_timer(self, req: TimerSplitRequest) -> SessionModel:
        try:
            stopped_data = timer_manager.split(new_tags=req.new_tags, new_notes=req.new_notes)
        except ValueError as exc:
            raise TimerError(str(exc)) from exc

        db_session = SessionModel(
            task_id=stopped_data["task_id"],
            start_time=ensure_utc(stopped_data["start_time"]),
            end_time=ensure_utc(stopped_data["end_time"]),
            duration_seconds=stopped_data["duration_seconds"],
            tags=stopped_data["tags"],
            notes=stopped_data["notes"],
        )
        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        db_session.start_time = ensure_utc(db_session.start_time)
        db_session.end_time = ensure_utc(db_session.end_time)
        return db_session

    def stop_timer(self) -> SessionModel:
        try:
            session_data = timer_manager.stop()
        except ValueError as exc:
            raise TimerError(str(exc)) from exc

        db_session = SessionModel(
            task_id=session_data["task_id"],
            start_time=ensure_utc(session_data["start_time"]),
            end_time=ensure_utc(session_data["end_time"]),
            duration_seconds=session_data["duration_seconds"],
            tags=session_data["tags"],
            notes=session_data["notes"],
        )
        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        db_session.start_time = ensure_utc(db_session.start_time)
        db_session.end_time = ensure_utc(db_session.end_time)
        return db_session

    def toggle_idle_detection(self, req: IdleToggleRequest) -> bool:
        return timer_manager.toggle_idle_detection(req.enabled)

    def resolve_idle_gap(self, req: IdleResolveRequest) -> dict[str, Any]:
        gap = timer_manager.pending_idle_gap
        if not gap:
            raise ValidationError("No pending idle gap to resolve.")

        saved_data = gap.get("saved_session")
        if saved_data and saved_data.get("duration_seconds", 0) > 0:
            db_work = SessionModel(
                task_id=saved_data.get("task_id"),
                start_time=ensure_utc(datetime.fromisoformat(saved_data["start_time"])),
                end_time=ensure_utc(datetime.fromisoformat(saved_data["end_time"])),
                duration_seconds=saved_data["duration_seconds"],
                tags=saved_data.get("tags") or "#general",
                notes=saved_data.get("notes") or "",
            )
            self.db.add(db_work)
            self.db.commit()

        idle_start = ensure_utc(datetime.fromisoformat(gap["idle_start"]))
        idle_end = ensure_utc(datetime.fromisoformat(gap["idle_end"]))
        idle_duration = int((idle_end - idle_start).total_seconds())

        if req.option == "break":
            db_break = SessionModel(
                task_id=gap.get("task_id"),
                start_time=idle_start,
                end_time=idle_end,
                duration_seconds=idle_duration,
                tags="#break",
                notes="AFK Break Time",
            )
            self.db.add(db_break)
            self.db.commit()

        elif req.option == "claim_work":
            db_claimed = SessionModel(
                task_id=gap.get("task_id"),
                start_time=idle_start,
                end_time=idle_end,
                duration_seconds=idle_duration,
                tags=gap.get("tags") or "#general",
                notes=f"Claimed AFK Work: {gap.get('notes', '')}".strip(),
            )
            self.db.add(db_claimed)
            self.db.commit()

        elif req.option == "re_tag":
            db_retag = SessionModel(
                task_id=gap.get("task_id"),
                start_time=idle_start,
                end_time=idle_end,
                duration_seconds=idle_duration,
                tags=req.new_tags or "#general",
                notes=req.new_notes or "Re-tagged AFK time",
            )
            self.db.add(db_retag)
            self.db.commit()

        timer_manager.resolve_idle_gap()
        return {"status": "success", "option_applied": req.option}
