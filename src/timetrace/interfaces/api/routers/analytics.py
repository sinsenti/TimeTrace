from datetime import date
from fastapi import APIRouter, Depends, status, Request
from fastapi.responses import PlainTextResponse
from sqlmodel import Session as DBSession, select

from timetrace.db.session import get_session
from timetrace.db.models import Task, Session as SessionModel
from timetrace.core.parser import export_sessions_to_markdown, parse_markdown_to_sessions
from timetrace.core.analytics import calculate_tag_summaries, calculate_detailed_analytics
from timetrace.interfaces.api.utils import ensure_utc

router = APIRouter(tags=["Analytics & Markdown"])


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
