"""Read compact pending-intent guards while already holding SQLite writer reservation.

Never take a timer/advisory lock or reconcile from a DB-held caller.
"""

import os
from pathlib import Path

from timetrace.config import settings
from timetrace.core.exceptions import ConflictError
from timetrace.core.timer_store import TimerStore
from timetrace.db.models import MutationOperation


def check_correction_guard(db, *, work_ids=(), task_ids=(), plan_ids=(), status_ids=(), assignment_only=False):
    store = TimerStore(
        Path(os.environ.get("TIMETRACE_TIMER_STATE_FILE", settings.db_file.parent / "active_timer.json"))
    )
    pending = store.inspect().get("pending_operation")
    if pending is None:
        return
    if not isinstance(pending, dict) or not isinstance(pending.get("id"), str):
        raise ConflictError("Pending timer evidence is corrupt.", code="reconciliation_required")
    receipt = db.get(MutationOperation, pending["id"])
    if receipt is not None:
        if receipt.payload_hash != pending.get("payload_hash"):
            raise ConflictError("Pending receipt identity is corrupt.", code="reconciliation_required")
        return
    assignment = pending.get("assignment")
    if assignment:
        try:
            affected = {c["before"]["id"] for c in assignment["changes"]}
            task_context = {assignment["task_id"], *assignment.get("dependency_task_ids", [])}
            status_id = assignment.get("task_snapshot", {}).get("status_id")
            if set(work_ids) & affected or task_context & set(task_ids) or status_id in status_ids:
                raise ConflictError("Accepted assignment must recover first", code="assignment_pending")
        except (KeyError, TypeError) as exc:
            raise ConflictError("Pending assignment guard is corrupt", code="reconciliation_required") from exc
    if assignment_only:
        return
    guard = pending.get("correction_guard") or {}
    changes = pending.get("correction_changes") or []
    try:
        if changes:
            for name, field in (("work_ids", "id"), ("task_ids", "task_id"), ("plan_ids", "scheduled_session_id")):
                expected = {change["before"][field] for change in changes if change["before"][field] is not None}
                actual = guard.get(name, [])
                if (
                    not isinstance(actual, list)
                    or any(not isinstance(identity, str) for identity in actual)
                    or expected != set(actual)
                ):
                    raise ValueError("Inconsistent guard context")
            if {plan["id"] for plan in guard.get("plans", [])} != set(guard.get("plan_ids", [])):
                raise ValueError("Missing plan replay predicates")
    except (TypeError, ValueError, KeyError, AttributeError) as exc:
        raise ConflictError("Pending correction guard is corrupt.", code="reconciliation_required") from exc
    for key, supplied in (("work_ids", work_ids), ("task_ids", task_ids), ("plan_ids", plan_ids)):
        if set(supplied) & set(guard.get(key, [])):
            raise ConflictError(
                "Accepted correction must recover before changing its target context.", code="correction_pending"
            )
