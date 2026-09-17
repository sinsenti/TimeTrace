import re
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import sqlalchemy as sa
from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.core.inline_parser import parse_inline_task
from timetrace.core.timezones import daemon_tzinfo, to_local_naive
from timetrace.db.models import RatingDefinition, RatingEntry, Task, TaskReview, TaskStatus
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import (
    ClearScheduledSessionsRequest,
    ClearScheduledSessionsResponse,
    CompletionPolicyPrompt,
    ScheduledSessionInfo,
    TaskCreate,
    TaskReadResponse,
    TaskReviewCreate,
    TaskStatusCreate,
    TaskStatusUpdate,
    TaskUpdate,
    TaskWithPolicyResponse,
)
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.recurrence_service import RecurrenceService
from timetrace.services.session_service import SessionService


def parse_title_estimation(title: str) -> tuple[str, int | None]:
    match = re.search(r"\[(\d+(?:\.\d+)?)\s*(min|mins|m|h|hours|hour|d|day|days)?\]", title, re.IGNORECASE)
    if match:
        val = float(match.group(1))
        unit = (match.group(2) or "m").lower()
        if unit in ("d", "day", "days"):
            est_minutes = int(val * 1440)
        elif unit in ("h", "hour", "hours"):
            est_minutes = int(val * 60)
        else:
            est_minutes = int(val)
        clean_title = re.sub(
            r"\[\d+(?:\.\d+)?\s*(?:min|mins|m|h|hours|hour|d|day|days)?\]", "", title, flags=re.IGNORECASE
        ).strip()
        return clean_title, est_minutes
    return title, None


def apply_quick_task_syntax(task_dict: dict) -> datetime | None:
    quick = parse_inline_task(task_dict.get("title") or "")
    if not quick:
        return None

    task_dict["title"] = quick["title"]
    if quick.get("tags"):
        task_dict["tags"] = quick["tags"]
    if quick.get("priority") and quick["priority"] != "-":
        task_dict["priority"] = quick["priority"]
    if quick.get("description"):
        task_dict["description"] = quick["description"]
    if quick.get("due_date") is not None:
        task_dict["due_date"] = quick["due_date"]
    if quick.get("assigned_date") is not None:
        task_dict["assigned_date"] = quick["assigned_date"]
    return quick.get("schedule_session_at")


class TaskService:
    def __init__(self, db: Session):
        self.db = db

    def list_statuses(self) -> list[TaskStatus]:
        statuses = self.db.exec(select(TaskStatus).order_by(TaskStatus.position)).all()
        if not statuses:
            defaults = [
                TaskStatus(
                    name="To Do",
                    is_completed=False,
                    is_hide_by_default=False,
                    is_scheduled_trigger=False,
                    color="#2563eb",
                    position=0,
                ),
                TaskStatus(
                    name="Ongoing",
                    is_completed=False,
                    is_hide_by_default=False,
                    is_scheduled_trigger=False,
                    color="#d97706",
                    position=1,
                ),
                TaskStatus(
                    name="Scheduled",
                    is_completed=False,
                    is_hide_by_default=False,
                    is_scheduled_trigger=True,
                    color="#7c3aed",
                    position=2,
                ),
                TaskStatus(
                    name="Done",
                    is_completed=True,
                    is_hide_by_default=True,
                    is_scheduled_trigger=False,
                    color="#059669",
                    position=3,
                ),
                TaskStatus(
                    name="Backlog",
                    is_completed=False,
                    is_hide_by_default=False,
                    is_scheduled_trigger=False,
                    color="#64748b",
                    position=4,
                ),
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

    def update_status(self, status_id: str, req: TaskStatusUpdate) -> TaskStatus:
        st = self.db.get(TaskStatus, status_id)
        if not st:
            raise EntityNotFoundError("TaskStatus", status_id)
        for k, v in req.model_dump(exclude_unset=True).items():
            setattr(st, k, v)
        self.db.add(st)
        self.db.commit()
        self.db.refresh(st)
        return st

    def delete_status(self, status_id: str) -> None:
        st = self.db.get(TaskStatus, status_id)
        if not st:
            raise EntityNotFoundError("TaskStatus", status_id)
        self.db.delete(st)
        self.db.commit()

    def _inherit_parent_tags(self, task_dict: dict) -> None:
        parent_id = task_dict.get("parent_id")
        if not parent_id or (task_dict.get("tags") or "").strip():
            return
        parent = self.db.get(Task, parent_id)
        if parent and parent.tags:
            task_dict["tags"] = parent.tags

    def create_task(self, req: TaskCreate, parse_title_syntax: bool = True) -> Task:
        task_dict = req.model_dump(exclude_unset=True)
        schedule_session_at = None
        # `parse_title_syntax=False` is for the AI draft engine restoring an exact prior
        # snapshot (recreating a task an undo is reversing a delete of) -- a human-authored
        # title that happens to contain `#tag`/`!high`/`(desc)`/`due:3d`/`[15m]` syntax must
        # come back exactly as it was, not get silently re-mangled by this parser a second time.
        if parse_title_syntax:
            schedule_session_at = apply_quick_task_syntax(task_dict)
            clean_title, parsed_est = parse_title_estimation(task_dict["title"])
            task_dict["title"] = clean_title
            if parsed_est is not None:
                task_dict["estimated_minutes"] = parsed_est

        self._inherit_parent_tags(task_dict)

        if not task_dict.get("color"):
            task_dict["color"] = "auto"

        if task_dict.get("status"):
            st = self.db.exec(select(TaskStatus).where(TaskStatus.name == task_dict["status"])).first()
            if st:
                task_dict["status_id"] = st.id
        elif task_dict.get("status_id"):
            st = self.db.get(TaskStatus, task_dict["status_id"])
            if st:
                task_dict["status"] = st.name

        db_task = Task.model_validate(task_dict)
        if db_task.created_at:
            db_task.created_at = ensure_utc(db_task.created_at).replace(tzinfo=None)
        if db_task.due_date:
            db_task.due_date = ensure_utc(db_task.due_date).replace(tzinfo=None)

        self.db.add(db_task)

        if schedule_session_at is not None:
            self._create_scheduled_session(db_task, schedule_session_at)

        # Recurring tasks pre-generate nothing: one RRULE is stored and occurrences are
        # projected on read (RecurrenceService).
        RecurrenceService(self.db).apply_recurrence_fields(db_task, task_dict)

        self.db.commit()
        self.db.refresh(db_task)
        db_task.created_at = ensure_utc(db_task.created_at)
        db_task.due_date = ensure_utc(db_task.due_date)

        return db_task

    def _create_scheduled_session(self, task: Task, start_at: datetime) -> SessionModel:
        est = task.estimated_minutes or 15
        duration_mins = 30 if est > 120 else est
        start_utc = ensure_utc(start_at)
        end_utc = start_utc + timedelta(minutes=duration_mins)
        session = SessionModel(
            task_id=task.id,
            start_time=start_utc.replace(tzinfo=None),
            end_time=end_utc.replace(tzinfo=None),
            duration_seconds=duration_mins * 60,
            tags=task.tags or "",
            notes=f"Scheduled: {task.title}",
        )
        self.db.add(session)
        return session

    def list_tasks(
        self,
        status_filter: str | None = None,
        sort_by: str = "smart_gap_filler",
        category_filter: str | None = None,
        assigned_date: str | None = None,
        due_before: str | None = None,
    ) -> list[TaskReadResponse]:
        query = select(Task)

        if status_filter and status_filter != "all":
            if status_filter == "hide_completed":
                query = query.where(Task.status.notin_(["Done", "completed", "done"]))
            elif status_filter.lower() in ("in_progress", "in progress", "ip"):
                query = query.where(Task.status.in_(["To Do", "in_progress", "in progress", "ip"]))
            elif status_filter.lower() in ("completed", "done", "c"):
                query = query.where(Task.status.in_(["Done", "completed", "done", "c"]))
            else:
                query = query.where(Task.status == status_filter)

        if category_filter and category_filter != "all":
            query = query.where(Task.category == category_filter)

        if assigned_date:
            query = query.where(Task.assigned_date.like(f"{assigned_date}%"))

        if due_before:
            try:
                due_dt = datetime.fromisoformat(due_before).replace(tzinfo=None)
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

                due_ts = ensure_utc(t.due_date).timestamp() if t.due_date else float("inf")
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
                    -(ensure_utc(t.due_date).timestamp() if t.due_date else float("inf")),
                    -t.created_at.timestamp() if t.created_at else 0,
                ),
                reverse=True,
            )
        elif sort_by == "created_at":
            tasks.sort(key=lambda t: t.created_at or datetime.min.replace(tzinfo=UTC))
        elif sort_by == "title":
            tasks.sort(key=lambda t: (t.title or "").lower())

        out: list[TaskReadResponse] = []
        for t in tasks:
            item = TaskReadResponse.model_validate(t)
            item.next_occurrence_date = self._next_occurrence_date(t)
            out.append(item)
        return out

    def _next_occurrence_date(self, task: Task) -> str | None:
        """Local `YYYY-MM-DD` of a recurring task's next projected occurrence, else None.

        Settled owner decision Q1: the Target Day badge follows the RRULE instead of a stored
        date that completion used to bump (the second anchoring scheme that doubled the live
        series). This is carried in its own read-only response field -- it must never overwrite
        `task.assigned_date`, which is what the previous implementation did in memory.
        """
        if not task.is_recurring or not task.recurrence_rrule:
            return None
        occurrence = RecurrenceService(self.db).next_occurrence_for_task(task)
        if not occurrence:
            return None
        return to_local_naive(occurrence.start_utc, daemon_tzinfo()).date().strftime("%Y-%m-%d")

    def update_task(self, task_id: str, req: TaskUpdate, parse_title_syntax: bool = True) -> TaskWithPolicyResponse:
        db_task = self.db.get(Task, task_id)
        if not db_task:
            raise EntityNotFoundError("Task", task_id)

        old_status_name = db_task.status

        update_dict = req.model_dump(exclude_unset=True)
        schedule_session_at = None

        # `parse_title_syntax=False` is for the AI draft engine restoring an exact prior
        # snapshot (undoing an AI-accepted change) -- confirmed live: undo sends the FULL
        # applied_before_json snapshot back through this method, including a human-authored
        # title. Re-running the quick-add parser on it a second time silently rewrote the title
        # and overwrote description/tags/estimated_minutes with whatever `#tag`/`(desc)`/`[15m]`
        # syntax the title coincidentally contained -- restoring something other than what was
        # actually there before, exactly the failure mode this feature's whole draft-layer design
        # exists to prevent.
        if parse_title_syntax and "title" in update_dict and update_dict["title"]:
            schedule_session_at = apply_quick_task_syntax(update_dict)
            clean_title, parsed_est = parse_title_estimation(update_dict["title"])
            update_dict["title"] = clean_title
            if parsed_est is not None:
                update_dict["estimated_minutes"] = parsed_est

        for key, value in update_dict.items():
            if key == "due_date":
                setattr(db_task, key, ensure_utc(value).replace(tzinfo=None) if value else None)
            else:
                setattr(db_task, key, value)

        if "status" in update_dict and update_dict["status"]:
            st = self.db.exec(select(TaskStatus).where(TaskStatus.name == update_dict["status"])).first()
            if st:
                db_task.status_id = st.id
        elif "status_id" in update_dict and update_dict["status_id"]:
            st = self.db.get(TaskStatus, update_dict["status_id"])
            if st:
                db_task.status = st.name

        recurrence = RecurrenceService(self.db)
        if db_task.is_recurring:
            now_completed_status, _ = self._status_flags(db_task.status)
            if now_completed_status:
                self._reset_recurring_task_status(db_task)

        if schedule_session_at is not None:
            self._create_scheduled_session(db_task, schedule_session_at)

        recurrence.apply_recurrence_fields(db_task, update_dict)

        if db_task.created_at:
            db_task.created_at = ensure_utc(db_task.created_at).replace(tzinfo=None)
        if db_task.due_date:
            db_task.due_date = ensure_utc(db_task.due_date).replace(tzinfo=None)

        self.db.add(db_task)
        self.db.commit()
        self.db.refresh(db_task)
        db_task.created_at = ensure_utc(db_task.created_at)
        db_task.due_date = ensure_utc(db_task.due_date)

        if RecurrenceService.touches_recurrence(update_dict):
            recurrence.reconcile_series(db_task.id)

        policy = None
        if not db_task.is_recurring:
            was_completed, was_scheduled = self._status_flags(old_status_name)
            now_completed, now_scheduled = self._status_flags(db_task.status)
            if not was_completed and now_completed:
                policy = self._build_completion_policy(db_task, "completed")
            elif was_scheduled and not now_scheduled and not now_completed:
                policy = self._build_completion_policy(db_task, "left_scheduled")

        declared_fields = set(TaskWithPolicyResponse.model_fields) - {"completion_policy", "next_occurrence_date"}
        task_data = {k: v for k, v in db_task.model_dump().items() if k in declared_fields}
        return TaskWithPolicyResponse(
            **task_data,
            completion_policy=policy,
            next_occurrence_date=self._next_occurrence_date(db_task),
        )

    def _reset_recurring_task_status(self, task: Task) -> None:
        """Completing a recurring task only makes it actionable again.

        It deliberately does **not** advance `assigned_date` (the old `handle_task_recurrence`
        did, at a hardcoded 09:00) -- that was a second, competing schedule anchor and it is
        what doubled the live series. `recurrence_dtstart` is immutable; the RRULE alone decides
        when the next occurrence is, and the Target Day badge is derived from it in `list_tasks`.
        """
        statuses = self.db.exec(
            select(TaskStatus).where(TaskStatus.is_completed == False).order_by(TaskStatus.position)  # noqa: E712
        ).all()
        target = statuses[0] if statuses else None
        if target:
            task.status = target.name
            task.status_id = target.id
            return

        task.status = "To Do"
        st = self.db.exec(select(TaskStatus).where(TaskStatus.name == "To Do")).first()
        if st:
            task.status_id = st.id

    def _get_all_descendant_task_ids(self, task_id: str) -> set[str]:
        ids = {task_id}
        subtask_ids = self.db.exec(select(Task.id).where(Task.parent_id == task_id)).all()
        for sub_id in subtask_ids:
            ids.update(self._get_all_descendant_task_ids(sub_id))
        return ids

    def _status_flags(self, name: str | None) -> tuple[bool, bool]:
        if name is None:
            return (False, False)

        st = self.db.exec(select(TaskStatus).where(TaskStatus.name == name)).first()
        if st:
            return (st.is_completed, st.is_scheduled_trigger)

        lname = name.lower()
        return (lname in {"done", "completed"}, lname == "scheduled")

    def _collect_subtree_ids(self, task_id: str) -> list[str]:
        result: list[str] = []
        seen: set[str] = {task_id}
        frontier = [task_id]

        while frontier:
            next_frontier: list[str] = []
            for current in frontier:
                children = self.db.exec(select(Task.id).where(Task.parent_id == current)).all()
                for child_id in children:
                    if child_id in seen:
                        continue
                    seen.add(child_id)
                    result.append(child_id)
                    next_frontier.append(child_id)
            frontier = next_frontier

        return result

    def _build_completion_policy(self, task: Task, reason: str) -> CompletionPolicyPrompt | None:
        session_service = SessionService(self.db)
        sessions = session_service.list_future_sessions([task.id])
        subtask_scheduled_count = len(session_service.list_future_sessions(self._collect_subtree_ids(task.id)))
        if not sessions and not subtask_scheduled_count:
            return None

        scheduled_sessions = [
            ScheduledSessionInfo(
                id=s.id,
                start_time=ensure_utc(s.start_time),
                end_time=ensure_utc(s.end_time) if s.end_time else None,
                duration_seconds=s.duration_seconds,
                tags=s.tags,
                notes=s.notes,
            )
            for s in sessions
        ]
        scheduled_seconds = sum(s.duration_seconds or 0 for s in sessions)

        return CompletionPolicyPrompt(
            reason=reason,
            task_id=task.id,
            task_title=task.title,
            scheduled_sessions=scheduled_sessions,
            scheduled_seconds=scheduled_seconds,
            subtask_scheduled_count=subtask_scheduled_count,
        )

    def clear_scheduled_sessions(
        self, task_id: str, req: ClearScheduledSessionsRequest
    ) -> ClearScheduledSessionsResponse:
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)

        session_service = SessionService(self.db)
        deleted_ids: list[str] = []

        deleted_ids.extend(session_service.clear_future_sessions([task_id], req.session_ids))

        if req.include_subtasks:
            subtree_ids = self._collect_subtree_ids(task_id)
            if subtree_ids:
                deleted_ids.extend(session_service.clear_future_sessions(subtree_ids))

        return ClearScheduledSessionsResponse(deleted_count=len(deleted_ids), deleted_session_ids=deleted_ids)

    def delete_task(self, task_id: str) -> None:
        db_task = self.db.get(Task, task_id)
        if not db_task:
            raise EntityNotFoundError("Task", task_id)

        all_target_ids = self._get_all_descendant_task_ids(task_id)

        linked_sessions = self.db.exec(select(SessionModel).where(SessionModel.task_id.in_(all_target_ids))).all()
        for s in linked_sessions:
            s.task_id = None
            self.db.add(s)

        # `recurrenceexception` rows have no cascade; their FK would dangle.
        RecurrenceService(self.db).delete_for_task(list(all_target_ids))

        self.db.delete(db_task)
        self.db.commit()

    def delete_completed_tasks(self) -> int:
        completed_tasks = self.db.exec(select(Task).where(Task.status.in_(["Done", "completed", "done"]))).all()
        if not completed_tasks:
            return 0

        completed_ids = {t.id for t in completed_tasks}

        linked_sessions = self.db.exec(select(SessionModel).where(SessionModel.task_id.in_(completed_ids))).all()
        for s in linked_sessions:
            s.task_id = None
            self.db.add(s)

        RecurrenceService(self.db).delete_for_task(list(completed_ids))

        count = 0
        for task in completed_tasks:
            if task in self.db and not sa.inspect(task).deleted:
                self.db.delete(task)
                count += 1

        self.db.commit()
        return count

    def get_task_tree(self, task_id: str) -> dict[str, Any]:
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
                "recurrence_rrule": t.recurrence_rrule,
                "recurrence_dtstart": (ensure_utc(t.recurrence_dtstart).isoformat() if t.recurrence_dtstart else None),
                "recurrence_duration_minutes": t.recurrence_duration_minutes,
                "recurrence_timezone": t.recurrence_timezone,
                "color": t.color,
                "tags": t.tags,
                "parent_id": t.parent_id,
                "created_at": ensure_utc(t.created_at).isoformat() if t.created_at else "",
                "subtasks": [build_node(child) for child in subtasks],
            }

        return build_node(task)

    def get_task_statistics(self, task_id: str) -> dict[str, Any]:
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)

        created_at_utc = ensure_utc(task.created_at)
        due_date_utc = ensure_utc(task.due_date)

        sessions = self.db.exec(select(SessionModel).where(SessionModel.task_id == task_id)).all()
        sessions.sort(key=lambda s: ensure_utc(s.start_time) or datetime.min.replace(tzinfo=UTC))

        total_seconds = sum(s.duration_seconds or 0 for s in sessions)
        total_hours = round(total_seconds / 3600.0, 2)

        logged_seconds, scheduled_seconds = SessionService(self.db).sum_durations_for_tasks([task_id])

        is_unbounded = not (task.estimated_minutes or 0) or task.is_recurring
        est_minutes = task.estimated_minutes or 0
        est_hours = round(est_minutes / 60.0, 2)
        progress_pct = round((logged_seconds / (est_minutes * 60)) * 100, 1) if est_minutes > 0 else None

        logged_hours = round(logged_seconds / 3600, 2)
        scheduled_hours = round(scheduled_seconds / 3600, 2)
        if is_unbounded:
            remaining_hours = None
            unscheduled_hours = None
        else:
            estimated_seconds = (task.estimated_minutes or 0) * 60
            remaining_seconds = estimated_seconds - logged_seconds
            unscheduled_seconds = estimated_seconds - logged_seconds - scheduled_seconds
            remaining_hours = round(remaining_seconds / 3600, 2)
            unscheduled_hours = round(unscheduled_seconds / 3600, 2)

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
        if due_date_utc:
            task_data["due_date"] = due_date_utc.isoformat()
        if created_at_utc:
            task_data["created_at"] = created_at_utc.isoformat()

        return {
            "task": task_data,
            "total_hours": total_hours,
            "total_sessions": len(sessions),
            "estimated_hours": est_hours,
            "progress_pct": progress_pct,
            "sessions": session_list,
            "task_review": review.model_dump() if review else None,
            "custom_ratings": ratings_detailed,
            "logged_hours": logged_hours,
            "scheduled_hours": scheduled_hours,
            "remaining_hours": remaining_hours,
            "unscheduled_hours": unscheduled_hours,
            "is_unbounded": is_unbounded,
        }

    def create_or_update_task_review(self, req: TaskReviewCreate) -> TaskReview:
        task = self.db.get(Task, req.task_id)
        if not task:
            raise EntityNotFoundError("Task", req.task_id)

        existing = self.db.exec(select(TaskReview).where(TaskReview.task_id == req.task_id)).first()
        if existing:
            existing.difficulty = req.difficulty or 3
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

    def get_task_review(self, task_id: str) -> TaskReview | None:
        return self.db.exec(select(TaskReview).where(TaskReview.task_id == task_id)).first()

    @staticmethod
    def _review_date(value: str, field_name: str) -> date:
        try:
            parsed = date.fromisoformat(value)
        except (TypeError, ValueError) as exc:
            raise ValidationError(f"{field_name} must use YYYY-MM-DD") from exc
        if parsed.isoformat() != value:
            raise ValidationError(f"{field_name} must use YYYY-MM-DD")
        return parsed

    def _task_review_dict(self, review: TaskReview, task: Task) -> dict[str, Any]:
        created_at = ensure_utc(review.created_at) if review.created_at else None
        return {
            "id": review.id,
            "task_id": task.id,
            "task_title": task.title,
            "difficulty": review.difficulty,
            "what_went_well": review.what_went_well or "",
            "blockers": review.blockers or "",
            "key_takeaways": review.key_takeaways or "",
            "created_at": created_at.isoformat() if created_at else None,
        }

    def get_task_review_for_ai(self, task_id: str) -> dict[str, Any]:
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)
        review = self.get_task_review(task_id)
        return {
            "task_id": task.id,
            "task_title": task.title,
            "review": self._task_review_dict(review, task) if review else None,
        }

    def list_task_reviews_for_ai(
        self,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        task_id: str | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        start = self._review_date(start_date, "start_date") if start_date else None
        end = self._review_date(end_date, "end_date") if end_date else None
        if start and end and end < start:
            raise ValidationError("end_date must not be before start_date")
        if start and end and (end - start).days + 1 > 730:
            raise ValidationError("task review date range cannot exceed 730 days")
        if task_id and not self.db.get(Task, task_id):
            raise EntityNotFoundError("Task", task_id)
        try:
            requested_limit = int(limit)
        except (TypeError, ValueError) as exc:
            raise ValidationError("limit must be an integer") from exc
        limit = max(1, min(requested_limit, 500))
        reviews_query = select(TaskReview)
        if task_id:
            reviews_query = reviews_query.where(TaskReview.task_id == task_id)
        tz = daemon_tzinfo()
        if start:
            start_utc = datetime.combine(start, time.min, tz).astimezone(UTC).replace(tzinfo=None)
            reviews_query = reviews_query.where(TaskReview.created_at >= start_utc)
        if end:
            end_utc = datetime.combine(end + timedelta(days=1), time.min, tz).astimezone(UTC).replace(tzinfo=None)
            reviews_query = reviews_query.where(TaskReview.created_at < end_utc)
        reviews = list(self.db.exec(reviews_query.order_by(TaskReview.created_at.desc()).limit(limit + 1)).all())
        filtered: list[dict[str, Any]] = []
        for review in reviews:
            created_local_date = to_local_naive(ensure_utc(review.created_at), tz).date() if review.created_at else None
            if start and (created_local_date is None or created_local_date < start):
                continue
            if end and (created_local_date is None or created_local_date > end):
                continue
            task = self.db.get(Task, review.task_id)
            if task is not None:
                filtered.append(self._task_review_dict(review, task))
        # Date filtering happens after the bounded query because created_at is stored as UTC and
        # the requested boundaries are local dates. Fetch one extra row and report truncation only
        # when the returned page itself is full; the range is still explicitly bounded by callers.
        truncated = len(filtered) > limit
        filtered = filtered[:limit]
        return {
            "start_date": start.isoformat() if start else None,
            "end_date": end.isoformat() if end else None,
            "task_id": task_id,
            "reviews": filtered,
            "truncated": truncated,
            "warnings": ["Task reviews were limited; request a narrower range."] if truncated else [],
        }
