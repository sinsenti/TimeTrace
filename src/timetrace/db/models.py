from datetime import datetime
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship


class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    priority: int = Field(default=1)
    estimated_minutes: Optional[int] = None
    status: str = Field(default="todo")
    created_at: datetime = Field(default_factory=datetime.utcnow)

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
        back_populates="session",
        sa_relationship_kwargs={"uselist": False}
    )


class Reflection(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="session.id", unique=True)
    energy_level: int = Field(default=3)
    obstacles: Optional[str] = None
    habits_completed: str = Field(default="")

    session: Optional[Session] = Relationship(back_populates="reflection")
