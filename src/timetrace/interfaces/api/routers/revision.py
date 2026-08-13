from fastapi import APIRouter, Depends, Query
from sqlmodel import Session as DBSession

from timetrace.db.models import DayReview
from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import DayReviewCreate
from timetrace.services import RevisionService

router = APIRouter(prefix="/revision", tags=["Revision Engine"])


@router.get("/day-history")
def get_day_history_overview(db: DBSession = Depends(get_session)):
    return RevisionService(db).get_day_history_overview()


@router.get("/day-summary")
def get_day_summary(date_str: str = Query(..., description="YYYY-MM-DD"), db: DBSession = Depends(get_session)):
    return RevisionService(db).get_day_summary(date_str)


@router.post("/day-review", response_model=DayReview)
def save_day_review(req: DayReviewCreate, db: DBSession = Depends(get_session)):
    return RevisionService(db).save_day_review(req)
