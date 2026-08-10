from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: int = 1
    status: str = "in_progress"
    color: str = "#7c3aed"
    estimated_minutes: Optional[int] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[str] = None
    color: Optional[str] = None
    estimated_minutes: Optional[int] = None


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
