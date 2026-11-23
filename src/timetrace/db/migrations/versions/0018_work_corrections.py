"""Append-only correction lineage without live-row foreign keys.

Revision ID: 0018_work_corrections
Revises: 0017_timer_receipts
"""

import sqlalchemy as sa
from alembic import op

revision = "0018_work_corrections"
down_revision = "0017_timer_receipts"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "work_correction",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("operation_id", sa.String(), nullable=False),
        sa.Column("source_identity", sa.String(), nullable=False),
        sa.Column("source_work_id", sa.String(), nullable=True),
        sa.Column("source_revision", sa.Integer(), nullable=False),
        sa.Column("before_json", sa.String(), nullable=False),
        sa.Column("results_json", sa.String(), nullable=False),
        sa.Column("cutoff", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
    )
    for field in ("operation_id", "source_identity", "source_work_id"):
        op.create_index("ix_work_correction_" + field, "work_correction", [field])

    for action in ("UPDATE", "DELETE"):
        op.execute(
            f"CREATE TRIGGER work_correction_no_{action.lower()} BEFORE {action} ON work_correction "
            "BEGIN SELECT RAISE(ABORT, 'Correction history is append-only'); END"
        )


def downgrade():
    bind = op.get_bind()
    if (
        bind.execute(sa.text("SELECT 1 FROM work_correction LIMIT 1")).first()
        or bind.execute(sa.text("SELECT 1 FROM mutation_operation LIMIT 1")).first()
    ):
        raise RuntimeError("Correction history exists; export/archive before destructive downgrade.")
    op.drop_table("work_correction")
