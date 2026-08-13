from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import PlainTextResponse
from sqlmodel import Session as DBSession

from timetrace.db.session import get_session
from timetrace.services import AnalyticsService

router = APIRouter(tags=["Analytics & Markdown"])


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
