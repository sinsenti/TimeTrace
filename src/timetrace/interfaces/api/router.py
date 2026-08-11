import os
from fastapi import APIRouter, Depends, HTTPException, status, Body, Query
from fastapi.responses import FileResponse, PlainTextResponse
from sqlmodel import Session as DBSession, select
from typing import List, Optional
from datetime import datetime, date, timezone, timedelta

from timetrace.db.session import get_session
from timetrace.db.models import Task, Session as SessionModel, Reflection, Habit, HabitLog
from timetrace.core.timer import timer_manager
from timetrace.core.parser import export_sessions_to_markdown, parse_markdown_to_sessions
from timetrace.core.analytics import calculate_tag_summaries, calculate_detailed_analytics
from timetrace.core.editor import get_auto_color
from timetrace.interfaces.api.schemas import (
    TaskCreate,
    TaskUpdate,
    SessionCreate,
    SessionUpdate,
    TimerStartRequest,
    TimerSplitRequest,
    ReflectionCreate,
    RetroSessionCreate,
    IdleToggleRequest,
    IdleResolveRequest,
    HabitCreate,
    HabitUpdate,
    HabitLogRequest
)

router = APIRouter()

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


# Static Web Serving
@router.get("/dashboard", response_class=FileResponse)
def get_web_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@router.get("/stats", response_class=FileResponse)
def get_stats_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "stats.html"))


@router.get("/habits-view", response_class=FileResponse)
def get_habits_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "habits.html"))


@router.get("/static/{file_path:path}")
def get_static_file(file_path: str):
    full_path = os.path.join(STATIC_DIR, file_path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return FileResponse(full_path)
    raise HTTPException(status_code=404, detail="Static asset not found")


# Habit Tracker API Endpoints
@router.post("/habits", response_model=Habit, status_code=status.HTTP_201_CREATED)
def create_habit(req: HabitCreate, db: DBSession = Depends(get_session)):
    db_habit = Habit.model_validate(req.model_dump())
    db.add(db_habit)
    db.commit()
    db.refresh(db_habit)
    return db_habit


@router.get("/habits")
def list_habits(db: DBSession = Depends(get_session)):
    habits = db.exec(select(Habit)).all()
    today_dt = datetime.now().date()
    
    # Query last 14 days of logs for matrix view
    start_date_str = (today_dt - timedelta(days=13)).strftime("%Y-%m-%d")
    logs = db.exec(select(HabitLog).where(HabitLog.date_str >= start_date_str)).all()

    log_map = {}
    for l in logs:
        if l.habit_id not in log_map:
            log_map[l.habit_id] = {}
        log_map[l.habit_id][l.date_str] = l.model_dump()

    result = []
    for h in habits:
        h_dict = h.model_dump()
        h_dict["logs"] = log_map.get(h.id, {})
        result.append(h_dict)

    return result


@router.put("/habits/{habit_id}", response_model=Habit)
def update_habit(habit_id: int, req: HabitUpdate, db: DBSession = Depends(get_session)):
    db_habit = db.get(Habit, habit_id)
    if not db_habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    update_dict = req.model_dump(exclude_unset=True)
    for k, v in update_dict.items():
        setattr(db_habit, k, v)

    db.add(db_habit)
    db.commit()
    db.refresh(db_habit)
    return db_habit


@router.delete("/habits/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(habit_id: int, db: DBSession = Depends(get_session)):
    db_habit = db.get(Habit, habit_id)
    if not db_habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    db.delete(db_habit)
    db.commit()
    return None


@router.post("/habits/{habit_id}/log")
def log_habit_progress(habit_id: int, req: HabitLogRequest, db: DBSession = Depends(get_session)):
    db_habit = db.get(Habit, habit_id)
    if not db_habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    # Fetch existing log for date or create new
    log = db.exec(select(HabitLog).where(HabitLog.habit_id == habit_id, HabitLog.date_str == req.date_str)).first()

    if req.status == "erase":
        if log:
            db.delete(log)
            db.commit()
        return {"status": "erased", "date_str": req.date_str}

    if not log:
        log = HabitLog(habit_id=habit_id, date_str=req.date_str, status="completed", value=0.0)

    if req.status:
        log.status = req.status

    if req.set_value is not None:
        log.value = max(0.0, req.set_value)
    elif req.delta_value is not None:
        log.value = max(0.0, log.value + req.delta_value)

    # Auto mark completed if target reached for numeric habit
    if db_habit.habit_type == "numeric":
        if log.value >= db_habit.target_value:
            log.status = "completed"
        elif log.value > 0:
            log.status = "in_progress"

    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/habits/{habit_id}/stats")
def get_habit_stats(habit_id: int, db: DBSession = Depends(get_session)):
    db_habit = db.get(Habit, habit_id)
    if not db_habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    logs = db.exec(select(HabitLog).where(HabitLog.habit_id == habit_id)).all()
    logs.sort(key=lambda x: x.date_str)

    completed_count = sum(1 for l in logs if l.status == "completed")
    failed_count = sum(1 for l in logs if l.status == "failed")
    skipped_count = sum(1 for l in logs if l.status == "skipped")

    history = [{ "date": l.date_str, "value": l.value, "status": l.status } for l in logs[-30:]]

    return {
        "habit": db_habit.model_dump(),
        "summary": {
            "completed": completed_count,
            "failed": failed_count,
            "skipped": skipped_count,
            "total_logs": len(logs)
        },
        "history": history
    }


# Idle Detection API Endpoints
@router.post("/idle/toggle")
def toggle_idle_detection(req: IdleToggleRequest):
    new_state = timer_manager.toggle_idle_detection(req.enabled)
    return {"idle_detection_enabled": new_state}


@router.post("/idle/resolve")
def resolve_idle_gap(req: IdleResolveRequest, db: DBSession = Depends(get_session)):
    gap = timer_manager.pending_idle_gap
    if not gap:
        raise HTTPException(status_code=400, detail="No pending idle gap to resolve.")

    saved_session_data = gap.get("saved_session")
    if saved_session_data and saved_session_data.get("duration_seconds", 0) > 0:
        db_work = SessionModel(
            task_id=saved_session_data.get("task_id"),
            start_time=datetime.fromisoformat(saved_session_data["start_time"]),
            end_time=datetime.fromisoformat(saved_session_data["end_time"]),
            duration_seconds=saved_session_data["duration_seconds"],
            tags=saved_session_data.get("tags") or "#general",
            notes=saved_session_data.get("notes") or ""
        )
        db.add(db_work)
        db.commit()

    idle_start = datetime.fromisoformat(gap["idle_start"])
    idle_end = datetime.fromisoformat(gap["idle_end"])
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


# Analytics API Endpoints
@router.get("/analytics/summary")
def get_analytics_summary(db: DBSession = Depends(get_session)):
    sessions = db.exec(select(SessionModel)).all()
    session_dicts = [s.model_dump() for s in sessions]
    return calculate_tag_summaries(session_dicts)


@router.get("/analytics/detailed")
def get_detailed_analytics(db: DBSession = Depends(get_session)):
    sessions = db.exec(select(SessionModel)).all()
    tasks = db.exec(select(Task)).all()

    session_dicts = []
    for s in sessions:
        s_dict = s.model_dump()
        if s.reflection:
            s_dict["reflection"] = s.reflection.model_dump()
        session_dicts.append(s_dict)

    task_dicts = [t.model_dump() for t in tasks]
    return calculate_detailed_analytics(session_dicts, task_dicts)


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
        db.commit()
        db.refresh(db_session)

        if s.get("reflection"):
            ref_data = s["reflection"]
            habits_str = ref_data.get("habits_completed", "")
            if isinstance(habits_str, list):
                habits_str = ",".join(habits_str)

            db_ref = Reflection(
                session_id=db_session.id,
                energy_level=ref_data.get("energy_level", 3),
                obstacles=ref_data.get("obstacles", ""),
                habits_completed=habits_str
            )
            db.add(db_ref)
            db.commit()

        added_count += 1
    return {"status": "success", "imported_sessions": added_count}


# Task API Endpoints
@router.post("/tasks", response_model=Task, status_code=status.HTTP_201_CREATED)
def create_task(task: TaskCreate, db: DBSession = Depends(get_session)):
    task_dict = task.model_dump(exclude_unset=True)
    if not task_dict.get("color") or task_dict.get("color") == "auto":
        task_dict["color"] = get_auto_color(task_dict["title"])

    db_task = Task.model_validate(task_dict)
    if db_task.created_at and db_task.created_at.tzinfo:
        db_task.created_at = db_task.created_at.astimezone(timezone.utc).replace(tzinfo=None)

    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    if db_task.created_at and not db_task.created_at.tzinfo:
        db_task.created_at = db_task.created_at.replace(tzinfo=timezone.utc)

    return db_task


@router.get("/tasks", response_model=List[Task])
def list_tasks(
    status_filter: Optional[str] = Query(None, alias="status"),
    sort_by: Optional[str] = Query("priority", alias="sort"),
    db: DBSession = Depends(get_session)
):
    query = select(Task)
    if status_filter and status_filter != "all":
        if status_filter == "hide_completed":
            query = query.where(Task.status != "completed")
        else:
            query = query.where(Task.status == status_filter)

    tasks = db.exec(query).all()

    for t in tasks:
        if t.created_at and not t.created_at.tzinfo:
            t.created_at = t.created_at.replace(tzinfo=timezone.utc)

    priority_map = {"high": 4, "medium": 3, "low": 2, "-": 1}

    if sort_by == "priority":
        tasks.sort(
            key=lambda t: (
                priority_map.get(str(t.priority).lower(), 1),
                -t.created_at.timestamp() if t.created_at else 0
            ),
            reverse=True
        )
    elif sort_by == "created_at":
        tasks.sort(key=lambda t: t.created_at or datetime.min)
    elif sort_by == "title":
        tasks.sort(key=lambda t: (t.title or "").lower())
    elif sort_by == "status":
        tasks.sort(key=lambda t: (t.status or "").lower())

    return tasks


@router.put("/tasks/{task_id}", response_model=Task)
def update_task(task_id: int, task_data: TaskUpdate, db: DBSession = Depends(get_session)):
    db_task = db.get(Task, task_id)
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_dict = task_data.model_dump(exclude_unset=True)
    if "title" in update_dict and ("color" not in update_dict or update_dict["color"] == "auto"):
        update_dict["color"] = get_auto_color(update_dict["title"])

    for key, value in update_dict.items():
        setattr(db_task, key, value)

    if db_task.created_at and db_task.created_at.tzinfo:
        db_task.created_at = db_task.created_at.astimezone(timezone.utc).replace(tzinfo=None)

    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    if db_task.created_at and not db_task.created_at.tzinfo:
        db_task.created_at = db_task.created_at.replace(tzinfo=timezone.utc)

    return db_task


@router.delete("/tasks/completed", status_code=status.HTTP_200_OK)
def delete_completed_tasks(db: DBSession = Depends(get_session)):
    completed_tasks = db.exec(select(Task).where(Task.status == "completed")).all()
    count = len(completed_tasks)
    for task in completed_tasks:
        db.delete(task)
    db.commit()
    return {"status": "success", "deleted_count": count}


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: DBSession = Depends(get_session)):
    db_task = db.get(Task, task_id)
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(db_task)
    db.commit()
    return None


# Active Timer API Endpoints
@router.get("/timer/status")
def timer_status(db: DBSession = Depends(get_session)):
    status_data = timer_manager.get_status()
    if status_data.get("task_id") and not status_data.get("task_title"):
        task_obj = db.get(Task, status_data["task_id"])
        if task_obj:
            status_data["task_title"] = task_obj.title
    return status_data


@router.post("/timer/start")
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


@router.post("/timer/split", response_model=SessionModel)
def split_timer(req: TimerSplitRequest, db: DBSession = Depends(get_session)):
    try:
        stopped_session_data = timer_manager.split(new_tags=req.new_tags, new_notes=req.new_notes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    db_session = SessionModel(
        task_id=stopped_session_data["task_id"],
        start_time=stopped_session_data["start_time"],
        end_time=stopped_session_data["end_time"],
        duration_seconds=stopped_session_data["duration_seconds"],
        tags=stopped_session_data["tags"],
        notes=stopped_session_data["notes"]
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session


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


# Session API Endpoints
@router.post("/sessions", response_model=SessionModel, status_code=status.HTTP_201_CREATED)
def create_session(req: SessionCreate, db: DBSession = Depends(get_session)):
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


@router.get("/sessions")
def list_sessions(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: DBSession = Depends(get_session)
):
    query = select(SessionModel)
    if start:
        naive_start = start.astimezone(timezone.utc).replace(tzinfo=None) if start.tzinfo else start
        query = query.where(SessionModel.start_time >= naive_start)
    if end:
        naive_end = end.astimezone(timezone.utc).replace(tzinfo=None) if end.tzinfo else end
        query = query.where(SessionModel.start_time <= naive_end)

    sessions = db.exec(query).all()
    result = []
    for s in sessions:
        s_dict = s.model_dump()
        if s.start_time:
            s_dict["start_time"] = s.start_time.isoformat() if s.start_time.tzinfo else s.start_time.replace(tzinfo=timezone.utc).isoformat()
        if s.end_time:
            s_dict["end_time"] = s.end_time.isoformat() if s.end_time.tzinfo else s.end_time.replace(tzinfo=timezone.utc).isoformat()

        if s.reflection:
            s_dict["reflection"] = s.reflection.model_dump()
        result.append(s_dict)
    return result


@router.put("/sessions/{session_id}", response_model=SessionModel)
def update_session(session_id: int, req: SessionUpdate, db: DBSession = Depends(get_session)):
    db_session = db.get(SessionModel, session_id)
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    update_dict = req.model_dump(exclude_unset=True)
    for key, val in update_dict.items():
        setattr(db_session, key, val)

    if db_session.start_time and db_session.end_time:
        db_session.duration_seconds = max(0, int((db_session.end_time - db_session.start_time).total_seconds()))

    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, db: DBSession = Depends(get_session)):
    db_session = db.get(SessionModel, session_id)
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    reflections = db.exec(select(Reflection).where(Reflection.session_id == session_id)).all()
    for ref in reflections:
        db.delete(ref)

    db.delete(db_session)
    db.commit()
    return None


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


@router.post("/reflections", response_model=Reflection, status_code=status.HTTP_201_CREATED)
def create_reflection(req: ReflectionCreate, db: DBSession = Depends(get_session)):
    session_obj = db.get(SessionModel, req.session_id)
    if not session_obj:
        raise HTTPException(status_code=404, detail="Session ID not found")

    db_reflection = Reflection(
        session_id=req.session_id,
        energy_level=req.energy_level,
        obstacles=req.obstacles,
        habits_completed=",".join(req.habits_completed) if isinstance(req.habits_completed, list) else str(req.habits_completed)
    )
    db.add(db_reflection)
    db.commit()
    db.refresh(db_reflection)
    return db_reflection
