"""`AIToolGateway` -- the Protocol `core/ai/tools.py` declares tools against (spec S5, S6).

DB-free by design: this module imports nothing from `db/` or `services/`. It exists so the tool
surface can be built and unit-tested against a fake gateway with no SQLite, and so `core/` stays
free of FastAPI/SQLModel. The real implementation, `services/ai_tool_gateway.py: DbAIToolGateway`,
belongs to a later track and is out of scope here -- this file only pins down the interface
precisely enough for that later work to implement against.

A gateway instance is constructed per agent turn, scoped to exactly one draft batch: write methods
take no `batch_id` argument (spec S6) because the batch comes from the gateway itself, so the model
can never address another batch by guessing an id. Gateway methods open their own short-lived
`Session(engine)` internally (documented deviation from `Depends(get_session)`, spec S5) because
LangGraph may run several tool calls from one AI message concurrently, and a single SQLModel
`Session` is not safe under that.

All datetimes crossing this boundary are naive UTC (matching the DB), consistent with the rest of
the app's `ensure_utc()` convention -- callers convert at the edges, not here.
"""

from datetime import datetime
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class AIToolGateway(Protocol):
    """Read + propose-write surface exposed to the agent for one conversation turn.

    Read methods return plain JSON-serializable dicts/lists (not ORM rows) so they can cross into
    a tool result unchanged. Write methods ("propose_*") never mutate `task`/`session` rows --
    each one only ever inserts an `aidraftitem` row against the batch this gateway was constructed
    around, and returns that item (or its id) so the model can reference it (e.g. for
    `propose_split_session`'s multiple resulting items sharing a `group_key`).
    """

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
        """Lists tasks matching the given filters, most-recently-updated first."""
        ...

    def get_task(self, task_id: str) -> dict[str, Any]:
        """Fetches one task by id. Raises `EntityNotFoundError` if it doesn't exist."""
        ...

    def resolve_task_reference(self, query: str, *, limit: int = 5) -> list[dict[str, Any]]:
        """Fuzzy-resolves a natural-language task reference (a title fragment, not an id) to
        candidate tasks. This is the UUID-era replacement for the dead `@123` inline-parser
        scheme (spec S6) -- the model must call this before referencing a task by name and must
        never invent an id. Returns an empty list rather than raising when nothing matches."""
        ...

    def list_sessions(
        self,
        *,
        start: datetime,
        end: datetime,
        task_id: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Lists sessions overlapping `[start, end)` (naive UTC), optionally filtered to one
        task."""
        ...

    def find_free_slots(
        self,
        *,
        start: datetime,
        end: datetime,
        min_duration_minutes: int,
        working_hours_only: bool = True,
    ) -> list[dict[str, Any]]:
        """Finds open calendar gaps of at least `min_duration_minutes` within `[start, end)`.

        Trap (spec S9.3): implementations must subtract not only existing `session` rows but also
        any `aidraftitem` already proposed earlier in the *same* batch -- otherwise a multi-step
        week-planning turn double-books itself on its second `propose_create_session` call.
        """
        ...

    def get_time_stats(self, query: dict[str, Any]) -> dict[str, Any]:
        """Allow-listed passthrough to `QueryService.run` (the real-SQL stats engine from
        dashboards slice 1). Must never fall back to `AnalyticsService`, which loads every
        session/task into Python (spec S6)."""
        ...

    # ------------------------------------------------------------------
    # Write tools -- each only ever inserts an `aidraftitem` against this gateway's batch
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
        """Proposes a new session. `ui_kind` is computed as `add`."""
        ...

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
        """Proposes a change to an existing session. Covers both move and resize (spec S6) --
        `ui_kind` is computed as `move` when only start/end shift together, `resize` when the
        duration changes."""
        ...

    def propose_delete_session(self, session_id: str, *, rationale: str = "") -> dict[str, Any]:
        """Proposes deleting an existing session. `ui_kind` is computed as `remove`."""
        ...

    def propose_split_session(
        self,
        session_id: str,
        *,
        split_points: list[datetime],
        rationale: str = "",
    ) -> list[dict[str, Any]]:
        """Proposes splitting one session into `len(split_points) + 1` pieces: expands to one
        `propose_update_session`-shaped item (the first piece, reusing the original session id)
        plus `n - 1` `propose_create_session`-shaped items (spec S6 -- deliberately no compound
        op, keeping apply/undo per-row trivial). All resulting items share one `group_key` so the
        frontend can render them as one `split` badge group."""
        ...

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

        Trap (spec S9.2): `title`/`description` must be the model's literal intended values --
        never embed `#tag`, `!priority`, `(desc)`, `due:Nd`, or `[15m]` syntax in `title`, because
        `TaskService.create_task` runs `apply_quick_task_syntax` + `parse_title_estimation` on
        every create and will silently rewrite/overwrite them. Put tags/priority/due/estimate in
        their own fields instead.

        Recurrence: set `is_recurring=True` plus either `recurrence_rule` (one of the presets
        `"daily"`, `"weekdays"`, `"weekly"`, `"monthly"`) or `recurrence_rrule` (a raw RFC 5545
        RRULE body, e.g. `"FREQ=WEEKLY;BYDAY=TU"` for "every Tuesday") -- `recurrence_rrule` wins
        if both are given. `recurrence_dtstart`/`recurrence_duration_minutes` default sensibly
        (today/now, and the task's own estimate) if omitted.
        """
        ...

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
        `propose_create_task` applies to updates run through `TaskService.update_task`."""
        ...

    def propose_delete_task(self, task_id: str, *, rationale: str = "") -> dict[str, Any]:
        """Proposes deleting an existing task. `ui_kind` is computed as `remove`. Any session
        still linked to this task is unlinked (`task_id` set to null), not deleted.

        Refuses (raises `ValidationError`) if the task has subtasks -- a cascading subtree delete
        can only ever be captured as a single draft item's before/after snapshot, so undo could
        not faithfully restore the children. Delete each subtask individually first, or tell the
        user to confirm a whole-subtree delete from the task page instead.
        """
        ...

    def propose_create_subtasks(
        self,
        parent_task_id: str,
        *,
        titles: list[str],
        rationale: str = "",
    ) -> list[dict[str, Any]]:
        """Proposes breaking `parent_task_id` down into multiple subtasks in one call, one per
        title in `titles` (in order). Expands to `len(titles)` `propose_create_task`-shaped items
        (spec S6 -- deliberately no compound op, keeping apply/undo per-row trivial), each with
        `parent_id=parent_task_id`, all sharing one `group_key` so the frontend can render them as
        one group. Same title trap as `propose_create_task` -- plain literal titles, no quick-add
        shorthand. Use `propose_create_task` directly (with `parent_id` set) instead if the
        subtasks need different tags/priority/due dates/estimates from each other; this tool is
        for the common case of "just split this into N titled pieces."
        """
        ...

    def set_plan_summary(self, summary: str) -> dict[str, Any]:
        """Sets the human-readable one-line summary shown on `aidraftbatch.summary` for this
        turn's batch (e.g. "Moved 3 sessions, added 2 tasks"). Not itself a CRUD op against
        task/session state."""
        ...
