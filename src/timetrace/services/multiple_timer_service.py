"""Targeted timers: one durable transition funnel for every writer."""

import hashlib
import hmac
import json
import os
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import RLock
from uuid import uuid7

from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import or_, select

from timetrace.config import settings
from timetrace.core.correction_identity import evidence, initialize_identities, signing_key
from timetrace.core.correction_step import (
    covered_seconds,
    fingerprint,
    move_start,
    signature,
    step_start,
    subtract_interval,
)
from timetrace.core.exceptions import ConflictError, EntityNotFoundError, TimerError
from timetrace.core.recurrence import is_occurrence_id
from timetrace.core.timer_store import TimerStore
from timetrace.core.timezones import validate_local_instant
from timetrace.db.models import (
    AIDraftItem,
    MutationOperation,
    RatingDefinition,
    RatingEntry,
    RecurrenceException,
    ScheduledSession,
    Task,
)
from timetrace.db.session import lock_sqlite_writer
from timetrace.interfaces.api.schemas import RecordedWorkCreate
from timetrace.services.session_service import SessionService

_writes = RLock()


class MultipleTimerService:
    def __init__(self, db):
        self.db = db
        self.store = TimerStore(
            Path(os.environ.get("TIMETRACE_TIMER_STATE_FILE", settings.db_file.parent / "active_timer.json"))
        )

    def correction_preview(self, timer_id, request):
        """Non-writing preparation gate; signed corrections are not enabled yet.

        Do not use get/list/read or take the store lock here: those paths can
        reconcile receipts, migrate legacy JSON or create directory entries.
        """
        state = self.store.inspect()
        with self.db.no_autoflush:
            pending_receipt = self.db.exec(
                select(MutationOperation.id).where(MutationOperation.file_finalized.is_(False)).limit(1)
            ).first()
        if state.get("pending_operation") or pending_receipt:
            raise ConflictError(
                "Recover the outstanding timer operation before preparing a correction.",
                code="reconciliation_required",
            )
        if state.get("version") != 2 and "is_running" not in state:
            raise ConflictError("Unknown timer format; preserve it for recovery.", code="reconciliation_required")
        if state.get("correction_initialized"):
            with self.db.no_autoflush:
                self.db.expire_all()
                return self._step_preview(state, timer_id, request, datetime.now(UTC).isoformat())
        raise ConflictError(
            "Explicit correction initialization is required. Corrections are not available in this build; "
            "existing timer controls remain available.",
            code="correction_initialization_required",
        )

    def _step_preview(self, state, timer_id, request, cutoff, allocated=None):
        if request["change"]["kind"] == "exclude":
            return self._exclusion_preview(state, timer_id, request, cutoff, allocated)
        if request["target"]["kind"] == "selection":
            raise TimerError("Multiple targets are only supported for explicit exclusions.")
        key = signing_key(settings.db_file.parent / "correction-signing.key")
        timer = state["timers"].get(timer_id)
        if timer is None:
            raise EntityNotFoundError("Timer", timer_id)
        if timer["state"] in ("stopped", "frozen") or any(g.get("decision") is None for g in timer["idle_gaps"]):
            raise ConflictError("Resolve idle or select unfinished work first.", code="idle_gap_unresolved")
        target = request["target"]
        if target["kind"] == "running":
            if timer["state"] != "running" or target["segment_id"] != timer.get("running_segment_id"):
                raise ConflictError("Running target changed.", code="correction_target_stale")
            start, end, bound = timer["running_start"], cutoff, timer.get("running_evidence")
        elif target["kind"] == "buffered":
            segment = next((s for s in timer["segments"] if s["id"] == target["segment_id"]), None)
            if segment is None or segment.get("recorded_work_id"):
                raise ConflictError("Select an explicit uncommitted interval.", code="correction_target_stale")
            start, end, bound = segment["start_time"], segment["end_time"], segment.get("correction_evidence")
        else:
            raise ConflictError(
                "Saved corrections require the later lineage implementation.", code="unsupported_work_kind"
            )
        if datetime.fromisoformat(end) > datetime.fromisoformat(cutoff):
            raise TimerError("Future work cannot be corrected.")
        change = request["change"]
        if change["kind"] == "set_start":
            try:
                proposed = validate_local_instant(
                    change["start_utc"], change["local_datetime"], change["timezone"], change["offset_seconds"]
                )
            except (ValueError, KeyError) as exc:
                raise TimerError(
                    "Choose a valid explicit local time, IANA zone, offset and matching UTC instant."
                ) from exc
            request = deepcopy(request)
            request["change"]["start_utc"] = proposed
            proposed, duration = move_start(start, end, proposed, bound)
        else:
            proposed, duration = step_start(start, end, change["credited_delta_seconds"], bound)
        dependencies = self._correction_dependencies(timer)
        envelope = {
            "schema_version": 1,
            "resource": f"/timers/{timer_id}",
            "action": "step_start",
            "request": request,
            "cutoff": cutoff,
            "timer_revision": timer["revision"],
            "dependency_digest": fingerprint(dependencies),
            "before": {"start_utc": start, "end_utc": end},
            "after": {"start_utc": proposed, "end_utc": end},
            "duration_seconds": duration,
            "warnings": ["Running work continues after this preview cutoff."] if target["kind"] == "running" else [],
        }
        if change["kind"] == "set_start":
            from zoneinfo import ZoneInfo

            zone = ZoneInfo(change["timezone"])
            before_local = datetime.fromisoformat(start).astimezone(zone)
            after_local = datetime.fromisoformat(proposed).astimezone(zone)
            envelope.update(
                schema_version=2,
                action="set_start",
                presentation={
                    "timezone": change["timezone"],
                    "before_local": before_local.isoformat(),
                    "after_local": after_local.isoformat(),
                    "before_local_day": before_local.date().isoformat(),
                    "after_local_day": after_local.date().isoformat(),
                    "day_rebucket": str(before_local.date() != after_local.date()),
                    "before_duration_seconds": str(
                        int((datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds())
                    ),
                    "after_duration_seconds": str(duration),
                },
            )
        envelope["signature"] = signature(envelope, key)
        return envelope

    def _correction_dependencies(self, timer):
        contexts = [timer, *timer["segments"]]
        task_ids = sorted({c["task_id"] for c in contexts if c.get("task_id")})
        plan_ids = sorted({c["scheduled_session_id"] for c in contexts if c.get("scheduled_session_id")})
        dependencies = {
            "timer": timer,
            "tasks": [self.db.get(Task, i).model_dump(mode="json") if self.db.get(Task, i) else None for i in task_ids],
            "plans": [
                self.db.get(ScheduledSession, i).model_dump(mode="json") if self.db.get(ScheduledSession, i) else None
                for i in plan_ids
            ],
        }
        from timetrace.services.plan_removal_service import PlanRemovalService

        ratings = self.db.exec(
            select(RatingEntry).where(RatingEntry.target_id.in_(task_ids)).order_by(RatingEntry.id)
        ).all()
        dependencies["task_ratings"] = [r.model_dump(mode="json") for r in ratings]
        definition_ids = sorted({r.rating_definition_id for r in ratings})
        dependencies["rating_definitions"] = [
            self.db.get(RatingDefinition, i).model_dump(mode="json") if self.db.get(RatingDefinition, i) else None
            for i in definition_ids
        ]
        drafts = self.db.exec(
            select(AIDraftItem)
            .where(or_(AIDraftItem.target_id.in_(task_ids), AIDraftItem.applied_entity_id.in_(task_ids)))
            .order_by(AIDraftItem.id)
        ).all()
        dependencies["task_drafts"] = [r.model_dump(mode="json") for r in drafts]
        dependencies["plan_manifests"] = []
        for plan_id in plan_ids:
            manifest = PlanRemovalService(self.db)._manifest(plan_id)
            # Only the selected timer is approved; other timer activity is not a dependency.
            manifest.pop("unfinished_timers", None)
            dependencies["plan_manifests"].append(manifest)
            for rating in manifest["ratings"]:
                definition = self.db.get(RatingDefinition, rating["rating_definition_id"])
                dependencies["rating_definitions"].append(definition.model_dump(mode="json") if definition else None)
        return dependencies

    def _accept_step(self, after, timer_id, envelope):
        key = signing_key(settings.db_file.parent / "correction-signing.key")
        if not hmac.compare_digest(envelope["signature"], signature(envelope, key)):
            raise ConflictError("Correction approval authentication failed.", code="correction_preview_invalid")
        if envelope["resource"] != f"/timers/{timer_id}":
            raise ConflictError("Correction approval belongs to another resource.", code="correction_preview_invalid")
        self.db.expire_all()
        try:
            rebuilt = self._step_preview(
                after,
                timer_id,
                envelope["request"],
                envelope["cutoff"],
                envelope.get("after") if envelope["action"] == "exclude" else None,
            )
        except (TimerError, EntityNotFoundError, ConflictError) as exc:
            raise ConflictError("Correction target changed; preview again.", code="correction_preview_stale") from exc
        if rebuilt != envelope:
            raise ConflictError("Correction dependencies changed; preview again.", code="correction_preview_stale")
        timer = after["timers"][timer_id]
        if envelope["action"] == "exclude":
            self._install_exclusion(timer, envelope)
            timer["revision"] += 1
            return timer
        target = envelope["request"]["target"]
        if target["kind"] == "running":
            timer["running_start"] = envelope["after"]["start_utc"]
        else:
            segment = next(s for s in timer["segments"] if s["id"] == target["segment_id"])
            segment["start_time"] = envelope["after"]["start_utc"]
        timer["revision"] += 1
        return timer

    def _exclusion_preview(self, state, timer_id, request, cutoff, allocated=None):
        key = signing_key(settings.db_file.parent / "correction-signing.key")
        timer = state["timers"].get(timer_id)
        if timer is None:
            raise EntityNotFoundError("Timer", timer_id)
        if timer["state"] in ("stopped", "frozen") or any(g.get("decision") is None for g in timer["idle_gaps"]):
            raise ConflictError("Resolve idle before correcting work.", code="idle_gap_unresolved")
        request = deepcopy(request)
        change = request["change"]
        try:
            for side in ("start", "end"):
                change[side + "_utc"] = validate_local_instant(
                    change[side + "_utc"],
                    change[side + "_local_datetime"],
                    change["timezone"],
                    change[side + "_offset_seconds"],
                )
        except (ValueError, KeyError) as exc:
            raise TimerError("Choose matching explicit dates, zone, offsets and UTC exclusion endpoints.") from exc
        target = request["target"]
        targets = target["targets"] if target["kind"] == "selection" else [target]
        identities = [t.get("segment_id") for t in targets]
        if len(set(identities)) != len(identities):
            raise TimerError("Duplicate exclusion targets are not allowed.")
        targets = sorted(targets, key=lambda t: (t["kind"], t.get("segment_id", "")))
        if target["kind"] == "selection":
            request["target"]["targets"] = targets
        before, after = [], []
        removed = 0
        all_ids = {s["id"] for t in state["timers"].values() for s in t["segments"]}
        all_ids.update(t.get("running_segment_id") for t in state["timers"].values())
        new_ids = set()
        for selected in targets:
            identity = selected.get("segment_id")
            running = selected["kind"] == "running"
            if running:
                if timer["state"] != "running" or identity != timer.get("running_segment_id"):
                    raise ConflictError("Running target changed.", code="correction_target_stale")
                start, end = timer["running_start"], cutoff
                boundary = timer.get("running_evidence")
            elif selected["kind"] == "buffered":
                segment = next((s for s in timer["segments"] if s["id"] == identity), None)
                if segment is None or segment.get("recorded_work_id"):
                    raise ConflictError("Select owned uncommitted work.", code="correction_target_stale")
                start, end = segment["start_time"], segment["end_time"]
                boundary = segment.get("correction_evidence")
            else:
                raise ConflictError("Saved corrections require lineage staging.", code="unsupported_work_kind")
            move_start(start, end, start, boundary)
            kept, coverage = subtract_interval(start, end, change["start_utc"], change["end_utc"], cutoff)
            removed += coverage
            before.append(
                {
                    "source_segment_id": identity,
                    "segment_id": identity,
                    "start_utc": start,
                    "end_utc": end,
                    "running": running,
                }
            )
            if running and kept[-1][1] != end:
                kept.append((end, end))  # Ongoing continuation after the pinned cutoff; never saved as zero work.
            for index, (left, right) in enumerate(kept):
                fragment_id = identity
                if index:
                    candidates = [f for f in (allocated or []) if f["source_segment_id"] == identity]
                    fragment_id = (
                        candidates[index]["segment_id"]
                        if allocated is not None and len(candidates) > index
                        else str(uuid7())
                    )
                    if fragment_id in all_ids or fragment_id in new_ids:
                        raise ConflictError("Fragment identity collision.", code="correction_preview_invalid")
                    new_ids.add(fragment_id)
                after.append(
                    {
                        "source_segment_id": identity,
                        "segment_id": fragment_id,
                        "start_utc": left,
                        "end_utc": right,
                        "running": running and index == len(kept) - 1,
                    }
                )
        total_range = int(
            (datetime.fromisoformat(change["end_utc"]) - datetime.fromisoformat(change["start_utc"])).total_seconds()
        )
        intervals = [(s["start_time"], s["end_time"]) for s in timer["segments"]]
        if timer["state"] == "running":
            intervals.append((timer["running_start"], cutoff))
        existing_coverage = covered_seconds(intervals, change["start_utc"], change["end_utc"])
        result = {
            "schema_version": 2,
            "resource": f"/timers/{timer_id}",
            "action": "exclude",
            "request": request,
            "cutoff": cutoff,
            "timer_revision": timer["revision"],
            "dependency_digest": fingerprint(self._correction_dependencies(timer)),
            "before": before,
            "after": after,
            "removed_seconds": removed,
            "already_uncredited_seconds": max(0, total_range - existing_coverage),
            "unselected_covered_seconds": max(0, existing_coverage - removed),
            "warnings": [
                "Every selected interval must retain positive work; complete removal is unsupported.",
                "Already-uncredited gaps and unselected covered work are unchanged.",
                "Splitting the current paused note target clears its pointer; choose an explicit description target.",
            ],
        }
        result["signature"] = signature(result, key)
        return result

    @staticmethod
    def _install_exclusion(timer, envelope):
        change = envelope["request"]["change"]
        for source in envelope["before"]:
            identity = source["segment_id"]
            running = source["running"]
            original = timer if running else next(s for s in timer["segments"] if s["id"] == identity)
            boundary = deepcopy(original["running_evidence"] if running else original["correction_evidence"])
            boundary["forbidden_ranges"].append({"start_utc": change["start_utc"], "end_utc": change["end_utc"]})
            fragments = [f for f in envelope["after"] if f["source_segment_id"] == identity]
            if not running:
                timer["segments"].remove(original)
            for fragment in fragments:
                if fragment["running"]:
                    timer["running_segment_id"] = fragment["segment_id"]
                    timer["running_start"] = fragment["start_utc"]
                    timer["running_evidence"] = deepcopy(boundary)
                else:
                    snapshot = (
                        {k: deepcopy(original.get(k)) for k in ("task_id", "scheduled_session_id", "tags", "notes")}
                        if running
                        else deepcopy(original)
                    )
                    timer["segments"].append(
                        {
                            **snapshot,
                            "id": fragment["segment_id"],
                            "start_time": fragment["start_utc"],
                            "end_time": fragment["end_utc"],
                            "correction_evidence": deepcopy(boundary),
                        }
                    )
            if len(fragments) > 1 and timer.get("manual_pause_note_segment_id") == identity:
                timer["manual_pause_note_segment_id"] = None
        timer["segments"].sort(key=lambda s: (s["start_time"], s["id"]))

    def unfinished_for_plan(self, plan_id):
        """Read while holding SQLite's writer lock for a destructive/extension manifest.

        Includes current context, uncommitted segment contexts and unresolved gap contexts.
        Pending intent's after-state is included conservatively; this method never reconciles
        or writes while a caller holds SQLite, avoiding lock inversion.
        """
        if not self.store.path.exists():
            return []
        try:
            state = json.loads(self.store.path.read_text(encoding="utf-8"))
            if state.get("version") != 2:
                return []  # V1 has no scheduled-plan associations.
            states = [state]
            if state.get("pending_operation"):
                states.append(json.loads(state["pending_operation"]["after_state_json"]))
            found = {}
            for snapshot in states:
                for timer in snapshot["timers"].values():
                    if timer["state"] == "stopped":
                        continue
                    contexts = [
                        timer,
                        *[s for s in timer["segments"] if not s.get("recorded_work_id")],
                        *[g for g in timer["idle_gaps"] if g.get("decision") is None],
                    ]
                    if any(c.get("scheduled_session_id") == plan_id for c in contexts):
                        found[timer["id"]] = deepcopy(timer)
            return list(found.values())
        except (ValueError, KeyError, TypeError) as exc:
            raise ConflictError("Timer association state cannot be verified.", code="reconciliation_required") from exc

    def has_task_context(self, task_ids):
        """Conservative read for a caller already holding the SQLite writer lock.

        Atomic replacement makes this read coherent without inverting DB/advisory lock order.
        Unfinished before-state during reconciliation is deliberately still protected.
        """
        if not self.store.path.exists():
            return False
        try:
            state = json.loads(self.store.path.read_text(encoding="utf-8"))
            if state.get("version") != 2:
                return state.get("task_id") in task_ids and (state.get("is_running") or state.get("is_frozen_idle"))
            snapshots = [state]
            if state.get("pending_operation"):
                snapshots.append(json.loads(state["pending_operation"]["after_state_json"]))
            for snapshot in snapshots:
                for timer in snapshot["timers"].values():
                    if timer["state"] == "stopped":
                        continue
                    contexts = [
                        timer,
                        *[s for s in timer["segments"] if not s.get("recorded_work_id")],
                        *[g for g in timer["idle_gaps"] if g.get("decision") is None],
                    ]
                    if any(c.get("task_id") in task_ids for c in contexts):
                        return True
            return False
        except (ValueError, KeyError, TypeError) as exc:
            raise ConflictError("Timer state cannot be verified.", code="reconciliation_required") from exc

    def list_timers(self):
        with _writes, self.store.locked():
            state = self.store.read()
            timers = []
            now = datetime.now(UTC)
            for timer in state["timers"].values():
                if timer["state"] == "stopped":
                    continue
                timer = deepcopy(timer)
                task = self.db.get(Task, timer["task_id"]) if timer["task_id"] else None
                timer["task_title"] = task.title if task else None
                elapsed = sum(
                    (datetime.fromisoformat(s["end_time"]) - datetime.fromisoformat(s["start_time"])).total_seconds()
                    for s in timer["segments"]
                )
                if timer["running_start"]:
                    elapsed += (now - datetime.fromisoformat(timer["running_start"])).total_seconds()
                timer["elapsed_seconds"] = elapsed
                target = timer.get("target_minutes")
                timer["remaining_seconds"] = (
                    max(0, target * 60 - elapsed) if timer["mode"] == "pomodoro" and target else None
                )
                timers.append(timer)
            return {
                "revision": state["revision"],
                "timers": timers,
                "idle_detection_enabled": state.get("idle_detection_enabled", settings.idle_detection_enabled),
                "idle_threshold_seconds": state.get("idle_threshold_seconds", settings.idle_threshold_seconds),
            }

    def assistant_status(self):
        """Read-only multi-timer context without opaque migration/recovery payloads."""
        status = self.list_timers()
        for timer in status["timers"]:
            timer.pop("legacy_payload", None)
            timer.pop("segments", None)
            for gap in timer["idle_gaps"]:
                gap.pop("legacy_payload", None)
        status["next_scheduled_session"] = None
        if not any(t["state"] == "running" for t in status["timers"]):
            upcoming = SessionService(self.db).next_upcoming_occurrence()
            if upcoming:
                start = upcoming["start_time"]
                if start.tzinfo is None:
                    start = start.replace(tzinfo=UTC)
                status["next_scheduled_session"] = {
                    "title": upcoming["title"],
                    "start_time": start.isoformat(),
                    "starts_in_minutes": max(1, int((start - datetime.now(UTC)).total_seconds() / 60)),
                }
        return status

    def get_timer(self, timer_id):
        status = self.list_timers()
        found = next((t for t in status["timers"] if t["id"] == timer_id), None)
        if found:
            return found
        with _writes, self.store.locked():
            timer = self.store.read()["timers"].get(timer_id)
            if timer is None:
                raise EntityNotFoundError("Timer", timer_id)
            return deepcopy(timer)

    @staticmethod
    def select_one(timers):
        if len(timers) > 1:
            raise ConflictError(
                "Explicit timer target required; candidates: " + ", ".join(t["id"] for t in timers),
                code="ambiguous_timer_target",
            )
        if not timers:
            raise TimerError("No timer is currently active.")
        return timers[0]

    def reconcile(self):
        """Startup barrier: recover fixed transitions without inventing activity or cutoffs."""
        with _writes, self.store.locked():
            try:
                return self._reconcile()["revision"]
            except (OSError, SQLAlchemyError) as exc:
                self.db.rollback()
                raise ConflictError(
                    "Timer persistence requires reconciliation; retain the operation ID.",
                    code="reconciliation_required",
                ) from exc
            except Exception:
                self.db.rollback()
                raise

    def operation(self, operation_id):
        with _writes, self.store.locked():
            receipt = self.db.get(MutationOperation, operation_id)
            pending = self.store.read().get("pending_operation")
            if receipt:
                return {
                    "operation_id": operation_id,
                    "status": "finalized" if receipt.file_finalized else "pending_reconciliation",
                    "result": json.loads(receipt.result_json) if receipt.file_finalized else None,
                }
            if pending and pending["id"] == operation_id:
                return {"operation_id": operation_id, "status": "pending_reconciliation", "result": None}
            raise EntityNotFoundError("Operation", operation_id)

    def start(self, payload):
        return self.mutate("start", None, payload)

    def delete_tasks(self, root_ids, *, allow_plan_detachment=True):
        return self.mutate(
            "delete_tasks",
            None,
            {"operation_id": str(uuid7()), "root_ids": root_ids, "allow_plan_detachment": allow_plan_detachment},
        )

    def observe_activity(self, idle_seconds):
        return self.mutate("activity", None, {"operation_id": str(uuid7()), "idle_seconds": idle_seconds})

    def mutate(self, action, timer_id, payload):
        payload = {**payload, "action": action, "timer_id": timer_id}
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
                    if action == "correction_initialize":
                        signing_key(settings.db_file.parent / "correction-signing.key")
                    return json.loads(receipt.result_json)
                cutoff = datetime.now(UTC).isoformat()
                after = deepcopy(state)
                task_deletion = None
                plan_capture = None
                if action == "correction_initialize":
                    for item in after["timers"].values():
                        previous = deepcopy(item)
                        initialize_identities(item)
                        if item != previous:
                            item["revision"] += 1
                    signing_key(settings.db_file.parent / "correction-signing.key", create=True)
                    after["correction_initialized"] = True
                    timer, selected = None, False
                elif action == "correction":
                    if not after.get("correction_initialized"):
                        raise ConflictError("Initialize corrections first.", code="correction_initialization_required")
                    timer, selected = self._accept_step(after, timer_id, payload["preview"]), False
                elif action == "start":
                    timer, selected, plan_capture = self._start(after, payload, cutoff)
                elif action == "delete_tasks":
                    task_deletion = self._prepare_task_deletion(after, payload)
                    timer, selected = None, False
                elif action == "activity":
                    if payload["idle_seconds"] is not None and after.get(
                        "idle_detection_enabled", settings.idle_detection_enabled
                    ):
                        self._activity(after, payload["idle_seconds"], cutoff)
                    timer, selected = None, False
                    if after == state:
                        self.db.rollback()
                        return {"timer": None, "operation_id": operation_id}
                elif action == "idle_toggle":
                    current = after.get("idle_detection_enabled", settings.idle_detection_enabled)
                    after["idle_detection_enabled"] = (
                        not current if payload.get("enabled") is None else payload["enabled"]
                    )
                    timer, selected = None, False
                else:
                    selected = False
                    if timer_id is None:
                        timer_id = self.select_one([t for t in after["timers"].values() if t["state"] != "stopped"])[
                            "id"
                        ]
                    timer = after["timers"].get(timer_id)
                    if timer is None:
                        raise EntityNotFoundError("Timer", timer_id)
                    if payload.get("expected_revision") not in (None, timer["revision"]):
                        raise ConflictError("Timer changed.", code="revision_stale")
                    if timer["state"] == "stopped":
                        raise TimerError("Timer is stopped.")
                    if action != "resolve" and any(g.get("decision") is None for g in timer["idle_gaps"]):
                        raise ConflictError("Resolve idle gaps first.", code="idle_gap_unresolved")
                    continue_running = timer["state"] == "running"
                    if action in ("pause", "stop", "split"):
                        closed_id = self._close_segment(timer, cutoff)
                        timer["manual_pause_note_segment_id"] = closed_id if action == "pause" else None
                        timer["state"] = "paused"
                    elif action == "note":
                        if not isinstance(payload.get("new_notes"), str) or len(payload["new_notes"]) > 100000:
                            raise TimerError("Current work note must be text of at most 100000 characters.")
                        if payload.get("expected_revision") is None:
                            raise TimerError("A current timer revision is required to edit its note.")
                        target_id = payload.get("expected_note_segment_id")
                        if timer["state"] == "paused":
                            pointer = timer.get("manual_pause_note_segment_id")
                            target = next((s for s in timer["segments"] if s["id"] == pointer), None)
                            if not pointer or target_id != pointer or not target or target.get("recorded_work_id"):
                                raise ConflictError(
                                    "No eligible current manual-pause note interval; refresh and review.",
                                    code="note_target_stale",
                                )
                            target["notes"] = payload["new_notes"]
                        elif timer["state"] != "running" or target_id is not None:
                            raise ConflictError(
                                "Current note target changed; refresh and review.", code="note_target_stale"
                            )
                        timer["notes"] = payload["new_notes"]
                    elif action == "idle_preference":
                        if not isinstance(payload.get("pause_when_idle"), bool):
                            raise TimerError("Choose whether to pause when idle.")
                        timer["pause_when_idle"] = payload["pause_when_idle"]
                    elif action == "resolve":
                        self._resolve(timer, payload)
                    elif action == "resume":
                        if timer["state"] != "paused":
                            raise TimerError("Timer is not paused.")
                        timer["running_start"] = cutoff
                        timer["running_segment_id"] = str(uuid7())
                        timer["running_evidence"] = evidence(cutoff, "resume")
                        timer["manual_pause_note_segment_id"] = None
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
                        timer["state"] = "running" if continue_running else "paused"
                        timer["running_start"] = cutoff if continue_running else None
                        if continue_running:
                            timer["running_segment_id"] = str(uuid7())
                            timer["running_evidence"] = evidence(cutoff, "context_split")
                after["revision"] += 1
                information = []
                if action == "start":
                    requested = payload.get("scheduled_session_id")
                    if selected and requested != timer["scheduled_session_id"]:
                        information.append(
                            {
                                "code": "association_not_changed",
                                "requested": requested,
                                "current": timer["scheduled_session_id"],
                            }
                        )
                    plan_id = timer["scheduled_session_id"]
                    plan = self.db.get(ScheduledSession, plan_id) if plan_id else None
                    if plan and plan.end_time.replace(tzinfo=UTC) <= datetime.fromisoformat(cutoff):
                        information.append({"code": "scheduled_session_ended"})
                result = {
                    "timer": timer,
                    "selected_existing": selected,
                    "information": information,
                    "operation_id": operation_id,
                    "recorded_work_ids": [s["recorded_work_id"] for s in work],
                }
                if action == "correction":
                    result["correction"] = {
                        "before": payload["preview"]["before"],
                        "after": payload["preview"]["after"],
                        "target": payload["preview"]["request"]["target"],
                        "timer_revision": timer["revision"],
                    }
                if action == "correction_initialize":
                    result["correction_initialized"] = True
                intent = {
                    "id": operation_id,
                    "payload_hash": digest,
                    "before_revision": state["revision"],
                    "after_revision": after["revision"],
                    "cutoff": cutoff,
                    "after_state_json": json.dumps(after),
                    "result_json": json.dumps(result),
                    "work": work,
                    "task_deletion": task_deletion,
                    "plan_capture": plan_capture,
                    "plan_update": (
                        {"id": timer["scheduled_session_id"], "expected_revision": payload["expected_plan_revision"]}
                        if action == "start" and not selected and not plan_capture and timer["scheduled_session_id"]
                        else None
                    ),
                }
                if intent["plan_update"]:
                    result["plan_revision"] = intent["plan_update"]["expected_revision"] + 1
                    intent["result_json"] = json.dumps(result)
                if plan_capture:
                    result["plan_revision"] = 1
                    result["captured_plan_id"] = plan_capture["id"]
                    result["requested_scheduled_session_id"] = payload["scheduled_session_id"]
                    intent["result_json"] = json.dumps(result)
                if task_deletion:
                    result["deleted_count"] = len(task_deletion["root_ids"])
                    intent["result_json"] = json.dumps(result)
                state["pending_operation"] = intent
                self.store.write(state)
                self._complete(intent)
                return result
            except (OSError, SQLAlchemyError) as exc:
                self.db.rollback()
                raise ConflictError(
                    "Timer persistence requires reconciliation; retain the operation ID.",
                    code="reconciliation_required",
                ) from exc
            except Exception:
                self.db.rollback()
                raise

    def _prepare_task_deletion(self, after, payload):
        from timetrace.services.task_service import TaskService

        root_ids = payload["root_ids"]
        if root_ids is None:
            root_ids = [
                t.id for t in self.db.exec(select(Task).where(Task.status.in_(["Done", "completed", "done"]))).all()
            ]
        scope = set(root_ids)
        for task_id in root_ids:
            if self.db.get(Task, task_id) is None:
                raise EntityNotFoundError("Task", task_id)
            scope.update(TaskService(self.db)._collect_subtree_ids(task_id))
        for timer in after["timers"].values():
            if timer["state"] == "stopped":
                continue
            for context in [timer, *timer["segments"], *timer["idle_gaps"]]:
                if context.get("task_id") in scope:
                    context["task_id"] = None
                    context["scheduled_session_id"] = None
                    timer["revision"] += 1
            if timer["task_id"] is None:
                timer["task_title"] = None
        return {"root_ids": root_ids, "scope": sorted(scope), "allow_plan_detachment": payload["allow_plan_detachment"]}

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
            return existing, True, None
        capture = None
        plan_id = payload.get("scheduled_session_id")
        if plan_id and is_occurrence_id(plan_id):
            occurrence = SessionService(self.db).recurrence.projected_occurrence(plan_id, planning=True)
            if occurrence.projection_revision != payload.get("expected_projection_revision"):
                raise ConflictError("Projection changed.", code="projection_stale")
            if task_id is None or task_id != occurrence.task_id:
                raise ConflictError("Association requires equal non-null tasks.", code="association_task_conflict")
            plan_id = str(uuid7())
            capture = {
                "id": plan_id,
                "task_id": task_id,
                "original_start": occurrence.start_utc.isoformat(),
                "original_end": occurrence.end_utc.isoformat(),
                "start_time": occurrence.start_utc.isoformat(),
                "end_time": occurrence.end_utc.isoformat(),
                "tags": occurrence.tags,
                "projection_id": payload["scheduled_session_id"],
                "projection_revision": occurrence.projection_revision,
            }
        elif plan_id:
            plan = self.db.get(ScheduledSession, plan_id)
            if plan is None:
                raise EntityNotFoundError("Scheduled session", plan_id)
            if task_id is None or plan.task_id != task_id:
                raise ConflictError("Association requires equal non-null tasks.", code="association_task_conflict")
            if plan.revision != payload.get("expected_plan_revision"):
                raise ConflictError("Plan changed.", code="revision_stale")
        timer = {
            "id": str(uuid7()),
            "state": "running",
            "revision": 1,
            "task_id": task_id,
            "task_title": task.title if task else None,
            "scheduled_session_id": plan_id,
            "tags": payload.get("tags", ""),
            "notes": payload.get("notes", ""),
            "mode": payload.get("mode", "flowtime"),
            "target_minutes": payload.get("target_minutes"),
            "pause_when_idle": payload.get("pause_when_idle", True),
            "segments": [],
            "running_start": cutoff,
            "running_segment_id": str(uuid7()),
            "running_evidence": evidence(None, "uninterrupted"),
            "idle_gaps": [],
        }
        after["timers"][timer["id"]] = timer
        return timer, False, capture

    def _activity(self, after, idle_seconds, cutoff):
        now = datetime.fromisoformat(cutoff)
        last_activity = (now - timedelta(seconds=max(0, idle_seconds))).isoformat()
        threshold = after.get("idle_threshold_seconds", settings.idle_threshold_seconds)
        for timer in after["timers"].values():
            if timer["state"] == "running" and timer["pause_when_idle"] and idle_seconds >= threshold:
                onset = max(last_activity, timer["running_start"])
                self._close_segment(timer, onset)
                timer["manual_pause_note_segment_id"] = None
                timer["idle_gaps"].append(
                    {
                        "id": str(uuid7()),
                        "onset": onset,
                        "return_at": None,
                        "decision": None,
                        "boundary_source": "observed_idle",
                        "task_id": timer["task_id"],
                        "scheduled_session_id": timer["scheduled_session_id"],
                        "tags": timer["tags"],
                        "notes": timer["notes"],
                    }
                )
                timer["state"] = "frozen"
                timer["revision"] += 1
            elif timer["state"] == "frozen" and idle_seconds < threshold:
                for gap in timer["idle_gaps"]:
                    if gap["return_at"] is None and last_activity >= gap["onset"]:
                        gap["return_at"] = last_activity
                        timer["revision"] += 1

    @staticmethod
    def _resolve(timer, payload):
        gap = next((g for g in timer["idle_gaps"] if g["id"] == payload.get("gap_id")), None)
        if gap is None:
            raise EntityNotFoundError("Idle gap", payload.get("gap_id"))
        if gap["decision"] is not None or gap["return_at"] is None:
            raise ConflictError("Gap is unresolved or has no proven return.", code="idle_gap_unresolved")
        decision = payload.get("decision")
        if decision not in ("claim", "discard"):
            raise TimerError("Choose claim or discard.")
        if decision == "claim" and gap.get("boundary_source") == "legacy_uncertain":
            raise ConflictError(
                "Legacy first-return boundary is uncertain; discard or retain for explicit review.",
                code="idle_boundary_uncertain",
            )
        if decision == "claim" and gap["return_at"] > gap["onset"]:
            timer["segments"].append(
                {
                    "id": str(uuid7()),
                    "correction_evidence": evidence(gap["onset"], "idle_claim"),
                    "start_time": gap["onset"],
                    "end_time": gap["return_at"],
                    "task_id": gap["task_id"],
                    "scheduled_session_id": gap["scheduled_session_id"],
                    "tags": gap["tags"],
                    "notes": gap["notes"],
                }
            )
        gap["decision"] = decision
        timer["manual_pause_note_segment_id"] = None
        timer["state"] = "paused"

    @staticmethod
    def _close_segment(timer, cutoff):
        start = timer["running_start"]
        closed_id = None
        if start and cutoff > start:
            closed_id = timer.get("running_segment_id") or str(uuid7())
            timer["segments"].append(
                {
                    "id": closed_id,
                    **(
                        {"correction_evidence": deepcopy(timer["running_evidence"])}
                        if "running_evidence" in timer
                        else {}
                    ),
                    "start_time": start,
                    "end_time": cutoff,
                    "task_id": timer["task_id"],
                    "scheduled_session_id": timer["scheduled_session_id"],
                    "tags": timer["tags"],
                    "notes": timer["notes"],
                }
            )
        timer["running_start"] = None
        timer.pop("running_segment_id", None)
        timer.pop("running_evidence", None)
        return closed_id

    def _complete(self, intent):
        current = self.store.read()
        expected = json.loads(intent["after_state_json"])
        if current["revision"] not in (intent["before_revision"], intent["after_revision"]):
            raise ConflictError("Timer generation conflicts with intent.", code="reconciliation_required")
        if current["revision"] == intent["after_revision"] and current != expected:
            raise ConflictError("Timer state conflicts with intent.", code="reconciliation_required")
        lock_sqlite_writer(self.db)
        receipt = self.db.get(MutationOperation, intent["id"])
        if receipt is None:
            plan_update = intent.get("plan_update")
            if plan_update:
                plan = self.db.get(ScheduledSession, plan_update["id"])
                if plan is None or plan.revision != plan_update["expected_revision"]:
                    raise ConflictError("Pending timer plan context changed.", code="reconciliation_required")
                plan.revision += 1
                self.db.add(plan)
            capture = intent.get("plan_capture")
            if capture:
                occurrence = SessionService(self.db).recurrence.projected_occurrence(
                    capture["projection_id"], planning=True, accepted_at=datetime.fromisoformat(intent["cutoff"])
                )
                if occurrence.projection_revision != capture["projection_revision"]:
                    raise ConflictError("Pending projection capture changed.", code="reconciliation_required")
                self.db.add(
                    ScheduledSession.model_validate(
                        {k: v for k, v in capture.items() if k not in {"projection_id", "projection_revision"}}
                    )
                )
                self.db.flush()
                self.db.add(
                    RecurrenceException(
                        task_id=capture["task_id"],
                        occurrence_start=occurrence.start_utc,
                        kind="override",
                        scheduled_session_id=capture["id"],
                    )
                )
            deletion = intent.get("task_deletion")
            if deletion:
                from timetrace.services.task_service import TaskService

                TaskService(self.db).stage_task_deletion(
                    deletion["root_ids"],
                    set(deletion["scope"]),
                    allow_plan_detachment=deletion["allow_plan_detachment"],
                )
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
            receipt = MutationOperation(
                **{k: v for k, v in intent.items() if k not in {"work", "task_deletion", "plan_capture", "plan_update"}}
            )
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
