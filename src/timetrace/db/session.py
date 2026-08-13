from pathlib import Path
from sqlmodel import SQLModel, create_engine, Session, text
from alembic.config import Config
from alembic import command

from timetrace.config import settings

settings.db_file.parent.mkdir(parents=True, exist_ok=True)

sqlite_url = f"sqlite:///{settings.db_file}"
engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})


def run_migrations() -> None:
    """Executes Alembic migrations programmatically up to the latest revision,
    automatically handling pre-existing SQLite databases."""
    project_root = Path(__file__).resolve().parents[3]
    ini_path = project_root / "alembic.ini"

    if ini_path.exists():
        alembic_cfg = Config(str(ini_path))
        alembic_cfg.set_main_option("sqlalchemy.url", settings.database_url)

        # Self-healing check: if DB has existing tables but no alembic_version table, stamp it
        with Session(engine) as session:
            try:
                tables = session.exec(
                    text("SELECT name FROM sqlite_master WHERE type='table';")
                ).all()
                table_names = [t[0] for t in tables]

                if "task" in table_names and "alembic_version" not in table_names:
                    command.stamp(alembic_cfg, "head")
            except Exception:
                pass

        try:
            command.upgrade(alembic_cfg, "head")
        except Exception as exc:
            print(
                f"Warning: Migration error: {exc}. Falling back to metadata creation."
            )
            SQLModel.metadata.create_all(engine)
    else:
        SQLModel.metadata.create_all(engine)


def init_db() -> None:
    """Initializes and updates the database schema on daemon startup."""
    run_migrations()


def get_session():
    with Session(engine) as session:
        yield session
