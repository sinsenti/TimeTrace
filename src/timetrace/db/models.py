import uuid
from datetime import UTC, datetime
from typing import Optional

# WHY THE `# noqa: UP037, UP045` COMMENTS ON EVERY Relationship() BELOW:
#
# `Optional[X]` and the quoted forward reference in `list["X"]` are load-bearing here, not
# style leftovers. SQLModel hands a relationship's annotation to SQLAlchemy as a *string*, and
# SQLAlchemy's class registry cannot resolve `"Task | None"`. The module still imports fine
# (Python 3.14 defers annotation evaluation, PEP 649), so the breakage does not appear at
# import: it appears at the first ORM query, as
# `InvalidRequestError: expression 'Task | None' failed to locate a name` -- i.e. every
# endpoint 500s while `python -c "import timetrace.db.models"` looks healthy.
#
# `ruff check --fix .` -- the exact command CLAUDE.md tells everyone to run -- applies UP045
# and UP037 as SAFE fixes as of ruff 0.16.4, so without these noqa markers the lint step
# silently breaks the ORM. That is not hypothetical; it happened on 2026-09-02.
#
# Plain column annotations (`str | None = Field(...)`) are unaffected and stay PEP 604.
from sqlalchemy import UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel


def utc_now() -> datetime:
    return datetime.now(UTC)


def generate_uuid7() -> str:
    """Time-ordered ID: sorts chronologically, safe to generate offline on any client."""
    return str(uuid.uuid7())


class TaskStatus(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    name: str = Field(unique=True, index=True)
    is_completed: bool = Field(default=False)
    is_hide_by_default: bool = Field(default=False)
    is_scheduled_trigger: bool = Field(default=False)
    color: str = Field(default="#7c3aed")
    position: int = Field(default=0)
    created_at: datetime = Field(default_factory=utc_now)

    tasks: list["Task"] = Relationship(back_populates="status_rel")  # noqa: UP037


class Task(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    title: str
    description: str | None = None
    priority: str = Field(default="-")  # "-", "low", "medium", "high"
    estimated_minutes: int | None = Field(default=15)
    status: str = Field(default="To Do")
    status_id: str | None = Field(default=None, foreign_key="taskstatus.id")
    parent_id: str | None = Field(default=None, foreign_key="task.id")
    category: str = Field(default="work")
    color: str = Field(default="auto")
    tags: str = Field(default="")

    # Optional Fields
    due_date: datetime | None = Field(default=None)
    assigned_date: str | None = Field(default=None)  # YYYY-MM-DD
    attachments: str | None = Field(default="")
    is_recurring: bool = Field(default=False)
    # UI preset label only ("daily"|"weekdays"|"weekly"|"monthly"|"custom"). NEVER parsed for
    # scheduling -- recurrence_rrule is authoritative. The default used to be "daily", which
    # leaked onto every non-recurring task in the live DB (task_modal.js sends it
    # unconditionally); now None.
    recurrence_rule: str | None = Field(default=None)
    recurrence_rrule: str | None = Field(default=None)  # RFC 5545 RRULE body, no "RRULE:" prefix
    recurrence_dtstart: datetime | None = Field(default=None)  # naive UTC, second precision
    recurrence_duration_minutes: int | None = Field(default=None)
    recurrence_timezone: str | None = Field(default=None)  # IANA name captured at write time

    requires_session_review: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utc_now)

    # Relationships
    status_rel: Optional[TaskStatus] = Relationship(back_populates="tasks")  # noqa: UP045
    parent: Optional["Task"] = Relationship(  # noqa: UP037, UP045
        back_populates="subtasks", sa_relationship_kwargs={"remote_side": "Task.id"}
    )
    subtasks: list["Task"] = Relationship(  # noqa: UP037
        back_populates="parent", sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )
    sessions: list["Session"] = Relationship(back_populates="task")  # noqa: UP037
    review: Optional["TaskReview"] = Relationship(  # noqa: UP037, UP045
        back_populates="task", sa_relationship_kwargs={"uselist": False, "cascade": "all, delete-orphan"}
    )


class Session(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    task_id: str | None = Field(default=None, foreign_key="task.id")
    start_time: datetime
    end_time: datetime | None = None
    duration_seconds: int | None = None
    tags: str = Field(default="")
    notes: str | None = None
    review_skipped: bool = Field(default=False)

    # External calendar sync (Google/Outlook)
    timezone: str = Field(default="UTC")
    external_sync_id: str | None = Field(default=None, index=True)
    external_provider: str | None = Field(default=None)
    extended_properties_json: str = Field(default="{}")

    task: Optional[Task] = Relationship(back_populates="sessions")  # noqa: UP045


class RecurrenceException(SQLModel, table=True):
    """One row per occurrence of a recurring task that deviates from its RRULE.

    `occurrence_start` is RFC 5545's RECURRENCE-ID: the *original* projected instant (naive UTC,
    second precision), which remains the occurrence's identity even after the materialized session
    row has been dragged to some other time. That is what makes the key stable -- keying off the
    session's current `start_time` would lose the link the moment the user moved it.

    Exactly two kinds exist: `kind="override"` always carries `session_id` (the materialized row
    holding the deviation), `kind="skip"` never does. "moved"/"resized"/"renoted" are all just
    `override` -- the deviation lives in the session row, not in the exception's kind.
    """

    __table_args__ = (UniqueConstraint("task_id", "occurrence_start", name="uq_recurrence_exception"),)

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    task_id: str = Field(foreign_key="task.id", index=True)
    occurrence_start: datetime = Field(index=True)  # naive UTC, RECURRENCE-ID
    kind: str  # "skip" | "override"
    session_id: str | None = Field(default=None, foreign_key="session.id")
    created_at: datetime = Field(default_factory=utc_now)


class TaskReview(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    task_id: str = Field(foreign_key="task.id", unique=True)
    difficulty: int = Field(default=3)
    what_went_well: str | None = None
    blockers: str | None = None
    key_takeaways: str | None = None
    created_at: datetime = Field(default_factory=utc_now)

    task: Optional[Task] = Relationship(back_populates="review")  # noqa: UP045


class DayReview(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    date_str: str = Field(index=True, unique=True)
    rating: int = Field(default=3)
    highlights: str | None = None
    friction: str | None = None
    notes: str | None = None
    review_skipped: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utc_now)


class RatingDefinition(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    name: str
    target_type: str = Field(default="session")
    min_score: int = Field(default=1)
    max_score: int = Field(default=10)
    is_required: bool = Field(default=False)
    description: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class RatingEntry(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    rating_definition_id: str = Field(foreign_key="ratingdefinition.id")
    target_type: str = Field(index=True)
    target_id: str = Field(index=True)
    score: int | None = Field(default=0, nullable=True)
    dismissed: bool = Field(default=False)
    notes: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class Habit(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    name: str
    habit_type: str = Field(default="boolean")
    target_value: float = Field(default=1.0)
    unit: str = Field(default="")
    frequency: str = Field(default="Every day")
    reminder_time: str | None = Field(default=None)
    color: str = Field(default="#10b981")
    created_at: datetime = Field(default_factory=utc_now)

    logs: list["HabitLog"] = Relationship(  # noqa: UP037
        back_populates="habit",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    goal_history: list["HabitGoalHistory"] = Relationship(  # noqa: UP037
        back_populates="habit",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class HabitLog(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    habit_id: str = Field(foreign_key="habit.id")
    date_str: str = Field(index=True)
    status: str = Field(default="completed")
    value: float = Field(default=0.0)
    notes: str | None = None

    habit: Optional[Habit] = Relationship(back_populates="logs")  # noqa: UP045


class HabitGoalHistory(SQLModel, table=True):
    """One row per target_value a numeric habit has ever had, so the UI can
    chart the goal's own progression (e.g. pull-ups 50 -> 75 -> 100) alongside
    logged performance, instead of only ever showing today's target."""

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    habit_id: str = Field(foreign_key="habit.id", index=True)
    target_value: float
    effective_from: str = Field(index=True)  # YYYY-MM-DD, matching HabitLog.date_str
    created_at: datetime = Field(default_factory=utc_now)

    # Optional[X] rather than X | None to match every other relationship in this
    # file (see e.g. TaskReview.task below) -- most of those genuinely need the
    # quoted-string form for a forward reference to a class defined later in the
    # file (this module has no `from __future__ import annotations`), so the
    # file keeps one uniform style rather than mixing it per-declaration.
    habit: Optional[Habit] = Relationship(back_populates="goal_history")  # noqa: UP045


class ExternalSyncState(SQLModel, table=True):
    """Per-account sync cursor for external calendar providers (Google/Outlook)."""

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    provider: str = Field(index=True)
    account_id: str = Field(index=True)
    sync_token: str | None = Field(default=None)
    last_synced_at: datetime = Field(default_factory=utc_now)


# ---------------------------------------------------------------------------
# AI assistant (see docs/ai-assistant-spec.md section 4)
#
# The chat-message class is `AIChatMessage`, never `AIMessage`:
# `langchain_core.messages.AIMessage` is imported elsewhere in this codebase and
# the name collision would be a real bug, not a style question.
# ---------------------------------------------------------------------------


class AIProviderConfig(SQLModel, table=True):
    """One configured model endpoint (Anthropic / OpenAI / OpenRouter / Ollama).

    Exactly one row has `is_active = True`; that invariant is enforced in
    `AIProviderService`, not by a DB constraint (SQLite partial unique indexes
    would make deactivating-then-activating a two-statement dance that has to be
    ordered correctly, and the service owns the transaction anyway).

    `api_key_encrypted` holds a Fernet token, never a plaintext key; `api_key_last4`
    is the only part of the key any API response is allowed to echo back.
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    name: str
    provider: str  # "anthropic" | "openai" | "openrouter" | "ollama"
    model: str
    base_url: str | None = Field(default=None)
    api_key_encrypted: str | None = Field(default=None)
    api_key_last4: str | None = Field(default=None)
    temperature: float = Field(default=0.0)
    max_output_tokens: int = Field(default=4096)
    request_timeout_seconds: int = Field(default=120)
    sanitization_level: str = Field(default="standard")  # "off" | "standard" | "strict"
    use_native_openrouter: bool = Field(default=False)
    extra_params_json: str = Field(default="{}")
    is_active: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class AISettings(SQLModel, table=True):
    """Singleton row holding the AI behaviour toggles the settings page persists.

    "Singleton" is an application-level guarantee (`AIProviderService`/the settings
    service creates the row on first read); the migration deliberately seeds no row.
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    quickadd_fallback_enabled: bool = Field(default=True)
    redact_before_send: bool = Field(default=True)
    preview_on_calendar: bool = Field(default=True)
    scheduling_window_days: int = Field(default=14)
    batch_undo_retention_days: int = Field(default=30)
    # Scheduling preferences are structured instead of hidden in prompt text. Empty
    # `scheduling_days_json` means every day; the JSON columns keep this singleton compatible
    # with SQLite while the API exposes normal lists.
    scheduling_day_start: str = Field(default="09:00")
    scheduling_day_end: str = Field(default="17:00")
    minimum_break_minutes: int = Field(default=0)
    maximum_daily_minutes: int | None = Field(default=None)
    scheduling_days_json: str = Field(default="[]")
    preferred_tags_json: str = Field(default="[]")
    # Non-nullable with "" as the "unset" sentinel, deliberately not `str | None`:
    # AISettingsService.update_settings skips any field whose incoming value is None, so a
    # nullable column could never be cleared back to empty through the existing update path.
    custom_instructions: str = Field(default="")
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class AIInstructionProposal(SQLModel, table=True):
    """A confirmation-gated append to the global custom-instructions setting.

    The proposal stores the exact setting value seen when it was created. Acceptance compares
    that value's hash before applying it, so a manual edit made in the meantime cannot be
    overwritten accidentally. ``conversation_id`` is nullable because the setting change is
    global and must survive deletion of the originating chat.
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    conversation_id: str | None = Field(default=None, foreign_key="aiconversation.id", index=True)
    source_message_id: str | None = Field(default=None, index=True)
    operation: str = Field(default="append")
    proposed_instruction: str
    before_instructions: str = Field(default="")
    after_instructions: str = Field(default="")
    base_hash: str
    status: str = Field(default="pending", index=True)
    # "pending" | "accepted" | "rejected" | "conflict" | "failed" | "undone"
    created_at: datetime = Field(default_factory=utc_now, index=True)
    decided_at: datetime | None = Field(default=None)
    updated_at: datetime = Field(default_factory=utc_now)


class AIConversation(SQLModel, table=True):
    """One multi-turn chat thread in the assistant drawer."""

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    title: str = Field(default="New conversation")
    intent: str | None = Field(default=None)  # "chat" | "quick_add" | "reschedule" | "schedule_week"
    provider_config_id: str | None = Field(default=None, foreign_key="aiproviderconfig.id")
    is_archived: bool = Field(default=False, index=True)
    message_count: int = Field(default=0)
    total_input_tokens: int = Field(default=0)
    total_output_tokens: int = Field(default=0)
    last_message_at: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    # Messages cascade with the thread; draft batches deliberately do NOT (see
    # AIDraftBatch.conversation_id) -- deleting a chat must never destroy the
    # audit trail of mutations that were actually applied to real rows.
    messages: list["AIChatMessage"] = Relationship(  # noqa: UP037
        back_populates="conversation",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class AIChatMessage(SQLModel, table=True):
    """One message in a conversation: user / assistant / tool / system.

    ORDER BY `position`, never by `id`. uuid7 is only coarsely monotonic and a single
    turn mints several messages (assistant + n tool results) inside the same
    millisecond, so id order would silently interleave them wrongly.

    `draft_batch_id` is how a chat turn carries a proposal. It is a real FK; the
    reverse link (`AIDraftBatch.source_message_id`) intentionally is not, which is
    what keeps the pair from being a circular FK.
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    conversation_id: str = Field(foreign_key="aiconversation.id", index=True)
    position: int = Field(index=True)
    role: str  # "user" | "assistant" | "tool" | "system"
    content: str = Field(default="")
    tool_calls_json: str | None = Field(default=None)
    tool_call_id: str | None = Field(default=None)
    tool_name: str | None = Field(default=None)
    draft_batch_id: str | None = Field(default=None, foreign_key="aidraftbatch.id")
    provider: str | None = Field(default=None)
    model: str | None = Field(default=None)
    input_tokens: int | None = Field(default=None)
    output_tokens: int | None = Field(default=None)
    latency_ms: int | None = Field(default=None)
    error: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)

    conversation: Optional[AIConversation] = Relationship(back_populates="messages")  # noqa: UP045


class AIDraftBatch(SQLModel, table=True):
    """A set of proposed mutations the user accepts or rejects as a unit.

    `conversation_id` is nullable on purpose: deleting a chat thread nulls it rather
    than deleting the batch, so the record of what the AI actually changed survives.

    `source_message_id` is a plain string, NOT a foreign key -- `AIChatMessage.draft_batch_id`
    already points the other way, and making both directions real FKs would be a circular
    pair that neither SQLite nor Alembic's batch rebuilds handle gracefully.

    `created_at` is indexed because it is the undo-since axis (`POST /drafts/undo {since}`).
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    conversation_id: str | None = Field(default=None, foreign_key="aiconversation.id", index=True)
    source_message_id: str | None = Field(default=None)  # no FK, on purpose
    intent: str | None = Field(default=None)
    request_text: str | None = Field(default=None)  # sanitized copy of what was sent
    summary: str | None = Field(default=None)
    status: str = Field(default="pending", index=True)
    # "pending" | "applied" | "partially_applied" | "rejected" | "undone" | "failed"
    provider: str | None = Field(default=None)
    model: str | None = Field(default=None)
    item_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=utc_now, index=True)
    decided_at: datetime | None = Field(default=None)
    undone_at: datetime | None = Field(default=None)

    items: list["AIDraftItem"] = Relationship(  # noqa: UP037
        back_populates="batch",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class AIDraftItem(SQLModel, table=True):
    """One proposed CRUD operation on one entity.

    `target_id` is deliberately NOT a foreign key (precedent: `RatingEntry.target_id`).
    It is polymorphic across `task`/`session`, and more importantly a target the user
    deleted between propose and accept must surface as a *detectable stale draft*, not
    as a cascade that silently eats the proposal before anyone can read it.

    Three JSON snapshots, all distinct and none redundant:
      * `baseline_json`      -- the target as it looked at PROPOSE time; the diff the UI
                               renders, and the staleness comparison at accept time.
      * `applied_before_json` -- the target as it looked at ACCEPT time; this is what undo
                               restores. Restoring the propose-time snapshot instead would
                               silently revert a manual edit made in between.
      * `applied_after_json`  -- what actually landed after our own services normalized it.

    `is_stale` is computed at read time, never stored.
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    batch_id: str = Field(foreign_key="aidraftbatch.id", index=True)
    position: int = Field(default=0)
    op: str  # "create" | "update" | "delete"
    entity_type: str  # "session" | "task"
    target_id: str | None = Field(default=None, index=True)  # no FK, on purpose
    proposed_json: str = Field(default="{}")
    baseline_json: str | None = Field(default=None)
    applied_before_json: str | None = Field(default=None)
    applied_after_json: str | None = Field(default=None)
    applied_entity_id: str | None = Field(default=None)
    status: str = Field(default="pending", index=True)
    # "pending" | "applied" | "rejected" | "undone" | "failed" | "conflict"
    rationale: str | None = Field(default=None)
    error: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    batch: Optional[AIDraftBatch] = Relationship(back_populates="items")  # noqa: UP045


class AIAudit(SQLModel, table=True):
    """Append-only transition log: proposed / applied / undone / reapplied / rejected / failed.

    `undone` is not terminal -- an undone batch may be re-applied, and each pass appends
    new rows rather than overwriting any state. The draft tables hold current state; this
    table holds history, and the two are not merged on purpose.

    `batch_id` / `item_id` / `entity_id` are plain indexed strings with NO foreign keys:
    an append-only history that a cascade can delete is not an audit trail, and `entity_id`
    is polymorphic across task and session ids anyway.
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    batch_id: str = Field(index=True)  # no FK, on purpose
    item_id: str | None = Field(default=None, index=True)  # no FK, on purpose
    transition: str  # "proposed"|"applied"|"undone"|"reapplied"|"rejected"|"failed"
    entity_type: str | None = Field(default=None)
    entity_id: str | None = Field(default=None, index=True)  # no FK, polymorphic
    before_json: str | None = Field(default=None)
    after_json: str | None = Field(default=None)
    actor: str = Field(default="user")  # "ai" | "user"
    reason: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now, index=True)


class Dashboard(SQLModel, table=True):
    """A named, ordered collection of statistics widgets.

    The old hardcoded `/stats` page becomes one of these -- seeded with slug "overview" at
    application boot by the service layer, never by a migration (see revision 0008's
    docstring for why migration-time seeding is banned here) -- and stays editable like any
    user-created dashboard.

    No owner/user column: ids are UUIDv7, so per-user scoping can be added later without a
    table rebuild, and pre-building it was explicitly ruled out.
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    name: str
    slug: str = Field(index=True, unique=True)  # e.g. "overview"
    is_seeded: bool = Field(default=False)
    position: int = Field(default=0)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    widgets: list["DashboardWidget"] = Relationship(  # noqa: UP037
        back_populates="dashboard",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class DashboardWidget(SQLModel, table=True):
    """One widget on a dashboard: a structured analytics query plus how to draw it.

    `spec_json` is a JSON-serialized query spec (or, later, a read-only SQL spec) held as a
    plain string column on purpose -- the Pydantic schema on the API side is the sole
    authority on its shape, so the DB stores it opaquely rather than as a JSON column type.

    There is deliberately NO `chart_type` column: the chart type is a key inside
    `spec_json`. Storing it in both places would be two authorities for one fact, the same
    trap as `Task.status` vs `Task.status_id` (which this codebase already has to describe
    as only "loosely in sync").

    `seed_key` identifies which seeded Overview widget a row was created from, so re-seeding
    can be idempotent instead of duplicating widgets on every boot; it is NULL for anything
    the user built themselves.

    ORDER BY `position`, never by `id` -- a seeding pass mints every widget of a dashboard
    inside the same millisecond, and uuid7 is only coarsely monotonic at that resolution.
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    dashboard_id: str = Field(foreign_key="dashboard.id", index=True)
    title: str
    width: str = Field(default="half")  # half | full
    position: int = Field(default=0)
    spec_json: str = Field(default="{}")
    seed_key: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    # Optional[X] rather than X | None to match every other relationship in this file --
    # see the note at the top of the module; this annotation is handed to SQLAlchemy as a
    # string and `Dashboard | None` cannot be resolved by its class registry.
    dashboard: Optional[Dashboard] = Relationship(back_populates="widgets")  # noqa: UP045
