"""Add RRULE recurrence fields to task, add recurrenceexception, convert legacy presets

Revision ID: 0006_recurrence_rrule
Revises: 0005_habit_goal_history
Create Date: 2026-09-02 00:00:00.000000

Recurrence stops being "pre-generate real session rows ahead of time" and becomes "store one
master RFC 5545 RRULE per task and project occurrences in memory". This migration:

  1. adds the four authoritative recurrence columns to `task` (plain ADD COLUMN -- all nullable,
     so no SQLite table rebuild is needed, unlike 0004);
  2. creates `recurrenceexception` (skip / override, keyed on RECURRENCE-ID);
  3. converts `is_recurring = 1` tasks from the old preset label to a real RRULE;
  4. NULLs the leaked `recurrence_rule` model default on non-recurring tasks;
  5. deletes *future* generator-fingerprinted placeholder sessions, and only those.

No `sa.func.now()` anywhere: revision 0002 shipped exactly that and broke every fresh database,
because SQLAlchemy's SQLite DateTime binder only accepts real `datetime` objects. One `run_ts` is
computed at the top of `upgrade()` and used for every comparison and every `created_at`, so the
whole migration is a single consistent instant.

This runs on every daemon boot via `run_migrations()`, which no longer swallows failures.
"""
import os
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = '0006_recurrence_rrule'
down_revision: str | None = '0005_habit_goal_history'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Inlined on purpose: a migration is a historical record and must not move when
# `core.recurrence.PRESET_TO_RRULE` moves. Keyed on lower(recurrence_rule); anything
# unrecognised falls through to FREQ=DAILY, matching the old task_service fall-through.
_PRESET_TO_RRULE = {
    'daily': 'FREQ=DAILY',
    'weekdays': 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    'weekly': 'FREQ=WEEKLY',
    'monthly': 'FREQ=MONTHLY',
}
_DEFAULT_RRULE = 'FREQ=DAILY'

# The old generator's default start hour, interpreted as *local* wall-clock time
# (the old code confused local and UTC; this reproduces the intent, not the bug).
_LEGACY_DEFAULT_HOUR = 9


def _local_timezone_name() -> str:
    """Best-effort IANA zone name. Inlined rather than importing core.timezones."""
    tz = (os.environ.get('TZ') or '').strip()
    if tz:
        return tz
    try:
        link = os.readlink('/etc/localtime')
    except OSError:
        return 'UTC'
    marker = '/zoneinfo/'
    idx = link.find(marker)
    if idx >= 0:
        candidate = link[idx + len(marker):].strip('/')
        if candidate:
            return candidate
    return 'UTC'


def _to_naive_utc(local_naive: datetime, tz_name: str) -> datetime:
    """Interpret a naive local wall-clock datetime in `tz_name`, return naive UTC."""
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(tz_name)
    except Exception:
        return local_naive
    return local_naive.replace(tzinfo=tz).astimezone(UTC).replace(tzinfo=None)


def _parse_db_datetime(value) -> datetime | None:
    """SQLite hands datetimes back as strings; parse the shapes this DB actually stores."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    text = str(value).strip()
    if not text:
        return None
    text = text.replace('T', ' ')
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _parse_assigned_date(value) -> datetime | None:
    """Strict YYYY-MM-DD only. `assigned_date` is '' (not NULL) on most real rows."""
    if value is None:
        return None
    text = str(value).strip()
    if len(text) != 10:
        return None
    try:
        return datetime.strptime(text, '%Y-%m-%d')
    except ValueError:
        return None


def upgrade() -> None:
    # A single consistent instant for every comparison and every created_at.
    run_ts = datetime.now(UTC).replace(tzinfo=None)
    tz_name = _local_timezone_name()

    # --- 1. Schema: four nullable columns, plain ADD COLUMN (no table rebuild) ------------
    op.add_column('task', sa.Column('recurrence_rrule', sa.String(), nullable=True))
    op.add_column('task', sa.Column('recurrence_dtstart', sa.DateTime(), nullable=True))
    op.add_column('task', sa.Column('recurrence_duration_minutes', sa.Integer(), nullable=True))
    op.add_column('task', sa.Column('recurrence_timezone', sa.String(), nullable=True))

    # --- 2. recurrenceexception ------------------------------------------------------------
    op.create_table(
        'recurrenceexception',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('task_id', sa.String(), nullable=False),
        sa.Column('occurrence_start', sa.DateTime(), nullable=False),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('session_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['task_id'], ['task.id'], name='fk_recurrenceexception_task'),
        sa.ForeignKeyConstraint(['session_id'], ['session.id'], name='fk_recurrenceexception_session'),
        sa.UniqueConstraint('task_id', 'occurrence_start', name='uq_recurrence_exception'),
    )
    op.create_index('ix_recurrenceexception_task_id', 'recurrenceexception', ['task_id'])
    op.create_index('ix_recurrenceexception_occurrence_start', 'recurrenceexception', ['occurrence_start'])

    bind = op.get_bind()

    # --- 3. Convert is_recurring = 1 rows to a real RRULE ----------------------------------
    recurring = bind.execute(
        sa.text(
            "SELECT id, recurrence_rule, assigned_date, estimated_minutes, created_at "
            "FROM task WHERE is_recurring = 1"
        )
    ).mappings().all()

    for task in recurring:
        preset = (task['recurrence_rule'] or '').strip().lower()
        rrule = _PRESET_TO_RRULE.get(preset, _DEFAULT_RRULE)

        assigned = _parse_assigned_date(task['assigned_date'])
        if assigned is not None:
            # The assigned day at 09:00 *local*, converted to naive UTC.
            dtstart = _to_naive_utc(assigned.replace(hour=_LEGACY_DEFAULT_HOUR), tz_name)
        else:
            dtstart = _parse_db_datetime(task['created_at']) or run_ts
        dtstart = dtstart.replace(second=0, microsecond=0)

        estimated = task['estimated_minutes'] or 15
        duration = 30 if estimated > 120 else estimated

        bind.execute(
            sa.text(
                "UPDATE task SET recurrence_rrule = :rrule, recurrence_dtstart = :dtstart, "
                "recurrence_duration_minutes = :duration, recurrence_timezone = :tz "
                "WHERE id = :id"
            ),
            {
                'rrule': rrule,
                'dtstart': dtstart,
                'duration': duration,
                'tz': tz_name,
                'id': task['id'],
            },
        )

    # --- 4. NULL the leaked model default on non-recurring tasks ---------------------------
    # Cosmetic: nothing reads this column for scheduling any more, but every non-recurring
    # task in the live DB holds a meaningless 'daily' purely because it was the model default
    # and the task modal sent it unconditionally. Stop the field lying.
    bind.execute(sa.text("UPDATE task SET recurrence_rule = NULL WHERE is_recurring = 0"))

    # --- 5. Placeholder cleanup: one deterministic DELETE ----------------------------------
    # `start_time > :run_ts` is the single most important condition here. There is no column
    # marking a row as pre-generated, so `notes LIKE 'Recurring: %'` (written only by the old
    # generator) is the only discriminator available -- and it is user-editable and goes stale
    # when a task is renamed. For FUTURE rows that heuristic fails in the safe direction: a
    # false negative keeps the row. For PAST rows it is not a discriminator at all (a past
    # "Recurring: ..." row is genuinely ambiguous between "placeholder that elapsed" and
    # "I planned it and then actually did it"), so no past or currently-running row is ever
    # touched, full stop. Elapsed placeholders are handled by the opt-in
    # `timetrace recurrence audit` command instead.
    #
    # Also refused: review_skipped = 1 (the user made a review decision), any row a
    # ratingentry targets, any row whose task is no longer recurring (those are the user's
    # now), and 'Scheduled: %' rows from the one-off quick-add path.
    #
    # No recurrenceexception rows are inserted: reconstructing a RECURRENCE-ID for a row the
    # user has already moved is not possible, and guessing inside a boot-time migration that
    # cannot be rolled back is not worth it. The service layer adopts surviving future rows
    # that sit exactly on an occurrence instant on first projection.
    bind.execute(
        sa.text(
            "DELETE FROM session "
            " WHERE start_time > :run_ts "
            "   AND notes LIKE 'Recurring: %' "
            "   AND review_skipped = 0 "
            "   AND task_id IN (SELECT id FROM task WHERE is_recurring = 1) "
            "   AND id NOT IN (SELECT target_id FROM ratingentry WHERE target_type = 'session')"
        ),
        {'run_ts': run_ts},
    )


def downgrade() -> None:
    """Schema downgrade ONLY.

    This does NOT resurrect placeholder sessions deleted by `upgrade()`, and does NOT restore
    the `recurrence_rule = 'daily'` model default that `upgrade()` NULLed on non-recurring
    tasks. Both of those are data changes with no recoverable prior state recorded anywhere in
    the database. If you need the pre-migration data back, restore from the backup in
    `~/.timetrace/backups/` instead of relying on this function.
    """
    op.drop_index('ix_recurrenceexception_occurrence_start', table_name='recurrenceexception')
    op.drop_index('ix_recurrenceexception_task_id', table_name='recurrenceexception')
    op.drop_table('recurrenceexception')

    # SQLite needs a table rebuild for DROP COLUMN on older versions; batch mode handles it.
    with op.batch_alter_table('task') as batch_op:
        batch_op.drop_column('recurrence_timezone')
        batch_op.drop_column('recurrence_duration_minutes')
        batch_op.drop_column('recurrence_dtstart')
        batch_op.drop_column('recurrence_rrule')
