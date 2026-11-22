"""Singular compatibility adapters; all mutations use the targeted durability funnel."""

from uuid import uuid7

from timetrace.core.exceptions import ConflictError
from timetrace.services.multiple_timer_service import MultipleTimerService
from timetrace.services.session_service import SessionService


class TimerService:
    def __init__(self, db):
        self.db = db
        self.multiple = MultipleTimerService(db)

    def get_status(self, timer_id=None):
        status = self.multiple.list_timers()
        timers = status["timers"]
        timer = (
            next(t for t in timers if t["id"] == timer_id)
            if timer_id
            else self.multiple.select_one(timers)
            if timers
            else {}
        )
        gap = next((g for g in timer.get("idle_gaps", []) if g["decision"] is None), None)
        legacy_gap = None
        if gap:
            legacy_gap = {
                **gap,
                "idle_start": gap["onset"],
                "idle_end": gap["return_at"],
                "task_id": timer["task_id"],
                "task_title": timer["task_title"],
                "saved_session": None,
            }
        elapsed = int(timer.get("elapsed_seconds", 0))
        target = timer.get("target_minutes")
        upcoming = None
        if not timer:
            upcoming = SessionService(self.db).next_upcoming_occurrence()
            if upcoming:
                upcoming = {"title": upcoming["title"], "start_time": upcoming["start_time"].isoformat()}
        return {
            **timer,
            "is_running": timer.get("state") == "running",
            "is_frozen_idle": timer.get("state") == "frozen",
            "pending_idle_gap": legacy_gap,
            "elapsed_seconds": elapsed,
            "start_time": timer.get("running_start"),
            "mode": timer.get("mode", "flowtime"),
            "remaining_seconds": max(0, target * 60 - elapsed) if target else None,
            "target_minutes": target,
            "task_id": timer.get("task_id"),
            "task_title": timer.get("task_title"),
            "tags": timer.get("tags", ""),
            "notes": timer.get("notes", ""),
            "idle_detection_enabled": status["idle_detection_enabled"],
            "next_session": upcoming,
            "next_scheduled_session": upcoming,
            "timer_mode": timer.get("mode", "flowtime"),
            "remaining_pomodoro_seconds": max(0, target * 60 - elapsed) if target else None,
        }

    def start_timer(self, req):
        result = self.multiple.start({**req.model_dump(), "operation_id": str(uuid7())})
        return self.get_status(result["timer"]["id"])

    def _record(self, action, payload):
        result = self.multiple.mutate(action, None, {**payload, "operation_id": str(uuid7())})
        ids = result["recorded_work_ids"]
        if ids:
            row = SessionService(self.db).get_recorded_work(ids[-1]).model_dump()
            return {**row, "recorded_work_ids": ids, "operation_id": result["operation_id"]}
        return {"id": None, "duration_seconds": 0, **result}

    def stop_timer(self):
        return self._record("stop", {})

    def split_timer(self, req):
        return self._record("split", req.model_dump())

    def toggle_idle_detection(self, req):
        self.multiple.mutate("idle_toggle", None, {"operation_id": str(uuid7()), "enabled": req.enabled})
        return self.multiple.list_timers()["idle_detection_enabled"]

    def freeze_for_idle(self, idle_seconds):
        return self.multiple.observe_activity(idle_seconds)

    def resolve_idle_gap(self, req):
        timer = self.multiple.select_one(self.multiple.list_timers()["timers"])
        gaps = [g for g in timer["idle_gaps"] if g["decision"] is None]
        if len(gaps) != 1 or req.option not in ("skip", "claim_work"):
            raise ConflictError("Use explicit targeted claim/discard for idle gaps.", code="idle_gap_unresolved")
        return self.multiple.mutate(
            "resolve",
            timer["id"],
            {
                "operation_id": str(uuid7()),
                "gap_id": gaps[0]["id"],
                "decision": "claim" if req.option == "claim_work" else "discard",
            },
        )
