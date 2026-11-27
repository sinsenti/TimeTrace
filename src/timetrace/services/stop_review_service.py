"""Stop review policy, composed inside the timer's durable transition funnel."""

import hashlib
import json
from copy import deepcopy
from datetime import datetime
from uuid import uuid7

from sqlmodel import or_, select

from timetrace.core.exceptions import ConflictError, EntityNotFoundError
from timetrace.db.models import MutationOperation, RecurrenceException, ScheduledSession, Task
from timetrace.db.models import Session as Work
from timetrace.db.session import sqlite_read_snapshot


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class StopReviewService:
    def __init__(self, timers):
        self.timers = timers
        self.db = timers.db

    @staticmethod
    def prepare(timer, cutoff, operation_id):
        if timer["state"] not in ("running", "paused"):
            raise ConflictError("Review frozen timers first.", code="idle_gap_unresolved")
        review = timer.get("stop_review")
        if review and review["timer_revision"] == timer["revision"]:
            raise ConflictError("A Stop review is already open; read the timer.", code="stop_review_active")
        was_running = timer["state"] == "running"
        if not was_running:
            cutoff = max((s["end_time"] for s in timer["segments"]), default=timer.get("identity_started_at", cutoff))
        closed = None
        if was_running:
            from timetrace.services.multiple_timer_service import MultipleTimerService

            closed = MultipleTimerService._close_segment(timer, cutoff)
        timer["state"] = "paused"
        if was_running:
            timer["manual_pause_note_segment_id"] = closed
        timer["stop_review"] = {
            "id": operation_id,
            "cutoff": cutoff,
            "was_running": was_running,
            "timer_revision": timer["revision"] + 1,
        }
        if timer.get("focus"):
            timer["focus"]["recording_anchor"] = None

    @staticmethod
    def validate(timer, request):
        review = timer.get("stop_review")
        if (
            timer["state"] != "paused"
            or not review
            or review["id"] != request["review_id"]
            or request["expected_revision"] != timer["revision"]
            or review["timer_revision"] != timer["revision"]
        ):
            raise ConflictError("Stop review changed; read the timer and review again.", code="stop_review_stale")
        if any(g.get("decision") is None for g in timer["idle_gaps"]):
            raise ConflictError("Resolve idle gaps first.", code="idle_gap_unresolved")
        return review

    def preview(self, timer_id, request):
        # Inspect only: previews must never reconcile, migrate, or install an intent.
        state = self.timers.store.inspect()
        with sqlite_read_snapshot(self.db) as reader:
            if (
                state.get("pending_operation")
                or reader.exec(
                    select(MutationOperation.id).where(MutationOperation.file_finalized.is_(False)).limit(1)
                ).first()
            ):
                raise ConflictError("Recover the pending operation first.", code="reconciliation_required")
            timer = state.get("timers", {}).get(timer_id)
            if timer is None:
                raise EntityNotFoundError("Timer", timer_id)
            from timetrace.services.multiple_timer_service import MultipleTimerService

            return StopReviewService(MultipleTimerService(reader)).context(state, timer, request)

    def context(self, state, timer, request):
        self.db.expire_all()
        review = self.validate(timer, request)
        blocked = {policy: [] for policy in ("actual", "continue", "fit", "split", "scheduled")}
        if not review["was_running"]:
            blocked["continue"].append("This timer was already paused; leave it paused or explicitly Resume later.")
        unsaved = [s for s in timer["segments"] if not s.get("recorded_work_id")]
        parts = []
        for segment in sorted(unsaved, key=lambda s: s["start_time"]):
            if parts and segment["start_time"] <= parts[-1]["end_time"]:
                parts[-1]["end_time"] = max(parts[-1]["end_time"], segment["end_time"])
            else:
                parts.append({"start_time": segment["start_time"], "end_time": segment["end_time"]})
        plans = []
        if timer["task_id"] is not None:
            plans = self.db.exec(
                select(ScheduledSession)
                .where(ScheduledSession.task_id == timer["task_id"])
                .order_by(ScheduledSession.id)
            ).all()
        link = timer["scheduled_session_id"]
        candidates = [
            p
            for p in plans
            if (
                p.id == link
                if link
                else any(
                    p.start_time < datetime.fromisoformat(s["end_time"]).replace(tzinfo=None)
                    and p.end_time > datetime.fromisoformat(s["start_time"]).replace(tzinfo=None)
                    for s in unsaved
                )
            )
        ]
        selected_id = request.get("scheduled_session_id")
        plan = next((p for p in candidates if p.id == selected_id), None)
        if selected_id and plan is None:
            raise ConflictError(
                "Choose an eligible same-task plan; keep an existing link.", code="stop_plan_ineligible"
            )
        if plan and request.get("expected_plan_revision") != plan.revision:
            raise ConflictError("Selected plan changed; read and preview again.", code="revision_stale")
        if not plan and request.get("expected_plan_revision") is not None:
            raise ConflictError("A plan revision needs an explicit plan choice.", code="stop_plan_ineligible")
        related = self.db.exec(
            select(Work)
            .where(
                Work.kind == "recorded_work",
                or_(
                    Work.timer_id == timer["id"],
                    Work.scheduled_session_id == selected_id if selected_id else False,
                    *[
                        (Work.task_id == timer["task_id"])
                        & (Work.start_time < datetime.fromisoformat(s["end_time"]).replace(tzinfo=None))
                        & (Work.end_time > datetime.fromisoformat(s["start_time"]).replace(tzinfo=None))
                        for s in [
                            *parts,
                            *(
                                [{"start_time": plan.start_time.isoformat(), "end_time": plan.end_time.isoformat()}]
                                if plan
                                else []
                            ),
                        ]
                    ]
                    if timer["task_id"] is not None
                    else [],
                ),
            )
            .order_by(Work.id)
        ).all()
        other_timers = [
            deepcopy(t)
            for t in state["timers"].values()
            if t["id"] != timer["id"]
            and t["state"] != "stopped"
            and selected_id
            and any(c.get("scheduled_session_id") == selected_id for c in [t, *t["segments"], *t["idle_gaps"]])
        ]
        reasons = []
        if not plan:
            reasons.append("Explicitly choose an eligible same-task plan; taskless work can still save actual time.")
        if not unsaved:
            reasons.append("There is no positive unsaved work to replace or fit.")
        if any(s.get("recorded_work_id") for s in timer["segments"]) or related:
            reasons.append("Saved or matching work exists; use recorded-work correction/review instead.")
        if other_timers:
            reasons.append("Another unfinished timer uses this plan; finish and review it first.")
        if any(
            s["task_id"] != timer["task_id"] or s.get("scheduled_session_id") not in (None, selected_id)
            for s in unsaved
        ):
            reasons.append("Unsaved work has a different association; use correction/review instead.")
        for policy in ("fit", "split", "scheduled"):
            blocked[policy].extend(reasons)
        if len(parts) != 1:
            blocked["fit"].append("Separated work parts require explicit Split, not continuous outer bounds.")
        if len(parts) < 2:
            blocked["split"].append("Only one contiguous work part; use Fit instead.")
        if plan and plan.end_time > datetime.fromisoformat(review["cutoff"]).replace(tzinfo=None):
            blocked["scheduled"].append(
                "The scheduled end is after the time you pressed Stop; Continue timing then review again."
            )
        manifest = {
            "timer": deepcopy(timer),
            "selected_plan": plan.model_dump(mode="json") if plan else None,
            "matching_work": [w.model_dump(mode="json") for w in related],
            "other_timers": other_timers,
            "candidates": [p.model_dump(mode="json") for p in candidates],
            "task": self.db.get(Task, timer["task_id"]).model_dump(mode="json")
            if timer["task_id"] and self.db.get(Task, timer["task_id"])
            else None,
            "recurrence": [
                r.model_dump(mode="json")
                for r in self.db.exec(
                    select(RecurrenceException)
                    .where(RecurrenceException.scheduled_session_id == selected_id)
                    .order_by(RecurrenceException.id)
                ).all()
            ]
            if selected_id
            else [],
        }
        from timetrace.services.session_service import SessionService

        public_plans = [SessionService(self.db).get_scheduled_session(p.id).model_dump(mode="json") for p in candidates]
        public_selected = next((p for p in public_plans if p["id"] == selected_id), None)
        return {
            "manifest": manifest,
            "consent_token": digest(manifest),
            "blocked": blocked,
            "candidates": public_plans,
            "selected_plan_id": selected_id,
            "unsaved_segments": deepcopy(unsaved),
            "actual_parts": parts,
            "effects": {
                "actual": {"schedule_changed": False},
                "fit": {"source_plan": public_selected, "parts": parts},
                "split": {"source_plan": public_selected, "parts": parts},
                "scheduled": {
                    "replaces_unsaved_segments": deepcopy(unsaved),
                    "interval": (
                        {"start_time": public_selected["start_time"], "end_time": public_selected["end_time"]}
                        if public_selected
                        else None
                    ),
                },
            },
        }

    def accept(self, state, timer, payload, cutoff):
        preview = self.context(state, timer, payload)
        if preview["consent_token"] != payload["consent_token"]:
            raise ConflictError("Stop preview changed; preview again.", code="stop_preview_stale")
        if preview["blocked"][payload["policy"]]:
            raise ConflictError(" ".join(preview["blocked"][payload["policy"]]), code="stop_policy_blocked")
        policy = payload["policy"]
        plan_changes = None
        details = {}
        if policy in ("fit", "split", "scheduled"):
            from timetrace.services.correction_guards import check_correction_guard

            before = preview["manifest"]["selected_plan"]
            check_correction_guard(self.db, plan_ids=[before["id"]], task_ids=[timer["task_id"]])
            if policy in ("fit", "split"):
                rows = []
                for index, part in enumerate(preview["actual_parts"]):
                    start = datetime.fromisoformat(part["start_time"]).replace(tzinfo=None).isoformat()
                    end = datetime.fromisoformat(part["end_time"]).replace(tzinfo=None).isoformat()
                    rows.append(
                        {
                            **before,
                            "id": before["id"] if index == 0 else str(uuid7()),
                            "start_time": start,
                            "end_time": end,
                            "original_start": before["original_start"] if index == 0 else start,
                            "original_end": before["original_end"] if index == 0 else end,
                            "revision": before["revision"] + 1 if index == 0 else 1,
                        }
                    )
                    for segment in timer["segments"]:
                        if (
                            not segment.get("recorded_work_id")
                            and part["start_time"] <= segment["start_time"]
                            and segment["end_time"] <= part["end_time"]
                        ):
                            segment["scheduled_session_id"] = rows[-1]["id"]
                timer["scheduled_session_id"] = rows[0]["id"]
                plan_changes = {"before": before, "rows": rows}
                details["schedule"] = {
                    "source_plan_id": before["id"],
                    "source_plan_before": before,
                    "original_start": before["original_start"] + "Z",
                    "original_end": before["original_end"] + "Z",
                    "part_ids": [p["id"] for p in rows],
                }
            else:
                details["replacement"] = {
                    "unsaved_segments": deepcopy(preview["unsaved_segments"]),
                    "plan_before": before,
                }
                timer["segments"] = [
                    {
                        "id": str(uuid7()),
                        "start_time": before["start_time"] + "+00:00",
                        "end_time": before["end_time"] + "+00:00",
                        "task_id": timer["task_id"],
                        "scheduled_session_id": before["id"],
                        "tags": timer["tags"],
                        "notes": timer["notes"],
                    }
                ]
                timer["scheduled_session_id"] = before["id"]
        timer.pop("stop_review")
        if policy == "continue":
            from timetrace.core.correction_identity import evidence

            timer["running_start"] = cutoff
            timer["running_segment_id"] = str(uuid7())
            timer["running_evidence"] = evidence(cutoff, "resume")
            timer["manual_pause_note_segment_id"] = None
            timer["state"] = "running"
            if timer.get("focus"):
                timer["focus"]["recording_anchor"] = cutoff
        else:
            timer["state"] = "stopped"
            timer["manual_pause_note_segment_id"] = None
            if timer.get("focus"):
                timer["focus"]["phase"] = "disabled"
                timer["focus"]["recording_anchor"] = None
        dependencies = (
            {
                "task": preview["manifest"]["task"],
                "recurrence": preview["manifest"]["recurrence"],
                "plan": preview["manifest"]["selected_plan"],
            }
            if policy in ("fit", "split", "scheduled")
            else None
        )
        return plan_changes, details, dependencies
