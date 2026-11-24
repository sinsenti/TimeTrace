from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlmodel import Session as DBSession

from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import (
    AgendaLegacyRead,
    AgendaProjectedPlanRead,
    AgendaRead,
    AgendaRecordedWorkRead,
    LegacySessionRead,
    PlanRemovalRequest,
    RecordedWorkCreate,
    RecordedWorkCreated,
    RecordedWorkNoteUpdate,
    RecurrenceScope,
    ReflectionCreate,
    RetroSessionCreate,
    ScheduledOccurrenceUpdate,
    ScheduledSessionCreate,
    ScheduledSessionExtension,
    ScheduledSessionRead,
    ScheduledSessionUpdate,
    SessionCreate,
    SessionEditScope,
    SessionUpdate,
    TaskCreate,
)
from timetrace.services import PlanRemovalService, QueryService, SessionService

router = APIRouter(prefix="", tags=["Sessions"])


@router.get("/scheduled-sessions/{plan_id}/removal-preview")
def preview_plan_removal(plan_id: str, db: DBSession = Depends(get_session)):
    return PlanRemovalService(db).preview(plan_id)


@router.post("/scheduled-sessions/{plan_id}/removal")
def apply_plan_removal(plan_id: str, req: PlanRemovalRequest, db: DBSession = Depends(get_session)):
    return PlanRemovalService(db).apply(plan_id, req)


@router.get("/recorded-work-progress")
def recorded_work_progress(
    start_date: str,
    end_date: str,
    plan_ids: list[str] = Query(default=[], max_length=500),
    db: DBSession = Depends(get_session),
):
    return QueryService(db).recorded_progress(start_date, end_date, plan_ids)


@router.post("/recorded-work", response_model=RecordedWorkCreated, status_code=status.HTTP_201_CREATED)
def create_recorded_work(req: RecordedWorkCreate, db: DBSession = Depends(get_session)):
    return SessionService(db).create_recorded_work(req)


class AssignmentWork(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    expected_revision: int = Field(ge=1, strict=True)


class AssignmentDestination(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["existing"]
    task_id: str = Field(min_length=1)


class AssignmentTaskDraft(TaskCreate):
    model_config = ConfigDict(extra="forbid")

    @field_validator("title")
    @classmethod
    def nonempty_title(cls, value):
        if not value.strip():
            raise ValueError("New assignment task title cannot be blank")
        return value


    @field_validator("created_at")
    @classmethod
    def nonnull_supplied_created_at(cls, value):
        if value is None:
            raise ValueError("Omit created_at to use the normal creation time; explicit null is not a timestamp")
        return value


class NewAssignmentDestination(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["new"]
    task_draft: AssignmentTaskDraft


class WorkAssignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: str = Field(min_length=1, max_length=128)
    works: list[AssignmentWork] = Field(min_length=1, max_length=2000)
    destination: AssignmentDestination | NewAssignmentDestination = Field(discriminator="kind")

    @model_validator(mode="after")
    def unique_work_ids(self):
        if len({item.id for item in self.works}) != len(self.works):
            raise ValueError("Assignment work IDs must be unique")
        return self


@router.post("/recorded-work/assignment")
def assign_recorded_work(req: WorkAssignment, db: DBSession = Depends(get_session)):
    from timetrace.services.multiple_timer_service import MultipleTimerService

    return MultipleTimerService(db).mutate("assignment", None, req.model_dump(mode="json", exclude_unset=True))


@router.patch("/recorded-work/{work_id}/note", response_model=AgendaRecordedWorkRead)
def update_work_note(work_id: str, req: RecordedWorkNoteUpdate, db: DBSession = Depends(get_session)):
    return SessionService(db).update_recorded_work_note(work_id, req.notes, req.expected_revision)


@router.get("/recorded-work/{work_id}", response_model=AgendaRecordedWorkRead)
def get_recorded_work(work_id: str, db: DBSession = Depends(get_session)):
    return SessionService(db).get_recorded_work(work_id)


@router.get("/agenda", response_model=AgendaRead)
def list_agenda(
    start: datetime,
    end: datetime,
    legacy_cohort: Literal["overlap", "start"] = "overlap",
    db: DBSession = Depends(get_session),
):
    return SessionService(db).list_agenda(start, end, legacy_start_cohort=legacy_cohort == "start")


@router.get(
    "/agenda/occurrences/{occurrence_id}",
    response_model=ScheduledSessionRead | AgendaProjectedPlanRead | AgendaLegacyRead,
)
def get_agenda_occurrence(occurrence_id: str, db: DBSession = Depends(get_session)):
    return SessionService(db).get_agenda_occurrence(occurrence_id)


@router.post("/scheduled-sessions", response_model=ScheduledSessionRead, status_code=status.HTTP_201_CREATED)
def create_scheduled_session(req: ScheduledSessionCreate, db: DBSession = Depends(get_session)):
    return SessionService(db).create_scheduled_session(req)


@router.get("/scheduled-sessions/{plan_id}", response_model=ScheduledSessionRead | AgendaProjectedPlanRead)
def get_scheduled_session(plan_id: str, db: DBSession = Depends(get_session)):
    return SessionService(db).get_scheduled_session(plan_id)


@router.post("/scheduled-sessions/{plan_id}/extend", response_model=ScheduledSessionRead)
def extend_scheduled_session(plan_id: str, req: ScheduledSessionExtension, db: DBSession = Depends(get_session)):
    return SessionService(db).extend_scheduled_session(plan_id, req)


@router.put("/scheduled-sessions/{plan_id}", response_model=ScheduledSessionRead)
def update_scheduled_session(
    plan_id: str,
    req: ScheduledSessionUpdate | ScheduledOccurrenceUpdate,
    scope: SessionEditScope = Query("only_this"),
    db: DBSession = Depends(get_session),
):
    return SessionService(db).update_scheduled_session(plan_id, req, scope=scope)


@router.post("/sessions", response_model=LegacySessionRead, status_code=status.HTTP_201_CREATED)
def create_session(req: SessionCreate, db: DBSession = Depends(get_session)):
    return SessionService(db).create_session(req)


@router.get("/sessions", response_model=list[dict])
def list_sessions(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    include_virtual: bool = Query(True, description="Include projected occurrences of recurring tasks"),
    db: DBSession = Depends(get_session),
):
    return SessionService(db).list_sessions(start=start, end=end, include_virtual=include_virtual)


@router.get("/sessions/{session_id}")
def get_session_by_id(session_id: str, db: DBSession = Depends(get_session)):
    return SessionService(db).get_session_by_id(session_id)


@router.put("/sessions/{session_id}", response_model=LegacySessionRead)
def update_session(
    session_id: str,
    req: SessionUpdate,
    scope: SessionEditScope = Query("only_this", description="'only_this' or 'all_future'"),
    db: DBSession = Depends(get_session),
):
    return SessionService(db).update_session(session_id, req, scope=scope)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str,
    scope: RecurrenceScope = Query("only_this", description="Deletion scope: 'only_this', 'following', 'all'"),
    db: DBSession = Depends(get_session),
):
    SessionService(db).delete_session(session_id, scope=scope)
    return None


@router.post("/sessions/retro", response_model=LegacySessionRead, status_code=status.HTTP_201_CREATED)
def create_retro_session(req: RetroSessionCreate, db: DBSession = Depends(get_session)):
    return SessionService(db).create_retro_session(req)


@router.post("/reflections", status_code=status.HTTP_201_CREATED)
def record_session_reflection(req: ReflectionCreate, db: DBSession = Depends(get_session)):
    return SessionService(db).record_reflection(req)
