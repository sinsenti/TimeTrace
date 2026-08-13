from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session as DBSession

from timetrace.db.models import Session as SessionModel
from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import ReflectionCreate, RetroSessionCreate, SessionCreate, SessionUpdate
from timetrace.services import SessionService

router = APIRouter(prefix="", tags=["Sessions"])


@router.post("/sessions", response_model=SessionModel, status_code=status.HTTP_201_CREATED)
def create_session(req: SessionCreate, db: DBSession = Depends(get_session)):
    return SessionService(db).create_session(req)


@router.get("/sessions", response_model=list[dict])
def list_sessions(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    db: DBSession = Depends(get_session)
):
    return SessionService(db).list_sessions(start=start, end=end)


@router.get("/sessions/{session_id}")
def get_session_by_id(session_id: int, db: DBSession = Depends(get_session)):
    return SessionService(db).get_session_by_id(session_id)


@router.put("/sessions/{session_id}", response_model=SessionModel)
def update_session(session_id: int, req: SessionUpdate, db: DBSession = Depends(get_session)):
    return SessionService(db).update_session(session_id, req)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, db: DBSession = Depends(get_session)):
    SessionService(db).delete_session(session_id)
    return None


@router.post("/sessions/retro", response_model=SessionModel, status_code=status.HTTP_201_CREATED)
def create_retro_session(req: RetroSessionCreate, db: DBSession = Depends(get_session)):
    return SessionService(db).create_retro_session(req)


@router.post("/reflections", status_code=status.HTTP_201_CREATED)
def record_session_reflection(req: ReflectionCreate, db: DBSession = Depends(get_session)):
    return SessionService(db).record_reflection(req)
