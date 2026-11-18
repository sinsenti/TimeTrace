"""Add explicit scheduled sessions without reinterpreting legacy history."""

import sqlalchemy as sa
from alembic import op

revision = "0014_agenda_foundation"
down_revision = "0013_ai_data_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scheduled_session",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("task_id", sa.String(), sa.ForeignKey("task.id"), nullable=True),
        sa.Column("original_start", sa.DateTime(), nullable=False),
        sa.Column("original_end", sa.DateTime(), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=False),
        sa.Column("tags", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.CheckConstraint("end_time > start_time", name="ck_scheduled_current_interval"),
        sa.CheckConstraint("original_end > original_start", name="ck_scheduled_original_interval"),
    )
    op.create_index("ix_scheduled_session_task_interval", "scheduled_session", ["task_id", "start_time", "end_time"])
    op.create_index("ix_scheduled_session_start_time", "scheduled_session", ["start_time"])

    # SQLite supports an inline nullable FK and a CHECK on ADD COLUMN. Avoid rebuilding
    # session: recurrenceexception and polymorphic/JSON data already reference its rows.
    op.add_column("session", sa.Column("kind", sa.String(), nullable=False, server_default="legacy_uncertain"))
    op.add_column("session", sa.Column("provenance", sa.String(), nullable=True))
    op.execute("ALTER TABLE session ADD COLUMN scheduled_session_id VARCHAR REFERENCES scheduled_session(id)")
    op.execute(
        "ALTER TABLE session ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CONSTRAINT ck_session_kind CHECK ("
        "(kind = 'legacy_uncertain' AND provenance IS NULL AND scheduled_session_id IS NULL) OR "
        "(kind = 'recorded_work' AND provenance IS NOT NULL AND provenance IN ('manual', 'timer') "
        "AND end_time IS NOT NULL AND end_time > start_time "
        "AND (scheduled_session_id IS NULL OR task_id IS NOT NULL)))"
    )
    op.create_index("ix_session_scheduled_session_id", "session", ["scheduled_session_id"])
    op.create_index("ix_session_task_interval", "session", ["task_id", "start_time", "end_time"])


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT 1 FROM scheduled_session LIMIT 1")) or connection.scalar(
        sa.text("SELECT 1 FROM session WHERE kind != 'legacy_uncertain' LIMIT 1")
    ):
        raise RuntimeError("Cannot downgrade with plans or explicit work; restore a consistent pre-upgrade backup.")
    op.drop_index("ix_session_task_interval", table_name="session")
    op.drop_index("ix_session_scheduled_session_id", table_name="session")
    for column in ("revision", "scheduled_session_id", "provenance", "kind"):
        op.drop_column("session", column)
    op.drop_table("scheduled_session")
