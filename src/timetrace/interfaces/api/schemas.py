from pydantic import BaseModel, field_validator
from typing import Optional, List, Union
from datetime import datetime


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "-"
    status: str = "in_progress"
    color: str = "auto"
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


class DayReviewCreate(BaseModel):
    date_str: str
    rating: int = 3
    wins: Optional[str] = ""
    blockers: Optional[str] = ""
    notes: Optional[str] = ""


class TaskReviewCreate(BaseModel):
    task_id: int
    difficulty: int = 3
    what_went_well: Optional[str] = ""
    blockers: Optional[str] = ""
    key_takeaways: Optional[str] = ""


class RatingDefinitionCreate(BaseModel):
    name: str
    target_type: str = "session"  # "session", "task", "day"
    min_score: int = 1
    max_score: int = 10
    is_required: bool = False
    description: Optional[str] = None


class RatingDefinitionUpdate(BaseModel):
    name: Optional[str] = None
    target_type: Optional[str] = None
    min_score: Optional[int] = None
    max_score: Optional[int] = None
    is_required: Optional[bool] = None
    description: Optional[str] = None


class RatingEntryCreate(BaseModel):
    rating_definition_id: int
    target_type: str
    target_id: str
    score: int
    notes: Optional[str] = None


class RetroSessionCreate(BaseModel):
    task_id: Optional[int] = None
    start_time: datetime
    end_time: datetime
    tags: str = ""
    notes: str = ""


class IdleToggleRequest(BaseModel):
    enabled: Optional[bool] = None


class IdleResolveRequest(BaseModel):
    option: str
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
