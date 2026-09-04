"""`DbAIToolGateway` -- the real, SQLite-backed implementation of `core.ai.spec.AIToolGateway`.

Spec S5 layering: `core/ai/tools.py` (a later track) declares the LangChain tool surface against
the `AIToolGateway` Protocol; this module is the only place that Protocol is backed by real
queries. Every method here is DB-adjacent -- `core/` must stay free of this.

**Concurrency deviation (spec S5, S9):** every method opens its own short-lived `Session(engine)`
instead of taking a `Depends(get_session)`-injected one. LangGraph's tool node can run several
tool calls from one AI message *concurrently*; a single SQLModel `Session` is not safe under
that, so each call gets a private connection, does its work, and closes it before returning.

**Batch binding (spec S6):** a `DbAIToolGateway` is constructed once per agent turn, bound to
exactly one `AIDraftBatch` via `batch_id`. None of the write ("propose_*") methods take a
`batch_id` argument -- the model cannot address any batch but the one this gateway was built
for.

**Write tools never touch `task`/`session` rows.** Each `propose_*` method computes
`proposed_json` / `baseline_json` and hands off to `AIDraftService.add_item(...)` (a sibling
track's service, `services/ai_draft_service.py`), which is the only thing that inserts the
`aidraftitem` row. That import is done lazily inside each write method (not at module import
time) because `ai_draft_service.py` did not exist yet when this file was written -- see the
"Dependency note" at the bottom of this docstring.

Dependency note for whoever reconciles the two tracks: this file assumes
`AIDraftService(db).add_item(batch_id, op, entity_type, target_id, proposed_json, baseline_json,
rationale=None)` where `proposed_json`/`baseline_json` are pre-serialized JSON strings (or
`None`), and that it returns something with either a `.model_dump()` (a SQLModel row) or a plain
dict shape (an id at minimum). `_item_result()` below normalizes either shape. If the real
signature differs, only the four `propose_*_session`/`propose_*_task` call sites and
`_item_result()` need to change.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from pydantic import ValidationError as PydanticValidationError
from sqlmodel import Session, func, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.core.query_spec import AnalyticsQuery, Dimension, FilterField, Measure, QuerySource
from timetrace.core.recurrence import is_occurrence_id
from timetrace.core.timezones import daemon_tzinfo, from_local_naive, to_local_naive
from timetrace.db.models import AIDraftBatch, AIDraftItem, Task, generate_uuid7
from timetrace.db.session import engine
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.query_service import QueryService
from timetrace.services.session_service import SessionService

# ---------------------------------------------------------------------------------------------
# get_time_stats allow-list (spec S6: "an allow-listed passthrough to QueryService.run ... pick
# a small, safe subset of measures/dimensions"). This is deliberately narrower than the full
# structured-query surface the human dashboard builder gets: an LLM tool call should be able to
# ask "how much time on #tag last week" or "how many sessions per task this month", not run the
# entire query vocabulary (habits/ratings/day-reviews, hour-of-day/weekday buckets, estimation
# buckets) -- those stay out until there's an actual tool-calling use case for them.
# ---------------------------------------------------------------------------------------------
_ALLOWED_STATS_SOURCES = {QuerySource.SESSIONS, QuerySource.TASKS}
_ALLOWED_STATS_MEASURES = {
    Measure.SUM_DURATION,
    Measure.SESSION_COUNT,
    Measure.AVG_SESSION_LENGTH,
    Measure.TASK_COUNT,
    Measure.COMPLETION_RATE,
}
_ALLOWED_STATS_DIMENSIONS = {
    Dimension.DAY,
    Dimension.WEEK,
    Dimension.MONTH,
    Dimension.TAG,
    Dimension.TASK,
    Dimension.STATUS,
    Dimension.PRIORITY,
    Dimension.CATEGORY,
}
_ALLOWED_STATS_FILTER_FIELDS = {d.value for d in _ALLOWED_STATS_DIMENSIONS} | {
    FilterField.DURATION_SECONDS.value,
    FilterField.HAS_TASK.value,
    FilterField.NOTES.value,
}

_STATS_MAX_LIMIT = 100

# Naive local "working hours" window used by `find_free_slots(working_hours_only=True)`. No
# precedent elsewhere in the codebase for this, so it is a plain module constant here rather
# than a setting -- revisit if/when `aisettings` grows a configurable window.
_WORKING_HOURS_START = 9
_WORKING_HOURS_END = 17

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

    def __init__(self, batch_id: str):
        self.batch_id = batch_id

    # ------------------------------------------------------------------
    # Read tools
    # ------------------------------------------------------------------

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
        limit = max(1, min(limit, 500))
        with Session(engine) as db:
            rows = SessionService(db).list_sessions(start=start, end=end, include_virtual=True)
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

        `working_hours_only` restricts free gaps to `09:00`-`17:00` in the daemon's local
        timezone, every day (no weekend/weekday distinction -- there's no precedent for that
        split elsewhere in this codebase, so it isn't invented here).
        """
        if min_duration_minutes <= 0:
            raise ValidationError("min_duration_minutes must be positive")

        start_utc = ensure_utc(start)
        end_utc = ensure_utc(end)
        if end_utc <= start_utc:
            raise ValidationError("end must be strictly after start")

        with Session(engine) as db:
            sessions = SessionService(db).list_sessions(start=start_utc, end=end_utc, include_virtual=True)
            add_windows, remove_windows = self._pending_batch_session_windows(db)

        busy: list[tuple[datetime, datetime]] = []
        for s in sessions:
            st = _parse_dt(s.get("start_time"))
            et = _parse_dt(s.get("end_time"))
            if st and et:
                busy.append((st, et))
        busy.extend(add_windows)
        if extra_busy_windows:
            busy.extend((ensure_utc(w[0]), ensure_utc(w[1])) for w in extra_busy_windows)

        def _overlaps(a: tuple[datetime, datetime], b: tuple[datetime, datetime]) -> bool:
            return a[0] < b[1] and b[0] < a[1]

        if remove_windows:
            busy = [w for w in busy if not any(_overlaps(w, r) for r in remove_windows)]

        # Clip to range and merge overlapping/adjacent intervals.
        clipped = [(max(st, start_utc), min(et, end_utc)) for st, et in busy]
        clipped = [(st, et) for st, et in clipped if st < et]
        clipped.sort(key=lambda w: w[0])

        merged: list[list[datetime]] = []
        for st, et in clipped:
            if merged and st <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], et)
            else:
                merged.append([st, et])

        gaps: list[tuple[datetime, datetime]] = []
        cursor = start_utc
        for st, et in merged:
            if st > cursor:
                gaps.append((cursor, st))
            cursor = max(cursor, et)
        if cursor < end_utc:
            gaps.append((cursor, end_utc))

        min_delta = timedelta(minutes=min_duration_minutes)
        if working_hours_only:
            gaps = self._clip_to_working_hours(gaps)

        result = []
        for gap_start, gap_end in gaps:
            if gap_end - gap_start >= min_delta:
                result.append(
                    {
                        "start": gap_start.isoformat(),
                        "end": gap_end.isoformat(),
                        "duration_minutes": int((gap_end - gap_start).total_seconds() // 60),
                    }
                )
        return result

    def get_time_stats(self, query: dict[str, Any]) -> dict[str, Any]:
        """Allow-listed passthrough to `QueryService.run` (the real-SQL stats engine from
        dashboards slice 1) -- never `AnalyticsService`, which loads every session/task into
        Python.

        Allow-list (deliberately a small subset of the full query vocabulary; see module-level
        constants for the exact sets):
          - `source`: `sessions`, `tasks`.
          - `measure`: `sum_duration`, `session_count`, `avg_session_length`, `task_count`,
            `completion_rate`.
          - `group_by` dimensions: `day`, `week`, `month`, `tag`, `task`, `status`, `priority`,
            `category` (at most 2, per `AnalyticsQuery`).
          - `filters` fields: the same dimensions above, plus `duration_seconds`, `has_task`,
            `notes`.
          - `limit` is capped at 100 regardless of what's requested.
        Everything else in `query` (`date_range`, `chart`, `tag_attribution`, `sort`,
        `fill_gaps`) is passed through to `AnalyticsQuery` as-is and validated by its own
        pydantic schema.
        """
        source = query.get("source")
        measure = query.get("measure")
        if source not in {s.value for s in _ALLOWED_STATS_SOURCES}:
            raise ValidationError(
                f"get_time_stats: source must be one of "
                f"{sorted(s.value for s in _ALLOWED_STATS_SOURCES)}, got {source!r}"
            )
        if measure not in {m.value for m in _ALLOWED_STATS_MEASURES}:
            raise ValidationError(
                f"get_time_stats: measure must be one of "
                f"{sorted(m.value for m in _ALLOWED_STATS_MEASURES)}, got {measure!r}"
            )

        group_by = query.get("group_by") or []
        for dim in group_by:
            if dim not in {d.value for d in _ALLOWED_STATS_DIMENSIONS}:
                raise ValidationError(
                    f"get_time_stats: group_by dimension must be one of "
                    f"{sorted(d.value for d in _ALLOWED_STATS_DIMENSIONS)}, got {dim!r}"
                )

        filters = query.get("filters") or []
        for f in filters:
            field = f.get("field") if isinstance(f, dict) else None
            if field not in _ALLOWED_STATS_FILTER_FIELDS:
                raise ValidationError(
                    f"get_time_stats: filter field must be one of {sorted(_ALLOWED_STATS_FILTER_FIELDS)}, got {field!r}"
                )

        limit = min(int(query.get("limit", 50) or 50), _STATS_MAX_LIMIT)

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

    def _pending_batch_session_windows(
        self, db: Session
    ) -> tuple[list[tuple[datetime, datetime]], list[tuple[datetime, datetime]]]:
        """Pending `AIDraftItem` session proposals in this batch, split into windows to ADD to
        the busy set (pending create/update proposals) and windows to REMOVE from it (pending
        delete proposals, read off their `baseline_json`). See `find_free_slots`."""
        add_windows: list[tuple[datetime, datetime]] = []
        remove_windows: list[tuple[datetime, datetime]] = []

        items = db.exec(
            select(AIDraftItem).where(
                AIDraftItem.batch_id == self.batch_id,
                AIDraftItem.entity_type == "session",
                AIDraftItem.status == "pending",
            )
        ).all()

        for item in items:
            proposed = json.loads(item.proposed_json or "{}")
            baseline = json.loads(item.baseline_json) if item.baseline_json else None

            if item.op in ("create", "update"):
                st = _parse_dt(proposed.get("start_time"))
                et = _parse_dt(proposed.get("end_time"))
                if item.op == "update" and baseline:
                    st = st or _parse_dt(baseline.get("start_time"))
                    et = et or _parse_dt(baseline.get("end_time"))
                if st and et:
                    add_windows.append((st, et))
            elif item.op == "delete" and baseline:
                st = _parse_dt(baseline.get("start_time"))
                et = _parse_dt(baseline.get("end_time"))
                if st and et:
                    remove_windows.append((st, et))

        return add_windows, remove_windows

    def _clip_to_working_hours(self, gaps: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
        """Intersects each UTC gap with `09:00`-`17:00` local time, per local calendar day."""
        tz = daemon_tzinfo()
        result: list[tuple[datetime, datetime]] = []
        for gap_start, gap_end in gaps:
            local_start = to_local_naive(gap_start, tz)
            local_end = to_local_naive(gap_end, tz)
            day = local_start.date()
            last_day = local_end.date()
            while day <= last_day:
                window_start = datetime.combine(day, datetime.min.time()).replace(hour=_WORKING_HOURS_START)
                window_end = datetime.combine(day, datetime.min.time()).replace(hour=_WORKING_HOURS_END)
                clipped_start = max(local_start, window_start)
                clipped_end = min(local_end, window_end)
                if clipped_start < clipped_end:
                    result.append(
                        (
                            ensure_utc(from_local_naive(clipped_start, tz)),
                            ensure_utc(from_local_naive(clipped_end, tz)),
                        )
                    )
                day += timedelta(days=1)
        return result


__all__ = ["DbAIToolGateway"]
