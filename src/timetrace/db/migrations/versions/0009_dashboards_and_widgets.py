"""Add Dashboard and DashboardWidget tables

Revision ID: 0009_dashboards_and_widgets
Revises: 0007_ai_assistant_tables
Create Date: 2026-09-05 00:00:00.000000

Backs slice 2 of "statistics & custom dashboards": named, persisted dashboards made of
widgets, replacing the localStorage-only widget list in `static/js/dashboards.js`.

An earlier version of this exact schema landed as `0006_dashboards_and_widgets` and was
reverted in `db525d5` for sequencing reasons only (the tables arrived before anything read
them), not because the shape was wrong. This revision is that work rebased onto the real
head, with two deltas:

  * `updated_at` on both tables (a widget's spec is edited in place, so "last changed" is
    a fact the UI needs and `created_at` cannot supply).
  * NO `chart_type` column. Chart type lives inside `spec_json` and nowhere else. A column
    plus a key in the JSON would be two authorities for one fact, which is the same trap
    as `task.status` vs `task.status_id` -- those two are already only "loosely in sync"
    and no one should have to reason about a third instance of it.

Deliberate choices that look like omissions but are not:

  * `spec_json` is a plain String, not a JSON column type. The query/SQL spec is opaque to
    the DB layer on purpose; the Pydantic schema on the API side is its only authority.
  * `width` is a plain String ("half" / "full"), not an enum or a check constraint. SQLite
    check constraints cannot be altered in place, so a new width value would cost a full
    table rebuild for zero integrity gain.
  * `seed_key` is nullable and unindexed. It marks which seeded Overview widget a row came
    from so re-seeding is idempotent; only the seed path reads it, and it is a handful of
    rows scanned once at boot.
  * `dashboardwidget.dashboard_id` is a real FK with `ondelete='CASCADE'`, mirroring
    `fk_task_parent` from revision 0004 -- the ORM also declares
    `cascade="all, delete-orphan"`, and this repo's precedent is to state the intent in
    both places rather than trust either alone.

No rows are seeded here. The default "overview" dashboard is created at application boot by
the service layer, deliberately not by this migration: revision 0002 seeded a table from
inside `op.bulk_insert` using `sa.func.now()`, which SQLAlchemy's SQLite DateTime binder
rejects, and that broke `alembic upgrade head` on every genuinely fresh database. This
revision inserts nothing and uses no server-side defaults at all, so it has no timestamp
default to get wrong.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0009_dashboards_and_widgets'
down_revision: str | None = '0008_ai_custom_instructions'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- dashboard (parent first: the widget references it) ---------------------------------
    op.create_table(
        'dashboard',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('slug', sa.String(), nullable=False),
        sa.Column('is_seeded', sa.Boolean(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_dashboard_slug', 'dashboard', ['slug'], unique=True)

    # --- dashboardwidget --------------------------------------------------------------------
    op.create_table(
        'dashboardwidget',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('dashboard_id', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        # width: plain string ("half" | "full"), no enum/check -- see module docstring.
        sa.Column('width', sa.String(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        # spec_json: opaque JSON-serialized query or SQL spec; chart type lives in here.
        # sa.String(), not sa.Text(): SQLModel renders a `str` field as AutoString/VARCHAR,
        # and SQLite gives VARCHAR and TEXT identical unlimited storage, so Text() would buy
        # nothing and only make `alembic revision --autogenerate` report a permanent
        # modify_type drift against the model. Every other JSON blob column in this schema
        # (aidraftitem.proposed_json, baseline_json, ...) is String() for the same reason.
        sa.Column('spec_json', sa.String(), nullable=False),
        sa.Column('seed_key', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['dashboard_id'],
            ['dashboard.id'],
            name='fk_dashboardwidget_dashboard',
            ondelete='CASCADE',
        ),
    )
    op.create_index('ix_dashboardwidget_dashboard_id', 'dashboardwidget', ['dashboard_id'])


def downgrade() -> None:
    """Drops both tables. The upgrade is purely additive, so this is a genuine inverse of the
    *schema*; any dashboards and widgets configured since the upgrade go with the tables and
    are not recoverable from anywhere but a backup in `~/.timetrace/backups/`.

    Child before parent: `dashboardwidget.dashboard_id` references `dashboard.id`.
    """
    op.drop_index('ix_dashboardwidget_dashboard_id', table_name='dashboardwidget')
    op.drop_table('dashboardwidget')

    op.drop_index('ix_dashboard_slug', table_name='dashboard')
    op.drop_table('dashboard')
