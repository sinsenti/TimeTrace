from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from timetrace.core.query_spec import AnalyticsQuery, Dimension, Measure, QuerySource, TagAttribution


class TaskStatusCreate(BaseModel):
    name: str
    is_completed: bool = False
    is_hide_by_default: bool = False
    is_scheduled_trigger: bool = False
    color: str = "#7c3aed"
    position: int = 0


class TaskStatusUpdate(BaseModel):
    name: str | None = None
    is_completed: bool | None = None
    is_hide_by_default: bool | None = None
    is_scheduled_trigger: bool | None = None
    color: str | None = None
    position: int | None = None


class TaskCreate(BaseModel):
    title: str
    description: str | None = None
    priority: str = "-"
    status: str = "To Do"
    status_id: str | None = None
    parent_id: str | None = None
    category: str = "work"
    color: str = "auto"
    tags: str = ""
    estimated_minutes: int | None = 15
    due_date: datetime | None = None
    assigned_date: str | None = None
    attachments: str | None = ""
    is_recurring: bool = False
    # UI preset label only; `recurrence_rrule` is authoritative for scheduling.
    recurrence_rule: str | None = None
    recurrence_rrule: str | None = None
    recurrence_dtstart: datetime | None = None
    recurrence_duration_minutes: int | None = None
    recurrence_timezone: str | None = None
    requires_session_review: bool = True
    created_at: datetime | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    status: str | None = None
    status_id: str | None = None
    parent_id: str | None = None
    category: str | None = None
    color: str | None = None
    tags: str | None = None
    estimated_minutes: int | None = None
    due_date: datetime | None = None
    assigned_date: str | None = None
    attachments: str | None = ""
    is_recurring: bool | None = None
    recurrence_rule: str | None = None
    recurrence_rrule: str | None = None
    recurrence_dtstart: datetime | None = None
    recurrence_duration_minutes: int | None = None
    recurrence_timezone: str | None = None
    requires_session_review: bool | None = None
    created_at: datetime | None = None


class TaskTreeResponse(BaseModel):
    id: str
    title: str
    description: str | None = None
    priority: str
    status: str
    category: str
    estimated_minutes: int | None
    color: str
    tags: str
    due_date: str | None
    assigned_date: str | None
    attachments: str | None
    is_recurring: bool
    recurrence_rule: str | None
    recurrence_rrule: str | None = None
    recurrence_dtstart: datetime | None = None
    recurrence_duration_minutes: int | None = None
    recurrence_timezone: str | None = None
    parent_id: str | None
    created_at: str
    subtasks: list[Any] = []


class SessionCreate(BaseModel):
    task_id: str | None = None
    start_time: datetime
    end_time: datetime
    tags: str = ""
    notes: str = ""
    review_skipped: bool = False


class SessionUpdate(BaseModel):
    start_time: datetime | None = None
    end_time: datetime | None = None
    tags: str | None = None
    notes: str | None = None
    task_id: str | None = None
    review_skipped: bool | None = None


# Deletion scopes for `DELETE /sessions/{id}`. Typed so a typo 422s instead of silently
# falling through to "delete just this one".
RecurrenceScope = Literal["only_this", "following", "all"]
# Edit scopes for `PUT /sessions/{id}`: "all_future" writes the new occurrence length to the
# series (`Task.recurrence_duration_minutes`) as well as this occurrence.
SessionEditScope = Literal["only_this", "all_future"]


class ProjectedOccurrenceRead(BaseModel):
    """A virtual (projected, not yet real) occurrence of a recurring task.

    Documents the projected half of `GET /sessions?start&end`; the route itself keeps
    `response_model=list[dict]` so real rows and virtuals can share one list.
    """

    id: str  # "virt:<task_id>:<YYYYMMDDTHHMMSSZ>"
    task_id: str
    start_time: datetime
    end_time: datetime
    duration_seconds: int
    tags: str
    notes: str = ""
    review_skipped: bool = False
    is_virtual: Literal[True] = True
    series_task_id: str
    occurrence_start: datetime


class TimerStartRequest(BaseModel):
    task_id: str | None = None
    tags: str = ""
    notes: str = ""
    mode: str = "flowtime"
    target_minutes: int | None = None


class TimerSplitRequest(BaseModel):
    new_tags: str
    new_notes: str = ""


class DayReviewCreate(BaseModel):
    date_str: str
    rating: int | None = 3
    highlights: str | None = ""
    friction: str | None = ""
    notes: str | None = ""
    review_skipped: bool | None = False


class TaskReviewCreate(BaseModel):
    task_id: str
    difficulty: int | None = 3
    what_went_well: str | None = ""
    blockers: str | None = ""
    key_takeaways: str | None = ""


class RatingDefinitionCreate(BaseModel):
    name: str
    target_type: str = "session"
    min_score: int = 1
    max_score: int = 10
    is_required: bool = False
    description: str | None = None


class RatingDefinitionUpdate(BaseModel):
    name: str | None = None
    target_type: str | None = None
    min_score: int | None = None
    max_score: int | None = None
    is_required: bool | None = None
    description: str | None = None


class RatingEntryCreate(BaseModel):
    rating_definition_id: str
    target_type: str
    target_id: str
    score: int | None = 0
    dismissed: bool | None = False
    notes: str | None = None


class RetroSessionCreate(BaseModel):
    task_id: str | None = None
    start_time: datetime
    end_time: datetime
    tags: str = ""
    notes: str = ""


class ReflectionCreate(BaseModel):
    session_id: str
    energy_level: int | None = 3
    obstacles: str | None = ""
    habits_completed: list[str] = []


class IdleToggleRequest(BaseModel):
    enabled: bool | None = None


class IdleResolveRequest(BaseModel):
    option: str
    new_tags: str | None = ""
    new_notes: str | None = ""


class HabitCreate(BaseModel):
    name: str
    habit_type: str = "boolean"
    target_value: float = 1.0
    unit: str = ""
    frequency: str = "Every day"
    reminder_time: str | None = None
    color: str = "#10b981"


class HabitUpdate(BaseModel):
    name: str | None = None
    habit_type: str | None = None
    target_value: float | None = None
    unit: str | None = None
    frequency: str | None = None
    reminder_time: str | None = None
    color: str | None = None


class HabitLogRequest(BaseModel):
    date_str: str
    status: str | None = None
    delta_value: float | None = None
    set_value: float | None = None


# ---------------------------------------------------------------------------
# Structured analytics query engine (statistics dashboards, slice 1)
# ---------------------------------------------------------------------------


class QueryContextRequest(BaseModel):
    """Request-scoped context that isn't part of a saved widget definition."""

    model_config = ConfigDict(extra="forbid")

    timezone: str | None = None
    first_day_of_week: int | None = Field(default=None, ge=0, le=6)


class AnalyticsQueryRequest(QueryContextRequest):
    query: AnalyticsQuery


class AnalyticsQueryBatchRequest(QueryContextRequest):
    queries: dict[str, AnalyticsQuery] = Field(max_length=40)


class ColumnSpec(BaseModel):
    key: str
    label: str
    kind: Literal["dimension", "measure"]
    dimension: Dimension | None = None
    measure: Measure | None = None
    unit: Literal["hours", "minutes", "count", "percent", "score"] | None = None


class QueryRow(BaseModel):
    keys: list[str]
    labels: list[str]
    value: float | None
    count: int


class QueryMeta(BaseModel):
    timezone: str
    first_day_of_week: int
    range_start_utc: datetime | None
    range_end_utc: datetime | None
    tag_attribution: TagAttribution
    totals_overlap: bool
    truncated: bool
    elapsed_ms: int
    warnings: list[str] = []


class AnalyticsQueryResponse(BaseModel):
    columns: list[ColumnSpec]
    rows: list[QueryRow]
    total: float | None
    row_count: int
    meta: QueryMeta


class AnalyticsQueryBatchResponse(BaseModel):
    results: dict[str, AnalyticsQueryResponse]
    errors: dict[str, str]


class CapabilityMeasure(BaseModel):
    value: Measure
    label: str
    unit: str


class CapabilityDimension(BaseModel):
    value: Dimension
    label: str


class CapabilityFilterField(BaseModel):
    value: str
    label: str


class SourceCapabilities(BaseModel):
    source: QuerySource
    measures: list[CapabilityMeasure]
    dimensions: list[CapabilityDimension]
    filter_fields: list[CapabilityFilterField]


class QueryCapabilitiesResponse(BaseModel):
    sources: list[SourceCapabilities]


# ---------------------------------------------------------------------------
# Session/task completion policy
# ---------------------------------------------------------------------------


class ScheduledSessionInfo(BaseModel):
    id: str
    start_time: datetime
    end_time: datetime | None
    duration_seconds: int | None
    tags: str
    notes: str | None


class CompletionPolicyPrompt(BaseModel):
    reason: str
    task_id: str
    task_title: str
    scheduled_sessions: list[ScheduledSessionInfo]
    scheduled_seconds: int
    subtask_scheduled_count: int


class TaskReadResponse(BaseModel):
    """Read shape for a task, including derived display-only values.

    `next_occurrence_date` is computed from the RRULE for recurring tasks (owner decision Q1:
    the Target Day badge follows the next projected occurrence). It is never stored, and
    `assigned_date` now always reports the real DB column -- the old implementation overwrote
    `assigned_date` in memory, so the API reported a value the database did not hold.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str | None = None
    priority: str
    estimated_minutes: int | None = None
    status: str
    status_id: str | None = None
    parent_id: str | None = None
    category: str
    color: str
    tags: str

    due_date: datetime | None = None
    assigned_date: str | None = None
    attachments: str | None = None
    is_recurring: bool
    recurrence_rule: str | None = None
    recurrence_rrule: str | None = None
    recurrence_dtstart: datetime | None = None
    recurrence_duration_minutes: int | None = None
    recurrence_timezone: str | None = None

    requires_session_review: bool
    created_at: datetime

    # Derived, read-only: local YYYY-MM-DD of the next projected occurrence (recurring only).
    next_occurrence_date: str | None = None


class TaskWithPolicyResponse(TaskReadResponse):
    completion_policy: CompletionPolicyPrompt | None = None


class ClearScheduledSessionsRequest(BaseModel):
    include_subtasks: bool = False
    session_ids: list[str] | None = None


class ClearScheduledSessionsResponse(BaseModel):
    deleted_count: int
    deleted_session_ids: list[str]
