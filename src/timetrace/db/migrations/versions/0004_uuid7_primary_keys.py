"""Migrate integer auto-increment primary keys to UUIDv7 strings

Revision ID: 0004_uuid7_primary_keys
Revises: 0003_uuid7_and_sync_fields
Create Date: 2026-08-20 00:00:01.000000

Auto-increment IDs can't be safely generated offline (two clients could
mint the same next-id). UUIDv7 is time-ordered, so B-Tree insert locality and
`ORDER BY id` chronological ordering are preserved despite switching to a
random-looking string PK.

Every table with an integer PK is rebuilt (SQLite can't ALTER a column's
type in place). For each row, a new UUIDv7 is generated and used wherever
that row's old integer id was referenced, including the polymorphic
`ratingentry.target_id` / `target_type` pair, which isn't a real DB foreign
key so it needs its own translation step.

This migration is one-way: reversing it would require restoring the
original integer ids, which downgrade() cannot reconstruct. Restore from a
pre-migration database backup instead.
"""
import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0004_uuid7_primary_keys'
down_revision: str | None = '0003_uuid7_and_sync_fields'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid_map_for(bind, table: str) -> dict[int, str]:
    rows = bind.execute(sa.text(f"SELECT id FROM {table} ORDER BY id")).fetchall()
    return {row[0]: str(uuid.uuid7()) for row in rows}


def _copy_rows(bind, table: str, transform) -> None:
    """Copies every row from `<table>_old` into the freshly created `table`,
    applying `transform(row_dict)` to remap id-like columns in place."""
    old_rows = bind.execute(sa.text(f"SELECT * FROM {table}_old")).mappings().all()
    for row in old_rows:
        data = dict(row)
        transform(data)
        columns = ", ".join(data.keys())
        placeholders = ", ".join(f":{k}" for k in data.keys())
        bind.execute(sa.text(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"), data)
    op.drop_table(f"{table}_old")


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("PRAGMA foreign_keys=OFF"))

    taskstatus_map = _uuid_map_for(bind, "taskstatus")
    task_map = _uuid_map_for(bind, "task")
    session_map = _uuid_map_for(bind, "session")
    taskreview_map = _uuid_map_for(bind, "taskreview")
    dayreview_map = _uuid_map_for(bind, "dayreview")
    ratingdefinition_map = _uuid_map_for(bind, "ratingdefinition")
    ratingentry_map = _uuid_map_for(bind, "ratingentry")
    habit_map = _uuid_map_for(bind, "habit")
    habitlog_map = _uuid_map_for(bind, "habitlog")

    # --- taskstatus ---
    op.rename_table("taskstatus", "taskstatus_old")
    op.drop_index("ix_taskstatus_name", table_name="taskstatus_old")
    op.create_table(
        "taskstatus",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_hide_by_default", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_scheduled_trigger", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("color", sa.String(), nullable=False, server_default="#7c3aed"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_taskstatus_name", "taskstatus", ["name"], unique=True)

    def _taskstatus_transform(row):
        row["id"] = taskstatus_map[row["id"]]

    _copy_rows(bind, "taskstatus", _taskstatus_transform)

    # --- task (self-referential parent_id + status_id FK) ---
    op.rename_table("task", "task_old")
    op.create_table(
        "task",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("priority", sa.String(), nullable=False, server_default="-"),
        sa.Column("estimated_minutes", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("status_id", sa.String(), nullable=True),
        sa.Column("parent_id", sa.String(), nullable=True),
        sa.Column("category", sa.String(), nullable=False, server_default="work"),
        sa.Column("color", sa.String(), nullable=False, server_default="auto"),
        sa.Column("tags", sa.String(), nullable=False, server_default=""),
        sa.Column("due_date", sa.DateTime(), nullable=True),
        sa.Column("assigned_date", sa.String(), nullable=True),
        sa.Column("attachments", sa.String(), nullable=True, server_default=""),
        sa.Column("is_recurring", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("recurrence_rule", sa.String(), nullable=True, server_default="daily"),
        sa.Column("requires_session_review", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["status_id"], ["taskstatus.id"], name="fk_task_status"),
        sa.ForeignKeyConstraint(["parent_id"], ["task.id"], name="fk_task_parent", ondelete="CASCADE"),
    )

    def _task_transform(row):
        row["id"] = task_map[row["id"]]
        row["parent_id"] = task_map.get(row["parent_id"]) if row["parent_id"] is not None else None
        row["status_id"] = taskstatus_map.get(row["status_id"]) if row["status_id"] is not None else None

    _copy_rows(bind, "task", _task_transform)

    # --- session (FK task_id) ---
    op.rename_table("session", "session_old")
    op.drop_index("ix_session_external_sync_id", table_name="session_old")
    op.create_table(
        "session",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("tags", sa.String(), nullable=False, server_default=""),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("review_skipped", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("timezone", sa.String(), nullable=False, server_default="UTC"),
        sa.Column("external_sync_id", sa.String(), nullable=True),
        sa.Column("external_provider", sa.String(), nullable=True),
        sa.Column("extended_properties_json", sa.String(), nullable=False, server_default="{}"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["task_id"], ["task.id"], name="fk_session_task"),
    )
    op.create_index("ix_session_external_sync_id", "session", ["external_sync_id"])

    def _session_transform(row):
        row["id"] = session_map[row["id"]]
        row["task_id"] = task_map.get(row["task_id"]) if row["task_id"] is not None else None

    _copy_rows(bind, "session", _session_transform)

    # --- taskreview (FK task_id, unique) ---
    op.rename_table("taskreview", "taskreview_old")
    op.create_table(
        "taskreview",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("task_id", sa.String(), nullable=False),
        sa.Column("difficulty", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("what_went_well", sa.String(), nullable=True),
        sa.Column("blockers", sa.String(), nullable=True),
        sa.Column("key_takeaways", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["task_id"], ["task.id"], name="fk_taskreview_task"),
        sa.UniqueConstraint("task_id"),
    )

    def _taskreview_transform(row):
        row["id"] = taskreview_map[row["id"]]
        row["task_id"] = task_map[row["task_id"]]

    _copy_rows(bind, "taskreview", _taskreview_transform)

    # --- dayreview (no dependents) ---
    op.rename_table("dayreview", "dayreview_old")
    op.drop_index("ix_dayreview_date_str", table_name="dayreview_old")
    op.create_table(
        "dayreview",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("date_str", sa.String(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("highlights", sa.String(), nullable=True),
        sa.Column("friction", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("review_skipped", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("date_str"),
    )
    op.create_index("ix_dayreview_date_str", "dayreview", ["date_str"], unique=True)

    def _dayreview_transform(row):
        row["id"] = dayreview_map[row["id"]]

    _copy_rows(bind, "dayreview", _dayreview_transform)

    # --- ratingdefinition (no dependents) ---
    op.rename_table("ratingdefinition", "ratingdefinition_old")
    op.create_table(
        "ratingdefinition",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("target_type", sa.String(), nullable=False, server_default="session"),
        sa.Column("min_score", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("max_score", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    def _ratingdefinition_transform(row):
        row["id"] = ratingdefinition_map[row["id"]]

    _copy_rows(bind, "ratingdefinition", _ratingdefinition_transform)

    # --- ratingentry (FK rating_definition_id + polymorphic target_id) ---
    op.rename_table("ratingentry", "ratingentry_old")
    op.drop_index("ix_ratingentry_target_id", table_name="ratingentry_old")
    op.drop_index("ix_ratingentry_target_type", table_name="ratingentry_old")
    op.create_table(
        "ratingentry",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("rating_definition_id", sa.String(), nullable=False),
        sa.Column("target_type", sa.String(), nullable=False),
        sa.Column("target_id", sa.String(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("dismissed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["rating_definition_id"], ["ratingdefinition.id"], name="fk_ratingentry_definition"),
    )
    op.create_index("ix_ratingentry_target_id", "ratingentry", ["target_id"])
    op.create_index("ix_ratingentry_target_type", "ratingentry", ["target_type"])

    def _ratingentry_transform(row):
        row["id"] = ratingentry_map[row["id"]]
        row["rating_definition_id"] = ratingdefinition_map[row["rating_definition_id"]]
        if row["target_type"] == "task":
            try:
                row["target_id"] = task_map.get(int(row["target_id"]), row["target_id"])
            except ValueError:
                pass
        elif row["target_type"] == "session":
            try:
                row["target_id"] = session_map.get(int(row["target_id"]), row["target_id"])
            except ValueError:
                pass

    _copy_rows(bind, "ratingentry", _ratingentry_transform)

    # --- habit (no dependents other than habitlog) ---
    op.rename_table("habit", "habit_old")
    op.create_table(
        "habit",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("habit_type", sa.String(), nullable=False, server_default="boolean"),
        sa.Column("target_value", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("unit", sa.String(), nullable=False, server_default=""),
        sa.Column("frequency", sa.String(), nullable=False, server_default="Every day"),
        sa.Column("reminder_time", sa.String(), nullable=True),
        sa.Column("color", sa.String(), nullable=False, server_default="#10b981"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    def _habit_transform(row):
        row["id"] = habit_map[row["id"]]

    _copy_rows(bind, "habit", _habit_transform)

    # --- habitlog (FK habit_id) ---
    op.rename_table("habitlog", "habitlog_old")
    op.drop_index("ix_habitlog_date_str", table_name="habitlog_old")
    op.create_table(
        "habitlog",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("habit_id", sa.String(), nullable=False),
        sa.Column("date_str", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="completed"),
        sa.Column("value", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("notes", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["habit_id"], ["habit.id"], name="fk_habitlog_habit"),
    )
    op.create_index("ix_habitlog_date_str", "habitlog", ["date_str"])

    def _habitlog_transform(row):
        row["id"] = habitlog_map[row["id"]]
        row["habit_id"] = habit_map[row["habit_id"]]

    _copy_rows(bind, "habitlog", _habitlog_transform)

    bind.execute(sa.text("PRAGMA foreign_keys=ON"))


def downgrade() -> None:
    raise RuntimeError(
        "0004_uuid7_primary_keys cannot be reversed (original integer ids are not "
        "recoverable). Restore the database from a pre-migration backup instead."
    )
