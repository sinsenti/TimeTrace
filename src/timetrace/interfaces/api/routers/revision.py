from fastapi import APIRouter, Depends, Query
from sqlmodel import Session as DBSession, select

from timetrace.db.session import get_session
from timetrace.db.models import Task, Session as SessionModel, DayReview, RatingEntry, RatingDefinition
from timetrace.interfaces.api.schemas import DayReviewCreate
from timetrace.interfaces.api.utils import ensure_utc

router = APIRouter(prefix="/revision", tags=["Revision Engine"])


@router.get("/day-history")
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
            "has_review": rev is not None and not rev.review_skipped,
            "review_skipped": rev.review_skipped if rev else False,
            "rating": rev.rating if rev else None,
            "highlights": rev.highlights if rev else None,
            "friction": rev.friction if rev else None
        })

    return history


@router.get("/day-summary")
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


@router.post("/day-review", response_model=DayReview)
def save_day_review(req: DayReviewCreate, db: DBSession = Depends(get_session)):
    existing = db.exec(select(DayReview).where(DayReview.date_str == req.date_str)).first()
    if existing:
        existing.rating = req.rating
        existing.highlights = req.highlights
        existing.friction = req.friction
        existing.notes = req.notes
        existing.review_skipped = req.review_skipped
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing
    else:
        review = DayReview(
            date_str=req.date_str,
            rating=req.rating,
            highlights=req.highlights,
            friction=req.friction,
            notes=req.notes,
            review_skipped=req.review_skipped
        )
        db.add(review)
        db.commit()
        db.refresh(review)
        return review
