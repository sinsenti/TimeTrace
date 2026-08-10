from fastapi import APIRouter, Depends, HTTPException, status, Body
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlmodel import Session as DBSession, select
from typing import List
from datetime import date

from timetrace.db.session import get_session
from timetrace.db.models import Task, Session as SessionModel, Reflection
from timetrace.core.timer import timer_manager
from timetrace.core.parser import export_sessions_to_markdown, parse_markdown_to_sessions
from timetrace.interfaces.api.schemas import (
    TaskCreate,
    TimerStartRequest,
    ReflectionCreate,
    RetroSessionCreate
)
from timetrace.interfaces.api.web_dashboard import HTML_DASHBOARD

router = APIRouter()


@router.get("/dashboard", response_class=HTMLResponse)
def get_web_dashboard():
    return HTML_DASHBOARD


@router.get("/markdown/export", response_class=PlainTextResponse)
def export_markdown(db: DBSession = Depends(get_session)):
    sessions = db.exec(select(SessionModel)).all()
    session_dicts = []
    for s in sessions:
        s_dict = s.model_dump()
        if s.reflection:
            s_dict["reflection"] = s.reflection.model_dump()
        session_dicts.append(s_dict)

    return export_sessions_to_markdown(session_dicts, date.today())


@router.post("/markdown/import", status_code=status.HTTP_201_CREATED)
def import_markdown(content: str = Body(..., media_type="text/plain"), db: DBSession = Depends(get_session)):
    parsed_sessions = parse_markdown_to_sessions(content)
    added_count = 0
    for s in parsed_sessions:
        db_session = SessionModel(
            start_time=s["start_time"],
            end_time=s["end_time"],
            duration_seconds=s["duration_seconds"],
            tags=s["tags"],
            notes=s["notes"]
        )
        db.add(db_session)
        added_count += 1
    db.commit()
    return {"status": "success", "imported_sessions": added_count}


@router.post("/tasks", response_model=Task, status_code=status.HTTP_201_CREATED)
def create_task(task: TaskCreate, db: DBSession = Depends(get_session)):
    db_task = Task.model_validate(task)
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    return db_task


@router.get("/tasks", response_model=List[Task])
def list_tasks(db: DBSession = Depends(get_session)):
    return db.exec(select(Task)).all()


@router.get("/timer/status")
def timer_status():
    return timer_manager.get_status()


@router.post("/timer/start")
def start_timer(req: TimerStartRequest):
    try:
        return timer_manager.start(task_id=req.task_id, tags=req.tags, notes=req.notes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/timer/stop", response_model=SessionModel)
def stop_timer(db: DBSession = Depends(get_session)):
    try:
        session_data = timer_manager.stop()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db_session = SessionModel(
        task_id=session_data["task_id"],
        start_time=session_data["start_time"],
        end_time=session_data["end_time"],
        duration_seconds=session_data["duration_seconds"],
        tags=session_data["tags"],
        notes=session_data["notes"]
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session


@router.post("/sessions/retro", response_model=SessionModel, status_code=status.HTTP_201_CREATED)
def create_retro_session(req: RetroSessionCreate, db: DBSession = Depends(get_session)):
    if req.end_time <= req.start_time:
        raise HTTPException(status_code=400, detail="end_time must be strictly after start_time")

    duration = int((req.end_time - req.start_time).total_seconds())
    db_session = SessionModel(
        task_id=req.task_id,
        start_time=req.start_time,
        end_time=req.end_time,
        duration_seconds=duration,
        tags=req.tags,
        notes=req.notes
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session


@router.get("/sessions", response_model=List[SessionModel])
def list_sessions(db: DBSession = Depends(get_session)):
    return db.exec(select(SessionModel)).all()


@router.post("/reflections", response_model=Reflection, status_code=status.HTTP_201_CREATED)
def create_reflection(req: ReflectionCreate, db: DBSession = Depends(get_session)):
    session_obj = db.get(SessionModel, req.session_id)
    if not session_obj:
        raise HTTPException(status_code=404, detail="Session ID not found")

    db_reflection = Reflection(
        session_id=req.session_id,
        energy_level=req.energy_level,
        obstacles=req.obstacles,
        habits_completed=",".join(req.habits_completed)
    )
    db.add(db_reflection)
    db.commit()
    db.refresh(db_reflection)
    return db_reflection
