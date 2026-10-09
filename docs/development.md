# Development reference

Use [AGENTS.md](../AGENTS.md) for shared working rules and [CLAUDE.md](../CLAUDE.md) for detailed
owner decisions and historical rationale. This reference describes code inspected at `d64d877`;
recheck the affected implementation rather than treating this snapshot as a permanent guarantee.

## Isolated development

The normal user daemon listens on `127.0.0.1:8002` and stores data in
`~/.timetrace/timetrace.db`. Starting it automatically runs Alembic migrations.

For development, use a separate directory and port. Run from the repository root in a dedicated
shell; keep this environment for all commands targeting the scratch instance:

```bash
scratch_dir="$(mktemp -d -t timetrace-dev.XXXXXX)"
export TIMETRACE_DB_FILE="$scratch_dir/timetrace.db"
export TIMETRACE_HOST=127.0.0.1
export TIMETRACE_PORT=18002
export TIMETRACE_IDLE_DETECTION_ENABLED=false
printf 'Scratch directory: %s\n' "$scratch_dir"

uv sync
uv run timetrace db migrate
uv run timetrace daemon
```

Choose another unused port if 18002 is occupied. In a second shell, export the **same values**
(in particular, reuse the printed directory; do not run `mktemp` again) before running:

```bash
curl --fail "http://$TIMETRACE_HOST:$TIMETRACE_PORT/health"
uv run timetrace status
```

Check that `/health` reports the scratch DB path and port. Browser entry points are `/dashboard`,
`/tasks`, `/stats`, `/habits-view`, `/revision`, and `/settings/ai` on that scratch server. Stop it
with Ctrl+C. Keep or remove only its temporary directory when finished; do not clean up personal
TimeTrace files. A separate browser profile keeps localStorage settings/widgets isolated too.

`TIMETRACE_DB_FILE` must be set **before imports**: `config.settings`, `db.session.engine`, and
`core.timer.timer_manager` are module-level objects. `active_timer.json` and `secret.key` use the
DB's parent directory. Merely changing the DB filename within the personal data directory would
still share timer state and provider-key material.

Other supported settings are defined in `src/timetrace/config.py`, including
`TIMETRACE_IDLE_THRESHOLD_SECONDS`. CLI clients derive their server address from the same
host/port settings. Normal CLI commands use HTTP; `db` and recurrence-maintenance commands are
local maintenance exceptions. Bare `uv run timetrace` prints status, not a TUI.

For ad-hoc Python probes from the repository root, use `uv run python -P -c '...'` or
`uv run python -P -` for stdin scripts. The root `copy.py` shadows the standard-library `copy`
module without safe-path mode, causing imports such as Pydantic's `from copy import deepcopy`
to fail. Keep the scratch environment set for these probes too.

## Code map

Paths below are relative to `src/timetrace/` unless stated otherwise.

| Area | Start here | Important callers / companions |
| --- | --- | --- |
| App lifecycle, errors, idle loop | `main.py`, `config.py` | `interfaces/cli/commands.py`, `interfaces/api/routers/__init__.py` |
| Database | `db/models.py`, `db/session.py` | `db/migrations/env.py`, `db/migrations/versions/`, root `alembic.ini` |
| HTTP contracts | `interfaces/api/schemas.py`, `interfaces/api/routers/` | `interfaces/api/utils.py`, `services/__init__.py` |
| Tasks, quick-add, completion policy | `services/task_service.py`, `core/inline_parser.py` | `static/js/task_modal.js`, `subtasks.js`, `completion_policy.js` |
| Sessions and recurrence | `services/session_service.py`, `services/recurrence_service.py`, `core/recurrence.py` | `core/timezones.py`, `static/js/calendar.js`, `session_modal.js` |
| Timer and AFK resolution | `core/timer.py`, `core/idle_detector.py`, `services/timer_service.py` | `routers/timer.py`, `static/js/timer_control.js` |
| Structured statistics | `core/query_spec.py`, `core/query_registry.py`, `core/query_compiler.py`, `services/query_service.py` | `routers/analytics.py`, `static/js/dashboards.js`, `stats.js`, `settings.js` |
| Reviews, habits, ratings | `services/revision_service.py`, `habit_service.py`, `rating_service.py` | Matching routers, templates, and JS feature files |
| Markdown import/export | `core/parser.py`, `services/analytics_service.py` | CLI commands and analytics router |
| AI tools and orchestration | `core/ai/`, `services/ai_tool_gateway.py`, `ai_insights_service.py`, `ai_chat_service.py` | `routers/ai.py`, `static/js/ai_assistant.js`, `ai_quickadd.js` |
| AI approval and configuration | `services/ai_draft_service.py`, `ai_audit_service.py`, `ai_provider_service.py`, `ai_instruction_service.py` | `static/js/ai_drafts.js`, `ai_draft_overlay.js`, `ai_settings_page.js`, `ai_assistant.js` |

In the table, `static/`, `templates/`, and `routers/` shorthand is under `interfaces/api/`.
Templates include shared pieces from `templates/components/`, but there is no common base template.
The root app is the runtime entry point, not the separate unused `interfaces/api/main.py` instance.

### Current implementation versus older notes

- **Statistics:** `/stats` renders a seeded Overview plus persisted named dashboards and widgets.
  Structured widgets execute through `QueryService`; optional SQL widgets are disabled by default and
  use the isolated read-only `SqlQueryService` sandbox when enabled. Per-widget comparisons support
  previous period, same period last year, and custom ranges. `AnalyticsService.get_summary` delegates
  to `QueryService`; `core/analytics.py` retains legacy aggregation behavior/tests, not the current
  dashboard execution path. Query capabilities come from `core/query_registry.py`.
- **Local time:** `settings.js` sends timezone/week-start query context. SQLite bucketing follows
  the daemon's local timezone; `QueryService` warns and uses that zone if a requested zone differs.
  Arbitrary per-query IANA timezone bucketing is not implemented. `Session.timezone` is modeled,
  but fixed-versus-floating travel semantics are not. Recurrence already uses
  `Task.recurrence_timezone` for wall-clock expansion across DST.
- **Recurrence:** RRULE projection and exceptions shipped in migration `0006_recurrence_rrule`.
  `recurrence_rrule` is authoritative; `recurrence_rule` is a UI preset label. Bounded
  `SessionService.list_sessions` calls merge virtual occurrences by default; unbounded calls do
  not project them. Completing a recurring task resets its status, not its schedule anchor.
  The [recurrence plan](recurrence-engine-plan.md) is a design record, not a list of missing files;
  read its final settled decisions before relying on earlier scope tables.
- **AI:** draft/accept/undo/reapply, the global drawer, calendar overlays, and confirmation-gated
  conversational remembered instructions are implemented. Remembered instructions append to the
  global `AISettings.custom_instructions` field after explicit acceptance; they are not semantic
  memory or cross-conversation retrieval. Structured scheduling preferences remain authoritative.
  Providers now include Anthropic, OpenAI, OpenRouter, Ollama, Google, Groq, and Pi. Google uses
  `langchain-google-genai`; Groq uses the OpenAI-compatible client. Pi uses a small Node bridge to
  the locally installed `@earendil-works/pi-coding-agent` ModelRuntime, reusing Pi's credentials
  and model catalog without loading Pi coding tools or extensions. Migration
  `0008_ai_custom_instructions` adds DB-backed custom instructions after the seven AI tables in
  `0007_ai_assistant_tables`. See the [AI spec](ai-assistant-spec.md) for the approval/privacy
  contract; its original provider/dependency lists and proposed migration numbers are historical.
  Read-only insights include daily briefings, weekly reviews, bounded habits/ratings/reviews/timer
  reads, holistic reflection context, conflict/schedule validation, task progress, and local SQLite
  FTS task search. Day-review create/update is an approval-gated draft only. Scheduling hours,
  allowed days, breaks, daily caps, the placement window, and explicit AI data scope are stored in
  `AISettings`. AI tool calls use their own short-lived DB
  sessions because tools may run concurrently; never share a request's SQLModel session across
  parallel tool calls. Remembered-instruction release hardening now has fake-agent coverage for
  both chat modes, server-side original-message intent gating, one-proposal uniqueness, draft-batch
  retention, failure redaction, and instruction/API lifecycle edge cases. The browser drawer
  checklist remains a manual acceptance checklist; there is intentionally no browser framework.
- **CLI:** no Textual dependency or TUI implementation exists in the current tree. The numeric
  `@task` grammars in `parse_inline_timer`, `parse_inline_session_edit`, and `parse_inline_retro`
  have no call sites. Do not confuse these with the live `parse_inline_task` creation parser.
- **Deferred:** external integrations, multi-user scoping, Tauri/mobile clients, and native tray/
  hotkey services are not implemented. Existing external-sync columns are not a sync feature.

## Testing and checks

Run the full suite with `uv run python -P -m pytest -q`. The `-P` safe-path option is needed
because the repository-root `copy.py` shadows Python's standard-library `copy` module. For a
narrower loop:

```bash
uv run python -P -m pytest -q tests/test_recurrence.py tests/test_recurrence_service.py
uv run python -P -m pytest -q tests/test_tasks_api.py tests/test_session_service.py
uv run ruff check .
git diff --check
```

`tests/conftest.py` redirects the DB before imports and provides:

- `db`: fresh in-memory SQLite using `StaticPool` and `SQLModel.metadata.create_all` per test.
- `client`: the **real** daemon app with `get_session` overridden. It deliberately does not enter
  `TestClient` as a context manager, avoiding lifespan migrations and the background idle loop.
- `reset_timer`: autouse reset of the timer singleton to prevent state leaking between tests.

Coverage includes timer/idle state, UTC conversion, task title syntax, task HTTP basics, session
creation, legacy tag fan-out, substantial pure/service recurrence tests, AI privacy boundaries, and
fake-agent remembered-instruction chat/API lifecycle tests. Draft lifecycle, gateway, and provider
coverage remains partial outside this hardening slice. There is no browser test suite. Add coverage
where changing behavior; passing the existing suite does not establish those areas are correct.

**Observed baseline at this documentation check:** 192 tests passed with 85 reported SQLite
`DeprecationWarning`s. Re-run the suite after changes; warnings are not treated as failures.

The hardening smoke check migrated a fresh scratch database through `0013_ai_data_scope`
and verified `/health`, AI settings, provider CRUD, and AI status on a non-default daemon port. A
local Ollama chat attempt did not complete within 180 seconds, so interactive drawer acceptance is
still explicitly manual and no paid provider was used.

For Python edits, run scoped Ruff autofix and formatting (see `AGENTS.md`). Do not remove the
SQLModel relationship-annotation exemptions in `pyproject.toml`/`db/models.py`. For each changed
JS file, run `node --check path/to/file.js` when Node is available. Also exercise affected pages,
API calls, and shared consumers on the scratch daemon; syntax checks do not test browser behavior.
Do not use live AI providers as automated test fixtures or expose personal data in logs/reports.

## Migration verification

The source tree currently ends at `0013_ai_data_scope`; inspect revision ids and
`down_revision` links when adding a migration rather than choosing a number from an old plan.
`uv run timetrace db revision -m "description"` autogenerates a revision against the configured DB;
review the result, including data movement and SQLite table rebuilds, before applying it.

1. Use a genuinely fresh scratch DB and run `uv run timetrace db migrate` through the full chain.
2. Repeat against a disposable, consistent backup of an existing DB. Use SQLite's backup facility
   or a copy taken with the source daemon stopped; copying a live main file alone can miss WAL data.
   Never migrate the personal DB as a test or commit DB copies/key files.
3. Verify `alembic_version`, expected schema/data transformations, row counts, and
   `PRAGMA foreign_key_check`; boot the scratch daemon and exercise an ORM-backed endpoint.
4. Confirm the actual URL before each run. `run_migrations()` supplies `settings.database_url`;
   Alembic's `env.py` honors an explicitly configured `sqlalchemy.url` before its settings fallback.
   Keep migration failures visible. A successful metadata `create_all` test is **not** a migration test.

Use real Python datetime literals for bulk-insert seed data, not `sa.func.now()` (the latter broke
SQLite's DateTime binder in an earlier migration). Preserve past logged work and polymorphic id
references such as `RatingEntry.target_id` when changing identifiers or relationship structure.
