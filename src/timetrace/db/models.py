import uuid
from datetime import UTC, datetime
from typing import Optional

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

    tasks: list["Task"] = Relationship(back_populates="status_rel")


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
    recurrence_rule: str | None = Field(default="daily")  # daily, weekly, weekdays

    requires_session_review: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utc_now)

    # Relationships
    status_rel: Optional[TaskStatus] = Relationship(back_populates="tasks")
    parent: Optional["Task"] = Relationship(
        back_populates="subtasks", sa_relationship_kwargs={"remote_side": "Task.id"}
    )
    subtasks: list["Task"] = Relationship(
        back_populates="parent", sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )
    sessions: list["Session"] = Relationship(back_populates="task")
    review: Optional["TaskReview"] = Relationship(
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

    task: Optional[Task] = Relationship(back_populates="sessions")


class TaskReview(SQLModel, table=True):
    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    task_id: str = Field(foreign_key="task.id", unique=True)
    difficulty: int = Field(default=3)
    what_went_well: str | None = None
    blockers: str | None = None
    key_takeaways: str | None = None
    created_at: datetime = Field(default_factory=utc_now)

    task: Optional[Task] = Relationship(back_populates="review")


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

    logs: list["HabitLog"] = Relationship(
        back_populates="habit",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    goal_history: list["HabitGoalHistory"] = Relationship(
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

    habit: Optional[Habit] = Relationship(back_populates="logs")


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
    habit: Optional[Habit] = Relationship(back_populates="goal_history")


class Dashboard(SQLModel, table=True):
    """A named collection of statistics widgets. The former hardcoded /stats page
    becomes one of these, seeded with slug "overview" at application boot (not in
    a migration), and stays editable like any user-created dashboard."""

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    name: str
    slug: str = Field(index=True, unique=True)  # e.g. "overview"
    is_seeded: bool = Field(default=False)
    position: int = Field(default=0)
    created_at: datetime = Field(default_factory=utc_now)

    widgets: list["DashboardWidget"] = Relationship(
        back_populates="dashboard",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class DashboardWidget(SQLModel, table=True):
    """One widget on a dashboard: a structured analytics query plus how to draw it.

    `spec_json` is a JSON-serialized query spec held as a plain string column on
    purpose -- the Pydantic schema on the API side is the authority on its shape,
    so the DB deliberately stores it opaquely rather than as a JSON column type.
    """

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    dashboard_id: str = Field(foreign_key="dashboard.id", index=True)
    title: str
    chart_type: str = Field(default="bar")  # kpi | bar | line | doughnut | table
    width: str = Field(default="half")  # half | full
    position: int = Field(default=0)
    spec_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=utc_now)

    # Optional[X] rather than X | None, matching the uniform relationship style
    # used throughout this file (see the note on HabitGoalHistory.habit above).
    dashboard: Optional[Dashboard] = Relationship(back_populates="widgets")


class ExternalSyncState(SQLModel, table=True):
    """Per-account sync cursor for external calendar providers (Google/Outlook)."""

    id: str = Field(default_factory=generate_uuid7, primary_key=True)
    provider: str = Field(index=True)
    account_id: str = Field(index=True)
    sync_token: str | None = Field(default=None)
    last_synced_at: datetime = Field(default_factory=utc_now)
