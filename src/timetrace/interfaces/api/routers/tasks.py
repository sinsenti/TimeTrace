from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session as DBSession, select
from typing import List, Optional
from datetime import datetime, timezone

from timetrace.db.session import get_session
from timetrace.db.models import Task, Session as SessionModel, TaskReview, RatingEntry, RatingDefinition
from timetrace.interfaces.api.schemas import TaskCreate, TaskUpdate, TaskReviewCreate
from timetrace.interfaces.api.utils import ensure_utc

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.post("", response_model=Task, status_code=status.HTTP_201_CREATED)
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


@router.get("", response_model=List[Task])
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


@router.put("/{task_id}", response_model=Task)
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


@router.delete("/completed", status_code=status.HTTP_200_OK)
def delete_completed_tasks(db: DBSession = Depends(get_session)):
    completed_tasks = db.exec(select(Task).where(Task.status == "completed")).all()
    count = len(completed_tasks)
    for task in completed_tasks:
        db.delete(task)
    db.commit()
    return {"status": "success", "deleted_count": count}


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: DBSession = Depends(get_session)):
    db_task = db.get(Task, task_id)
    if not db_task:
        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(db_task)
    db.commit()
    return None


@router.get("/{task_id}/stats")
def get_task_statistics(task_id: int, db: DBSession = Depends(get_session)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    sessions = db.exec(select(SessionModel).where(SessionModel.task_id == task_id)).all()
    sessions.sort(key=lambda s: ensure_utc(s.start_time) or datetime.min.replace(tzinfo=timezone.utc))

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


# Task Review Sub-Router
task_reviews_router = APIRouter(prefix="/task-reviews", tags=["Task Reviews"])


@task_reviews_router.post("", response_model=TaskReview, status_code=status.HTTP_201_CREATED)
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


@task_reviews_router.get("/{task_id}")
def get_task_review(task_id: int, db: DBSession = Depends(get_session)):
    review = db.exec(select(TaskReview).where(TaskReview.task_id == task_id)).first()
    if not review:
        return None
    return review
