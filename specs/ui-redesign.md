# Whole-UI redesign
Status: Approved
Date: 2026-11-01
Owner approval: 2026-11-01 — all questionnaire recommendations and final specification approved.

## Problem and approval boundary

TimeTrace's shipped workflows need a coherent, readable interface without losing their scheduling,
accounting, review or AI approval behavior. The owner approved the selected page compositions,
all eight questionnaire recommendations and this final production contract. The 25-ticket breakdown
and local publication are also approved; see the [published backlog](../.scratch/ui-redesign/README.md).
**This contract is approved, not built.** The owner has subsequently requested implementation,
local branches/commits and integration merges; see the [execution record](../.scratch/ui-redesign/implementation.md).
The earlier approval-only checkpoint did not itself authorize implementation. Technical prerequisites
and later review gates remain in force; no production ticket is completed by this documentation seed.

### Evidence and precedence

- [Coverage/issue plan](../.scratch/ui-redesign/plan.md): settled directions, full surface inventory,
  22 historical candidate slices and open decisions. The delivery table below now uses the approved
  25 published ticket IDs; the backlog maps between these numbering systems.
- [Combined review checkpoint](/home/user/git/personal/TimeTrace/.scratch/ui-redesign-lanes.3zT4LG/combined/README.md): latest owner
  clarification, theme references and exact prototype verification limits. It supersedes earlier lanes.
- [Prototype decision history](/home/user/git/personal/TimeTrace/src/timetrace/interfaces/api/prototypes/app_shell/README.md): selected
  page interactions and historical rejected alternatives. Compare the selected references, not old trials.
- Current source at `82fabdc652c59da87de0f57d7770d0aa32fb7f64`, including current working-tree docs,
  [owner working-tree development reference](/home/user/git/personal/TimeTrace/docs/development.md), [owner decisions](../CLAUDE.md),
  [AI maintenance](../docs/ai-maintenance.md) and final
  [recurrence decisions](../docs/recurrence-engine-plan.md#12-settled-owner-decisions-2026-09-01--these-override-10).

Historical prototype/checkpoint artifacts and the owner working-tree development reference are
external read-only evidence under `/home/user/git/personal/TimeTrace`, not bundled in this seed.
The prototype/checkpoint artifacts are currently untracked in that checkout. See the execution record
for portability limits; no historical assertions have been rerun here.

Latest recorded owner decisions outrank old prototype proposals. Current code establishes shipped
contracts, not permission to contradict a recorded owner decision; report any conflict. The unrelated
`module-deepening` spec is not the redesign specification. Prototype controls/results are evidence of
composition only, never a production implementation or backend/security acceptance certificate.

## Behavior — settled requirements

These requirements and the O1–O8 decision register are owner-approved. Historical prototype choices
not carried into this contract remain evidence only, not extra scope.

### B1. Shared shell, theme and navigation

MUST use the selected top navigation and coherent shared presentation across Calendar, Tasks,
Statistics, Habits, Revision, Settings, task details, shared Assistant and dialogs. Preserve direct
entry, existing route aliases, browser Back/Forward and reachable Settings during incremental adoption.
Offer **all three light treatments**: Refined Archive, Soft Stone and Porcelain. Brand-new browsers
start **Refined Archive/light**. Preserve existing user appearance/color choices. Manual light/dark
switching maps each light option to the existing dark appearance; no new automatic OS switching.
Persist choices per browser; valid existing settings survive adoption and only missing/invalid
individual settings receive defaults. Do not ship rejected Habits-only palettes or resurrect the
first-round Cobalt/Paper/Mono trials as new selected designs.

MUST distinguish selection, actions, completion, warning, failure and focus without color alone;
retain five ordered red-to-green grade steps across badges, heatmaps and rating sliders. Preserve
explicit user colors and auto-color/reshuffle behavior rather than recoloring stored data implicitly.

### B2. Calendar, sessions, recurrence, timer and retained utility dialogs

MUST use **Aligned tool strip**, tasks visible for planning, independently collapsible totals initially
closed on fresh defaults, and a small secondary timer. Spacious **88px/hour** is the selected default;
users can choose density. Remember density and totals visibility per browser across reloads;
preserve valid existing preferences rather than imposing fresh defaults. Preserve Day/3-day/Week planning,
task drag/drop plus keyboard/touch scheduling, overlap/overnight display, date navigation, filters,
Calendar task tabs and the persistent tag/task query-filter chip. No permanent session inspector.

MUST retain the existing popup's fields, task search/attach/create/detach, tags, notes, full start/end
timestamps, time/duration quick actions, duration feedback and Start Timer Now behavior. Edit focuses
Notes; create focuses task search; Ctrl+Enter saves, Escape cancels, ordinary Enter in Notes inserts
a newline. Cancel never writes. Running/frozen timers remain file state, not saved session rows.

MUST retain/re-skin idle recovery, status management, advanced filters and recurrence/completion
prompts rather than redesign their policies. Preserve running/frozen recovery and retag choices,
status order/colors/flags/deletion, and all existing advanced filter/task-tab configuration. Recurring
resize offers this occurrence/all future without changing the task estimate; occurrence writes use
`SessionService`, preserve moved/skipped exceptions and logged history, and support `virt:` IDs.
Completing a recurring task resets status, not the recurrence anchor; its badge shows the next occurrence.
Task completion/unscheduling must forward keep/clear prompts, with own-session selection independent
of subtree clearing. No silently cleared schedule or series-wide deletion of logged history.

### B3. Tasks and details

MUST default fresh/invalid view selection to **Kanban**, retain optional **Grouped list** and
**Outline + inspector**, and provide a normal in-page view selector, not a comparison bar. Preserve
explicit view selection during navigation and per-browser across reloads (**O2**). All views share
existing task contracts, search/filtering, hierarchy, CRUD, schedule/timer actions and completion prompts.

MUST provide the approved quick-edit subtasks below the title: queue/remove children with Enter/Add,
include an unsubmitted child title on Save, and discard parent-popup edits and queued children on
Cancel/Escape. Saved children inherit the saved parent's effective tags/category. Preserve service
quick-add parsing, parent tag inheritance and `status`/`status_id` synchronization. Existing endpoints
save parent/children separately: implementation planning must specify partial-failure feedback/retry
without duplicate children; this contract does not promise a new atomic bulk API.

MUST retain the separate task-modal **AI Quick Add** classify → explicit Parse → editable prefill →
human Save workflow on Calendar and Tasks. Classification invokes no inference; parsing creates no
task/session or conversational approval draft. Preserve tier-1/configured fallback, sanitized tier-2
extraction, error feedback and keyboard handling. This is not replaced by service title parsing or
the shared conversational Assistant; ordinary human Save remains the domain-write boundary.

MUST retain dedicated task details and the optional inline task inspector, own recorded session
history, tags/properties/subtasks and editable drafts. Accounting uses shared task work accounting:
logged = closed rows ended at/before one measurement instant; scheduled = closed rows starting after
it; open/straddling rows, running/frozen timers and virtual projections contribute no time. Remaining
subtracts logged; unscheduled subtracts logged and scheduled. Preserve negative balances and progress
above 100%. Zero/missing estimates and recurring tasks are unbounded; non-positive estimates have null
progress, but negative estimates retain existing finite balances/`is_unbounded` behavior and acceptance.
A recurring estimate is per occurrence, not a series budget. Never relabel all recorded rows as performed.

### B4. Habits

MUST use **Compact cards**, with a small independent day strip per habit; no large shared date cube or
per-card Entry date row. Week/Today navigation changes viewing dates, never logs data. Retain
checkmark/numeric habits, editable amounts, target/unit/color/frequency/reminder settings, definition
editing, historical logs, goal history, charts/inspector, deletion and empty states. Missing logs are
not failures; numeric zero is Pending. Compliance remains completed/all recorded logs, not all dates;
target changes must not rewrite historical logs.

Entry edits MUST use explicit **Save/Cancel**. Checkmark entries use explicit **Done / Failed / Skipped**
choices rather than cycling clicks; selections remain drafts until Save. **Clear** confirms deletion of
only the selected day's record, distinct from saving numeric zero. Preserve negative-number clamping
to zero with visible feedback. Keep one record per habit/local date and existing unit-conversion/reminder
behavior. Defer entry clock time, editable notes and multiple daily entries; do not add unsupported
fields/columns or silently present them as saved. Cancel never commits entry changes (**O3**).

### B5. Statistics

MUST use **Widget canvas**, responsive stacked charts on narrow screens, persisted named dashboards
and editable/reorderable/removable widgets, with per-widget loading/error/retry isolation. Preserve
existing dashboard CRUD, explicit reset/seed rules and the prior localStorage custom-widget handoff.
Use the existing structured capabilities/query engine; preserve full builder expressiveness rather than
the prototype's reduced sample pickers. Preserve optional disabled-by-default read-only SQL widgets
and their sandbox, per-widget ranges/baselines (previous period, prior year, custom), fan-out overlap
labels and split-evenly alternative. No invented global date filter or second hardcoded stats surface.

MUST provide the accepted **Performed time by day** editable widget and recreation preset: sessions,
total duration by day, line, last 14 days, `session_time_relative eq past`, previous-period comparison.
Add it only to **fresh default dashboards**, plus the recreation preset; never automatically insert it
into existing dashboards or restore a user-deleted widget. Keep original “Total Time Logged”/“Logged
Sessions” queries unchanged, with no new past-only filter. Use **Recorded session time / Recorded sessions**
labels and explain that they include past and future recorded rows, not only performed work. Preserve
user-custom widget names/configurations rather than reseeding or overwriting them (**O4**).

### B6. Revision and ratings

MUST use **Day workspace** with bottom history initially closed, not a permanent sidebar/drawer.
Show/Hide history reveals other days; expand one historical editor without duplicating the main day.
Main/history drafts, save/discard/dismiss targets, breakdown grouping and evidence filters remain
independent and survive switching/hiding. Selecting the same day in the main workspace closes the
history duplicate without losing its draft. Ordinary Enter supports text; Ctrl+Enter saves its form.
Each editor needs unique rating-control identities, editor-scoped validation/submission and independent
rating load/dirty ownership. Ticket 15 owns this integration under the preserved **O5** policies; the
current definition-ID-only controls/document-wide rating submission cannot be reused unchanged for
simultaneous main/history editors. Partial/failed saves must not commit another day's rating drafts.

MUST omit the standalone day-summary strip. Use one full-width Activity/Tasks bar-list breakdown,
with the switch beside its heading. Recorded time remains there, session count in Recorded sessions
(matching/total when filtered), done-task count in Tasks means tasks **created that day**, not completion
timestamp. Bars compare against full-day recorded time, retain the scheduled-row caveat/fan-out note,
and are not completion bars. Grouping does not clear an evidence filter. Preserve Calendar date plus
tag/task query handoff and persistent chip; the mock's date-only handoff is not sufficient.
Retain the accepted 13px labels, explicit hours, larger clickable rows and no extra percentage column.
On narrow cards the heading and grouping switch stay aligned; time/actions may wrap.

MUST retain day reviews, optional session-review tab, session inspection/ratings/tags/notes, separate
reviewed/exempt flags, reset/confirmed deletion, task post-mortems and rating-definition administration.
Review writes never complete tasks or clear schedules. Preserve shipped required/dismissal/range/context
and exemption policies unchanged (**O5**); sample controls do not certify these policies.

### B7. Tabbed Settings

MUST use the selected tabbed page with full working area and no permanent category sidebar.
Browser preferences remain client-owned; AI settings/instructions and provider editors remain DB-backed
with independent save/discard ownership. Retain unsaved drafts when switching categories and warn
before leaving with unsaved changes; theme/navigation changes must not silently save or lose drafts.
Browser preferences include existing view/week-start/slot/sidebar/Vim/session-review/auto-scroll/color
preferences; the idle toggle retains its daemon side effect and honest failure state. No unified
settings store or cross-owner atomic Save is implied. Use `/settings` for the tabbed page and retain
`/settings/ai` opening its AI category; old entry points remain usable during rollout (**O2**).

MUST retain AI privacy/scheduling/custom instructions/provider capabilities: default tasks/sessions
scope with sensitive domains opt-in, structured scheduling constraints authoritative, masked credential
keep/replace/clear, confirmed deletion and explicit activation, model catalogs, safe saved/inline probes and Pi-owned
authentication. No secret text in UI diagnostics, logs or API responses; test with fakes.

### B8. Shared Assistant and approval

MUST retain globally available drawer, closed-first entry, chat/history/conversation deletion,
streaming/cancel/errors, read-only insights, resize/fullscreen with real Calendar integration,
proposal editing, calendar overlays, batch/selected accept/reject, audit/history, undo/reapply and
explicit remembered-instruction Save/Dismiss. Use **chat-first**, with proposal review/action history
on demand and explicit approval cards retained. Keep **Enter-send / Shift+Enter-newline** (**O6**).

Final conversation MUST focus on messages, composer and relevant proposal/explicit approval cards.
No mock/debug disclosures, sandbox counters or workflow selectors. Current scope/instructions belong
in Settings; useful action history is available on demand. This is recorded intended cleanup, **not**
a cleanup already performed in the preview. Remembered-instruction cards remain separate, explicit
hash-checked approval; dismissing never changes Settings. Render model/accepted task text inertly.

Tools only propose drafts. Accept/undo/reapply stay in `AIDraftService` and domain services, including
stale/conflict checks, materialized IDs, `parse_title_syntax=False` snapshot restoration and append-only
audit. Preserve JSON/SSE lifecycle and privacy/tool scope, not a stronger invented field-isolation claim.
After writes, shared metadata refresh preserves unsaved fields, selected timer/attachment IDs and
last-known labels; failed refresh offers refresh-only retry, never replays a successful write. Failure
to reload a draft card must not prevent successful task/calendar refresh or report a failed mutation.

### B9. Export

MUST retain the six existing agenda Markdown modes: `sessions`, `tasks_short`, `tasks_full`, `habits`,
`all`, `all_date_range`. Label them **Sessions; Tasks—compact; Tasks—detailed; Habit definitions;
Everything; Everything—with session date range**, respectively. Provide generated Markdown preview
plus explicit **Copy** and **Download** actions. Keep **Ctrl+Enter-download**; omit the separate legacy
session-export menu entry while preserving its existing endpoint/CLI capability (**O7**).
Use existing endpoints, not synthetic exports. Date-range mode filters inclusive **UTC session-start
dates only**; tasks/habit definitions are unfiltered. Agenda Today/Tomorrow uses UTC anchors with
local display; disclose the caveat rather than silently changing policy. Upcoming recurring agenda
sections retain the merged projection read path. This is not a full backup, Calendar image, CSV/ICS/PDF
export or browser import feature. Existing Markdown import/API/CLI remains unaffected.

## Data, API and layers

**Baseline: no approved model/schema migration, new domain service, API semantics or CLI change.**
Existing rows, IDs, reviews/ratings, dashboard/widget configurations, AI conversations/proposals/audit,
provider keys and browser settings must survive adoption. New defaults never justify deleting/reseeding
existing data. O1–O4 specify non-destructive preference/seed adoption and defer Habit entry metadata.
Any later metadata amendment requires separate API/behavior approval: `HabitLog.notes` already exists, but the browser log-write schema does
not accept it. Require a migration/backfill only if the approved work changes stored schema or needs
existing-data transformation; test any migration on fresh/disposable existing DBs. Clock time and
changed entry cardinality are deferred, not implied by the existing notes column.

| Layer | Ownership / current entry points |
| --- | --- |
| Templates/static | Plain Jinja2/JS/CSS; shared navbar/dialogs plus all seven page templates; no common base exists. Integrate selected presentation, not mock runtime/state or study bars. Use `api_client.js`, `task_knowledge.js` and existing feature modules. No new framework/build/dependency. |
| Web router | Actual daemon's `routers/web.py`: preserve `/dashboard`, `/tasks` + `/kanban` + `/tasks-view`, `/task-inspector/{id}` + `/tasks-detail/{id}`, `/stats`, `/habits-view`, `/revision`, `/settings/ai`. Approved new `GET /settings` renders tabbed Settings; retain `/settings/ai` entry to AI category. This is a web route, not a new JSON endpoint. |
| Task/session/timer | Existing routers/schemas → `TaskService`, `SessionService`, `RecurrenceService`, `TimerService`/idle logic → current core/model contracts. Shared callers include CLI and AI; UI work does not alter their responses/status codes. |
| Habits/reviews/ratings | Existing habit/revision/task-review/session/rating routes → `HabitService`, `RevisionService`, `RatingService`, task/session services. Preserve existing validation and destructive-operation policies; gaps require regression tests, not mock assumptions. |
| Statistics | `dashboards.js`, `widget_builder.js`, `stats.js` → dashboards/analytics routers → `DashboardService`, `QueryService`, `SqlQueryService` → registry/compiler/seeds. All totals continue through structured SQL, not new Python full-table aggregation. |
| AI | Drawer/drafts/overlays/settings/`ai_quickadd.js` → `/api/ai` routes/schemas → shipped chat/draft/instruction/settings/provider/insight services. Retain distinct `/quick-add/classify` and `/quick-add/parse` under that prefix; parsing prefills the human task form, not conversational drafts. No new approval implementation. |
| Export | Calendar `dashboard.js`/export modal → `GET /api/agenda/export` → `AnalyticsService` and merged agenda reads. `/markdown/export` is an existing distinct legacy contract, not an approved new menu entry. |
| Core/DB/CLI | No redesign by default. Core stays DB/FastAPI-free; routers thin, domain exceptions in services. No new infrastructure, sync, native/TUI, multi-user or integration groundwork. |

## Time and identifiers

No new instant/ID type. DB datetimes remain naive UTC, normalized with `ensure_utc` at API/comparison
boundaries; shared local conversions use `core/timezones.py`. Session IDs are UUIDv7 strings or synthetic
`virt:` recurrence identities; never numeric parsing or unquoted inline IDs. Preserve polymorphic
rating target type/id pairs. Local dates are not UTC ISO substrings. Statistics bucket by local session
**start day**, explicit browser timezone/week-start with daemon-zone fallback/warning, not arbitrary
new IANA bucketing. Recurrence retains its wall-clock timezone/DST rules. Export's separate UTC range
semantics remain explicitly labeled. Habit entries keep one record per habit/local date; clock-time
metadata and its timezone policy are deferred under O3.

## Edge cases and rollout guardrails

- Every slice covers empty/loading/error, dirty/save/discard/cancel, long/untrusted text, narrow layout,
  focus restoration and keyboard/touch alternatives; global/Vim shortcuts must not consume editor,
  dialog or drawer typing. Preserve session-review visibility preferences and destructive confirmations.
- Deleted/stale task metadata never detaches a session implicitly. Unknown recurrence must block unsafe
  resize/delete with action-specific retry; moves/ordinary saves retain existing availability. Late
  selection/statistics/rating requests cannot overwrite a newer editor; Save waits for initialization.
- Running/frozen timers survive navigation/theme changes. A failed save is distinct from a successful
  save followed by failed refresh; retries must not duplicate task children, AI accepts or session writes.
- Incremental pages must coexist safely: no dead links, missing shared includes, unavailable approvals,
  double keyboard handlers or stylesheet leakage. Each slice has a usable old entry path until replacement.
- Existing preferences and dashboards need explicit adoption fixtures before rollout; fresh defaults
  are not evidence that existing data/preferences can be overwritten. Prototype reload-reset behavior
  is not a production persistence policy.

## Approved owner decisions

On 2026-11-01 the owner accepted every recommendation in the eight-part questionnaire and explicitly
approved the final specification: “yes to all answer. and final approve as well”. These are production
requirements, not prototype defaults or inferred answers. No O1–O8 decision remains open. Numbers
below are published ticket IDs; the original planning-ID mapping remains in the backlog.

| ID | Approved outcome | Applies to |
| --- | --- | --- |
| O1 | Expose Refined Archive, Soft Stone and Porcelain. Brand-new browsers start Refined Archive/light. Preserve existing appearance/color choices; all light options share the existing dark appearance through manual light/dark switching. No new automatic OS switching. | 01 |
| O2 | Persist theme, task view, Calendar density and totals visibility per browser across reloads. Preserve valid existing settings; apply defaults only to missing/invalid individual settings without resetting others. Use `/settings`; retain `/settings/ai` opening AI. Keep tab drafts, warn before leaving unsaved changes and keep browser/AI/provider saves separate. | 01, 06–07, 19 |
| O3 | Explicit Save/Cancel for entry edits; explicit Done/Failed/Skipped choices, not click-cycling. Clear confirms deletion of only the selected day's record, distinct from numeric zero. Clamp negative numeric values to zero with visible feedback. One record per habit/local date; defer entry clock time, editable notes and multiple daily entries. Leave unit-conversion and reminder behavior unchanged. | 10 |
| O4 | Add Performed time by day only to fresh default dashboards plus a recreation preset; never automatically insert into existing dashboards or restore deleted widgets. Keep original queries unchanged; labels become Recorded session time / Recorded sessions, explaining past and future recorded rows rather than performed work. Preserve user-custom widget names/configurations. | 14 |
| O5 | Preserve shipped required-rating, dismissal, range-edit, context and exemption policies. Independent day-editor rating scoping, five-grade colors and Calendar filter handoff remain required; no new domain policy. | 15–18 |
| O6 | Chat-first Assistant; proposal review and action history on demand, explicit approval cards retained. Keep Enter-send and Shift+Enter-newline. Preserve all existing capabilities and separate remembered-instruction approval. | 21–23 |
| O7 | Six labels: Sessions; Tasks—compact; Tasks—detailed; Habit definitions; Everything; Everything—with session date range. Generated Markdown preview with explicit Copy/Download; no separate legacy session-export menu entry. Keep Ctrl+Enter-download and existing UTC filtering/Today–Tomorrow anchors with visible caveats. | 24 |
| O8 | Production specification and per-ticket regression/isolated real-app workflow checks plus final whole-app verification approved, alongside the already approved 25-ticket graph/publication. At this historical approval checkpoint, no implementation start, commit or merge was requested; the subsequent execution request is recorded separately. | All tickets |

## Approved ticket breakdown and dependencies

The owner approved the 25-ticket proposal with “everything feels right, approved”. The
[published backlog](../.scratch/ui-redesign/README.md) records individual ticket files, decision gates,
shared acceptance and the mapping from the original 22 candidates. The subsequent final approval
also resolves O1–O8; decision IDs in the table below are approved requirements, not outstanding gates.

Tickets are **ready-for-agent**, subject to their technical predecessors. Ticket **01** is the current
unblocked frontier. Implementation is now requested; the documentation seed does not implement a
production ticket. Shared theme/preference adoption precedes 01, not Settings. Keep tests inside
every ticket; 25 is cross-page acceptance, not postponed integration testing. Existing production
entry paths remain usable while replacements wait. The execution record separates the subsequent
implementation/local-commit/integration-merge request from the historical approval checkpoint.

| Ticket | Verifiable workflow | Technical predecessors / approved decision references |
| --- | --- | --- |
| [01](../.scratch/ui-redesign/issues/01-calendar-shell.md) | Calendar shell and shared appearance | None technically; O1–O2 |
| [02](../.scratch/ui-redesign/issues/02-session-editing.md) | Session editing and scheduling | 01 |
| [03](../.scratch/ui-redesign/issues/03-timer-idle-recovery.md) | Timer and idle recovery | 01 |
| [04](../.scratch/ui-redesign/issues/04-kanban-quick-edit.md) | Kanban and task quick editing | 01 |
| [05](../.scratch/ui-redesign/issues/05-task-details-accounting.md) | Task details and work accounting | 04 |
| [06](../.scratch/ui-redesign/issues/06-grouped-task-list.md) | Grouped task list | 04; O2 |
| [07](../.scratch/ui-redesign/issues/07-outline-inspector.md) | Outline and inline inspector | 05; O2 |
| [08](../.scratch/ui-redesign/issues/08-status-management.md) | Status management | 04 |
| [09](../.scratch/ui-redesign/issues/09-filters-task-tabs.md) | Advanced filters and Calendar task tabs | 04 |
| [10](../.scratch/ui-redesign/issues/10-compact-habits.md) | Compact Habit cards | 01; O3 |
| [11](../.scratch/ui-redesign/issues/11-dashboard-canvas.md) | Dashboard and widget canvas | 01 |
| [12](../.scratch/ui-redesign/issues/12-structured-widget-builder.md) | Structured widget builder and comparisons | 11 |
| [13](../.scratch/ui-redesign/issues/13-read-only-sql-widgets.md) | Optional read-only SQL widgets | 11 |
| [14](../.scratch/ui-redesign/issues/14-performed-time-widget.md) | Performed-time widget and preset | 11; O4 |
| [15](../.scratch/ui-redesign/issues/15-day-workspace.md) | Day workspace and independent history editors | 01; O5 |
| [16](../.scratch/ui-redesign/issues/16-session-reviews.md) | Session reviews | 15; O5 |
| [17](../.scratch/ui-redesign/issues/17-task-post-mortems.md) | Task post-mortems | 05; O5 |
| [18](../.scratch/ui-redesign/issues/18-rating-administration.md) | Rating-definition administration | 01; O5 |
| [19](../.scratch/ui-redesign/issues/19-browser-preferences.md) | Tabbed browser preferences | 01; O2 |
| [20](../.scratch/ui-redesign/issues/20-ai-settings-providers.md) | AI settings and providers | 19 |
| [21](../.scratch/ui-redesign/issues/21-clean-assistant.md) | Clean shared Assistant | 01; O6 |
| [22](../.scratch/ui-redesign/issues/22-proposal-approval.md) | Proposal approval and recovery | 02, 05, 15, 21; O6 |
| [23](../.scratch/ui-redesign/issues/23-instruction-approval.md) | Remembered-instruction approval | 21; O6 |
| [24](../.scratch/ui-redesign/issues/24-markdown-export.md) | Markdown export workflow | 01; O7 |
| [25](../.scratch/ui-redesign/issues/25-whole-app-verification.md) | Whole-app adoption verification | 02–24; O1–O7 |

Compared with the earlier 22 candidates, builder/SQL, session/task reviews and domain/instruction
approval are split. Task post-mortems do not wait for day reviews; rating administration does not wait
for history-editor integration. SQL and instruction approval may use current working entry paths,
without waiting for the structured builder or new AI Settings presentation respectively.

## Verification — approved seams

Use observable browser workflows against the actual daemon, with existing API/service regression
seams for semantics. No new browser framework is implied. This matrix is owner-approved; add missing
focused coverage within each implementation ticket where the current suite has gaps (notably habits/reviews/ratings,
export, draft mutations and preference adoption). A passing existing suite alone cannot verify them.

| Seam | Required observable checks / existing prior art |
| --- | --- |
| Real daemon/templates | All seven templates and aliases/direct loads; selected defaults, optional views, query chip/Back/Forward, task details, Settings/Assistant entry and incremental old/new coexistence. |
| Task/session/timer | Existing task API/service/work-accounting, session, recurrence and timer pytest; Node `test_task_knowledge.cjs`, `test_calendar_task_registry.cjs`, tag tests. Exercise quick-edit queued child save/cancel/partial failure, idle recovery, `virt:` materialization, unknown recurrence guard, moved/skipped/history preservation and keep/clear independence. Add fake-provider/API and browser AI Quick Add checks: classify performs no inference; explicit Parse creates no task/session; prefill remains editable before human Save; tier routing/fallback/errors and keyboard behavior work on Calendar/Tasks. |
| Habits/Revision/ratings | Add focused API/service tests for approved O3/O5 policies, including explicit Habit Save/Cancel, state choices, confirmed Clear and visible negative-to-zero clamping; browser main/history drafts/filter independence, duplicate-day exclusion, Calendar handoff, five-grade mapping, reviewed+exempt, own accounting and no completion/schedule mutation on review. In ticket 15, open two days using the same rating definition: unique IDs, independent scores/dismissal, target-scoped validation/save/dirty refresh and failed/partial-save recovery without cross-day writes. |
| Statistics | Dashboard API/query/SQL sandbox pytest plus real builder workflows. Check per-widget baseline/errors, full capabilities, fan-out labels/split-evenly, local start-day/week context and O4 fresh/existing/deleted-widget fixtures. |
| Settings/adoption | Existing browser settings/legacy task-tab/custom-widget/drawer-width fixtures, no preferences, invalid/missing keys, existing explicit values, reload, separate browser/AI/provider save boundaries, dirty navigation, idle side-effect failure, no credential disclosure. |
| Assistant | Existing fake-agent chat lifecycle/instruction/privacy/provider/read-context tests; add affected draft mutation regressions. Browser streaming/cancel/error, resize/fullscreen/real overlays, proposal edits/partial batches/stale conflicts, explicit instruction approval, undo/reapply and metadata failures with exactly one domain write. No debug clutter, executable model text, unsafe refresh or secret output. |
| Export | Add API/service tests for all six scopes, inclusive UTC starts, unfiltered tasks/habits and merged future recurrence; browser actual preview/download/copy, dates/errors/stale previews, truthful filenames/scope and O7 shortcuts. |
| Presentation | Each adopted page/dialog at 390/768/1024/1440, chosen light options + preserved dark; keyboard focus/traps/escape/restoration, touch alternatives, long text, zoom/reduced motion and selected/disabled/error/empty states. Measure text/control contrast; user-defined colors need readable fallback/labels, not silent stored-color rewrites. Record untested physical-touch/screen-reader/engine checks, never claim certification from sampled contrast. |

Every TimeTrace import/command requires an absolute temporary `TIMETRACE_DB_FILE` first, isolating
DB/timer/key siblings, a non-8002 daemon port and separate browser storage. Never use personal data,
credentials or paid/provider calls; fake providers only. No app runtime is needed to record this approval.
For future code slices: focused tests, full `uv run python -P -m pytest -q`, existing Node regressions,
`node --check` each changed JS, scoped Ruff plus repository-wide report, and `git diff --check`.
If a schema amendment is approved, add Alembic migration and test fresh/disposable existing DBs
without stamp/create-all fallback. Report new failures separately from baseline issues.

## Exclusions and evidence limits

The historical approval record did not itself start production code or prototype cleanup.
Implementation has since been requested under the execution record; this seed changes documentation
only. No fresh layout/palette design interview; no mock workflow selectors/sample fixtures/debug
counters in final UI. No domain-policy
rewrite, performed/recorded conflation, arbitrary timezone bucketing, stronger AI scope isolation,
new export formats/import UI, Habit metadata schema, provider/network tests, sync, multi-user,
framework/build step, native/TUI, queues or other speculative infrastructure.

Historical combined receipts report 1,971 current-round prototype assertions, 42 dark-reference color
comparisons and 341 isolated Python passes with 85 warnings; an earlier separate round reports 2,650
prototype assertions. Do not sum them or call them newly executed tests. They do not certify real SSE,
auth/privacy, timer/idle, recurrence, SQL, migrations or whole-app accessibility. Two fresh read-only
reviews and parent corrections are recorded in the [review findings](../.scratch/ui-redesign/spec-review.md).
Both CHANGES findings and all three NITS were incorporated as documentation corrections, not code
repairs. Subsequent owner approvals cover the 25-ticket breakdown/publication, all O1–O7 answers
and O8 final implementation-spec/verification approval. These approvals do not certify implementation
or turn historical receipts into newly executed tests. Implementation is now requested; no production
ticket has been implemented by this documentation seed.
