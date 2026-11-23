"""Optional personal goal settings and DB-only receipts; no target backfill."""

import sqlalchemy as sa
from alembic import op

revision = "0020_personal_goals"
down_revision = "0019_timer_focus"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "goal_reporting_context",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False, unique=True),
        sa.Column("timezone", sa.String(), nullable=False),
        sa.Column("first_day_of_week", sa.Integer(), nullable=False),
        sa.Column("effective_at", sa.String(), nullable=False),
        sa.Column("effective_day_start", sa.String(), nullable=False),
        sa.Column("effective_week_start", sa.String(), nullable=False),
    )
    op.create_table(
        "goal_definition",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_key", sa.String(), nullable=False),
        sa.Column("cadence", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.UniqueConstraint("owner_key", "cadence"),
    )
    op.create_table(
        "goal_settings_version",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("goal_id", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("effective_period_start", sa.String(), nullable=False),
        sa.Column("context_revision", sa.Integer(), nullable=False),
        sa.Column("target_seconds", sa.Float(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("include_descendants", sa.Boolean(), nullable=False),
        sa.Column("timezone", sa.String(), nullable=False),
        sa.Column("first_day_of_week", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.String(), nullable=True),
    )
    op.create_index("ix_goal_settings_version_goal_id", "goal_settings_version", ["goal_id"])
    op.create_table(
        "goal_settings_receipt",
        sa.Column("operation_id", sa.String(), primary_key=True),
        sa.Column("payload", sa.String(), nullable=False),
        sa.Column("response", sa.String(), nullable=False),
    )


def downgrade():
    op.drop_table("goal_settings_receipt")
    op.drop_index("ix_goal_settings_version_goal_id", table_name="goal_settings_version")
    op.drop_table("goal_settings_version")
    op.drop_table("goal_definition")
    op.drop_table("goal_reporting_context")
