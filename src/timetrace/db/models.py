from datetime import datetime, timezone
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    priority: str = Field(default="-")  # "-", "low", "medium", "high"
    estimated_minutes: Optional[int] = None
    status: str = Field(default="in_progress")  # in_progress, ongoing, completed
    color: str = Field(default="auto")
    tags: str = Field(default="")
    created_at: datetime = Field(default_factory=utc_now)

    sessions: List["Session"] = Relationship(back_populates="task")
    review: Optional["TaskReview"] = Relationship(
        back_populates="task", sa_relationship_kwargs={"uselist": False, "cascade": "all, delete-orphan"}
    )


class Session(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: Optional[int] = Field(default=None, foreign_key="task.id")
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    tags: str = Field(default="")
    notes: Optional[str] = None

    task: Optional[Task] = Relationship(back_populates="sessions")
    reflection: Optional["Reflection"] = Relationship(
        back_populates="session", sa_relationship_kwargs={"uselist": False, "cascade": "all, delete-orphan"}
    )


class Reflection(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", unique=True)
    energy_level: int = Field(default=3)
    obstacles: Optional[str] = None
    habits_completed: str = Field(default="")

    session: Optional[Session] = Relationship(back_populates="reflection")


class TaskReview(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id", unique=True)
    difficulty: int = Field(default=3)  # Scale 1-10 or 1-5
    what_went_well: Optional[str] = None
    blockers: Optional[str] = None
    key_takeaways: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)

    task: Optional[Task] = Relationship(back_populates="review")


class DayReview(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    date_str: str = Field(index=True, unique=True)  # YYYY-MM-DD
    rating: int = Field(default=3)
    wins: Optional[str] = None
    blockers: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class RatingDefinition(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    target_type: str = Field(default="session")  # "session", "task", "day"
    min_score: int = Field(default=1)
    max_score: int = Field(default=10)
    is_required: bool = Field(default=False)
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class RatingEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    rating_definition_id: int = Field(foreign_key="ratingdefinition.id")
    target_type: str = Field(index=True)  # "session", "task", "day"
    target_id: str = Field(index=True)    # Entity ID or date_str
    score: int
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)


class Habit(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    habit_type: str = Field(default="boolean")
    target_value: float = Field(default=1.0)
    unit: str = Field(default="")
    frequency: str = Field(default="Every day")
    reminder_time: Optional[str] = Field(default=None)
    color: str = Field(default="#10b981")
    created_at: datetime = Field(default_factory=utc_now)

    logs: List["HabitLog"] = Relationship(back_populates="habit", sa_relationship_kwargs={"cascade": "all, delete-orphan"})


class HabitLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    habit_id: int = Field(foreign_key="habit.id")
    date_str: str = Field(index=True)
    status: str = Field(default="completed")
    value: float = Field(default=0.0)
    notes: Optional[str] = None

    habit: Optional[Habit] = Relationship(back_populates="logs")
