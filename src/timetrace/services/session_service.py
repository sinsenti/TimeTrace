from datetime import UTC, datetime, timedelta
from typing import Any

from sqlmodel import Session, func, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.core.recurrence import MAX_WINDOW_DAYS, is_occurrence_id
from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task
from timetrace.interfaces.api.schemas import ReflectionCreate, RetroSessionCreate, SessionCreate, SessionUpdate
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.recurrence_service import ProjectedOccurrence, RecurrenceService

EDIT_SCOPES = ("only_this", "all_future")
DELETE_SCOPES = ("only_this", "following", "all")


class SessionService:
    """The single merge funnel for sessions.

    Real `session` rows, projected (virtual) occurrences of recurring tasks and the exception
    table are merged here and nowhere else, so no caller can see half the picture. Synthetic
    occurrence ids (`virt:<task_id>:<stamp>`) are accepted by the GET/PUT/DELETE paths and
    materialized into real rows on write.
    """

    def __init__(self, db: Session):
        self.db = db
        self._recurrence: RecurrenceService | None = None

    @property
    def recurrence(self) -> RecurrenceService:
        if self._recurrence is None:
            self._recurrence = RecurrenceService(self.db)
        return self._recurrence

    def create_session(self, req: SessionCreate) -> SessionModel:
        start_utc = ensure_utc(req.start_time)
        end_utc = ensure_utc(req.end_time)

        if end_utc <= start_utc:
            raise ValidationError("end_time must be strictly after start_time")

        valid_task_id = req.task_id
        if valid_task_id:
            task_obj = self.db.get(Task, valid_task_id)
            if not task_obj:
                valid_task_id = None

        duration = int((end_utc - start_utc).total_seconds())
        db_session = SessionModel(
            task_id=valid_task_id,
            start_time=start_utc.replace(tzinfo=None),
            end_time=end_utc.replace(tzinfo=None),
            duration_seconds=duration,
            tags=req.tags or "",
            notes=req.notes or "",
            review_skipped=req.review_skipped,
        )
        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        db_session.start_time = ensure_utc(db_session.start_time)
        db_session.end_time = ensure_utc(db_session.end_time)
        return db_session

    def list_sessions(
        self,
        start: datetime | None = None,
        end: datetime | None = None,
        include_virtual: bool = True,
    ) -> list[dict[str, Any]]:
        """Real rows merged with projected occurrences.

        Virtuals are only appended when **both** bounds are given: an unbounded projection is
        meaningless, and the unbounded callers (`session_review.js`, `stats.js`,
        `timer_control.js`) are logged-work surfaces.
        """
        query = select(SessionModel)
        if start:
            naive_start = ensure_utc(start).replace(tzinfo=None)
            query = query.where(SessionModel.start_time >= naive_start)
        if end:
            naive_end = ensure_utc(end).replace(tzinfo=None)
            query = query.where(SessionModel.start_time < naive_end)

        sessions = self.db.exec(query).all()
        result = []
        for s in sessions:
            s_dict = s.model_dump()
            if s.start_time:
                s_dict["start_time"] = ensure_utc(s.start_time).isoformat()
            if s.end_time:
                s_dict["end_time"] = ensure_utc(s.end_time).isoformat()
            s_dict["is_virtual"] = False
            result.append(s_dict)

        if start and end and include_virtual:
            if (ensure_utc(end) - ensure_utc(start)) > timedelta(days=MAX_WINDOW_DAYS):
                raise ValidationError(f"Requested range exceeds the maximum of {MAX_WINDOW_DAYS} days.")
            result.extend(occ.to_dict() for occ in self.recurrence.project_range(start, end))
            result.sort(key=lambda item: item.get("start_time") or "")

        return result

    def list_projected_occurrences(
        self, start: datetime, end: datetime
    ) -> list[ProjectedOccurrence]:
        """Projected occurrences only, for callers that already hold the real rows (the
        markdown agenda export). Still goes through this funnel so the rules stay in one place."""
        if (ensure_utc(end) - ensure_utc(start)) > timedelta(days=MAX_WINDOW_DAYS):
            raise ValidationError(f"Requested range exceeds the maximum of {MAX_WINDOW_DAYS} days.")
        return self.recurrence.project_range(start, end)

    def next_upcoming_occurrence(self, within_days: int = 30) -> dict[str, Any] | None:
        """Whichever comes sooner: the earliest real future session row or the next projected
        occurrence. Shape matches `TimerService.get_status()['next_session']`'s needs."""
        now = datetime.now(UTC)
        now_naive = now.replace(tzinfo=None)

        upcoming = self.db.exec(
            select(SessionModel)
            .where(SessionModel.start_time > now_naive)
            .order_by(SessionModel.start_time)
        ).first()

        real_start = ensure_utc(upcoming.start_time) if upcoming and upcoming.start_time else None
        projected = self.recurrence.next_upcoming(within_days=within_days)
        proj_start = ensure_utc(projected.start_utc) if projected else None

        if real_start and (proj_start is None or real_start <= proj_start):
            title = upcoming.notes or upcoming.tags or "Scheduled Session"
            if upcoming.task_id:
                task = self.db.get(Task, upcoming.task_id)
                if task:
                    title = task.title
            return {"title": title, "start_time": real_start, "id": upcoming.id}

        if projected:
            return {
                "title": projected.task_title or "Scheduled Session",
                "start_time": proj_start,
                "id": projected.occurrence_id,
            }
        return None

    def get_session_by_id(self, session_id: str) -> dict[str, Any]:
        if is_occurrence_id(session_id):
            occurrence = self.recurrence.projected_occurrence(session_id)
            s_dict = occurrence.to_dict()
            task = self.db.get(Task, occurrence.task_id)
            if task:
                s_dict["task"] = task.model_dump()
            return s_dict

        s = self.db.get(SessionModel, session_id)
        if not s:
            raise EntityNotFoundError("Session", session_id)

        s_dict = s.model_dump()
        s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
        s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
        if s.task:
            s_dict["task"] = s.task.model_dump()

        return s_dict

    def update_session(
        self, session_id: str, req: SessionUpdate, scope: str = "only_this"
    ) -> SessionModel:
        """Apply an edit, materializing a virtual occurrence first if needed.

        `scope="only_this"` touches this occurrence alone. `scope="all_future"` additionally
        writes the new per-occurrence length to the task's `recurrence_duration_minutes`, so
        every later occurrence inherits it (settled owner decision Q2). A move (changed start)
        is not expressible for a whole series and is rejected for `all_future`.
        """
        if scope not in EDIT_SCOPES:
            raise ValidationError(
                f"scope '{scope}' is not supported for edits -- "
                "use 'only_this' or 'all_future', or edit the recurrence on the task."
            )

        if scope == "all_future":
            self._apply_series_duration(session_id, req)

        if is_occurrence_id(session_id):
            session_id = self.recurrence.materialize(session_id).id

        db_session = self.db.get(SessionModel, session_id)
        if not db_session:
            raise EntityNotFoundError("Session", session_id)

        update_dict = req.model_dump(exclude_unset=True)
        for key, val in update_dict.items():
            if key in ("start_time", "end_time") and val is not None:
                setattr(db_session, key, ensure_utc(val).replace(tzinfo=None))
            elif key == "task_id" and val is not None:
                if self.db.get(Task, val):
                    db_session.task_id = val
                else:
                    db_session.task_id = None
            else:
                setattr(db_session, key, val)

        if db_session.start_time and db_session.end_time:
            st = ensure_utc(db_session.start_time)
            et = ensure_utc(db_session.end_time)
            if et <= st:
                raise ValidationError("end_time must be strictly after start_time")
            db_session.duration_seconds = max(0, int((et - st).total_seconds()))

        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        db_session.start_time = ensure_utc(db_session.start_time)
        db_session.end_time = ensure_utc(db_session.end_time)
        return db_session

    def _apply_series_duration(self, session_id: str, req: SessionUpdate) -> None:
        """Write the requested length to the series' `recurrence_duration_minutes`."""
        if is_occurrence_id(session_id):
            task, occurrence_start = self.recurrence.resolve_occurrence(session_id)
            current_start = occurrence_start
            current_end = occurrence_start + timedelta(minutes=task.recurrence_duration_minutes or 15)
        else:
            row = self.db.get(SessionModel, session_id)
            if not row:
                raise EntityNotFoundError("Session", session_id)
            if not row.task_id:
                raise ValidationError("scope 'all_future' requires a session on a recurring task.")
            task = self.db.get(Task, row.task_id)
            if not task or not task.is_recurring or not task.recurrence_rrule:
                raise ValidationError("scope 'all_future' requires a session on a recurring task.")
            exception = self.recurrence.exception_for_session(row.id)
            current_start = (
                ensure_utc(exception.occurrence_start).replace(tzinfo=None)
                if exception
                else ensure_utc(row.start_time).replace(tzinfo=None)
            )
            current_end = (
                ensure_utc(row.end_time).replace(tzinfo=None)
                if row.end_time
                else current_start + timedelta(minutes=task.recurrence_duration_minutes or 15)
            )

        update_dict = req.model_dump(exclude_unset=True)
        new_start = (
            ensure_utc(update_dict["start_time"]).replace(tzinfo=None)
            if update_dict.get("start_time")
            else current_start
        )
        new_end = (
            ensure_utc(update_dict["end_time"]).replace(tzinfo=None)
            if update_dict.get("end_time")
            else current_end
        )
        if new_end <= new_start:
            raise ValidationError("end_time must be strictly after start_time")
        if new_start != current_start:
            raise ValidationError(
                "scope 'all_future' only changes the occurrence length; "
                "move a single occurrence with scope 'only_this'."
            )

        minutes = max(1, int(round((new_end - new_start).total_seconds() / 60)))
        self.recurrence.set_series_duration(task.id, minutes)

    def delete_session(self, session_id: str, scope: str = "only_this") -> None:
        """Delete one occurrence, or truncate/end a series.

        `following` and `all` never delete a session row whose `start_time` is in the past --
        that was a live data-loss bug (`scope="all"` used to delete *every* session of the task,
        logged history included) reachable from the delete modal.
        """
        if scope not in DELETE_SCOPES:
            raise ValidationError(f"scope '{scope}' is not a valid deletion scope.")

        if is_occurrence_id(session_id):
            task, occurrence_start = self.recurrence.resolve_occurrence(session_id)
            if scope == "only_this":
                self.recurrence.skip(task.id, occurrence_start)
            elif scope == "following":
                self.recurrence.truncate_series(task.id, occurrence_start)
            else:
                self.recurrence.end_series(task.id)
            return

        db_session = self.db.get(SessionModel, session_id)
        if not db_session:
            raise EntityNotFoundError("Session", session_id)

        exception = self.recurrence.exception_for_session(db_session.id)
        task = self.db.get(Task, db_session.task_id) if db_session.task_id else None
        now_naive = datetime.now(UTC).replace(tzinfo=None)
        row_start = ensure_utc(db_session.start_time).replace(tzinfo=None) if db_session.start_time else None

        if scope == "only_this":
            if exception:
                # Keep the RECURRENCE-ID so the occurrence does not re-project.
                exception.kind = "skip"
                exception.session_id = None
                self.db.add(exception)
            self.db.delete(db_session)
            self.db.commit()
            return

        if not task or not task.is_recurring or not task.recurrence_rrule:
            raise ValidationError(f"scope '{scope}' requires a session on a recurring task.")

        anchor = (
            ensure_utc(exception.occurrence_start).replace(tzinfo=None)
            if exception
            else row_start
        )
        if anchor is None:
            raise ValidationError(f"scope '{scope}' requires a session with a start time.")

        if scope == "following":
            self.recurrence.truncate_series(task.id, anchor)
        else:
            self.recurrence.end_series(task.id)

        # The picked row itself: only ever deleted when it is still in the future.
        row = self.db.get(SessionModel, session_id)
        if row and row_start and row_start > now_naive:
            self.db.delete(row)
            self.db.commit()

    def create_retro_session(self, req: RetroSessionCreate) -> SessionModel:
        start_utc = ensure_utc(req.start_time)
        end_utc = ensure_utc(req.end_time)

        if end_utc <= start_utc:
            raise ValidationError("end_time must be strictly after start_time")

        valid_task_id = req.task_id
        if valid_task_id and not self.db.get(Task, valid_task_id):
            valid_task_id = None

        duration = int((end_utc - start_utc).total_seconds())
        db_session = SessionModel(
            task_id=valid_task_id,
            start_time=start_utc.replace(tzinfo=None),
            end_time=end_utc.replace(tzinfo=None),
            duration_seconds=duration,
            tags=req.tags or "",
            notes=req.notes or "",
        )
        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        db_session.start_time = ensure_utc(db_session.start_time)
        db_session.end_time = ensure_utc(db_session.end_time)
        return db_session

    def list_future_sessions(self, task_ids: list[str]) -> list[SessionModel]:
        if not task_ids:
            return []
        now_naive = datetime.now(UTC).replace(tzinfo=None)
        return list(
            self.db.exec(
                select(SessionModel).where(
                    SessionModel.task_id.in_(task_ids),
                    SessionModel.start_time > now_naive,
                )
            ).all()
        )

    def sum_durations_for_tasks(self, task_ids: list[str]) -> tuple[int, int]:
        if not task_ids:
            return (0, 0)

        now_naive = datetime.now(UTC).replace(tzinfo=None)

        logged_seconds = self.db.exec(
            select(func.coalesce(func.sum(SessionModel.duration_seconds), 0)).where(
                SessionModel.task_id.in_(task_ids),
                SessionModel.end_time.is_not(None),
                SessionModel.end_time <= now_naive,
            )
        ).one()

        scheduled_seconds = self.db.exec(
            select(func.coalesce(func.sum(SessionModel.duration_seconds), 0)).where(
                SessionModel.task_id.in_(task_ids),
                SessionModel.start_time > now_naive,
            )
        ).one()

        return (int(logged_seconds), int(scheduled_seconds))

    def clear_future_sessions(self, task_ids: list[str], session_ids: list[str] | None = None) -> list[str]:
        future_sessions = self.list_future_sessions(task_ids)

        if session_ids is not None:
            requested_ids = set(session_ids)
            owned_ids = {
                s.id
                for s in self.db.exec(select(SessionModel).where(SessionModel.task_id.in_(task_ids))).all()
            }
            if not requested_ids.issubset(owned_ids):
                raise ValidationError("session_ids must belong to the task's scheduled sessions")
            to_delete = [s for s in future_sessions if s.id in requested_ids]
        else:
            to_delete = future_sessions

        deleted_ids = [s.id for s in to_delete]
        # Any occurrence materialized into one of these rows becomes a skip, so clearing the
        # schedule does not let the series re-project the work the user just cleared.
        self.recurrence.detach_sessions(deleted_ids)
        for s in to_delete:
            self.db.delete(s)
        self.db.commit()
        return deleted_ids

    def record_reflection(self, req: ReflectionCreate) -> dict[str, Any]:
        db_session = self.db.get(SessionModel, req.session_id)
        if not db_session:
            raise EntityNotFoundError("Session", req.session_id)

        reflection_notes = [f"Energy: {req.energy_level}/5"]
        if req.habits_completed:
            reflection_notes.append(f"Habits: {', '.join(req.habits_completed)}")
        if req.obstacles:
            reflection_notes.append(f"Obstacles: {req.obstacles}")

        additional_note = " | ".join(reflection_notes)
        if db_session.notes:
            db_session.notes = f"{db_session.notes}\n{additional_note}"
        else:
            db_session.notes = additional_note

        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        return {"status": "success", "session_id": db_session.id, "reflection": additional_note}
