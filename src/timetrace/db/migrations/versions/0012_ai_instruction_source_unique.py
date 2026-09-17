"""Prevent duplicate remembered-instruction proposals for one source message.

Revision ID: 0012_ai_instruction_source_unique
Revises: 0011_ai_instruction_proposals
Create Date: 2026-09-07 00:00:00.000000

The gateway's in-memory lock only protects one turn in one process. A unique index keeps
concurrent tool calls and multiple daemon workers from creating two proposal cards for the same
source message. SQLite permits multiple NULL values in a unique index, preserving compatibility
with older manually-created proposals that have no source message.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "0012_ai_instruction_source_unique"
down_revision: str | None = "0011_ai_instruction_proposals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "uq_aiinstructionproposal_source_message_id",
        "aiinstructionproposal",
        ["source_message_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_aiinstructionproposal_source_message_id", table_name="aiinstructionproposal")
