from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session as DBSession

from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import (
    AgendaRead,
    LegacySessionRead,
    RecurrenceScope,
    ReflectionCreate,
    RetroSessionCreate,
    ScheduledSessionCreate,
    ScheduledSessionRead,
    ScheduledSessionUpdate,
    SessionCreate,
    SessionEditScope,
    SessionUpdate,
)
from timetrace.services import SessionService

router = APIRouter(prefix="", tags=["Sessions"])


@router.get("/agenda", response_model=AgendaRead)
def list_agenda(start: datetime, end: datetime, db: DBSession = Depends(get_session)):
    return SessionService(db).list_agenda(start, end)


@router.post("/scheduled-sessions", response_model=ScheduledSessionRead, status_code=status.HTTP_201_CREATED)
def create_scheduled_session(req: ScheduledSessionCreate, db: DBSession = Depends(get_session)):
    return SessionService(db).create_scheduled_session(req)


@router.get("/scheduled-sessions/{plan_id}", response_model=ScheduledSessionRead)
def get_scheduled_session(plan_id: str, db: DBSession = Depends(get_session)):
    return SessionService(db).get_scheduled_session(plan_id)


@router.put("/scheduled-sessions/{plan_id}", response_model=ScheduledSessionRead)
def update_scheduled_session(plan_id: str, req: ScheduledSessionUpdate, db: DBSession = Depends(get_session)):
    return SessionService(db).update_scheduled_session(plan_id, req)


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
