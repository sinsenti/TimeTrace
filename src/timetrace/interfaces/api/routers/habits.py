
from fastapi import APIRouter, Depends, status
from sqlmodel import Session as DBSession

from timetrace.db.models import Habit
from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import HabitCreate, HabitLogRequest, HabitUpdate
from timetrace.services import HabitService

router = APIRouter(prefix="/habits", tags=["Habit Tracker"])


@router.post("", response_model=Habit, status_code=status.HTTP_201_CREATED)
def create_habit(req: HabitCreate, db: DBSession = Depends(get_session)):
    return HabitService(db).create_habit(req)


@router.get("", response_model=list[dict])
def list_habits(db: DBSession = Depends(get_session)):
    return HabitService(db).list_habits()


@router.put("/{habit_id}", response_model=Habit)
def update_habit(habit_id: str, req: HabitUpdate, db: DBSession = Depends(get_session)):
    return HabitService(db).update_habit(habit_id, req)


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(habit_id: str, db: DBSession = Depends(get_session)):
    HabitService(db).delete_habit(habit_id)
    return None


@router.post("/{habit_id}/log")
def log_habit_progress(habit_id: str, req: HabitLogRequest, db: DBSession = Depends(get_session)):
    return HabitService(db).log_progress(habit_id, req)


@router.get("/{habit_id}/stats")
def get_habit_stats(habit_id: str, db: DBSession = Depends(get_session)):
    return HabitService(db).get_stats(habit_id)
