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
    color: str = Field(default="#7c3aed")
    tags: str = Field(default="")
    created_at: datetime = Field(default_factory=utc_now)

    sessions: List["Session"] = Relationship(back_populates="task")


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


class Habit(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    habit_type: str = Field(default="boolean")  # "boolean" or "numeric"
    target_value: float = Field(default=1.0)    # e.g., 1.0 for boolean, 30.0 for pull-ups, 50.0 for pages
    unit: str = Field(default="")               # e.g., "pull-ups", "pages", "miles", ""
    frequency: str = Field(default="Every day") # "Every day", "Mon Wed Fri", "Weekdays", "Weekends"
    reminder_time: Optional[str] = Field(default=None) # e.g. "09:00 AM"
    color: str = Field(default="#10b981")
    created_at: datetime = Field(default_factory=utc_now)

    logs: List["HabitLog"] = Relationship(back_populates="habit", sa_relationship_kwargs={"cascade": "all, delete-orphan"})


class HabitLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    habit_id: int = Field(foreign_key="habit.id")
    date_str: str = Field(index=True)           # YYYY-MM-DD
    status: str = Field(default="completed")    # "completed", "failed", "skipped", "pending"
    value: float = Field(default=0.0)           # Cumulative count (e.g. 25 pull-ups)
    notes: Optional[str] = None

    habit: Optional[Habit] = Relationship(back_populates="logs")
