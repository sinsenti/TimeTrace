from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.analytics import calculate_day_breakdowns
from timetrace.core.exceptions import ValidationError
from timetrace.core.timezones import daemon_tzinfo
from timetrace.db.models import DayReview, RatingDefinition, RatingEntry, Task
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import DayReviewCreate
from timetrace.interfaces.api.utils import ensure_utc


class RevisionService:
    def __init__(self, db: Session):
        self.db = db

    def list_day_reviews(
        self,
        *,
        start_date: str,
        end_date: str,
        include_skipped: bool = False,
        limit: int = 100,
    ) -> dict[str, Any]:
        """List reviews by their local calendar date, not by creation timestamp."""
        try:
            start = date.fromisoformat(start_date)
            end = date.fromisoformat(end_date)
        except (TypeError, ValueError) as exc:
            raise ValidationError("start_date and end_date must use YYYY-MM-DD") from exc
        if start.isoformat() != start_date or end.isoformat() != end_date:
            raise ValidationError("start_date and end_date must use YYYY-MM-DD")
        if end < start:
            raise ValidationError("end_date must not be before start_date")
        if (end - start).days + 1 > 730:
            raise ValidationError("day review date range cannot exceed 730 days")
        try:
            requested_limit = int(limit)
        except (TypeError, ValueError) as exc:
            raise ValidationError("limit must be an integer") from exc
        limit = max(1, min(requested_limit, 500))
        query = select(DayReview).where(
            DayReview.date_str >= start.isoformat(),
            DayReview.date_str <= end.isoformat(),
        )
        if not include_skipped:
            query = query.where(DayReview.review_skipped.is_(False))
        reviews = list(self.db.exec(query.order_by(DayReview.date_str).limit(limit + 1)).all())
        truncated = len(reviews) > limit
        reviews = reviews[:limit]
        return {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "include_skipped": include_skipped,
            "reviews": [self._day_review_dict(review) for review in reviews],
            "truncated": truncated,
            "warnings": ["Day reviews were limited; request a narrower range."] if truncated else [],
        }

    @staticmethod
    def _json_serializable(value: Any) -> Any:
        if isinstance(value, datetime):
            return ensure_utc(value).isoformat()
        if isinstance(value, dict):
            return {key: RevisionService._json_serializable(item) for key, item in value.items()}
        if isinstance(value, list):
            return [RevisionService._json_serializable(item) for item in value]
        return value

    @staticmethod
    def _day_review_dict(review: DayReview) -> dict[str, Any]:
        return {
            "id": review.id,
            "date": review.date_str,
            "date_str": review.date_str,
            "rating": review.rating,
            "highlights": review.highlights or "",
            "friction": review.friction or "",
            "notes": review.notes or "",
            "review_skipped": bool(review.review_skipped),
            "created_at": ensure_utc(review.created_at).isoformat() if review.created_at else None,
        }

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

        today_str = datetime.now().astimezone().strftime("%Y-%m-%d")
        all_dates = set(day_stats.keys()).union(set(reviews_map.keys()))
        
        # Exclude future days that have not yet passed
        past_or_current_dates = [d for d in all_dates if d <= today_str]

        history = []
        for d_str in sorted(past_or_current_dates, reverse=True):
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
        try:
            day = date.fromisoformat(date_str)
        except (TypeError, ValueError) as e:
            raise ValidationError(f"Invalid date_str '{date_str}': expected YYYY-MM-DD") from e
        if day.isoformat() != date_str:
            raise ValidationError(f"Invalid date_str '{date_str}': expected YYYY-MM-DD")

        # Local calendar day, by session start time
        local_tz = daemon_tzinfo()
        start_local = datetime.combine(day, time.min, local_tz)
        end_local = start_local + timedelta(days=1)
        start_utc = start_local.astimezone(UTC).replace(tzinfo=None)
        end_utc = end_local.astimezone(UTC).replace(tzinfo=None)

        matching_sessions = self.db.exec(
            select(SessionModel).where(
                SessionModel.start_time >= start_utc,
                SessionModel.start_time < end_utc,
            )
        ).all()

        task_ids = {s.task_id for s in matching_sessions if s.task_id}
        tasks_map: dict[str, Task] = {}
        if task_ids:
            tasks_map = {t.id: t for t in self.db.exec(select(Task).where(Task.id.in_(task_ids))).all()}

        completed_tasks = self.db.exec(
            select(Task).where(
                Task.status.in_(("Done", "completed", "done")),
                Task.created_at >= start_utc,
                Task.created_at < end_utc,
            )
        ).all()

        total_seconds = sum(s.duration_seconds or 0 for s in matching_sessions)
        saved_review = self.db.exec(select(DayReview).where(DayReview.date_str == date_str)).first()

        session_details = []
        for s in matching_sessions:
            s_dict = self._json_serializable(s.model_dump())
            s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
            s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
            s_dict["task"] = (
                self._json_serializable(tasks_map[s.task_id].model_dump())
                if s.task_id and s.task_id in tasks_map
                else None
            )
            session_details.append(s_dict)

        day_ratings = self.db.exec(
            select(RatingEntry).where(RatingEntry.target_type == "day", RatingEntry.target_id == date_str)
        ).all()

        ratings_detailed = []
        for r in day_ratings:
            r_def = self.db.get(RatingDefinition, r.rating_definition_id)
            r_dict = self._json_serializable(r.model_dump())
            r_dict["definition"] = self._json_serializable(r_def.model_dump()) if r_def else None
            ratings_detailed.append(r_dict)

        task_titles = {tid: t.title for tid, t in tasks_map.items()}
        breakdowns = calculate_day_breakdowns([s.model_dump() for s in matching_sessions], task_titles)

        return {
            "date_str": date_str,
            "total_hours": round(total_seconds / 3600.0, 2),
            "total_sessions": len(matching_sessions),
            "completed_tasks_count": len(completed_tasks),
            "sessions": session_details,
            "day_review": self._json_serializable(saved_review.model_dump()) if saved_review else None,
            "custom_ratings": ratings_detailed,
            "tag_breakdown": breakdowns["tag_breakdown"],
            "task_breakdown": breakdowns["task_breakdown"],
            "tag_attribution": "fanout",
        }

    def delete_day_review(self, date_str: str) -> None:
        """Delete a review by its natural local-date key (used only for AI undo)."""
        try:
            parsed = date.fromisoformat(date_str)
        except (TypeError, ValueError) as exc:
            raise ValidationError("date_str must use YYYY-MM-DD") from exc
        if parsed.isoformat() != date_str:
            raise ValidationError("date_str must use YYYY-MM-DD")
        review = self.db.exec(select(DayReview).where(DayReview.date_str == date_str)).first()
        if review is not None:
            self.db.delete(review)
            self.db.commit()

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
