"""Personal goal settings and authoritative progress reads."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session

from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.services.goal_service import GoalService

router = APIRouter(prefix="/goals", tags=["goals"])
weekly_router = APIRouter(tags=["goals"])


@weekly_router.get("/weekly-review")
def weekly_review(
    week_start: date | None = None,
    timezone: str | None = None,
    first_day_of_week: int = Query(default=1, ge=0, le=6),
    db: Session = Depends(get_session),
):
    return GoalService(db).weekly_review(
        week_start, QueryContextRequest(timezone=timezone, first_day_of_week=first_day_of_week)
    )


class GoalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    operation_id: str = Field(min_length=1, max_length=128)
    owner_kind: Literal["global", "task"]
    task_id: str | None = None
    cadence: Literal["day", "week", "total"]
    enabled: bool = True
    target_seconds: float = Field(gt=0)
    include_descendants: bool = False
    start_date: date | None = None
    timezone: str | None = None
    first_day_of_week: int = Field(default=1, ge=0, le=6)


@router.post("", status_code=201)
def create_goal(request: GoalCreate, db: Session = Depends(get_session)):
    return GoalService(db).create(request)


class GoalEdit(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    operation_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=1)
    target_seconds: float = Field(gt=0)
    enabled: bool = True
    include_descendants: bool = False
    start_date: date | None = None


@router.put("/{goal_id}")
def edit_goal(goal_id: str, request: GoalEdit, db: Session = Depends(get_session)):
    return GoalService(db).edit(goal_id, request)


@router.get("")
def read_goals(period_start: date | None = None, include_disabled: bool = False, db: Session = Depends(get_session)):
    return GoalService(db).read(period_start, include_disabled)
