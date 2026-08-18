import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError
from timetrace.db.models import RatingDefinition, RatingEntry, Task, TaskReview, TaskStatus
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import TaskCreate, TaskReviewCreate, TaskStatusCreate, TaskStatusUpdate, TaskUpdate
from timetrace.interfaces.api.utils import ensure_utc


def parse_title_estimation(title: str) -> tuple[str, int | None]:
    """Extracts estimation tags like [30min], [45m], [1h] from title string."""
    match = re.search(r"\[(\d+(?:\.\d+)?)\s*(min|mins|m|h|hours|hour)?\]", title, re.IGNORECASE)
    if match:
        val = float(match.group(1))
        unit = (match.group(2) or "m").lower()
        est_minutes = int(val * 60) if unit in ("h", "hour", "hours") else int(val)
        clean_title = re.sub(r"\[\d+(?:\.\d+)?\s*(?:min|mins|m|h|hours|hour)?\]", "", title, flags=re.IGNORECASE).strip()
        return clean_title, est_minutes
    return title, None


class TaskService:
    def __init__(self, db: Session):
        self.db = db

    def list_statuses(self) -> list[TaskStatus]:
        statuses = self.db.exec(select(TaskStatus).order_by(TaskStatus.position)).all()
        if not statuses:
            defaults = [
                TaskStatus(name="To Do", is_completed=False, is_hide_by_default=False, is_scheduled_trigger=False, color="#2563eb", position=0),
                TaskStatus(name="Ongoing", is_completed=False, is_hide_by_default=False, is_scheduled_trigger=False, color="#d97706", position=1),
                TaskStatus(name="Scheduled", is_completed=False, is_hide_by_default=False, is_scheduled_trigger=True, color="#7c3aed", position=2),
                TaskStatus(name="Done", is_completed=True, is_hide_by_default=True, is_scheduled_trigger=False, color="#059669", position=3),
                TaskStatus(name="Backlog", is_completed=False, is_hide_by_default=False, is_scheduled_trigger=False, color="#64748b", position=4),
            ]
            for st in defaults:
                self.db.add(st)
            self.db.commit()
            statuses = self.db.exec(select(TaskStatus).order_by(TaskStatus.position)).all()
        return statuses

    def create_status(self, req: TaskStatusCreate) -> TaskStatus:
        st = TaskStatus.model_validate(req.model_dump())
        self.db.add(st)
        self.db.commit()
        self.db.refresh(st)
        return st

    def update_status(self, status_id: int, req: TaskStatusUpdate) -> TaskStatus:
        st = self.db.get(TaskStatus, status_id)
        if not st:
            raise EntityNotFoundError("TaskStatus", status_id)
        for k, v in req.model_dump(exclude_unset=True).items():
            setattr(st, k, v)
        self.db.add(st)
        self.db.commit()
        self.db.refresh(st)
        return st

    def delete_status(self, status_id: int) -> None:
        st = self.db.get(TaskStatus, status_id)
        if not st:
            raise EntityNotFoundError("TaskStatus", status_id)
        self.db.delete(st)
        self.db.commit()

    def create_task(self, req: TaskCreate) -> Task:
        task_dict = req.model_dump(exclude_unset=True)
        clean_title, parsed_est = parse_title_estimation(task_dict["title"])
        task_dict["title"] = clean_title
        if parsed_est is not None:
            task_dict["estimated_minutes"] = parsed_est

        if not task_dict.get("color"):
            task_dict["color"] = "auto"

        if task_dict.get("status"):
            st = self.db.exec(select(TaskStatus).where(TaskStatus.name == task_dict["status"])).first()
            if st:
                task_dict["status_id"] = st.id

        db_task = Task.model_validate(task_dict)
        if db_task.created_at:
            db_task.created_at = ensure_utc(db_task.created_at).replace(tzinfo=None)
        if db_task.due_date:
            db_task.due_date = ensure_utc(db_task.due_date).replace(tzinfo=None)

        self.db.add(db_task)
        self.db.commit()
        self.db.refresh(db_task)
        db_task.created_at = ensure_utc(db_task.created_at)
        db_task.due_date = ensure_utc(db_task.due_date)

        if db_task.is_recurring:
            self.schedule_recurrent_sessions_three_months(db_task)

        return db_task

    def schedule_recurrent_sessions_three_months(self, task: Task) -> list[SessionModel]:
        """Schedules recurring sessions 3 months (90 days) ahead."""
        if not task.id or not task.is_recurring:
            return []

        start_base = datetime.now(UTC)
        if task.assigned_date:
            try:
                dt_str = str(task.assigned_date).replace(' ', 'T')
                if 'T' not in dt_str:
                    dt_str = f"{dt_str}T09:00:00"
                start_base = datetime.fromisoformat(dt_str).replace(tzinfo=UTC)
            except Exception:
                pass

        rule = (task.recurrence_rule or "daily").lower()
        duration_mins = task.estimated_minutes or 15

        created_sessions = []
        curr_date = start_base
        end_boundary = start_base + timedelta(days=90)

        while curr_date <= end_boundary:
            curr_naive = curr_date.replace(tzinfo=None)
            existing = self.db.exec(
                select(SessionModel).where(
                    SessionModel.task_id == task.id,
                    SessionModel.start_time == curr_naive
                )
            ).first()

            if not existing:
                sess = SessionModel(
                    task_id=task.id,
                    start_time=ensure_utc(curr_date),
                    end_time=ensure_utc(curr_date + timedelta(minutes=duration_mins)),
                    duration_seconds=duration_mins * 60,
                    tags=task.tags or "#general",
                    notes=f"Recurring: {task.title}",
                )
                self.db.add(sess)
                created_sessions.append(sess)

            if rule == "daily":
                curr_date += timedelta(days=1)
            elif rule == "weekdays":
                curr_date += timedelta(days=1)
                while curr_date.weekday() >= 5:
                    curr_date += timedelta(days=1)
            elif rule == "weekly":
                curr_date += timedelta(weeks=1)
            elif rule == "monthly":
                curr_date += timedelta(days=30)
            else:
                curr_date += timedelta(days=1)

        self.db.commit()
        return created_sessions

    def list_tasks(
        self,
        status_filter: str | None = None,
        sort_by: str = "smart_gap_filler",
        category_filter: str | None = None,
        assigned_date: str | None = None,
        due_before: str | None = None,
    ) -> list[Task]:
        all_db_tasks = self.db.exec(select(Task)).all()
        status_map = {
            "in_progress": "To Do",
            "in progress": "To Do",
            "ip": "To Do",
            "completed": "Done",
            "done": "Done",
            "c": "Done",
            "ongoing": "Ongoing",
            "og": "Ongoing"
        }
        needs_commit = False
        for t in all_db_tasks:
            if t.status in status_map:
                t.status = status_map[t.status]
                needs_commit = True
            elif not t.status:
                t.status = "To Do"
                needs_commit = True

        if needs_commit:
            self.db.commit()

        query = select(Task)

        if status_filter and status_filter != "all":
            if status_filter == "hide_completed":
                query = query.where(Task.status.notin_(["Done", "completed", "done"]))
            else:
                query = query.where(Task.status == status_filter)

        if category_filter and category_filter != "all":
            query = query.where(Task.category == category_filter)

        if assigned_date:
            query = query.where(Task.assigned_date.like(f"{assigned_date}%"))

        if due_before:
            try:
                due_dt = datetime.fromisoformat(due_before)
                query = query.where(Task.due_date <= due_dt)
            except Exception:
                pass

        tasks = self.db.exec(query).all()
        for t in tasks:
            t.created_at = ensure_utc(t.created_at)
            t.due_date = ensure_utc(t.due_date)

        priority_map = {"high": 3, "medium": 2, "low": 1, "-": 0}

        if sort_by == "smart_gap_filler":
            def smart_score(t: Task) -> tuple:
                status_lower = (t.status or "").lower()
                is_scheduled = status_lower == "scheduled"
                is_ongoing = status_lower == "ongoing"
                is_done = status_lower in ("completed", "done")
                prio_val = priority_map.get(str(t.priority).lower(), 0)
                
                due_ts = ensure_utc(t.due_date).timestamp() if t.due_date else float('inf')
                created_ts = t.created_at.timestamp() if t.created_at else 0

                group = 5
                if not is_scheduled and not is_done:
                    if prio_val == 3:
                        group = 1
                    elif prio_val == 2:
                        group = 2
                    elif is_ongoing:
                        group = 3
                    else:
                        group = 4
                elif is_scheduled:
                    group = 6
                elif is_done:
                    group = 7

                return (group, -prio_val, due_ts, created_ts)

            tasks.sort(key=smart_score)
        elif sort_by == "priority":
            tasks.sort(
                key=lambda t: (
                    priority_map.get(str(t.priority).lower(), 0),
                    -(ensure_utc(t.due_date).timestamp() if t.due_date else float('inf')),
                    -t.created_at.timestamp() if t.created_at else 0
                ),
                reverse=True
            )
        elif sort_by == "created_at":
            tasks.sort(key=lambda t: t.created_at or datetime.min.replace(tzinfo=UTC))
        elif sort_by == "title":
            tasks.sort(key=lambda t: (t.title or "").lower())

        return tasks

    def update_task(self, task_id: int, req: TaskUpdate) -> Task:
        db_task = self.db.get(Task, task_id)
        if not db_task:
            raise EntityNotFoundError("Task", task_id)

        update_dict = req.model_dump(exclude_unset=True)

        if "title" in update_dict and update_dict["title"]:
            clean_title, parsed_est = parse_title_estimation(update_dict["title"])
            update_dict["title"] = clean_title
            if parsed_est is not None:
                update_dict["estimated_minutes"] = parsed_est

        for key, value in update_dict.items():
            if key == "due_date":
                setattr(db_task, key, ensure_utc(value).replace(tzinfo=None) if value else None)
            else:
                setattr(db_task, key, value)

        if "status" in update_dict:
            st = self.db.exec(select(TaskStatus).where(TaskStatus.name == update_dict["status"])).first()
            if st:
                db_task.status_id = st.id

        if update_dict.get("status") in ("Done", "completed") and db_task.is_recurring:
            self.handle_task_recurrence(db_task)

        if db_task.is_recurring:
            self.schedule_recurrent_sessions_three_months(db_task)

        if db_task.created_at:
            db_task.created_at = ensure_utc(db_task.created_at).replace(tzinfo=None)
        if db_task.due_date:
            db_task.due_date = ensure_utc(db_task.due_date).replace(tzinfo=None)

        self.db.add(db_task)
        self.db.commit()
        self.db.refresh(db_task)
        db_task.created_at = ensure_utc(db_task.created_at)
        db_task.due_date = ensure_utc(db_task.due_date)
        return db_task

    def handle_task_recurrence(self, task: Task) -> None:
        today = date.today()
        rule = (task.recurrence_rule or "daily").lower()

        if rule == "daily":
            next_date = today + timedelta(days=1)
        elif rule == "weekdays":
            next_date = today + timedelta(days=1)
            while next_date.weekday() >= 5:
                next_date += timedelta(days=1)
        elif rule == "weekly":
            next_date = today + timedelta(weeks=1)
        else:
            next_date = today + timedelta(days=1)

        task.assigned_date = next_date.strftime("%Y-%m-%d")
        task.status = "To Do"

    def delete_task(self, task_id: int) -> None:
        db_task = self.db.get(Task, task_id)
        if not db_task:
            raise EntityNotFoundError("Task", task_id)

        linked_sessions = self.db.exec(select(SessionModel).where(SessionModel.task_id == task_id)).all()
        for s in linked_sessions:
            s.task_id = None
            self.db.add(s)

        self.db.delete(db_task)
        self.db.commit()

    def delete_completed_tasks(self) -> int:
        completed_tasks = self.db.exec(select(Task).where(Task.status.in_(["Done", "completed", "done"]))).all()
        count = len(completed_tasks)
        for task in completed_tasks:
            linked_sessions = self.db.exec(select(SessionModel).where(SessionModel.task_id == task.id)).all()
            for s in linked_sessions:
                s.task_id = None
                self.db.add(s)
            self.db.delete(task)
        self.db.commit()
        return count

    def get_task_tree(self, task_id: int) -> dict[str, Any]:
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)

        def build_node(t: Task) -> dict[str, Any]:
            subtasks = self.db.exec(select(Task).where(Task.parent_id == t.id)).all()
            return {
                "id": t.id,
                "title": t.title,
                "description": t.description,
                "priority": t.priority,
                "status": t.status,
                "category": t.category,
                "estimated_minutes": t.estimated_minutes,
                "due_date": ensure_utc(t.due_date).isoformat() if t.due_date else None,
                "assigned_date": t.assigned_date,
                "attachments": t.attachments,
                "is_recurring": t.is_recurring,
                "recurrence_rule": t.recurrence_rule,
                "color": t.color,
                "tags": t.tags,
                "parent_id": t.parent_id,
                "created_at": ensure_utc(t.created_at).isoformat() if t.created_at else "",
                "subtasks": [build_node(child) for child in subtasks]
            }

        return build_node(task)

    def get_task_statistics(self, task_id: int) -> dict[str, Any]:
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)

        task.created_at = ensure_utc(task.created_at)
        task.due_date = ensure_utc(task.due_date)

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

        task_data = task.model_dump()
        if task.due_date:
            task_data["due_date"] = ensure_utc(task.due_date).isoformat()

        return {
            "task": task_data,
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
