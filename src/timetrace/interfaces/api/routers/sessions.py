from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session as DBSession, select
from typing import List, Optional
from datetime import datetime

from timetrace.db.session import get_session
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import SessionCreate, SessionUpdate, RetroSessionCreate, ReflectionCreate
from timetrace.interfaces.api.utils import ensure_utc

router = APIRouter(prefix="", tags=["Sessions"])


@router.post("/sessions", response_model=SessionModel, status_code=status.HTTP_201_CREATED)
def create_session(req: SessionCreate, db: DBSession = Depends(get_session)):
    start_utc = ensure_utc(req.start_time)
    end_utc = ensure_utc(req.end_time)
    
    if end_utc <= start_utc:
        raise HTTPException(status_code=400, detail="end_time must be strictly after start_time")

    duration = int((end_utc - start_utc).total_seconds())
    db_session = SessionModel(
        task_id=req.task_id,
        start_time=start_utc,
        end_time=end_utc,
        duration_seconds=duration,
        tags=req.tags,
        notes=req.notes,
        review_skipped=req.review_skipped
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    db_session.start_time = ensure_utc(db_session.start_time)
    db_session.end_time = ensure_utc(db_session.end_time)
    return db_session


@router.get("/sessions", response_model=List[dict])
def list_sessions(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: DBSession = Depends(get_session)
):
    query = select(SessionModel)
    if start:
        naive_start = ensure_utc(start).replace(tzinfo=None)
        query = query.where(SessionModel.start_time >= naive_start)
    if end:
        naive_end = ensure_utc(end).replace(tzinfo=None)
        query = query.where(SessionModel.start_time <= naive_end)

    sessions = db.exec(query).all()
    result = []
    for s in sessions:
        s_dict = s.model_dump()
        if s.start_time:
            s_dict["start_time"] = ensure_utc(s.start_time).isoformat()
        if s.end_time:
            s_dict["end_time"] = ensure_utc(s.end_time).isoformat()
        result.append(s_dict)
    return result


@router.get("/sessions/{session_id}")
def get_session_by_id(session_id: int, db: DBSession = Depends(get_session)):
    s = db.get(SessionModel, session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    
    s_dict = s.model_dump()
    s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
    s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
    if s.task:
        s_dict["task"] = s.task.model_dump()
        
    return s_dict


@router.put("/sessions/{session_id}", response_model=SessionModel)
def update_session(session_id: int, req: SessionUpdate, db: DBSession = Depends(get_session)):
    db_session = db.get(SessionModel, session_id)
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    update_dict = req.model_dump(exclude_unset=True)
    for key, val in update_dict.items():
        if key in ("start_time", "end_time") and val is not None:
            setattr(db_session, key, ensure_utc(val))
        else:
            setattr(db_session, key, val)

    if db_session.start_time and db_session.end_time:
        st = ensure_utc(db_session.start_time)
        et = ensure_utc(db_session.end_time)
        db_session.duration_seconds = max(0, int((et - st).total_seconds()))

    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    db_session.start_time = ensure_utc(db_session.start_time)
    db_session.end_time = ensure_utc(db_session.end_time)
    return db_session


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, db: DBSession = Depends(get_session)):
    db_session = db.get(SessionModel, session_id)
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.delete(db_session)
    db.commit()
    return None


@router.post("/sessions/retro", response_model=SessionModel, status_code=status.HTTP_201_CREATED)
def create_retro_session(req: RetroSessionCreate, db: DBSession = Depends(get_session)):
    start_utc = ensure_utc(req.start_time)
    end_utc = ensure_utc(req.end_time)

    if end_utc <= start_utc:
        raise HTTPException(status_code=400, detail="end_time must be strictly after start_time")

    duration = int((end_utc - start_utc).total_seconds())
    db_session = SessionModel(
        task_id=req.task_id,
        start_time=start_utc,
        end_time=end_utc,
        duration_seconds=duration,
        tags=req.tags,
        notes=req.notes
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    db_session.start_time = ensure_utc(db_session.start_time)
    db_session.end_time = ensure_utc(db_session.end_time)
    return db_session


@router.post("/reflections", status_code=status.HTTP_201_CREATED)
def record_session_reflection(req: ReflectionCreate, db: DBSession = Depends(get_session)):
    db_session = db.get(SessionModel, req.session_id)
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    reflection_notes = []
    reflection_notes.append(f"Energy: {req.energy_level}/5")
    if req.habits_completed:
        reflection_notes.append(f"Habits: {', '.join(req.habits_completed)}")
    if req.obstacles:
        reflection_notes.append(f"Obstacles: {req.obstacles}")

    additional_note = " | ".join(reflection_notes)
    if db_session.notes:
        db_session.notes = f"{db_session.notes}\n{additional_note}"
    else:
        db_session.notes = additional_note

    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return {"status": "success", "session_id": db_session.id, "reflection": additional_note}
