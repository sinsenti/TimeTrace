from pydantic import BaseModel
from typing import Optional, List
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
    habits_completed: List[str] = []


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
    habit_type: str = "boolean"  # "boolean" or "numeric"
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
    date_str: str                 # YYYY-MM-DD
    status: Optional[str] = None   # "completed", "failed", "skipped", "erase"
    delta_value: Optional[float] = None  # e.g., +5.0 or -1.0
    set_value: Optional[float] = None    # Direct set e.g., 30.0
