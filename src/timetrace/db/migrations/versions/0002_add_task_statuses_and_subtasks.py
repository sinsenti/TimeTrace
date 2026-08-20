"""Add TaskStatus table, parent_id for subtasks, and category attributes

Revision ID: 0002_add_task_statuses_and_subtasks
Revises: 0001_initial_schema
Create Date: 2026-08-14 17:30:00.000000

"""
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = '0002_add_task_statuses_and_subtasks'
down_revision: str | None = '0001_initial_schema'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Create taskstatus table
    op.create_table(
        'taskstatus',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('is_completed', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('is_hide_by_default', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('is_scheduled_trigger', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('color', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='#7c3aed'),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_taskstatus_name'), 'taskstatus', ['name'], unique=True)

    # 2. Seed Default Task Statuses
    taskstatus_table = sa.sql.table(
        'taskstatus',
        sa.Column('id', sa.Integer),
        sa.Column('name', sa.String),
        sa.Column('is_completed', sa.Boolean),
        sa.Column('is_hide_by_default', sa.Boolean),
        sa.Column('is_scheduled_trigger', sa.Boolean),
        sa.Column('color', sa.String),
        sa.Column('position', sa.Integer),
        sa.Column('created_at', sa.DateTime)
    )

    # A literal datetime, not sa.func.now(): SQLAlchemy's SQLite DateTime binder
    # rejects a SQL function object, which made `alembic upgrade head` die here on
    # any fresh database. Naive UTC, matching how every other datetime is stored.
    seeded_at = datetime.now(UTC).replace(tzinfo=None)

    op.bulk_insert(
        taskstatus_table,
        [
            {'id': 1, 'name': 'To Do', 'is_completed': False, 'is_hide_by_default': False, 'is_scheduled_trigger': False, 'color': '#2563eb', 'position': 0, 'created_at': seeded_at},
            {'id': 2, 'name': 'Ongoing', 'is_completed': False, 'is_hide_by_default': False, 'is_scheduled_trigger': False, 'color': '#d97706', 'position': 1, 'created_at': seeded_at},
            {'id': 3, 'name': 'Scheduled', 'is_completed': False, 'is_hide_by_default': False, 'is_scheduled_trigger': True, 'color': '#7c3aed', 'position': 2, 'created_at': seeded_at},
            {'id': 4, 'name': 'Done', 'is_completed': True, 'is_hide_by_default': True, 'is_scheduled_trigger': False, 'color': '#059669', 'position': 3, 'created_at': seeded_at},
            {'id': 5, 'name': 'Backlog', 'is_completed': False, 'is_hide_by_default': False, 'is_scheduled_trigger': False, 'color': '#64748b', 'position': 4, 'created_at': seeded_at},
        ]
    )

    # 3. Add parent_id, status_id, category to task table
    with op.batch_alter_table('task') as batch_op:
        batch_op.add_column(sa.Column('parent_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('status_id', sa.Integer(), nullable=True, server_default='1'))
        batch_op.add_column(sa.Column('category', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='work'))
        batch_op.create_foreign_key('fk_task_parent', 'task', ['parent_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key('fk_task_status', 'taskstatus', ['status_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('task') as batch_op:
        batch_op.drop_constraint('fk_task_status', type_='foreignkey')
        batch_op.drop_constraint('fk_task_parent', type_='foreignkey')
        batch_op.drop_column('category')
        batch_op.drop_column('status_id')
        batch_op.drop_column('parent_id')

    op.drop_index(op.f('ix_taskstatus_name'), table_name='taskstatus')
    op.drop_table('taskstatus')
