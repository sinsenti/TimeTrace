import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError
from timetrace.core.inline_parser import parse_inline_task
from timetrace.db.models import RatingDefinition, RatingEntry, Task, TaskReview, TaskStatus
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import (
    ClearScheduledSessionsRequest,
    ClearScheduledSessionsResponse,
    CompletionPolicyPrompt,
    ScheduledSessionInfo,
    TaskCreate,
    TaskReviewCreate,
    TaskStatusCreate,
    TaskStatusUpdate,
    TaskUpdate,
    TaskWithPolicyResponse,
)
from timetrace.interfaces.api.utils import ensure_utc
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
        clean_title = re.sub(r"\[\d+(?:\.\d+)?\s*(?:min|mins|m|h|hours|hour|d|day|days)?\]", "", title, flags=re.IGNORECASE).strip()
        return clean_title, est_minutes
    return title, None


def apply_quick_task_syntax(task_dict: dict) -> datetime | None:
    """Extracts `#tag`s, `!priority`, `due:`/`d:`, `target:`/`t:`, and
    `(description)` text out of a task's title and merges them into task_dict
    in place. Returns the start time for an auto-scheduled Session if the
    title gave an hour-precision target (`t:Nh`), else None -- the caller is
    responsible for actually creating that row (this function only parses;
    it has no DB access, per this module's core/ layering).

    Title-embedded values win over whatever was already in task_dict, matching
    the existing precedent for `[15m]` estimate parsing just above: the title
    is the fast-capture surface, so what you type there is authoritative. Only
    fields the title actually specifies are touched -- e.g. no `!priority` in
    the title leaves task_dict["priority"] alone.
    """
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

    def create_task(self, req: TaskCreate) -> Task:
        task_dict = req.model_dump(exclude_unset=True)
        schedule_session_at = apply_quick_task_syntax(task_dict)
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

        if schedule_session_at is not None:
            self._create_scheduled_session(db_task, schedule_session_at)
        if db_task.is_recurring:
            self.schedule_recurrent_sessions_three_months(db_task)

        # One commit for the task plus every related row added above -- a
        # second commit anywhere after this expires db_task's attributes
        # (SQLAlchemy's default expire_on_commit) before the API layer
        # serializes it, silently returning `{}` instead of the created task.
        # This exact bug previously existed here for is_recurring tasks (the
        # old code committed+refreshed, THEN called
        # schedule_recurrent_sessions_three_months, which committed again) --
        # fixed by moving that call before this single commit.
        self.db.commit()
        self.db.refresh(db_task)
        db_task.created_at = ensure_utc(db_task.created_at)
        db_task.due_date = ensure_utc(db_task.due_date)

        return db_task

    def _create_scheduled_session(self, task: Task, start_at: datetime) -> SessionModel:
        """Creates a Session for a task whose title gave an hour-precision
        target (`t:Nh`) -- see apply_quick_task_syntax. assigned_date is a
        bare date string and can't hold a specific hour, so an actual
        calendar Session is the only way to represent "work on this at this
        time". Does not commit -- the caller folds this into its own commit.
        """
        duration_mins = task.estimated_minutes or 15
        start_utc = ensure_utc(start_at)
        end_utc = start_utc + timedelta(minutes=duration_mins)
        session = SessionModel(
            task_id=task.id,
            start_time=start_utc.replace(tzinfo=None),
            end_time=end_utc.replace(tzinfo=None),
            duration_seconds=duration_mins * 60,
            tags=task.tags or "#general",
            notes=f"Scheduled: {task.title}",
        )
        self.db.add(session)
        return session

    def schedule_recurrent_sessions_three_months(self, task: Task) -> list[SessionModel]:
        if not task.id or not task.is_recurring:
            return []

        # Anchored to today's date at a fixed hour (not datetime.now(UTC)) so that
        # repeat calls on the same day -- e.g. create, then an unrelated update --
        # derive the identical curr_naive sequence below and the existing-session
        # dedup check actually dedups, instead of regenerating every future
        # session because "now" drifted by a few seconds between calls.
        start_base = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
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
            curr_naive = ensure_utc(curr_date).replace(tzinfo=None)
            existing = self.db.exec(
                select(SessionModel).where(
                    SessionModel.task_id == task.id,
                    SessionModel.start_time == curr_naive
                )
            ).first()

            if not existing:
                sess = SessionModel(
                    task_id=task.id,
                    start_time=curr_naive,
                    end_time=curr_naive + timedelta(minutes=duration_mins),
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

        # No commit here: the existing-session dedup check above relies on
        # autoflush (not a commit) to see this loop's own pending adds, and
        # every caller folds these rows into its own single final commit --
        # see the note in create_task about why a second commit is unsafe.
        return created_sessions

    def list_tasks(
        self,
        status_filter: str | None = None,
        sort_by: str = "smart_gap_filler",
        category_filter: str | None = None,
        assigned_date: str | None = None,
        due_before: str | None = None,
    ) -> list[Task]:
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

    def update_task(self, task_id: str, req: TaskUpdate) -> TaskWithPolicyResponse:
        db_task = self.db.get(Task, task_id)
        if not db_task:
            raise EntityNotFoundError("Task", task_id)

        old_status_name = db_task.status

        update_dict = req.model_dump(exclude_unset=True)
        schedule_session_at = None

        if "title" in update_dict and update_dict["title"]:
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

        if "status" in update_dict:
            st = self.db.exec(select(TaskStatus).where(TaskStatus.name == update_dict["status"])).first()
            if st:
                db_task.status_id = st.id

        if update_dict.get("status") in ("Done", "completed") and db_task.is_recurring:
            self.handle_task_recurrence(db_task)

        if schedule_session_at is not None:
            self._create_scheduled_session(db_task, schedule_session_at)
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

        # Recurring tasks regenerate their own future sessions a few lines up
        # (schedule_recurrent_sessions_three_months), so prompting the user
        # about clearing "scheduled sessions" on them makes no sense.
        policy = None
        if not db_task.is_recurring:
            was_completed, was_scheduled = self._status_flags(old_status_name)
            now_completed, now_scheduled = self._status_flags(db_task.status)
            if not was_completed and now_completed:
                policy = self._build_completion_policy(db_task, "completed")
            elif was_scheduled and not now_scheduled and not now_completed:
                policy = self._build_completion_policy(db_task, "left_scheduled")

        declared_fields = set(TaskWithPolicyResponse.model_fields) - {"completion_policy"}
        task_data = {k: v for k, v in db_task.model_dump().items() if k in declared_fields}
        return TaskWithPolicyResponse(**task_data, completion_policy=policy)

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

    def _status_flags(self, name: str | None) -> tuple[bool, bool]:
        """Returns (is_completed, is_scheduled_trigger) for a status name, preferring
        the configured TaskStatus row and falling back to a name-based guess for
        statuses that don't have one (e.g. legacy/free-text status values)."""
        if name is None:
            return (False, False)

        st = self.db.exec(select(TaskStatus).where(TaskStatus.name == name)).first()
        if st:
            return (st.is_completed, st.is_scheduled_trigger)

        lname = name.lower()
        return (lname in {"done", "completed"}, lname == "scheduled")

    def _collect_subtree_ids(self, task_id: str) -> list[str]:
        """Iterative BFS over Task.parent_id, returning descendant ids only
        (excluding task_id itself). Guards against a parent_id cycle."""
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
        # Fire when EITHER the task's own sessions or its subtree's are non-empty --
        # a container-style parent task with no sessions of its own but subtasks
        # that do must still prompt, or include_subtasks has nothing to reach.
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

        # session_ids (when given) selects a subset of the TASK'S OWN future
        # sessions -- that's the only list the modal shows checkboxes for.
        # include_subtasks is a separate, all-or-nothing blanket clear of the
        # whole subtree, since there's no per-child selection UI for it. These
        # must stay two independent calls: folding subtree ids into the same
        # scope as session_ids would make the subtree clear silently no-op
        # any time the user deselects even one of the task's own sessions,
        # because session_ids would then no longer cover the subtree ids either.
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
                "color": t.color,
                "tags": t.tags,
                "parent_id": t.parent_id,
                "created_at": ensure_utc(t.created_at).isoformat() if t.created_at else "",
                "subtasks": [build_node(child) for child in subtasks]
            }

        return build_node(task)

    def get_task_statistics(self, task_id: str) -> dict[str, Any]:
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)

        task.created_at = ensure_utc(task.created_at)
        task.due_date = ensure_utc(task.due_date)

        sessions = self.db.exec(select(SessionModel).where(SessionModel.task_id == task_id)).all()
        sessions.sort(key=lambda s: ensure_utc(s.start_time) or datetime.min.replace(tzinfo=UTC))

        total_seconds = sum(s.duration_seconds or 0 for s in sessions)
        total_hours = round(total_seconds / 3600.0, 2)

        logged_seconds, scheduled_seconds = SessionService(self.db).sum_durations_for_tasks([task_id])

        is_ongoing = str(task.status or "").lower() == "ongoing"
        # Unbounded whenever the estimate can't be meaningfully compared to logged/
        # scheduled time: no estimate at all, an open-ended Ongoing task, or a
        # recurring task (its estimate is per-occurrence, but scheduled_seconds
        # sums duration across every pre-generated future occurrence, so
        # "remaining" would silently subtract months of projected instances from
        # a single occurrence's estimate).
        is_unbounded = is_ongoing or not (task.estimated_minutes or 0) or task.is_recurring
        est_minutes = 0 if is_ongoing else (task.estimated_minutes or 0)
        est_hours = round(est_minutes / 60.0, 2) if not is_ongoing else 0.0
        progress_pct = (
            (round((logged_seconds / (est_minutes * 60)) * 100, 1) if est_minutes > 0 else None)
            if not is_ongoing
            else None
        )

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
