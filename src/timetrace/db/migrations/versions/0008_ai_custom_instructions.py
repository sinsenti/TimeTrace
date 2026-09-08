"""Add aisettings.custom_instructions

Revision ID: 0008_ai_custom_instructions
Revises: 0007_ai_assistant_tables
Create Date: 2026-09-05 00:00:00.000000

Single additive column on the `aisettings` singleton table: free-text user instructions that get
appended to the assistant's system prompt.

The column is NOT NULL with a `''` server default, matching `db/models.py` (`custom_instructions:
str = Field(default="")`). Two reasons it is not nullable:

  * `AISettingsService.update_settings` skips any field whose incoming value `is None`, so a
    nullable column could never be cleared back to "no instructions" through the existing update
    path. Empty string is the unset sentinel.
  * `server_default=''` is what backfills the already-existing singleton row; without it, adding a
    NOT NULL column to a populated table fails outright in SQLite.

`op.batch_alter_table` is unnecessary here -- a plain ADD COLUMN is one of the few things SQLite
supports natively, so no table rebuild (and therefore no index-rename hazard) is involved.

No rows are inserted and no timestamps are written, so revision 0002's `sa.func.now()` trap does
not apply.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_ai_custom_instructions"
down_revision: str | None = "0007_ai_assistant_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "aisettings",
        sa.Column("custom_instructions", sa.String(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("aisettings", "custom_instructions")
