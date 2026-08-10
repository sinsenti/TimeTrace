from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: int = 1
    estimated_minutes: Optional[int] = None


class TimerStartRequest(BaseModel):
    task_id: Optional[int] = None
    tags: str = ""
    notes: str = ""


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
