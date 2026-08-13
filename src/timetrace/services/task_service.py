from datetime import UTC, datetime
from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError
from timetrace.db.models import RatingDefinition, RatingEntry, Task, TaskReview
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import TaskCreate, TaskReviewCreate, TaskUpdate
from timetrace.interfaces.api.utils import ensure_utc


class TaskService:
    def __init__(self, db: Session):
        self.db = db

    def create_task(self, req: TaskCreate) -> Task:
        task_dict = req.model_dump(exclude_unset=True)
        if not task_dict.get("color"):
            task_dict["color"] = "auto"

        db_task = Task.model_validate(task_dict)
        if db_task.created_at:
            db_task.created_at = ensure_utc(db_task.created_at).replace(tzinfo=None)

        self.db.add(db_task)
        self.db.commit()
        self.db.refresh(db_task)
        db_task.created_at = ensure_utc(db_task.created_at)
        return db_task

    def list_tasks(self, status_filter: str | None = None, sort_by: str = "priority") -> list[Task]:
        query = select(Task)
        if status_filter and status_filter != "all":
            if status_filter == "hide_completed":
                query = query.where(Task.status != "completed")
            else:
                query = query.where(Task.status == status_filter)

        tasks = self.db.exec(query).all()
        for t in tasks:
            t.created_at = ensure_utc(t.created_at)

        priority_map = {"high": 4, "medium": 3, "low": 2, "-": 1}

        if sort_by == "priority":
            tasks.sort(
                key=lambda t: (
                    priority_map.get(str(t.priority).lower(), 1),
                    -t.created_at.timestamp() if t.created_at else 0
                ),
                reverse=True
            )
        elif sort_by == "created_at":
            tasks.sort(key=lambda t: t.created_at or datetime.min.replace(tzinfo=UTC))
        elif sort_by == "title":
            tasks.sort(key=lambda t: (t.title or "").lower())
        elif sort_by == "status":
            tasks.sort(key=lambda t: (t.status or "").lower())

        return tasks

    def update_task(self, task_id: int, req: TaskUpdate) -> Task:
        db_task = self.db.get(Task, task_id)
        if not db_task:
            raise EntityNotFoundError("Task", task_id)

        update_dict = req.model_dump(exclude_unset=True)
        for key, value in update_dict.items():
            setattr(db_task, key, value)

        if db_task.created_at:
            db_task.created_at = ensure_utc(db_task.created_at).replace(tzinfo=None)

        self.db.add(db_task)
        self.db.commit()
        self.db.refresh(db_task)
        db_task.created_at = ensure_utc(db_task.created_at)
        return db_task

    def delete_task(self, task_id: int) -> None:
        db_task = self.db.get(Task, task_id)
        if not db_task:
            raise EntityNotFoundError("Task", task_id)

        self.db.delete(db_task)
        self.db.commit()

    def delete_completed_tasks(self) -> int:
        completed_tasks = self.db.exec(select(Task).where(Task.status == "completed")).all()
        count = len(completed_tasks)
        for task in completed_tasks:
            self.db.delete(task)
        self.db.commit()
        return count

    def get_task_statistics(self, task_id: int) -> dict[str, Any]:
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)

        sessions = self.db.exec(select(SessionModel).where(SessionModel.task_id == task_id)).all()
        sessions.sort(key=lambda s: ensure_utc(s.start_time) or datetime.min.replace(tzinfo=UTC))

        total_seconds = sum(s.duration_seconds or 0 for s in sessions)
        total_hours = round(total_seconds / 3600.0, 2)

        est_minutes = task.estimated_minutes or 0
        est_hours = round(est_minutes / 60.0, 2)
        progress_pct = round((total_seconds / (est_minutes * 60)) * 100, 1) if est_minutes > 0 else None

        session_list = []
        for s in sessions:
            s_dict = s.model_dump()
            s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
            s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
            session_list.append(s_dict)

        review = self.db.exec(select(TaskReview).where(TaskReview.task_id == task_id)).first()

        task_ratings = self.db.exec(
            select(RatingEntry).where(RatingEntry.target_type == "task", RatingEntry.target_id == str(task_id))
        ).all()

        ratings_detailed = []
        for r in task_ratings:
            r_def = self.db.get(RatingDefinition, r.rating_definition_id)
            r_dict = r.model_dump()
            r_dict["definition"] = r_def.model_dump() if r_def else None
            ratings_detailed.append(r_dict)

        return {
            "task": task.model_dump(),
            "total_hours": total_hours,
            "total_sessions": len(sessions),
            "estimated_hours": est_hours,
            "progress_pct": progress_pct,
            "sessions": session_list,
            "task_review": review.model_dump() if review else None,
            "custom_ratings": ratings_detailed,
        }

    def create_or_update_task_review(self, req: TaskReviewCreate) -> TaskReview:
        task = self.db.get(Task, req.task_id)
        if not task:
            raise EntityNotFoundError("Task", req.task_id)

        existing = self.db.exec(select(TaskReview).where(TaskReview.task_id == req.task_id)).first()
        if existing:
            existing.difficulty = req.difficulty
            existing.what_went_well = req.what_went_well
            existing.blockers = req.blockers
            existing.key_takeaways = req.key_takeaways
            self.db.add(existing)
            self.db.commit()
            self.db.refresh(existing)
            return existing
        else:
            review = TaskReview.model_validate(req.model_dump())
            self.db.add(review)
            self.db.commit()
            self.db.refresh(review)
            return review

    def get_task_review(self, task_id: int) -> TaskReview | None:
        return self.db.exec(select(TaskReview).where(TaskReview.task_id == task_id)).first()
