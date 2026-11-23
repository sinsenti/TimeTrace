"""Additive targeted timer HTTP interface."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlmodel import Session

from timetrace.db.session import get_session
from timetrace.services.multiple_timer_service import MultipleTimerService

router = APIRouter(tags=["Timers"])


class StartTimer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: str = Field(min_length=1, max_length=128)
    task_id: str | None = None
    tags: str = ""
    notes: str = ""
    mode: str = "flowtime"
    target_minutes: int | None = None
    pause_when_idle: bool = True
    scheduled_session_id: str | None = None
    expected_plan_revision: int | None = None
    expected_projection_revision: str | None = None


class TimerMutation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: str = Field(min_length=1, max_length=128)
    expected_revision: int | None = None
    new_tags: str = ""
    new_notes: str = ""
    expected_note_segment_id: str | None = None
    gap_id: str | None = None
    decision: str | None = None
    pause_when_idle: bool | None = None


class CorrectionInitializeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=128)


@router.post("/timers/correction-initialize")
def correction_initialize(req: CorrectionInitializeRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).mutate("correction_initialize", None, req.model_dump())


class CorrectionRunningTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["running"]
    segment_id: str = Field(min_length=1, max_length=128)


class CorrectionBufferedTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["buffered"]
    segment_id: str = Field(min_length=1, max_length=128)


class CorrectionSavedTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["saved"]
    work_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=1)


class CorrectionStartStep(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["step_start"]
    credited_delta_seconds: int

    @field_validator("credited_delta_seconds")
    @classmethod
    def five_minute_step(cls, value):
        if value not in (-300, 300):
            raise ValueError("Choose an elapsed five-minute step.")
        return value


class CorrectionPreviewRequest(BaseModel):
    """Initial strict preparation interface; no successful approval is issued yet."""

    model_config = ConfigDict(extra="forbid", strict=True)
    target: Annotated[
        CorrectionRunningTarget | CorrectionBufferedTarget | CorrectionSavedTarget, Field(discriminator="kind")
    ]
    change: CorrectionStartStep


# Must precede the legacy two-component mutation route, whose schema/hashes stay unchanged.
@router.post("/timers/{timer_id}/correction-preview")
def correction_preview(timer_id: str, req: CorrectionPreviewRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).correction_preview(timer_id, req.model_dump())


@router.post("/timers/{timer_id}/{action}")
def mutate_timer(timer_id: str, action: str, req: TimerMutation, db: Session = Depends(get_session)):
    payload = req.model_dump()
    if action != "note":
        # Keep canonical payload hashes for operations journaled before note support.
        payload.pop("expected_note_segment_id", None)
    return MultipleTimerService(db).mutate(action, timer_id, payload)


@router.get("/timers/{timer_id}")
def get_timer(timer_id: str, db: Session = Depends(get_session)):
    return MultipleTimerService(db).get_timer(timer_id)


@router.get("/operations/{operation_id}")
def get_operation(operation_id: str, db: Session = Depends(get_session)):
    return MultipleTimerService(db).operation(operation_id)


@router.get("/timers")
def list_timers(db: Session = Depends(get_session)):
    return MultipleTimerService(db).list_timers()


@router.post("/timers")
def start_timer(req: StartTimer, db: Session = Depends(get_session)):
    return MultipleTimerService(db).start(req.model_dump())
