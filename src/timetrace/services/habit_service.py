from datetime import datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError
from timetrace.db.models import Habit, HabitLog
from timetrace.interfaces.api.schemas import HabitCreate, HabitLogRequest, HabitUpdate


class HabitService:
    def __init__(self, db: Session):
        self.db = db

    def create_habit(self, req: HabitCreate) -> Habit:
        db_habit = Habit.model_validate(req.model_dump())
        self.db.add(db_habit)
        self.db.commit()
        self.db.refresh(db_habit)
        return db_habit

    def list_habits(self) -> list[dict[str, Any]]:
        habits = self.db.exec(select(Habit)).all()
        today_dt = datetime.now().date()

        # Fetch 365 days of history to support historical week-by-week navigation and editing
        start_date_str = (today_dt - timedelta(days=365)).strftime("%Y-%m-%d")
        logs = self.db.exec(select(HabitLog).where(HabitLog.date_str >= start_date_str)).all()

        log_map: dict[int, dict[str, Any]] = {}
        for log_entry in logs:
            if log_entry.habit_id not in log_map:
                log_map[log_entry.habit_id] = {}
            log_map[log_entry.habit_id][log_entry.date_str] = log_entry.model_dump()

        result = []
        for h in habits:
            h_dict = h.model_dump()
            h_dict["logs"] = log_map.get(h.id, {})
            result.append(h_dict)

        return result

    def update_habit(self, habit_id: int, req: HabitUpdate) -> Habit:
        db_habit = self.db.get(Habit, habit_id)
        if not db_habit:
            raise EntityNotFoundError("Habit", habit_id)

        update_dict = req.model_dump(exclude_unset=True)
        for k, v in update_dict.items():
            setattr(db_habit, k, v)

        self.db.add(db_habit)
        self.db.commit()
        self.db.refresh(db_habit)
        return db_habit

    def delete_habit(self, habit_id: int) -> None:
        db_habit = self.db.get(Habit, habit_id)
        if not db_habit:
            raise EntityNotFoundError("Habit", habit_id)

        self.db.delete(db_habit)
        self.db.commit()

    def log_progress(self, habit_id: int, req: HabitLogRequest) -> dict[str, Any] | HabitLog:
        db_habit = self.db.get(Habit, habit_id)
        if not db_habit:
            raise EntityNotFoundError("Habit", habit_id)

        log = self.db.exec(
            select(HabitLog).where(HabitLog.habit_id == habit_id, HabitLog.date_str == req.date_str)
        ).first()

        if req.status == "erase":
            if log:
                self.db.delete(log)
                self.db.commit()
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
            else:
                log.status = "pending"

        self.db.add(log)
        self.db.commit()
        self.db.refresh(log)
        return log

    def get_stats(self, habit_id: int) -> dict[str, Any]:
        db_habit = self.db.get(Habit, habit_id)
        if not db_habit:
            raise EntityNotFoundError("Habit", habit_id)

        logs = self.db.exec(select(HabitLog).where(HabitLog.habit_id == habit_id)).all()
        logs.sort(key=lambda x: x.date_str)

        completed_count = sum(1 for log_item in logs if log_item.status == "completed")
        failed_count = sum(1 for log_item in logs if log_item.status == "failed")
        skipped_count = sum(1 for log_item in logs if log_item.status == "skipped")

        history = [
            {"date": log_item.date_str, "value": log_item.value, "status": log_item.status}
            for log_item in logs[-30:]
        ]

        return {
            "habit": db_habit.model_dump(),
            "summary": {
                "completed": completed_count,
                "failed": failed_count,
                "skipped": skipped_count,
                "total_logs": len(logs),
            },
            "history": history,
        }
