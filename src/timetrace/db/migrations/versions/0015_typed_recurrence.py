"""Allow a recurrence override to target a scheduled session instead of a legacy row."""

import sqlalchemy as sa
from alembic import op

revision = "0015_typed_recurrence"
down_revision = "0014_agenda_foundation"
branch_labels = None
depends_on = None

_INDEX = "ix_recurrenceexception_scheduled_session_id"


def upgrade() -> None:
    # SQLite validates this nullable column's CHECK against existing rows and keeps old IDs,
    # foreign keys and indexes in place rather than rebuilding the exception table.
    op.execute(
        "ALTER TABLE recurrenceexception ADD COLUMN scheduled_session_id VARCHAR "
        "REFERENCES scheduled_session(id) CONSTRAINT ck_recurrence_exception_target CHECK ("
        "(kind = 'skip' AND session_id IS NULL AND scheduled_session_id IS NULL) OR "
        "(kind = 'override' AND ((session_id IS NULL) != (scheduled_session_id IS NULL))))"
    )
    op.create_index(_INDEX, "recurrenceexception", ["scheduled_session_id"], unique=True)


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text("SELECT 1 FROM recurrenceexception WHERE scheduled_session_id IS NOT NULL LIMIT 1")
    ):
        raise RuntimeError("Cannot downgrade with typed recurrence overrides; restore a consistent backup.")
    op.drop_index(_INDEX, table_name="recurrenceexception")
    op.drop_column("recurrenceexception", "scheduled_session_id")
