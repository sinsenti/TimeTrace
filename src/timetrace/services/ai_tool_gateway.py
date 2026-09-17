"""`DbAIToolGateway` -- the real, SQLite-backed implementation of `core.ai.spec.AIToolGateway`.

Spec S5 layering: `core/ai/tools.py` declares the LangChain tool surface against the
`AIToolGateway` Protocol; this module is the DB-backed implementation. Read-only insight and
scheduling calculations live in `services/ai_insights_service.py`, while draft proposals still
flow through `AIDraftService`.

**Concurrency deviation (spec S5, S9):** every method opens its own short-lived `Session(engine)`
instead of taking a `Depends(get_session)`-injected one. LangGraph's tool node can run several
tool calls from one AI message *concurrently*; a single SQLModel `Session` is not safe under
that, so each call gets a private connection, does its work, and closes it before returning.

**Batch binding (spec S6):** a `DbAIToolGateway` is constructed once per agent turn, bound to
exactly one `AIDraftBatch` via `batch_id`. None of the write ("propose_*") methods take a
`batch_id` argument -- the model cannot address any batch but the one this gateway was built
for.

**Write tools never touch `task`/`session` rows.** Each `propose_*` method computes
`proposed_json` / `baseline_json` and hands off to `AIDraftService.add_item(...)`, which is the
only thing that inserts the `aidraftitem` row. `_item_result()` keeps the gateway's public result
shape plain and JSON-serializable.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime
from typing import Any

from pydantic import ValidationError as PydanticValidationError
from sqlmodel import Session, func, select

from timetrace.core.ai.remember_intent import is_remember_intent
from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.core.query_spec import AnalyticsQuery, Dimension, FilterField, Measure, QuerySource
from timetrace.core.recurrence import is_occurrence_id
from timetrace.db.models import AIDraftBatch, DayReview, Task, generate_uuid7
from timetrace.db.session import engine
from timetrace.interfaces.api.schemas import DayReviewCreate, QueryContextRequest
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.ai_provider_service import AI_DATA_SCOPE_DEFAULTS
from timetrace.services.query_service import QueryService
from timetrace.services.session_service import SessionService

# ---------------------------------------------------------------------------------------------
# get_time_stats allow-list (spec S6: "an allow-listed passthrough to QueryService.run ... pick
# a small, safe subset of measures/dimensions"). It is deliberately narrower than the human
# dashboard vocabulary and is validated per source: a dimension allowed for sessions must not
# become valid for habit logs, day reviews, or ratings merely because it is in a global set.
# ---------------------------------------------------------------------------------------------
# Tool-level scope names intentionally follow the settings API rather than query-source names.
# ``reviews`` covers day/task reviews; ``ratings`` covers definitions and rating entries.

# Unlike the dashboard query registry, the conversational tool is intentionally narrower and
# source-specific. This prevents a valid dimension for one source from becoming valid merely
# because it is present in a global set.
_STATS_CAPABILITIES = {
    QuerySource.SESSIONS: {
        "measures": {
            Measure.SUM_DURATION,
            Measure.SESSION_COUNT,
            Measure.AVG_SESSION_LENGTH,
            Measure.AVG_RATING,
        },
        "dimensions": {
            Dimension.DAY,
            Dimension.WEEK,
            Dimension.MONTH,
            Dimension.TAG,
            Dimension.TASK,
            Dimension.STATUS,
            Dimension.PRIORITY,
            Dimension.CATEGORY,
        },
        "filters": {
            FilterField.DAY,
            FilterField.WEEK,
            FilterField.MONTH,
            FilterField.TAG,
            FilterField.TASK,
            FilterField.STATUS,
            FilterField.PRIORITY,
            FilterField.CATEGORY,
            FilterField.DURATION_SECONDS,
            FilterField.HAS_TASK,
            FilterField.NOTES,
            FilterField.SESSION_TIME_RELATIVE,
        },
    },
    QuerySource.TASKS: {
        "measures": {Measure.TASK_COUNT, Measure.COMPLETION_RATE, Measure.AVG_RATING},
        "dimensions": {
            Dimension.DAY,
            Dimension.WEEK,
            Dimension.MONTH,
            Dimension.STATUS,
            Dimension.PRIORITY,
            Dimension.CATEGORY,
        },
        "filters": {
            FilterField.DAY,
            FilterField.WEEK,
            FilterField.MONTH,
            FilterField.STATUS,
            FilterField.PRIORITY,
            FilterField.CATEGORY,
        },
    },
    QuerySource.HABIT_LOGS: {
        "measures": {Measure.HABIT_COMPLETION_RATE},
        "dimensions": {Dimension.DAY, Dimension.WEEK, Dimension.MONTH, Dimension.WEEKDAY, Dimension.HABIT},
        "filters": {FilterField.DAY, FilterField.WEEK, FilterField.MONTH, FilterField.WEEKDAY, FilterField.HABIT},
    },
    QuerySource.DAY_REVIEWS: {
        "measures": {Measure.AVG_RATING},
        "dimensions": {Dimension.DAY, Dimension.WEEK, Dimension.MONTH, Dimension.WEEKDAY},
        "filters": {FilterField.DAY, FilterField.WEEK, FilterField.MONTH, FilterField.WEEKDAY},
    },
    QuerySource.RATING_ENTRIES: {
        "measures": {Measure.AVG_RATING},
        "dimensions": {
            Dimension.DAY,
            Dimension.WEEK,
            Dimension.MONTH,
            Dimension.WEEKDAY,
            Dimension.RATING_TYPE,
        },
        "filters": {
            FilterField.DAY,
            FilterField.WEEK,
            FilterField.MONTH,
            FilterField.WEEKDAY,
            FilterField.RATING_TYPE,
            FilterField.RATING_SCORE,
        },
    },
}

_STATS_DOMAIN = {
    QuerySource.SESSIONS: "sessions",
    QuerySource.TASKS: "tasks",
    QuerySource.HABIT_LOGS: "habits",
    QuerySource.DAY_REVIEWS: "reviews",
    QuerySource.RATING_ENTRIES: "ratings",
}
_STATS_MAX_LIMIT = 100

_DONE_LIKE_STATUSES = ("Done", "completed", "done")


def _dt_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return ensure_utc(value).isoformat()


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return ensure_utc(value)
    return ensure_utc(datetime.fromisoformat(value))


class DbAIToolGateway:
    """Real implementation of `AIToolGateway`, scoped to one draft batch.

    Construct one per agent turn: `DbAIToolGateway(batch_id=batch.id)`. Read methods are plain
    queries; write methods only ever append a pending `AIDraftItem` to this batch.
    """

    def __init__(
        self,
        batch_id: str,
        *,
        conversation_id: str | None = None,
        source_message_id: str | None = None,
        source_message_text: str | None = None,
        data_scope: dict[str, bool] | None = None,
    ):
        self.batch_id = batch_id
        self.conversation_id = conversation_id
        self.source_message_id = source_message_id
        self.source_message_text = source_message_text or ""
        # ChatService supplies the persisted scope. Direct gateway callers get the same safe
        # compatibility defaults, so constructing this class without settings cannot silently
        # enable newly-added sensitive domains.
        self.data_scope = {**AI_DATA_SCOPE_DEFAULTS, **(data_scope or {})}
        self._instruction_proposal_created = False
        self._instruction_proposal_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Read tools
    # ------------------------------------------------------------------

    def _require_scope(self, domain: str) -> None:
        if self.data_scope is not None and not self.data_scope.get(domain, False):
            raise ValidationError(
                f"AI data scope '{domain}' is disabled. Enable it in Settings > AI before using this tool."
            )

    def _require_stats_scope(self, source: QuerySource) -> None:
        self._require_scope(_STATS_DOMAIN[source])

    def list_tasks(
        self,
        *,
        status: str | None = None,
        tag: str | None = None,
        priority: str | None = None,
        parent_id: str | None = None,
        include_done: bool = False,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Lists tasks matching the given filters.

        Sorted most-recently-*created* first -- `Task` has no `updated_at` column, so this is
        the closest available proxy for "most recently touched". `tag` matches as a substring
        against the CSV `tags` field (mirrors how tags are stored elsewhere in this codebase).
        """
        self._require_scope("tasks")
        limit = max(1, min(limit, 200))
        with Session(engine) as db:
            stmt = select(Task)
            if status:
                stmt = stmt.where(Task.status == status)
            elif not include_done:
                stmt = stmt.where(Task.status.notin_(_DONE_LIKE_STATUSES))
            if priority:
                stmt = stmt.where(Task.priority == priority)
            if parent_id:
                stmt = stmt.where(Task.parent_id == parent_id)
            if tag:
                stmt = stmt.where(Task.tags.contains(tag))
            stmt = stmt.order_by(Task.created_at.desc()).limit(limit)
            tasks = db.exec(stmt).all()
            return [self._task_to_dict(t) for t in tasks]

    def get_task(self, task_id: str) -> dict[str, Any]:
        """Fetches one task by id. Raises `EntityNotFoundError` if it doesn't exist."""
        self._require_scope("tasks")
        with Session(engine) as db:
            task = db.get(Task, task_id)
            if not task:
                raise EntityNotFoundError("Task", task_id)
            return self._task_to_dict(task)

    def resolve_task_reference(self, query: str, *, limit: int = 5) -> list[dict[str, Any]]:
        """Fuzzy (case-insensitive substring) title match. The UUID-era answer to the dead
        `@123` inline-parser scheme -- call this before referencing any task by name; never
        invent an id. Returns `[]` when nothing matches; returns more than one candidate when
        the match is ambiguous, so the caller can ask the user to disambiguate rather than
        guessing."""
        self._require_scope("tasks")
        q = (query or "").strip().lower()
        if not q:
            return []
        limit = max(1, min(limit, 20))
        with Session(engine) as db:
            stmt = (
                select(Task).where(func.lower(Task.title).like(f"%{q}%")).order_by(Task.created_at.desc()).limit(limit)
            )
            tasks = db.exec(stmt).all()
            return [{"id": t.id, "title": t.title, "status": t.status} for t in tasks]

    def list_sessions(
        self,
        *,
        start: datetime,
        end: datetime,
        task_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Lists sessions overlapping `[start, end)`, real rows merged with projected occurrences
        of recurring tasks (delegates to `SessionService.list_sessions`, the app's single merge
        funnel for the two)."""
        self._require_scope("sessions")
        limit = max(1, min(limit, 500))
        with Session(engine) as db:
            rows = SessionService(db).list_overlapping_sessions(start=start, end=end, include_virtual=True)
        if task_id:
            rows = [r for r in rows if r.get("task_id") == task_id]
        return rows[:limit]

    def find_free_slots(
        self,
        *,
        start: datetime,
        end: datetime,
        min_duration_minutes: int,
        working_hours_only: bool = True,
        extra_busy_windows: list[tuple[datetime, datetime]] | None = None,
    ) -> list[dict[str, Any]]:
        """Finds open calendar gaps of at least `min_duration_minutes` within `[start, end)`.

        `extra_busy_windows` -- **the parameter added for spec S9.3** ("must subtract the
        batch's own already-proposed items, or a multi-step week-plan tool-calling loop
        double-books itself on its second call within the same turn"). This gateway already
        knows its own `batch_id`, so it does this automatically: every *pending*
        `AIDraftItem` in this batch with `entity_type="session"` is folded in --
        `create`/`update` proposals add their proposed window to the busy set, `delete`
        proposals remove their (`baseline_json`) window from it. `extra_busy_windows` is an
        *additional*, caller-supplied list of `(start, end)` naive-UTC windows on top of that,
        for a caller that wants to test a hypothetical placement before it is even proposed as a
        draft (e.g. the later LangGraph tool-wiring track, if it ever needs to reserve a slot
        mid-reasoning before calling `propose_create_session`). Most callers can omit it.

        `working_hours_only` applies the saved local hours, allowed days, break, and daily-cap
        preferences from `AISettings`.
        """
        self._require_scope("sessions")
        from timetrace.services.ai_insights_service import AIInsightsService

        with Session(engine) as db:
            return AIInsightsService(db).find_free_slots(
                start,
                end,
                min_duration_minutes=min_duration_minutes,
                working_hours_only=working_hours_only,
                batch_id=self.batch_id,
                extra_busy_windows=extra_busy_windows,
            )

    def get_time_stats(self, query: dict[str, Any]) -> dict[str, Any]:
        """Allow-listed passthrough to `QueryService.run` (the real-SQL stats engine from
        dashboards slice 1) -- never `AnalyticsService`, which loads every session/task into
        Python.

        Allow-list (deliberately a small subset of the full query vocabulary; see the
        source-specific capability map above):
          - `source`: `sessions`, `tasks`, `habit_logs`, `day_reviews`, or `rating_entries`.
          - `measure`, `group_by`, and `filters` must be supported by that source. Habit logs
            expose `habit_completion_rate`; day reviews and rating entries expose `avg_rating`.
          - `limit` is capped at 100 regardless of what's requested.
        Everything else in `query` (`date_range`, `chart`, `tag_attribution`, `sort`,
        `fill_gaps`) is passed through to `AnalyticsQuery` as-is and validated by its own
        pydantic schema.
        """
        if not isinstance(query, dict):
            raise ValidationError("get_time_stats: query must be an object")
        source = query.get("source")
        measure = query.get("measure")
        try:
            source_enum = QuerySource(source)
        except (TypeError, ValueError) as exc:
            raise ValidationError(f"get_time_stats: unsupported source {source!r}") from exc
        self._require_stats_scope(source_enum)
        capabilities = _STATS_CAPABILITIES[source_enum]
        if measure not in {item.value for item in capabilities["measures"]}:
            raise ValidationError(
                f"get_time_stats: measure {measure!r} is not supported for source {source!r}; "
                f"allowed: {sorted(item.value for item in capabilities['measures'])}"
            )

        group_by = query.get("group_by") or []
        if not isinstance(group_by, list):
            raise ValidationError("get_time_stats: group_by must be a list")
        for dim in group_by:
            if dim not in {item.value for item in capabilities["dimensions"]}:
                raise ValidationError(
                    f"get_time_stats: dimension {dim!r} is not supported for source {source!r}; "
                    f"allowed: {sorted(item.value for item in capabilities['dimensions'])}"
                )

        filters = query.get("filters") or []
        if not isinstance(filters, list):
            raise ValidationError("get_time_stats: filters must be a list")
        for filter_value in filters:
            field = filter_value.get("field") if isinstance(filter_value, dict) else None
            if field not in {item.value for item in capabilities["filters"]}:
                raise ValidationError(
                    f"get_time_stats: filter {field!r} is not supported for source {source!r}; "
                    f"allowed: {sorted(item.value for item in capabilities['filters'])}"
                )

        if source_enum in (QuerySource.SESSIONS, QuerySource.TASKS) and measure == Measure.AVG_RATING.value:
            self._require_scope("ratings")
        if source_enum == QuerySource.SESSIONS:
            task_fields = {
                Dimension.TASK.value,
                Dimension.CATEGORY.value,
                Dimension.STATUS.value,
                Dimension.PRIORITY.value,
                FilterField.TASK.value,
                FilterField.CATEGORY.value,
                FilterField.STATUS.value,
                FilterField.PRIORITY.value,
                FilterField.HAS_TASK.value,
            }
            if any(dim in task_fields for dim in group_by) or any(
                isinstance(filter_value, dict) and filter_value.get("field") in task_fields for filter_value in filters
            ):
                self._require_scope("tasks")
            if measure == Measure.AVG_RATING.value and (
                Dimension.TAG.value in group_by
                or any(
                    isinstance(filter_value, dict) and filter_value.get("field") == FilterField.TAG.value
                    for filter_value in filters
                )
            ):
                raise ValidationError("get_time_stats: avg_rating cannot be combined with session tags")

        try:
            requested_limit = int(query.get("limit", 50) or 50)
        except (TypeError, ValueError) as exc:
            raise ValidationError("get_time_stats: limit must be an integer") from exc
        limit = max(1, min(requested_limit, _STATS_MAX_LIMIT))

        payload = {
            "source": source,
            "measure": measure,
            "group_by": group_by,
            "filters": filters,
            "date_range": query.get("date_range") or {},
            "chart": query.get("chart", "table"),
            "tag_attribution": query.get("tag_attribution", "fan_out"),
            "sort": query.get("sort", "value_desc"),
            "limit": limit,
            "fill_gaps": bool(query.get("fill_gaps", False)),
        }
        try:
            analytics_query = AnalyticsQuery.model_validate(payload)
        except PydanticValidationError as exc:
            raise ValidationError(f"get_time_stats: invalid query: {exc}") from exc

        with Session(engine) as db:
            response = QueryService(db).run(analytics_query, QueryContextRequest())
        return response.model_dump(mode="json")

    def search_tasks(
        self,
        query: str,
        *,
        status: str | None = None,
        tag: str | None = None,
        priority: str | None = None,
        include_done: bool = False,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        self._require_scope("tasks")
        from timetrace.services.ai_insights_service import AIInsightsService

        with Session(engine) as db:
            return AIInsightsService(db).search_tasks(
                query,
                status=status,
                tag=tag,
                priority=priority,
                include_done=include_done,
                limit=limit,
            )

    def find_conflicts(
        self,
        *,
        start: datetime,
        end: datetime,
        include_pending: bool = True,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        self._require_scope("sessions")
        self._require_scope("tasks")
        from timetrace.services.ai_insights_service import AIInsightsService

        with Session(engine) as db:
            return AIInsightsService(db).find_conflicts(
                start,
                end,
                batch_id=self.batch_id,
                include_pending=include_pending,
                limit=limit,
            )

    def get_task_progress(self, task_id: str) -> dict[str, Any]:
        self._require_scope("tasks")
        from timetrace.services.ai_insights_service import AIInsightsService

        with Session(engine) as db:
            return AIInsightsService(db).get_task_progress(task_id)

    def validate_schedule(self, proposed_sessions: list[dict[str, Any]]) -> dict[str, Any]:
        self._require_scope("sessions")
        from timetrace.services.ai_insights_service import AIInsightsService

        with Session(engine) as db:
            return AIInsightsService(db).validate_schedule(
                proposed_sessions,
                batch_id=self.batch_id,
            )

    def get_daily_briefing(self, date: str | None = None) -> dict[str, Any]:
        self._require_scope("sessions")
        self._require_scope("tasks")
        from timetrace.services.ai_insights_service import AIInsightsService

        with Session(engine) as db:
            return AIInsightsService(db).get_daily_briefing(date, batch_id=self.batch_id)

    def get_weekly_review(self, *, start: datetime, end: datetime) -> dict[str, Any]:
        self._require_scope("sessions")
        self._require_scope("tasks")
        from timetrace.services.ai_insights_service import AIInsightsService

        with Session(engine) as db:
            return AIInsightsService(db).get_weekly_review(start, end)

    def list_habits(
        self,
        *,
        start_date: str,
        end_date: str,
        habit_id: str | None = None,
        include_logs: bool = True,
        limit: int = 50,
    ) -> dict[str, Any]:
        self._require_scope("habits")
        from timetrace.services.habit_service import HabitService

        with Session(engine) as db:
            return HabitService(db).list_habits_for_ai(
                start_date=start_date,
                end_date=end_date,
                habit_id=habit_id,
                include_logs=include_logs,
                limit=limit,
            )

    def get_habit_progress(self, *, habit_id: str, start_date: str, end_date: str) -> dict[str, Any]:
        self._require_scope("habits")
        from timetrace.services.habit_service import HabitService

        with Session(engine) as db:
            return HabitService(db).get_habit_progress_for_ai(
                habit_id=habit_id, start_date=start_date, end_date=end_date
            )

    def get_day_summary(self, date_str: str) -> dict[str, Any]:
        self._require_scope("sessions")
        self._require_scope("tasks")
        self._require_scope("reviews")
        from timetrace.services.revision_service import RevisionService

        with Session(engine) as db:
            return RevisionService(db).get_day_summary(date_str)

    def list_day_reviews(
        self,
        *,
        start_date: str,
        end_date: str,
        include_skipped: bool = False,
        limit: int = 100,
    ) -> dict[str, Any]:
        self._require_scope("reviews")
        from timetrace.services.revision_service import RevisionService

        with Session(engine) as db:
            return RevisionService(db).list_day_reviews(
                start_date=start_date,
                end_date=end_date,
                include_skipped=include_skipped,
                limit=limit,
            )

    def get_task_review(self, task_id: str) -> dict[str, Any]:
        self._require_scope("reviews")
        self._require_scope("tasks")
        from timetrace.services.task_service import TaskService

        with Session(engine) as db:
            return TaskService(db).get_task_review_for_ai(task_id)

    def list_task_reviews(
        self,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        task_id: str | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        self._require_scope("reviews")
        self._require_scope("tasks")
        from timetrace.services.task_service import TaskService

        with Session(engine) as db:
            return TaskService(db).list_task_reviews_for_ai(
                start_date=start_date, end_date=end_date, task_id=task_id, limit=limit
            )

    def list_rating_definitions(self) -> list[dict[str, Any]]:
        self._require_scope("ratings")
        from timetrace.services.rating_service import RatingService

        with Session(engine) as db:
            return RatingService(db).list_definitions_for_ai()

    def list_rating_entries(
        self,
        *,
        target_type: str | None = None,
        target_id: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        include_dismissed: bool = False,
        limit: int = 100,
    ) -> dict[str, Any]:
        self._require_scope("ratings")
        if target_type == "task":
            self._require_scope("tasks")
        elif target_type == "session":
            self._require_scope("sessions")
        elif target_type == "habit":
            self._require_scope("habits")
        elif target_type is None and self.data_scope is not None:
            required_domains = ("tasks", "sessions", "habits")
            if any(not self.data_scope.get(domain, False) for domain in required_domains):
                raise ValidationError(
                    "AI data scope for task/session/habit targets is disabled; filter rating entries by "
                    "target_type=day or enable the corresponding domains in Settings > AI."
                )
        from timetrace.services.rating_service import RatingService

        with Session(engine) as db:
            return RatingService(db).list_entries_for_ai(
                target_type=target_type,
                target_id=target_id,
                start_date=start_date,
                end_date=end_date,
                include_dismissed=include_dismissed,
                limit=limit,
            )

    def get_timer_status(self) -> dict[str, Any]:
        self._require_scope("timer")
        from timetrace.services.timer_service import TimerService

        with Session(engine) as db:
            return TimerService(db).get_status()

    def get_reflection_context(
        self,
        *,
        start_date: str,
        end_date: str,
        include_timer: bool = False,
    ) -> dict[str, Any]:
        for domain in ("sessions", "tasks", "habits", "reviews", "ratings"):
            self._require_scope(domain)
        if include_timer:
            self._require_scope("timer")
        from timetrace.services.ai_insights_service import AIInsightsService

        with Session(engine) as db:
            return AIInsightsService(db).get_reflection_context(
                start_date=start_date,
                end_date=end_date,
                include_timer=include_timer,
                batch_id=self.batch_id,
            )

    # ------------------------------------------------------------------
    # Confirmation-gated settings proposal
    # ------------------------------------------------------------------

    def propose_day_review(
        self,
        *,
        date_str: str,
        rating: int,
        highlights: str = "",
        friction: str = "",
        notes: str = "",
        review_skipped: bool = False,
        rationale: str = "",
    ) -> dict[str, Any]:
        """Create a day-review draft and never touch ``dayreview`` directly."""
        self._require_scope("reviews")
        try:
            request = DayReviewCreate(
                date_str=date_str,
                rating=rating,
                highlights=highlights,
                friction=friction,
                notes=notes,
                review_skipped=review_skipped,
            )
        except PydanticValidationError as exc:
            raise ValidationError(f"Invalid day review proposal: {exc}") from exc

        from timetrace.services.ai_draft_service import AIDraftService

        with Session(engine) as db:
            existing = db.exec(select(DayReview).where(DayReview.date_str == request.date_str)).first()
            baseline = AIDraftService.normalize_day_review(existing) if existing else None
            proposed = {
                "date_str": request.date_str,
                "rating": request.rating,
                "highlights": request.highlights or "",
                "friction": request.friction or "",
                "notes": request.notes or "",
                "review_skipped": bool(request.review_skipped),
                "ui_kind": "review",
            }
            item = self._add_item(
                db,
                op="update" if existing else "create",
                entity_type="day_review",
                target_id=request.date_str,
                proposed=proposed,
                baseline=baseline,
                rationale=rationale,
            )
        item["confirmation_message"] = "I prepared a day-review proposal for your approval."
        return item

    def propose_remembered_instruction(self, instruction: str) -> dict[str, Any]:
        """Create one pending instruction proposal, never mutate AISettings directly."""
        if not self.source_message_id or not self.conversation_id:
            raise ValidationError("remembered instructions require conversation context")
        if not is_remember_intent(self.source_message_text):
            raise ValidationError("the original message did not clearly request a standing preference")

        # Tool calls may be dispatched concurrently. The in-memory guard covers this gateway's
        # turn, while AIInstructionService repeats the source-message check in its DB session.
        with self._instruction_proposal_lock:
            if self._instruction_proposal_created:
                raise ValidationError("only one remembered-instruction proposal is allowed per turn")
            self._instruction_proposal_created = True
            try:
                from timetrace.services.ai_instruction_service import AIInstructionService

                with Session(engine) as db:
                    proposal = AIInstructionService(db).create_proposal(
                        conversation_id=self.conversation_id,
                        source_message_id=self.source_message_id,
                        instruction=instruction,
                    )
                    return {
                        "id": proposal.id,
                        "conversation_id": proposal.conversation_id,
                        "source_message_id": proposal.source_message_id,
                        "operation": proposal.operation,
                        "proposed_instruction": proposal.proposed_instruction,
                        "before_instructions": proposal.before_instructions,
                        "after_instructions": proposal.after_instructions,
                        "status": proposal.status,
                        "confirmation_message": (
                            "I proposed this standing instruction. Save it to use it in future conversations."
                        ),
                    }
            except Exception:
                self._instruction_proposal_created = False
                raise

    # ------------------------------------------------------------------
    # Write tools -- each only ever inserts one or more `aidraftitem` rows against this
    # gateway's own batch. None of these write a `task`/`session` row directly.
    # ------------------------------------------------------------------

    def propose_create_session(
        self,
        *,
        task_id: str | None,
        start_time: datetime,
        end_time: datetime,
        notes: str = "",
        tags: str = "",
        rationale: str = "",
    ) -> dict[str, Any]:
        """Proposes a new session. `ui_kind` is computed as `add`. Only ever inserts an
        `aidraftitem`; never writes a real `session` row."""
        start_utc = ensure_utc(start_time)
        end_utc = ensure_utc(end_time)
        if end_utc <= start_utc:
            raise ValidationError("end_time must be strictly after start_time")

        with Session(engine) as db:
            if task_id is not None and not db.get(Task, task_id):
                raise EntityNotFoundError("Task", task_id)

            proposed = {
                "task_id": task_id,
                "start_time": _dt_iso(start_utc),
                "end_time": _dt_iso(end_utc),
                "notes": notes or "",
                "tags": tags or "",
                "ui_kind": "add",
            }
            item = self._add_item(
                db,
                op="create",
                entity_type="session",
                target_id=None,
                proposed=proposed,
                baseline=None,
                rationale=rationale,
            )
        return item

    def propose_update_session(
        self,
        session_id: str,
        *,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        task_id: str | None = None,
        notes: str | None = None,
        tags: str | None = None,
        rationale: str = "",
    ) -> dict[str, Any]:
        """Proposes a change to an existing session -- covers both move and resize.

        `ui_kind` is computed as `move` when the proposed start/end shift the window without
        changing its duration, `resize` when the duration changes, and `update` when only
        non-time fields (task/notes/tags) change.
        """
        with Session(engine) as db:
            baseline = self._get_session_baseline(db, session_id)
            if task_id is not None and not db.get(Task, task_id):
                raise EntityNotFoundError("Task", task_id)

            proposed: dict[str, Any] = {}
            if start_time is not None:
                proposed["start_time"] = _dt_iso(ensure_utc(start_time))
            if end_time is not None:
                proposed["end_time"] = _dt_iso(ensure_utc(end_time))
            if task_id is not None:
                proposed["task_id"] = task_id
            if notes is not None:
                proposed["notes"] = notes
            if tags is not None:
                proposed["tags"] = tags

            new_start = _parse_dt(proposed.get("start_time")) or _parse_dt(baseline.get("start_time"))
            new_end = _parse_dt(proposed.get("end_time")) or _parse_dt(baseline.get("end_time"))
            if new_start and new_end and new_end <= new_start:
                raise ValidationError("end_time must be strictly after start_time")

            if "start_time" not in proposed and "end_time" not in proposed:
                ui_kind = "update"
            else:
                old_start = _parse_dt(baseline.get("start_time"))
                old_end = _parse_dt(baseline.get("end_time"))
                old_duration = (old_end - old_start) if old_start and old_end else None
                new_duration = (new_end - new_start) if new_start and new_end else None
                ui_kind = "resize" if old_duration != new_duration else "move"
            proposed["ui_kind"] = ui_kind

            item = self._add_item(
                db,
                op="update",
                entity_type="session",
                target_id=session_id,
                proposed=proposed,
                baseline=baseline,
                rationale=rationale,
            )
        return item

    def propose_delete_session(self, session_id: str, *, rationale: str = "") -> dict[str, Any]:
        """Proposes deleting an existing session. `ui_kind` is computed as `remove`."""
        with Session(engine) as db:
            baseline = self._get_session_baseline(db, session_id)
            item = self._add_item(
                db,
                op="delete",
                entity_type="session",
                target_id=session_id,
                proposed={"ui_kind": "remove"},
                baseline=baseline,
                rationale=rationale,
            )
        return item

    def propose_split_session(
        self,
        session_id: str,
        *,
        split_points: list[datetime],
        rationale: str = "",
    ) -> list[dict[str, Any]]:
        """Splits one session into `len(split_points) + 1` pieces.

        Expands to one `update` item reusing `session_id` for the first piece, plus `n - 1`
        `create` items for the rest (spec S6: deliberately no compound op, so apply/undo stays
        per-row trivial). All resulting items carry the same `group_key` inside their
        `proposed_json` (there is no dedicated DB column for this -- `AIDraftItem` has none, and
        the spec describes `group_key` as something "the API additionally emits", i.e. computed
        by reading it back out of `proposed_json`, not stored separately). Requires a
        materialized (real) session id -- a virtual recurring occurrence has no row to split.
        """
        if not split_points:
            raise ValidationError("split_points must be non-empty")

        with Session(engine) as db:
            if is_occurrence_id(session_id):
                raise ValidationError(
                    "propose_split_session requires a materialized session id; "
                    "a virtual recurring occurrence must be edited (which materializes it) "
                    "before it can be split."
                )
            baseline = self._get_session_baseline(db, session_id)
            base_start = _parse_dt(baseline.get("start_time"))
            base_end = _parse_dt(baseline.get("end_time"))
            if not base_start or not base_end:
                raise ValidationError("session has no start/end time to split")

            points = sorted(ensure_utc(p) for p in split_points)
            boundaries = [base_start, *points, base_end]
            for a, b in zip(boundaries, boundaries[1:], strict=False):
                if b <= a:
                    raise ValidationError(
                        "split_points must be strictly increasing and strictly between "
                        "the session's start_time and end_time"
                    )

            group_key = generate_uuid7()
            results: list[dict[str, Any]] = []

            first_proposed = {
                "start_time": _dt_iso(boundaries[0]),
                "end_time": _dt_iso(boundaries[1]),
                "ui_kind": "split",
                "group_key": group_key,
            }
            results.append(
                self._add_item(
                    db,
                    op="update",
                    entity_type="session",
                    target_id=session_id,
                    proposed=first_proposed,
                    baseline=baseline,
                    rationale=rationale,
                )
            )

            for seg_start, seg_end in zip(boundaries[1:], boundaries[2:], strict=False):
                proposed = {
                    "task_id": baseline.get("task_id"),
                    "start_time": _dt_iso(seg_start),
                    "end_time": _dt_iso(seg_end),
                    "notes": baseline.get("notes") or "",
                    "tags": baseline.get("tags") or "",
                    "ui_kind": "split",
                    "group_key": group_key,
                }
                results.append(
                    self._add_item(
                        db,
                        op="create",
                        entity_type="session",
                        target_id=None,
                        proposed=proposed,
                        baseline=None,
                        rationale=rationale,
                    )
                )
        return results

    def propose_create_task(
        self,
        *,
        title: str,
        description: str = "",
        tags: str = "",
        priority: str = "-",
        parent_id: str | None = None,
        due_date: datetime | None = None,
        estimated_duration_minutes: int | None = None,
        is_recurring: bool = False,
        recurrence_rule: str | None = None,
        recurrence_rrule: str | None = None,
        recurrence_dtstart: datetime | None = None,
        recurrence_duration_minutes: int | None = None,
        rationale: str = "",
    ) -> dict[str, Any]:
        """Proposes a new task.

        Trap (spec S9.2): `title`/`description` must be the model's literal intended text --
        never embed `#tag`, `!priority`, `(desc)`, `due:Nd`, or `[15m]` syntax in `title`.
        `TaskService.create_task` runs `apply_quick_task_syntax` + `parse_title_estimation` on
        every create (this happens at *accept* time, in the draft engine, not here) and will
        silently rewrite the title and overwrite the estimate. Put tags in `tags`, priority in
        `priority`, due date in `due_date`, and the estimate in
        `estimated_duration_minutes` instead.

        Recurrence fields are passed straight through to `TaskCreate`/`RecurrenceService`
        unvalidated here (accept-time construction validates the RRULE); `recurrence_rrule`, if
        given, wins over `recurrence_rule`.
        """
        if not title or not title.strip():
            raise ValidationError("title must not be empty")

        with Session(engine) as db:
            if parent_id is not None and not db.get(Task, parent_id):
                raise EntityNotFoundError("Task", parent_id)

            proposed = {
                "title": title,
                "description": description or "",
                "tags": tags or "",
                "priority": priority or "-",
                "parent_id": parent_id,
                "due_date": _dt_iso(due_date) if due_date else None,
                "estimated_minutes": estimated_duration_minutes,
                "is_recurring": is_recurring,
                "recurrence_rule": recurrence_rule,
                "recurrence_rrule": recurrence_rrule,
                "recurrence_dtstart": _dt_iso(recurrence_dtstart) if recurrence_dtstart else None,
                "recurrence_duration_minutes": recurrence_duration_minutes,
                "ui_kind": "add",
            }
            item = self._add_item(
                db,
                op="create",
                entity_type="task",
                target_id=None,
                proposed=proposed,
                baseline=None,
                rationale=rationale,
            )
        return item

    def propose_update_task(
        self,
        task_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
        tags: str | None = None,
        priority: str | None = None,
        status: str | None = None,
        due_date: datetime | None = None,
        estimated_duration_minutes: int | None = None,
        rationale: str = "",
    ) -> dict[str, Any]:
        """Proposes a change to an existing task. Same title/description trap as
        `propose_create_task` applies -- `TaskService.update_task` runs the same quick-syntax
        rewrite on any updated `title`."""
        # Local import: see the module docstring's "Dependency note".
        from timetrace.services.ai_draft_service import AIDraftService

        with Session(engine) as db:
            task = db.get(Task, task_id)
            if not task:
                raise EntityNotFoundError("Task", task_id)
            # `AIDraftService._fetch_live_snapshot` normalizes the same way at accept-time via
            # `normalize_task` -- baseline must match exactly or every update looks stale.
            baseline = AIDraftService.normalize_task(task)

            proposed: dict[str, Any] = {}
            if title is not None:
                proposed["title"] = title
            if description is not None:
                proposed["description"] = description
            if tags is not None:
                proposed["tags"] = tags
            if priority is not None:
                proposed["priority"] = priority
            if status is not None:
                proposed["status"] = status
            if due_date is not None:
                proposed["due_date"] = _dt_iso(due_date)
            if estimated_duration_minutes is not None:
                proposed["estimated_minutes"] = estimated_duration_minutes
            proposed["ui_kind"] = "update"

            item = self._add_item(
                db,
                op="update",
                entity_type="task",
                target_id=task_id,
                proposed=proposed,
                baseline=baseline,
                rationale=rationale,
            )
        return item

    def propose_delete_task(self, task_id: str, *, rationale: str = "") -> dict[str, Any]:
        """Proposes deleting an existing task. `ui_kind` is computed as `remove`. Any session
        still linked to this task is unlinked (`task_id` set to null), not deleted -- that's
        `TaskService.delete_task`'s existing behavior, unchanged here.

        Refuses (raises `ValidationError`) if the task has subtasks: `TaskService.delete_task`
        cascades to the whole subtree, but this draft item can only snapshot the ONE task's
        before-state, so undo could never faithfully restore deleted children. Delete each
        subtask individually first, or tell the user to confirm a whole-subtree delete from the
        task page instead.
        """
        # Local import: see the module docstring's "Dependency note".
        from timetrace.services.ai_draft_service import AIDraftService

        with Session(engine) as db:
            task = db.get(Task, task_id)
            if not task:
                raise EntityNotFoundError("Task", task_id)
            has_children = db.exec(select(Task.id).where(Task.parent_id == task_id).limit(1)).first() is not None
            if has_children:
                raise ValidationError(
                    f"task {task_id} has subtasks; propose_delete_task cannot safely undo a "
                    "cascading subtree delete -- delete each subtask individually first"
                )
            baseline = AIDraftService.normalize_task(task)
            item = self._add_item(
                db,
                op="delete",
                entity_type="task",
                target_id=task_id,
                proposed={"ui_kind": "remove"},
                baseline=baseline,
                rationale=rationale,
            )
        return item

    def propose_create_subtasks(
        self,
        parent_task_id: str,
        *,
        titles: list[str],
        rationale: str = "",
    ) -> list[dict[str, Any]]:
        """Proposes breaking `parent_task_id` down into one new subtask per entry in `titles`
        (in order). Expands to `len(titles)` `propose_create_task`-shaped items (spec S6 --
        deliberately no compound op), all sharing one `group_key`. Same title trap as
        `propose_create_task` -- plain literal titles, never quick-add shorthand.
        """
        if not titles:
            raise ValidationError("titles must be non-empty")
        clean_titles = [t.strip() for t in titles if t and t.strip()]
        if not clean_titles:
            raise ValidationError("titles must contain at least one non-empty title")

        with Session(engine) as db:
            if not db.get(Task, parent_task_id):
                raise EntityNotFoundError("Task", parent_task_id)

            group_key = generate_uuid7()
            results: list[dict[str, Any]] = []
            for title in clean_titles:
                proposed = {
                    "title": title,
                    "description": "",
                    "tags": "",
                    "priority": "-",
                    "parent_id": parent_task_id,
                    "ui_kind": "add",
                    "group_key": group_key,
                }
                results.append(
                    self._add_item(
                        db,
                        op="create",
                        entity_type="task",
                        target_id=None,
                        proposed=proposed,
                        baseline=None,
                        rationale=rationale,
                    )
                )
        return results

    def set_plan_summary(self, summary: str) -> dict[str, Any]:
        """Sets `aidraftbatch.summary` for this turn's batch. Not itself a CRUD op against
        task/session state, so it writes the batch row directly rather than going through
        `AIDraftService.add_item`."""
        with Session(engine) as db:
            batch = db.get(AIDraftBatch, self.batch_id)
            if not batch:
                raise EntityNotFoundError("AIDraftBatch", self.batch_id)
            batch.summary = summary
            db.add(batch)
            db.commit()
            return {"batch_id": self.batch_id, "summary": summary}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _task_to_dict(self, task: Task) -> dict[str, Any]:
        return {
            "id": task.id,
            "title": task.title,
            "description": task.description,
            "priority": task.priority,
            "status": task.status,
            "status_id": task.status_id,
            "category": task.category,
            "tags": task.tags,
            "estimated_minutes": task.estimated_minutes,
            "due_date": _dt_iso(task.due_date) if task.due_date else None,
            "assigned_date": task.assigned_date,
            "parent_id": task.parent_id,
            "is_recurring": task.is_recurring,
            "created_at": _dt_iso(task.created_at) if task.created_at else None,
        }

    def _get_session_baseline(self, db: Session, session_id: str) -> dict[str, Any]:
        """Live state of a session/occurrence at propose-time -- becomes `baseline_json`.
        Raises `EntityNotFoundError` if the target doesn't exist (a real row) or can't be
        resolved (a virtual occurrence past its window etc).

        Returned through `AIDraftService.normalize_session` (not the raw
        `get_session_by_id` dict) -- `AIDraftService._fetch_live_snapshot` normalizes the same
        way at accept-time, and the staleness check is a plain `==` between this and that. A
        differently-shaped baseline would make every proposal look stale the instant it's
        proposed.
        """
        # Local import: see the module docstring's "Dependency note" -- `ai_draft_service.py`
        # is a sibling track's file.
        from timetrace.services.ai_draft_service import AIDraftService

        try:
            raw = SessionService(db).get_session_by_id(session_id)
        except EntityNotFoundError:
            raise
        except Exception as exc:  # noqa: BLE001 -- recurrence resolution can raise ValidationError etc.
            raise EntityNotFoundError("Session", session_id) from exc
        return AIDraftService.normalize_session(raw)

    def _add_item(
        self,
        db: Session,
        *,
        op: str,
        entity_type: str,
        target_id: str | None,
        proposed: dict[str, Any],
        baseline: dict[str, Any] | None,
        rationale: str,
    ) -> dict[str, Any]:
        # Local import (not module-level): `ai_draft_service.py` is a sibling track's file and
        # may not exist yet at import time -- see the module docstring's "Dependency note".
        from timetrace.services.ai_draft_service import AIDraftService

        draft_service = AIDraftService(db)
        result = draft_service.add_item(
            batch_id=self.batch_id,
            op=op,
            entity_type=entity_type,
            target_id=target_id,
            proposed_json=json.dumps(proposed, default=str),
            baseline_json=json.dumps(baseline, default=str) if baseline is not None else None,
            rationale=rationale or None,
        )
        return self._item_result(result)

    _ITEM_RESULT_FIELDS = (
        "id",
        "batch_id",
        "position",
        "op",
        "entity_type",
        "target_id",
        "proposed_json",
        "baseline_json",
        "status",
        "rationale",
    )

    def _item_result(self, result: Any) -> dict[str, Any]:
        """Normalizes whatever `AIDraftService.add_item` returns into a plain dict. Tolerates
        either a SQLModel row or an already-plain dict, since the exact return shape of
        `add_item` was not settled at the time this file was written.

        Deliberately does **not** rely on `.model_dump()` for a SQLModel row: a freshly
        committed-and-refreshed `AIDraftItem` (exactly what `add_item` returns) has been
        observed to `model_dump()` to `{}` on this project's pinned `sqlmodel==0.0.39` even
        though its attributes are populated -- a known pydantic/SQLModel interaction, not
        something wrong with the row. Plain `getattr` access is unaffected, so that's what's
        used here."""
        if isinstance(result, dict):
            return result
        return {field: getattr(result, field, None) for field in self._ITEM_RESULT_FIELDS}


__all__ = ["DbAIToolGateway"]
