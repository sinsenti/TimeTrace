"""Verify the actual Alembic chain, including a consistent backup of synthetic 0013 data."""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path
from uuid import UUID

import pytest

ROOT = Path(__file__).resolve().parents[1]
OLD = "0013_ai_data_scope"
FOUNDATION = "0014_agenda_foundation"
HEAD = "0019_timer_focus"
TASK = "00000000-0000-7000-8000-000000000001"
LOG = "00000000-0000-7000-8000-000000000002"
WHEN = "2000-01-04 14:00:00.000000"
END = "2000-01-04 15:00:00.000000"


def run_on(db_file, *python_args):
    result = subprocess.run(
        [sys.executable, "-P", *python_args],
        cwd=ROOT,
        env={**os.environ, "TIMETRACE_DB_FILE": str(db_file), "TIMETRACE_IDLE_DETECTION_ENABLED": "false"},
        capture_output=True,
        timeout=45,
    )
    assert result.returncode == 0, result.stderr.decode()
    return result.stdout


def seed_old(conn):
    # Use only the migrated 0013 schema, not current ORM classes or create_all.
    def insert(table, **values):
        columns = ", ".join(values)
        params = ", ".join("?" for _ in values)
        conn.execute(f"INSERT INTO {table} ({columns}) VALUES ({params})", tuple(values.values()))

    insert("task", id=TASK, title="Writing", status="To Do", created_at=WHEN)
    insert(
        "task",
        id="series",
        title="Series",
        parent_id=TASK,
        status="To Do",
        created_at=WHEN,
        is_recurring=1,
        recurrence_rrule="FREQ=DAILY",
        recurrence_dtstart=WHEN,
        recurrence_timezone="UTC",
        recurrence_duration_minutes=30,
    )
    insert(
        "session",
        id=LOG,
        task_id=TASK,
        start_time=WHEN,
        end_time=END,
        duration_seconds=3600,
        notes="Old note\nSecond line",
        tags="#writing #synthetic",
        review_skipped=1,
        timezone="America/New_York",
        external_sync_id="synthetic-external",
        external_provider="fixture",
        extended_properties_json='{"keep": ["spaces", 2]}',
    )
    insert("session", id="open-taskless", start_time=WHEN, duration_seconds=120)
    insert(
        "session",
        id="moved",
        task_id="series",
        start_time="2099-01-04 16:00:00.000000",
        end_time="2099-01-04 16:30:00.000000",
        duration_seconds=1800,
    )
    insert("taskreview", id="review", task_id=TASK, what_went_well="Kept focus", created_at=WHEN)
    insert("dayreview", id="day", date_str="2000-01-04", notes="Day note", created_at=WHEN)
    insert("ratingdefinition", id="scale", name="Energy", created_at=WHEN)
    insert(
        "ratingentry",
        id="rated",
        rating_definition_id="scale",
        target_type="session",
        target_id=LOG,
        score=5,
        notes="Rating note",
        created_at=WHEN,
    )
    insert(
        "recurrenceexception",
        id="override",
        task_id="series",
        kind="override",
        session_id="moved",
        occurrence_start="2099-01-04 14:00:00.000000",
        created_at=WHEN,
    )
    insert(
        "recurrenceexception",
        id="skip",
        task_id="series",
        kind="skip",
        occurrence_start="2099-01-05 14:00:00.000000",
        created_at=WHEN,
    )
    snapshot = json.dumps({"id": LOG, "task_id": TASK, "notes": "Old note\nSecond line"})
    insert("aidraftbatch", id="batch", status="partially_applied", item_count=2, created_at=WHEN)
    for position, state in enumerate(("pending", "applied")):
        insert(
            "aidraftitem",
            id=state,
            batch_id="batch",
            position=position,
            op="update",
            entity_type="session",
            proposed_json='{"notes":"Suggestion"}',
            baseline_json=snapshot,
            status=state,
            applied_entity_id=LOG if state == "applied" else None,
            applied_before_json=snapshot if state == "applied" else None,
            applied_after_json=snapshot if state == "applied" else None,
            target_id=LOG,
            created_at=WHEN,
            updated_at=WHEN,
        )
    insert(
        "aiaudit",
        id="audit",
        batch_id="batch",
        item_id="applied",
        entity_id=LOG,
        entity_type="session",
        transition="applied",
        actor="user",
        before_json=snapshot,
        after_json=snapshot,
        created_at=WHEN,
    )
    insert(
        "dashboard",
        id="dashboard",
        name="Writing totals",
        slug="writing",
        is_seeded=0,
        position=0,
        created_at=WHEN,
        updated_at=WHEN,
    )
    spec = json.dumps(
        {
            "query": {
                "source": "sessions",
                "measure": "sum_duration",
                "filters": [{"field": "task", "op": "eq", "value": TASK}],
            }
        }
    )
    insert(
        "dashboardwidget",
        id="widget",
        dashboard_id="dashboard",
        title="Writing",
        width=1,
        position=0,
        spec_json=spec,
        created_at=WHEN,
        updated_at=WHEN,
    )


def legacy_snapshot(conn, tables):
    return {
        table: conn.execute(f"SELECT {', '.join(columns)} FROM {table} ORDER BY id").fetchall()
        for table, columns in tables.items()
    }


def test_daemon_refuses_unversioned_old_database_without_changing_it(tmp_path):
    db_file = tmp_path / "unversioned.sqlite"
    run_on(db_file, "-m", "alembic", "upgrade", OLD)
    with closing(sqlite3.connect(db_file)) as conn:
        seed_old(conn)
        conn.execute("DROP TABLE alembic_version")
        conn.commit()
        before = tuple(conn.iterdump())

    startup = """
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app

try:
    with TestClient(create_daemon_app()):
        raise AssertionError('daemon started with an unversioned database')
except RuntimeError as exc:
    assert 'unversioned' in str(exc).lower(), str(exc)
    assert 'backup' in str(exc).lower(), str(exc)
"""
    run_on(db_file, "-c", startup)
    with closing(sqlite3.connect(db_file)) as conn:
        assert tuple(conn.iterdump()) == before


def test_daemon_refuses_missing_alembic_assets_without_creating_schema(tmp_path):
    assets = tmp_path / "incomplete" / "src"
    shutil.copytree(ROOT / "src" / "timetrace", assets / "timetrace", ignore=shutil.ignore_patterns("__pycache__"))
    db_file = tmp_path / "missing_assets.sqlite"
    startup = """
import sys
sys.path.insert(0, sys.argv[1])

from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app

try:
    with TestClient(create_daemon_app()):
        raise AssertionError('daemon started without Alembic assets')
except RuntimeError as exc:
    assert 'migration assets are missing' in str(exc), str(exc)
"""
    run_on(db_file, "-c", startup, str(assets))
    assert not db_file.exists()


@pytest.mark.parametrize("missing_revision", [HEAD, FOUNDATION, OLD])
def test_daemon_refuses_truncated_migration_chain_before_opening_database(tmp_path, missing_revision):
    checkout = tmp_path / "truncated"
    assets = checkout / "src"
    shutil.copytree(ROOT / "src" / "timetrace", assets / "timetrace", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(ROOT / "alembic.ini", checkout / "alembic.ini")
    (assets / "timetrace" / "db" / "migrations" / "versions" / f"{missing_revision}.py").unlink()

    old, copied = tmp_path / "old.sqlite", tmp_path / "copied.sqlite"
    run_on(old, "-m", "alembic", "upgrade", OLD)
    with closing(sqlite3.connect(old)) as source:
        seed_old(source)
        source.commit()
        before = tuple(source.iterdump())
        with closing(sqlite3.connect(copied)) as destination:
            source.backup(destination)

    startup = """
import os
import sys

sys.path.insert(0, sys.argv[1])
os.chdir(sys.argv[2])  # Outside both source checkouts.

from fastapi.testclient import TestClient

opened_databases = []
def record_sqlite_open(event, args):
    if event == 'sqlite3.connect':
        opened_databases.append(args[0])
sys.addaudithook(record_sqlite_open)

from timetrace.main import create_daemon_app

try:
    with TestClient(create_daemon_app()) as client:
        health = client.get('/health')
        raise AssertionError(f'daemon started with truncated migrations: /health {health.status_code}')
except RuntimeError as exc:
    assert '0019_timer_focus' in str(exc), str(exc)
    assert 'complete TimeTrace' in str(exc), str(exc)
assert opened_databases == [], opened_databases
"""
    run_on(copied, "-c", startup, str(assets), str(tmp_path))
    with closing(sqlite3.connect(copied.as_uri() + "?mode=ro", uri=True)) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (OLD,)
        assert tuple(conn.iterdump()) == before


BOOT = """
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app

with TestClient(create_daemon_app()) as client:
    assert client.get('/health').json()['status'] == 'ok'
    response = client.get('/sessions')
    assert response.status_code == 200, response.text
    agenda = client.get('/agenda', params={'start': '2099-01-04T00:00:00Z', 'end': '2099-01-06T00:00:00Z'})
    assert agenda.status_code == 200, agenda.text
"""


def test_agenda_migration_fresh_chain(tmp_path):
    fresh = tmp_path / "fresh.sqlite"
    run_on(fresh, "-c", BOOT)
    with closing(sqlite3.connect(fresh)) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (HEAD,)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert conn.execute("SELECT count(*) FROM scheduled_session").fetchone() == (0,)


@pytest.mark.parametrize("old_revision", [OLD, FOUNDATION])
def test_agenda_migration_consistent_seeded_copy(tmp_path, old_revision):
    old, upgraded = [tmp_path / name / "test.sqlite" for name in ("old", "upgraded")]
    for path in (old, upgraded):
        path.parent.mkdir()
    run_on(old, "-m", "alembic", "upgrade", old_revision)
    with closing(sqlite3.connect(old)) as source:
        source.execute("PRAGMA foreign_keys=ON")
        seed_old(source)
        if old_revision == FOUNDATION:
            source.execute(
                """INSERT INTO scheduled_session
                (id, task_id, original_start, original_end, start_time, end_time, tags, notes, revision)
                VALUES ('existing-plan', ?, ?, ?, ?, ?, '#typed', 'Preserve this plan', 4)""",
                (TASK, WHEN, END, WHEN, END),
            )
            source.execute(
                """INSERT INTO session
                (id, task_id, start_time, end_time, duration_seconds, kind, provenance, scheduled_session_id, revision)
                VALUES ('existing-work', ?, ?, ?, 3600, 'recorded_work', 'manual', 'existing-plan', 2)""",
                (TASK, WHEN, END),
            )
        source.commit()
        tables = {
            name: [row[1] for row in source.execute(f"PRAGMA table_info({name})")]
            for name in (
                "session",
                "task",
                "recurrenceexception",
                "taskreview",
                "dayreview",
                "ratingdefinition",
                "ratingentry",
                "aidraftbatch",
                "aidraftitem",
                "aiaudit",
                "dashboard",
                "dashboardwidget",
            )
        }
        if old_revision == FOUNDATION:
            tables["scheduled_session"] = [row[1] for row in source.execute("PRAGMA table_info(scheduled_session)")]
        before = legacy_snapshot(source, tables)
        assert source.execute("PRAGMA foreign_key_check").fetchall() == []
        with closing(sqlite3.connect(upgraded)) as copy:
            source.backup(copy)
    run_on(upgraded, "-c", BOOT)

    with closing(sqlite3.connect(upgraded)) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (HEAD,)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert legacy_snapshot(conn, tables) == before
        assert conn.execute(
            "SELECT DISTINCT kind, provenance, scheduled_session_id, revision FROM session WHERE id != 'existing-work'"
        ).fetchall() == [("legacy_uncertain", None, None, 1)]
        assert conn.execute("SELECT scheduled_session_id FROM recurrenceexception ORDER BY id").fetchall() == [
            (None,),
            (None,),
        ]
        assert conn.execute("SELECT target_type, target_id FROM ratingentry").fetchone() == ("session", LOG)
        assert conn.execute("SELECT entity_type, entity_id FROM aiaudit").fetchone() == ("session", LOG)
        for column, table in (
            ("baseline_json", "aidraftitem"),
            ("applied_before_json", "aidraftitem"),
            ("applied_after_json", "aidraftitem"),
            ("before_json", "aiaudit"),
            ("after_json", "aiaudit"),
        ):
            for (payload,) in conn.execute(f"SELECT {column} FROM {table} WHERE {column} IS NOT NULL"):
                assert json.loads(payload)["id"] == LOG
        spec = json.loads(conn.execute("SELECT spec_json FROM dashboardwidget").fetchone()[0])
        assert spec["query"]["filters"][0]["value"] == TASK
        with pytest.raises(sqlite3.IntegrityError, match="ck_session_kind"):
            conn.execute("UPDATE session SET kind='recorded_work' WHERE id='moved'")

    code = """
import json
import sys
from datetime import UTC, datetime, timedelta
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app

client = TestClient(create_daemon_app())  # real engine; do not rerun migration in lifespan
legacy = client.get('/sessions/' + sys.argv[1]).json()
response = client.post('/scheduled-sessions', json={
    'task_id': sys.argv[2], 'start_time': '2000-01-04T14:15:00Z', 'end_time': '2000-01-04T14:45:00Z',
})
assert response.status_code == 201, response.text
plan = response.json()
assert client.get('/scheduled-sessions/' + plan['id']).json() == plan
assert len(client.get('/sessions').json()) == (4 if sys.argv[3] == '0014_agenda_foundation' else 3)
if sys.argv[3] == '0014_agenda_foundation':
    existing = client.get('/scheduled-sessions/existing-plan').json()
    assert existing['revision'] == 4 and existing['notes'] == 'Preserve this plan'
anchor = (datetime.now(UTC) + timedelta(days=1)).replace(hour=5, minute=0, second=0, microsecond=0)
series_req = client.post('/api/tasks', json={
    'title': 'Typed series', 'is_recurring': True, 'recurrence_dtstart': anchor.isoformat(),
    'recurrence_timezone': 'UTC', 'recurrence_duration_minutes': 25,
})
assert series_req.status_code in (200, 201), series_req.text
series = series_req.json()
params = {'start': anchor.isoformat(), 'end': (anchor + timedelta(hours=3)).isoformat()}
projected, = [item for item in client.get('/agenda', params=params).json()['items'] if item['task_id'] == series['id']]
write = client.put('/scheduled-sessions/' + projected['id'], json={
    'start_time': (anchor + timedelta(hours=1)).isoformat(),
    'end_time': (anchor + timedelta(hours=2)).isoformat(),
    'expected_projection_revision': projected['projection_revision'],
})
assert write.status_code == 200, write.text
typed = write.json()
assert typed['original_end'] == projected['end_time']
items = client.get('/agenda', params=params).json()['items']
assert [item for item in items if item['task_id'] == series['id']] == [typed]
print(json.dumps({'legacy': legacy, 'plan': plan, 'typed': typed, 'series_id': series['id']}))
"""
    result = json.loads(run_on(upgraded, "-c", code, LOG, TASK, old_revision))
    assert result["legacy"]["extended_properties_json"] == '{"keep": ["spaces", 2]}'
    assert result["legacy"]["notes"] == "Old note\nSecond line"
    assert result["legacy"]["id"] == LOG
    assert UUID(result["plan"]["id"]).version == 7
    assert result["plan"]["original_start"] == "2000-01-04T14:15:00Z"
    with closing(sqlite3.connect(upgraded)) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        plan_id = result["typed"]["id"]
        typed_target = conn.execute(
            "SELECT task_id, kind, session_id FROM recurrenceexception WHERE scheduled_session_id=?", (plan_id,)
        ).fetchone()
        assert typed_target == (result["series_id"], "override", None)
        for assignment in ("kind='skip'", "session_id='moved'", "scheduled_session_id=NULL"):
            with pytest.raises(sqlite3.IntegrityError, match="ck_recurrence_exception_target"):
                conn.execute(f"UPDATE recurrenceexception SET {assignment} WHERE scheduled_session_id=?", (plan_id,))
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            conn.execute(
                "UPDATE recurrenceexception SET scheduled_session_id='missing' WHERE scheduled_session_id=?", (plan_id,)
            )
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

    # A later root HTTP delete under actual SQLite FK enforcement detaches the plan and
    # history from the task, not from their own IDs or captured intervals.
    detach = """
import sys
from fastapi.testclient import TestClient
from sqlalchemy import event
from timetrace.db.session import engine
from timetrace.main import create_daemon_app

@event.listens_for(engine, 'connect')
def enforce_foreign_keys(connection, _record):
    connection.execute('PRAGMA foreign_keys=ON')

client = TestClient(create_daemon_app())
task_id, plan_id = sys.argv[1:]
path = '/scheduled-sessions/' + plan_id
before = client.get(path).json()
log = client.post('/sessions', json={
    'task_id': task_id, 'start_time': '2000-01-04T18:00:00Z', 'end_time': '2000-01-04T18:30:00Z',
}).json()
log_path = '/sessions/' + log['id']
log_before = client.get(log_path).json()
assert log_before.pop('task')['id'] == task_id
response = client.delete('/api/tasks/' + task_id)
assert response.status_code == 204, response.text
expected = dict(before, task_id=None, revision=before['revision'] + 1)
assert expected.pop('series_task_id') == task_id
assert expected.pop('occurrence_start') == before['original_start']
assert client.get(path).json() == expected
assert client.get(log_path).json() == dict(log_before, task_id=None)
"""
    run_on(upgraded, "-c", detach, result["series_id"], result["typed"]["id"])
    with closing(sqlite3.connect(upgraded)) as conn:
        assert (
            conn.execute("SELECT id FROM recurrenceexception WHERE scheduled_session_id=?", (plan_id,)).fetchone()
            is None
        )
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert conn.execute("SELECT target_type, target_id FROM ratingentry").fetchone() == ("session", LOG)


@pytest.mark.parametrize("old_revision", [None, "0015_typed_recurrence", "0016_recorded_work_index"])
def test_recorded_work_range_index_fresh_and_consistent_synthetic_copy(tmp_path, old_revision):
    source = tmp_path / "source.sqlite"
    target = tmp_path / "target.sqlite"
    before = None
    if old_revision:
        run_on(source, "-m", "alembic", "upgrade", old_revision)
        with closing(sqlite3.connect(source)) as conn:
            seed_old(conn)
            conn.commit()
            before = {
                table: conn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
                for table in (
                    "session",
                    "task",
                    "recurrenceexception",
                    "ratingentry",
                    "aiaudit",
                    "aidraftitem",
                    "dashboardwidget",
                )
            }
            with closing(sqlite3.connect(target)) as backup:
                conn.backup(backup)
    run_on(target, "-m", "alembic", "upgrade", "head")
    with closing(sqlite3.connect(target)) as conn:
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (HEAD,)
        plan = conn.execute(
            "EXPLAIN QUERY PLAN SELECT id FROM session WHERE kind='recorded_work' "
            "AND start_time>=? AND start_time<? AND end_time<=?",
            (WHEN, END, END),
        ).fetchall()
        assert "SEARCH session USING INDEX ix_session_kind_interval" in str(plan)
        if before:
            for table, rows in before.items():
                expected = [(*row, None, None, None) for row in rows] if table == "session" else rows
                assert conn.execute(f"SELECT * FROM {table} ORDER BY id").fetchall() == expected
        assert conn.execute("SELECT count(*) FROM mutation_operation").fetchone() == (0,)
