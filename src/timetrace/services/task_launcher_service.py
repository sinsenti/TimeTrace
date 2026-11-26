"""Read-only launcher: bounded materialization, complete ranking, canonical time evidence."""

from datetime import UTC, datetime, timedelta
from heapq import nsmallest
from typing import Literal

from sqlalchemy import case, func
from sqlalchemy.orm import aliased
from sqlmodel import Session, select

from timetrace.core.exceptions import ValidationError
from timetrace.core.query_spec import AnalyticsQuery, DateRange, QueryFilter
from timetrace.core.task_search import title_match_rank
from timetrace.core.timezones import daemon_tzinfo
from timetrace.db.models import Task, TaskStatus
from timetrace.db.session import sqlite_read_snapshot
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.services.query_service import QueryService
from timetrace.services.session_service import SessionService


class TaskLauncherService:
    def __init__(self, db: Session):
        self.db = db

    def suggestions(
        self,
        query: str = "",
        *,
        limit: int = 20,
        include_completed: bool = False,
        timezone: str | None = None,
        tag_contains: str = "",
        measurement_at: datetime | None = None,
        view: Literal["suggested", "priority"] = "suggested",
        priority: Literal["all", "high", "medium", "low", "none"] = "all",
    ) -> dict:
        if view not in {"suggested", "priority"} or priority not in {"all", "high", "medium", "low", "none"}:
            raise ValidationError("Choose a supported launcher view and priority filter.")
        if not 1 <= limit <= 50 or len(query) > 200 or len(tag_contains) > 200:
            raise ValidationError("Use at most 200 search characters and a launcher limit between 1 and 50.")
        now = measurement_at or datetime.now(UTC)
        if now.tzinfo is not None:
            now = now.astimezone(UTC).replace(tzinfo=None)
        with sqlite_read_snapshot(self.db) as reader:
            return TaskLauncherService(reader)._suggestions(
                query.strip(), limit, include_completed, timezone, now, tag_contains, view, priority
            )

    def _suggestions(self, query, limit, include_completed, timezone, now, tag_contains, view, priority):
        connection = self.db.connection().connection.driver_connection
        # Pure, parameterized UDF: no request-specific state leaks to a pooled connection.
        connection.create_function("launcher_title_rank", 2, title_match_rank, deterministic=True)
        rank = func.launcher_title_rank(Task.title, query)
        flags = {s.name: s.is_completed for s in self.db.exec(select(TaskStatus))}
        fallback = func.coalesce(func.lower(Task.status).in_(["done", "completed"]), False)
        completed = case(flags, value=Task.status, else_=fallback) if flags else fallback
        parent = aliased(Task)
        statement = select(Task.id, Task.title, Task.priority, completed.label("completed"), parent.title).outerjoin(
            parent, parent.id == Task.parent_id
        )
        statement = statement.where(rank < 4)
        normalized_priority = func.coalesce(func.lower(Task.priority), "")
        if priority == "none":
            statement = statement.where(~normalized_priority.in_(["high", "medium", "low"]))
        elif priority != "all":
            statement = statement.where(normalized_priority == priority)
        if tag_contains:
            statement = statement.where(Task.tags.icontains(tag_contains, autoescape=True))
        if not include_completed:
            statement = statement.where(~completed)
        plans = {}
        for plan in SessionService(self.db).list_planning_plans(now, now + timedelta(hours=1)):
            if not plan.task_id:
                continue
            start = plan.start_time
            if start.tzinfo is not None:
                start = start.astimezone(UTC).replace(tzinfo=None)
            key = (0 if start <= now else 1, start)
            if plan.task_id not in plans or key < plans[plan.task_id]:
                plans[plan.task_id] = key

        # No UUID-limited candidate set, no 2,000-group aggregate truncation. Stream task
        # metadata in 200-row batches, aggregate each batch through QueryService, and
        # retain only the final top-N. Raw work rows never enter Python aggregation.
        candidates = self.db.exec(statement.order_by(Task.id)).yield_per(200)
        # QueryService's SQLite local-day contract is daemon-local, even when the
        # browser requests another zone. Derive bounds in that same effective zone.
        zone = daemon_tzinfo()
        today = now.replace(tzinfo=UTC).astimezone(zone).date()
        date_range = DateRange(
            preset="custom", start_date=(today - timedelta(days=29)).isoformat(), end_date=today.isoformat()
        )

        def ranked():
            for batch in candidates.partitions(200):
                ids = [row[0] for row in batch]
                evidence = QueryService(self.db).run(
                    AnalyticsQuery(
                        source="recorded_work",
                        measure="recorded_task_time",
                        group_by=["task"],
                        filters=[QueryFilter(field="task", op="in", values=ids)],
                        date_range=date_range,
                        limit=200,
                    ),
                    QueryContextRequest(timezone=zone.key),
                    measurement_at=now,
                )
                hours = {row.keys[0]: row.value or 0 for row in evidence.rows}
                for task_id, title, task_priority, done, parent_title in batch:
                    match = title_match_rank(title, query)
                    scheduled = plans.get(task_id)
                    priority = {"high": 3, "medium": 2, "low": 1}.get((task_priority or "").lower(), 0)
                    common = (-priority, -hours.get(task_id, 0), title.casefold(), task_id)
                    key = (
                        (match, *common)
                        if query
                        else common
                        if view == "priority"
                        else (
                            scheduled[0] if scheduled else 2,
                            scheduled[1] if scheduled and scheduled[0] == 1 else datetime.min,
                            *common,
                        )
                    )
                    yield (
                        key,
                        {
                            "id": task_id,
                            "title": title,
                            "parent_title": parent_title,
                            "priority": task_priority,
                            "completed": bool(done),
                            "match_kind": ["exact", "prefix", "contains", "fuzzy"][match] if query else "default",
                            "recorded_hours": hours.get(task_id, 0),
                            "scheduled_state": ("now" if scheduled[0] == 0 else "soon") if scheduled else None,
                            "scheduled_start": scheduled[1].replace(tzinfo=UTC).isoformat() if scheduled else None,
                        },
                    )

        return {
            "suggestions": [row for _, row in nsmallest(limit, ranked(), key=lambda item: item[0])],
            "measurement_at": now.replace(tzinfo=UTC).isoformat(),
            "timezone": zone.key,
            "warnings": ["Recorded-time ranking uses the daemon timezone, not the requested browser timezone."]
            if timezone and timezone != zone.key
            else [],
        }
