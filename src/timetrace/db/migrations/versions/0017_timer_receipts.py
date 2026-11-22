"""Private durable timer operation receipts.

Revision ID: 0017_timer_receipts
Revises: 0016_recorded_work_index
"""

import sqlalchemy as sa
from alembic import op

revision = "0017_timer_receipts"
down_revision = "0016_recorded_work_index"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("session") as batch:
        batch.add_column(sa.Column("timer_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("timer_operation_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("timer_segment_id", sa.String(), nullable=True))
        batch.create_unique_constraint("uq_timer_operation_segment", ["timer_operation_id", "timer_segment_id"])
    op.create_table(
        "mutation_operation",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("payload_hash", sa.String(), nullable=False),
        sa.Column("before_revision", sa.Integer(), nullable=False),
        sa.Column("after_revision", sa.Integer(), nullable=False),
        sa.Column("cutoff", sa.String(), nullable=False),
        sa.Column("after_state_json", sa.String(), nullable=False),
        sa.Column("result_json", sa.String(), nullable=False),
        sa.Column("file_finalized", sa.Boolean(), nullable=False),
    )


def downgrade():
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT count(*) FROM mutation_operation")).scalar():
        raise RuntimeError("Restore a consistent DB/timer backup; timer receipts cannot be discarded.")
    op.drop_table("mutation_operation")
    with op.batch_alter_table("session") as batch:
        batch.drop_constraint("uq_timer_operation_segment", type_="unique")
        batch.drop_column("timer_segment_id")
        batch.drop_column("timer_operation_id")
        batch.drop_column("timer_id")
