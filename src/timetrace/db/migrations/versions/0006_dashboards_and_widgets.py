"""Add Dashboard and DashboardWidget tables

Revision ID: 0006_dashboards_and_widgets
Revises: 0005_habit_goal_history
Create Date: 2026-08-24 00:00:00.000000

Schema only -- no rows are seeded here. The default "overview" dashboard is
created at application boot by the service layer, deliberately not by this
migration: migration 0002 once seeded a table from inside `op.bulk_insert` using
`sa.func.now()`, which the SQLite DateTime binder rejects, and that broke
`alembic upgrade head` on any genuinely fresh database.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0006_dashboards_and_widgets'
down_revision: str | None = '0005_habit_goal_history'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'dashboard',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('slug', sa.String(), nullable=False),
        sa.Column('is_seeded', sa.Boolean(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_dashboard_slug', 'dashboard', ['slug'], unique=True)

    op.create_table(
        'dashboardwidget',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('dashboard_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('chart_type', sa.String(), nullable=False),
        sa.Column('width', sa.String(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('spec_json', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['dashboard_id'], ['dashboard.id'], name='fk_dashboardwidget_dashboard'),
    )
    op.create_index('ix_dashboardwidget_dashboard_id', 'dashboardwidget', ['dashboard_id'])


def downgrade() -> None:
    # Child table first: dashboardwidget.dashboard_id references dashboard.id.
    op.drop_index('ix_dashboardwidget_dashboard_id', table_name='dashboardwidget')
    op.drop_table('dashboardwidget')
    op.drop_index('ix_dashboard_slug', table_name='dashboard')
    op.drop_table('dashboard')
