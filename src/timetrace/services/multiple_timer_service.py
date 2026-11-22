"""Targeted timers: one durable transition funnel for every writer."""

import hashlib
import json
import os
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from uuid import uuid7

from sqlmodel import select

from timetrace.config import settings
from timetrace.core.exceptions import ConflictError, EntityNotFoundError, TimerError
from timetrace.core.timer_store import TimerStore
from timetrace.db.models import MutationOperation, ScheduledSession, Task
from timetrace.db.session import lock_sqlite_writer
from timetrace.interfaces.api.schemas import RecordedWorkCreate
from timetrace.services.session_service import SessionService

_writes = RLock()


class MultipleTimerService:
    def __init__(self, db):
        self.db = db
        self.store = TimerStore(
            Path(os.environ.get("TIMETRACE_TIMER_STATE_FILE", settings.db_file.parent / "timers.json"))
        )

    def list_timers(self):
        with _writes, self.store.locked():
            state = self.store.read()
            timers = []
            now = datetime.now(UTC)
            for timer in state["timers"].values():
                if timer["state"] == "stopped":
                    continue
                timer = deepcopy(timer)
                elapsed = sum(
                    (datetime.fromisoformat(s["end_time"]) - datetime.fromisoformat(s["start_time"])).total_seconds()
                    for s in timer["segments"]
                )
                if timer["running_start"]:
                    elapsed += (now - datetime.fromisoformat(timer["running_start"])).total_seconds()
                timer["elapsed_seconds"] = elapsed
                timers.append(timer)
            return {"revision": state["revision"], "timers": timers}

    def start(self, payload):
        return self.mutate("start", None, payload)

    def mutate(self, action, timer_id, payload):
        payload = {"action": action, "timer_id": timer_id, **payload}
        operation_id = payload["operation_id"]
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        with _writes, self.store.locked():
            try:
                state = self._reconcile()
                lock_sqlite_writer(self.db)
                receipt = self.db.get(MutationOperation, operation_id)
                if receipt:
                    if receipt.payload_hash != digest:
                        raise ConflictError("Operation payload differs.", code="operation_payload_mismatch")
                    return json.loads(receipt.result_json)
                cutoff = datetime.now(UTC).isoformat()
                after = deepcopy(state)
                if action == "start":
                    timer, selected = self._start(after, payload, cutoff)
                else:
                    selected = False
                    timer = after["timers"].get(timer_id)
                    if timer is None:
                        raise EntityNotFoundError("Timer", timer_id)
                    if payload.get("expected_revision") not in (None, timer["revision"]):
                        raise ConflictError("Timer changed.", code="revision_stale")
                    if timer["state"] == "stopped":
                        raise TimerError("Timer is stopped.")
                    if any(g.get("decision") is None for g in timer["idle_gaps"]):
                        raise ConflictError("Resolve idle gaps first.", code="idle_gap_unresolved")
                    if action in ("pause", "stop", "split"):
                        self._close_segment(timer, cutoff)
                        timer["state"] = "paused"
                    elif action == "resume":
                        if timer["state"] != "paused":
                            raise TimerError("Timer is not paused.")
                        timer["running_start"] = cutoff
                        timer["state"] = "running"
                    else:
                        raise TimerError("Unknown timer action.")
                    timer["revision"] += 1
                work = []
                if action in ("stop", "split"):
                    for segment in timer["segments"]:
                        if segment.get("recorded_work_id"):
                            continue
                        segment["recorded_work_id"] = str(uuid7())
                        work.append({**segment, "timer_id": timer["id"]})
                    if action == "stop":
                        timer["state"] = "stopped"
                    else:
                        timer["tags"] = payload.get("new_tags", "")
                        timer["notes"] = payload.get("new_notes", "")
                        timer["state"] = "running"
                        timer["running_start"] = cutoff
                after["revision"] += 1
                result = {
                    "timer": timer,
                    "selected_existing": selected,
                    "information": [],
                    "operation_id": operation_id,
                    "recorded_work_ids": [s["recorded_work_id"] for s in work],
                }
                intent = {
                    "id": operation_id,
                    "payload_hash": digest,
                    "before_revision": state["revision"],
                    "after_revision": after["revision"],
                    "cutoff": cutoff,
                    "after_state_json": json.dumps(after),
                    "result_json": json.dumps(result),
                    "work": work,
                }
                state["pending_operation"] = intent
                self.store.write(state)
                self._complete(intent)
                return result
            except Exception:
                self.db.rollback()
                raise

    def _start(self, after, payload, cutoff):
        task_id = payload.get("task_id")
        task = self.db.get(Task, task_id) if task_id else None
        if task_id and task is None:
            raise EntityNotFoundError("Task", task_id)
        existing = next(
            (t for t in after["timers"].values() if task_id and t["task_id"] == task_id and t["state"] != "stopped"),
            None,
        )
        if existing:
            return existing, True
        timer = {
            "id": str(uuid7()),
            "state": "running",
            "revision": 1,
            "task_id": task_id,
            "task_title": task.title if task else None,
            "scheduled_session_id": None,
            "tags": payload.get("tags", ""),
            "notes": payload.get("notes", ""),
            "mode": payload.get("mode", "flowtime"),
            "target_minutes": payload.get("target_minutes"),
            "pause_when_idle": True,
            "segments": [],
            "running_start": cutoff,
            "idle_gaps": [],
        }
        after["timers"][timer["id"]] = timer
        return timer, False

    @staticmethod
    def _close_segment(timer, cutoff):
        start = timer["running_start"]
        if start and cutoff > start:
            timer["segments"].append(
                {
                    "id": str(uuid7()),
                    "start_time": start,
                    "end_time": cutoff,
                    "task_id": timer["task_id"],
                    "scheduled_session_id": timer["scheduled_session_id"],
                    "tags": timer["tags"],
                    "notes": timer["notes"],
                }
            )
        timer["running_start"] = None

    def _complete(self, intent):
        lock_sqlite_writer(self.db)
        receipt = self.db.get(MutationOperation, intent["id"])
        if receipt is None:
            for segment in intent.get("work", []):
                plan_id = segment.get("scheduled_session_id")
                plan = self.db.get(ScheduledSession, plan_id) if plan_id else None
                req = RecordedWorkCreate(
                    task_id=segment["task_id"],
                    start_time=segment["start_time"],
                    end_time=segment["end_time"],
                    tags=segment["tags"],
                    notes=segment["notes"],
                    scheduled_session_id=plan_id,
                    expected_plan_revision=plan.revision if plan else None,
                )
                SessionService(self.db).stage_recorded_work(
                    req,
                    provenance="timer",
                    timer_identity={
                        "id": segment["recorded_work_id"],
                        "timer_id": segment["timer_id"],
                        "timer_operation_id": intent["id"],
                        "timer_segment_id": segment["id"],
                    },
                )
            receipt = MutationOperation(**{k: v for k, v in intent.items() if k != "work"})
            self.db.add(receipt)
            self.db.commit()
        current = self.store.read()
        after = json.loads(receipt.after_state_json)
        if current["revision"] not in (receipt.before_revision, receipt.after_revision):
            raise ConflictError("Timer generation conflicts with receipt.", code="reconciliation_required")
        if current["revision"] == receipt.after_revision and current != after:
            raise ConflictError("Timer state conflicts with receipt.", code="reconciliation_required")
        self.store.write(after)
        if self.store.read() != after:
            raise ConflictError("Timer transition not installed.", code="reconciliation_required")
        receipt.file_finalized = True
        self.db.add(receipt)
        self.db.commit()

    def _reconcile(self):
        state = self.store.read()
        pending = state.get("pending_operation")
        if pending:
            self._complete(pending)
        for receipt in self.db.exec(select(MutationOperation).where(MutationOperation.file_finalized.is_(False))).all():
            self._complete(receipt.model_dump(exclude={"file_finalized"}))
        return self.store.read()
