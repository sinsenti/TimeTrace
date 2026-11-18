from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util import CommandError
from sqlmodel import Session, create_engine, text

from timetrace.config import settings

# The models depend on this schema even if an incomplete installation reports an older head.
MINIMUM_SCHEMA_REVISION = "0015_typed_recurrence"

settings.db_file.parent.mkdir(parents=True, exist_ok=True)

sqlite_url = f"sqlite:///{settings.db_file}"
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})


def run_migrations() -> None:
    """Executes Alembic migrations programmatically up to the latest revision."""
    project_root = Path(__file__).resolve().parents[3]
    ini_path = project_root / "alembic.ini"
    migrations = Path(__file__).resolve().with_name("migrations")
    if not ini_path.is_file() or not (migrations / "env.py").is_file() or not (migrations / "versions").is_dir():
        raise RuntimeError("Alembic migration assets are missing. Use a complete TimeTrace checkout or installation.")

    alembic_cfg = Config(str(ini_path))
    alembic_cfg.set_main_option("script_location", str(migrations))
    alembic_cfg.set_main_option("sqlalchemy.url", settings.database_url)
    required_revision_error = (
        f"Cannot resolve required Alembic revision {MINIMUM_SCHEMA_REVISION}. "
        "Use a complete TimeTrace checkout or installation."
    )
    try:
        required = ScriptDirectory.from_config(alembic_cfg).get_revision(MINIMUM_SCHEMA_REVISION)
    except (CommandError, KeyError) as exc:
        raise RuntimeError(required_revision_error) from exc
    # Alembic also accepts partial identifiers; require the exact revision.
    if required is None or required.revision != MINIMUM_SCHEMA_REVISION:
        raise RuntimeError(required_revision_error)

    with engine.connect() as connection:
        objects = set(connection.scalars(text("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'")))
        versioned = "alembic_version" in objects and connection.scalar(text("SELECT version_num FROM alembic_version"))
        if objects - {"alembic_version"} and not versioned:
            raise RuntimeError(
                f"Unversioned TimeTrace database at {settings.db_file}. No migration was attempted. "
                "Keep a consistent backup and restore a known Alembic-tracked backup or request schema recovery; "
                "do not stamp this database as current."
            )

    command.upgrade(alembic_cfg, "head")


def init_db() -> None:
    """Initializes and updates the database schema on daemon startup."""
    run_migrations()


def lock_sqlite_writer(db: Session) -> None:
    # A zero-row UPDATE acquires the SQLite writer lock even in a session with prior reads.
    # Re-read ORM state after locking so guards and writes see the same committed graph.
    db.execute(text("UPDATE task SET id = id WHERE 0"))
    db.flush()
    db.expire_all()


@contextmanager
def sqlite_read_snapshot(db: Session) -> Iterator[Session]:
    """Read one SQLite snapshot without flushing or taking ownership of the caller's transaction."""
    connection = db.connection()
    # SQLAlchemy autobegin is logical: in sqlite3's legacy mode a SELECT does not
    # start a database transaction. Join an actual transaction if the caller has one.
    sqlite_connection = connection.connection.driver_connection
    owns_snapshot = not sqlite_connection.in_transaction
    if owns_snapshot:
        connection.exec_driver_sql("BEGIN")
    try:
        # A separate identity map avoids stale cached rows and preserves unflushed
        # caller changes. Already-flushed writes are visible on the same connection.
        with Session(connection, autoflush=False, join_transaction_mode="rollback_only") as reader:
            yield reader
    finally:
        if owns_snapshot and sqlite_connection.in_transaction:
            # End only the read transaction we opened, also when a read is refused.
            connection.exec_driver_sql("ROLLBACK")


def get_session():
    with Session(engine) as session:
        yield session
