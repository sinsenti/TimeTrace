from datetime import UTC, datetime
from typing import Optional

from sqlmodel import Field, Relationship, SQLModel


def utc_now() -> datetime:
    return datetime.now(UTC)


class TaskStatus(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    is_completed: bool = Field(default=False)
    is_hide_by_default: bool = Field(default=False)
    is_scheduled_trigger: bool = Field(default=False)
    color: str = Field(default="#7c3aed")
    position: int = Field(default=0)
    created_at: datetime = Field(default_factory=utc_now)

    tasks: list["Task"] = Relationship(back_populates="status_rel")


class Task(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    description: str | None = None
    priority: str = Field(default="-")  # "-", "low", "medium", "high"
    estimated_minutes: int | None = Field(default=15)
    status: str = Field(default="To Do")
    status_id: int | None = Field(default=None, foreign_key="taskstatus.id")
    parent_id: int | None = Field(default=None, foreign_key="task.id")
    category: str = Field(default="work")
    color: str = Field(default="auto")
    tags: str = Field(default="")
    
    # Optional Fields (Default is_recurring is False)
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
        back_populates="subtasks",
        sa_relationship_kwargs={"remote_side": "Task.id"}
    )
    subtasks: list["Task"] = Relationship(
        back_populates="parent",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )
    sessions: list["Session"] = Relationship(back_populates="task")
    review: Optional["TaskReview"] = Relationship(
        back_populates="task",
        sa_relationship_kwargs={"uselist": False, "cascade": "all, delete-orphan"}
    )


class Session(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    task_id: int | None = Field(default=None, foreign_key="task.id")
    start_time: datetime
    end_time: datetime | None = None
    duration_seconds: int | None = None
    tags: str = Field(default="")
    notes: str | None = None
    review_skipped: bool = Field(default=False)

    task: Task | None = Relationship(back_populates="sessions")


class TaskReview(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", unique=True)
    difficulty: int = Field(default=3)
    what_went_well: str | None = None
    blockers: str | None = None
    key_takeaways: str | None = None
    created_at: datetime = Field(default_factory=utc_now)

    task: Task | None = Relationship(back_populates="review")


class DayReview(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    date_str: str = Field(index=True, unique=True)
    rating: int = Field(default=3)
    highlights: str | None = None
    friction: str | None = None
    notes: str | None = None
    review_skipped: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utc_now)


class RatingDefinition(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    target_type: str = Field(default="session")
    min_score: int = Field(default=1)
    max_score: int = Field(default=10)
    is_required: bool = Field(default=False)
    description: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class RatingEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    rating_definition_id: int = Field(foreign_key="ratingdefinition.id")
    target_type: str = Field(index=True)
    target_id: str = Field(index=True)
    score: int | None = Field(default=0, nullable=True)
    dismissed: bool = Field(default=False)
    notes: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class Habit(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
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


class HabitLog(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    habit_id: int = Field(foreign_key="habit.id")
    date_str: str = Field(index=True)
    status: str = Field(default="completed")
    value: float = Field(default=0.0)
    notes: str | None = None

    habit: Habit | None = Relationship(back_populates="logs")
