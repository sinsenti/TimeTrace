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
  and model catalog without loading Pi coding tools or extensions. Chat and saved/inline connectivity
  probes share the DB-free `core/ai/providers.py` constructor; services retain configuration/key
  extraction, caller-specific errors, and probe caps (16 output tokens / 30 seconds, or lower).
  Migration
  `0008_ai_custom_instructions` adds DB-backed custom instructions after the seven AI tables in
  `0007_ai_assistant_tables`. See the [AI spec](ai-assistant-spec.md) for the approval/privacy
  contract; its original provider/dependency lists and proposed migration numbers are historical.
  Read-only insights include daily briefings, weekly reviews, bounded habits/ratings/reviews/timer
  reads, holistic reflection context, conflict/schedule validation, task progress, and local SQLite
  FTS task search. Day-review create/update is an approval-gated draft only. Scheduling hours,
  allowed days, breaks, daily caps, the placement window, and explicit AI data scope are stored in
  `AISettings`. AI tool calls use their own short-lived DB
  sessions because tools may run concurrently; never share a request's SQLModel session across
  parallel tool calls. `DbAIToolGateway._read_context` owns scoped read sessions; domain services
  remain independently usable by human-local insights. Scope is tool-level, not strict field-level
  isolation: task progress exposes session aggregates, while sessions-only listing/validation can
  expose linked task metadata. See [read-context maintenance notes](ai-maintenance.md#model-facing-read-context).
  JSON and SSE chat share one internal turn lifecycle in `AIChatService`;
  delivery adapters preserve live token/status events without executing the agent twice. See the
  [chat lifecycle maintenance notes](ai-maintenance.md#chat-turn-lifecycle).
  Remembered-instruction release hardening now has fake-agent coverage for
  both chat modes, server-side original-message intent gating, one-proposal uniqueness, draft-batch
  retention, failure redaction, and instruction/API lifecycle edge cases. The browser drawer
  checklist remains a manual acceptance checklist; there is intentionally no browser framework.
- **CLI:** no Textual dependency or TUI implementation exists in the current tree. The numeric
  `@task` grammars in `parse_inline_timer`, `parse_inline_session_edit`, and `parse_inline_retro`
  have no call sites. Do not confuse these with the live `parse_inline_task` creation parser.
- **Deferred:** external integrations, multi-user scoping, Tauri/mobile clients, and native tray/
  hotkey services are not implemented. Existing external-sync columns are not a sync feature.

## Task work accounting

`TaskService.get_work_accounting(task)` is the shared accounting capability for a loaded task.
Both `get_task_statistics` and `AIInsightsService.get_task_progress` consume it; the AI path does
not load the inspector's session history, reviews or ratings. AI session counts remain a separate
SQL count of all recorded rows linked to the task.

Duration totals come from `SessionService.sum_durations_for_tasks`, which captures one measurement
instant for its SQL queries: logged sessions end at/before it, and closed scheduled sessions start
after it. Open rows (including those retaining an old duration after their end was cleared) and
straddling rows contribute no time; virtual recurrence projections and running/frozen timers are excluded.
Remaining work subtracts logged seconds from the estimate; unscheduled work also subtracts scheduled seconds. Round only the final hours (two decimal places)
and progress percentage (one decimal place), preserving negative balances and progress above 100%.

Zero/missing estimates and recurring tasks have unbounded balances; a recurring estimate describes
one occurrence, not the entire series. Progress is `None`/JSON `null` for non-positive or missing
estimates in both interfaces. Negative estimates otherwise keep the inspector's legacy balances and
`is_unbounded` behavior; this does not change intentional negative balances from overspending.
The owner explicitly approved null progress for negative estimates on 2026-10-31; negative estimates
remain accepted and are not rewritten or reclassified as unbounded.

## Same-page task metadata

`static/js/task_knowledge.js` owns the page's task metadata, lookup, fallback labels and refresh
ordering. Every current page includes it after `api_client.js`, including pages with only the AI
drawer. `fetchAllTasksRegistry()` is a compatibility entry point; consumers use `taskKnowledge.get`
and `values`, not a writable global map. Metadata snapshots are read-only. Sorted/filtered sidebar
and kanban reads remain view-specific and do not replace the complete registry.

`state()` distinguishes `unloaded`, `fresh` (including a successful empty list), `stale` and `failed`
(no successful registry yet); `failed` also flags a failed refresh of last-known metadata. `loading`
tracks the current generation's request. Title-only drop/attachment fallbacks do not mark a registry
loaded or establish that an absent task was deleted. Overlapping equivalent loads share a request;
`invalidate()` advances the generation so older responses cannot replace post-mutation metadata.

After a successful same-page task write, call `await taskKnowledge.changed()`. It invalidates and
refreshes existing calendar, sidebar, kanban, attachment and inspector display paths independently.
Inspector refreshes preserve editable fields only when they have been initialized for the selected
task, including revision-task reviews and ratings. Interrupted selection initializes the new task's
fields; Save is blocked until its review/rating inputs are ready. Late statistics and rating-definition
responses cannot replace a newer selection or refresh. Timer option refresh retains a selected task
even when completion, filtering or unavailable metadata excludes it; only an explicit detach clears it.
Attachment refreshes update labels without reattaching or changing IDs, tags, notes or times.
Every successful metadata load also updates local labels, so transient recovery cannot clear a
warning while leaving old attachment text behind. Task editors fetch current task data rather
than using stale registry entries or title-only fallbacks as editable snapshots. AI accept/undo/reapply (including undo-all) use this path before
draft-card refresh. Completion-policy prompts still use the existing keep/clear UI.

Refresh failures keep last-known data and show a non-blocking **Retry refresh** notice. The retry
loads metadata/views only: it never repeats the saved write. Calendar source failures report back
to this notice because FullCalendar's `refetchEvents()` does not return a completion promise.
There is no cross-tab/CLI detection or background metadata polling.

Session editing preserves the daemon's `task_id` independently of metadata availability, including
successfully empty lists and partial fallback labels. Explicit detach or an authoritative session
row with a cleared link can remove it; a registry miss cannot. Ordinary attachment/drop fallbacks
still work offline without queuing writes. Attachment-chip titles are rendered as text. Task text in refreshed sidebar/kanban cards, suggestions,
revision chips, task-tree labels, calendar event labels and breakdowns is escaped for its HTML context.
Malformed target-date fallback labels are escaped too. Session history notes
and tags are escaped too; dynamic tag/status values use data attributes, not inline JavaScript strings.
Kanban descriptions are literal text previews, not Markdown/HTML; the unused Marked include was removed.

`taskKnowledge.recurrenceFor(taskId)` returns explicit `true`/`false`, or `null` when recurrence
remains unknown after a metadata lookup. Only an explicit boolean establishes non/recurrence;
last-known booleans remain usable, but a title or leaked preset label does not. Resize and scoped
delete decisions first obtain missing knowledge. If still unknown, resize reverts and delete
stops before confirmation, with an action-specific retry message. Retry the action to look up
metadata again; no write is queued or replayed. Moves and ordinary session saves remain available.
Known virtual/series identities retain their scope choices even without metadata, and synthetic
IDs still materialize server-side. Keyboard Delete uses the same guarded deletion path as mouse actions. A deletion request token prevents late lookups/confirmations
from replacing a newer target; canceling, closing or reopening the session editor invalidates it.
Server-side recurrence scope/history validation remains authoritative.

Verification uses Node VM caller/workflow tests in `tests/test_task_knowledge.cjs` and the existing
calendar/tag regressions. Browser checks on an isolated daemon covered dashboard create/rename,
calendar/sidebar/suggestion/chip coherence, metadata failure/retry without a repeated write,
kanban editing, unsaved inspector/revision-review fields, revision chips/selected-task displays,
transient recovery, stale-registry task editing, and real draft accept/undo/reapply with
synthetic data (no model invocation), including failed draft-card reads. Stats, habits and AI
settings includes were checked too. Drag/status-manager gestures, multi-item draft batches and
completion-policy interaction were not manually exercised in that check.

Ticket 06 additionally checked an isolated daemon on port 18016 with synthetic tasks, sessions and
service-created draft rows (no model invocation). Browser checks covered empty-metadata session
open/save, explicit detach, unsaved notes across refresh, virtual resize cancel/materialization,
unknown resize/delete blocking and retry, all-future duration without estimate changes, and
AI accept/undo/reapply metadata failure/retry with unchanged task links/notes and exactly one write
per action. All seven page templates/includes were checked. Node regressions also cover partial/
failed metadata, late delete lookup cancellation/supersession, safe fallback-title rendering,
materialized IDs, and server-rejected resizes. Physical drag gestures, series deletion/history,
completion-policy prompts and multi-item draft batches were not manually exercised in this pass;
existing Python recurrence tests cover server-side history and scope safeguards.
No typechecker is configured or installed; use Node syntax checks and the runtime regressions.

### Review-repair verification (2026-10-31)

Review repairs cover accepted-text rendering (including calendar labels and malformed target-date
badges), guarded keyboard deletion, retained unsaved timer selection, and initialized ownership of
review/rating fields. Kanban descriptions now remain literal text previews, not Markdown/HTML.
The owner approved null progress for negative estimates and later reported the app working in their
manual testing, then authorized committing the repairs. No itemized manual checklist was supplied;
that report does not establish every deferred gesture or real-DOM rating submission as tested.

Automated checks: 341 Python tests passed with 85 existing SQLite warnings; 73 Node tests passed
(25 added). All 9 changed JS files and the CJS regression file passed syntax checks. Ruff retains
18 baseline violations in three unchanged Python files; all 11 original implementation-range Python
files pass. A fresh isolated daemon passed health, ORM task-list and HTTP template/asset reads and
was stopped. Independent read-only repair review and date-badge/calendar delta reviews found no
introduced defects; reviewers did not execute tests. Browser execution, actual keyboard event dispatch
and real-DOM rating submissions were not verified by the agent. No new schema/migration is involved,
and no existing-DB migration test, personal data, provider call, push or merge is part of this repair.

## Shared appearance and Calendar shell

Ticket 01 of the approved UI redesign adopts shared navigation/appearance without replacing the
other pages' workflows. Preferences still has a working modal on every page; Settings links to the
existing `/settings/ai` page until ticket 19 supplies `/settings`. Additional task views remain later
slices. The shared stylesheet is `static/css/appearance.css`; each of the seven templates includes it.

Browser preferences stay in `timetrace_user_settings`. Existing `theme` names still select the dark
appearance and automatic task-color palette; valid old selections are adopted as dark, not replaced.
New `appearance` (`light`/`dark`) and `lightTheme` (`refined`/`stone`/`porcelain`) are independent.
A new browser uses Refined Archive/light. `calendarDensity` accepts 56/72/88 pixels per hour (default
88), independently of slot intervals; `totalsVisible` defaults false and adopts valid legacy right
sidebar choices. `taskView` adoption accepts `kanban`/`grouped`/`outline`, with Kanban fallback;
selectors/compositions belong to their subsequent tickets. Invalid/missing individual keys default
without deleting valid neighboring or unrelated settings. Explicit task/status/habit colors and
color seeds are not rewritten. There is no OS-auto appearance switch.

`setAppearancePreference()` only updates presentation and emits `timetrace:appearance`. Existing
Stats/Habit charts use that event for neutral label/grid colors, not dataset/query/config changes;
open editors and timers are not reinitialized. Calendar date/view/tag/task context is kept in its
URL and restored on Back/Forward; the filter chip remains outside collapsible Totals. Schedule
buttons open the existing task-attached session popup as an alternative to drag/drop.

Caller regressions are in `tests/test_calendar_shell.cjs` and `tests/test_calendar_shell.py`.
The four `tests/browser_{calendar_density,calendar_shell_layout,shared_appearance,chart_appearance}.js`
files are dependency-free **manual probes**, not an installed browser runner. Evaluate each async
function with an existing Playwright page and an isolated daemon base URL, after seeding a synthetic
task through the public API. Each creates/closes its own context. Never point them at personal
storage/the default daemon. Their bounded geometry/contrast samples are not accessibility certification.
The ticket receipt in `.scratch/ui-redesign/ticket-01-evidence.md` separates observed browser results,
failed probes, deferred manual coverage and pending independent review/integration gates.

### Ticket 01 review repairs

Preferences Save and color reshuffle no longer reload Revision's active editor just to update the
Session Review tab. Disabling Session Review still hides its entry and redirects an active Sessions
tab to Overview. Calendar startup reads current browser preferences after task metadata, and late
idle-toggle responses cannot restore stale density/panel choices.

The Settings link is a no-op on AI Settings. Its new cross-page departure checks initialized editor
snapshots for Preferences, Revision/day and task reviews, task details and task/session dialogs.
Canceling departure retains drafts; explicit leave does not autosave. AI Settings also guards other
page departure and browser unload. Browser Preferences, AI behavior and provider saves remain separate;
successful saves clean only their owner, failed saves remain dirty, and reverted fields are clean.
This is not a replacement router or the ticket-19 tabbed Settings implementation. Delayed session
popup initial focus now yields to immediate interaction, moved focus, closure or a newer popup;
normal create-search/edit-Notes focus remains intact. Controlled-timer caller tests and immediate
browser checks cover canceled Settings departure without masking the race with sleeps.

Habit chart registries remove disposed charts, and shared appearance updates tolerate absent/disposed
Chart.js instances. Populated AI provider names and instruction headings adopt readable light
foregrounds; the retained dark palette is not redesigned. The existing dark provider metadata/item
button contrast remains a separately documented baseline limitation, not a light-adoption regression.

Additional manual probes under `tests/` are `browser_populated_ai_appearance.js`,
`browser_revision_preferences.js`, `browser_dirty_ai_settings.js`, `browser_dirty_settings_callers.js`,
`browser_delayed_calendar_startup.js` and `browser_habit_chart_lifecycle.js`.
They use fresh browser contexts and synthetic public-API fixtures;
provider catalogs/conversational proposals and deliberate failure responses are faked explicitly.
They do not call providers, infer model output, or test real credentials. The populated probe returns
measured issues, including baseline dark samples, rather than asserting whole-dark compliance.
See the appended review-repair evidence in `.scratch/ui-redesign/ticket-01-evidence.md` for actual
execution results and remaining gates.

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
fake-agent remembered-instruction chat/API lifecycle tests. Provider-construction tests replace
LangChain adapters and Pi inference with fakes, covering routing/options, saved/inline probe caps,
key decryption, and real-agent JSON/SSE chat initialization. Fake-agent chat lifecycle tests cover
ordered tool transcripts/usage, bounded history, sanitization/instructions, empty replies, eager-batch
cleanup, retained drafts and failed instruction proposals, including failure after streamed tokens.
Draft lifecycle, gateway, and other provider coverage remains partial outside these slices. There is no browser test suite. Add coverage
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
