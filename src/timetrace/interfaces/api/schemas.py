from pydantic import BaseModel, field_validator
from typing import Optional, List, Union
from datetime import datetime


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "-"
    status: str = "in_progress"
    color: str = "#7c3aed"
    tags: str = ""
    estimated_minutes: Optional[int] = None
    created_at: Optional[datetime] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    color: Optional[str] = None
    tags: Optional[str] = None
    estimated_minutes: Optional[int] = None
    created_at: Optional[datetime] = None


class SessionCreate(BaseModel):
    task_id: Optional[int] = None
    start_time: datetime
    end_time: datetime
    tags: str = "#general"
    notes: str = ""


class SessionUpdate(BaseModel):
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    tags: Optional[str] = None
    notes: Optional[str] = None
    task_id: Optional[int] = None


class TimerStartRequest(BaseModel):
    task_id: Optional[int] = None
    tags: str = ""
    notes: str = ""
    mode: str = "flowtime"
    target_minutes: Optional[int] = None


class TimerSplitRequest(BaseModel):
    new_tags: str
    new_notes: str = ""


class ReflectionCreate(BaseModel):
    session_id: int
    energy_level: int
    obstacles: Optional[str] = ""
    habits_completed: Union[List[str], str] = []

    @field_validator("habits_completed", mode="before")
    @classmethod
    def normalize_habits(cls, v):
        if isinstance(v, str):
            return [h.strip() for h in v.split(",") if h.strip()]
        return v


class RetroSessionCreate(BaseModel):
    task_id: Optional[int] = None
    start_time: datetime
    end_time: datetime
    tags: str = ""
    notes: str = ""


class IdleToggleRequest(BaseModel):
    enabled: Optional[bool] = None


class IdleResolveRequest(BaseModel):
    option: str  # "discard", "break", "claim_work", "re_tag"
    new_tags: Optional[str] = "#general"
    new_notes: Optional[str] = ""


class HabitCreate(BaseModel):
    name: str
    habit_type: str = "boolean"
    target_value: float = 1.0
    unit: str = ""
    frequency: str = "Every day"
    reminder_time: Optional[str] = None
    color: str = "#10b981"


class HabitUpdate(BaseModel):
    name: Optional[str] = None
    habit_type: Optional[str] = None
    target_value: Optional[float] = None
    unit: Optional[str] = None
    frequency: Optional[str] = None
    reminder_time: Optional[str] = None
    color: Optional[str] = None


class HabitLogRequest(BaseModel):
    date_str: str
    status: Optional[str] = None
    delta_value: Optional[float] = None
    set_value: Optional[float] = None
