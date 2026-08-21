"""Add HabitGoalHistory table and backfill one row per existing habit

Revision ID: 0005_habit_goal_history
Revises: 0004_uuid7_primary_keys
Create Date: 2026-08-21 00:00:00.000000

"""
import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0005_habit_goal_history'
down_revision: str | None = '0004_uuid7_primary_keys'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'habitgoalhistory',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('habit_id', sa.String(), nullable=False),
        sa.Column('target_value', sa.Float(), nullable=False),
        sa.Column('effective_from', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['habit_id'], ['habit.id'], name='fk_habitgoalhistory_habit'),
    )
    op.create_index('ix_habitgoalhistory_habit_id', 'habitgoalhistory', ['habit_id'])
    op.create_index('ix_habitgoalhistory_effective_from', 'habitgoalhistory', ['effective_from'])

    # Backfill: every habit that already exists gets one goal-history row at its
    # current target_value, dated to the habit's own creation day. This is the
    # earliest point the goal can honestly be said to have held that value --
    # nothing further back is known, since the value wasn't tracked historically
    # before this migration.
    bind = op.get_bind()
    habits = bind.execute(sa.text("SELECT id, target_value, created_at FROM habit")).mappings().all()
    for h in habits:
        effective_from = str(h["created_at"])[:10]
        bind.execute(
            sa.text(
                "INSERT INTO habitgoalhistory (id, habit_id, target_value, effective_from, created_at) "
                "VALUES (:id, :habit_id, :target_value, :effective_from, :created_at)"
            ),
            {
                "id": str(uuid.uuid7()),
                "habit_id": h["id"],
                "target_value": h["target_value"],
                "effective_from": effective_from,
                "created_at": h["created_at"],
            },
        )


def downgrade() -> None:
    op.drop_index('ix_habitgoalhistory_effective_from', table_name='habitgoalhistory')
    op.drop_index('ix_habitgoalhistory_habit_id', table_name='habitgoalhistory')
    op.drop_table('habitgoalhistory')
