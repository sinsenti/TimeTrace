from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session as DBSession

from timetrace.db.session import get_session
from timetrace.db.models import Task, Session as SessionModel
from timetrace.core.timer import timer_manager
from timetrace.interfaces.api.schemas import TimerStartRequest, TimerSplitRequest, IdleToggleRequest, IdleResolveRequest
from timetrace.interfaces.api.utils import ensure_utc

router = APIRouter(prefix="/timer", tags=["Active Timer"])


@router.get("/status")
def timer_status(db: DBSession = Depends(get_session)):
    status_data = timer_manager.get_status()
    if status_data.get("task_id") and not status_data.get("task_title"):
        task_obj = db.get(Task, status_data["task_id"])
        if task_obj:
            status_data["task_title"] = task_obj.title
    return status_data


@router.post("/start")
def start_timer(req: TimerStartRequest, db: DBSession = Depends(get_session)):
    try:
        task_title = None
        if req.task_id:
            t = db.get(Task, req.task_id)
            if t:
                task_title = t.title
        return timer_manager.start(
            task_id=req.task_id,
            task_title=task_title,
            tags=req.tags,
            notes=req.notes,
            mode=req.mode,
            target_minutes=req.target_minutes
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/split", response_model=SessionModel)
def split_timer(req: TimerSplitRequest, db: DBSession = Depends(get_session)):
    try:
        stopped_session_data = timer_manager.split(new_tags=req.new_tags, new_notes=req.new_notes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db_session = SessionModel(
        task_id=stopped_session_data["task_id"],
        start_time=ensure_utc(stopped_session_data["start_time"]),
        end_time=ensure_utc(stopped_session_data["end_time"]),
        duration_seconds=stopped_session_data["duration_seconds"],
        tags=stopped_session_data["tags"],
        notes=stopped_session_data["notes"]
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    db_session.start_time = ensure_utc(db_session.start_time)
    db_session.end_time = ensure_utc(db_session.end_time)
    return db_session


@router.post("/stop", response_model=SessionModel)
def stop_timer(db: DBSession = Depends(get_session)):
    try:
        session_data = timer_manager.stop()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db_session = SessionModel(
        task_id=session_data["task_id"],
        start_time=ensure_utc(session_data["start_time"]),
        end_time=ensure_utc(session_data["end_time"]),
        duration_seconds=session_data["duration_seconds"],
        tags=session_data["tags"],
        notes=session_data["notes"]
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    db_session.start_time = ensure_utc(db_session.start_time)
    db_session.end_time = ensure_utc(db_session.end_time)
    return db_session


# Idle Detection Router
idle_router = APIRouter(prefix="/idle", tags=["Idle Detector"])


@idle_router.post("/toggle")
def toggle_idle_detection(req: IdleToggleRequest):
    new_state = timer_manager.toggle_idle_detection(req.enabled)
    return {"idle_detection_enabled": new_state}


@idle_router.post("/resolve")
def resolve_idle_gap(req: IdleResolveRequest, db: DBSession = Depends(get_session)):
    gap = timer_manager.pending_idle_gap
    if not gap:
        raise HTTPException(status_code=400, detail="No pending idle gap to resolve.")

    saved_session_data = gap.get("saved_session")
    if saved_session_data and saved_session_data.get("duration_seconds", 0) > 0:
        db_work = SessionModel(
            task_id=saved_session_data.get("task_id"),
            start_time=ensure_utc(datetime.fromisoformat(saved_session_data["start_time"])),
            end_time=ensure_utc(datetime.fromisoformat(saved_session_data["end_time"])),
            duration_seconds=saved_session_data["duration_seconds"],
            tags=saved_session_data.get("tags") or "#general",
            notes=saved_session_data.get("notes") or ""
        )
        db.add(db_work)
        db.commit()

    idle_start = ensure_utc(datetime.fromisoformat(gap["idle_start"]))
    idle_end = ensure_utc(datetime.fromisoformat(gap["idle_end"]))
    idle_duration = int((idle_end - idle_start).total_seconds())

    if req.option == "break":
        db_break = SessionModel(
            task_id=gap.get("task_id"),
            start_time=idle_start,
            end_time=idle_end,
            duration_seconds=idle_duration,
            tags="#break",
            notes="AFK Break Time"
        )
        db.add(db_break)
        db.commit()

    elif req.option == "claim_work":
        db_claimed = SessionModel(
            task_id=gap.get("task_id"),
            start_time=idle_start,
            end_time=idle_end,
            duration_seconds=idle_duration,
            tags=gap.get("tags") or "#general",
            notes=f"Claimed AFK Work: {gap.get('notes', '')}".strip()
        )
        db.add(db_claimed)
        db.commit()

    elif req.option == "re_tag":
        db_retag = SessionModel(
            task_id=gap.get("task_id"),
            start_time=idle_start,
            end_time=idle_end,
            duration_seconds=idle_duration,
            tags=req.new_tags or "#general",
            notes=req.new_notes or "Re-tagged AFK time"
        )
        db.add(db_retag)
        db.commit()

    timer_manager.resolve_idle_gap()
    return {"status": "success", "option_applied": req.option}
