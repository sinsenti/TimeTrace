from datetime import UTC, datetime
from typing import Any

from sqlmodel import Session, func, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task
from timetrace.interfaces.api.schemas import ReflectionCreate, RetroSessionCreate, SessionCreate, SessionUpdate
from timetrace.interfaces.api.utils import ensure_utc


class SessionService:
    def __init__(self, db: Session):
        self.db = db

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

    def list_sessions(self, start: datetime | None = None, end: datetime | None = None) -> list[dict[str, Any]]:
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
            result.append(s_dict)
        return result

    def get_session_by_id(self, session_id: str) -> dict[str, Any]:
        s = self.db.get(SessionModel, session_id)
        if not s:
            raise EntityNotFoundError("Session", session_id)

        s_dict = s.model_dump()
        s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
        s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
        if s.task:
            s_dict["task"] = s.task.model_dump()

        return s_dict

    def update_session(self, session_id: str, req: SessionUpdate) -> SessionModel:
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

    def delete_session(self, session_id: str, scope: str = "only_this") -> None:
        db_session = self.db.get(SessionModel, session_id)
        if not db_session:
            raise EntityNotFoundError("Session", session_id)

        if scope == "all" and db_session.task_id:
            sessions_to_del = self.db.exec(
                select(SessionModel).where(SessionModel.task_id == db_session.task_id)
            ).all()
            for s in sessions_to_del:
                self.db.delete(s)
        elif scope == "following" and db_session.task_id and db_session.start_time:
            sessions_to_del = self.db.exec(
                select(SessionModel).where(
                    SessionModel.task_id == db_session.task_id,
                    SessionModel.start_time >= db_session.start_time,
                )
            ).all()
            for s in sessions_to_del:
                self.db.delete(s)
        else:
            self.db.delete(db_session)

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
