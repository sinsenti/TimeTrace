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


@pytest.mark.parametrize("failure_stage", ["engine", "connection_setup"])
def test_sql_query_service_sanitizes_infrastructure_failures(sql_service, monkeypatch, failure_stage):
    from sqlalchemy import event
    from sqlalchemy.exc import OperationalError

    import timetrace.services.sql_query_service as sql_module

    sentinel = "FAKE_SQL_SETUP_13 /synthetic-private/analytics.db SELECT fake_internal_13"
    engine = readonly.get_readonly_engine()

    def fail_engine():
        raise OperationalError("SELECT fake_internal_13", {}, sqlite3.OperationalError(sentinel))

    def fail_setup(dbapi_connection, connection_record):
        raise sqlite3.OperationalError(sentinel)

    if failure_stage == "engine":
        monkeypatch.setattr(sql_module, "get_readonly_engine", fail_engine)
    else:
        event.listen(engine, "connect", fail_setup)

    try:
        with pytest.raises(ValidationError) as caught:
            sql_service.run(SqlWidgetQuery(sql="SELECT title FROM task"))
        message = str(caught.value)
        assert message and sentinel not in message
        assert "/synthetic-private" not in message
        assert "fake_internal_13" not in message
    finally:
        if failure_stage == "connection_setup":
            event.remove(engine, "connect", fail_setup)
        with sqlite3.connect(settings.db_file) as connection:
            assert connection.execute("SELECT title FROM task ORDER BY title").fetchall() == [
                ("alpha",),
                ("beta",),
                ("gamma",),
            ]


@pytest.mark.parametrize(
    "stage", ["raw_access", "watchdog_install", "watchdog_clear", "execute", "close", "syntax_and_clear"]
)
def test_sql_query_service_cleans_partial_connections_and_sanitizes_teardown(sql_service, monkeypatch, stage):
    from types import SimpleNamespace

    import timetrace.services.sql_query_service as sql_module

    engine = readonly.get_readonly_engine()
    observed = []
    sentinel = "FAKE_TEARDOWN_13 /synthetic-private/analytics.db SELECT fake_internal_13"

    class RawConnection:
        def __init__(self, raw):
            self.raw = raw

        def set_progress_handler(self, callback, interval):
            observed.append("clear" if callback is None else "install")
            if (callback is None and stage in {"watchdog_clear", "syntax_and_clear"}) or (
                callback is not None and stage == "watchdog_install"
            ):
                raise RuntimeError(sentinel)
            self.raw.set_progress_handler(callback, interval)

    class Connection:
        def __init__(self):
            self.real = engine.connect()

        @property
        def connection(self):
            if stage == "raw_access":
                raise RuntimeError(sentinel)
            return SimpleNamespace(dbapi_connection=RawConnection(self.real.connection.dbapi_connection))

        def exec_driver_sql(self, sql):
            if stage == "execute":
                raise RuntimeError(sentinel)
            return self.real.exec_driver_sql(sql)

        def close(self):
            observed.append("close")
            self.real.close()
            assert self.real.closed
            if stage == "close":
                raise RuntimeError(sentinel)

    with monkeypatch.context() as patch:
        patch.setattr(sql_module, "get_readonly_engine", lambda: SimpleNamespace(connect=Connection))
        sql = "SELECT FROM task" if stage == "syntax_and_clear" else "SELECT title FROM task"
        with pytest.raises(ValidationError) as caught:
            sql_service.run(SqlWidgetQuery(sql=sql))
        assert str(caught.value) == (
            "SQL syntax error." if stage == "syntax_and_clear" else "The query could not be executed."
        )
        assert sentinel not in str(caught.value)
        assert observed[-1] == "close"
        assert observed.count("close") == 1
        if stage != "raw_access":
            assert "clear" in observed

    # Listener/connection monkeypatches are gone; a fresh real sandbox read still works.
    assert sql_service.run(SqlWidgetQuery(sql="SELECT title FROM task ORDER BY title")).rows == [["alpha"], ["beta"]]
