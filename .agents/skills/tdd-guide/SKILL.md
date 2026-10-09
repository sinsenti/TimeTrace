---
name: tdd-guide
description: Add and run regression tests in TimeTrace's existing pytest suite. Use for behavior changes, bug reproductions, and test requests; fixtures isolate SQLite and timer state from personal data.
---

# TDD Guide (TimeTrace)

This repository already has a pytest suite, pytest dependencies, configuration in `pyproject.toml`,
and safe fixtures in `tests/conftest.py`. Do not bootstrap a second suite or add test dependencies.

## Policy

- Add a focused regression test for behavior changes unless the user explicitly asks for a manual-only change.
- Use the existing tests for service, API, core, and UI-adjacent behavior. Keep tests close to the layer that owns the behavior.
- Run focused tests during the red-green-refactor loop, then the full suite before finishing code changes.
- Browser interactions still need a manual check; there is no browser test harness. Do not add one without an explicit need.
- Use fake models/gateways for AI tests. Never make provider/network calls or use personal productivity data in tests.

## Commands

The repository-root `copy.py` shadows Python's standard-library `copy` module. Use Python safe-path mode when invoking pytest:

```bash
uv run python -P -m pytest -q
uv run python -P -m pytest -q tests/test_recurrence.py tests/test_recurrence_service.py
uv run python -P -m pytest -q tests/test_tasks_api.py tests/test_session_service.py
uv run ruff check .
```

`tests/conftest.py` sets `TIMETRACE_DB_FILE` to a temporary directory before importing TimeTrace,
then provides a fresh in-memory SQLite `db` fixture, a real-daemon `TestClient` with `get_session`
overridden, and an autouse timer reset. Do not change those safety properties.

## Where to test

| Target | Preferred test | Notes |
|---|---|---|
| `core/` pure logic | Direct function test | Avoid DB/API fixtures when not needed. |
| `services/` | Construct `Service(db)` with the `db` fixture | Assert domain behavior and domain exceptions. |
| Routers/API | Use `client` | Cover HTTP status, path/query contracts, and serialization; do not duplicate service logic tests here. |
| Browser behavior | Manual acceptance check | Exercise the affected page and inspect the browser console; no browser framework is configured. |
| Migrations | Isolated subprocess against a fresh DB and disposable existing-DB copy | Set `TIMETRACE_DB_FILE` before any TimeTrace import; never run a test migration against the personal DB. |

The DB stores naive UTC datetimes; use real datetime values and assert timezone-aware service/API boundaries deliberately. IDs are UUIDv7 strings, and session APIs also accept synthetic `virt:` recurrence IDs. Never parse IDs as numbers.

## Red-green-refactor

1. **Red:** add a test that reproduces the behavior and confirm it fails for the intended assertion.
2. **Green:** make the smallest code change that passes it.
3. **Refactor:** keep the test green, then run scoped Ruff formatting/linting and the relevant test group.
4. Before reporting completion, run the full suite and report exact pass/fail counts and any warnings.

Use `AGENTS.md` and `docs/development.md` for the current architecture, isolation recipe, and migration verification requirements.
