"""Add explicit AI data-scope controls.

Revision ID: 0013_ai_data_scope
Revises: 0012_ai_instruction_source_unique

Existing task/session access stays enabled for compatibility. Habits, reviews, ratings, and
active-timer context are sensitive additions and are disabled until the user opts in from
Settings > AI. The value is JSON because the setting is a small extensible allow-list and does
not need a separate table.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_ai_data_scope"
down_revision: str | None = "0012_ai_instruction_source_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFAULT_SCOPE = (
    '{"tasks": true, "sessions": true, "habits": false, "reviews": false, '
    '"ratings": false, "timer": false}'
)


def upgrade() -> None:
    op.add_column(
        "aisettings",
        sa.Column("data_scope_json", sa.String(), nullable=False, server_default=_DEFAULT_SCOPE),
    )


def downgrade() -> None:
    op.drop_column("aisettings", "data_scope_json")
