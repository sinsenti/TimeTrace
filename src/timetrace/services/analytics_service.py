from datetime import date
from typing import Any

from sqlmodel import Session, select

from timetrace.core.analytics import calculate_detailed_analytics, calculate_tag_summaries
from timetrace.core.parser import export_sessions_to_markdown, parse_markdown_to_sessions
from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task
from timetrace.interfaces.api.utils import ensure_utc


class AnalyticsService:
    def __init__(self, db: Session):
        self.db = db

    def get_summary() -> list[dict[str, Any]]:
        sessions = self.db.exec(select(SessionModel)).all()
        session_dicts = [s.model_dump() for s in sessions]
        return calculate_tag_summaries(session_dicts)

    def get_detailed() -> dict[str, Any]:
        sessions = self.db.exec(select(SessionModel)).all()
        tasks = self.db.exec(select(Task)).all()

        session_dicts = []
        for s in sessions:
            s_dict = s.model_dump()
            s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
            s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
            session_dicts.append(s_dict)

        task_dicts = [t.model_dump() for t in tasks]
        return calculate_detailed_analytics(session_dicts, task_dicts)

    def export_markdown() -> str:
        sessions = self.db.exec(select(SessionModel)).all()
        session_dicts = []
        for s in sessions:
            s_dict = s.model_dump()
            s_dict["start_time"] = ensure_utc(s.start_time).isoformat() if s.start_time else None
            s_dict["end_time"] = ensure_utc(s.end_time).isoformat() if s.end_time else None
            session_dicts.append(s_dict)

        return export_sessions_to_markdown(session_dicts, date.today())

    def import_markdown(self, content: str) -> int:
        parsed_sessions = parse_markdown_to_sessions(content)
        added_count = 0
        for s in parsed_sessions:
            db_session = SessionModel(
                start_time=ensure_utc(s["start_time"]),
                end_time=ensure_utc(s["end_time"]),
                duration_seconds=s["duration_seconds"],
                tags=s["tags"],
                notes=s["notes"],
            )
            self.db.add(db_session)
            self.db.commit()
            self.db.refresh(db_session)
            added_count += 1
        return added_count
