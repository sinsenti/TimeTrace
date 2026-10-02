import sqlite3

import pytest
from sqlalchemy.exc import DatabaseError

from timetrace.config import settings
from timetrace.core.exceptions import ValidationError
from timetrace.db import readonly
from timetrace.interfaces.api.schemas import SqlWidgetQuery
from timetrace.services.sql_query_service import SqlQueryService


@pytest.fixture
def sql_service(tmp_path, monkeypatch, db):
    db_path = tmp_path / "analytics.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute("CREATE TABLE task (title TEXT NOT NULL)")
        connection.executemany("INSERT INTO task (title) VALUES (?)", [("alpha",), ("beta",), ("gamma",)])
        connection.execute("CREATE TABLE aiproviderconfig (api_key_encrypted TEXT)")
        connection.execute("INSERT INTO aiproviderconfig VALUES ('secret-value')")

    monkeypatch.setattr(readonly, "_readonly_engine", None)
    monkeypatch.setattr(settings, "db_file", db_path)
    monkeypatch.setattr(settings, "sql_widgets_enabled", True)
    monkeypatch.setattr(settings, "sql_max_rows", 2)
    engine = readonly.get_readonly_engine()
    try:
        yield SqlQueryService(db)
    finally:
        engine.dispose()


def test_sql_service_clamps_requested_limit_and_reports_truncation(sql_service):
    result = sql_service.run(SqlWidgetQuery(sql="SELECT title FROM task ORDER BY title", limit=10))

    assert result.columns == ["title"]
    assert result.rows == [["alpha"], ["beta"]]
    assert result.row_count == 2
    assert result.truncated is True
    assert any("reduced to the server maximum" in warning for warning in result.warnings)
    assert any("truncated to 2 rows" in warning for warning in result.warnings)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT api_key_encrypted FROM aiproviderconfig",
        "SELECT name FROM sqlite_master",
        "SELECT value FROM json_each('[1,2]')",
    ],
)
def test_authorizer_denies_non_allowlisted_data_sources(sql_service, sql):
    with pytest.raises(ValidationError, match="not allowed"):
        sql_service.run(SqlWidgetQuery(sql=sql))


def test_sql_service_rejects_mutations_before_execution(sql_service):
    with pytest.raises(ValidationError, match="Only read-only queries"):
        sql_service.run(SqlWidgetQuery(sql="DELETE FROM task"))


def test_readonly_engine_rejects_direct_mutation(sql_service):
    with readonly.get_readonly_engine().connect() as connection:
        with pytest.raises(DatabaseError, match="not authorized|readonly"):
            connection.exec_driver_sql("DELETE FROM task")
