import os
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import FileResponse, PlainTextResponse
from sqlmodel import Session as DBSession, select
from typing import List, Optional
from datetime import datetime, date, timezone, timedelta

from timetrace.db.session import get_session
from timetrace.db.models import (
    Task, Session as SessionModel, TaskReview,
    DayReview, RatingDefinition, RatingEntry, Habit, HabitLog
)
from timetrace.core.timer import timer_manager
from timetrace.core.parser import export_sessions_to_markdown, parse_markdown_to_sessions
from timetrace.core.analytics import calculate_tag_summaries, calculate_detailed_analytics
from timetrace.interfaces.api.schemas import (
    TaskCreate, TaskUpdate, SessionCreate, SessionUpdate,
    TimerStartRequest, TimerSplitRequest, DayReviewCreate,
    TaskReviewCreate, RatingDefinitionCreate, RatingDefinitionUpdate,
    RatingEntryCreate, RetroSessionCreate, IdleToggleRequest,
    IdleResolveRequest, HabitCreate, HabitUpdate, HabitLogRequest
)

router = APIRouter()
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


def ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


# Static Web Routes
@router.get("/dashboard", response_class=FileResponse)
def get_web_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@router.get("/stats", response_class=FileResponse)
def get_stats_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "stats.html"))


@router.get("/habits-view", response_class=FileResponse)
def get_habits_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "habits.html"))


@router.get("/revision", response_class=FileResponse)
def get_revision_dashboard():
    return FileResponse(os.path.join(STATIC_DIR, "revision.html"))


@router.get("/static/{file_path:path}")
def get_static_file(file_path: str):
    full_path = os.path.join(STATIC_DIR, file_path)
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return FileResponse(full_path)
    raise HTTPException(status_code=404, detail="Static asset not found")


# Day Revisions History Overview Endpoint
@router.get("/revision/day-history")
def get_day_history_overview(db: DBSession = Depends(get_session)):
    sessions = db.exec(select(SessionModel)).all()
    reviews = db.exec(select(DayReview)).all()
    reviews_map = {r.date_str: r for r in reviews}

    day_stats = {}
    for s in sessions:
        if s.start_time:
            local_dt = ensure_utc(s.start_time).astimezone()
            d_str = local_dt.strftime("%Y-%m-%d")
            if d_str not in day_stats:
                day_stats[d_str] = {"total_seconds": 0, "session_count": 0}
            day_stats[d_str]["total_seconds"] += s.duration_seconds or 0
            day_stats[d_str]["session_count"] += 1

    all_dates = set(day_stats.keys()).union(set(reviews_map.keys()))

    history = []
    for d_str in sorted(all_dates, reverse=True):
        stats = day_stats.get(d_str, {"total_seconds": 0, "session_count": 0})
        rev = reviews_map.get(d_str)
        history.append({
            "date_str": d_str,
            "total_hours": round(stats["total_seconds"] / 3600.0, 2),
            "session_count": stats["session_count"],
            "has_review": rev is not None,
            "rating": rev.rating if rev else None,
            "wins": rev.wins if rev else None,
            "blockers": rev.blockers if rev else None
        })

    return history


# Custom Rating Definitions & Entries API
@router.post("/rating-definitions", response_model=RatingDefinition, status_code=status.HTTP_201_CREATED)
def create_rating_definition(req: RatingDefinitionCreate, db: DBSession = Depends(get_session)):
    db_def = RatingDefinition.model_validate(req.model_dump())
    db.add(db_def)
    db.commit()
    db.refresh(db_def)
    return db_def


@router.get("/rating-definitions", response_model=List[RatingDefinition])
def list_rating_definitions(
    target_type: Optional[str] = Query(None),
    db: DBSession = Depends(get_session)
):
    query = select(RatingDefinition)
    if target_type:
        query = query.where(RatingDefinition.target_type == target_type)
    return db.exec(query).all()


@router.put("/rating-definitions/{def_id}", response_model=RatingDefinition)
def update_rating_definition(def_id: int, req: RatingDefinitionUpdate, db: DBSession = Depends(get_session)):
    db_def = db.get(RatingDefinition, def_id)
    if not db_def:
        raise HTTPException(status_code=404, detail="Rating definition not found")
    
    update_dict = req.model_dump(exclude_unset=True)
    for k, v in update_dict.items():
        setattr(db_def, k, v)
    
    db.add(db_def)
    db.commit()
    db.refresh(db_def)
    return db_def


@router.delete("/rating-definitions/{def_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rating_definition(def_id: int, db: DBSession = Depends(get_session)):
    db_def = db.get(RatingDefinition, def_id)
    if not db_def:
        raise HTTPException(status_code=404, detail="Rating definition not found")
    
    entries = db.exec(select(RatingEntry).where(RatingEntry.rating_definition_id == def_id)).all()
    for entry in entries:
        db.delete(entry)
        
    db.delete(db_def)
    db.commit()
    return None


@router.post("/rating-entries", response_model=RatingEntry, status_code=status.HTTP_201_CREATED)
def create_rating_entry(req: RatingEntryCreate, db: DBSession = Depends(get_session)):
    db_def = db.get(RatingDefinition, req.rating_definition_id)
    if not db_def:
        raise HTTPException(status_code=404, detail="Rating definition ID not found")

    if req.score < db_def.min_score or req.score > db_def.max_score:
        raise HTTPException(
            status_code=400,
            detail=f"Score must be between {db_def.min_score} and {db_def.max_score}"
        )

    existing = db.exec(
        select(RatingEntry).where(
            RatingEntry.rating_definition_id == req.rating_definition_id,
            RatingEntry.target_type == req.target_type,
            RatingEntry.target_id == str(req.target_id)
        )
    ).first()

    if existing:
        existing.score = req.score
        existing.notes = req.notes
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing
    else:
        entry = RatingEntry.model_validate(req.model_dump())
        entry.target_id = str(req.target_id)
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry


@router.get("/rating-entries")
def get_rating_entries(
    target_type: str = Query(...),
    target_id: str = Query(...),
    db: DBSession = Depends(get_session)
):
    entries = db.exec(
        select(RatingEntry).where(
            RatingEntry.target_type == target_type,
            RatingEntry.target_id == str(target_id)
        )
    ).all()

    result = []
    for e in entries:
        r_def = db.get(RatingDefinition, e.rating_definition_id)
        e_dict = e.model_dump()
        e_dict["definition"] = r_def.model_dump() if r_def else None
        result.append(e_dict)
    return result


# Task Review API Endpoints
@router.post("/task-reviews", response_model=TaskReview, status_code=status.HTTP_201_CREATED)
def create_or_update_task_review(req: TaskReviewCreate, db: DBSession = Depends(get_session)):
    task = db.get(Task, req.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    existing = db.exec(select(TaskReview).where(TaskReview.task_id == req.task_id)).first()
    if existing:
        existing.difficulty = req.difficulty
        existing.what_went_well = req.what_went_well
        existing.blockers = req.blockers
        existing.key_takeaways = req.key_takeaways
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing
    else:
        review = TaskReview.model_validate(req.model_dump())
        db.add(review)
        db.commit()
        db.refresh(review)
        return review


@router.get("/task-reviews/{task_id}")
def get_task_review(task_id: int, db: DBSession = Depends(get_session)):
    review = db.exec(select(TaskReview).where(TaskReview.task_id == task_id)).first()
    if not review:
        return None
    return review


# Day Review & Revision API Endpoints
@router.get("/revision/day-summary")
def get_day_summary(date_str: str = Query(..., description="YYYY-MM-DD"), db: DBSession = Depends(get_session)):
    sessions = db.exec(select(SessionModel)).all()
    matching_sessions = []
    
    for s in sessions:
        if s.start_time:
            local_dt = ensure_utc(s.start_time).astimezone()
            if local_dt.strftime("%Y-%m-%d") == date_str:
                matching_sessions.append(s)

    tasks = db.exec(select(Task)).all()
    tasks_map = {t.id: t for t in tasks}

    completed_tasks = [t for t in tasks if t.status == "completed" and t.created_at and ensure_utc(t.created_at).astimezone().strftime("%Y-%m-%d") == date_str]

    total_seconds = sum(s.duration_seconds or 0 for s in matching_sessions)
    saved_review = db.exec(select(DayReview).where(DayReview.date_str == date_str)).first()

    session_details = []
    for s in matching_sessions:
        s_dict = s.model_dump()
        s_dict["task"] = tasks_map.get(s.task_id).model_dump() if s.task_id and s.task_id in tasks_map else None
        session_details.append(s_dict)

    day_ratings = db.exec(
        select(RatingEntry).where(RatingEntry.target_type == "day", RatingEntry.target_id == date_str)
    ).all()
    
    ratings_detailed = []
    for r in day_ratings:
        r_def = db.get(RatingDefinition, r.rating_definition_id)
        r_dict = r.model_dump()
        r_dict["definition"] = r_def.model_dump() if r_def else None
        ratings_detailed.append(r_dict)

    return {
        "date_str": date_str,
        "total_hours": round(total_seconds / 3600.0, 2),
        "total_sessions": len(matching_sessions),
        "completed_tasks_count": len(completed_tasks),
        "sessions": session_details,
        "day_review": saved_review.model_dump() if saved_review else None,
        "custom_ratings": ratings_detailed
    }


@router.post("/revision/day-review", response_model=DayReview)
def save_day_review(req: DayReviewCreate, db: DBSession = Depends(get_session)):
    existing = db.exec(select(DayReview).where(DayReview.date_str == req.date_str)).first()
    if existing:
        existing.rating = req.rating
        existing.wins = req.wins
        existing.blockers = req.blockers
        existing.notes = req.notes
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing
    else:
        review = DayReview(
            date_str=req.date_str,
            rating=req.rating,
            wins=req.wins,
            blockers=req.blockers,
            notes=req.notes
        )
        db.add(review)
        db.commit()
        db.refresh(review)
        return review


# Task Statistics Inspector Endpoint
@router.get("/tasks/{task_id}/stats")
def get_task_statistics(task_id: int, db: DBSession = Depends(get_session)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    sessions = db.exec(select(SessionModel).where(SessionModel.task_id == task_id)).all()
    sessions.sort(key=lambda s: s.start_time or datetime.min)

    total_seconds = sum(s.duration_seconds or 0 for s in sessions)
    total_hours = round(total_seconds / 3600.0, 2)

    est_minutes = task.estimated_minutes or 0
    est_hours = round(est_minutes / 60.0, 2)
    progress_pct = round((total_seconds / (est_minutes * 60)) * 100, 1) if est_minutes > 0 else None

    session_list = []
    for s in sessions:
        s_dict = s.model_dump()
        s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
        s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
        session_list.append(s_dict)

    review = db.exec(select(TaskReview).where(TaskReview.task_id == task_id)).first()

    task_ratings = db.exec(
        select(RatingEntry).where(RatingEntry.target_type == "task", RatingEntry.target_id == str(task_id))
    ).all()
    
    ratings_detailed = []
    for r in task_ratings:
        r_def = db.get(RatingDefinition, r.rating_definition_id)
        r_dict = r.model_dump()
        r_dict["definition"] = r_def.model_dump() if r_def else None
        ratings_detailed.append(r_dict)

    return {
        "task": task.model_dump(),
        "total_hours": total_hours,
        "total_sessions": len(sessions),
        "estimated_hours": est_hours,
        "progress_pct": progress_pct,
        "sessions": session_list,
        "task_review": review.model_dump() if review else None,
        "custom_ratings": ratings_detailed
    }


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
        s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
        s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
        session_dicts.append(s_dict)

    task_dicts = [t.model_dump() for t in tasks]
    return calculate_detailed_analytics(session_dicts, task_dicts)


@router.get("/markdown/export", response_class=PlainTextResponse)
def export_markdown(db: DBSession = Depends(get_session)):
    sessions = db.exec(select(SessionModel)).all()
    session_dicts = []
    for s in sessions:
        s_dict = s.model_dump()
        s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
        s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
        session_dicts.append(s_dict)

    return export_sessions_to_markdown(session_dicts, date.today())


@router.post("/markdown/import", status_code=status.HTTP_201_CREATED)
async def import_markdown(request: Request, db: DBSession = Depends(get_session)):
    body_bytes = await request.body()
    content = body_bytes.decode("utf-8")
    
    parsed_sessions = parse_markdown_to_sessions(content)
    added_count = 0
    for s in parsed_sessions:
        db_session = SessionModel(
            start_time=ensure_utc(s["start_time"]),
            end_time=ensure_utc(s["end_time"]),
            duration_seconds=s["duration_seconds"],
            tags=s["tags"],
            notes=s["notes"]
        )
        db.add(db_session)
        db.commit()
        db.refresh(db_session)
        added_count += 1
    return {"status": "success", "imported_sessions": added_count}


# Task API Endpoints
@router.post("/tasks", response_model=Task, status_code=status.HTTP_201_CREATED)
def create_task(task: TaskCreate, db: DBSession = Depends(get_session)):
    task_dict = task.model_dump(exclude_unset=True)
    if not task_dict.get("color"):
        task_dict["color"] = "auto"

    db_task = Task.model_validate(task_dict)
    if db_task.created_at:
        db_task.created_at = ensure_utc(db_task.created_at).replace(tzinfo=None)

    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    db_task.created_at = ensure_utc(db_task.created_at)
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
        t.created_at = ensure_utc(t.created_at)

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
        tasks.sort(key=lambda t: t.created_at or datetime.min.replace(tzinfo=timezone.utc))
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

    for key, value in update_dict.items():
        setattr(db_task, key, value)

    if db_task.created_at:
        db_task.created_at = ensure_utc(db_task.created_at).replace(tzinfo=None)

    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    db_task.created_at = ensure_utc(db_task.created_at)
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


@router.post("/timer/stop", response_model=SessionModel)
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


# Session API Endpoints
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
        notes=req.notes
    )
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    db_session.start_time = ensure_utc(db_session.start_time)
    db_session.end_time = ensure_utc(db_session.end_time)
    return db_session


@router.get("/sessions")
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
