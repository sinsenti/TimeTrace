"""SQL setup-error regressions on a private file shared by ORM and the real sandbox."""

import sqlite3
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from timetrace.config import settings
from timetrace.db import readonly
from timetrace.db.models import Task
from timetrace.db.session import get_session
from timetrace.main import create_daemon_app

FAKE_SETUP_ERROR = "FAKE_SQL_SETUP_13 /synthetic-private/analytics.db SELECT fake_internal_13"
SQL_SPEC = {
    "mode": "sql",
    "sql": {"sql": "SELECT title FROM task ORDER BY title", "chart": "table", "limit": 20},
}


@pytest.fixture
def sql_api(tmp_path, monkeypatch):
    assert settings.sql_widgets_enabled is False, "imports must see SQL disabled"
    db_path = tmp_path / "sql-api.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)  # Unit fixture only, not startup/migration evidence.
    with Session(engine) as db:
        db.add(Task(title="Synthetic SQL task"))
        db.commit()

    monkeypatch.setattr(settings, "db_file", db_path)
    monkeypatch.setattr(settings, "sql_widgets_enabled", True)
    monkeypatch.setattr(readonly, "_readonly_engine", None)
    sandbox = readonly.get_readonly_engine()
    app = create_daemon_app()

    def request_session():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_session] = request_session
    # Never enter TestClient: no lifespan, migrations, idle loop or providers.
    client = TestClient(app, raise_server_exceptions=False)
    print(f"private_shared_sql_file={db_path}; ORM={engine.url}; sandbox={sandbox.url}")
    try:
        yield client, db_path, sandbox
    finally:
        client.close()
        app.dependency_overrides.clear()
        sandbox.dispose()
        engine.dispose()


def file_snapshot(db_path):
    with sqlite3.connect(db_path) as connection:
        return tuple(connection.iterdump())


@contextmanager
def failed_connection_setup(sandbox):
    def fail_setup(dbapi_connection, connection_record):
        raise sqlite3.OperationalError(FAKE_SETUP_ERROR)

    event.listen(sandbox, "connect", fail_setup)
    try:
        yield
    finally:
        event.remove(sandbox, "connect", fail_setup)


def create_board(client):
    response = client.post("/api/dashboards", json={"name": "Synthetic SQL regressions"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create_sql_widget(client, board_id):
    response = client.post(
        f"/api/dashboards/{board_id}/widgets",
        json={"title": "Saved SQL", "width": "half", "spec": SQL_SPEC},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.mark.parametrize("operation", ["preview", "create", "update"])
def test_sql_widgets_api_setup_failure_is_safe_useful_400_without_writes(sql_api, operation):
    client, db_path, sandbox = sql_api
    board_id = create_board(client)
    widget_id = create_sql_widget(client, board_id)
    before = file_snapshot(db_path)
    with failed_connection_setup(sandbox):
        if operation == "preview":
            response = client.post("/analytics/sql", json=SQL_SPEC["sql"])
        elif operation == "create":
            response = client.post(
                f"/api/dashboards/{board_id}/widgets", json={"title": "Rejected new SQL", "spec": SQL_SPEC}
            )
        else:
            response = client.put(
                f"/api/dashboards/{board_id}/widgets/{widget_id}",
                json={"title": "Rejected title", "width": "full", "spec": SQL_SPEC},
            )
    assert file_snapshot(db_path) == before, "failed SQL must not change stored rows or saved definition"
    print(f"operation={operation}; actual_status={response.status_code}; actual_body={response.text}")
    assert FAKE_SETUP_ERROR not in response.text
    assert response.status_code == 400, response.text
    assert response.json()["detail"], "useful local domain error, not generic server failure"
    assert "/synthetic-private" not in response.text
    assert "fake_internal_13" not in response.text


def test_sql_widgets_api_aggregate_setup_error_is_local_and_non_secret(sql_api):
    client, db_path, sandbox = sql_api
    board_id = create_board(client)
    sql_id = create_sql_widget(client, board_id)
    sibling = client.post(
        f"/api/dashboards/{board_id}/widgets",
        json={
            "title": "Healthy tasks",
            "spec": {"mode": "structured", "query": {"source": "tasks", "measure": "task_count", "chart": "tile"}},
        },
    )
    assert sibling.status_code == 201, sibling.text
    before = file_snapshot(db_path)
    with failed_connection_setup(sandbox):
        response = client.post(f"/api/dashboards/{board_id}/data", json={"timezone": "UTC", "first_day_of_week": 1})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["results"][sibling.json()["id"]]["total"] == 1
    assert set(payload["errors"]) == {sql_id}
    assert file_snapshot(db_path) == before
    error = payload["errors"][sql_id]
    print(f"aggregate_actual_local_error={error}")
    assert error
    assert "FAKE_SQL_SETUP_13" not in error
    assert "/synthetic-private" not in error
    assert "fake_internal_13" not in error


def test_sql_widgets_api_recognized_query_errors_remain_safe_and_retry_reads_real_file(sql_api):
    client, db_path, _ = sql_api
    before = file_snapshot(db_path)
    for sql, message in [
        ("SELECT FROM task", "syntax"),
        ("SELECT missing_column_13 FROM task", "Unknown column"),
        ("SELECT name FROM sqlite_master", "not allowed"),
    ]:
        response = client.post("/analytics/sql", json={"sql": sql})
        assert response.status_code == 400, response.text
        assert message in response.json()["detail"]
    response = client.post("/analytics/sql", json=SQL_SPEC["sql"])
    assert response.status_code == 200, response.text
    assert response.json()["rows"] == [["Synthetic SQL task"]]
    assert file_snapshot(db_path) == before
