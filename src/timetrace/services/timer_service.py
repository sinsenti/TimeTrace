from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from threading import RLock
from typing import Any

from sqlmodel import Session

from timetrace.core.exceptions import EntityNotFoundError, TimerError, ValidationError
from timetrace.core.timer import timer_manager
from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task
from timetrace.db.session import lock_sqlite_writer
from timetrace.interfaces.api.schemas import IdleResolveRequest, IdleToggleRequest, TimerSplitRequest, TimerStartRequest
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.session_service import SessionService

_timer_writes = RLock()


class TimerService:
    def __init__(self, db: Session | None):
        self.db = db

    @contextmanager
    def _write(self, *, commit_on_exit: bool = True) -> Iterator[None]:
        # The singleton stays serialized across idle resolution's legacy split commits.
        # SQLite also orders timer context changes against task mutations in other sessions.
        with _timer_writes:
            try:
                lock_sqlite_writer(self.db)
                yield
                if commit_on_exit:
                    self.db.commit()
            except Exception:
                self.db.rollback()
                raise

    def get_status(self) -> dict[str, Any]:
        status_data = timer_manager.get_status()
        if status_data.get("task_id") and not status_data.get("task_title") and self.db is not None:
            task_obj = self.db.get(Task, status_data["task_id"])
            if task_obj:
                status_data["task_title"] = task_obj.title

        upcoming_payload = None
        if not status_data.get("is_running") and self.db is not None:
            now = datetime.now(UTC)
            # Merged: the earliest persisted schedule or the next projected occurrence of a
            # recurring series, whichever is sooner.
            upcoming = SessionService(self.db).next_upcoming_occurrence()
            if upcoming:
                up_start = ensure_utc(upcoming["start_time"])
                upcoming_payload = {
                    "title": upcoming["title"],
                    "start_time": up_start.isoformat(),
                    "starts_in_minutes": max(1, int((up_start - now).total_seconds() / 60)),
                }
        # Keep the existing next_session key for the UI and provide an explicit name for AI
        # consumers. A running timer still reports the next item as null: the active timer is
        # not logged work and must not be presented as a scheduled session.
        status_data["next_session"] = upcoming_payload
        status_data["next_scheduled_session"] = upcoming_payload
        status_data["timer_mode"] = status_data.get("mode")
        status_data["remaining_pomodoro_seconds"] = status_data.get("remaining_seconds")
        return status_data

    def start_timer(self, req: TimerStartRequest) -> dict[str, Any]:
        with self._write():
            task = self.db.get(Task, req.task_id) if req.task_id else None
            if req.task_id and task is None:
                raise EntityNotFoundError("Task", req.task_id)
            try:
                return timer_manager.start(
                    task_id=req.task_id,
                    task_title=task.title if task else None,
                    tags=req.tags,
                    notes=req.notes,
                    mode=req.mode,
                    target_minutes=req.target_minutes,
                )
            except ValueError as exc:
                raise TimerError(str(exc)) from exc

    def split_timer(self, req: TimerSplitRequest) -> SessionModel:
        with self._write():
            try:
                data = timer_manager.split(new_tags=req.new_tags, new_notes=req.new_notes)
            except ValueError as exc:
                raise TimerError(str(exc)) from exc
            row = self._stage_timer_history(data)
        return self._read_timer_history(row)

    def stop_timer(self) -> SessionModel:
        with self._write():
            try:
                data = timer_manager.stop()
            except ValueError as exc:
                raise TimerError(str(exc)) from exc
            row = self._stage_timer_history(data)
        return self._read_timer_history(row)

    def _stage_timer_history(self, data: dict[str, Any]) -> SessionModel:
        row = SessionModel(
            task_id=data["task_id"],
            start_time=ensure_utc(data["start_time"]).replace(tzinfo=None),
            end_time=ensure_utc(data["end_time"]).replace(tzinfo=None),
            duration_seconds=data["duration_seconds"],
            tags=data["tags"],
            notes=data["notes"],
        )
        self.db.add(row)
        return row

    def _read_timer_history(self, row: SessionModel) -> SessionModel:
        self.db.refresh(row)
        row.start_time = ensure_utc(row.start_time)
        row.end_time = ensure_utc(row.end_time)
        return row

    def toggle_idle_detection(self, req: IdleToggleRequest) -> bool:
        with _timer_writes:
            return timer_manager.toggle_idle_detection(req.enabled)

    def freeze_for_idle(self, idle_seconds: float) -> None:
        with _timer_writes:
            if timer_manager.idle_detection_enabled and idle_seconds >= timer_manager.idle_threshold_seconds:
                timer_manager.freeze_for_idle(idle_seconds)

    def resolve_idle_gap(self, req: IdleResolveRequest) -> dict[str, Any]:
        # Preserve this legacy path's existing two commits and commit-before-clear ordering.
        with self._write(commit_on_exit=False):
            return self._resolve_idle_gap(req)

    def _resolve_idle_gap(self, req: IdleResolveRequest) -> dict[str, Any]:
        gap = timer_manager.pending_idle_gap
        if not gap:
            raise ValidationError("No pending idle gap to resolve.")

        saved_data = gap.get("saved_session")
        if saved_data and saved_data.get("duration_seconds", 0) > 0:
            db_work = SessionModel(
                task_id=saved_data.get("task_id"),
                start_time=ensure_utc(datetime.fromisoformat(saved_data["start_time"])).replace(tzinfo=None),
                end_time=ensure_utc(datetime.fromisoformat(saved_data["end_time"])).replace(tzinfo=None),
                duration_seconds=saved_data["duration_seconds"],
                tags=saved_data.get("tags") or "",
                notes=saved_data.get("notes") or "",
            )
            self.db.add(db_work)
            self.db.commit()
            # Frozen task context remains visible until both legacy writes complete.
            lock_sqlite_writer(self.db)

        idle_start = ensure_utc(datetime.fromisoformat(gap["idle_start"])).replace(tzinfo=None)
        idle_end = ensure_utc(datetime.fromisoformat(gap["idle_end"])).replace(tzinfo=None)
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

        elif req.option == "claim_work":
            db_claimed = SessionModel(
                task_id=gap.get("task_id"),
                start_time=idle_start,
                end_time=idle_end,
                duration_seconds=idle_duration,
                tags=gap.get("tags") or "",
                notes=f"Claimed AFK Work: {gap.get('notes', '')}".strip(),
            )
            self.db.add(db_claimed)

        elif req.option == "re_tag":
            db_retag = SessionModel(
                task_id=gap.get("task_id"),
                start_time=idle_start,
                end_time=idle_end,
                duration_seconds=idle_duration,
                tags=req.new_tags or "",
                notes=req.new_notes or "Re-tagged AFK time",
            )
            self.db.add(db_retag)

        self.db.commit()
        timer_manager.resolve_idle_gap()
        return {"status": "success", "option_applied": req.option}
