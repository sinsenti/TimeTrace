"""Add AI scheduling preferences and the local task full-text search index.

Revision ID: 0010_ai_search_and_scheduling_preferences
Revises: 0009_dashboards_and_widgets
Create Date: 2026-09-06 00:00:00.000000

The preference columns make the scheduler's constraints explicit instead of hiding them in
custom prompt text. The FTS5 table is an external-content index over ``task``: the task table
remains the source of truth, while SQLite maintains a local searchable index for titles,
descriptions, tags, and categories. No provider or network is involved.

SQLite's FTS5 virtual table is not represented in SQLModel metadata, so the migration creates it
and its synchronization triggers explicitly. ``AIInsightsService`` repeats the idempotent setup
for the in-memory ``create_all`` test engine, which intentionally does not run Alembic.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_ai_search_and_scheduling_preferences"
down_revision: str | None = "0009_dashboards_and_widgets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "aisettings",
        sa.Column("scheduling_day_start", sa.String(), nullable=False, server_default="09:00"),
    )
    op.add_column(
        "aisettings",
        sa.Column("scheduling_day_end", sa.String(), nullable=False, server_default="17:00"),
    )
    op.add_column(
        "aisettings",
        sa.Column("minimum_break_minutes", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "aisettings",
        sa.Column("maximum_daily_minutes", sa.Integer(), nullable=True),
    )
    op.add_column(
        "aisettings",
        sa.Column("scheduling_days_json", sa.String(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "aisettings",
        sa.Column("preferred_tags_json", sa.String(), nullable=False, server_default="[]"),
    )

    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        return

    op.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS task_search USING fts5(
            title,
            description,
            tags,
            category,
            content='task',
            content_rowid='rowid'
        )
        """
    )
    op.execute("INSERT INTO task_search(task_search) VALUES ('rebuild')")
    op.execute(
        """
        CREATE TRIGGER IF NOT EXISTS task_search_ai AFTER INSERT ON task BEGIN
            INSERT INTO task_search(rowid, title, description, tags, category)
            VALUES (
                new.rowid, new.title, COALESCE(new.description, ''), COALESCE(new.tags, ''),
                COALESCE(new.category, '')
            );
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER IF NOT EXISTS task_search_ad AFTER DELETE ON task BEGIN
            INSERT INTO task_search(task_search, rowid, title, description, tags, category)
            VALUES (
                'delete', old.rowid, old.title, COALESCE(old.description, ''), COALESCE(old.tags, ''),
                COALESCE(old.category, '')
            );
        END
        """
    )
    op.execute(
        """
        CREATE TRIGGER IF NOT EXISTS task_search_au
        AFTER UPDATE OF title, description, tags, category ON task BEGIN
            INSERT INTO task_search(task_search, rowid, title, description, tags, category)
            VALUES (
                'delete', old.rowid, old.title, COALESCE(old.description, ''), COALESCE(old.tags, ''),
                COALESCE(old.category, '')
            );
            INSERT INTO task_search(rowid, title, description, tags, category)
            VALUES (
                new.rowid, new.title, COALESCE(new.description, ''), COALESCE(new.tags, ''),
                COALESCE(new.category, '')
            );
        END
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.execute("DROP TRIGGER IF EXISTS task_search_au")
        op.execute("DROP TRIGGER IF EXISTS task_search_ad")
        op.execute("DROP TRIGGER IF EXISTS task_search_ai")
        op.execute("DROP TABLE IF EXISTS task_search")

    op.drop_column("aisettings", "preferred_tags_json")
    op.drop_column("aisettings", "scheduling_days_json")
    op.drop_column("aisettings", "maximum_daily_minutes")
    op.drop_column("aisettings", "minimum_break_minutes")
    op.drop_column("aisettings", "scheduling_day_end")
    op.drop_column("aisettings", "scheduling_day_start")
