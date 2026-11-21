"""Deletion sees a reparent committed by an independent SQLite writer before its write lock."""

import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from timetrace.core.exceptions import ConflictError
from timetrace.db.session import get_session
from timetrace.main import create_daemon_app
from timetrace.services import TaskService


@pytest.mark.parametrize("mode", ["ordinary", "bulk", "ai_guard"])
def test_deletion_scope_includes_reparent_committed_before_writer_lock(tmp_path, mode):
    path = tmp_path / "deletion.sqlite"
    engine = create_engine(f"sqlite:///{path}")
    SQLModel.metadata.create_all(engine)

    def sessions():
        with Session(engine) as db:
            yield db

    app = create_daemon_app()
    app.dependency_overrides[get_session] = sessions
    client = TestClient(app)

    try:
        parent = client.post("/api/tasks", json={"title": "Delete target", "status": "Done"}).json()["id"]
        child = client.post("/api/tasks", json={"title": "Reparented task"}).json()["id"]
        payload = {"task_id": child, "start_time": "2000-01-04T14:00:00Z", "end_time": "2000-01-04T15:15:00Z"}
        plan = client.post(
            "/scheduled-sessions", json={**payload, "notes": "Keep original plan", "tags": "#focus"}
        ).json()
        log = client.post("/sessions", json={**payload, "notes": "Keep historical work"}).json()

        with closing(sqlite3.connect(path)) as writer, Session(engine) as deletion_db:
            writer.execute("UPDATE task SET parent_id = ? WHERE id = ?", (parent, child))
            committed = False

            def commit_competing_write(_conn, _cursor, statement, _params, _context, _executemany):
                nonlocal committed
                # External I/O boundary only. The earlier writer commits just before the
                # deleting connection's first write/lock attempt, whoever owns that statement.
                verb = statement.lstrip().split(maxsplit=1)[0].upper()
                if not committed and verb in {"BEGIN", "INSERT", "UPDATE", "DELETE"}:
                    writer.commit()
                    committed = True

            event.listen(engine, "before_cursor_execute", commit_competing_write)
            try:
                service = TaskService(deletion_db)
                if mode == "ai_guard":
                    with pytest.raises(ConflictError, match="with scheduled sessions"):
                        service.delete_task(parent, allow_plan_detachment=False)
                elif mode == "bulk":
                    assert service.delete_completed_tasks() == 1
                else:
                    service.delete_task(parent)
                assert committed
            finally:
                event.remove(engine, "before_cursor_execute", commit_competing_write)

        expected_task = child if mode == "ai_guard" else None
        expected_revision = 1 if mode == "ai_guard" else 2
        assert client.get(f"/scheduled-sessions/{plan['id']}").json() == {
            **plan,
            "task_id": expected_task,
            "revision": expected_revision,
        }
        history = client.get(f"/sessions/{log['id']}").json()
        assert (history["task_id"], history["notes"], history["duration_seconds"]) == (
            expected_task,
            "Keep historical work",
            4500,
        )
        for task in (parent, child):
            assert client.get(f"/api/tasks/{task}").status_code == (200 if mode == "ai_guard" else 404)
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as check:
            assert check.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        engine.dispose()
