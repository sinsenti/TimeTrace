from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session as DBSession, select
from typing import List

from timetrace.db.session import get_session
from timetrace.db.models import Habit, HabitLog
from timetrace.interfaces.api.schemas import HabitCreate, HabitUpdate, HabitLogRequest

router = APIRouter(prefix="/habits", tags=["Habit Tracker"])


@router.post("", response_model=Habit, status_code=status.HTTP_201_CREATED)
def create_habit(req: HabitCreate, db: DBSession = Depends(get_session)):
    db_habit = Habit.model_validate(req.model_dump())
    db.add(db_habit)
    db.commit()
    db.refresh(db_habit)
    return db_habit


@router.get("", response_model=List[dict])
def list_habits(db: DBSession = Depends(get_session)):
    habits = db.exec(select(Habit)).all()
    today_dt = datetime.now().date()
    
    start_date_str = (today_dt - timedelta(days=13)).strftime("%Y-%m-%d")
    logs = db.exec(select(HabitLog).where(HabitLog.date_str >= start_date_str)).all()

    log_map = {}
    for l in logs:
        if l.habit_id not in log_map:
            log_map[l.habit_id] = {}
        log_map[l.habit_id][l.date_str] = l.model_dump()

    result = []
    for h in habits:
        h_dict = h.model_dump()
        h_dict["logs"] = log_map.get(h.id, {})
        result.append(h_dict)

    return result


@router.put("/{habit_id}", response_model=Habit)
def update_habit(habit_id: int, req: HabitUpdate, db: DBSession = Depends(get_session)):
    db_habit = db.get(Habit, habit_id)
    if not db_habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    update_dict = req.model_dump(exclude_unset=True)
    for k, v in update_dict.items():
        setattr(db_habit, k, v)

    db.add(db_habit)
    db.commit()
    db.refresh(db_habit)
    return db_habit


@router.delete("/{habit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_habit(habit_id: int, db: DBSession = Depends(get_session)):
    db_habit = db.get(Habit, habit_id)
    if not db_habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    db.delete(db_habit)
    db.commit()
    return None


@router.post("/{habit_id}/log")
def log_habit_progress(habit_id: int, req: HabitLogRequest, db: DBSession = Depends(get_session)):
    db_habit = db.get(Habit, habit_id)
    if not db_habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    log = db.exec(select(HabitLog).where(HabitLog.habit_id == habit_id, HabitLog.date_str == req.date_str)).first()

    if req.status == "erase":
        if log:
            db.delete(log)
            db.commit()
        return {"status": "erased", "date_str": req.date_str}

    if not log:
        log = HabitLog(habit_id=habit_id, date_str=req.date_str, status="completed", value=0.0)

    if req.status:
        log.status = req.status

    if req.set_value is not None:
        log.value = max(0.0, req.set_value)
    elif req.delta_value is not None:
        log.value = max(0.0, log.value + req.delta_value)

    if db_habit.habit_type == "numeric":
        if log.value >= db_habit.target_value:
            log.status = "completed"
        elif log.value > 0:
            log.status = "in_progress"

    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/{habit_id}/stats")
def get_habit_stats(habit_id: int, db: DBSession = Depends(get_session)):
    db_habit = db.get(Habit, habit_id)
    if not db_habit:
        raise HTTPException(status_code=404, detail="Habit not found")

    logs = db.exec(select(HabitLog).where(HabitLog.habit_id == habit_id)).all()
    logs.sort(key=lambda x: x.date_str)

    completed_count = sum(1 for l in logs if l.status == "completed")
    failed_count = sum(1 for l in logs if l.status == "failed")
    skipped_count = sum(1 for l in logs if l.status == "skipped")

    history = [{ "date": l.date_str, "value": l.value, "status": l.status } for l in logs[-30:]]

    return {
        "habit": db_habit.model_dump(),
        "summary": {
            "completed": completed_count,
            "failed": failed_count,
            "skipped": skipped_count,
            "total_logs": len(logs)
        },
        "history": history
    }
