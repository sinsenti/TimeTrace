---
name: tdd-guide
description: How to write and run tests for TimeTrace. There is currently NO test suite — this skill bootstraps one (pytest + FastAPI TestClient + an in-memory SQLModel session that never touches ~/.timetrace/timetrace.db) and defines the red-green-refactor loop for services, routers, and core/. Use whenever asked to write a test, add coverage, reproduce a bug with a test, or practice TDD in this repo.
---

# TDD Guide (TimeTrace)

**State of the world:** this repo has no `tests/` directory, no pytest dependency, and no pytest config. Step 0 of any testing task is bootstrapping the suite. Do that once, correctly, and then never re-invent it.

**The one rule that matters here:** tests must never touch `~/.timetrace/timetrace.db` or `~/.timetrace/active_timer.json`. That file is the user's real, only, unbacked-up data. Everything below exists to guarantee that.

---

## Step 0 — Bootstrap (one time)

```bash
uv add --dev pytest pytest-asyncio
```

`httpx` (needed by `fastapi.testclient.TestClient`) is already a runtime dependency, so nothing else is required. Do **not** add `pytest-cov`, `factory-boy`, `hypothesis`, or `mutmut` up front — add them when a task actually needs them.

Then append to `pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

`uv add --dev` writes into `[dependency-groups] dev`, alongside `ruff`. The project is installed into `.venv` by hatchling with a `src/` layout, so `import timetrace` resolves without any `pythonpath` setting.

Create `tests/conftest.py` — copy [conftest.py](conftest.py) from this skill directory verbatim, or reproduce it from the fixtures section below.

Run:

```bash
uv run pytest              # whole suite
uv run pytest -q tests/test_task_service.py::test_create_task_parses_estimate
uv run ruff check .        # tests get linted too: E, F, I, UP, B, line-length 120
```

---

## The fixtures, and why each line is there

### Isolating the real database (must be first)

`timetrace.config.settings` is a module-level singleton built at import time, and `db/session.py` creates its engine at import time from it. `core/timer.py` derives `active_timer.json` from `settings.db_file.parent`. So the env var must be set **before the first `timetrace` import**, which means at the top of `conftest.py` (pytest always loads conftest before test modules):

```python
import os
import tempfile
from pathlib import Path

_TEST_HOME = Path(tempfile.mkdtemp(prefix="timetrace-tests-"))
os.environ["TIMETRACE_DB_FILE"] = str(_TEST_HOME / "test.db")
```

`Settings` uses `env_prefix="TIMETRACE_"`, so `TIMETRACE_DB_FILE` redirects both the database and the timer state file into a throwaway temp dir. Never skip this, even for a test that "only touches a service" — importing the service imports the engine.

### The session fixture

```python
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import timetrace.db.models  # noqa: F401  - registers every table on SQLModel.metadata


@pytest.fixture(name="db")
def db_fixture():
    engine = create_engine(
        "sqlite://",                                  # in-memory
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,                         # one shared connection == one shared in-memory DB
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()
```

- `sqlite://` with no path is in-memory. Without `StaticPool` every checkout gets a *fresh empty* database and nothing you insert is visible to the next query.
- The `import timetrace.db.models` is load-bearing: `create_all` only creates tables that have been imported and registered on the metadata.
- Function-scoped, so every test gets a clean schema. Don't make it session-scoped to "speed things up" — cross-test bleed is worse than the milliseconds.

### The API client fixture

```python
from fastapi.testclient import TestClient

from timetrace.db.session import get_session
from timetrace.main import create_daemon_app


@pytest.fixture(name="client")
def client_fixture(db):
    app = create_daemon_app()
    app.dependency_overrides[get_session] = lambda: db
    return TestClient(app)          # NOT `with TestClient(app)` - see below
```

- Use `create_daemon_app()` from `timetrace.main`, never the unused `FastAPI()` in `interfaces/api/main.py`. Only the daemon app registers the `EntityNotFoundError` → 404 and `TimerError`/`ValidationError` → 400 handlers, so only it produces the status codes you want to assert on.
- Return a bare `TestClient(app)`. Entering it as a context manager runs the lifespan, which calls `init_db()` → `alembic upgrade head` **against the configured DB file** and starts the 10-second `idle_checker_loop`. The `db` fixture already supplies the schema; you want neither of those in a unit test.
- Override `get_session` — the exact function object every router depends on. `lambda: db` (not a generator) is fine; FastAPI accepts a plain callable override.

### Resetting the timer singleton

`timer_manager` is a module-level `ActiveTimerState` that loads from disk on import and writes on every mutation. Any test that starts/stops a timer must reset it, or state leaks into the next test:

```python
@pytest.fixture(autouse=True)
def reset_timer():
    from timetrace.core.timer import timer_manager
    timer_manager.is_running = False
    timer_manager.task_id = None
    timer_manager.start_time = None
    timer_manager.is_frozen_idle = False
    timer_manager.pending_idle_gap = None
    yield
```

---

## What to test where

| Target | How | Example |
|---|---|---|
| `core/analytics.py`, `core/parser.py` | Call the pure function with dicts. No fixtures at all. | `calculate_tag_summaries([{...}]) == [...]` |
| `services/*.py` | Construct `TaskService(db)` directly with the `db` fixture. **This is the default choice** — it is where all the logic lives, and it's fast. | `TaskService(db).create_task(TaskCreate(title="Ship [2h]"))` |
| Routers | `client.get("/api/tasks")`. Use only to assert HTTP-level concerns: status codes, path params, query aliases, response shape. | `client.delete(f"/api/tasks/{tid}").status_code == 204` |
| Exception mapping | Through the client, since the handlers live on the app. | missing id → `404` |

Do not write a router test to cover service logic. Routers are three lines; test the service.

### Testing a service directly

```python
from timetrace.core.exceptions import EntityNotFoundError
from timetrace.interfaces.api.schemas import TaskCreate
from timetrace.services import TaskService


def test_create_task_extracts_estimate_from_title(db):
    task = TaskService(db).create_task(TaskCreate(title="Write migration [90m]"))

    assert task.title == "Write migration"
    assert task.estimated_minutes == 90


def test_update_missing_task_raises_entity_not_found(db):
    with pytest.raises(EntityNotFoundError):
        TaskService(db).update_task("does-not-exist", TaskUpdate(title="x"))
```

Assert on `EntityNotFoundError` / `TimerError` / `ValidationError` from `core/exceptions.py`, never on `HTTPException` — services don't raise those.

### Testing through the API

```python
def test_missing_task_returns_404(client):
    assert client.get("/api/tasks/01920000-0000-7000-8000-000000000000").status_code == 404


def test_create_then_list(client):
    created = client.post("/api/tasks", json={"title": "Review PR"}).json()
    assert isinstance(created["id"], str) and len(created["id"]) == 36

    titles = [t["title"] for t in client.get("/api/tasks").json()]
    assert "Review PR" in titles
```

Ids are **UUIDv7 strings**. Never `int(...)` an id in a test, never assert `id == 1`, and never hardcode a short id in a URL.

### Datetime assertions

The DB stores **naive UTC**. Services call `ensure_utc()` on the way out, so a value you read back from a service is usually tz-aware while the row in the DB is not. Assert deliberately:

```python
from datetime import UTC, datetime

assert task.created_at.tzinfo is UTC        # after a service read
assert db.get(Task, task.id).created_at.tzinfo is None   # raw row, if you re-fetch
```

If a test compares against `datetime.now(UTC)`, freeze or widen the window — don't assert exact equality.

---

## Red-green-refactor loop

1. **RED** — write the failing test first. For a bug fix, write the test that reproduces the bug and watch it fail for the *right reason* (assertion, not `ImportError`).
2. **GREEN** — the minimum change in `services/` or `core/` that makes it pass. Don't refactor yet.
3. **REFACTOR** — clean up with the test green. Then `uv run ruff check --fix .`.

Run `uv run pytest` after each step, not just at the end.

## Migrations are testable too — with one trap

**`cfg.set_main_option("sqlalchemy.url", ...)` does not work here.** `db/migrations/env.py` defines `get_url()` as `return settings.database_url` and overwrites whatever the config says. The only way to point Alembic at a different database is the `TIMETRACE_DB_FILE` env var — and because `settings` is built at import time, it must be set before `timetrace.config` is imported, which `conftest.py` already does. A test that tries to redirect via `set_main_option` will silently run against **the real database**.

So the migration test has to run out of process:

```python
import subprocess


def test_migrations_apply_to_an_empty_database(tmp_path):
    """alembic upgrade head must work from scratch. KNOWN FAILING today - see below."""
    result = subprocess.run(
        ["uv", "run", "timetrace", "db", "migrate"],
        env={**os.environ, "TIMETRACE_DB_FILE": str(tmp_path / "fresh.db")},
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
```

**This test fails right now, for a real pre-existing reason.** `0002_add_task_statuses_and_subtasks.py` seeds the default statuses with `'created_at': sa.func.now()` inside `op.bulk_insert`, and SQLAlchemy's SQLite `DateTime` binder rejects a SQL function object: `TypeError: SQLite DateTime type only accepts Python datetime and date objects`. A from-scratch `upgrade head` dies at 0002 and stamps `0001_initial_schema`. Existing databases are unaffected because they are already past that revision.

Write the test anyway — a failing test that documents a real defect is worth more than no test. Fixing it means replacing `sa.func.now()` with a literal `datetime.now(UTC)` in that migration, which is a separate change to propose, not to sneak in.

## Stop and ask when

- The expected behavior is genuinely ambiguous (e.g. what `smart_gap_filler` *should* order — the current implementation is a specification of itself, not necessarily correct).
- A test would need to mutate `~/.timetrace/` or shell out to the running daemon.
- You'd need to add a third-party test dependency to express the assertion.

## Do not

- Do not use `pytest.ini`, `tox.ini`, or `setup.cfg` — config goes in `pyproject.toml`.
- Do not `pip install` anything; this project is `uv`-managed.
- Do not mock the database. In-memory SQLite is faster than the mocks would be and actually exercises the SQL.
- Do not test `interfaces/api/main.py` or `core/inline_parser.py` — both are dead code (see CLAUDE.md).
