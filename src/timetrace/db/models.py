from datetime import UTC, datetime
from typing import Optional

from sqlmodel import Field, Relationship, SQLModel


def utc_now() -> datetime:
    return datetime.now(UTC)


class Task(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    description: str | None = None
    priority: str = Field(default="-")  # "-", "low", "medium", "high"
    estimated_minutes: int | None = None
    status: str = Field(default="in_progress")  # in_progress, ongoing, completed
    color: str = Field(default="auto")
    tags: str = Field(default="")
    requires_session_review: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utc_now)

    sessions: list["Session"] = Relationship(back_populates="task")
    review: Optional["TaskReview"] = Relationship(
        back_populates="task", sa_relationship_kwargs={"uselist": False, "cascade": "all, delete-orphan"}
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
    date_str: str = Field(index=True, unique=True)  # YYYY-MM-DD
    rating: int = Field(default=3)
    highlights: str | None = None
    friction: str | None = None
    notes: str | None = None
    review_skipped: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utc_now)


class RatingDefinition(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    target_type: str = Field(default="session")  # "session", "task", "day"
    min_score: int = Field(default=1)
    max_score: int = Field(default=10)
    is_required: bool = Field(default=False)
    description: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class RatingEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    rating_definition_id: int = Field(foreign_key="ratingdefinition.id")
    target_type: str = Field(index=True)  # "session", "task", "day"
    target_id: str = Field(index=True)    # Entity ID or date_str
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

    logs: list["HabitLog"] = Relationship(back_populates="habit", sa_relationship_kwargs={"cascade": "all, delete-orphan"})


class HabitLog(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    habit_id: int = Field(foreign_key="habit.id")
    date_str: str = Field(index=True)
    status: str = Field(default="completed")
    value: float = Field(default=0.0)
    notes: str | None = None

    habit: Habit | None = Relationship(back_populates="logs")
