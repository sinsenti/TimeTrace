---
name: focused-fix
description: Systematic repair of a whole broken TimeTrace feature across its full vertical slice - JS, template, router, service, core, model, migration. Use for "make the kanban work", "the habits page is broken", "fix idle detection" - not for a single obvious one-line bug.
---

# Focused Fix (TimeTrace)

For when an entire feature is broken, not one line. Features here are **vertical slices**: a JS file, a Jinja template, a router, a service, sometimes `core/`, sometimes a model and a migration. Fixing the JS without checking the service is how you end up fixing it twice.

## The rule

```
NO FIXES BEFORE SCOPE -> TRACE -> DIAGNOSE IS DONE
```

If you catch yourself thinking "I can see the bug, let me just fix it" — that's the signal you skipped a phase, not that you're ahead.

---

## Phase 1: SCOPE

Name the slice. For a TimeTrace feature it is almost always these files:

```
FEATURE: habits
  JS        src/timetrace/interfaces/api/static/js/habits.js
  Template  src/timetrace/interfaces/api/templates/habits.html  (+ components/)
  Web route src/timetrace/interfaces/api/routers/web.py         (which template it renders)
  API       src/timetrace/interfaces/api/routers/habits.py
  Schemas   src/timetrace/interfaces/api/schemas.py             (Habit* models)
  Service   src/timetrace/services/habit_service.py
  Core      src/timetrace/core/<...>                            (if any)
  Model     src/timetrace/db/models.py                          (Habit, HabitLog)
  CLI       src/timetrace/interfaces/cli/commands.py            (if the feature has a command)
```

Read every one of them. Don't skim.

## Phase 2: TRACE

Follow one user action all the way down and back:

**Downward** — click → which `habits.js` function → which `api.get/post/put/del` call → which path → which router function → which `HabitService` method → which `select()` → which table.

**Upward** — what else calls into this? Grep for the service class name, the route paths, and the JS function names across the whole tree. Sidebar totals, the dashboard, the CLI, and the vim engine all reach into other features' data.

Also check, because these break features while looking like code bugs:
- **Schema drift.** Does the live DB match `db/models.py`? `sqlite3 ~/.timetrace/timetrace.db ".schema habit"` vs the model. A model field with no migration means every query on that table fails.
- **Migration head.** `sqlite3 ~/.timetrace/timetrace.db "SELECT * FROM alembic_version;"` — does it match the newest file in `db/migrations/versions/`?
- **`TIMETRACE_*` env vars.** A stray `TIMETRACE_DB_FILE` means you're looking at the wrong database.
- **Timer file state.** `~/.timetrace/active_timer.json` — a stale or frozen timer explains a lot of "the UI shows nothing" reports.

Write the map down:

```
DEPENDENCY MAP
  habits.js -> api.post('/habits/{id}/log') -> habits.py:log_habit -> HabitService.log_habit -> HabitLog
  sidebar_totals.js also reads /habits            <- consumer, must keep working
  templates/components/habit_modal.html renders the form
  Model: Habit, HabitLog (cascade delete on Habit.logs)
  Migration head: 0004_uuid7_primary_keys  == newest file  OK
```

## Phase 3: DIAGNOSE

Gather evidence before proposing anything.

**Run it.** `uv run timetrace daemon`, open the page, and read *both* sides:
- Browser console + Network tab: which request, which status, what body.
- Daemon stdout: the 422 handler logs the full request body and validation errors; exception handlers log too.

**Static checks.**
```bash
uv run ruff check .
node --check src/timetrace/interfaces/api/static/js/habits.js    # if node is available
```

**The recurring bug classes in this codebase** — check each explicitly:
- [ ] `parseInt()` on a UUID id in JS (→ `NaN` → 404 or silent no-op)
- [ ] Unquoted `${id}` inside an inline `onclick=`/`onchange=` (→ SyntaxError in console)
- [ ] Naive/aware datetime comparison (→ `TypeError: can't compare offset-naive and offset-aware`)
- [ ] Missing `ensure_utc()` on a value being serialized (→ times off by the UTC offset)
- [ ] Model change with no migration (→ `no such column` on every query)
- [ ] Route ordering — a static path declared after `/{id}` (→ the literal segment parsed as an id)
- [ ] `except Exception: pass` hiding the actual error (→ the feature "does nothing" with no message)
- [ ] Status string mismatch — `"Done"` vs `"done"` vs `"completed"` vs `status_id`

**Git.** `git log --oneline -20 -- <feature paths>` and `git log --oneline -10 -- src/timetrace/db/models.py`. Recent migrations break features that weren't updated.

**Confirm root cause before adding it to the fix list.** State "X is the root cause because Y", then trace the flow backward to verify. Symptoms lie; the first plausible explanation is wrong often enough that confirming is cheaper than re-fixing.

```
DIAGNOSIS
  CRITICAL
    1. habits.js:142 — parseInt(habitId) sends NaN. Confirmed: Network shows GET /habits/NaN -> 404.
    2. habit_service.py:88 — compares log.created_at (naive) to datetime.now(UTC). Confirmed: traceback in daemon log.
  WARNING
    3. habits.py:31 — logic in the router (streak calc) that belongs in HabitService.
  PRE-EXISTING, OUT OF SCOPE
    4. habits.html has no empty state.
```

## Phase 4: FIX

Order matters — fixing the surface first hides the cause:

1. **Schema / migration** — if the DB shape is wrong, nothing above it can work
2. **Service / core** — the actual logic
3. **Router** — paths, params, status codes
4. **Schemas** — request/response shapes, once the service settles
5. **JS / template** — last

Rules:
- One issue at a time. Verify each before starting the next (reload the page, or curl the endpoint).
- Don't change files outside the slice without saying why.
- Model change → migration in the same fix, applied to a **copy** of the DB first.
- `uv run ruff check --fix .` after the Python is settled.

**Three-strike escalation:** if three fixes each create a new problem elsewhere, stop. That's an architecture signal, not a bug list. Tell the user what you found and ask whether to keep patching or restructure. Do not attempt fix #4 first.

## Phase 5: VERIFY

1. Restart the daemon cleanly — startup runs `alembic upgrade head` and will fail loudly on a bad migration.
2. `curl -s localhost:8002/health` returns ok.
3. Exercise the feature in the browser: every action in the slice, console clean.
4. Exercise the **consumers** found in Phase 2 — sidebar, dashboard, CLI. This is the step people skip.
5. `uv run ruff check .` clean.
6. If a test suite exists, run it; if not, consider whether this bug deserves being the first test (`tdd-guide`).

```
FOCUSED FIX COMPLETE: habits
  Files changed: 3
  Fixes: 2 critical, 1 warning
  Root causes: parseInt on UUID id; naive/aware datetime comparison
  Verified: page works, /health ok, sidebar totals + `timetrace habits` still correct, ruff clean
  Left alone: no empty state (pre-existing, out of scope)
```

## Rationalizations to reject

| Excuse | Reality |
|---|---|
| "It's obviously just the JS" | Half this codebase's UI bugs originate in the service or the schema. |
| "I know this codebase" | Then Phases 1-2 take four minutes. Do them. |
| "The user only asked about X" | Features here span seven files by construction. |
| "The page works now" | Did you check the sidebar, the dashboard, and the CLI? |
| "It's a small model change, migration can come later" | The daemon runs `alembic upgrade head` at boot. There is no later. |
| "Root cause is obvious" | Then confirming it costs one command. Confirm it. |
