"""Bounded daemon evaluator/delivery loop, independent of browser and idle enablement."""

import asyncio
import logging
from uuid import uuid7

from sqlmodel import Session

from timetrace.core.exceptions import ConflictError
from timetrace.services.multiple_timer_service import MultipleTimerService
from timetrace.services.timer_focus_service import FocusEvaluator, TimerNotificationService

logger = logging.getLogger(__name__)


class FocusRuntime:
    def __init__(self, engine, adapter, *, evaluator_factory=FocusEvaluator):
        self.engine, self.adapter, self.evaluator_factory = engine, adapter, evaluator_factory
        self.evaluator = None

    def tick(self):
        with Session(self.engine) as db:
            if self.evaluator is None:
                self.evaluator = self.evaluator_factory(db)
            self.evaluator.db = db
            self.evaluator.evaluate()
            notifications = TimerNotificationService(db)
            pending = [n for n in notifications.list_notices()["notices"] if n["status"] == "pending"][:16]
            # Capability/native IO happens outside all mutation/advisory locks.
            if not pending or not self.adapter.capability()["available"]:
                return
            sound = MultipleTimerService(db).focus_defaults()["sound_enabled"]
            for notice in pending:
                try:
                    claim = notifications.claim(notice["id"], str(uuid7()), "native")
                except ConflictError:
                    continue
                if not claim["send_authorized"]:
                    continue
                try:
                    outcome = self.adapter.send(notice, sound=sound)
                except Exception:
                    # A transport may already have sent before raising. Never retry blindly.
                    outcome = "unknown"
                notifications.result(notice["id"], claim["claim_token"], outcome)

    async def run(self, interval=1):
        while True:
            await asyncio.sleep(interval)
            worker = asyncio.create_task(asyncio.to_thread(self.tick))
            try:
                await asyncio.shield(worker)
            except asyncio.CancelledError:
                # Cancel cannot abandon a thread halfway through claim/send/result.
                await worker
                raise
            except Exception:
                logger.warning("Focus evaluation/delivery unavailable; durable state retained for recovery.")
