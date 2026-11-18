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
HEAD = "0014_agenda_foundation"
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


BOOT = """
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app

with TestClient(create_daemon_app()) as client:
    assert client.get('/health').json()['status'] == 'ok'
    response = client.get('/sessions')
    assert response.status_code == 200, response.text
"""


def test_agenda_migration_fresh_and_consistent_seeded_copy(tmp_path):
    fresh, old, upgraded = [tmp_path / name / "test.sqlite" for name in ("fresh", "old", "upgraded")]
    for path in (fresh, old, upgraded):
        path.parent.mkdir()
    run_on(fresh, "-c", BOOT)
    with closing(sqlite3.connect(fresh)) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == (HEAD,)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        assert conn.execute("SELECT count(*) FROM scheduled_session").fetchone() == (0,)

    run_on(old, "-m", "alembic", "upgrade", OLD)
    with closing(sqlite3.connect(old)) as source:
        source.execute("PRAGMA foreign_keys=ON")
        seed_old(source)
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
            "SELECT DISTINCT kind, provenance, scheduled_session_id, revision FROM session"
        ).fetchall() == [
            ("legacy_uncertain", None, None, 1),
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
            conn.execute("UPDATE session SET kind='recorded_work' WHERE id=?", (LOG,))

    code = """
import json
import sys
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
assert len(client.get('/sessions').json()) == 3
print(json.dumps({'legacy': legacy, 'plan': plan}))
"""
    result = json.loads(run_on(upgraded, "-c", code, LOG, TASK))
    assert result["legacy"]["extended_properties_json"] == '{"keep": ["spaces", 2]}'
    assert result["legacy"]["notes"] == "Old note\nSecond line"
    assert result["legacy"]["id"] == LOG
    assert UUID(result["plan"]["id"]).version == 7
    assert result["plan"]["original_start"] == "2000-01-04T14:15:00Z"
