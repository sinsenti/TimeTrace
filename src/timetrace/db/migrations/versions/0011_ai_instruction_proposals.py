"""Add confirmation-gated conversational custom-instruction proposals.

Revision ID: 0011_ai_instruction_proposals
Revises: 0010_ai_search_and_scheduling_preferences
Create Date: 2026-09-07 00:00:00.000000

Instruction proposals are deliberately separate from task/session draft items. They change the
singleton AISettings row only after explicit user confirmation and retain their own conflict-safe
lifecycle.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_ai_instruction_proposals"
down_revision: str | None = "0010_ai_search_and_scheduling_preferences"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "aiinstructionproposal",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("conversation_id", sa.String(), nullable=True),
        sa.Column("source_message_id", sa.String(), nullable=True),
        sa.Column("operation", sa.String(), nullable=False),
        sa.Column("proposed_instruction", sa.String(), nullable=False),
        sa.Column("before_instructions", sa.String(), nullable=False),
        sa.Column("after_instructions", sa.String(), nullable=False),
        sa.Column("base_hash", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["aiconversation.id"],
            name="fk_aiinstructionproposal_conversation",
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_aiinstructionproposal_conversation_id",
        "aiinstructionproposal",
        ["conversation_id"],
    )
    op.create_index(
        "ix_aiinstructionproposal_source_message_id",
        "aiinstructionproposal",
        ["source_message_id"],
    )
    op.create_index("ix_aiinstructionproposal_status", "aiinstructionproposal", ["status"])
    op.create_index("ix_aiinstructionproposal_created_at", "aiinstructionproposal", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_aiinstructionproposal_created_at", table_name="aiinstructionproposal")
    op.drop_index("ix_aiinstructionproposal_status", table_name="aiinstructionproposal")
    op.drop_index("ix_aiinstructionproposal_source_message_id", table_name="aiinstructionproposal")
    op.drop_index("ix_aiinstructionproposal_conversation_id", table_name="aiinstructionproposal")
    op.drop_table("aiinstructionproposal")
