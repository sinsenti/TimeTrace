"""Executes read-only SQL widgets (statistics dashboards, slice 3).

Everything here runs on the dedicated read-only engine from `db/readonly.py` -- never on the
ORM `Session` handed in by the router. The `db` argument is accepted only to match this
repo's `Service(db)` construction convention and to keep the router thin; if this class ever
starts using it for a query, that is a bug.

Sandbox layering is documented in `core/sql_guard.py`. This service adds the two limits that
need a live connection: a wall-clock deadline (via a progress handler) and a hard row cap
(via an outer LIMIT the user's SQL cannot escape).
"""

import sqlite3
import time as time_module
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.exc import DatabaseError, SQLAlchemyError
from sqlmodel import Session, SQLModel

from timetrace.config import settings
from timetrace.core.exceptions import ValidationError
from timetrace.core.sql_guard import ALLOWED_TABLES, validate_sql, wrap_with_limit
from timetrace.db.readonly import get_readonly_engine
from timetrace.interfaces.api.schemas import (
    SqlQueryResponse,
    SqlSchemaColumn,
    SqlSchemaResponse,
    SqlSchemaTable,
    SqlWidgetQuery,
)

# How often (in SQLite VM instructions) the progress handler is consulted. Small enough that
# a runaway query is interrupted promptly, large enough that the callback overhead is noise.
_PROGRESS_INSTRUCTIONS = 1000


def _coerce_cell(value: Any) -> Any:
    """Make one result cell JSON-serializable without guessing at its meaning."""
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, bytes | bytearray | memoryview):
        return "<blob>"
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


class SqlQueryService:
    def __init__(self, db: Session):
        # Deliberately unused for query execution -- see the module docstring.
        self.db = db

    def run(self, spec: SqlWidgetQuery) -> SqlQueryResponse:
        if not settings.sql_widgets_enabled:
            raise ValidationError("SQL widgets are disabled. Set TIMETRACE_SQL_WIDGETS_ENABLED=true to enable them.")

        validate_sql(spec.sql, settings.sql_max_length)

        limit = max(1, min(spec.limit, settings.sql_max_rows))
        warnings: list[str] = []
        if spec.limit > settings.sql_max_rows:
            warnings.append(f"Row limit reduced to the server maximum of {settings.sql_max_rows}.")

        wrapped = wrap_with_limit(spec.sql, limit)
        started = time_module.monotonic()
        deadline = started + (settings.sql_query_timeout_ms / 1000.0)

        engine = get_readonly_engine()
        connection = engine.connect()
        raw_connection = None
        try:
            raw_connection = connection.connection.dbapi_connection

            def _watchdog() -> int:
                # Nonzero aborts the running statement with an OperationalError.
                return 1 if time_module.monotonic() > deadline else 0

            if raw_connection is not None:
                raw_connection.set_progress_handler(_watchdog, _PROGRESS_INSTRUCTIONS)

            try:
                result = connection.exec_driver_sql(wrapped)
                columns = list(result.keys())
                fetched = result.fetchmany(limit + 1)
            except (DatabaseError, SQLAlchemyError, sqlite3.Error) as exc:
                raise self._sanitize_error(exc, time_module.monotonic() > deadline) from None

            truncated = len(fetched) > limit
            if truncated:
                fetched = fetched[:limit]
                warnings.append(f"Result truncated to {limit} rows.")

            rows = [[_coerce_cell(cell) for cell in row] for row in fetched]

            return SqlQueryResponse(
                columns=columns,
                rows=rows,
                row_count=len(rows),
                truncated=truncated,
                elapsed_ms=int((time_module.monotonic() - started) * 1000),
                warnings=warnings,
            )
        finally:
            # Clear the handler before the connection goes anywhere else. NullPool means it
            # is closed rather than reused, but an expired deadline captured in a live
            # callback is exactly the kind of thing that must not outlive this call.
            if raw_connection is not None:
                try:
                    raw_connection.set_progress_handler(None, 0)
                except Exception:  # noqa: BLE001 - best effort teardown, never masks the result
                    pass
            connection.close()

    def _sanitize_error(self, exc: Exception, timed_out: bool) -> ValidationError:
        """Turn a driver error into a message safe to show a user.

        Raw SQLite/SQLAlchemy text can carry the database file path and internal statement
        text, so nothing from `exc` is echoed except a small set of recognised, harmless
        substrings.
        """
        if timed_out:
            return ValidationError(f"Query exceeded the {settings.sql_query_timeout_ms}ms time limit.")

        message = str(exc).lower()
        if "not authorized" in message or "prohibited" in message:
            return ValidationError(
                "That query is not allowed: SQL widgets may only read the analytics tables "
                "with SELECT, and may not use PRAGMA, ATTACH, or unsupported functions."
            )
        if "interrupted" in message:
            return ValidationError(f"Query exceeded the {settings.sql_query_timeout_ms}ms time limit.")
        if "readonly" in message or "attempt to write" in message:
            return ValidationError("That query is not allowed: SQL widgets are read-only.")
        if "no such table" in message:
            return ValidationError("Unknown table: SQL widgets can only read the allowlisted analytics tables.")
        if "no such function" in message:
            return ValidationError(
                "Unknown or disallowed function. SQL widgets support a fixed set of aggregate, "
                "string, date and window functions only."
            )
        if "no such column" in message:
            return ValidationError("Unknown column. Check the schema reference in the SQL editor.")
        if "syntax error" in message:
            return ValidationError("SQL syntax error.")
        return ValidationError("The query could not be executed.")

    def schema_snapshot(self) -> SqlSchemaResponse:
        """The allowlisted tables and their columns, read from `SQLModel.metadata`.

        Not from `sqlite_master`: the authorizer denies reading it (and it is not on the
        table allowlist), and the ORM metadata is the same schema by definition.
        """
        if not settings.sql_widgets_enabled:
            raise ValidationError("SQL widgets are disabled. Set TIMETRACE_SQL_WIDGETS_ENABLED=true to enable them.")
        tables = []
        for name in sorted(ALLOWED_TABLES):
            table = SQLModel.metadata.tables.get(name)
            if table is None:
                continue
            tables.append(
                SqlSchemaTable(
                    name=name,
                    columns=[SqlSchemaColumn(name=c.name, type=str(c.type)) for c in table.columns],
                )
            )
        return SqlSchemaResponse(tables=tables)
