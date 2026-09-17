"""The heart of the AI assistant's non-destructive write path.

`AIDraftService.accept_items` is the ONLY place a proposed draft becomes a real `task`/`session`
row, and it always goes through `SessionService`/`TaskService` -- never a raw column write --
so `ensure_utc`, `end_time > start_time`, tag inheritance, the `status`/`status_id` sync and the
completion-policy hook all stay intact for AI-originated writes exactly as they do for
human-originated ones.

Three JSON snapshots live on every `AIDraftItem` (see `db/models.py` for the authoritative
docstring): `baseline_json` (propose-time -- the staleness comparison), `applied_before_json`
(accept-time -- what undo restores) and `applied_after_json` (what our own service actually
persisted). `is_stale` is deliberately computed at read time and never stored.
"""

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.db.models import AIDraftBatch, AIDraftItem, AISettings, DayReview, Task, utc_now
from timetrace.interfaces.api.schemas import (
    CompletionPolicyPrompt,
    DayReviewCreate,
    SessionCreate,
    SessionUpdate,
    TaskCreate,
    TaskUpdate,
)
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.ai_audit_service import AIAuditService
from timetrace.services.session_service import SessionService
from timetrace.services.task_service import TaskService

logger = logging.getLogger("timetrace.ai")

# AIDraftItem.op
CREATE_OPS = ("create",)
UPDATE_OPS = ("update",)
DELETE_OPS = ("delete",)

# AIDraftItem.status: "pending" | "applied" | "rejected" | "undone" | "failed" | "conflict"
# AIDraftBatch.status: "pending" | "applied" | "partially_applied" | "rejected" | "undone" | "failed"


def _json_dumps(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str)


def _json_loads(value: str | None) -> dict[str, Any] | None:
    if value is None:
        return None
    return json.loads(value)


class AIDraftService:
    """`AIDraftService(db)` -- construct per-request, like every other service in this codebase.

    Canonical `add_item` signature (the tool-gateway track should call exactly this):
    `add_item(batch_id, op, entity_type, target_id, proposed_json, baseline_json=None,
    rationale=None)`. `proposed_json`/`baseline_json` accept either a `dict` (serialized here)
    or an already-serialized JSON string, so callers do not need to import `json` themselves.
    """

    # Fields compared for staleness / recorded in every JSON snapshot. Tool-gateway code that
    # builds `baseline_json`/`proposed_json` by hand should reuse `normalize_session`/
    # `normalize_task` below so the staleness comparison in `is_stale`/`accept_items`/
    # `undo_batch` is always comparing like with like.
    _SESSION_SNAPSHOT_FIELDS = (
        "task_id",
        "start_time",
        "end_time",
        "tags",
        "notes",
        "review_skipped",
        "duration_seconds",
    )
    _DAY_REVIEW_SNAPSHOT_FIELDS = (
        "date_str",
        "rating",
        "highlights",
        "friction",
        "notes",
        "review_skipped",
    )
    _TASK_SNAPSHOT_FIELDS = (
        "title",
        "description",
        "priority",
        "status",
        # `status_id` deliberately excluded: `TaskService.update_task` always re-derives it from
        # `status`'s name (see its own `elif "status_id" in update_dict` branch, which only ever
        # runs when `status` is absent) -- confirmed live: this made a task-update batch's
        # reapply-after-undo deterministically report a spurious conflict, since the restored
        # live row's re-derived `status_id` differed from whatever the pre-AI-change snapshot
        # happened to hold. `status` (the name) is the field that's actually meaningful here;
        # `status_id` is a fully-determined sync column, not independent state to compare.
        "parent_id",
        "category",
        "color",
        "tags",
        "estimated_minutes",
        "due_date",
        "assigned_date",
        "attachments",
        "is_recurring",
        "recurrence_rule",
        "recurrence_rrule",
        "recurrence_dtstart",
        "recurrence_duration_minutes",
        "recurrence_timezone",
        "requires_session_review",
    )

    def __init__(self, db: Session):
        self.db = db
        self.audit = AIAuditService(db)

    # --- batch / item creation ---------------------------------------------------------

    def create_batch(
        self,
        conversation_id: str | None,
        source_message_id: str | None,
        intent: str | None,
        request_text: str | None,
        provider: str | None,
        model: str | None,
    ) -> AIDraftBatch:
        """`request_text` must already be sanitized by the caller (redaction happens upstream
        in `core/ai/redaction.py`); this only stores what it is given."""
        batch = AIDraftBatch(
            conversation_id=conversation_id,
            source_message_id=source_message_id,
            intent=intent,
            request_text=request_text,
            provider=provider,
            model=model,
            status="pending",
        )
        self.db.add(batch)
        self.db.commit()
        self.db.refresh(batch)
        return batch

    def add_item(
        self,
        batch_id: str,
        op: str,
        entity_type: str,
        target_id: str | None,
        proposed_json: dict | str,
        baseline_json: dict | str | None = None,
        rationale: str | None = None,
    ) -> AIDraftItem:
        batch = self._get_batch(batch_id)
        if op not in ("create", "update", "delete"):
            raise ValidationError(f"invalid draft op '{op}'")
        if entity_type not in ("session", "task", "day_review"):
            raise ValidationError(f"invalid entity_type '{entity_type}'")
        if entity_type == "day_review":
            if op not in ("create", "update"):
                raise ValidationError("day_review drafts support only create and update")
            if not target_id or not isinstance(target_id, str):
                raise ValidationError("day_review drafts require date_str as target_id")
            proposed_data = _json_loads(_json_dumps(proposed_json)) or {}
            if proposed_data.get("date_str") != target_id:
                raise ValidationError("day_review target_id must equal proposed date_str")
            try:
                DayReviewCreate(**proposed_data)
            except Exception as exc:
                raise ValidationError(f"invalid day_review draft: {exc}") from exc

        next_position = self.db.exec(
            select(AIDraftItem.position).where(AIDraftItem.batch_id == batch_id).order_by(AIDraftItem.position.desc())
        ).first()
        position = 0 if next_position is None else next_position + 1

        item = AIDraftItem(
            batch_id=batch_id,
            position=position,
            op=op,
            entity_type=entity_type,
            target_id=target_id,
            proposed_json=_json_dumps(proposed_json) or "{}",
            baseline_json=_json_dumps(baseline_json),
            rationale=rationale,
            status="pending",
        )
        self.db.add(item)
        batch.item_count = (batch.item_count or 0) + 1
        self.db.add(batch)
        self.db.commit()
        self.db.refresh(item)

        self.audit.record(
            batch_id=batch_id,
            item_id=item.id,
            transition="proposed",
            entity_type=entity_type,
            entity_id=target_id,
            before_json=item.baseline_json,
            after_json=item.proposed_json,
            actor="ai",
        )
        return item

    # --- reads --------------------------------------------------------------------------

    def get_batch(self, batch_id: str) -> AIDraftBatch:
        return self._get_batch(batch_id)

    def list_items(self, batch_id: str) -> list[AIDraftItem]:
        self._get_batch(batch_id)
        return self._items_for_batch(batch_id)

    def _undo_retention_cutoff(self) -> datetime:
        settings = self.db.exec(select(AISettings)).first()
        retention_days = settings.batch_undo_retention_days if settings else 30
        return (datetime.now(UTC) - timedelta(days=max(1, retention_days))).replace(tzinfo=None)

    def list_undoable_batches(self, since: datetime | None = None) -> list[AIDraftBatch]:
        """Batches with at least one item still standing (applied or reapplied -- both surface
        as item status `applied`) and within the configured undo-retention window. Feeds
        `POST /drafts/undo {batch_ids?, since?}`."""
        query = (
            select(AIDraftBatch)
            .where(AIDraftBatch.status.in_(["applied", "partially_applied"]))
            .order_by(AIDraftBatch.created_at.desc())
        )
        cutoff = self._undo_retention_cutoff()
        if since is not None:
            cutoff = max(cutoff, ensure_utc(since).replace(tzinfo=None))
        query = query.where(AIDraftBatch.created_at >= cutoff)
        return list(self.db.exec(query).all())

    def is_stale(self, item: AIDraftItem) -> bool:
        """Computed at read time, never stored. Natural-key creates such as day reviews can
        become stale when a row is created at the proposed date before acceptance; ordinary
        creates have no live target to compare against. A vanished update target is always stale.
        """
        if item.op == "create":
            if item.entity_type != "day_review" or not item.target_id:
                return False
            live = self._fetch_live_snapshot(item.entity_type, item.target_id)
            if item.status == "pending":
                return live is not None
            if item.status == "applied":
                return live is None or live != _json_loads(item.applied_after_json)
            if item.status == "undone":
                return live is not None
            return False
        if not item.target_id:
            return False
        if item.baseline_json is None:
            return False
        live = self._fetch_live_snapshot(item.entity_type, item.target_id)
        if live is None:
            return True
        try:
            baseline = json.loads(item.baseline_json)
        except TypeError, ValueError:
            return False
        return live != baseline

    # --- accept ---------------------------------------------------------------------------

    def accept_items(self, batch_id: str, item_ids: list[str] | None = None, actor: str = "user") -> dict[str, Any]:
        """Per spec: process pending items in `position` order. Always returns 200-shaped
        per-item results -- a blanket failure on one stale item must never block the rest of
        the batch."""
        logger.info("AI accept_items: batch=%s item_ids=%s actor=%s", batch_id, item_ids, actor)
        batch = self._get_batch(batch_id)
        items = self._items_for_batch(batch_id, item_ids, descending=False)

        results: list[dict[str, Any]] = []
        completion_policies: list[CompletionPolicyPrompt] = []

        for item in items:
            if item.status != "pending":
                results.append({"item_id": item.id, "status": item.status, "error": "not pending; skipped"})
                continue
            result = self._accept_one(item, actor=actor)
            results.append(result)
            logger.info("AI accept item: batch=%s item=%s -> %s", batch_id, item.id, result.get("status"))
            if result.get("completion_policy") is not None:
                completion_policies.append(result["completion_policy"])

        self._recompute_batch_status(batch)
        logger.info("AI accept_items done: batch=%s status=%s items=%d", batch_id, batch.status, len(results))
        return {
            "batch_id": batch.id,
            "batch_status": batch.status,
            "items": results,
            "completion_policies": completion_policies,
        }

    def _accept_one(self, item: AIDraftItem, actor: str) -> dict[str, Any]:
        entity_type, op, target_id = item.entity_type, item.op, item.target_id

        live_before: dict[str, Any] | None = None
        if op in ("update", "delete"):
            live_before = self._fetch_live_snapshot(entity_type, target_id)
            if live_before is None:
                return self._fail_item(item, "target no longer exists", actor=actor)
            if item.baseline_json is not None and live_before != json.loads(item.baseline_json):
                return self._fail_item(item, "stale: target changed since this was proposed", actor=actor)
        elif entity_type == "day_review" and target_id:
            if self._fetch_live_snapshot(entity_type, target_id) is not None:
                return self._fail_item(item, "stale: a day review now exists for this date", actor=actor)

        proposed = _json_loads(item.proposed_json) or {}

        ref_error = self._check_session_task_ref(entity_type, op, proposed)
        if ref_error:
            return self._fail_item(item, ref_error, actor=actor)

        try:
            after, real_id, completion_policy = self._execute(entity_type, op, target_id, proposed)
        except Exception as exc:
            # Confirmed live (adversarial review): a real IntegrityError (e.g. the edit-form
            # NOT-NULL-violation bug, now separately fixed) escaped this narrower catch as a bare
            # 500 -- with the batch stuck `pending` and `_recompute_batch_status` never reached,
            # even though earlier items in the same batch were already committed as `applied`.
            # `db.rollback()` first: a raw DB exception leaves the session in a failed-transaction
            # state that would make `_fail_item`'s own commit raise again otherwise.
            self.db.rollback()
            return self._fail_item(item, str(exc), actor=actor)

        item.status = "applied"
        item.error = None
        item.applied_before_json = _json_dumps(live_before)
        item.applied_after_json = _json_dumps(after)
        item.applied_entity_id = real_id
        item.updated_at = utc_now()
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)

        self.audit.record(
            batch_id=item.batch_id,
            item_id=item.id,
            transition="applied",
            entity_type=entity_type,
            entity_id=real_id,
            before_json=item.applied_before_json,
            after_json=item.applied_after_json,
            actor=actor,
        )
        return {
            "item_id": item.id,
            "status": "applied",
            "applied_entity_id": real_id,
            "completion_policy": completion_policy,
        }

    def _fail_item(self, item: AIDraftItem, error: str, actor: str) -> dict[str, Any]:
        item.status = "failed"
        item.error = error
        item.updated_at = utc_now()
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)
        self.audit.record(
            batch_id=item.batch_id,
            item_id=item.id,
            transition="failed",
            entity_type=item.entity_type,
            entity_id=item.target_id,
            before_json=item.baseline_json,
            after_json=None,
            actor=actor,
            reason=error,
        )
        return {"item_id": item.id, "status": "failed", "error": error, "completion_policy": None}

    # --- reject ---------------------------------------------------------------------------

    def reject_item(self, item_id: str, reason: str | None = None, actor: str = "user") -> AIDraftItem:
        item = self._get_item(item_id)
        if item.status != "pending":
            raise ValidationError(f"item {item_id} is not pending (status={item.status})")

        item.status = "rejected"
        item.error = None
        item.updated_at = utc_now()
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)

        self.audit.record(
            batch_id=item.batch_id,
            item_id=item.id,
            transition="rejected",
            entity_type=item.entity_type,
            entity_id=item.target_id,
            before_json=item.baseline_json,
            after_json=None,
            actor=actor,
            reason=reason,
        )
        self._recompute_batch_status(self._get_batch(item.batch_id))
        return item

    def reject_batch(
        self, batch_id: str, item_ids: list[str] | None = None, reason: str | None = None, actor: str = "user"
    ) -> dict[str, Any]:
        batch = self._get_batch(batch_id)
        items = self._items_for_batch(batch_id, item_ids, descending=False)
        results = []
        for item in items:
            if item.status != "pending":
                results.append({"item_id": item.id, "status": item.status, "error": "not pending; skipped"})
                continue
            self.reject_item(item.id, reason=reason, actor=actor)
            results.append({"item_id": item.id, "status": "rejected"})

        if not self._items_for_batch(batch.id):
            # A zero-item batch (a turn that never reached _finalize_batch's delete-if-empty
            # cleanup, e.g. the connection dropped mid-stream) has nothing for
            # _recompute_batch_status to summarize from -- it bails out and leaves the batch
            # `pending` forever, with no other way to clear it. Rejecting an empty batch is
            # explicitly rejecting "nothing happened here," so it goes straight to `rejected`.
            batch.status = "rejected"
            batch.decided_at = utc_now()
            self.db.add(batch)
            self.db.commit()
            self.audit.record(batch_id=batch.id, transition="rejected", actor=actor, reason=reason)
        else:
            self._recompute_batch_status(batch)
        return {"batch_id": batch.id, "batch_status": batch.status, "items": results}

    # --- undo -----------------------------------------------------------------------------

    def undo_batch(
        self, batch_id: str, item_ids: list[str] | None = None, actor: str = "user", reason: str | None = None
    ) -> dict[str, Any]:
        """Walks items in DESCENDING position. Before touching anything, compares the live row
        against `applied_after_json`; a mismatch means the user edited it since accept, and the
        item is reported as a conflict and left alone -- silently reverting a later manual edit
        is the worst possible failure mode for this feature."""
        logger.info("AI undo_batch: batch=%s item_ids=%s actor=%s", batch_id, item_ids, actor)
        batch = self._get_batch(batch_id)
        if batch.created_at < self._undo_retention_cutoff():
            raise ValidationError("This draft batch is outside the configured undo-retention window")
        items = self._items_for_batch(batch_id, item_ids, descending=True)

        results = []
        for item in items:
            if item.status != "applied":
                results.append({"item_id": item.id, "status": item.status, "error": "not applied; skipped"})
                continue
            result = self._undo_one(item, actor=actor, reason=reason)
            results.append(result)
            logger.info("AI undo item: batch=%s item=%s -> %s", batch_id, item.id, result.get("status"))

        self._recompute_batch_status(batch)
        if batch.status == "undone":
            batch.undone_at = utc_now()
            self.db.add(batch)
            self.db.commit()
        logger.info("AI undo_batch done: batch=%s status=%s items=%d", batch_id, batch.status, len(results))
        return {"batch_id": batch.id, "batch_status": batch.status, "items": results}

    def _undo_one(self, item: AIDraftItem, actor: str, reason: str | None) -> dict[str, Any]:
        entity_type = item.entity_type
        live_id = item.applied_entity_id or item.target_id
        applied_after = _json_loads(item.applied_after_json)

        live = self._fetch_live_snapshot(entity_type, live_id)
        if live != applied_after:
            item.status = "conflict"
            item.error = "target was changed since this was applied; left alone"
            item.updated_at = utc_now()
            self.db.add(item)
            self.db.commit()
            self.db.refresh(item)
            return {"item_id": item.id, "status": "conflict", "error": item.error}

        before = _json_loads(item.applied_before_json)

        try:
            if item.op == "create":
                self._execute(entity_type, "delete", live_id, {})
                new_after = None
            elif item.op == "update":
                new_after, _, _ = self._execute(entity_type, "update", live_id, before or {}, restore=True)
            elif item.op == "delete":
                new_after, new_id, _ = self._execute(entity_type, "create", None, before or {}, restore=True)
                # Recreated with a NEW id -- write it back so the trail stays honest.
                item.applied_entity_id = new_id
            else:
                raise ValidationError(f"unsupported op '{item.op}' for undo")
        except Exception as exc:
            self.db.rollback()
            item.status = "failed"
            item.error = f"undo failed: {exc}"
            item.updated_at = utc_now()
            self.db.add(item)
            self.db.commit()
            self.db.refresh(item)
            self.audit.record(
                batch_id=item.batch_id,
                item_id=item.id,
                transition="failed",
                entity_type=entity_type,
                entity_id=live_id,
                before_json=item.applied_after_json,
                after_json=None,
                actor=actor,
                reason=str(exc),
            )
            return {"item_id": item.id, "status": "failed", "error": item.error}

        item.status = "undone"
        item.error = None
        item.updated_at = utc_now()
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)

        self.audit.record(
            batch_id=item.batch_id,
            item_id=item.id,
            transition="undone",
            entity_type=entity_type,
            entity_id=item.applied_entity_id or live_id,
            before_json=item.applied_after_json,
            after_json=_json_dumps(new_after),
            actor=actor,
            reason=reason,
        )
        return {"item_id": item.id, "status": "undone", "applied_entity_id": item.applied_entity_id}

    # --- reapply --------------------------------------------------------------------------

    def reapply_batch(self, batch_id: str, item_ids: list[str] | None = None, actor: str = "user") -> dict[str, Any]:
        """`undone` is not terminal: an undone batch may be re-applied. Re-runs the original
        `proposed_json` against whatever `undo_batch` left live (ascending position order, like
        the original accept)."""
        logger.info("AI reapply_batch: batch=%s item_ids=%s actor=%s", batch_id, item_ids, actor)
        batch = self._get_batch(batch_id)
        items = self._items_for_batch(batch_id, item_ids, descending=False)

        results = []
        completion_policies: list[CompletionPolicyPrompt] = []
        for item in items:
            if item.status != "undone":
                results.append({"item_id": item.id, "status": item.status, "error": "not undone; skipped"})
                continue
            result = self._reapply_one(item, actor=actor)
            results.append(result)
            logger.info("AI reapply item: batch=%s item=%s -> %s", batch_id, item.id, result.get("status"))
            if result.get("completion_policy") is not None:
                completion_policies.append(result["completion_policy"])

        self._recompute_batch_status(batch)
        logger.info("AI reapply_batch done: batch=%s status=%s items=%d", batch_id, batch.status, len(results))
        return {
            "batch_id": batch.id,
            "batch_status": batch.status,
            "items": results,
            "completion_policies": completion_policies,
        }

    def _reapply_one(self, item: AIDraftItem, actor: str) -> dict[str, Any]:
        entity_type = item.entity_type
        # After undo: a "create" item's target no longer exists; an "update" item's target was
        # restored to `applied_before_json`; a "delete" item's target was recreated under a NEW
        # `applied_entity_id`.
        live_id = item.applied_entity_id if item.op != "create" else None

        if item.op != "create":
            expected_before = _json_loads(item.applied_before_json)
            live = self._fetch_live_snapshot(entity_type, live_id)
            if live != expected_before:
                item.status = "conflict"
                item.error = "target was changed since it was undone; left alone"
                item.updated_at = utc_now()
                self.db.add(item)
                self.db.commit()
                self.db.refresh(item)
                return {"item_id": item.id, "status": "conflict", "error": item.error, "completion_policy": None}
        elif entity_type == "day_review" and item.target_id:
            if self._fetch_live_snapshot(entity_type, item.target_id) is not None:
                item.status = "conflict"
                item.error = "target was recreated since this item was undone; left alone"
                item.updated_at = utc_now()
                self.db.add(item)
                self.db.commit()
                self.db.refresh(item)
                return {"item_id": item.id, "status": "conflict", "error": item.error, "completion_policy": None}

        proposed = _json_loads(item.proposed_json) or {}
        ref_error = self._check_session_task_ref(entity_type, item.op, proposed)
        if ref_error:
            return self._reapply_fail(item, ref_error, actor, live_id)

        op_for_execute = "create" if item.op == "create" else ("delete" if item.op == "delete" else "update")
        target_for_op = None if item.op == "create" else live_id

        try:
            after, real_id, completion_policy = self._execute(entity_type, op_for_execute, target_for_op, proposed)
        except Exception as exc:
            self.db.rollback()
            return self._reapply_fail(item, str(exc), actor, live_id)

        item.status = "applied"
        item.error = None
        item.applied_after_json = _json_dumps(after)
        if item.op != "delete":
            item.applied_entity_id = real_id
        item.updated_at = utc_now()
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)

        self.audit.record(
            batch_id=item.batch_id,
            item_id=item.id,
            transition="reapplied",
            entity_type=entity_type,
            entity_id=real_id,
            before_json=item.applied_before_json,
            after_json=item.applied_after_json,
            actor=actor,
        )
        return {
            "item_id": item.id,
            "status": "applied",
            "applied_entity_id": item.applied_entity_id,
            "completion_policy": completion_policy,
        }

    def _reapply_fail(self, item: AIDraftItem, error: str, actor: str, entity_id: str | None) -> dict[str, Any]:
        item.status = "failed"
        item.error = error
        item.updated_at = utc_now()
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)
        self.audit.record(
            batch_id=item.batch_id,
            item_id=item.id,
            transition="failed",
            entity_type=item.entity_type,
            entity_id=entity_id,
            before_json=item.applied_before_json,
            after_json=None,
            actor=actor,
            reason=error,
        )
        return {"item_id": item.id, "status": "failed", "error": error, "completion_policy": None}

    # --- dispatch to the real services -----------------------------------------------------

    def _check_session_task_ref(self, entity_type: str, op: str, payload: dict[str, Any]) -> str | None:
        """Trap #1 (spec 9.1): `SessionService.create_session`/`update_session` silently null
        an unknown `task_id` instead of failing. A silently task-less session reported as
        "applied" would be a false audit record, so this is checked BEFORE dispatch and treated
        as a hard failure."""
        if entity_type != "session" or op not in ("create", "update"):
            return None
        task_ref = payload.get("task_id")
        if task_ref and not self.db.get(Task, task_ref):
            return f"referenced task_id '{task_ref}' does not exist"
        return None

    def _execute(
        self, entity_type: str, op: str, target_id: str | None, payload: dict[str, Any], *, restore: bool = False
    ) -> tuple[dict[str, Any] | None, str | None, CompletionPolicyPrompt | None]:
        """Runs one CRUD dispatch against the real service and returns
        `(normalized_after, real_entity_id, completion_policy)`. `normalized_after` is None for
        deletes. `real_entity_id` is what a caller must store as `applied_entity_id` -- for a
        session update against a synthetic `virt:`-prefixed occurrence id, this is the REAL id
        `SessionService.update_session` materializes it into.

        `restore=True` is for `_undo_one` only: it's re-applying an exact prior snapshot
        (`applied_before_json`), not a new semantic edit, so `TaskService`'s quick-add title
        parser must not run a second time on a human-authored title (spec S8's "worst possible
        failure" -- see task_service.py's `parse_title_syntax` docstring)."""
        if entity_type == "session":
            svc = SessionService(self.db)
            if op == "create":
                req = SessionCreate(**self._filter_fields(payload, SessionCreate))
                result = svc.create_session(req)
                return self.normalize_session(result), result.id, None
            if op == "update":
                if not target_id:
                    raise ValidationError("session update requires a target_id")
                req = SessionUpdate(**self._filter_fields(payload, SessionUpdate))
                result = svc.update_session(target_id, req)
                return self.normalize_session(result), result.id, None
            if op == "delete":
                if not target_id:
                    raise ValidationError("session delete requires a target_id")
                svc.delete_session(target_id)
                return None, target_id, None
            raise ValidationError(f"unsupported op '{op}' for entity_type 'session'")

        if entity_type == "day_review":
            date_str = target_id or payload.get("date_str")
            if not date_str:
                raise ValidationError("day_review requires date_str")
            from timetrace.services.revision_service import RevisionService

            if op == "delete":
                RevisionService(self.db).delete_day_review(date_str)
                return None, date_str, None
            if op not in ("create", "update"):
                raise ValidationError("day_review supports only create and update")
            req_payload = {**payload, "date_str": date_str}
            req = DayReviewCreate(**self._filter_fields(req_payload, DayReviewCreate))
            result = RevisionService(self.db).save_day_review(req)
            # ``date_str`` is the stable natural key for every subsequent stale/undo/reapply
            # lookup. Do not substitute the row UUID here.
            return self.normalize_day_review(result), date_str, None

        if entity_type == "task":
            tsvc = TaskService(self.db)
            if op == "create":
                req = TaskCreate(**self._filter_fields(payload, TaskCreate))
                result = tsvc.create_task(req, parse_title_syntax=not restore)
                return self.normalize_task(result), result.id, None
            if op == "update":
                if not target_id:
                    raise ValidationError("task update requires a target_id")
                req = TaskUpdate(**self._filter_fields(payload, TaskUpdate))
                result = tsvc.update_task(target_id, req, parse_title_syntax=not restore)
                return self.normalize_task(result), result.id, result.completion_policy
            if op == "delete":
                if not target_id:
                    raise ValidationError("task delete requires a target_id")
                tsvc.delete_task(target_id)
                return None, target_id, None
            raise ValidationError(f"unsupported op '{op}' for entity_type 'task'")

        raise ValidationError(f"unknown entity_type '{entity_type}'")

    def _fetch_live_snapshot(self, entity_type: str, target_id: str | None) -> dict[str, Any] | None:
        if not target_id:
            return None
        if entity_type == "session":
            try:
                live = SessionService(self.db).get_session_by_id(target_id)
            except EntityNotFoundError:
                return None
            return self.normalize_session(live)
        if entity_type == "task":
            task = self.db.get(Task, target_id)
            if not task:
                return None
            return self.normalize_task(task)
        if entity_type == "day_review":
            review = self.db.exec(select(DayReview).where(DayReview.date_str == target_id)).first()
            return self.normalize_day_review(review) if review else None
        raise ValidationError(f"unknown entity_type '{entity_type}'")

    # --- snapshot normalization (public: reuse from the tool-gateway track) ----------------

    @staticmethod
    def normalize_session(session: Any) -> dict[str, Any]:
        """Canonical session snapshot for `proposed_json`/`baseline_json`/`applied_*_json` and
        the staleness comparison. Accepts a `SessionModel`, a dict from
        `SessionService.get_session_by_id`/`list_sessions` (real row or projected occurrence),
        or a plain dict -- all three carry the same field names."""
        data = session if isinstance(session, dict) else session.model_dump()

        def iso(value: Any) -> str | None:
            if value is None or isinstance(value, str):
                return value
            return ensure_utc(value).isoformat()

        return {
            "task_id": data.get("task_id"),
            "start_time": iso(data.get("start_time")),
            "end_time": iso(data.get("end_time")),
            "tags": data.get("tags") or "",
            "notes": data.get("notes") or "",
            "review_skipped": bool(data.get("review_skipped") or False),
            "duration_seconds": data.get("duration_seconds"),
        }

    @classmethod
    def normalize_day_review(cls, review: Any) -> dict[str, Any]:
        """Canonical day-review snapshot; ``created_at`` is intentionally excluded."""
        data = review if isinstance(review, dict) else review.model_dump()
        return {
            "date_str": data.get("date_str") or data.get("date"),
            "rating": data.get("rating"),
            "highlights": data.get("highlights") or "",
            "friction": data.get("friction") or "",
            "notes": data.get("notes") or "",
            "review_skipped": bool(data.get("review_skipped") or False),
        }

    @classmethod
    def normalize_task(cls, task: Any) -> dict[str, Any]:
        """Canonical task snapshot. Works against a `Task` row or a `TaskWithPolicyResponse` --
        both expose the same field names via attribute access."""
        out: dict[str, Any] = {}
        for field in cls._TASK_SNAPSHOT_FIELDS:
            value = getattr(task, field, None)
            if isinstance(value, datetime):
                value = ensure_utc(value).isoformat()
            out[field] = value
        return out

    # --- internal helpers -------------------------------------------------------------------

    @staticmethod
    def _filter_fields(payload: dict[str, Any], model_cls: Any) -> dict[str, Any]:
        return {k: v for k, v in (payload or {}).items() if k in model_cls.model_fields}

    def _get_batch(self, batch_id: str) -> AIDraftBatch:
        batch = self.db.get(AIDraftBatch, batch_id)
        if not batch:
            raise EntityNotFoundError("AIDraftBatch", batch_id)
        return batch

    def _get_item(self, item_id: str) -> AIDraftItem:
        item = self.db.get(AIDraftItem, item_id)
        if not item:
            raise EntityNotFoundError("AIDraftItem", item_id)
        return item

    def _items_for_batch(
        self, batch_id: str, item_ids: list[str] | None = None, descending: bool = False
    ) -> list[AIDraftItem]:
        query = select(AIDraftItem).where(AIDraftItem.batch_id == batch_id)
        if item_ids is not None:
            query = query.where(AIDraftItem.id.in_(item_ids))
        query = query.order_by(AIDraftItem.position.desc() if descending else AIDraftItem.position.asc())
        return list(self.db.exec(query).all())

    def _recompute_batch_status(self, batch: AIDraftBatch) -> None:
        """Item status is the source of truth for what actually happened; this is a coarse
        summary for `GET /drafts/batches` list views. Left as `pending` untouched, `rejected`
        when every item was rejected, `applied`/`undone` when every item shares that status, and
        `partially_applied` for any other mix (including a mix of `undone`+`conflict`, since a
        conflicted item during undo means the batch is not fully undone either)."""
        items = self._items_for_batch(batch.id)
        if not items:
            return
        statuses = {i.status for i in items}

        if statuses == {"pending"}:
            return
        if statuses <= {"rejected"}:
            new_status = "rejected"
        elif statuses <= {"applied"}:
            new_status = "applied"
        elif statuses <= {"undone"}:
            new_status = "undone"
        elif statuses <= {"failed"}:
            new_status = "failed"
        else:
            new_status = "partially_applied"

        batch.status = new_status
        batch.decided_at = utc_now()
        self.db.add(batch)
        self.db.commit()
