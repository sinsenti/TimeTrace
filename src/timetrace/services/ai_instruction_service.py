"""Confirmation-gated service for conversational standing instructions.

Instruction proposals are separate from task/session AI drafts. The service owns append-only
proposal state, exact-value hashes for stale detection, and the only path that applies a
conversation-created instruction to ``AISettings.custom_instructions``.
"""

from __future__ import annotations

import hashlib
import re

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from timetrace.core.exceptions import ConflictError, EntityNotFoundError, ValidationError
from timetrace.db.models import AIInstructionProposal, AISettings, utc_now
from timetrace.services.ai_provider_service import AISettingsService

_MAX_INSTRUCTION_LENGTH = 4000


def _hash_instructions(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _equivalence_key(value: str) -> str:
    normalized = " ".join(value.split()).casefold()
    return re.sub(r"^(?:[-*•]\s+|\d+[.)]\s+)", "", normalized)


def _append_instruction(existing: str, instruction: str) -> str:
    """Append without changing the existing text, unless the instruction is already present."""
    existing = existing or ""
    instruction = instruction.strip()
    instruction_key = _equivalence_key(instruction)
    candidates = [existing, *re.split(r"\n\s*\n", existing), *existing.splitlines()]
    if any(_equivalence_key(candidate) == instruction_key for candidate in candidates if candidate.strip()):
        return existing
    return f"{existing}\n\n{instruction}" if existing else instruction


class AIInstructionService:
    """Manage pending and accepted proposals against the singleton AI settings row."""

    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def normalize_instruction(instruction: str) -> str:
        if not isinstance(instruction, str):
            raise ValidationError("instruction must be text")
        normalized = instruction.strip()
        if not normalized:
            raise ValidationError("instruction must not be empty")
        if len(normalized) > _MAX_INSTRUCTION_LENGTH:
            raise ValidationError("instruction must be 4000 characters or fewer")
        return normalized

    @staticmethod
    def hash_instructions(value: str) -> str:
        return _hash_instructions(value or "")

    @staticmethod
    def append_instruction(existing: str, instruction: str) -> str:
        normalized = AIInstructionService.normalize_instruction(instruction)
        result = _append_instruction(existing or "", normalized)
        if len(result) > _MAX_INSTRUCTION_LENGTH:
            raise ValidationError("custom instructions must be 4000 characters or fewer")
        return result

    def get_proposal(self, proposal_id: str) -> AIInstructionProposal:
        proposal = self.db.get(AIInstructionProposal, proposal_id)
        if proposal is None:
            raise EntityNotFoundError("AIInstructionProposal", proposal_id)
        return proposal

    def list_for_conversation(self, conversation_id: str) -> list[AIInstructionProposal]:
        return list(
            self.db.exec(
                select(AIInstructionProposal)
                .where(AIInstructionProposal.conversation_id == conversation_id)
                .order_by(AIInstructionProposal.created_at, AIInstructionProposal.id)
            ).all()
        )

    def get_for_source_message(self, source_message_id: str) -> AIInstructionProposal | None:
        return self.db.exec(
            select(AIInstructionProposal)
            .where(AIInstructionProposal.source_message_id == source_message_id)
            .order_by(AIInstructionProposal.created_at.desc())
        ).first()

    def create_proposal(
        self,
        *,
        conversation_id: str | None,
        source_message_id: str,
        instruction: str,
    ) -> AIInstructionProposal:
        existing_proposal = self.get_for_source_message(source_message_id)
        if existing_proposal is not None:
            raise ValidationError("only one remembered-instruction proposal is allowed per turn")

        normalized = self.normalize_instruction(instruction)
        # Do not call AISettingsService.get_settings() here: its lazy singleton creation is a
        # write, while proposing must leave the setting untouched. An absent row means the
        # default empty instruction string until acceptance creates it.
        settings = self.db.exec(select(AISettings)).first()
        before = settings.custom_instructions if settings is not None else ""
        after = self.append_instruction(before, normalized)
        proposal = AIInstructionProposal(
            conversation_id=conversation_id,
            source_message_id=source_message_id,
            operation="append",
            proposed_instruction=normalized,
            before_instructions=before,
            after_instructions=after,
            base_hash=_hash_instructions(before),
            status="pending",
        )
        self.db.add(proposal)
        try:
            self.db.commit()
        except IntegrityError as exc:
            # The source-message index is the database-level guard for two concurrently
            # dispatched tool calls. The in-memory gateway lock only covers one gateway object;
            # separate workers/requests still need the same one-proposal invariant.
            self.db.rollback()
            if self.get_for_source_message(source_message_id) is not None:
                raise ValidationError("only one remembered-instruction proposal is allowed per turn") from exc
            raise
        self.db.refresh(proposal)
        return proposal

    def _mark_decided(self, proposal: AIInstructionProposal, status: str) -> AIInstructionProposal:
        proposal.status = status
        proposal.decided_at = utc_now()
        proposal.updated_at = utc_now()
        self.db.add(proposal)
        self.db.commit()
        self.db.refresh(proposal)
        return proposal

    def accept(
        self,
        proposal_id: str,
        *,
        edited_instruction: str | None = None,
    ) -> tuple[AIInstructionProposal, AISettings]:
        proposal = self.get_proposal(proposal_id)
        if proposal.status == "accepted":
            return proposal, AISettingsService(self.db).get_settings()
        if proposal.status != "pending":
            raise ValidationError(f"instruction proposal {proposal_id} is not pending")

        settings_service = AISettingsService(self.db)
        settings = settings_service.get_settings()
        self.db.refresh(settings)
        current = settings.custom_instructions or ""
        if _hash_instructions(current) != proposal.base_hash:
            self._mark_decided(proposal, "conflict")
            raise ConflictError("custom instructions changed since this proposal was created; review it again")

        instruction = proposal.proposed_instruction if edited_instruction is None else edited_instruction
        instruction = self.normalize_instruction(instruction)
        after = self.append_instruction(current, instruction)

        # This is the only setting write in the proposal lifecycle. It commits before the
        # proposal status changes, so a validation/database failure cannot be reported accepted.
        settings = settings_service.update_settings(custom_instructions=after)
        proposal.proposed_instruction = instruction
        proposal.before_instructions = current
        proposal.after_instructions = after
        proposal.status = "accepted"
        proposal.decided_at = utc_now()
        proposal.updated_at = utc_now()
        self.db.add(proposal)
        self.db.commit()
        self.db.refresh(proposal)
        return proposal, settings

    def reject(self, proposal_id: str) -> AIInstructionProposal:
        proposal = self.get_proposal(proposal_id)
        if proposal.status != "pending":
            raise ValidationError(f"instruction proposal {proposal_id} is not pending")
        return self._mark_decided(proposal, "rejected")

    def undo(self, proposal_id: str) -> tuple[AIInstructionProposal, AISettings]:
        proposal = self.get_proposal(proposal_id)
        if proposal.status != "accepted":
            raise ValidationError(f"instruction proposal {proposal_id} is not accepted")

        settings_service = AISettingsService(self.db)
        settings = settings_service.get_settings()
        self.db.refresh(settings)
        current = settings.custom_instructions or ""
        if _hash_instructions(current) != _hash_instructions(proposal.after_instructions):
            self._mark_decided(proposal, "conflict")
            raise ConflictError("custom instructions changed after acceptance; it was not undone")

        settings = settings_service.update_settings(custom_instructions=proposal.before_instructions)
        proposal.status = "undone"
        proposal.decided_at = utc_now()
        proposal.updated_at = utc_now()
        self.db.add(proposal)
        self.db.commit()
        self.db.refresh(proposal)
        return proposal, settings

    def mark_failed_for_source(self, source_message_id: str) -> AIInstructionProposal | None:
        proposal = self.get_for_source_message(source_message_id)
        if proposal is None or proposal.status != "pending":
            return proposal
        return self._mark_decided(proposal, "failed")


__all__ = ["AIInstructionService"]
