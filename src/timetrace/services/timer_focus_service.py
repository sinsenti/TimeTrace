"""Daemon-facing evaluation and durable notification reads/claims; no external delivery."""

import json
import time
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import uuid7

from sqlmodel import select

from timetrace.core.exceptions import ConflictError, EntityNotFoundError, TimerError
from timetrace.core.focus import DEFAULTS, checkpoint, elapsed, new_focus
from timetrace.db.models import MutationOperation, TimerNotification
from timetrace.db.session import lock_sqlite_writer


def boot_seconds():
    if not hasattr(time, "CLOCK_BOOTTIME"):
        return None
    return time.clock_gettime(time.CLOCK_BOOTTIME)


class FocusEvaluator:
    """One execution epoch. First sample/restart can only catch up, never auto-pause.

    BOOTTIME includes suspend while monotonic usually excludes it. Both deltas and
    UTC must agree, and dispatch must be within one second of the actual boundary.
    Missing suspend-aware clock fails closed. Caller supplies clocks, not an HTTP cutoff.
    """

    def __init__(self, db, *, wall_clock=None, monotonic_clock=None, suspend_clock=None):
        self.db = db
        self.wall_clock = wall_clock or (lambda: datetime.now(UTC))
        self.monotonic_clock = monotonic_clock or time.monotonic
        self.suspend_clock = suspend_clock or boot_seconds
        self.previous = None
        self.tokens = {}

    def evaluate(self):
        from timetrace.services.multiple_timer_service import MultipleTimerService

        samples = []
        contexts = []

        def observe_locked():
            sample = (self.wall_clock(), self.monotonic_clock(), self.suspend_clock())
            samples.append(sample)
            continuous = False
            previous = self.previous
            clock_shift = 0
            if previous and sample[2] is not None and previous[2] is not None:
                wall = (sample[0] - previous[0]).total_seconds()
                mono, boot = sample[1] - previous[1], sample[2] - previous[2]
                continuous = 0 <= wall <= 2 and abs(wall - mono) <= 0.25 and abs(boot - mono) <= 0.25
                if mono >= 0 and abs(boot - mono) <= 0.25 and abs(mono - wall) > 0.25:
                    clock_shift = mono - wall
            context = {
                "cutoff": sample[0].isoformat(),
                "continuous": continuous,
                "previous_wall": previous[0].isoformat() if previous else None,
                "clock_shift": clock_shift,
                "previous_tokens": self.tokens,
            }
            contexts.append(context)
            return context

        result = MultipleTimerService(self.db).mutate(
            "focus_evaluate", None, {"operation_id": str(uuid7())}, _evaluation=observe_locked
        )
        self.previous = samples[-1]
        self.tokens = contexts[-1].get("observed_tokens", {})
        return result


def evaluate_state(service, state, cutoff, continuity):
    """Called only while the shared timer/SQLite funnel owns serialization."""
    now = datetime.fromisoformat(cutoff)
    events = []
    for timer in state["timers"].values():
        if timer["state"] == "stopped":
            continue
        if not timer.get("identity_started_at"):
            anchor = None
            for receipt in service.db.exec(select(MutationOperation)).all():
                result = json.loads(receipt.result_json)
                old = result.get("timer")
                if old and old.get("id") == timer["id"] and not result.get("selected_existing"):
                    after = json.loads(receipt.after_state_json)
                    # Creation receipt introduces identity absent at revision 1 only.
                    if old.get("revision") == 1 and timer["id"] in after.get("timers", {}):
                        anchor = receipt.cutoff
                        break
            timer["identity_started_at"] = anchor or cutoff
            timer["identity_started_at_provenance"] = "creation_receipt" if anchor else "prospective_unknown_history"
        if "focus" not in timer:
            policy = dict(DEFAULTS)
            target = timer.get("target_minutes")
            if timer.get("mode") == "pomodoro" and type(target) is int and 1 <= target <= 1440:
                policy.update(enabled=True, work_minutes=target)
            timer["focus"] = new_focus(policy, cutoff)
            if timer["state"] != "running":
                timer["focus"]["recording_anchor"] = None
        focus = timer["focus"]
        token = (focus["generation"], focus.get("recording_anchor"), timer["state"], timer["revision"])
        shift = continuity.get("clock_shift", 0)
        if (
            shift
            and focus["phase"] == "work"
            and timer["state"] == "running"
            and token[:3] == continuity.get("previous_tokens", {}).get(timer["id"], ())[:3]
        ):
            # Rebase only this independent clock, never credited intervals/creation anchor.
            focus["recording_anchor"] = (
                datetime.fromisoformat(focus["recording_anchor"]) - timedelta(seconds=shift)
            ).isoformat()
            timer["revision"] += 1

        def emit(kind, generation, due, timer_id=timer["id"]):
            existing = service.db.exec(
                select(TimerNotification.id).where(
                    TimerNotification.timer_id == timer_id,
                    TimerNotification.kind == kind,
                    TimerNotification.generation == generation,
                )
            ).first()
            if existing is not None:
                return
            events.append(
                {
                    "id": str(uuid7()),
                    "timer_id": timer_id,
                    "kind": kind,
                    "generation": generation,
                    "due_at": due,
                    "status": "pending",
                    "acknowledged": False,
                }
            )

        warning_at = datetime.fromisoformat(timer["identity_started_at"]) + timedelta(hours=2)
        if now >= warning_at:
            emit("two_hour", 0, warning_at.isoformat())
        if (
            focus["phase"] == "work"
            and timer["state"] == "running"
            and not any(g.get("decision") is None for g in timer["idle_gaps"])
        ):
            duration = focus["period"]["work_minutes"] * 60
            if elapsed(focus, cutoff) >= duration:
                anchor = datetime.fromisoformat(focus["recording_anchor"])
                boundary = anchor + timedelta(seconds=max(0, duration - focus["active_seconds"]))
                live = (
                    focus["active_seconds"] < duration
                    and continuity["continuous"]
                    and token == continuity.get("previous_tokens", {}).get(timer["id"])
                    and continuity["previous_wall"] is not None
                    and datetime.fromisoformat(continuity["previous_wall"]) <= boundary <= now
                    and (now - boundary).total_seconds() <= 1
                )
                emit("work_due", focus["generation"], boundary.isoformat())
                if focus["period"]["behavior"] == "automatic_break" and live:
                    service._close_segment(timer, boundary.isoformat())
                    timer["state"] = "paused"
                    timer["manual_pause_note_segment_id"] = None
                    checkpoint(timer, boundary.isoformat())
                    focus["recording_anchor"] = None
                    focus["phase"] = "break"
                    focus["generation"] += 1
                    focus["break_deadline"] = (
                        boundary + timedelta(minutes=focus["settings"]["break_minutes"])
                    ).isoformat()
                else:
                    focus["phase"] = "work_due"
                timer["revision"] += 1
        elif focus["phase"] == "break" and now >= datetime.fromisoformat(focus["break_deadline"]):
            emit("break_due", focus["generation"], focus["break_deadline"])
            focus["phase"] = "break_due"
            timer["revision"] += 1
    continuity["observed_tokens"] = {
        t["id"]: (t["focus"]["generation"], t["focus"].get("recording_anchor"), t["state"], t["revision"])
        for t in state["timers"].values()
        if t.get("focus") and t["state"] != "stopped"
    }
    return events


class TimerNotificationService:
    def __init__(self, db):
        self.db = db

    @contextmanager
    def serialized(self):
        from timetrace.services.multiple_timer_service import MultipleTimerService, _writes

        service = MultipleTimerService(self.db)
        with _writes, service.store.locked():
            service._reconcile()
            lock_sqlite_writer(self.db)
            try:
                yield
            finally:
                self.db.rollback()

    def list_notices(self):
        return {
            "notices": [
                self.public(row)
                for row in self.db.exec(
                    select(TimerNotification).order_by(TimerNotification.due_at, TimerNotification.id)
                ).all()
            ]
        }

    @staticmethod
    def public(row):
        return {
            key: getattr(row, key)
            for key in ("id", "timer_id", "kind", "generation", "due_at", "status", "channel", "acknowledged")
        }

    def claim(self, event_id, operation_id, channel):
        if channel not in ("in_app", "browser", "native"):
            raise TimerError("Unsupported notification channel.")
        with self.serialized():
            self.db.expire_all()
            row = self.db.get(TimerNotification, event_id)
            if row is None:
                raise EntityNotFoundError("Notification", event_id)
            if row.claim_operation == operation_id:
                if row.channel != channel:
                    raise ConflictError("Claim payload changed.", code="operation_payload_mismatch")
                return {**self.public(row), "claim_token": row.claim_token, "send_authorized": False}
            if row.status != "pending":
                raise ConflictError("Notification already claimed; do not alert again.", code="notification_claimed")
            row.channel, row.claim_operation, row.claim_token = channel, operation_id, str(uuid7())
            # Conservatively unknown BEFORE IO: crash cannot lease into a second blast.
            row.status = "unknown"
            self.db.add(row)
            self.db.commit()
            return {**self.public(row), "claim_token": row.claim_token, "send_authorized": True}

    def acknowledge(self, event_id):
        """Dismiss the durable passive card; never authorize a transient alert."""
        with self.serialized():
            row = self.db.get(TimerNotification, event_id)
            if row is None:
                raise EntityNotFoundError("Notification", event_id)
            row.acknowledged = True
            if row.status == "pending":
                row.status = "in_app_acknowledged"
                row.channel = "in_app"
            self.db.add(row)
            self.db.commit()
            return self.public(row)

    def result(self, event_id, token, outcome):
        if outcome not in ("accepted", "failed", "unknown", "in_app_acknowledged"):
            raise TimerError("Unsupported notification result.")
        with self.serialized():
            self.db.expire_all()
            row = self.db.get(TimerNotification, event_id)
            if row is None:
                raise EntityNotFoundError("Notification", event_id)
            if row.claim_token != token:
                raise ConflictError("Notification claim changed.", code="notification_claimed")
            if row.status != "unknown" and row.status != outcome:
                raise ConflictError("Notification result already recorded.", code="notification_claimed")
            row.status = outcome
            row.acknowledged = row.acknowledged or outcome == "in_app_acknowledged"
            self.db.add(row)
            self.db.commit()
            return self.public(row)
