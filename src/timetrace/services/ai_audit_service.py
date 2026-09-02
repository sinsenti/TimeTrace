"""Append-only transition log for the AI draft/accept/undo/reapply lifecycle.

`AIAudit` rows are never updated or deleted -- an "undone" batch that is later re-applied
gets a NEW `reapplied` row rather than an edit to the earlier `applied`/`undone` rows. That is
what lets a later step reconstruct the full history of a batch (propose -> apply -> undo ->
reapply -> ...) instead of only its current snapshot.
"""

import json
from datetime import datetime
from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import ValidationError
from timetrace.db.models import AIAudit

TRANSITIONS = ("proposed", "applied", "undone", "reapplied", "rejected", "failed")


class AIAuditService:
    """Thin wrapper around the `aiaudit` table. `record()` is the only write method."""

    def __init__(self, db: Session):
        self.db = db

    def record(
        self,
        *,
        batch_id: str,
        transition: str,
        item_id: str | None = None,
        entity_type: str | None = None,
        entity_id: str | None = None,
        before_json: str | dict | None = None,
        after_json: str | dict | None = None,
        actor: str = "user",
        reason: str | None = None,
    ) -> AIAudit:
        if transition not in TRANSITIONS:
            raise ValidationError(f"invalid audit transition '{transition}'")
        if actor not in ("ai", "user"):
            raise ValidationError(f"invalid audit actor '{actor}'")

        row = AIAudit(
            batch_id=batch_id,
            item_id=item_id,
            transition=transition,
            entity_type=entity_type,
            entity_id=entity_id,
            before_json=self._as_json(before_json),
            after_json=self._as_json(after_json),
            actor=actor,
            reason=reason,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def list_for_batch(self, batch_id: str) -> list[AIAudit]:
        """Full transition history for a batch, most recent first."""
        return list(
            self.db.exec(select(AIAudit).where(AIAudit.batch_id == batch_id).order_by(AIAudit.created_at.desc())).all()
        )

    def list_recent(self, since: datetime | None = None, limit: int = 200) -> list[AIAudit]:
        """General-purpose recent-history read, for a future activity feed. Not currently
        called from anywhere in this slice, but keeps the read side from being a single
        per-batch dead end."""
        query = select(AIAudit).order_by(AIAudit.created_at.desc())
        if since is not None:
            query = query.where(AIAudit.created_at >= since)
        return list(self.db.exec(query.limit(limit)).all())

    @staticmethod
    def _as_json(value: Any) -> str | None:
        if value is None or isinstance(value, str):
            return value
        return json.dumps(value, default=str)
