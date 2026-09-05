from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from timetrace.config import settings
from timetrace.core.query_spec import (
    AnalyticsQuery,
    ChartType,
    ComparisonMode,
    Dimension,
    Measure,
    QuerySource,
    TagAttribution,
)


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
    # Comparison baseline (slice 4). All three stay None unless the widget's query carries a
    # `comparison` spec, so the shape is unchanged for every pre-slice-4 caller.
    comparison_value: float | None = None
    delta: float | None = None
    # None for percent/score measures, where a percentage change of a percentage is
    # meaningless -- those get a delta in points and no delta_pct at all.
    delta_pct: float | None = None


class ComparisonMeta(BaseModel):
    mode: ComparisonMode
    range_start_utc: datetime | None
    range_end_utc: datetime | None
    label: str
    # "scalar" (no group-by tile) | "by_key" (categorical dimension) |
    # "positional" (day/week/month ghost series, keys cannot match across shifted ranges)
    alignment: Literal["scalar", "by_key", "positional"]
    dropped_keys: int = 0


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
    comparison_total: float | None = None
    comparison: ComparisonMeta | None = None


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
    # Mirrors settings.sql_widgets_enabled so the builder can hide the SQL tab entirely when
    # the escape hatch is switched off, rather than offering a control that 400s.
    sql_enabled: bool = False


# ---------------------------------------------------------------------------
# Read-only SQL widgets (statistics dashboards, slice 3)
# ---------------------------------------------------------------------------


class SqlWidgetQuery(BaseModel):
    """A SQL-mode widget's saved definition. See `core/sql_guard.py` for the sandbox."""

    model_config = ConfigDict(extra="forbid")

    sql: str = Field(min_length=1, max_length=settings.sql_max_length)
    limit: int = Field(default=200, ge=1, le=10000)  # clamped again to settings.sql_max_rows
    chart: ChartType = ChartType.TABLE
    # Which result column supplies chart labels / values, when rendering the tabular result
    # as a bar/line/doughnut instead of a table. Both None => render a table.
    label_column: str | None = None
    value_column: str | None = None


class SqlQueryResponse(BaseModel):
    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    truncated: bool
    elapsed_ms: int
    warnings: list[str] = []


class SqlSchemaColumn(BaseModel):
    name: str
    type: str


class SqlSchemaTable(BaseModel):
    name: str
    columns: list[SqlSchemaColumn]


class SqlSchemaResponse(BaseModel):
    tables: list[SqlSchemaTable]


# ---------------------------------------------------------------------------
# Persisted dashboards and widgets (statistics dashboards, slice 2)
# ---------------------------------------------------------------------------


class StructuredWidgetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["structured"] = "structured"
    query: AnalyticsQuery


class SqlWidgetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["sql"] = "sql"
    sql: SqlWidgetQuery


# What a DashboardWidget.spec_json holds. The service converts in both directions with
# TypeAdapter(WidgetSpec); the router never touches spec_json.
WidgetSpec = Annotated[StructuredWidgetSpec | SqlWidgetSpec, Field(discriminator="mode")]


class WidgetRead(BaseModel):
    id: str
    dashboard_id: str
    title: str
    width: Literal["half", "full"]
    position: int
    seed_key: str | None = None
    # None when the stored spec_json no longer validates (e.g. written by a newer version).
    # The dashboard /data response reports the reason in errors[widget_id]; a widget the
    # server cannot parse must never turn into a 500.
    spec: WidgetSpec | None = None
    created_at: datetime
    updated_at: datetime


class WidgetCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    width: Literal["half", "full"] = "half"
    spec: WidgetSpec


class WidgetUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    width: Literal["half", "full"] | None = None
    spec: WidgetSpec | None = None


class WidgetReorderRequest(BaseModel):
    widget_ids: list[str] = Field(max_length=200)


class DashboardRead(BaseModel):
    id: str
    name: str
    slug: str
    is_seeded: bool
    position: int
    widget_count: int = 0
    created_at: datetime
    updated_at: datetime


class DashboardDetailRead(DashboardRead):
    widgets: list[WidgetRead] = []


class DashboardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class DashboardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    position: int | None = None


class DashboardDataResponse(BaseModel):
    """One round trip renders a whole dashboard.

    Per-widget error isolation, mirroring `AnalyticsQueryBatchResponse`: a widget whose query
    fails (or whose stored spec no longer validates) lands in `errors[widget_id]` and every
    other widget still renders.
    """

    dashboard: DashboardRead
    widgets: list[WidgetRead]
    results: dict[str, AnalyticsQueryResponse] = {}
    sql_results: dict[str, SqlQueryResponse] = {}
    errors: dict[str, str] = {}


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


# ================================================================================================
# AI assistant (docs/ai-assistant-spec.md S4/S7). AI-prefixed DTOs only -- everything above this
# line belongs to earlier features and is untouched.
# ================================================================================================


class AIProviderConfigResponse(BaseModel):
    """Never exposes `api_key_encrypted`; only whether one is set and its last 4 chars
    (spec S4 "API keys at rest")."""

    id: str
    name: str
    provider: str
    model: str
    base_url: str | None = None
    api_key_set: bool
    api_key_last4: str | None = None
    temperature: float
    max_output_tokens: int
    request_timeout_seconds: int
    sanitization_level: str
    use_native_openrouter: bool
    extra_params: dict[str, Any] = Field(default_factory=dict)
    is_active: bool
    created_at: datetime
    updated_at: datetime


class AIProviderCreateRequest(BaseModel):
    name: str
    provider: str
    model: str
    base_url: str | None = None
    api_key: str | None = None
    temperature: float = 0.0
    max_output_tokens: int = 4096
    request_timeout_seconds: int = 120
    sanitization_level: str = "standard"
    use_native_openrouter: bool = False
    extra_params: dict[str, Any] | None = None


class AIProviderUpdateRequest(BaseModel):
    """Every field is optional and the router calls `model_dump(exclude_unset=True)` before
    forwarding to `AIProviderService.update_provider` -- an OMITTED `api_key` keeps the stored
    key, an explicit `""` clears it (spec S9.4)."""

    name: str | None = None
    provider: str | None = None
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    request_timeout_seconds: int | None = None
    sanitization_level: str | None = None
    use_native_openrouter: bool | None = None
    extra_params: dict[str, Any] | None = None


class AIProviderInlineConfig(BaseModel):
    """Unsaved provider config, for `POST /providers/test` without storing anything first."""

    provider: str
    model: str
    base_url: str | None = None
    api_key: str | None = None
    temperature: float = 0.0
    max_output_tokens: int = 4096
    request_timeout_seconds: int = 120
    use_native_openrouter: bool = False
    extra_params: dict[str, Any] | None = None


class AIProviderTestRequest(BaseModel):
    """Exactly one of `config_id` / `inline_config` -- validated in the service."""

    config_id: str | None = None
    inline_config: AIProviderInlineConfig | None = None


class AIProviderTestResult(BaseModel):
    success: bool
    error: str | None = None


class AISettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    quickadd_fallback_enabled: bool
    redact_before_send: bool
    preview_on_calendar: bool
    scheduling_window_days: int
    batch_undo_retention_days: int
    custom_instructions: str
    created_at: datetime
    updated_at: datetime


class AISettingsUpdateRequest(BaseModel):
    quickadd_fallback_enabled: bool | None = None
    redact_before_send: bool | None = None
    preview_on_calendar: bool | None = None
    scheduling_window_days: int | None = None
    batch_undo_retention_days: int | None = None
    custom_instructions: str | None = None


class AIConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    intent: str | None = None
    provider_config_id: str | None = None
    is_archived: bool
    message_count: int
    total_input_tokens: int
    total_output_tokens: int
    last_message_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AIConversationCreateRequest(BaseModel):
    title: str | None = None
    intent: str | None = None
    provider_config_id: str | None = None


class AIConversationUpdateRequest(BaseModel):
    title: str | None = None
    is_archived: bool | None = None


class AIChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    conversation_id: str
    position: int
    role: str
    content: str
    tool_calls_json: str | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    draft_batch_id: str | None = None
    provider: str | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None
    error: str | None = None
    created_at: datetime


class AIConversationDetailResponse(AIConversationResponse):
    messages: list[AIChatMessageResponse] = Field(default_factory=list)


class AIChatMessageRequest(BaseModel):
    """Body for `POST /conversations/{id}/messages`. `stream=True` switches the response to
    `text/event-stream` (spec S7) -- the response shape returned by the router differs, this
    schema does not."""

    text: str
    stream: bool = False


class AIDraftItemResponse(BaseModel):
    """`proposed`/`baseline`/`applied_before`/`applied_after` are the parsed JSON snapshots
    (spec S4 item 6); `ui_kind`/`group_key` are read back out of `proposed` for badge display
    (spec S6) rather than re-derived by the frontend. `is_stale` is computed at read time,
    never stored (spec S4)."""

    id: str
    batch_id: str
    position: int
    op: str
    entity_type: str
    target_id: str | None = None
    proposed: dict[str, Any] = Field(default_factory=dict)
    baseline: dict[str, Any] | None = None
    applied_before: dict[str, Any] | None = None
    applied_after: dict[str, Any] | None = None
    applied_entity_id: str | None = None
    status: str
    rationale: str | None = None
    error: str | None = None
    is_stale: bool
    ui_kind: str | None = None
    group_key: str | None = None
    display_title: str = ""
    created_at: datetime
    updated_at: datetime


class AIDraftOverlayItemResponse(AIDraftItemResponse):
    """The calendar draft layer (spec S7 `GET /drafts/overlay`). `display.*_local` and `day_key`
    are server-computed local-day values -- the frontend must never slice `start_time[:10]`
    (that buckets by UTC)."""

    display: dict[str, Any]
    day_key: str


class AIDraftBatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    conversation_id: str | None = None
    source_message_id: str | None = None
    intent: str | None = None
    request_text: str | None = None
    summary: str | None = None
    status: str
    provider: str | None = None
    model: str | None = None
    item_count: int
    created_at: datetime
    decided_at: datetime | None = None
    undone_at: datetime | None = None


class AIDraftBatchDetailResponse(AIDraftBatchResponse):
    items: list[AIDraftItemResponse] = Field(default_factory=list)


class AIChatTurnResponse(BaseModel):
    """Return shape of a non-streaming chat turn (spec S7). `draft_batch` is populated only when
    the turn's tool calls produced at least one draft item."""

    conversation: AIConversationResponse
    message: AIChatMessageResponse
    draft_batch: AIDraftBatchDetailResponse | None = None


class AIDraftItemResult(BaseModel):
    item_id: str
    status: str
    error: str | None = None
    applied_entity_id: str | None = None


class AIDraftBatchActionResult(BaseModel):
    """Shape of `AIDraftService.reject_batch`/`undo_batch` (spec S7/S8)."""

    batch_id: str
    batch_status: str
    items: list[AIDraftItemResult]


class AIApplyResult(AIDraftBatchActionResult):
    """Shape of `AIDraftService.accept_items`/`reapply_batch`. Always 200 with per-item results
    (spec S7 "apply always returns 200") -- `completion_policies` reuses the EXISTING
    `CompletionPolicyPrompt` schema from the 2026-08-24 completion-policy feature, never
    reinvented (spec S7 explicit)."""

    completion_policies: list[CompletionPolicyPrompt] = Field(default_factory=list)


class AIDraftItemPatchRequest(BaseModel):
    """Body for `PATCH /drafts/items/{id}` -- a partial update merged into the still-pending
    item's `proposed_json` (spec S7 "edit before accept")."""

    proposed: dict[str, Any]


class AIDraftItemRejectRequest(BaseModel):
    reason: str | None = None


class AIDraftBatchItemsRequest(BaseModel):
    """Body for accept/undo/reapply -- omit `item_ids` to act on every item in the batch."""

    item_ids: list[str] | None = None


class AIDraftBatchRejectRequest(BaseModel):
    item_ids: list[str] | None = None
    reason: str | None = None


class AIDraftUndoRequest(BaseModel):
    """Body for `POST /drafts/undo` -- the one-action week undo (spec S7). Omit both fields to
    undo every currently-undoable batch."""

    batch_ids: list[str] | None = None
    since: datetime | None = None


class AIStatusResponse(BaseModel):
    """Cheap navbar-badge call (spec S7)."""

    configured: bool
    default_provider: str | None = None
    quickadd_fallback_enabled: bool
    pending_draft_count: int
    undoable_batch_count: int
    latest_batch: AIDraftBatchResponse | None = None


class AIQuickAddClassifyRequest(BaseModel):
    text: str
    force_tier: int | None = None


class AIQuickAddClassifyResponse(BaseModel):
    """No LLM call (spec S7) -- just `route_quick_add`'s tier decision."""

    tier: int
    reason: str
    signals: list[str] = Field(default_factory=list)
    remaining_text: str = ""
    remaining_word_count: int = 0


class AIQuickAddParseRequest(BaseModel):
    text: str
    force_tier: int | None = None


class AIQuickAddParseResponse(BaseModel):
    """Read-only -- creates nothing (spec S7). `fields` is a best-effort extraction the quick-add
    modal strip prefills from; `tier=1` when escalation wasn't needed (or a provider isn't
    configured and fallback is enabled), in which case `fields` is empty and the caller should
    fall back to the existing tier-1 regex parser."""

    tier: int
    reason: str
    fields: dict[str, Any] = Field(default_factory=dict)
    raw_text: str
