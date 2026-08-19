from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import PlainTextResponse
from sqlmodel import Session as DBSession

from timetrace.db.session import get_session
from timetrace.services import AnalyticsService

router = APIRouter(tags=["Analytics & Markdown Agenda"])


@router.get("/analytics/summary")
def get_analytics_summary(db: DBSession = Depends(get_session)):
    return AnalyticsService(db).get_summary()


@router.get("/analytics/detailed")
def get_detailed_analytics(db: DBSession = Depends(get_session)):
    return AnalyticsService(db).get_detailed()


@router.get("/markdown/export", response_class=PlainTextResponse)
def export_markdown(db: DBSession = Depends(get_session)):
    return AnalyticsService(db).export_markdown()


@router.post("/markdown/import", status_code=status.HTTP_201_CREATED)
async def import_markdown(request: Request, db: DBSession = Depends(get_session)):
    body_bytes = await request.body()
    content = body_bytes.decode("utf-8")
    added_count = AnalyticsService(db).import_markdown(content)
    return {"status": "success", "imported_sessions": added_count}


@router.get("/api/agenda/export")
def export_agenda_briefing(
    mode: str = Query("sessions", description="Export mode: 'sessions', 'tasks_short', 'tasks_full', 'habits', 'all', 'all_date_range'"),
    start_date: str | None = Query(None, description="Optional YYYY-MM-DD start filter"),
    end_date: str | None = Query(None, description="Optional YYYY-MM-DD end filter"),
    db: DBSession = Depends(get_session)
):
    """Exports structured, scannable Markdown briefing logs without decorative icons."""
    content = AnalyticsService(db).export_agenda_briefing(
        mode=mode, start_date=start_date, end_date=end_date
    )
    filename = f"timetrace_export_{mode}.md"
    return Response(
        content=content,
        media_type="text/markdown",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
