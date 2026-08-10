from datetime import datetime, timezone
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    priority: int = Field(default=1)  # 1 (low) to 4 (urgent)
    estimated_minutes: Optional[int] = None
    status: str = Field(default="in_progress")  # in_progress, ongoing, completed
    color: str = Field(default="#7c3aed")  # Hex color for Chronoboard cards
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

