# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TimeTrace is a local-first, single-user time tracking and productivity daemon. A single FastAPI process
(`timetrace daemon`, port **8002**) is the only source of truth: it serves the JSON API, the server-rendered
Jinja2 web dashboard, and is the backend the CLI talks to over HTTP. There is no separate frontend build step —
static JS/CSS is served directly by FastAPI.

## Commands

This project uses `uv` (Python 3.14, see `pyproject.toml` / `.python-version`).

```bash
uv sync                          # install/refresh the environment (creates .venv)
uv run timetrace daemon          # start the FastAPI daemon on http://127.0.0.1:8002
uv run timetrace                 # CLI status / subcommands (talks to the running daemon over HTTP)
uv run ruff check .              # lint
uv run ruff check --fix .        # lint with autofix
uv run ruff format .             # format
uv run pytest -q                 # run the test suite
```

### Tests

`tests/` (pytest, bootstrapped 2026-08-21) covers the timer state machine, `ensure_utc`, session
creation validation, the `[15m]`-style title-estimate parser, and the documented tag fan-out contract
in `core/analytics.py`. `tests/conftest.py` redirects `TIMETRACE_DB_FILE` to a tempdir **before** the
first `timetrace` import (required, since `timetrace.config.settings` is a module-level singleton and
`db/session.py` builds its engine at import time) and uses an in-memory `StaticPool` SQLite engine, so
the suite never touches `~/.timetrace/timetrace.db`. Coverage is intentionally partial — extend it
rather than assuming it's exhaustive.

### Database migrations (Alembic)

```bash
uv run timetrace db migrate                       # apply pending migrations (also runs automatically on daemon startup)
uv run timetrace db revision -m "add foo column"   # autogenerate a new migration from model changes
```

- The SQLite DB lives at `~/.timetrace/timetrace.db` (overridable via `TIMETRACE_DB_FILE` / other `TIMETRACE_*`
  env vars, see `src/timetrace/config.py`).
- Migrations live in `src/timetrace/db/migrations/versions/`. Always add a migration when changing
  `src/timetrace/db/models.py` — `run_migrations()` (`src/timetrace/db/session.py`) runs `alembic upgrade head`
  on every daemon boot, so a model change without a migration will drift from real databases.

## Architecture

**Request flow:** CLI (`interfaces/cli/`) → HTTP → FastAPI routers (`interfaces/api/routers/`) → service layer
(`services/`) → SQLModel models (`db/models.py`) → SQLite. The web dashboard (`interfaces/api/routers/web.py`)
renders Jinja2 templates that call the same JSON API client-side via `static/js/api_client.js`.

- **`main.py`** builds the actual daemon app (`create_daemon_app`) served by `timetrace daemon` — registers
  exception handlers, CORS, the idle-detection background loop, and mounts `web_router` + `api_router`.
  `interfaces/api/main.py` is a second, unused `FastAPI()` instance (no lifespan/exception handlers) — don't
  confuse the two; `main.py` at the package root is the one that's actually run.
- **Routers** (`interfaces/api/routers/*.py`) are thin: they take a `db: Session = Depends(get_session)` and
  immediately delegate to a `*Service(db)`. Keep business logic out of routers.
- **Services** (`services/*.py`) hold all business logic and DB queries, one class per domain
  (`TaskService`, `SessionService`, `TimerService`, `RevisionService`, `RatingService`, `HabitService`,
  `AnalyticsService`), each constructed as `Service(db)`. Export new services from `services/__init__.py`.
- **`core/`** holds logic with no FastAPI/DB dependency:
  - `timer.py` — `timer_manager`, a module-level `ActiveTimerState` singleton persisted to
    `~/.timetrace/active_timer.json`. The *running* timer is file-state, not a DB row; a `Session` DB row is
    only created when the timer is stopped/split (see `TimerService`).
  - `idle_detector.py` + the `idle_checker_loop` in `main.py` — polls OS idle time every 10s and freezes the
    active timer retroactively at the moment idleness began (`timer_manager.freeze_for_idle`), producing a
    "pending idle gap" the user resolves via `/idle/resolve` (discard / log as break / claim work / re-tag).
  - `parser.py` / `inline_parser.py` — the Markdown import/export engine (YAML-frontmatter daily logs).
  - `analytics.py` — pure aggregation functions consumed by `AnalyticsService`.
- **Errors:** domain code raises `EntityNotFoundError` / `TimerError` / `ValidationError`
  (`core/exceptions.py`); these are mapped to HTTP 404/400 by handlers registered in `main.py`. Raise these
  instead of `HTTPException` from within services.
- **Datetimes:** the DB stores naive UTC datetimes; always convert at the boundary with
  `ensure_utc()` (`interfaces/api/utils.py`) when reading a value that will be compared against
  `datetime.now(UTC)` or serialized back out.
- **Tasks** are self-referential (`parent_id` → subtasks) with cascade-delete, and separately have a
  `status: str` free field plus an optional `status_id` FK to `TaskStatus` (a user-configurable, ordered status
  list with colors) — the two are kept loosely in sync, don't assume they always match.
- **Frontend:** no bundler/framework — plain JS files under `interfaces/api/static/js/`, one file per feature
  area (`kanban.js`, `calendar.js`, `habits.js`, `timer_control.js`, `vim_engine.js`, etc.), all going through
  the shared `api_client.js`. Templates under `interfaces/api/templates/` are server-rendered Jinja2 with a
  `components/` subfolder for modals/partials.

## Conventions

- `ruff` is configured with `select = ["E", "F", "I", "UP", "B"]`, `line-length = 120`, target `py314`. Run
  `ruff check --fix` before considering Python changes done.
- `fastapi.Depends`/`Query`/`Path`/`Header` and `typer.Option`/`Argument` are declared immutable-call-safe for
  bugbear (`B008`) — the existing pattern of using them directly as default arguments is intentional, not a bug.
- No emoji in UI copy or code unless it's matching an existing convention already present in that file.

## Resolved: migration history / UUIDv7 migration (2026-08-20)

The live DB's `alembic_version` used to be stamped at a `0003_uuid7_and_sync_fields` revision that
had no matching file in `src/timetrace/db/migrations/versions/` (schema had been hand-modified
outside Alembic at some point). This has been fixed:

- `0003_uuid7_and_sync_fields.py` now exists and reconstructs the sync columns/table
  (`session.timezone`/`external_sync_id`/`external_provider`/`extended_properties_json`,
  `externalsyncstate`) that were already live, so `alembic upgrade head` is reproducible from a fresh
  database again.
- `0004_uuid7_primary_keys.py` migrated every table's integer PK (and every FK referencing one) to
  UUIDv7 strings, rebuilding each table and remapping ids — including `RatingEntry.target_id`, a
  polymorphic string reference (`target_type` = `"task"`/`"session"`/`"day"`) that isn't a real FK and
  needed its own per-row translation. `db/models.py`, `schemas.py`, every router path param, the
  service layer, the CLI (`interfaces/cli/commands.py`), and the frontend JS (several files had
  unquoted ids in inline `onclick`/`onchange` handlers, plus several `parseInt(taskId)` calls that
  would have silently corrupted UUIDs to `NaN`) were all updated to match. Applied to the live
  database on 2026-08-20; a pre-migration backup is kept at `~/.timetrace/backups/`.
- `run_migrations()` (`db/session.py`) no longer silently swallows `command.upgrade()` failures and
  falls back to stamping/`create_all` — that fallback is exactly what produced the ghost `0003` stamp
  in the first place. A future migration failure will now raise instead of hiding.

Two further migration bugs were found and fixed on 2026-08-21, both invisible until someone tried a
**fresh** database (every existing DB was already past the broken revision):

- `0002` seeded `taskstatus` with `sa.func.now()` inside `op.bulk_insert`. SQLAlchemy's SQLite
  `DateTime` binder only accepts real `datetime` objects, so `alembic upgrade head` raised
  `TypeError` and left a fresh database stamped at `0001` with no `taskstatus` table — i.e. a fresh
  clone could not build a working schema at all. Now a literal naive-UTC datetime.
- `db/migrations/env.py`'s `get_url()` returned `settings.database_url` unconditionally, overwriting
  the URL in both offline and online mode. That made `alembic.ini`, `-x`, and
  `config.set_main_option()` inert — including the call inside `run_migrations()` — so **only**
  `TIMETRACE_DB_FILE` could redirect Alembic, and code that believed it was migrating a scratch copy
  would have migrated the real database. An explicit URL now wins, with settings as the fallback.

When testing migrations, verify against **both** a copy of the real database and a genuinely fresh
one. The first catches data-shape problems; only the second catches a broken migration chain.

**Resolved (2026-08-21):** CLI output and the Markdown agenda/dossier exports now show
`short_id()` (`core/ids.py`) — a **suffix**, not a prefix, of the UUID. A prefix looked natural
(UUIDv7's leading bits are a timestamp) but is actively wrong: any rows minted close together in time
share an identical leading prefix regardless of length, which is exactly this project's own real data
(every row was created in one fast migration run). The CLI's `task-tree`/`task-delete`/`--task`/
`--parent` accept a full id or a unique short suffix, matching what's displayed; an ambiguous suffix
lists candidates by title instead of guessing.

**Still open:** `core/inline_parser.py`'s Neovim/TUI quick-syntax grammar for **timer/session**
commands (`@task_id`, `@123` in `parse_inline_timer`/`parse_inline_session_edit`/`parse_inline_retro`)
still assumes a short numeric task reference via `int(...)`. These three functions have no call sites
anywhere in the codebase (dead code), so nothing is broken, but reviving them will need a different
task-reference scheme now that ids are UUIDs (e.g. fuzzy title match, or the same short-suffix
resolution the CLI now uses). Note this is separate from `parse_inline_task` (task **creation**
quick-add: `#tag`, `!priority`, `due:Nd`/`target:Nd`, `(description)`), which was revived and wired
into `TaskService.create_task`/`update_task` on 2026-08-21 and never touched a task id at all.

## Current focus: statistics & custom dashboards

This is the active feature. The design was settled with the project owner on 2026-08-21; these are
decisions, not suggestions. Do not silently re-open them.

**What it is.** The statistics page becomes a dashboard of configurable widgets. A widget is a
*structured query* — source, measure, group-by, filters, chart type — built through pickers, with a
read-only SQL escape hatch for anything the builder can't express.

| Decision | Choice |
| --- | --- |
| Expressiveness | Structured builder (source × measure × group-by × filters × chart) **plus** an advanced read-only SQL mode: `SELECT`-only, single statement, enforced `LIMIT`, timeout |
| Day bucketing | **Local** calendar day, by session **start time**. One session belongs to exactly one day, so counts and sums always reconcile. Week start reuses the existing `firstDayOfWeek` setting (currently client-side in `settings.js`, default Monday) — it must be passed to the API once grouping moves into SQL |
| Multi-tag attribution | Per-widget option. Default **fan-out** (full duration credited to each tag on the session — answers "time that touched #progr", and the UI must label that totals overlap). Alternative **split evenly** so pie/percentage charts reconcile |
| Comparison | **Per-widget** baseline: previous period, same period last year, or a fixed custom range. Tiles show a delta, time series overlay a ghost series |
| Existing `/stats` page | Becomes a seeded **"Overview"** dashboard — today's charts are re-expressed as real widgets and stay editable. The old hardcoded page goes away; there is no second statistics surface |

**Query vocabulary** the schema supports: sources `sessions` / `tasks` / `habit_logs` /
`day_reviews` / `rating_entries`; measures sum-duration, session count, avg session length, task
count, completion rate, avg rating, habit completion rate, estimation accuracy; dimensions
day/week/month, hour-of-day, weekday, tag, category, task, status, priority, habit, rating type.

**Ship order** (each slice usable on its own):
1. **Query engine + `POST /analytics/query` + seeded Overview.** Compile the structured query to
   real SQL. This is also where the two standing analytics defects get fixed: aggregation stops
   loading every session and task into Python (`core/analytics.py`), and the UTC-vs-local
   inconsistency (`daily_trend` buckets by UTC date, `hourly_distribution` by local) is resolved in
   favour of local.
2. Builder UI — add/edit/remove/reorder widgets, save named dashboards.
3. Read-only SQL escape hatch.
4. Per-widget comparison baselines.

Not doing yet: per-user scoping on dashboards. Ids are UUIDv7, so an owner column can be added
later without a rebuild — don't pre-build it.

## Roadmap: planned architecture direction (not yet implemented)

`chat.pdf` (an earlier design-exploration conversation) and the gap analysis derived from it lay out
where this project is headed next. None of the following exists in code yet — treat it as intent, not
current architecture, and check before assuming any of it has landed.

**Priority, set by the project owner on 2026-08-21** (highest first):
statistics/dashboards (above) → recurrence & completion policy → teams/multi-user, *if it proves
needed* (project tracking closer to Jira, scheduling closer to Morgen) → AI features →
**external integrations, explicitly deferred** (Google Calendar, Slack, Linear — not being built
now; don't start groundwork for them).

| Area | Planned direction | Current state | Priority action |
| --- | --- | --- | --- |
| Primary keys | Time-ordered **UUIDv7** strings (`uuid.uuid7()` — available natively in the stdlib `uuid` module on Python 3.14) | **Done** (2026-08-20) — see "Resolved" note above | — |
| Recurrence | Store one master RFC 5545 `RRULE` string per recurring item; project virtual session instances in-memory for whatever date range the UI viewport currently shows, plus a lightweight exceptions table for single-instance edits | Recurring tasks are bulk-pre-generated as real rows ahead of time | Replace pre-generation with an in-memory RRULE projection engine |
| Cross-platform clients | React Native/Expo for mobile, the same web UI wrapped in **Tauri v2** for desktop (~70–90MB RAM vs. ~400MB for Electron) | Server-rendered web UI (Jinja2 + vanilla JS) + Textual TUI only | Wrap the existing web UI in Tauri v2 before building a separate native client |
| External calendar sync | PostgreSQL backend + **PowerSync** replicating down to local SQLite on each client; Google/Outlook sync via incremental delta tokens (`syncToken` / `$delta`) through a background job queue (SAQ/Arq + Redis); internal `task_id` stored in Google's `extendedProperties` so inbound webhooks map back to the right task | Single local SQLite file, no external sync, no job queue. The `externalsyncstate` table and `session.timezone`/`external_sync_id`/`external_provider`/`extended_properties_json` columns exist as groundwork (now modelled in `db/models.py`, created by migration `0003`) but nothing reads or writes them | **Deferred — do not start.** Explicitly lowest priority as of 2026-08-21. The groundwork columns stay unused; don't add dependencies (Redis, a job queue, Postgres) for a feature that isn't being built |
| Native OS integration | Global hotkey quick-add (e.g. `Ctrl+Shift+Space`), persistent system tray icon, OS-native notification daemon for reminders | Browser tab / CLI only | Comes after the Tauri desktop wrapper, since these all depend on a native shell process |
| AI features | Two-tiered intent extraction (fast local parser for simple date/time syntax, LLM only for multi-constraint scheduling requests); render AI scheduling suggestions as non-destructive draft layers the user must accept/reject, never silent mutations; keep an audit log so a whole week of AI-rescheduled tasks can be undone in one action; sanitize titles/attendees before any third-party call | None implemented | Deliberately postponed, but ranked **above** external integrations. Not started. When it starts: settle the UX controls (draft layers + one-tap rollback log) before wiring up a single model call |
| Calendar grid rendering | Interval-graph overlap clustering for overlapping sessions (group contiguous overlaps, compute max concurrent columns, assign fractional widths e.g. `33.3%`); decouple drag-to-reschedule from state writes — render a lightweight preview at 60fps while dragging, only commit to DB on `drag_end` | Existing FullCalendar-based grid in `static/js/calendar.js` | Worth revisiting if overlap rendering or drag performance becomes a problem |
| Timezones | Distinguish fixed events (absolute UTC, e.g. a Zoom call) from floating events (local wall-clock time that should follow the user when travelling, e.g. a recurring morning task) by storing an explicit IANA timezone identifier (e.g. `America/New_York`), not just a UTC instant | `session.timezone` column already exists in the live DB (see Known Issue) but isn't in `db/models.py` or used anywhere yet | Formalize once the model/migration reconciliation above happens |
| Session/task completion policy | When a parent task is marked done, evaluate its still-scheduled future sessions and prompt to keep or clear them; compute "remaining unscheduled balance" as `estimated_duration - sum(logged_session_durations)` dynamically rather than storing a counter | Not implemented | Natural fit for `TaskService`/`SessionService` once the model work above is in |
