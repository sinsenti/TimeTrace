"""LangChain `@tool`-decorated wrappers around `AIToolGateway` (`core/ai/spec.py`), spec S5/S6.

Layering: these functions are built against the `AIToolGateway` **Protocol**, never against
`services.ai_tool_gateway.DbAIToolGateway` directly -- `core/` must not import `services/` (spec
S5). The gateway instance itself is injected per-call via LangGraph's `ToolRuntime.context`
(spec S3), constructed by `create_agent(context_schema=AIAgentContext)` in `core/ai/agent.py` and
populated by the chat service, which is the only place a real `DbAIToolGateway(batch_id=...)` gets
constructed. This file never imports
`timetrace.services` or `timetrace.db` at all.

`AIAgentContext` is the context shape every tool function here reads via `runtime.context`: a
single dataclass with one attribute, `gateway: AIToolGateway`. `core/ai/agent.py` must pass
`context_schema=AIAgentContext` to `create_agent`, and whoever invokes the compiled graph must pass
`context=AIAgentContext(gateway=<a real DbAIToolGateway bound to one draft batch>)`.

No `batch_id` argument appears on any write tool below (spec S6) -- the batch is bound into the
gateway instance itself, so the model cannot address any batch but the one it was given.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from langchain.tools import ToolRuntime, tool
from pydantic import BeforeValidator

from timetrace.core.ai.spec import AIToolGateway

logger = logging.getLogger("timetrace.ai")


def _log_call(name: str, **kwargs: Any) -> None:
    """Log tool activity without recording user productivity data.

    Tool arguments can contain titles, notes, IDs, and prompt-injection text. Keep diagnostics to
    the tool name and argument count; detailed arguments do not belong in logs.
    """
    argument_count = sum(value not in (None, "") for value in kwargs.values())
    logger.info("AI tool call: name=%s argument_count=%d", name, argument_count)


def _log_result(name: str, result: Any) -> Any:
    """Log only the result shape, never task/session content or provider data."""
    if isinstance(result, (list, tuple, set, dict)):
        result_summary = f"{type(result).__name__}[{len(result)}]"
    else:
        result_summary = type(result).__name__
    logger.info("AI tool result: name=%s result=%s", name, result_summary)
    return result


def _blank_to_none(value: Any) -> Any:
    """Smaller/weaker tool-calling models routinely pass `""` for an unset optional argument
    instead of omitting it, which a plain `datetime | None`/`int | None` annotation rejects as
    an invalid datetime/int -- causing a `ToolRetryMiddleware` retry loop on every such call.
    Treat a blank string as "not provided" the same way `None` is."""
    return None if value == "" else value


# Confirmed live (adversarial review): `dateutil.parser.parse` is far more permissive than the
# "bare time like 8 PM" motivation below needs -- it happily turns a bare number or an ambiguous
# range into a full DATE at midnight ('9-5' -> Sep 5th, '12' -> Sep 12th, '5' -> Sep 5th), which
# `propose_create_session` would then silently accept as a real placement on a day the user never
# mentioned. Gate the fallback to inputs that actually look like a time-of-day -- an HH:MM/H:MM
# clock time, or a number followed by am/pm -- so a genuinely ambiguous fragment reaches
# pydantic's own validation error (loud, recoverable by the retry loop) instead of being silently
# reinterpreted as a plausible-looking but wrong date.
_TIME_OF_DAY_RE = re.compile(r"\d{1,2}:\d{2}|\d{1,2}\s*[ap]\.?m\.?\b", re.IGNORECASE)


def _lenient_datetime(value: Any) -> Any:
    """Confirmed live against a real local model (qwen2.5:3b): even with the current date/time
    and an explicit "always include the date, full ISO 8601, UTC" instruction in both the system
    prompt (`ai_chat_service._turn_context`) and this tool's own docstring, a small model still
    sometimes sends a bare, non-ISO time like `"8 PM"` or `"20:00"` for a REQUIRED datetime arg --
    which a plain `datetime` annotation rejects outright, and `ToolRetryMiddleware` retrying with
    the same validation error doesn't reliably fix (the model just re-describes the same mistake
    in prose and repeats it). Rather than depend entirely on prompt compliance, accept a wider
    range of formats: `datetime.fromisoformat` first (the fast, correct path), falling back to
    `dateutil`'s much more permissive parser (already a project dependency, but only for inputs
    that actually look like a time-of-day, per `_TIME_OF_DAY_RE` above), which fills in whatever
    date/time component is missing from today's real date. Any input this still can't parse, or
    doesn't look like a time-of-day to begin with, is passed through unchanged so pydantic's own
    error message (better than swallowing it here) is what reaches the retry loop."""
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return datetime.fromisoformat(stripped)
        except ValueError:
            pass
        if _TIME_OF_DAY_RE.search(stripped):
            try:
                from dateutil import parser as _dateutil_parser

                return _dateutil_parser.parse(stripped)
            except ValueError, OverflowError:
                pass
    return value


OptionalDateTime = Annotated[datetime | None, BeforeValidator(_blank_to_none), BeforeValidator(_lenient_datetime)]
OptionalInt = Annotated[int | None, BeforeValidator(_blank_to_none)]
RequiredDateTime = Annotated[datetime, BeforeValidator(_lenient_datetime)]


@dataclass
class AIAgentContext:
    """The `ToolRuntime.context` shape every tool in this module expects.

    Invisible to the model's tool schema (spec S3) -- purely a way to hand each tool call a
    gateway instance without smuggling it through the LLM-visible arguments.
    """

    gateway: AIToolGateway


# ---------------------------------------------------------------------------------------------
# Read tools
# ---------------------------------------------------------------------------------------------


@tool
def list_tasks(
    runtime: ToolRuntime[AIAgentContext, Any],
    status: str | None = None,
    tag: str | None = None,
    priority: str | None = None,
    parent_id: str | None = None,
    include_done: bool = False,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Lists the user's tasks, most-recently-created first, optionally filtered by status, a
    single tag, priority, or parent task id. Done/completed tasks are excluded unless
    `include_done=True` or an explicit `status` is given. Use this to browse the backlog before
    proposing new sessions or tasks -- it returns real task ids you can reuse in other tool
    calls (e.g. as `task_id` on `propose_create_session`), but never invent an id yourself; only
    ever use one that came back from this tool, `get_task`, or `resolve_task_reference`.
    """
    _log_call("list_tasks", status=status, tag=tag, priority=priority, parent_id=parent_id, include_done=include_done)
    return runtime.context.gateway.list_tasks(
        status=status,
        tag=tag,
        priority=priority,
        parent_id=parent_id,
        include_done=include_done,
        limit=limit,
    )


@tool
def get_task(task_id: str, runtime: ToolRuntime[AIAgentContext, Any]) -> dict[str, Any]:
    """Fetches one task by its exact id. `task_id` must be a real id you already have -- from
    `list_tasks`, `resolve_task_reference`, or a previous tool result -- never one you guessed or
    remembered from an earlier conversation.
    """
    _log_call("get_task", task_id=task_id)
    return runtime.context.gateway.get_task(task_id)


@tool
def resolve_task_reference(
    query: str,
    runtime: ToolRuntime[AIAgentContext, Any],
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Resolves a natural-language task reference (a title fragment like "the report task" or
    "dentist appointment") to candidate real tasks with their ids. Call this whenever the user
    refers to an existing task by name rather than by id, before using that task in any other
    tool call. Never invent a task id -- if this returns an empty list, tell the user nothing
    matched instead of guessing; if it returns more than one candidate, ask the user which one
    they mean instead of picking for them.
    """
    _log_call("resolve_task_reference", query=query)
    return runtime.context.gateway.resolve_task_reference(query, limit=limit)


@tool
def list_sessions(
    start: RequiredDateTime,
    end: RequiredDateTime,
    runtime: ToolRuntime[AIAgentContext, Any],
    task_id: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Lists calendar sessions overlapping `[start, end)`, optionally filtered to one task.
    Includes both real sessions and projected occurrences of recurring tasks. Use this to see
    what the user's calendar already looks like before proposing changes -- but prefer
    `find_free_slots` over eyeballing this list when you specifically need open time, since it
    already does the gap math (including anything you've proposed earlier this turn).
    """
    _log_call("list_sessions", start=start, end=end, task_id=task_id)
    return runtime.context.gateway.list_sessions(start=start, end=end, task_id=task_id, limit=limit)


@tool
def find_free_slots(
    start: RequiredDateTime,
    end: RequiredDateTime,
    min_duration_minutes: int,
    runtime: ToolRuntime[AIAgentContext, Any],
    working_hours_only: bool = True,
) -> list[dict[str, Any]]:
    """Finds open calendar gaps of at least `min_duration_minutes` within `[start, end)`.
    Automatically accounts for the user's existing sessions AND for every session you've already
    proposed earlier in this same turn -- so when placing several new sessions in one
    conversation turn (e.g. a whole-week plan), call this again before each new placement rather
    than reusing gaps you computed before your last proposal, or you risk it looking free when
    it's actually already been proposed. `working_hours_only=True` (the default) applies the
    saved local hours and allowed days; set it `False` to consider the full day while still
    honoring breaks, allowed days, and daily capacity.
    Always call this before `propose_create_session` when you are choosing the placement
    yourself rather than following an explicit time the user gave you.
    """
    _log_call(
        "find_free_slots",
        start=start,
        end=end,
        min_duration_minutes=min_duration_minutes,
        working_hours_only=working_hours_only,
    )
    return runtime.context.gateway.find_free_slots(
        start=start,
        end=end,
        min_duration_minutes=min_duration_minutes,
        working_hours_only=working_hours_only,
    )


@tool
def get_time_stats(query: dict[str, Any], runtime: ToolRuntime[AIAgentContext, Any]) -> dict[str, Any]:
    """Runs an allow-listed statistics query over the user's sessions/tasks, e.g. "how much time
    on #deepwork last week" or "how many sessions per task this month". `query` is a small
    structured dict: `source` (`"sessions"` or `"tasks"`), `measure` (one of `"sum_duration"`,
    `"session_count"`, `"avg_session_length"`, `"task_count"`, `"completion_rate"`), an optional
    `group_by` list of dimensions (`"day"`, `"week"`, `"month"`, `"tag"`, `"task"`, `"status"`,
    `"priority"`, `"category"`), an optional `filters` list, and an optional `date_range`. For
    session queries, `session_time_relative` filters accept `past`, `future`, or `ongoing`. Use
    this instead of trying to compute totals yourself from `list_sessions` output.
    """
    _log_call("get_time_stats", query=query)
    return runtime.context.gateway.get_time_stats(query)


@tool
def search_tasks(
    query: str,
    runtime: ToolRuntime[AIAgentContext, Any],
    status: str | None = None,
    tag: str | None = None,
    priority: str | None = None,
    include_done: bool = False,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Searches task titles, descriptions, tags, and categories using local full-text search.
    Combine this with exact filters when the user describes a task vaguely. The results contain
    real task ids; use `get_task` on the chosen id before proposing any change, and ask the user
    to disambiguate when several candidates match.
    """
    _log_call("search_tasks", query=query, status=status, tag=tag, priority=priority)
    return runtime.context.gateway.search_tasks(
        query,
        status=status,
        tag=tag,
        priority=priority,
        include_done=include_done,
        limit=limit,
    )


@tool
def find_conflicts(
    start: RequiredDateTime,
    end: RequiredDateTime,
    runtime: ToolRuntime[AIAgentContext, Any],
    include_pending: bool = True,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Finds overlapping calendar sessions in `[start, end)`, including recurring projections
    and proposals already made during this turn. Use this before presenting a multi-session plan
    as conflict-free. It is read-only; moving anything still requires `propose_update_session`.
    """
    _log_call("find_conflicts", start=start, end=end, include_pending=include_pending)
    return runtime.context.gateway.find_conflicts(
        start=start,
        end=end,
        include_pending=include_pending,
        limit=limit,
    )


@tool
def get_task_progress(task_id: str, runtime: ToolRuntime[AIAgentContext, Any]) -> dict[str, Any]:
    """Returns authoritative logged hours, scheduled hours, remaining work, progress percent,
    and session count for a real task id. Never infer progress from a list of sessions yourself.
    """
    _log_call("get_task_progress", task_id=task_id)
    return runtime.context.gateway.get_task_progress(task_id)


@tool
def validate_schedule(
    proposed_sessions: list[dict[str, Any]],
    runtime: ToolRuntime[AIAgentContext, Any],
) -> dict[str, Any]:
    """Validates hypothetical session placements against existing sessions, same-turn proposals,
    working hours, allowed days, breaks, daily capacity, and the scheduling window. It never
    writes anything. Call it after making a substantial group of proposals and revise drafts if
    it reports errors.
    """
    _log_call("validate_schedule", proposed_sessions=proposed_sessions)
    return runtime.context.gateway.validate_schedule(proposed_sessions)


@tool
def get_daily_briefing(
    runtime: ToolRuntime[AIAgentContext, Any],
    date: str | None = None,
) -> dict[str, Any]:
    """Returns exact planning context for today, or a local ISO date such as `2026-09-10`:
    sessions, overdue and due-today tasks, logged/scheduled time, free slots, conflicts, and
    scheduling preferences. Use it as the factual basis for a concise daily briefing.
    """
    _log_call("get_daily_briefing", date=date)
    return runtime.context.gateway.get_daily_briefing(date)


@tool
def get_weekly_review(
    start: RequiredDateTime,
    end: RequiredDateTime,
    runtime: ToolRuntime[AIAgentContext, Any],
) -> dict[str, Any]:
    """Returns SQL-backed logged and scheduled time totals and breakdowns by day, task, and tag
    for a bounded range, plus average session length, session counts, and task status counts.
    Use it for a weekly review instead of manually summing raw session results.
    """
    _log_call("get_weekly_review", start=start, end=end)
    return runtime.context.gateway.get_weekly_review(start=start, end=end)


# ---------------------------------------------------------------------------------------------
# Confirmation-gated settings proposals
# ---------------------------------------------------------------------------------------------


@tool
def propose_remembered_instruction(
    instruction: str,
    runtime: ToolRuntime[AIAgentContext, Any],
) -> dict[str, Any]:
    """Proposes one concise standing instruction for the user to review and explicitly save.

    Use this only when the user clearly asks for a future preference, for example "from now on",
    "for future conversations", "keep this as a standing preference", or "make this my default".
    Do not use it for one-off facts, appointments, task descriptions, imported text, or ordinary
    statements such as "I prefer mornings". This creates a proposal only; it never changes the
    user's custom instructions. Never claim it was remembered or saved.
    """
    _log_call("propose_remembered_instruction", instruction=instruction)
    return _log_result(runtime.context.gateway.propose_remembered_instruction(instruction))


# ---------------------------------------------------------------------------------------------
# Write tools -- every one of these only ever creates a pending draft item. None of them writes
# a real task/session row; the user must explicitly accept the draft before anything changes.
# ---------------------------------------------------------------------------------------------


@tool
def propose_create_session(
    start_time: RequiredDateTime,
    end_time: RequiredDateTime,
    runtime: ToolRuntime[AIAgentContext, Any],
    task_id: str | None = None,
    notes: str = "",
    tags: str = "",
    rationale: str = "",
) -> dict[str, Any]:
    """Proposes creating a new calendar session as a draft the user must accept -- this does NOT
    create a real session. Call `find_free_slots` first unless the user gave you an explicit
    time. `task_id` must be a real task id from `list_tasks`/`resolve_task_reference`/`get_task`,
    or `None` for an untasked session. Put a short human-readable reason in `rationale` (e.g. why
    you chose this slot) -- it's shown to the user alongside the draft, not sent back to you.

    A session has NO priority field of its own -- priority lives only on a task. If the user wants
    a "high priority" (or any-priority) session, `task_id` must point at a real task that already
    has that priority (create one with `propose_create_task(priority=...)` first if none fits).
    Writing "high priority" only in `notes`/`rationale` on an untasked session is decorative, not
    real priority.

    `start_time`/`end_time` must be a full ISO 8601 datetime WITH a date, in UTC (e.g.
    `2026-09-04T22:00:00`) -- never a bare time like `"22:00"`. Use the current UTC/local
    datetime given in the system context to pick the right date and convert any local/relative
    time the user gave you into UTC.
    """
    _log_call("propose_create_session", task_id=task_id, start_time=start_time, end_time=end_time, rationale=rationale)
    return _log_result(
        "propose_create_session",
        runtime.context.gateway.propose_create_session(
            task_id=task_id,
            start_time=start_time,
            end_time=end_time,
            notes=notes,
            tags=tags,
            rationale=rationale,
        ),
    )


@tool
def propose_update_session(
    session_id: str,
    runtime: ToolRuntime[AIAgentContext, Any],
    start_time: OptionalDateTime = None,
    end_time: OptionalDateTime = None,
    task_id: str | None = None,
    notes: str | None = None,
    tags: str | None = None,
    rationale: str = "",
) -> dict[str, Any]:
    """Proposes changing an existing session as a draft the user must accept -- this does NOT
    change the real session. Covers moving a session (changing its time without changing its
    duration), resizing it (changing its duration), or just editing its task/notes/tags. Only
    pass the fields you want to change; omitted fields keep their current value. `session_id`
    must be a real session id from `list_sessions`. Put a short human-readable reason in
    `rationale`.

    If given, `start_time`/`end_time` must be a full ISO 8601 datetime WITH a date, in UTC (e.g.
    `2026-09-04T22:00:00`) -- never a bare time like `"22:00"`. Use the current UTC/local
    datetime given in the system context to pick the right date and convert any local/relative
    time the user gave you into UTC.
    """
    _log_call(
        "propose_update_session",
        session_id=session_id,
        start_time=start_time,
        end_time=end_time,
        task_id=task_id,
        rationale=rationale,
    )
    return _log_result(
        "propose_update_session",
        runtime.context.gateway.propose_update_session(
            session_id,
            start_time=start_time,
            end_time=end_time,
            task_id=task_id,
            notes=notes,
            tags=tags,
            rationale=rationale,
        ),
    )


@tool
def propose_delete_session(
    session_id: str,
    runtime: ToolRuntime[AIAgentContext, Any],
    rationale: str = "",
) -> dict[str, Any]:
    """Proposes deleting an existing session as a draft the user must accept -- this does NOT
    delete the real session. `session_id` must be a real session id from `list_sessions`. Put a
    short human-readable reason in `rationale`.
    """
    _log_call("propose_delete_session", session_id=session_id, rationale=rationale)
    return _log_result(
        "propose_delete_session", runtime.context.gateway.propose_delete_session(session_id, rationale=rationale)
    )


@tool
def propose_split_session(
    session_id: str,
    split_points: list[datetime],
    runtime: ToolRuntime[AIAgentContext, Any],
    rationale: str = "",
) -> list[dict[str, Any]]:
    """Proposes splitting one existing session into multiple pieces at the given
    `split_points` (each a timestamp strictly between the session's start and end, strictly
    increasing) -- this does NOT split the real session, it only creates draft items the user
    must accept together. `session_id` must be a real, already-materialized session id (a
    virtual recurring occurrence cannot be split directly -- it must be edited once first, which
    materializes it). Put a short human-readable reason in `rationale`.
    """
    _log_call("propose_split_session", session_id=session_id, split_points=split_points, rationale=rationale)
    return _log_result(
        "propose_split_session",
        runtime.context.gateway.propose_split_session(session_id, split_points=split_points, rationale=rationale),
    )


@tool
def propose_create_task(
    title: str,
    runtime: ToolRuntime[AIAgentContext, Any],
    description: str = "",
    tags: str = "",
    priority: str = "-",
    parent_id: str | None = None,
    due_date: OptionalDateTime = None,
    estimated_duration_minutes: OptionalInt = None,
    is_recurring: bool = False,
    recurrence_rule: str | None = None,
    recurrence_rrule: str | None = None,
    recurrence_dtstart: OptionalDateTime = None,
    recurrence_duration_minutes: OptionalInt = None,
    rationale: str = "",
) -> dict[str, Any]:
    """Proposes creating a new task as a draft the user must accept -- this does NOT create a
    real task. `title` and `description` must be the plain, literal text you intend -- never
    embed shorthand like `#tag`, `!high`, `(a description)`, `due:3d`, or `[15m]` inside them, the
    app will silently rewrite the title and overwrite the estimate if you do. Put tags in `tags`
    (comma or space separated, no `#`), priority in `priority` (e.g. `"high"`, `"medium"`,
    `"low"`, or `"-"` for none), a due date in `due_date`, and a time estimate in
    `estimated_duration_minutes` instead. `parent_id` must be a real task id if this is a
    subtask. Put a short human-readable reason in `rationale`.

    For a recurring task ("every Tuesday", "daily", "every weekday"): set `is_recurring=True`
    plus ONE of `recurrence_rule` (a preset: `"daily"`, `"weekdays"` (Mon-Fri), `"weekly"`, or
    `"monthly"` -- use this whenever it fits) or `recurrence_rrule` (a raw RFC 5545 RRULE body for
    anything a preset can't express, e.g. `"FREQ=WEEKLY;BYDAY=TU"` for "every Tuesday",
    `"FREQ=WEEKLY;BYDAY=MO,WE,FR"` for "Monday/Wednesday/Friday"). Leave
    `recurrence_dtstart`/`recurrence_duration_minutes` unset unless the user gave you a specific
    start date or session length -- both default sensibly.
    """
    _log_call(
        "propose_create_task",
        title=title,
        tags=tags,
        priority=priority,
        parent_id=parent_id,
        due_date=due_date,
        estimated_duration_minutes=estimated_duration_minutes,
        is_recurring=is_recurring,
        recurrence_rule=recurrence_rule,
        recurrence_rrule=recurrence_rrule,
        rationale=rationale,
    )
    return _log_result(
        "propose_create_task",
        runtime.context.gateway.propose_create_task(
            title=title,
            description=description,
            tags=tags,
            priority=priority,
            parent_id=parent_id,
            due_date=due_date,
            estimated_duration_minutes=estimated_duration_minutes,
            is_recurring=is_recurring,
            recurrence_rule=recurrence_rule,
            recurrence_rrule=recurrence_rrule,
            recurrence_dtstart=recurrence_dtstart,
            recurrence_duration_minutes=recurrence_duration_minutes,
            rationale=rationale,
        ),
    )


@tool
def propose_update_task(
    task_id: str,
    runtime: ToolRuntime[AIAgentContext, Any],
    title: str | None = None,
    description: str | None = None,
    tags: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    due_date: OptionalDateTime = None,
    estimated_duration_minutes: OptionalInt = None,
    rationale: str = "",
) -> dict[str, Any]:
    """Proposes changing an existing task as a draft the user must accept -- this does NOT
    change the real task. Only pass the fields you want to change; omitted fields keep their
    current value. Same rule as `propose_create_task`: `title`/`description` must be plain
    literal text, never shorthand syntax like `#tag`/`!high`/`(desc)`/`due:3d`/`[15m]` -- use the
    dedicated `tags`/`priority`/`due_date`/`estimated_duration_minutes` fields instead. `task_id`
    must be a real task id from `list_tasks`/`resolve_task_reference`/`get_task`. Put a short
    human-readable reason in `rationale`.
    """
    _log_call(
        "propose_update_task",
        task_id=task_id,
        title=title,
        tags=tags,
        priority=priority,
        status=status,
        due_date=due_date,
        estimated_duration_minutes=estimated_duration_minutes,
        rationale=rationale,
    )
    return _log_result(
        "propose_update_task",
        runtime.context.gateway.propose_update_task(
            task_id,
            title=title,
            description=description,
            tags=tags,
            priority=priority,
            status=status,
            due_date=due_date,
            estimated_duration_minutes=estimated_duration_minutes,
            rationale=rationale,
        ),
    )


@tool
def propose_delete_task(
    task_id: str,
    runtime: ToolRuntime[AIAgentContext, Any],
    rationale: str = "",
) -> dict[str, Any]:
    """Proposes deleting an existing task as a draft the user must accept -- this does NOT
    delete the real task. Any session still linked to this task is unlinked, not deleted.
    `task_id` must be a real task id from `list_tasks`/`resolve_task_reference`/`get_task`.

    This call FAILS if the task has subtasks -- it cannot be safely undone as one item, since
    undo could only restore the one task, not a whole deleted subtree. Delete the subtasks first
    (one `propose_delete_task` call each), or tell the user it has subtasks and ask them to
    confirm a whole-subtree delete from the task page instead. Put a short human-readable reason
    in `rationale`.
    """
    _log_call("propose_delete_task", task_id=task_id, rationale=rationale)
    return _log_result("propose_delete_task", runtime.context.gateway.propose_delete_task(task_id, rationale=rationale))


@tool
def propose_create_subtasks(
    parent_task_id: str,
    titles: list[str],
    runtime: ToolRuntime[AIAgentContext, Any],
    rationale: str = "",
) -> list[dict[str, Any]]:
    """Proposes breaking `parent_task_id` down into multiple new subtasks in one call, as drafts
    the user must accept -- this does NOT create any real tasks. One subtask is proposed per
    entry in `titles`, in order; each title must be plain literal text (same trap as
    `propose_create_task` -- never `#tag`/`!high`/`(desc)`/`due:3d`/`[15m]` shorthand).
    `parent_task_id` must be a real task id from `list_tasks`/`resolve_task_reference`/`get_task`.

    Use this for the common case of "just split this into N titled pieces." If the subtasks need
    different tags, priority, due dates, or estimates from each other, call `propose_create_task`
    separately for each one instead (with `parent_id=parent_task_id`), since this tool only takes
    titles. Put a short human-readable reason in `rationale`.
    """
    _log_call("propose_create_subtasks", parent_task_id=parent_task_id, titles=titles, rationale=rationale)
    return _log_result(
        "propose_create_subtasks",
        runtime.context.gateway.propose_create_subtasks(parent_task_id, titles=titles, rationale=rationale),
    )


@tool
def set_plan_summary(summary: str, runtime: ToolRuntime[AIAgentContext, Any]) -> dict[str, Any]:
    """Sets a short, human-readable one-line summary for everything you've proposed this turn
    (e.g. "Moved 3 sessions to the afternoon, added 2 new tasks"). Call this once, after all your
    `propose_*` calls for the turn, when you've proposed more than a single trivial item -- it's
    what the user sees as the headline of their draft review list.
    """
    _log_call("set_plan_summary", summary=summary)
    return _log_result("set_plan_summary", runtime.context.gateway.set_plan_summary(summary))


ALL_TOOLS = [
    list_tasks,
    get_task,
    resolve_task_reference,
    list_sessions,
    find_free_slots,
    get_time_stats,
    search_tasks,
    find_conflicts,
    get_task_progress,
    validate_schedule,
    get_daily_briefing,
    get_weekly_review,
    propose_remembered_instruction,
    propose_create_session,
    propose_update_session,
    propose_delete_session,
    propose_split_session,
    propose_create_task,
    propose_update_task,
    propose_delete_task,
    propose_create_subtasks,
    set_plan_summary,
]

__all__ = ["AIAgentContext", "ALL_TOOLS"]
