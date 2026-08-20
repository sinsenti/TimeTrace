from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlmodel import Session, SQLModel, create_engine, text

from timetrace.config import settings

settings.db_file.parent.mkdir(parents=True, exist_ok=True)

sqlite_url = f"sqlite:///{settings.db_file}"
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})


def run_migrations() -> None:
    """Executes Alembic migrations programmatically up to the latest revision."""
    project_root = Path(__file__).resolve().parents[3]
    ini_path = project_root / "alembic.ini"

    if not ini_path.exists():
        SQLModel.metadata.create_all(engine)
        return

    alembic_cfg = Config(str(ini_path))
    alembic_cfg.set_main_option("sqlalchemy.url", settings.database_url)

    with Session(engine) as session:
        tables = session.exec(text("SELECT name FROM sqlite_master WHERE type='table';")).all()
        table_names = [t[0] for t in tables]

    if table_names and "task" in table_names and "alembic_version" not in table_names:
        # Bootstrap: tables already exist (built by an older create_all fallback)
        # but were never tracked by Alembic. Nothing to migrate, just start tracking.
        command.stamp(alembic_cfg, "head")
        return

    # Let failures surface instead of silently falling back to stamp/create_all —
    # a swallowed error here previously left a database stamped at a revision it
    # never actually finished applying (see CLAUDE.md "Known issue").
    command.upgrade(alembic_cfg, "head")


def init_db() -> None:
    """Initializes and updates the database schema on daemon startup."""
    run_migrations()


def get_session():
    with Session(engine) as session:
        yield session
