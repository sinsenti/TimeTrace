"""Additive targeted timer HTTP interface."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from timetrace.db.session import get_session
from timetrace.services.multiple_timer_service import MultipleTimerService

router = APIRouter(tags=["Timers"])


class StartTimer(BaseModel):
    operation_id: str
    task_id: str | None = None
    tags: str = ""
    notes: str = ""
    mode: str = "flowtime"
    target_minutes: int | None = None


class TimerMutation(BaseModel):
    operation_id: str
    expected_revision: int | None = None
    new_tags: str = ""
    new_notes: str = ""


@router.post("/timers/{timer_id}/{action}")
def mutate_timer(timer_id: str, action: str, req: TimerMutation, db: Session = Depends(get_session)):
    return MultipleTimerService(db).mutate(action, timer_id, req.model_dump())


@router.get("/timers")
def list_timers(db: Session = Depends(get_session)):
    return MultipleTimerService(db).list_timers()


@router.post("/timers")
def start_timer(req: StartTimer, db: Session = Depends(get_session)):
    return MultipleTimerService(db).start(req.model_dump())
