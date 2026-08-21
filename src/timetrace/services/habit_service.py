from datetime import datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError
from timetrace.db.models import Habit, HabitGoalHistory, HabitLog
from timetrace.interfaces.api.schemas import HabitCreate, HabitLogRequest, HabitUpdate


class HabitService:
    def __init__(self, db: Session):
        self.db = db

    def create_habit(self, req: HabitCreate) -> Habit:
        # UUIDv7 ids are assigned client-side at construction (default_factory), not
        # by the DB on insert, so db_habit.id is already usable here for the FK below.
        db_habit = Habit.model_validate(req.model_dump())
        self.db.add(db_habit)
        self.db.add(HabitGoalHistory(
            habit_id=db_habit.id,
            target_value=db_habit.target_value,
            effective_from=datetime.now().strftime("%Y-%m-%d"),
        ))
        # One commit, matching every other create-path in this file: a second
        # commit expires db_habit's already-loaded attributes (SQLAlchemy's
        # default expire_on_commit), which silently serialized as `{}` over the
        # API before the two inserts were folded into a single commit here.
        self.db.commit()
        self.db.refresh(db_habit)
        return db_habit

    def list_habits(self) -> list[dict[str, Any]]:
        habits = self.db.exec(select(Habit)).all()
        today_dt = datetime.now().date()

        # Fetch 365 days of history to support historical week-by-week navigation and editing
        start_date_str = (today_dt - timedelta(days=365)).strftime("%Y-%m-%d")
        logs = self.db.exec(select(HabitLog).where(HabitLog.date_str >= start_date_str)).all()

        log_map: dict[str, dict[str, Any]] = {}
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

    def update_habit(self, habit_id: str, req: HabitUpdate) -> Habit:
        db_habit = self.db.get(Habit, habit_id)
        if not db_habit:
            raise EntityNotFoundError("Habit", habit_id)

        update_dict = req.model_dump(exclude_unset=True)
        goal_changed = (
            "target_value" in update_dict
            and update_dict["target_value"] is not None
            and update_dict["target_value"] != db_habit.target_value
        )

        for k, v in update_dict.items():
            setattr(db_habit, k, v)

        if goal_changed:
            today_str = datetime.now().strftime("%Y-%m-%d")
            # Upsert on the day: raising the target twice in one sitting
            # replaces that day's entry instead of leaving a same-day trail.
            # Reads db_habit.target_value from the pending in-memory change
            # above -- no flush needed, SQLAlchemy tracks it on the instance
            # before the row is written.
            todays_entry = self.db.exec(
                select(HabitGoalHistory).where(
                    HabitGoalHistory.habit_id == habit_id,
                    HabitGoalHistory.effective_from == today_str,
                )
            ).first()
            if todays_entry:
                todays_entry.target_value = db_habit.target_value
                self.db.add(todays_entry)
            else:
                self.db.add(HabitGoalHistory(
                    habit_id=habit_id,
                    target_value=db_habit.target_value,
                    effective_from=today_str,
                ))

        # One commit: a second commit here would expire db_habit's attributes
        # (SQLAlchemy's default expire_on_commit) before the API layer
        # serializes it -- see the identical note in create_habit above.
        self.db.add(db_habit)
        self.db.commit()
        self.db.refresh(db_habit)
        return db_habit

    def delete_habit(self, habit_id: str) -> None:
        db_habit = self.db.get(Habit, habit_id)
        if not db_habit:
            raise EntityNotFoundError("Habit", habit_id)

        self.db.delete(db_habit)
        self.db.commit()

    def log_progress(self, habit_id: str, req: HabitLogRequest) -> dict[str, Any] | HabitLog:
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

    def get_stats(self, habit_id: str) -> dict[str, Any]:
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

        goal_history = self.db.exec(
            select(HabitGoalHistory)
            .where(HabitGoalHistory.habit_id == habit_id)
            .order_by(HabitGoalHistory.effective_from)
        ).all()

        return {
            "habit": db_habit.model_dump(),
            "summary": {
                "completed": completed_count,
                "failed": failed_count,
                "skipped": skipped_count,
                "total_logs": len(logs),
            },
            "history": history,
            "goal_history": [
                {"target_value": g.target_value, "effective_from": g.effective_from}
                for g in goal_history
            ],
        }
