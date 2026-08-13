"""Initial database schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-08-13 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = '0001_initial_schema'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'task',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('priority', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='-'),
        sa.Column('estimated_minutes', sa.Integer(), nullable=True),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='in_progress'),
        sa.Column('color', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='auto'),
        sa.Column('tags', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
        sa.Column('requires_session_review', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'session',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=True),
        sa.Column('start_time', sa.DateTime(), nullable=False),
        sa.Column('end_time', sa.DateTime(), nullable=True),
        sa.Column('duration_seconds', sa.Integer(), nullable=True),
        sa.Column('tags', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
        sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('review_skipped', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.ForeignKeyConstraint(['task_id'], ['task.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'taskreview',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=False),
        sa.Column('difficulty', sa.Integer(), nullable=False, server_default='3'),
        sa.Column('what_went_well', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('blockers', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('key_takeaways', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['task.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_id')
    )

    op.create_table(
        'dayreview',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('date_str', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('rating', sa.Integer(), nullable=False, server_default='3'),
        sa.Column('highlights', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('friction', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('review_skipped', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_dayreview_date_str'), 'dayreview', ['date_str'], unique=True)

    op.create_table(
        'ratingdefinition',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('target_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='session'),
        sa.Column('min_score', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('max_score', sa.Integer(), nullable=False, server_default='10'),
        sa.Column('is_required', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'ratingentry',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('rating_definition_id', sa.Integer(), nullable=False),
        sa.Column('target_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('target_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('score', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('dismissed', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['rating_definition_id'], ['ratingdefinition.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ratingentry_target_id'), 'ratingentry', ['target_id'], unique=False)
    op.create_index(op.f('ix_ratingentry_target_type'), 'ratingentry', ['target_type'], unique=False)

    op.create_table(
        'habit',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('habit_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='boolean'),
        sa.Column('target_value', sa.Float(), nullable=False, server_default='1.0'),
        sa.Column('unit', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
        sa.Column('frequency', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='Every day'),
        sa.Column('reminder_time', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('color', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='#10b981'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'habitlog',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('habit_id', sa.Integer(), nullable=False),
        sa.Column('date_str', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='completed'),
        sa.Column('value', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.ForeignKeyConstraint(['habit_id'], ['habit.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_habitlog_date_str'), 'habitlog', ['date_str'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_habitlog_date_str'), table_name='habitlog')
    op.drop_table('habitlog')
    op.drop_table('habit')
    op.drop_index(op.f('ix_ratingentry_target_type'), table_name='ratingentry')
    op.drop_index(op.f('ix_ratingentry_target_id'), table_name='ratingentry')
    op.drop_table('ratingentry')
    op.drop_table('ratingdefinition')
    op.drop_index(op.f('ix_dayreview_date_str'), table_name='dayreview')
    op.drop_table('dayreview')
    op.drop_table('taskreview')
    op.drop_table('session')
    op.drop_table('task')
