"""A second, read-only engine for SQL widgets (statistics dashboards, slice 3).

Separate from `db/session.py`'s engine on purpose. The ORM engine is read/write and pooled;
this one opens the same database file through SQLite's URI VFS with `mode=ro`, so the handle
itself cannot write, and every connection additionally gets `PRAGMA query_only = ON` plus the
default-DENY authorizer from `core/sql_guard.py`.

Two details are load-bearing and look cosmetic:

  * `&uri=true` -- without it, SQLAlchemy hands the whole `file:...?mode=ro` text to pysqlite
    as a plain filename and the connect fails (or, worse on some platforms, creates a file
    named literally that). The flag is what makes pysqlite parse it as a URI.
  * `NullPool` -- every execution gets a brand-new connection. `SqlQueryService` installs a
    per-connection progress handler holding a monotonic deadline; with a real pool, a
    connection whose deadline had already expired could be handed to the next query and abort
    it instantly. A fresh connection per query costs microseconds for a local SQLite file.

The engine is created lazily so importing this module never touches the filesystem and an
install with `sql_widgets_enabled = False` never opens a second handle at all.
"""

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.pool import NullPool

from timetrace.config import settings
from timetrace.core.sql_guard import install_authorizer

_readonly_engine: Engine | None = None


def get_readonly_engine() -> Engine:
    """Return (creating on first call) the process-wide read-only engine."""
    global _readonly_engine
    if _readonly_engine is not None:
        return _readonly_engine

    url = f"sqlite:///file:{settings.db_file}?mode=ro&uri=true"
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
    )

    @event.listens_for(engine, "connect")
    def _harden_connection(dbapi_connection, connection_record):
        # Both of these must happen BEFORE the authorizer is installed: PRAGMA and reading
        # sqlite_master are themselves denied actions, so doing either afterwards would fail.
        dbapi_connection.execute("PRAGMA query_only = ON")

        # The names of everything actually stored in this database file. The authorizer uses
        # it to tell "read of a stored table/view" (allowlist applies) from "read of a
        # query-local CTE or subquery alias" (always fine, because the rows it returns came
        # from reads that were authorized on their own). See `make_authorizer`'s docstring --
        # this is why the list is read from the file rather than parsed out of the user's SQL.
        rows = dbapi_connection.execute("SELECT name FROM sqlite_master").fetchall()
        real_object_names = frozenset(str(r[0]).lower() for r in rows if r[0]) | {
            "sqlite_master",
            "sqlite_temp_master",
            "sqlite_schema",
            "sqlite_temp_schema",
            "sqlite_sequence",
            "sqlite_stat1",
        }

        install_authorizer(dbapi_connection, real_object_names)

    _readonly_engine = engine
    return _readonly_engine
