"""Exact plan-removal consent and database-only receipts, never timer transitions."""

import hashlib
import json
from datetime import UTC, datetime

from sqlalchemy import or_
from sqlmodel import select

from timetrace.core.exceptions import ConflictError, EntityNotFoundError, ValidationError
from timetrace.core.recurrence import is_occurrence_id
from timetrace.db.models import AIDraftItem, MutationOperation, RatingEntry, RecurrenceException, ScheduledSession
from timetrace.db.models import Session as Work
from timetrace.db.session import lock_sqlite_writer


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _fingerprint(value):
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


class PlanRemovalService:
    def __init__(self, db):
        self.db = db

    def _manifest(self, plan_id):
        from timetrace.services.multiple_timer_service import MultipleTimerService

        self.db.expire_all()
        if is_occurrence_id(plan_id):
            from timetrace.services.session_service import SessionService

            plan = SessionService(self.db).get_scheduled_session(plan_id)
            pending = MultipleTimerService(self.db).store.inspect().get("pending_operation") or {}
            capture = pending.get("plan_capture") or {}
            ratings = self.db.exec(
                select(RatingEntry).where(RatingEntry.target_id == plan_id).order_by(RatingEntry.id)
            ).all()
            drafts = self.db.exec(
                select(AIDraftItem)
                .where(or_(AIDraftItem.target_id == plan_id, AIDraftItem.applied_entity_id == plan_id))
                .order_by(AIDraftItem.id)
            ).all()
            return {
                "plan": plan.model_dump(mode="json"),
                "work": [],
                "recurrence": [],
                "lineage": [],
                "ratings": [r.model_dump(mode="json") for r in ratings],
                "drafts": [
                    {"id": r.id, "snapshot_fingerprint": _fingerprint(r.model_dump(mode="json"))} for r in drafts
                ],
                "unfinished_timers": MultipleTimerService(self.db).unfinished_for_plan(plan_id),
                "pending_capture_operation_id": pending.get("id") if capture.get("projection_id") == plan_id else None,
            }
        plan = self.db.get(ScheduledSession, plan_id)
        if plan is None:
            raise EntityNotFoundError("Scheduled session", plan_id)
        work = self.db.exec(select(Work).where(Work.scheduled_session_id == plan_id).order_by(Work.id)).all()
        ids = [plan_id, *[row.id for row in work]]
        ratings = self.db.exec(select(RatingEntry).where(RatingEntry.target_id.in_(ids)).order_by(RatingEntry.id)).all()
        anchors = self.db.exec(
            select(RecurrenceException)
            .where(
                or_(
                    RecurrenceException.scheduled_session_id == plan_id,
                    RecurrenceException.session_id.in_([row.id for row in work]),
                )
            )
            .order_by(RecurrenceException.id)
        ).all()
        drafts = self.db.exec(
            select(AIDraftItem)
            .where(
                or_(
                    AIDraftItem.target_id.in_(ids),
                    AIDraftItem.applied_entity_id.in_(ids),
                )
            )
            .order_by(AIDraftItem.id)
        ).all()
        from timetrace.db.models import WorkCorrection

        lineage = self.db.exec(
            select(WorkCorrection)
            .where(
                or_(
                    WorkCorrection.source_work_id.in_(ids),
                    *[WorkCorrection.results_json.contains(identity) for identity in ids],
                    *[
                        WorkCorrection.results_json.contains(row.timer_segment_id)
                        for row in work
                        if row.timer_segment_id
                    ],
                )
            )
            .order_by(WorkCorrection.id)
        ).all()
        return {
            "lineage": [
                {"id": e.id, "source_work_id": e.source_work_id, "fingerprint": _fingerprint(e.model_dump(mode="json"))}
                for e in lineage
            ],
            "plan": plan.model_dump(mode="json"),
            "work": [row.model_dump(mode="json") for row in work],
            "ratings": [row.model_dump(mode="json") for row in ratings],
            "recurrence": [row.model_dump(mode="json") for row in anchors],
            # Snapshot/audit content is not a mutable domain FK. Retain it, never cascade.
            "drafts": [
                {
                    "id": row.id,
                    "status": row.status,
                    "updated_at": row.updated_at.isoformat(),
                    "snapshot_fingerprint": _fingerprint(row.model_dump(mode="json")),
                }
                for row in drafts
            ],
            "unfinished_timers": MultipleTimerService(self.db).unfinished_for_plan(plan_id),
        }

    @staticmethod
    def _blocked(manifest):
        common = (
            ["Finish associated timers and resolve their gaps before changing this plan."]
            if manifest["unfinished_timers"]
            else []
        )
        if manifest.get("pending_capture_operation_id"):
            common.append("Recover the accepted timer capture before removing this occurrence.")
        delete = list(common)
        if manifest["plan"].get("is_virtual"):
            delete.append("Only Remove schedule for this exact projected occurrence is supported here.")
        if manifest["ratings"]:
            delete.append("Rated records require metadata-preserving removal, which is not supported.")
        if manifest["drafts"]:
            delete.append("AI draft restoration references require review; deletion is not supported.")
        if any(row["session_id"] for row in manifest["recurrence"]):
            delete.append("Associated work has a legacy recurrence anchor; deletion is not supported.")
        squeeze = list(common)
        if not manifest["work"]:
            squeeze.append("No explicitly linked recorded work to fit the schedule to.")
        if any(row["kind"] != "recorded_work" or not row["end_time"] for row in manifest["work"]):
            delete.append("Association includes unsupported work metadata.")
            squeeze.append("Association includes unsupported work metadata.")
        remove = list(common)
        if any(r["target_id"] == manifest["plan"]["id"] for r in manifest["ratings"]):
            remove.append("The plan itself has ratings; metadata-preserving plan removal is not supported.")
        if manifest["drafts"]:
            remove.append("AI draft restoration references require review before removing this schedule.")
        if any(row["kind"] != "recorded_work" or not row["end_time"] for row in manifest["work"]):
            remove.append("Association includes unsupported work metadata.")
        return {"delete_everything": delete, "squeeze": squeeze, "remove_schedule": remove}

    def preview(self, plan_id):
        try:
            lock_sqlite_writer(self.db)
            manifest = self._manifest(plan_id)
            return {"manifest": manifest, "consent_token": _fingerprint(manifest), "blocked": self._blocked(manifest)}
        finally:
            self.db.rollback()  # Release read-only writer reservation; preview persists nothing.

    def apply(self, plan_id, request):
        payload = {"plan_id": plan_id, **request.model_dump()}
        digest = _fingerprint(payload)
        operation_id = "plan-removal:" + request.operation_id
        try:
            lock_sqlite_writer(self.db)
            receipt = self.db.get(MutationOperation, operation_id)
            if receipt is not None:
                if receipt.payload_hash != digest:
                    raise ConflictError(
                        "Operation ID already confirms a different request.", code="operation_payload_conflict"
                    )
                result = json.loads(receipt.result_json)
                self.db.rollback()
                return result
            from timetrace.services.correction_guards import check_correction_guard

            check_correction_guard(self.db, plan_ids=[plan_id])
            try:
                manifest = self._manifest(plan_id)
            except EntityNotFoundError:
                if not is_occurrence_id(plan_id):
                    raise
                raise ConflictError(
                    "Occurrence changed or is unavailable; preview again.", code="stale_plan_manifest"
                ) from None
            if _fingerprint(manifest) != request.consent_token:
                raise ConflictError(
                    "Plan, work, dependencies or timer context changed. Preview again.", code="stale_plan_manifest"
                )
            reasons = self._blocked(manifest)[request.action]
            if reasons:
                raise ConflictError(" ".join(reasons), code="plan_removal_blocked")
            plan = self.db.get(ScheduledSession, plan_id)
            before = plan.revision if plan else 0
            ids = [row["id"] for row in manifest["work"]]
            if request.action == "squeeze":
                rows = [self.db.get(Work, work_id) for work_id in ids]
                if not rows:
                    raise ValidationError("No associated recorded work.")
                plan.start_time = min(row.start_time for row in rows)
                plan.end_time = max(row.end_time for row in rows)
                plan.revision += 1
                self.db.add(plan)
                from timetrace.services.session_service import SessionService

                result = {
                    "action": request.action,
                    "plan_id": plan_id,
                    "plan": SessionService(self.db).get_scheduled_session(plan_id).model_dump(mode="json"),
                }
            else:
                for anchor in manifest["recurrence"]:
                    if request.action == "remove_schedule" and anchor["scheduled_session_id"] != plan_id:
                        continue  # Work's historical recurrence anchor is not the removed plan.
                    row = self.db.get(RecurrenceException, anchor["id"])
                    row.kind = "skip"
                    row.scheduled_session_id = None
                    self.db.add(row)
                self.db.flush()
                for work_id in ids:
                    work = self.db.get(Work, work_id)
                    if request.action == "remove_schedule":
                        work.scheduled_session_id = None
                        work.revision += 1
                        self.db.add(work)
                    else:
                        self.db.delete(work)
                self.db.flush()
                if plan is None:
                    from timetrace.services.session_service import SessionService

                    SessionService(self.db).stage_remove_projected_plan(
                        plan_id, manifest["plan"]["projection_revision"]
                    )
                else:
                    self.db.delete(plan)
                if request.action == "remove_schedule":
                    result = {
                        "action": request.action,
                        "plan_id": plan_id,
                        "removed_plan": manifest["plan"],
                        "work_before": manifest["work"],
                        "preserved_work_ids": ids,
                        "deleted_work_ids": [],
                    }
                else:
                    result = {"action": request.action, "plan_id": plan_id, "deleted_work_ids": ids}
            result["operation_id"] = operation_id
            self.db.add(
                MutationOperation(
                    id=operation_id,
                    payload_hash=digest,
                    before_revision=before,
                    after_revision=before + 1,
                    cutoff=datetime.now(UTC).isoformat(),
                    after_state_json="{}",
                    result_json=_canonical(result),
                    file_finalized=True,
                )
            )
            self.db.commit()
            return result
        except Exception:
            self.db.rollback()
            raise
