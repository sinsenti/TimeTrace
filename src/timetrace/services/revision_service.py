from typing import Any

from sqlmodel import Session, select

from timetrace.db.models import DayReview, RatingDefinition, RatingEntry, Task
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import DayReviewCreate
from timetrace.interfaces.api.utils import ensure_utc


class RevisionService:
    def __init__(self, db: Session):
        self.db = db

    def get_day_history_overview(self) -> list[dict[str, Any]]:
        sessions = self.db.exec(select(SessionModel)).all()
        reviews = self.db.exec(select(DayReview)).all()
        reviews_map = {r.date_str: r for r in reviews}

        day_stats: dict[str, dict[str, int]] = {}
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
                "friction": rev.friction if rev else None,
            })

        return history

    def get_day_summary(self, date_str: str) -> dict[str, Any]:
        sessions = self.db.exec(select(SessionModel)).all()
        matching_sessions = []

        for s in sessions:
            if s.start_time:
                local_dt = ensure_utc(s.start_time).astimezone()
                if local_dt.strftime("%Y-%m-%d") == date_str:
                    matching_sessions.append(s)

        tasks = self.db.exec(select(Task)).all()
        tasks_map = {t.id: t for t in tasks}

        completed_tasks = [
            t for t in tasks
            if (
                t.status == "completed"
                and t.created_at
                and ensure_utc(t.created_at).astimezone().strftime("%Y-%m-%d") == date_str
            )
        ]

        total_seconds = sum(s.duration_seconds or 0 for s in matching_sessions)
        saved_review = self.db.exec(select(DayReview).where(DayReview.date_str == date_str)).first()

        session_details = []
        for s in matching_sessions:
            s_dict = s.model_dump()
            s_dict["task"] = tasks_map.get(s.task_id).model_dump() if s.task_id and s.task_id in tasks_map else None
            session_details.append(s_dict)

        day_ratings = self.db.exec(
            select(RatingEntry).where(RatingEntry.target_type == "day", RatingEntry.target_id == date_str)
        ).all()

        ratings_detailed = []
        for r in day_ratings:
            r_def = self.db.get(RatingDefinition, r.rating_definition_id)
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
            "custom_ratings": ratings_detailed,
        }

    def save_day_review(self, req: DayReviewCreate) -> DayReview:
        existing = self.db.exec(select(DayReview).where(DayReview.date_str == req.date_str)).first()
        effective_rating = req.rating if req.rating is not None else 3

        if existing:
            existing.rating = effective_rating
            existing.highlights = req.highlights or ""
            existing.friction = req.friction or ""
            existing.notes = req.notes or ""
            existing.review_skipped = bool(req.review_skipped)
            self.db.add(existing)
            self.db.commit()
            self.db.refresh(existing)
            return existing
        else:
            review = DayReview(
                date_str=req.date_str,
                rating=effective_rating,
                highlights=req.highlights or "",
                friction=req.friction or "",
                notes=req.notes or "",
                review_skipped=bool(req.review_skipped),
            )
            self.db.add(review)
            self.db.commit()
            self.db.refresh(review)
            return review
