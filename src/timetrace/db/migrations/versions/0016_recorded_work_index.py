"""Index bounded typed-work cohorts without transforming any records."""

from alembic import op

revision = "0016_recorded_work_index"
down_revision = "0015_typed_recurrence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_session_kind_interval", "session", ["kind", "start_time", "end_time", "task_id"])


def downgrade() -> None:
    op.drop_index("ix_session_kind_interval", table_name="session")
