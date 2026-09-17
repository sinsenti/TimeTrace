import re
from datetime import date, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.db.models import Habit, HabitGoalHistory, HabitLog
from timetrace.interfaces.api.schemas import HabitCreate, HabitLogRequest, HabitUpdate

_AI_MAX_HABIT_LOGS = 5000
_AI_MAX_HABIT_GOALS = 1000


class HabitService:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _parse_local_date(value: str, field_name: str = "date") -> date:
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValidationError(f"{field_name} must use YYYY-MM-DD")
        try:
            return date.fromisoformat(value)
        except ValueError as exc:
            raise ValidationError(f"{field_name} must be a valid local date") from exc

    @classmethod
    def _validate_range(cls, start_date: str, end_date: str, *, max_days: int = 730) -> tuple[date, date]:
        start = cls._parse_local_date(start_date, "start_date")
        end = cls._parse_local_date(end_date, "end_date")
        if end < start:
            raise ValidationError("end_date must not be before start_date")
        if (end - start).days + 1 > max_days:
            raise ValidationError(f"habit date range cannot exceed {max_days} days")
        return start, end

    @staticmethod
    def _expected_dates(start: date, end: date, frequency: str) -> list[str]:
        """Return days on which a habit can meaningfully be expected.

        The UI stores frequency as a human-readable string. Only the two unambiguous built-in
        schedules are treated specially; unknown/custom frequencies deliberately return no
        expected dates instead of turning missing logs into failures.
        """
        normalized = (frequency or "").strip().lower()
        every_day = "every day" in normalized or normalized in {"daily", "day"}
        weekdays = "weekday" in normalized or "monday-friday" in normalized
        if not every_day and not weekdays:
            return []
        values: list[str] = []
        current = start
        while current <= end:
            if every_day or current.weekday() < 5:
                values.append(current.isoformat())
            current += timedelta(days=1)
        return values

    def list_habits_for_ai(
        self,
        *,
        start_date: str,
        end_date: str,
        habit_id: str | None = None,
        include_logs: bool = True,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Return a bounded, explicit habit snapshot for the AI gateway.

        This is separate from the browser endpoint's historical 365-day convenience response:
        the caller supplies the local range and receives ``truncated`` metadata. The caller owns
        the session, so this method deliberately does not close it.
        """
        start, end = self._validate_range(start_date, end_date)
        try:
            requested_limit = int(limit)
        except (TypeError, ValueError) as exc:
            raise ValidationError("limit must be an integer") from exc
        limit = max(1, min(requested_limit, 200))
        db = self.db
        query = select(Habit).order_by(Habit.created_at.asc())
        if habit_id:
            query = query.where(Habit.id == habit_id)
        habits = list(db.exec(query.limit(limit + 1)).all())
        if habit_id and not habits:
            raise EntityNotFoundError("Habit", habit_id)
        truncated = len(habits) > limit
        habits = habits[:limit]

        logs_by_habit: dict[str, list[dict[str, Any]]] = {}
        goal_by_habit: dict[str, list[dict[str, Any]]] = {}
        logs_truncated = False
        goals_truncated = False
        if habits and include_logs:
            ids = [habit.id for habit in habits]
            logs = list(
                db.exec(
                    select(HabitLog)
                    .where(
                        HabitLog.habit_id.in_(ids),
                        HabitLog.date_str >= start.isoformat(),
                        HabitLog.date_str <= end.isoformat(),
                    )
                    .order_by(HabitLog.habit_id, HabitLog.date_str)
                    .limit(_AI_MAX_HABIT_LOGS + 1)
                ).all()
            )
            logs_truncated = len(logs) > _AI_MAX_HABIT_LOGS
            logs = logs[:_AI_MAX_HABIT_LOGS]
            for log in logs:
                entry = log.model_dump()
                entry["date"] = log.date_str
                logs_by_habit.setdefault(log.habit_id, []).append(entry)

        if habits:
            ids = [habit.id for habit in habits]
            goals = list(
                db.exec(
                    select(HabitGoalHistory)
                    .where(
                        HabitGoalHistory.habit_id.in_(ids),
                        HabitGoalHistory.effective_from <= end.isoformat(),
                    )
                    .order_by(HabitGoalHistory.habit_id, HabitGoalHistory.effective_from)
                    .limit(_AI_MAX_HABIT_GOALS + 1)
                ).all()
            )
            goals_truncated = len(goals) > _AI_MAX_HABIT_GOALS
            goals = goals[:_AI_MAX_HABIT_GOALS]
            for goal in goals:
                goal_by_habit.setdefault(goal.habit_id, []).append(
                    {
                        "target_value": goal.target_value,
                        "effective_from": goal.effective_from,
                        "created_at": goal.created_at.isoformat() if goal.created_at else None,
                    }
                )

        result = []
        for habit in habits:
            result.append(
                {
                    "id": habit.id,
                    "name": habit.name,
                    "habit_type": habit.habit_type,
                    "target_value": habit.target_value,
                    "unit": habit.unit,
                    "frequency": habit.frequency,
                    "reminder_time": habit.reminder_time,
                    "logs": logs_by_habit.get(habit.id, []) if include_logs else [],
                    "goal_history": goal_by_habit.get(habit.id, []),
                }
            )

        return {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "habits": result,
            "include_logs": include_logs,
            "truncated": truncated or logs_truncated or goals_truncated,
            "warnings": (
                (["Habit definitions were limited; request a narrower range or use habit_id."] if truncated else [])
                + (["Habit logs were limited; request a narrower range or use habit_id."] if logs_truncated else [])
                + (
                    ["Habit goal history was limited; request a narrower range or use habit_id."]
                    if goals_truncated
                    else []
                )
            ),
        }

    def get_habit_progress_for_ai(self, *, habit_id: str, start_date: str, end_date: str) -> dict[str, Any]:
        """Calculate progress without treating an absent log as a failed log."""
        start, end = self._validate_range(start_date, end_date)
        habit = self.db.get(Habit, habit_id)
        if not habit:
            raise EntityNotFoundError("Habit", habit_id)

        logs = list(
            self.db.exec(
                select(HabitLog).where(
                    HabitLog.habit_id == habit_id,
                    HabitLog.date_str >= start.isoformat(),
                    HabitLog.date_str <= end.isoformat(),
                )
            ).all()
        )
        log_by_date = {log.date_str: log for log in logs}
        goals = list(
            self.db.exec(
                select(HabitGoalHistory)
                .where(HabitGoalHistory.habit_id == habit_id, HabitGoalHistory.effective_from <= end.isoformat())
                .order_by(HabitGoalHistory.effective_from)
                .limit(_AI_MAX_HABIT_GOALS + 1)
            ).all()
        )
        goals_truncated = len(goals) > _AI_MAX_HABIT_GOALS
        goals = goals[:_AI_MAX_HABIT_GOALS]

        def target_for(day_value: str) -> float:
            target = habit.target_value
            for goal in goals:
                if goal.effective_from <= day_value:
                    target = goal.target_value
                else:
                    break
            return target

        expected_dates = self._expected_dates(start, end, habit.frequency)
        days: list[dict[str, Any]] = []
        counts = {
            "completed": 0,
            "failed": 0,
            "skipped": 0,
            "pending": 0,
            "in_progress": 0,
            "below_target": 0,
            "no_log": 0,
        }
        numeric_values: list[float] = []
        current = start
        while current <= end:
            day_value = current.isoformat()
            log = log_by_date.get(day_value)
            target = target_for(day_value)
            if log is None:
                state = "no_log"
                counts[state] += 1
                entry: dict[str, Any] = {
                    "date": day_value,
                    "status": state,
                    "has_log": False,
                    "value": None,
                    "target_value": target,
                    "target_met": None,
                }
            else:
                value = float(log.value or 0)
                if habit.habit_type == "numeric" and log.status not in {"failed", "skipped"} and value < target:
                    state = "below_target"
                    counts[state] += 1
                else:
                    state = log.status or "pending"
                    if state not in counts:
                        counts["pending"] += 1
                        state = "pending"
                    else:
                        counts[state] += 1
                if habit.habit_type == "numeric" and log.status not in {"skipped", "failed"}:
                    numeric_values.append(value)
                entry = {
                    "date": day_value,
                    "status": state,
                    "raw_status": log.status,
                    "has_log": True,
                    "value": value,
                    "notes": log.notes or "",
                    "target_value": target,
                    "target_met": state == "completed" or (habit.habit_type == "numeric" and value >= target),
                }
            days.append(entry)
            current += timedelta(days=1)

        logged_days = len(logs)
        completed = counts["completed"]
        meaningful_logged = sum(
            counts[key] for key in ("completed", "failed", "skipped", "pending", "in_progress", "below_target")
        )
        completion_rate = round(100.0 * completed / meaningful_logged, 2) if meaningful_logged else None
        expected_completion_rate = round(100.0 * completed / len(expected_dates), 2) if expected_dates else None
        missing = [entry["date"] for entry in days if entry["status"] == "no_log" and entry["date"] in expected_dates]
        goal_history = [
            {"target_value": goal.target_value, "effective_from": goal.effective_from}
            for goal in goals
        ]

        return {
            "habit": {
                "id": habit.id,
                "name": habit.name,
                "habit_type": habit.habit_type,
                "target_value": habit.target_value,
                "unit": habit.unit,
                "frequency": habit.frequency,
            },
            "range": {"start_date": start.isoformat(), "end_date": end.isoformat()},
            "logged_days": logged_days,
            "expected_days": len(expected_dates) if expected_dates else None,
            "missing_log_days": missing,
            "counts": counts,
            "completion_rate": completion_rate,
            "expected_completion_rate": expected_completion_rate,
            "numeric_total": round(sum(numeric_values), 4) if numeric_values else None,
            "numeric_average": round(sum(numeric_values) / len(numeric_values), 4) if numeric_values else None,
            "goal_history": goal_history,
            "days": days,
            "truncated": goals_truncated,
            "warnings": (
                ([] if expected_dates else ["This custom frequency has no computable expected-day schedule."])
                + (["Habit goal history was limited; results may omit older goal changes."] if goals_truncated else [])
            ),
        }

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
