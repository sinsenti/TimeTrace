# CLAUDE.md

This file records project guidance, owner decisions, and historical rationale for Claude Code and
other coding assistants. Start with [AGENTS.md](AGENTS.md) for shared working rules and
[docs/development.md](docs/development.md) for the current code map, isolated setup, and verification
runbook. Historical snapshots below explain past fixes; verify current source before reusing them.

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

`tests/` covers timer/idle state, `ensure_utc`, session creation, task HTTP basics, quick-add/title
syntax, the legacy tag fan-out contract, pure/service recurrence behavior, and dedicated AI assistant
lifecycle/privacy cases. Structured-query and provider coverage remains partial. `tests/conftest.py`
redirects `TIMETRACE_DB_FILE` to a tempdir **before** the first `timetrace` import (settings and the
DB engine are import-time singletons)
and provides an in-memory `StaticPool` SQLite engine. The API client fixture skips lifespan startup;
these tests do not exercise the Alembic chain. Coverage is partial — extend it rather than assuming
it's exhaustive. See [docs/development.md](docs/development.md#testing-and-checks).

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
- **`core/`** holds logic with no FastAPI/DB dependency (the query compiler emits SQL without executing it):
  - `timer.py` — `timer_manager`, a module-level `ActiveTimerState` singleton persisted to
    `~/.timetrace/active_timer.json`. The *running* timer is file-state, not a DB row; a `Session` DB row is
    only created when the timer is stopped/split (see `TimerService`).
  - `idle_detector.py` + the `idle_checker_loop` in `main.py` — polls OS idle time every 10s and freezes the
    active timer retroactively at the moment idleness began (`timer_manager.freeze_for_idle`), producing a
    "pending idle gap" the user resolves via `/idle/resolve` (discard / log as break / claim work / re-tag).
  - `parser.py` — Markdown import/export (YAML-frontmatter daily logs); `inline_parser.py` — quick-add syntax.
  - `query_spec.py` / `query_registry.py` / `query_compiler.py` — structured analytics vocabulary and SQL
    compilation, executed by `QueryService`. `AnalyticsService.get_summary` delegates there too;
    `analytics.py` retains legacy pure aggregation behavior and tests.
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
  scoped `ruff check --fix` before considering Python changes done; avoid reformatting unrelated files.
- `B008` is currently ignored globally. `fastapi.Depends`/`Query`/`Path`/`Header` and
  `typer.Option`/`Argument` are also listed as immutable-call-safe — their use as defaults is intentional.
- Preserve `Optional[...]` and quoted `Relationship()` annotations in `db/models.py`, plus its `UP045`/
  `UP037` exemptions. Rewriting them to `X | None` can break SQLAlchemy mapper resolution at the first
  query even when importing the module succeeds.
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

**Resolved (2026-08-24): session/task completion policy.** Marking a task Done, or moving it off a
`TaskStatus.is_scheduled_trigger` status without completing it, used to silently delete its future
calendar sessions (`discardFutureSessionsForTask` in `utils.js` — now removed). `PUT /api/tasks/{id}`
now returns an optional `completion_policy` block (reason, the affected future sessions, a subtree
count) that the frontend renders as a keep-or-clear modal
(`static/js/completion_policy.js` + `templates/components/completion_policy_modal.html`); clearing
goes through `POST /api/tasks/{id}/clear-scheduled-sessions`, which independently handles the task's
own sessions (`session_ids`, optional subset) and its subtree's (`include_subtasks`, all-or-nothing —
there's no per-child selection UI for it, so folding both into one intersected scope was an actual bug
caught in review: unchecking even one of the task's own sessions used to silently defeat the whole
subtree clear). Recurring tasks never get this prompt. Since the RRULE engine shipped, completion only resets
such a task's status; it does not regenerate rows or move the recurrence anchor. The completion-policy
feature itself required no schema change.

The same work fixed task stats conflating future-scheduled time with actually-logged time (a task
with pre-generated future sessions could read >100% progress with zero real work done):
`GET /api/tasks/{id}/stats` gained `logged_hours`/`scheduled_hours`/`remaining_hours`/
`unscheduled_hours`/`is_unbounded` (logged = `end_time` in the past; scheduled = `start_time` in the
future; a session straddling `now` counts as neither), and `progress_pct` now reads off logged time
only. In the current implementation, `is_unbounded` is true for tasks with a zero/missing estimate
and recurring tasks; the status name alone does not set it. A recurring task's estimate is per-occurrence,
not a budget for an entire series. The original bug involved ~90 pre-generated future rows; those have
since been replaced by virtual projection. Task stats aggregate real session rows, not virtual occurrences.

**Resolved (2026-08-24): subtask tag inheritance, day-review breakdown, dashboard "by task" fix,
grade coloring.** A grab-bag of smaller fixes merged alongside the stats-engine work: subtasks with
no tags of their own now inherit the parent task's tags at creation time (service-layer, so it works
from every entry point, and the subtask modal prefills the effective parent tags); the day-review tab
gained a per-day tag/task time breakdown (local-day bucketing, fan-out tag attribution) with
click-to-filter handed off to the dashboard calendar via query params; the dashboard "By Task"
sidebar widget was aggregating over the sidebar's *filtered* task list instead of the sessions
actually visible in the calendar range (and losing untasked sessions to a stray integer sentinel) —
fixed, with click-to-filter and a persistent chip; and a 5-step red-to-green grade color helper is
now wired into the day rating badge, the day-history heatmap, and custom rating sliders.

**Resolved (2026-09-05): AI assistant.** The AI feature described in the old "Roadmap" section
below is done — merged to `dev` via `feat/ai-assistant`, built against `docs/ai-assistant-spec.md`.
For current maintenance rules, privacy constraints, and required AI regression coverage, read
[`docs/ai-maintenance.md`](docs/ai-maintenance.md). The spec is a design record; consult it for
historical rationale rather than treating it as a list of missing work. Persistent AI chat
drawer (global on every page, `Ctrl+Shift+A`, a full-screen mode that splits the dashboard's real
calendar and the chat side by side), covering three capabilities: NL quick-add (a two-tiered
router — a fast local parser handles simple date/time syntax, an LLM only for multi-constraint
requests), a reschedule assistant, and whole-week auto-scheduling.

- **Non-negotiable, load-bearing everywhere in this slice:** the agent's tools can *only* insert
  a pending `aidraftitem` row — never a real `task`/`session` write. Every `propose_*` tool routes
  through `AIDraftService.add_item`; the only write path into a real row is
  `AIDraftService.accept_items`, which always delegates to `SessionService`/`TaskService` (never a
  raw column write) so `ensure_utc`, tag inheritance, the completion-policy hook, etc. all stay
  alive.
- 7 new tables (migration `0007_ai_assistant_tables`): provider config (DB-backed, `/settings/ai`,
  Fernet-encrypted keys), settings, conversations, chat messages, draft batches/items, and an append-only
  audit log. Providers now include Anthropic/OpenAI/OpenRouter/Ollama/Google/Groq/Pi; Google uses
  `langchain-google-genai`, while Groq uses the existing OpenAI-compatible client. Pi uses the
  locally installed Pi ModelRuntime and its own credentials through an isolated Node bridge;
  TimeTrace's tools and draft-only approval remain authoritative. Follow-up migration
  `0008_ai_custom_instructions` adds DB-backed custom instructions. An item can go
  `proposed → applied → undone → reapplied → undone → ...` — `undone` is deliberately not terminal.
- LangChain + LangGraph (`core/ai/agent.py`), but **not** a LangGraph checkpointer or
  `interrupt()` — the approval unit is a whole batch, not one tool call, and undo has to work days
  after the graph finished; see `core/ai/agent.py`'s own docstring for the full reasoning.
- Tool surface (`core/ai/tools.py`, `services/ai_tool_gateway.py`): read tools
  (`list_tasks`/`get_task`/`resolve_task_reference`/`list_sessions`/`find_free_slots`/
  `get_time_stats`/`search_tasks`/`find_conflicts`/`get_task_progress`/
  `get_daily_briefing`/`get_weekly_review`/`validate_schedule`) plus write tools that only ever
  create drafts (`propose_create_session`,
  `propose_update_session`, `propose_delete_session`, `propose_split_session`,
  `propose_create_task`, `propose_update_task`, `propose_delete_task`, `propose_create_subtasks`,
  `set_plan_summary`). `propose_create_task` covers recurring tasks too (`is_recurring` +
  `recurrence_rule` preset or a raw RRULE). `propose_delete_task` refuses a task with subtasks —
  a cascading subtree delete can't be captured in one undoable draft item.
- Recurring sessions are safe AI write targets (this is *why* the recurrence engine above had to
  land first — see the spec's §0). A per-occurrence AI edit goes through `SessionService` as a
  `recurrenceexception`, never a direct write; a synthetic `virt:` occurrence id gets materialized
  on write and the AI draft engine captures the real id.
- Traps worth knowing if you touch this code: `TaskService.create_task`/`update_task` always run
  the quick-add title parser (`#tag`/`!high`/`(desc)`/`due:3d`/`[15m]` syntax) — the AI draft
  engine's undo/restore path passes `parse_title_syntax=False` so restoring a snapshot never
  re-mangles a human-authored title a second time; forward writes (accept) still parse normally.
  `Task.status_id` is excluded from the AI draft snapshot comparison because `TaskService` always
  re-derives it from `status`'s name — comparing it made every task-update reapply spuriously
  conflict. The redaction regex (`core/ai/redaction.py`) carves out date-shaped substrings the
  same way it already did for UUIDs, since an ISO/dot-separated date looks exactly like a grouped
  phone number to that pattern.
- Read-only AI insights use `AIInsightsService`: deterministic overlap and schedule checks include
  recurring projections and same-turn pending drafts, weekly/daily summaries delegate to the
  structured SQL query engine, and task search uses a local SQLite FTS5 index when available.
  Scheduling preferences are persisted in `AISettings`; no embeddings/RAG or provider network is
  introduced.
- Went through this project's full merge-review gate (automated checks, an adversarial agent pass
  that found and fixed 9 real bugs on the accept/undo trust boundary, then a human review).

## Current focus: statistics & custom dashboards

This is the active feature. The design was settled with the project owner on 2026-08-21; these are
decisions, not suggestions. Do not silently re-open them. **Slices 1-4 shipped on this branch**
(after slice 1 merged to `dev` via `feat/stats-engine`); see "Ship order" for the implemented scope
and remaining follow-up work.

**What it is.** The statistics page becomes a dashboard of configurable widgets. A widget is a
*structured query* — source, measure, group-by, filters, chart type — built through pickers, with a
read-only SQL escape hatch for anything the builder can't express.

| Decision | Choice |
| --- | --- |
| Expressiveness | Structured builder (source × measure × group-by × filters × chart) **plus** an advanced read-only SQL mode: `SELECT`-only, single statement, enforced `LIMIT`, timeout |
| Day bucketing | **Local** calendar day, by session **start time**. One session belongs to exactly one day, so counts and sums always reconcile. Week start reuses `firstDayOfWeek` (client-side in `settings.js`, default Monday), already passed to the query API. SQLite bucketing follows the daemon's local zone; requests for another zone currently receive a warning and use the daemon zone |
| Multi-tag attribution | Per-widget option. Default **fan-out** (full duration credited to each tag on the session — answers "time that touched #progr", and the UI must label that totals overlap). Alternative **split evenly** so pie/percentage charts reconcile |
| Comparison | **Per-widget** baseline: previous period, same period last year, or a fixed custom range. Tiles show a delta, time series overlay a ghost series |
| Existing `/stats` page | Becomes a seeded **"Overview"** dashboard — today's charts are re-expressed as real widgets and stay editable. The old hardcoded page goes away; there is no second statistics surface |

**Query vocabulary** the schema supports: sources `sessions` / `tasks` / `habit_logs` /
`day_reviews` / `rating_entries`; measures sum-duration, session count, avg session length, task
count, completion rate, avg rating, habit completion rate, estimation accuracy; dimensions
day/week/month, hour-of-day, weekday, tag, category, task, status, priority, habit, rating type.

**Ship order** (each slice usable on its own):
1. **DONE (2026-08-24).** Query engine + `POST /analytics/query` (+ `/query/batch`) +
   `GET /analytics/capabilities` + seeded Overview. The structured query compiles to real SQL in
   `core/query_spec.py` / `core/query_compiler.py` / `services/query_service.py`. Both standing
   analytics defects are fixed as part of this: aggregation no longer loads every session/task into
   Python, and day/week bucketing is unified on **local** calendar time throughout (the old
   UTC-vs-local split between `daily_trend` and `hourly_distribution` is gone). **No schema
   change** — this slice deliberately has no DB-backed dashboard/widget table; a `Dashboard`/
   `DashboardWidget` migration was written and then reverted (`db525d5`) for exactly this reason.
2. **DONE on this branch.** `Dashboard`/`DashboardWidget` tables and migration
   `0009_dashboards_and_widgets` provide named dashboards, persisted widgets, seed/reset behavior,
   add/edit/remove/reorder, and per-widget error isolation. The `/stats` builder now uses the API;
   the one-time localStorage handoff preserves old custom widget specs.
3. **DONE on this branch (opt-in).** Read-only SQL widgets are exposed by `/analytics/sql` and the
   builder when `TIMETRACE_SQL_WIDGETS_ENABLED=true`. They use a separate SQLite `mode=ro`/
   `query_only` connection, an authorizer allowlist, query timeout, and row/length limits. Disabled
   by default.
4. **DONE on this branch.** Query comparisons support previous period, same period last year, and
   custom local-date ranges, with scalar, keyed, or positional comparison metadata and chart overlays.

Not doing yet: per-user scoping on dashboards. Ids are UUIDv7, so an owner column can be added
later without a rebuild — don't pre-build it.

## Roadmap: planned architecture direction (mixed — check each row's "Current state")

`chat.pdf` (an earlier design-exploration conversation) and the gap analysis derived from it lay out
where this project is headed next. Recurrence, completion policy, and AI features below are now
**done** (see their rows and the "Resolved" notes above) — the rest is still intent, not current
architecture; check before assuming anything else has landed.

**Priority, set by the project owner on 2026-08-21** (highest first):
statistics/dashboards (above, slice 1 done / 2-4 open) → recurrence & completion policy
(**both done** — completion policy 2026-08-24, recurrence engine 2026-09-02) → teams/multi-user,
*if it proves needed* (project tracking closer to Jira, scheduling closer to Morgen) → AI features
(**done 2026-09-05**, see "Resolved" section above) → **external integrations, explicitly deferred**
(Google Calendar, Slack, Linear — not being built now; don't start groundwork for them).

| Area | Planned direction | Current state | Priority action |
| --- | --- | --- | --- |
| Primary keys | Time-ordered **UUIDv7** strings (`uuid.uuid7()` — available natively in the stdlib `uuid` module on Python 3.14) | **Done** (2026-08-20) — see "Resolved" note above | — |
| Recurrence | Store one master RFC 5545 `RRULE` string per recurring item; project virtual session instances in-memory for whatever date range the UI viewport currently shows, plus a lightweight exceptions table for single-instance edits | **Done** (2026-09-02, `feat/recurrence-rrule` merged via `fa1dbcf`) — bulk pre-generation replaced by an in-memory RRULE projection (`core/recurrence.py`/`services/recurrence_service.py`); `recurrenceexception` handles single-instance edits; synthetic `virt:`-prefixed occurrence ids materialize into real rows on write | — |
| Cross-platform clients | React Native/Expo for mobile, the same web UI wrapped in **Tauri v2** for desktop (~70–90MB RAM vs. ~400MB for Electron) | Server-rendered web UI (Jinja2 + vanilla JS) + HTTP CLI; no Textual dependency or TUI in the current tree | Wrap the existing web UI in Tauri v2 before building a separate native client |
| External calendar sync | PostgreSQL backend + **PowerSync** replicating down to local SQLite on each client; Google/Outlook sync via incremental delta tokens (`syncToken` / `$delta`) through a background job queue (SAQ/Arq + Redis); internal `task_id` stored in Google's `extendedProperties` so inbound webhooks map back to the right task | Single local SQLite file, no external sync, no job queue. The `externalsyncstate` table and `session.timezone`/`external_sync_id`/`external_provider`/`extended_properties_json` columns exist as groundwork (now modelled in `db/models.py`, created by migration `0003`) but nothing reads or writes them | **Deferred — do not start.** Explicitly lowest priority as of 2026-08-21. The groundwork columns stay unused; don't add dependencies (Redis, a job queue, Postgres) for a feature that isn't being built |
| Native OS integration | Global hotkey quick-add (e.g. `Ctrl+Shift+Space`), persistent system tray icon, OS-native notification daemon for reminders | Browser tab / CLI only | Comes after the Tauri desktop wrapper, since these all depend on a native shell process |
| AI features | Two-tiered intent extraction (fast local parser for simple date/time syntax, LLM only for multi-constraint scheduling requests); render AI scheduling suggestions as non-destructive draft layers the user must accept/reject, never silent mutations; keep an audit log so a whole week of AI-rescheduled tasks can be undone in one action; sanitize titles/attendees before any third-party call | **Done** (2026-09-05, `feat/ai-assistant` merged) — see `docs/ai-assistant-spec.md` and the "Resolved" section above | — |
| Calendar grid rendering | Interval-graph overlap clustering for overlapping sessions (group contiguous overlaps, compute max concurrent columns, assign fractional widths e.g. `33.3%`); decouple drag-to-reschedule from state writes — render a lightweight preview at 60fps while dragging, only commit to DB on `drag_end` | Existing FullCalendar-based grid in `static/js/calendar.js` | Worth revisiting if overlap rendering or drag performance becomes a problem |
| Timezones | Distinguish fixed events (absolute UTC, e.g. a Zoom call) from floating events (local wall-clock time that should follow the user when travelling, e.g. a recurring morning task) by storing an explicit IANA timezone identifier (e.g. `America/New_York`), not just a UTC instant | `Session.timezone` is modeled (default UTC), but general fixed-versus-floating travel semantics are not implemented. Recurrence already uses `Task.recurrence_timezone` for DST-aware wall-clock expansion | Define general event travel semantics separately; do not re-add the existing columns |
| Session/task completion policy | When a parent task is marked done, evaluate its still-scheduled future sessions and prompt to keep or clear them; compute "remaining unscheduled balance" as `estimated_duration - sum(logged_session_durations)` dynamically rather than storing a counter | **Done** (2026-08-24) — see "Resolved" section above | — |
