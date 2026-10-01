---
name: code-reviewer
description: Structured code review for TimeTrace changes - Python (FastAPI/SQLModel/Alembic) and vanilla JS. Checks layering, UUID string ids, naive-UTC datetimes, migration coverage, and ruff compliance. Use when reviewing a diff, a branch before merging to dev, or a file you just finished writing.
---

# Code Reviewer (TimeTrace)

Review the diff, not the whole repo. Read the **full file** for each changed file — bugs live in how new code meets old code.

```bash
git diff                 # unstaged
git diff --cached        # staged
git diff dev...HEAD      # branch vs dev
```

Report findings as `SEVERITY  path:line — what's wrong, and the fix.` Verdicts: **BLOCK** (correctness/data loss), **CHANGES** (should fix), **NITS** (author's call).

---

## 1. Layering

- [ ] Routers stay thin: `db: DBSession = Depends(get_session)` then one call into a `*Service(db)`. Any branching, loop, or `select()` in a router is a finding.
- [ ] New service classes are exported from `services/__init__.py`.
- [ ] Anything in `core/` imports **neither FastAPI nor the DB session**. `core/` is pure logic (`analytics.py`, `parser.py`, `timer.py`, `idle_detector.py`).
- [ ] Request bodies are Pydantic models from `interfaces/api/schemas.py`, not raw `dict`.

## 2. Errors

- [ ] Services raise `EntityNotFoundError` / `TimerError` / `ValidationError` from `core/exceptions.py`. **`HTTPException` inside a service is always a finding** — the handlers registered in `main.py` do the HTTP mapping (404 / 400 / 400).
- [ ] No new `except Exception: pass`. If the exception is genuinely ignorable, say why in a comment; if it isn't, let it raise. This codebase already swallows too much (`task_service.schedule_recurrent_sessions_three_months`, `analytics.calculate_detailed_analytics`).
- [ ] `EntityNotFoundError("Task", task_id)` — entity name first, id second.

## 3. Ids are UUIDv7 strings

Recently migrated from int PKs; regressions here are silent and corrupting.

- [ ] Python: every id param, field, and dict key is `str`. No `int(task_id)`, no `id: int` in a path signature or schema.
- [ ] New models use `id: str = Field(default_factory=generate_uuid7, primary_key=True)`.
- [ ] JS: **no `parseInt(...)` on any id** — it silently produces `NaN`.
- [ ] JS: ids interpolated into inline `onclick=`/`onchange=` handlers are **quoted** (`onclick="edit('${t.id}')"`). Unquoted, a UUID becomes an invalid JS expression.
- [ ] `RatingEntry.target_id` is a polymorphic string paired with `target_type` (`"task"`/`"session"`/`"day"`) — no FK. Writes must set both.

## 4. Datetimes

- [ ] The DB stores **naive UTC**. Anything written goes in as `ensure_utc(value).replace(tzinfo=None)`; anything compared against `datetime.now(UTC)` or serialized out goes through `ensure_utc()` first (`interfaces/api/utils.py`).
- [ ] No `datetime.now()` or `datetime.utcnow()` — use `datetime.now(UTC)`.
- [ ] Date-only fields (`assigned_date`, `date_str`) are `YYYY-MM-DD` strings, not datetimes. Don't mix.
- [ ] Comparing a naive DB value to an aware one raises `TypeError` at runtime, not import time — trace the flow.

## 5. Database and migrations

- [ ] **Any change to `db/models.py` has a matching revision in `db/migrations/versions/`.** No exception. `run_migrations()` runs `alembic upgrade head` on every daemon boot, and it no longer swallows failures — a missing migration is a boot crash on the user's machine.
- [ ] `down_revision` chains onto the current head; the filename matches the `revision` string.
- [ ] Changing a column *type* or a PK on SQLite requires a table rebuild, not `ALTER` (see the `database-designer` skill).
- [ ] Deletes: does this need to null out `session.task_id` like `TaskService.delete_task` does, or does a cascade already handle it?
- [ ] No `SQLModel.metadata.create_all()` added anywhere as a shortcut.

## 6. Queries and cost

- [ ] No `select(Model)` with no `where` inside a loop.
- [ ] Aggregation over full tables (`select(Session)` then summing in Python) is the known hot spot — flag new instances. See `performance-profiler`.
- [ ] Recursive tree building (`get_task_tree`) issues one query per node; acceptable for a personal task tree, a finding for anything larger.

## 7. Frontend

- [ ] All HTTP goes through `api_client.js`, not raw `fetch`.
- [ ] New feature area = new file in `static/js/`, matching the existing one-file-per-area convention.
- [ ] User-supplied strings interpolated into `innerHTML` are escaped, or built with `textContent`.
- [ ] No new CDN dependency beyond the existing Tailwind/Chart.js/FullCalendar. No bundler, no framework, no npm.

## 8. Style

- [ ] `uv run ruff check .` is clean (`E`, `F`, `I`, `UP`, `B`, line-length 120, target py314).
- [ ] `Depends`/`Query`/`Path`/`Header` and `typer.Option`/`Argument` as default args are intentional and B008-exempt — do not flag them.
- [ ] Modern syntax: `str | None`, not `Optional[str]` (except `Optional[X]` inside SQLModel `Relationship` annotations, where it's the existing convention).
- [ ] No emoji in code or UI copy unless the file already uses them.

## Anti-patterns in the review itself

| Don't | Why |
|---|---|
| "LGTM" with no findings | Every diff has at least one assumption worth naming. |
| Only style nits | A missing migration matters more than line length. |
| Reviewing only changed lines | Read the whole file. |
| Flagging pre-existing issues as if the author introduced them | Note them separately as "pre-existing, out of scope". |
| Recommending tests as if the suite exists | It doesn't yet. Point at the `tdd-guide` skill instead. |
