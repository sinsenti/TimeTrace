# Development reference

Use [AGENTS.md](../AGENTS.md) for shared working rules and [CLAUDE.md](../CLAUDE.md) for detailed
owner decisions and historical rationale. The [shared delivery summary](../specs/README.md#delivery-status-and-evidence)
distinguishes accepted UI delivery, module history, latest integrated checks and remaining verification.
Earlier inspections (including `d64d877`) and dated candidate receipts below are historical snapshots;
recheck the affected implementation rather than treating them as permanent guarantees.

## Current-status precedence

All 25 UI tickets are delivered, owner-accepted and merged at `2992d96`; later comparison-identity
repairs are integrated locally at `c7b3456`. References below to pending UI tickets, closure gates,
"Approved, not Built", or missing whole-UI acceptance describe earlier checkpoints, not live blockers.
The original failures/UNKNOWN/UNRUN and deferred manual observations remain unchanged. GitHub is the
live tracker; use the [successor mapping](agents/github-migration.md), not old local frontiers.

Current entry points and implementations include:

- [Kanban, Grouped and Outline](../src/timetrace/interfaces/api/templates/tasks.html), including the
  retained inspector; Grouped/Outline no longer fall back to Kanban as unfinished slices.
- [Tabbed Settings](../src/timetrace/interfaces/api/routers/web.py) at `/settings` (Browser),
  `/settings/ai` (AI) and `/settings?category=providers`; the shared
  [navbar](../src/timetrace/interfaces/api/templates/components/navbar.html) targets `/settings`.
- [Persisted dashboards](../src/timetrace/services/dashboard_service.py), optional SQL widgets,
  [Performed time by day](../src/timetrace/core/dashboard_seeds.py) and the
  [guarded SQL Settings departure](../specs/sql-widget-settings-departure.md).
- Compact Habits, shared Timer/idle recovery, reviews/ratings, Markdown export and chat-first Assistant
  approval workflows are delivered; their older candidate sections retain bounded evidence, not open
  implementation tasks. [AI Settings ownership](ai-maintenance.md#ai-settings-editors) includes behavior
  Cancel and independent provider drafts.

Browser verification uses tracked `tests/browser_*.js` manual/native probes with an external browser
bridge and isolated synthetic daemon. There is no installed browser framework or single automatic
browser-suite command; that is not an absence of browser evidence. See
[bounded verification](https://github.com/sinsenti/TimeTrace/issues/55) for exact unproved cells.

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
`/tasks`, `/stats`, `/habits-view`, `/revision`, `/settings` (Browser), `/settings/ai` (AI), and
`/settings?category=providers` (Providers) on that scratch server. Stop it
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

### Implementation notes and historical adoption checkpoints

The [current-status precedence](#current-status-precedence) above supersedes unfinished-ticket wording
in these retained adoption notes; implementation details and original evidence limits still apply.

- **Statistics:** `/stats` renders the Widget canvas with a seeded Overview plus persisted named
  dashboards and editable/reorderable/removable widgets. `dashboards.js` loads saved dashboard detail,
  then independent `/analytics/query` or `/analytics/sql` card reads with per-card loading/error/retry
  and stale-selection protection. Structured reads execute through `QueryService`; optional SQL widgets
  remain disabled by default and use the isolated read-only `SqlQueryService` sandbox when enabled.
  The aggregate `POST /api/dashboards/{id}/data` endpoint remains available for other callers; no API
  or schema change. Legacy browser-widget handoff journals acknowledged/uncertain imports and retains
  source until safely archived; uncertain writes require explicit user reconciliation, not automatic
  replay or a transport-idempotency guarantee. Existing seed/reset rules and builder entry paths remain.
  Per-widget comparisons support previous period, same period last year, and custom ranges.
  `AnalyticsService.get_summary` delegates to `QueryService`; `core/analytics.py` retains legacy
  aggregation behavior/tests, not the current dashboard execution path. Query capabilities come from
  `core/query_registry.py`. Ticket12's reviewed structured builder is now locally integrated: full
  capability pickers, up to20 conjunctive typed filters, two dimensions/all charts, explicit
  sort/limit/fill, independent dates/baselines, inert query preview/context/warnings and faithful
  saved-query edit/reopen. Pending/concurrent drafts retain submitted-field ACK checkpoints;
  Canvas Retry refresh reads only. Two hardcoded compiler maps use the already-attributed/base
  projections for tagged-session/estimation grouping. Narrow QueryService repairs reject row-losing
  multidimensional hour/weekday fill and stably retain all weekday secondary rows. Distinct-key
  stacked charts preserve sparse source cells and separate primary/ghost stacks; duplicate
  serialized key pairs use explained separate-row bars with full labels/ordinal/exact values/
  source-row clicks, no aggregation/rekey/spec rewrite. Keyed comparisons retain raw typed SQL
  dimension identities internally, including NULL versus empty text in every dimension component.
  Matching and dropped-baseline counts use those identities, not the lossy public string keys;
  filled hour/weekday buckets use the compiler's integer identities. Public keys/labels and saved
  specs are unchanged; colliding display keys still use the separate-row renderer fallback.
  Ticket12 is bounded-completed after fresh
  integrated checks/genuine parent252-label gate/explicit five-DOC closure release; fresh closure
  DOC gate was subsequently disposed before parent activated19/earlier13–14 resource unlock; its earlier
  pending receipts remain historical. Current19 has a separate pending closure gate. See
  [bounded evidence](../.scratch/ui-redesign/ticket-12-evidence.md#local-integration-and-bounded-closure-draft-2026-11-04).
  SQL layout/sandbox adoption13 and performed-time/default-label/seed adoption14 remain later work;
  actual SQL stays disabled, browser opt-in/schema/preview checks use HTTP fakes. No API/schema change.
- **Tasks / Quick Add:** ticket04 keeps Kanban as the fresh/invalid default with a persisted view
  selector, hierarchy/search and existing task/scheduling/timer/completion entries. Valid Grouped/Outline
  preferences retain an honest Kanban fallback until tickets06/07. The task popup queues/removes children
  below the title and includes an unsubmitted child on Save. Existing APIs write parent/children
  separately: authoritative parent tags/category (including `''`) and each child acknowledgement are
  retained; partial failure locks the saved parent, including color presets, and Retry writes only
  unsaved children. Explicit partial discard explains that saved rows remain. Metadata retry reads only;
  a lost mutation response is still uncertain, not an atomic/idempotency/exactly-once guarantee.
  Separate AI Quick Add on Tasks/Calendar remains classify (no inference) → explicit Parse (read-only)
  → editable prefill → human Save; late extraction cannot replace a newer owner or concurrent edits.
  It is not the conversational Assistant approval workflow (tickets21–23). Ticket19's tabbed Settings
  is now locally integrated: `/settings` Browser, `/settings/ai` AI, `/settings?category=providers`
  Providers. Generic navbar still links `/settings/ai` until coordinated03; stopped Timer is NOT integrated.
  Caller/API/native evidence and deferred manual/contrast limits are in
  [ticket04 evidence](../.scratch/ui-redesign/ticket-04-evidence.md#local-integration-and-bounded-closure-2026-11-04).
- **Habits:** ticket10 uses Compact cards with independent local-day strips and explicit entry
  Save/Cancel; Done/Failed/Skipped choices are drafts, not cycling writes. Week/Today navigation never
  logs. Confirmed Clear erases only the selected record, distinct from numeric zero Pending; negative
  amounts visibly clamp to zero. The approved service repair derives zero Pending before comparing
  nonpositive goals on explicit writes only, without historical rewrites or new target validation.
  Definitions/metadata/goal history/charts remain; compliance is completed/all recorded logs, not dates.
  The list retains its365-day lower bound; absent dates outside conservative browser-local363 coverage
  are Unknown. Older ACK receipts are card-only, not expanded chart history. Clear locally owns initial
  Cancel focus/Tab/Enter and live enabled restoration after pending cleanup, yielding to newer owners
  without skipping ACK receipt/baseline delivery. Shared helpers/API/schema are unchanged. Clock time,
  editable notes and multiple daily entries remain deferred. See [bounded evidence and manual limits](../.scratch/ui-redesign/ticket-10-evidence.md#local-integration-and-bounded-closure-2026-11-04).
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
  checklist requires itemized reconciliation against later native approval evidence; see the
  [hardening plan's current-status note](ai-release-hardening-plan.md#current-status-and-evidence).
  There is intentionally no installed browser framework.
- **CLI:** no Textual dependency or TUI implementation exists in the current tree. The numeric
  `@task` grammars in `parse_inline_timer`, `parse_inline_session_edit`, and `parse_inline_retro`
  have no call sites. Do not confuse these with the live `parse_inline_task` creation parser.
- **Deferred:** external integrations, multi-user scoping, Tauri/mobile clients, and native tray/
  hotkey services are not implemented. Existing external-sync columns are not a sync feature.

## Task post-mortems

Dedicated task details (`/task-inspector/{id}` and `/tasks-detail/{id}`) and Revision’s Task
Inspector share `static/js/task_postmortem.js` and `components/task_postmortem.html`. Each editor
owns its task ratings, initialization, draft baselines and pending writes. Save captures review text
and all rating values before requests begin; partial failures retain acknowledged writes and newer
edits. Metadata refresh defers rating controls until the captured save settles, then reconciles
current definitions without replaying acknowledged writes. Retry refresh reads only. Discard reloads persisted review values without deleting records;
typing after that read begins is retained. Reviewing never completes a task or changes schedules.
Own-session evidence and task work accounting remain independent of review availability.

Regression coverage lives in `tests/test_task_postmortems.py`, `tests/test_task_postmortems.cjs`
and the Task cases in `tests/test_draft_ownership.cjs`. The native probe
`tests/browser_task_postmortems.js` requires an explicitly isolated synthetic daemon/browser runtime;
its presence does not establish that browser acceptance has run.

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
Folio refreshes task labels in the ledger, picker and open inspector from this same registry,
without reopening or reinitializing the selected draft.
Every successful metadata load also updates local labels, so transient recovery cannot clear a
warning while leaving old attachment text behind. Task editors fetch current task data rather
than using stale registry entries or title-only fallbacks as editable snapshots. AI accept/undo/reapply (including undo-all) use this path before
draft-card refresh. Completion-policy prompts still use the existing keep/clear UI.

Refresh failures keep last-known data and show a non-blocking **Retry refresh** notice. The retry
loads metadata/views only: it never repeats the saved write. Calendar source failures report back
to this notice because FullCalendar's `refetchEvents()` does not return a completion promise.
There is no cross-tab/CLI detection or background metadata polling.

The Calendar Session popup supports multiline Notes (ordinary Enter), Ctrl+Enter Save, Escape Cancel,
create-search/edit-Notes focus and contained keyboard navigation. Connected Cancel restores its launcher;
acknowledged clean Save focuses stable Calendar before refresh replaces event/planning-list launchers.
Per-owner pending Save blocks duplicate activation; rejected/concurrent drafts remain editable and dirty.
Acknowledged POST/materialized occurrence IDs are adopted before fallible display reads; Retry refresh
reads only, never replays the saved mutation. Shared confirmation Escape resolves cancellation, and the
global handler retains focus when an existing close callback leaves its editor open. These are UI
lifecycle safeguards, not new API/domain policy or physical-gesture/transport-idempotency guarantees.

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
IDs still materialize server-side. The Calendar's Vim `x` shortcut uses the same guarded deletion path
as mouse actions; literal `Delete` is unbound. A deletion request token prevents late lookups/confirmations
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
other pages' workflows. Old Preferences remains a working modal on other pages; locally integrated19
supplies the full-area tabbed `/settings` Browser page, retained `/settings/ai` AI entry and
`/settings?category=providers`. Generic navbar still links `/settings/ai` until coordinated03 adoption;
no link-source change is implied. Additional task views remain later slices. The shared stylesheet
is `static/css/appearance.css`; each of the seven templates includes it.

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
This historical01 guard was not a replacement router or the ticket-19 tabbed implementation; the latter
is now locally integrated separately; the draft and current bounded closure records below distinguish their gates. Delayed session popup initial focus now yields to immediate interaction, moved focus, closure or a newer popup;
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

### Ticket19 tabbed Settings — local integration, closure DRAFT

Exact reviewed625 was normally FF-integrated from clean a8e (two commits/14paths), no sourcecopy/fix.
Fresh Standards0breaches/0heuristics and Spec0 cover BOTH amendment and combined ranges; original TWO
unique Spec P1 repaired, not waived. Successful captured browser STORAGE now advances its comparison
baseline even for idle; external dirty checkpoint/hidden daemon-pending ownership remains ACK-dependent.
Only explicit Browser page editors are excluded from global modal Escape; scoped Browser Cancel and
real dialogs retain their handlers. Browser/AI/provider saves remain separate; AI behavior Cancel is20.

Fresh private0700 DB/HOME/TMPDIR/new editable Python3.14.6 before imports/tests/runtime; strict credential-
absent environment, idle/SQL/tracing off, actualmain/private18227/0013/FK[]. Fresh full468Python226warnings,
237canonicalNode,92syntax,focused2Python13Node/scopedweb+newcaseLint/newcaseFormat/EXACThandlerFormat
passed; actualRuff18 BOTH stdout/stderr byte-match fixed baseline, not lint-clean. Feature includes Python;
repair/merger adds no Python edits or unrelated web formatting. All239 source/test/spec bytes immutable.

Stats89 FIRST/new29/old94/owners11 passed. Original affected Settings case5 FIRST FAILED30000ms startup
equality timeout, preserved with zero fakePOSTlogs/no original DOM timeline. Parent-approved ONE minimized
invocation/two fresh unseeded profiles observed unchanged-code defaulttrue→realGETfalse client preference
drift; second immediate equality is not durable polling/causal-hold proof. Timercontrol/defaults/protected
apply-startup source byte-equala8e proves pre-existing SOURCE identity, not an executed old baseline.
Initialization counterexample remains UNFIXED/UNWAIVED for reserved03/whole-delivery follow-up, not19fix.

Separately authorized EXTERNAL coherent-idle departurefixture ONLY simulates initialtrue; strict POST
updates simulated state; exactownorigin GETstatus fetches actual200/idlefalse/inactive and overrides ONLY
idle_detection_enabled, preserving all other fields. Every original body/storage/no-seed/wait/assertion/
cleanup byte retained/reverseproof. This CASE5-only GETfake exception passedFIRST/fourcallers/fourwarnings/
exact Session notes-ID-focus/zero departurewrites, NOT original case5 green or real bootstrap/OSidle proof.
Then unchanged approved cases6–13 passedFIRST; coverage variant13 observed50contexts/pages/errors[],
originalfailed2/2 and diagnostic3/3 separate. New29/supplemental21 explicitPASS/failures[]; full actual
labels/errors/data/readbacks/traffic inspected, missing returnederrors not defaulted. Nested66/20realTask
POSTs/public20readbacks/noSessionautosave/ACTUAL13falseidle33total; remaining editor/Session/modal/chart
controls preserve drafts/focus/no unintended writes. No passing reruns or assertion/readiness/source fixes.
Catalog/providerCRUD/AIsettings/SQLpreview/failure fakes explicit, actual SQLoff/idlefalse. Auto-scroll
preference retained, timing not instrumented; public dispatch/focus not physical-pointer certification.

Producer-after actual20Tasks/0Sessions/providerAI-domain0/Overview1widgets9/status5/settings1/FTS20/docsize20/
data11/idx9/config1; readonly0013/FK[], canonicalinactiveHTTP+actualregularnonsymlinkstrict12keyFILE
shared agreement/SHA22f50dc2..., initially absent honestly. Parent additions require new ACTUAL counts,
not stale20/40. Healthy own109363/start817653/18227/sourcefrozen; fiveDOC DRAFT only, no stagecommitcleanup.
Genuine NEW independent parent LIVE gate/explicit ONEexact625-parentfiveDOC release/normalONLYowncleanup/
fresh closure DOC Standards+Spec remain required. Sixcomplete19pending; specApprovedNOTBuilt,03/20held,
Timerunintegrated/GroupedOutline06–07/SQL13andperformed14 deferred. Source13unit/TDD is not accepted donor.
Known contrast/comparison/caption/initialization/manualtouch-screenreader-otherengines-zoom-motion-colors/
a11y/humanvisual/autoscroll/realSQLprovider/querycrossproduct/transportuncertainty-idempotency-exactlyonce-
crosstab/whole-delivery82fabdc-adversarial-tuicrhuman gates remain UNWAIVED. No humanwhole25/dev merge.
See [criterion mapping and full history](../.scratch/ui-redesign/ticket-19-evidence.md#local-integration-and-bounded-closure-draft-2026-11-06)
and external `evidence/integrated-ticket-19/merger-report.md` / NEW `run.eU17gc/` receipts.

### Ticket19 owner-approved bounded closure — current (2026-11-06)

The preceding DRAFT is historical. Current bounded19 completes seven tickets01,02,04,10,11,12,19 with18
pending; frontier removes19/adds20, DAG unchanged. **Fresh independent closure DOC Standards+Spec and parent
disposition STILL REQUIRED before authoritative19 acceptance or03/20 continuation.** Spec Approved NOT Built.
Parent initially overstepped the operator's no-status-fake constraint, caught it and revoked release BEFORE
postgate document edit/stage/commit/cleanup; original merger report remains immutable controlled STOP.
Owner subsequently explicitly answered “yes” ONLY to narrow test-only case5 idle-status simulation/use of
labelled departure-guard evidence. Not retrospective permission, originalcase5green or bootstrap/OSidle proof.
Original FIRST startup timeout and fresh-profile unchanged-source initialization drift remain UNFIXED/UNWAIVED
for reserved03/whole-delivery follow-up. Pre-existing SOURCE identity is not historical runtime/cause proof;
immediate equality is not durable polling/causal-hold proof.

Only case5's exact own-origin GETstatus route.fetch actual200/inactive/unfrozen/nullgap/idlefalse changes
ONLYidleflag; initialsimulatedTRUE/exactPOSTbool state/allotherfields and entire original body/defaultstorage/
no-seed/wait/assertions/readbacks/cleanup preserved/reverseproof. BOTH producer/independent parent observed
two realfalse→servedtrueGETs/zeroPOST/fourwarnings/exactSessionnote-fullID-focus/zero departurewrites.
Genuine independent parent13 FIRST invocations/50actualcontexts-pages/actualpassiveerrors[] =12ordinary+
labelled coherent5, not all13originalgreen. New29/supp21 explicitPASS/failures[]/errors[]; all labels/profiles/
samples/readbacks/data/traffic inspected; missing returnederrors remain absent. Parent Nested66/newnonce
04-nested-1793968922549/20distinctpublicP-Q IDs/ACTUAL12falseidle32total (producer13/33 not fixed oracle),
ALLproducer20fields unchanged/public40. Catalog/providerCRUD/AIsettings/held-failure/SQLflag-schema-preview
fakes explicit; actualSQLoff/idlefalse/no provider execution. Publicdispatch/focus not physical-pointer proof.
Focused2Python HTML route checks are real ASGI/TestClient fixtures, NOT standalone daemon; native94 supplies
live browser/daemon route/category/history proof. Already-run468Py226warnings/237Node/92syntax/2focusedPy/
13focusedNode/scopedPython-exacthandler/fixedRuff18BOTH remain evidence; no passing reruns for approval.
Parent NEW owner-approved-before read-only audit verified exact625/indexempty/exactfive frozen drafts/all239
acceptedpinned+GitHEAD/protected/runtimeentireenv-PID/editable0700/health0013FK/actual40counts/timerHTTP+FILE.

NEW finisher authority released only five literal DOC finalizations, explicit ONLY-own109363/start817653/
privatea1v5NK/18227 cleanup and ONE exact625-parent five-DOC commit. BOTHpidfd capabilities/retainedverified
pidfd/fullsource-env-UID-cwd-cmd-exe-editable0700-health/canonicaltimerHTTP+strict12keyactualregularFILE/
ro0013FK/ALL40counts/public40fields passed. First helper assumed optional source-definedsecret.key existed:
FileNotFoundError BEFORE signal, STOP. Parent approved shallow filename/source reads and ONE separately named
external enumeration correction; basename correct, generated on first use, including decryption, key genuinely
absent/no invented hash. Corrected invocation REOPENED retainedpidfd/reverified ALL preflight, then sole
pidfdSIGTERM/exitpoll but immediate /proc-absence assertion FAILED, STOP. ONE parent-authorized read-only
audit observed actual PIDabsence13:36:28.080063UTC/socket111/healthrefusal/normal shutdown appended to exact
logprefix. Parent accepted later actual absence, not weaker zombie/not-live; both failures retained/no
second signal/reap/restart/fallback. DB401408bytes SHAdf8e1a4868dded0cb2c254783c82deb46abc95b87272c9fae4a9cbcb6bbf775c/
timer262bytes SHA22f50dc2... unchanged, optionalkey absent beforeafter, privateDB-timer-logs-venv retained.
Poststopmode=ro/query_only0013_ai_data_scope/FK[]/ALLactualcounts equal parent-after: Task40/FTS40/docsize40/
data3/idx1/config1/Overview1/widgets9/status5/AIsettings1/migration1/EVERYotheractualtable0. Poststop40DBIDs
equal pre-signal public40 snapshot, not a post-stop HTTP readback. All239source/all11stoppedlanes/owner228
and dirty status unchanged; fixtures retained. No other runtime/storage cleanup.

Current [six-criterion mapping, history and full limits](../.scratch/ui-redesign/ticket-19-evidence.md#owner-approved-bounded-closure-and-current-gate-2026-11-06)
and separate external `evidence/integrated-ticket-19/recovery-finisher-report.md`/`recovery.finisher-20261106-v1/`
record actual final commit/clean/source-preservation proofs; original `merger-report.md` immutable. Routes
/settingsBrowser,/settings/aiAI,/settings?category=providers; genericnavbarstill/settings/ai until03,
oldPrefsretained/Timerunintegrated/AIbehaviorCancel20/GroupedOutline06–07/SQL13performed14 deferred. Both13
TDD/unit checkpoints NOTacceptedproduction/donor/SQLruntimepermission. ALLknownTasklight4.33/darkAI3.98986/
NULL-emptycomparisonbaseline ambiguity/captionheuristic/initialization/manualphysicaltouch-screenreader-
otherengines-exhaustivezoom-motion-colors-a11y-humanvisual/autoscrolltiming/realSQLprovider/querycrossproduct/
transportuncertainty-atomicity-idempotency-exactlyonce-crosstab/fixed82fabdc-whole-delivery-adversarial-tuicr-human/
devmerge limits UNWAIVED. No appimport/tests/browser/syntax/lint/passingreruns/sourcechanges in this finisher;
no amend/pushPR/devmerge/humanwhole25 claim. STOP fresh closure DOC two-axis review and parent disposition.

## Testing and checks

The coverage description and observed-baseline paragraph below retain earlier inspection results,
not the latest suite count. Use the [shared delivery summary](../specs/README.md#delivery-status-and-evidence)
for current integrated receipts. "No browser test suite" means no installed automatic browser suite;
tracked manual/native probes and their bounded execution evidence exist as described above.

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

### Comparison identity regressions

`tests/test_query_comparison_identity.py` covers the real root analytics HTTP endpoint and the
public `QueryService.run` response/row `model_dump(mode="json")` contract. Both retain the existing
public fields and string keys while attaching distinct NULL/empty-category baselines correctly;
HTTP response filtering alone does not cover direct service callers. The existing renderer suite
`tests/test_widget_stack_collision.cjs` accepts a captured HTTP response through
`TIMETRACE_COLLISION_API_RESPONSE` to check separate-row baseline rendering and source-row clicks.

## Agenda foundation checkpoint (#2)

`SessionService` owns the additive `POST /scheduled-sessions`, `GET /scheduled-sessions/{id}`
and `PUT /scheduled-sessions/{id}` interfaces. Create captures immutable original endpoints even
for a past plan. PUT takes both current endpoints and the last read `expected_revision`; a stale
write returns `409 revision_stale`. Plan task reassignment, recording/attachment and destructive
plan actions are not enabled by this checkpoint.

`GET /scheduled-sessions/{id}` also accepts `virt:` recurrence IDs. A live projection returns
`is_virtual: true`, transient original endpoints and `projection_revision`. PUT to the virtual ID
with both edited current endpoints and `expected_projection_revision` to capture it as a real
plan. Adopt the returned UUID and then use its numeric `revision` for later edits. A changed,
suppressed, skipped, already materialized or elapsed projection cannot be claimed with an old
token (`409 projection_stale`). A typed GET of a well-formed occurrence in a paused series
returns `404`; the legacy GET retains its existing error behavior. No legacy override is
converted into a plan. Use
`?scope=all_future` only for a resize: it changes the selected occurrence and the series duration
in one transaction, not the intervals of other captured overrides. Captured originals are never
rewritten. Skips and typed anchors survive ordinary task rule edits, including reactivation.

`GET /agenda?start=…&end=…` is bounded JSON (not HTML). It merges persisted plans, live virtual
projections, explicit work and uncertain legacy rows on UTC interval overlap. No reads materialize
or archive projections. Each planning merge reads plans, recurrence rules, exceptions and applicable legacy
rows from one SQLite snapshot. It joins any already-open database transaction without flushing
or committing caller changes; otherwise its read scope ends before returning. The maximum
requested window is 400 days. Live occurrences starting before the window can carry into it;
carry-ins and in-window starts share the 500 unique anchors per series limit. A planning read
that exceeds the occurrence limit is refused instead of reporting a partially empty schedule.
Legacy bounded `/sessions` still uses its row shape and start-in-window semantics. It is not the
typed list. Legacy fingerprint reconciliation runs on writes, not reads: a legacy row edit or
only-this deletion first checks for a known fingerprint at the exact future anchor under the
writer lock. It cannot claim an anchor with an existing exception or adopt recorded work.
Typed range and point reads use the same UTC anchors: a spring-gap occurrence is addressable
at its projected instant, and a fall-fold rule emits only its first instant. Legacy writes
match the full UTC timestamp, never a rounded or neighboring anchor.

Markdown Agenda shows plans and projected occurrences with explicit schedule labels (30-day
planning window, plus the existing legacy agenda). It is not importable as Logged Sessions;
legacy `/markdown/export`, system-wide sessions logs, reviews and performed SQL do not include
plans. Idle timer status uses the next persisted or projected schedule without changing the old
wire shape or writing timer state. AI range, conflict and free-slot reads see persisted plans under
the existing data scope. Legacy proposals/approvals may not modify typed plans, even through a
former virtual ID, or edit explicit recorded work. Schedule validation rejects these targets
without removing the existing commitment from conflicts or daily capacity. AI/statistics
aggregates over the old session cohort retain their old basis.

Task accounting adds only future-starting plans to scheduled time. Completion keeps the separate
own/subtree choices and refuses a clear affecting a protected plan before changing either scope.
Completion clear reconciles only selected exact legacy anchors and leaves skips, rather than
resurrecting projections. Old series-delete scopes refuse a typed target rather than erasing its
exception or partially truncating its series. Delete following uses canonical UTC membership to
choose a local rule cutoff, coalescing duplicate ticks. If no single local `UNTIL` can keep all
prior instants while removing the selected and later ones (or the bounded cutoff check is exceeded),
the operation refuses with `409 utc_scope_unrepresentable` before changing the rule or exceptions.
The report-only `timetrace recurrence audit` lists uncertain legacy candidates only. `--delete`
rechecks the exact confirmed rows under the writer lock before writing its JSON backup and deleting;
a changed target aborts the full selection. Task deletion still detaches plans and history and removes the deleted
task's exception links in the locked transaction. This does not introduce destructive plan consent,
work recording/attachment, reassignment, or version-aware AI restores.

The Folio B page is `/agenda-view` (navbar **Agenda**). Its ledger reads the browser-local day
from `/agenda`; the task picker uses the shared `/api/tasks?status=all` registry. Original and current
intervals are always separate; projected originals are provisional until saved. Uncertain legacy
history and explicit recorded work are labeled separately. Only plan endpoints are editable after
create. No recording, fill metrics, Start-from-plan, or destructive plan actions are available.

Calendar keeps its existing layout and legacy start-window totals. It requests
`/agenda?legacy_cohort=start&start=…&end=…` for a single display snapshot: legacy/work rows use
start-in-window (including zero-length imports), while typed plans overlap, including one projection
per anchor. Default `/agenda` still uses overlap. The old `/sessions` range read stays separate for
legacy totals. Calendar ranges default to **Scheduled session** with an
explicit legacy choice; Tasks/Details **Schedule** and external task drops create plans. Legacy
history edits still use `/sessions`. A captured plan's typed response includes `series_task_id` and
`occurrence_start` for Calendar resize scope; ordinary plans omit them. Legacy virtual deletion keeps
its server-guarded scopes, but saved plan deletion is unavailable. Acknowledgements replace the draft
or event identity and revision before refresh; retries of failed display reads do not repeat writes.
A stale Calendar gesture retains the attempted interval separately from the saved event. Read the
latest state and explicitly discard the attempt before making another gesture. The review follows
the original series anchor across capture; the read-only `/agenda/occurrences/{virt_id}` resolves
its exact current occupant, even when moved out of view. An unconfirmed
Schedule create stays blocked across modal reopenings or task drops on the same page. Check the
relevant interval with a read, explicitly allow a new plan, then use a new gesture; neither action
replays the original write. A task drop held on metadata across recovery must start with a new
gesture. These guards are page-local, not cross-tab receipts.

Hourly quick-add titles on task POST/PUT stage a plan in the task transaction; day offsets remain
assigned dates. Legacy AI approvals refuse title scheduling before task/plan writes, while snapshot
restores still bypass title parsing. Completion displays protected plans without trimming the
requested own/subtree scope and retains the server's atomic refusal. See the
[shared contract](agenda-contract.md) for downstream capabilities.

Singular timer Start validates its task while holding the SQLite writer lock; Split and Stop hold
that lock from context consumption through history commit. This orders Timer and legacy AI deletion
within the daemon. Freeze/toggle and idle resolution also serialize with timer mutations in the
process; the existing pre-idle and resolution commits retain their historical failure behavior.
This does not make SQLite and the timer JSON crash-atomic or change ordinary human task-deletion
behavior for live timer context. Legacy mutations still create uncertain history, not typed work.

## Migration verification

The source tree currently ends at `0015_typed_recurrence`; inspect revision ids and
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

Startup and `timetrace db migrate` use Alembic only. Before opening SQLite, they check the
Alembic entrypoints and resolve the required schema revision (`0015_typed_recurrence`) in the
migration graph. An incomplete installation cannot pass by reporting an older `head`; use a
complete TimeTrace checkout or installation. Update `MINIMUM_SCHEMA_REVISION` in `db/session.py`
when the application starts depending on a later schema revision.

A non-empty database without a recorded revision is refused rather than stamped or recreated.
For an unversioned database (including one from an older `create_all` fallback), stop writers and
keep a consistent backup before seeking schema recovery or restoring a known Alembic-tracked
backup. Do not stamp head, hand-edit the revision marker, or delete the database to bypass the
guard. This does not repair databases already incorrectly stamped by an older build.

`tests/test_agenda_migration.py` exercises root startup on both a fresh database and a SQLite
backups of seeded 0013 and 0014 databases, compares old metadata, relationships, JSON and
polymorphic references, and exercises HTTP capture and task detachment under SQLite foreign keys.
It also exercises startup refusal with unversioned data, missing Alembic configuration, and
missing required revisions or ancestors before SQLite is opened. Revision 0015 refuses downgrade
when a typed override exists; 0014 refuses downgrade with typed plan/work data.

Use real Python datetime literals for bulk-insert seed data, not `sa.func.now()` (the latter broke
SQLite's DateTime binder in an earlier migration). Preserve past logged work and polymorphic id
references such as `RatingEntry.target_id` when changing identifiers or relationship structure.

### Settings departure: initialized draft ownership

The ticket-01 guard keeps a baseline per initialized field, not one current-DOM snapshot after
unrelated reads. A successful writer checkpoints only its submitted fields. Day text/grade and custom
ratings have separate roots; each successful rating POST checkpoints its own input. Dismiss checkpoints
only day text/grade before refresh. Same-day retries and late rating reads retain existing drafts.
Unknown day/AI settings Save performs no write: finish/retry loading first. AI load failures offer
**Retry load**; widget capability failures keep the unknown form closed and explain reopening to retry.
Accepted instructions (or an authoritative conflict reload) advance the persisted instruction baseline
even when the live field is dirty. Only a clean field adopts the new value; unsaved instruction text
and other behavior/provider owners are retained.

Current owner audit for the **new Settings link** (not a retrofit of every historical navigation path):

| Existing persisted/consumed editor | Baseline / completion boundary |
| --- | --- |
| Preferences | Open; explicit browser Save; existing idle side effect unchanged |
| Calendar/Tasks task and session dialogs | Initialized open; explicit Save/Cancel; session focus guard retained |
| Task details / subtask dialog | Properties editing and Save gated until first successful tree read, including Retry refresh; subsequent refresh preserves drafts. Subtask dialog owns open/Save/Cancel. |
| Revision | Date-owned Day editors retain text/grade, ratings, grouping and filters when hidden, switched or promoted. One retained owner exists per date; the main day is excluded from history. Task/session text checkpoints on its own successful write; each successful rating checkpoints only its field in the target-type container. Failed/pending fields and concurrent edits remain dirty. Rating-definition dialogs retain their initialized owners. |
| Habits | New/edit definition form and retained per-local-date entry drafts; explicit own Save/Cancel, confirmed selected-date Clear |
| Statistics | Structured/optional SQL widget editor after capabilities; own Save/Cancel; late SQL column metadata cannot checkpoint title edits |
| Tasks Statuses | Each initialized manager row owns independent explicit Save/Cancel; Add Status owns explicit Save/Cancel. Acknowledged writes checkpoint submitted fields only; failed display refresh retries read without replaying writes. |
| AI Settings | Initial behavior baseline before GET, preserve edits through load/retry; provider form remains a separate owner |
| Shared Assistant | Unsent composer, standing-instruction proposal text and inline proposal editor; successful send/approval/PATCH consumes only its own submitted data; failed actions retain drafts |

Closing the drawer is not discard: its retained composer/proposal fields remain guarded. Explicit
Cancel removes/closes the corresponding form without writing. Dashboard/conversation name prompts are
blocking immediate actions, not background drafts. Date/view/search/filter/export controls, task-tab
visibility, inspector/chart selections and batch-selection checkboxes are navigation/read/selection
state, not unsaved domain forms. Habit entries now stage amounts/results until explicit Save; hidden
per-date owners stay guarded and successful ACK checkpoints only submitted fields. Status-manager
rows retain independent explicit Save/Cancel drafts. Current status refresh preserves Task/property/child
selections and initialized drafts; no new autosave or domain policy is implied.

Caller coverage: `tests/test_draft_ownership.cjs` uses real feature handlers and `api_client.js` with
held/failed HTTP fixtures; five `tests/browser_*draft*ownership.js` / initialization/retry probes are
manual async functions for the existing browser bridge. See ticket-01 evidence for their exact names,
actual parent execution, fake boundaries and remaining review/manual limits. No browser framework,
API/schema change, persisted draft store or later-ticket layout is introduced.

`tests/browser_guard_edge_cases.js` adds authoritative instruction reversion, unknown task-tree gating/
retry, retained hidden Day text/grade and real partial task/session-review persistence/retry checks.
Only the deliberately failed rating POST is faked in those review cases; public API readbacks verify
text and successful ratings. The existing Save handlers surface that rejection as one expected
pageerror per case; this repair does not provide polished review-error UI (tickets 16/17).

The corrected Settings-caller probe records all traffic and permits only the known dashboard-startup
`POST /idle/toggle {enabled:true}` in its startup phase, after observing preference reconciliation.
Canceled departures must produce no writes, including config writes. The shared-appearance probe
keeps immediate samples as diagnostics and asserts contrast only after finite browser animations
and rendering completion (eight batches maximum, two-second per-batch deadline). It changes no CSS,
threshold or idle policy and certifies neither transient/all-frame contrast nor whole accessibility.

### Settings departure: suspended Session and late Day writers

Session → **+ Task** suspends the initialized Session DOM and its original draft baseline. The hidden
owner stays guarded through nested Task editing and partial writes. Nested Task Cancel resumes the
Session; successful completion attaches the acknowledged parent and consumes suspension **before**
fallible metadata refresh, without replacing Session Notes, timestamps or tags. Optional late launcher
focus restoration is independent and yields to newer focus/dialog owners; a superseding Session cannot
receive the old parent, and standalone Task Cancel/Save cannot inherit its suspension. Session Save is
still explicit. Session Cancel or an unrelated
Session opening ends the suspension; ordinary standalone Task Cancel remains discard. Task create/edit
focus the title when initialization finishes, without deferred focus/select callbacks that can steal
subsequent Tags typing or act after closure/reopening.

Day workspace uses one retained editor root per date. Bottom history starts closed and expands at
most one non-main editor. Hiding, changing the main date, switching historical cards or promoting a
historical day retains its form, ratings, grouping and evidence filter. Late reads and write ACKs
apply only to their captured date/root. Save snapshots text and every rating before its first await;
known day/rating ACKs checkpoint only submitted fields and retries skip those acknowledged payloads.
Concurrent edits and hidden other-date drafts stay guarded. Dismiss writes/checkpoints only that
date's text/grade; Discard restores only that date's drafts and keeps already saved rows. Required
rating validation and controls are editor-scoped; rating definition policy is unchanged. Partial
saves remain separate writes, and a lost response can leave an uncertain persisted result. No
atomic/idempotent/exactly-once transport guarantee is implied.

Current Day caller coverage is in `test_draft_ownership.cjs`, `test_day_workspace.cjs` and
`test_day_workspace_api.py`; `browser_day_workspace.js` supplies the current manual native probe.
Execution and remaining acceptance gates belong in ticket-15 evidence. Earlier ticket-01 native
probes document their historical single-editor DOM and do not establish acceptance of this workspace.

### Ticket20 AI Settings — in-progress checkpoint

AI Settings provide owner-local behavior Cancel, provider key keep/replace/explicit Clear,
submitted-field ACK checkpoints and read-only list/catalog retry. Known provider credential extras
are excluded from responses; probe failures use stable safe diagnostics. Stored extras and SDK
forwarding, Pi authentication and independent Browser drafts remain preserved.

See `.scratch/ui-redesign/ticket-20-evidence.md` for actual software checks and limitations. The
original native attempt failed with a masked, unknown primary exception; repair05 and this reconciled
checkpoint still require fresh combined checks, native execution, independent review and parent
disposition. Ticket20 remains in-progress; no native acceptance or software completion is claimed.


### Ticket24 Markdown export — bounded software closure candidate (2026-11-13)

Calendar Export retains all six real agenda Markdown scopes with generated inert preview,
explicit Copy/Download, Ctrl+Enter, UTC date-range/session-start caveats and merged upcoming
recurrence. Export focus/selection ownership prevents late reads or nested Task/Session/Assistant
operations from replacing the current owner. Existing backend/legacy contracts are unchanged.

Current evidence: `.scratch/ui-redesign/ticket-24-evidence.md` maps all six unchanged criteria.
Combined product checks pass562Python/464Node/123syntax; full Ruff retains18 byte-matched inherited
findings. Freeze05 only changes two native origin-guard callbacks and their evidence note;14 inert
cases/two syntax checks pass, with no full-suite rerun after that test-only amendment. Native-v3
binds493 pins and exits0 with614assertions, six actual downloads matched to original response bytes,
16 width/theme combinations/288 contrast samples/12 pointer checks. Sole pidfd shutdown gives actual
exit-15/reaping/process absence/refused111; FTS rank1 and logical/private storage equality pass.
Original pidfd launch failure and native-v2 FAILED remain retained. Clipboard uses explicit fakes;
OS clipboard/save, physical accessibility/other engines, inherited contrast limits and human
acceptance remain open. Candidate software count13/12 is conditional on parent integration; actual
integration4e75ef02 remains12/13. Fresh closure metadata reviews and parent disposition are pending.
This does not complete whole25, waive acceptance or authorize dev merge/push/PR. No new tests,
runtime, provider, personal database operations or cleanup accompany this metadata preparation.


## Outline and retained inspector: bounded delivery checkpoint (2026-11-13)

Tasks now supports optional Outline with per-browser cross-reload selection, filtered ancestor
context and a retained inline inspector using the dedicated details editor and existing task/session
contracts. Dedicated task details remain reachable. Controller guards preserve dirty drafts and
selection across metadata refresh, stale reads and pending writes; explicit Save/Cancel, shared
history/accounting, completion prompts and Grouped/Kanban navigation reuse existing handlers.
See [ticket07 current evidence](../.scratch/ui-redesign/ticket-07-evidence.md#bounded-software-completion-candidate-2026-11-13).

Combined freeze07 checks:564Python/214warnings,485actual canonical Node cases,127syntax;
scoped lint/format/whitespace pass, full Ruff18 and stderr warning byte-match incoming564e25a.
Native01/native02 remain FAILED, including native02's69 returned functional assertions/13actual
ACKs. Held03 separately passes7focused A→B→A transport checks/3TaskACKs/0UIwrites with exact
callback-completion-before-unroute ordering and full storage/FTS/actual−15 shutdown. This narrow
proof does not rerun69, certify new Save/Delete latches, establish native dirty metadata refresh or
OS idle, or replace physical accessibility/contrast/other-engine/shared-workflow/human/whole25
acceptance. Bounded completion metadata remains subject to fresh Standards+Spec review and
parent disposition; integration564e25a remains13completed/12open until the candidate is integrated.


## Ticket18 bounded software-completion candidate (2026-11-15)

Ticket18's five unchanged criteria map to [current bounded evidence](../.scratch/ui-redesign/ticket-18-evidence.md#bounded-software-completion-candidate-2026-11-15).
Combined product checks passed572Python/217warnings,583actual canonical Node/default isolation,
132syntax and scoped lint/format/whitespace. Full Ruff retains18 inherited findings with BOTH
streams matched to incominge0c6989. Current freeze10 only repairs the finite timestamp probe
oracle (13 controls, other510 files unchanged); full suites were not repeated after that probe edit.
Feature/search/merged Rating-Export source review axes each report zero findings in their scopes.
Native-v2 remains FAILED despite returned16 Admin layouts/288text/80controls and8 Recovery groups;
consumer-v3 remains FAILED despite real Session zero/dismiss/undismiss/exemption observations.
V4 UNRUN and v5 FAILED14ACKs remain retained. Separate currentv6 PASSES its bounded held-search/
Task-prefix/Day flow:26realACKs, one declared400, one original registry hold,10light/dark Day grades,
99original captures,77requests/responses/callbacks, zero guard/capture/handler/unresolved errors,
full real ACK/storage/FK/FTS-copy/private-after-stop reconciliation and sole actual−15 shutdown.
Seven DayReviews remain. No failed matrix is relabeled or Admin/Recovery/Session rerun claimed;
Task prefix supplies Day's independent retained draft, not new broad Task coverage.
390/1024/1440, full presentation/motion/zoom, physical touch/screen readers/other engines, wider
shared native workflows, explicit owner acceptance and whole25 gates remain open and unwaived.
Candidate15completed/10open adds18 only; authoritative integratione0c6989 remains14/11 pending
TWO fresh closure metadata axes, parent disposition and integration. Historical checkpoints remain;
spec stays Approved, not Built. No new tests/runtime/Git writes/provider/personalDB/cleanup operations.


### Manual recorded work (Agenda #3)

The Folio Agenda at `/agenda-view` supports explicit manual work separately from plans, including
past plans. See [the capability contract](agenda-contract.md#3-implemented-query-capability-boundary)
for typed routes, validation/warnings, explicit association and bounded union progress. Existing
Timer v1 and legacy session callers remain uncertain; the new source excludes them. Task accounting
is unchanged alongside the new labels. Work edits/reassignment and custom union widgets are not
implemented. Query cohorts are whole intervals selected by local start day, never midnight clipping.
