"""Copy this file to tests/conftest.py.

Order matters: TIMETRACE_DB_FILE must be set before the first `timetrace` import,
because timetrace.config.settings is a module-level singleton and db/session.py
builds its engine at import time. core/timer.py derives active_timer.json from
settings.db_file.parent, so this redirects that too.
"""

import os
import tempfile
from pathlib import Path

_TEST_HOME = Path(tempfile.mkdtemp(prefix="timetrace-tests-"))
os.environ["TIMETRACE_DB_FILE"] = str(_TEST_HOME / "test.db")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

import timetrace.db.models  # noqa: E402,F401  - registers tables on SQLModel.metadata
from timetrace.core.timer import timer_manager  # noqa: E402
from timetrace.db.session import get_session  # noqa: E402
from timetrace.main import create_daemon_app  # noqa: E402


@pytest.fixture(name="db")
def db_fixture():
    """Fresh in-memory SQLite per test. StaticPool keeps every checkout on the
    same connection, otherwise each query would see an empty database."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture(name="client")
def client_fixture(db):
    """TestClient over the real daemon app (the only one with the
    EntityNotFoundError/TimerError/ValidationError handlers registered).

    Deliberately NOT a context manager: entering TestClient runs the lifespan,
    which would call init_db() -> alembic upgrade head and start the idle loop.
    """
    app = create_daemon_app()
    app.dependency_overrides[get_session] = lambda: db
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_timer():
    """timer_manager is a module-level singleton persisted to disk; without this
    a started timer leaks into every later test."""
    timer_manager.is_running = False
    timer_manager.task_id = None
    timer_manager.task_title = None
    timer_manager.start_time = None
    timer_manager.tags = ""
    timer_manager.notes = ""
    timer_manager.is_frozen_idle = False
    timer_manager.pending_idle_gap = None
    yield
