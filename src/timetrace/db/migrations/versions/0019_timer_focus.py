"""Durable local timer notifications, independent of deletable work rows."""

import sqlalchemy as sa
from alembic import op

revision = "0019_timer_focus"
down_revision = "0018_work_corrections"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "timer_notification",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("timer_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("due_at", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=True),
        sa.Column("claim_token", sa.String(), nullable=True),
        sa.Column("claim_operation", sa.String(), nullable=True),
        sa.Column("acknowledged", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("timer_id", "kind", "generation"),
    )
    op.create_index("ix_timer_notification_timer_id", "timer_notification", ["timer_id"])


def downgrade():
    op.drop_index("ix_timer_notification_timer_id", table_name="timer_notification")
    op.drop_table("timer_notification")
