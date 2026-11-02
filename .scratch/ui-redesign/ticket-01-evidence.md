# Ticket 01 — implementation evidence and bounded local closure

Status: **completed** after reviewed code `2f3024a701ac1ee0a9e79fdc77abdba868baf998` was locally
fast-forwarded into integration. See [current closure](#local-integration-and-bounded-closure-2026-11-02)
for fresh evidence, criterion mapping and retained failures/manual limits. The new docs-only closure
commit still needs parent Standards/Spec review before dependent writers start. Spec **Approved, not
Built**; no whole-app/accessibility/human acceptance or dev-merge permission.

All earlier sections below are chronological checkpoint history. Their review-pending/unclosed
wording, counts and ephemeral paths remain historical, not the current status or fresh merger receipts.

## Scope and adoption

Start/base: `2f978dcf4a3aef21f0d4a5438ba026db1b2e0fe2`; verified ancestor on
`feat/ui-redesign-01-calendar-shell` before edits. Merging the latest local integration tip before
final validation returned **Already up to date**. Owner checkout was read-only throughout.

- Aligned planning strip over the existing FullCalendar and task panel; task search, explicit
  task-attached Schedule and Session actions; independent panel toggles, persistent filter chip
  outside Totals, URL date/view/tag/task context and same-page Back/Forward restoration.
- Spacious 88px/hour default, 56/72 alternatives; density remains independent of 15/30/45/60-minute
  slot intervals. Totals start closed only without a valid existing visibility preference.
- Shared Refined Archive/Soft Stone/Porcelain light treatments, manual light/dark switching and
  existing dark/color palettes. Existing `theme` retains its dark/auto-color ownership. Missing or
  invalid individual preferences default without resetting valid neighboring/unknown settings.
  Valid legacy right-sidebar preferences are adopted. New task-view preference adoption is present;
  additional task-view compositions/selectors remain owned by tickets 04/06/07.
- All seven templates include shared light adoption and navigation; aliases remain unchanged.
  Preferences remain a working modal, now also included on AI Settings. Full `/settings` page
  replacement remains ticket 19. Token-only appearance updates retain editor drafts/focus and
  running file timers. Chart neutral labels/grids update without data/query/config writes or
  rebuilding editor DOM. Five grade colors and explicit inline user paints remain distinct/preserved.
- Existing session/timer/recurrence components were reused, not replaced. No model, schema,
  service, JSON API, CLI, provider behavior, dependency or frontend build change.

## TDD and automated validation

Read `.pi/skills/tdd/{SKILL,tests,mocking}.md` completely and used the approved Settings/adoption,
real daemon/template and Calendar workflow seams. Red-before-green receipts remain under
`/tmp/timetrace-ui-implementation.rZwJP1/ticket-01-red-*.log`: fresh defaults, existing adoption,
invalid neighbors, appearance persistence, panel/density controls, HTTP includes, query/history,
Preferences trap, Vim activation guard, search empty state, real global Escape/restore interaction
and chart neutral styling. The HTTP slice first failed all 11 cases for missing shared controls;
focused JS failures include undefined new behavior and the actual null-focus regression, not
source snapshots. Browser failures below supplied additional rendered red evidence.

Final commands used the isolated environment **before any TimeTrace Python import/command**:
`source /tmp/timetrace-ui-implementation.rZwJP1/ticket-01.env`.

| Command/check | Final result |
| --- | --- |
| `uv run python -P -m pytest -q tests/test_calendar_shell.py` | exit 0; 11 passed |
| `node --test tests/test_calendar_shell.cjs` | exit 0; 12 passed |
| `uv run python -P -m pytest -q` | exit 0; 352 passed, 85 existing warnings |
| `node --test tests/test_calendar_shell.cjs tests/test_calendar_task_registry.cjs tests/test_task_knowledge.cjs tests/test_tags_engine.js` | exit 0; 85 passed (73 existing + 12 new) |
| `node --check` each changed production JS + four manual browser probes + CJS regression | all 13 files exit 0 |
| `uv run ruff check tests/test_calendar_shell.py` | exit 0 |
| `uv run ruff format --check tests/test_calendar_shell.py` | exit 0 |
| `uv run ruff check .` | exit 1; exactly 18 baseline diagnostics (16 E501, 2 E741), existing invalid-noqa warning |
| Concise Ruff output compared with supplied baseline via `cmp` | exit 0; identical |
| `git diff --check` | exit 0 |

Exact final logs/exit ledger: execution-directory `ticket-01-final-*` files. No schema changes:
existing-DB migration testing is not applicable and was not run. Scratch startup did apply the
existing migration chain to a genuinely fresh DB through `0013_ai_data_scope`; health and actual
ORM/API/template interactions passed. Final `PRAGMA foreign_key_check` was empty. No personal
database copy was made. After the parent browser gates, scratch PID 472929 was stopped with SIGINT;
port 18141 closed, the PID disappeared and logs confirmed application shutdown/finished server.
Final timer status was stopped with no pending idle gap. Health/DB/shutdown receipts are in the
execution-directory `ticket-01-final-{health,timer,db-state,shutdown}` artifacts.

## Parent real-browser bridge — round 3 PASS

The implementer had no browser tool; the parent actually executed the supplied async probes via
existing Playwright MCP in fresh isolated Chromium contexts. This is runtime evidence, not an
inference from Node syntax or HTTP template strings. Contexts were closed after each run.

Scratch: `http://127.0.0.1:18141`, DB `/tmp/timetrace-ui01.3q5GhC/timetrace.db`; isolated timer/key
siblings. Imports resolved this worktree's source/venv. Only synthetic tasks/sessions/timer state;
no personal storage, credentials or provider calls. The parent's synthetic running timers were
stopped and its extra saved scheduling row was deleted in finally.

| Separate probe | Observed result |
| --- | --- |
| `tests/browser_calendar_density.js` | 12 density/slot cases; all eight sampled interior rows exactly 14/28/42/56, 18/36/54/72, 22/44/66/88px respectively |
| `tests/browser_calendar_shell_layout.js` | 12 width/theme cases; 390/768 horizontal navigation and secondary timer do not collapse/overlap; minimum sampled Vim contrast 10.079 |
| `tests/browser_shared_appearance.js` | 21 page/theme cases, 1,122 visible text/control observations; zero below sampled normal 4.5 / large 3 contrast thresholds; zero page errors |
| `tests/browser_chart_appearance.js` | Three light choices plus dark restoration; unchanged chart data/widget title; zero non-GET requests during appearance changes |
| Original fresh/palette/reload probe | 80 checks passed, zero page errors |
| Corrected scoped workflow probe | 18 checks passed, including history/query, Schedule attachment, Notes draft/focus, Preferences keyboard/trap/restoration and file timer retention; zero page errors |
| Original full adoption/aliases probe | 116 checks passed across four widths; existing/invalid/missing adoption and nine aliases/pages; zero page errors |
| Parent extra session Save/Cancel | Cancel: zero session writes. Ctrl+Enter Save: exactly one write, correct task UUID/literal notes and actual Calendar rendering; saved row cleaned up |
| Parent Calendar/Preferences sampling and 390px screenshot | All three light samples passed; screenshot visually confirmed useful viewport and separate navigation/timer rows |

Do not sum these overlapping suites into an invented unique assertion total. Authoritative parent
receipt: `/tmp/timetrace-ui-implementation.rZwJP1/ticket-01-parent-browser-receipt.md`.
Raw receipts: `ticket-01-browser-round3-{density,layout,shared-appearance,chart-appearance,fresh,workflow,adoption}-result.json`,
`ticket-01-browser-scheduling-round3-result.json`, `ticket-01-contrast-round3.json` in that directory.
Parent screenshot: `/tmp/pi-codemode-cac9fd3b6636613a.png`. External runtime artifacts are ephemeral;
the four reusable manual probes are committed under `tests/` and install no browser framework.

### Browser red evidence and repairs

- Initial Spacious rendered 99.5px/hour despite a 22px setting: inherited line height forced rows.
  First repair fixed Spacious; all-density probe then caught Compact's empty lane minimum (17 vs
  14px). Scoped line-box constraints now pass all twelve real combinations; labels/events remain intact.
- Capture-phase global Escape blurred the launcher after Preferences restored it. Node reproduced
  null focus; the global path now only blurs unchanged hidden focus. Full browser workflow passes.
- Narrow navigation shared an unshrinkable timer's row and collapsed; responsive full-width
  horizontal navigation plus secondary timer row now passes geometry and visual checks.
- Light adoption exposed unreadable dark fixed badges/cards and Stone header headings. Scoped
  bridges now include legacy surfaces, five grade families, readable neutral/blue labels and
  explicit `background` shorthand exclusions. Light Vim badge and cross-page samples pass.
- Original workflow helper expected a literal newline in the **pre-existing single-line Notes
  input**. Browser normalization happened before theme switching: actual before/after drafts
  matched. The corrected probe captures that actual value. Multiline Notes/ordinary Enter remains
  ticket 02; ticket 01 did not silently replace the popup or claim that requirement passed.

## Limits and gates

No confirmed browser issue remains in the sampled ticket-01 seams. Physical touch, screen readers,
other engines, unsampled zoom/reduced-motion, exhaustive user colors/data states and physical drag,
overlap/overnight gestures are not certified. Existing recurrence/move/resize tests passed, but are
not a substitute for every gesture. The bounded DOM scan excludes pixel-canvas text; chart neutral
configuration was checked through Chart's real public interface. Later tickets and final whole-app
verification still apply. Parent independent Standards/Spec review, integration and ticket closure
remain pending; no push, PR, release or dev merge was performed.

## Independent review disposition and fresh repair (2026-11-01)

Repair base is the exact reviewed implementation `4a723fc03ee2b47b40c89b56635060209a65f421`
on `feat/ui-redesign-01-review-fixes`, with integration `2f978dc` verified as ancestor. This is a
fresh scoped implementer; the original implementation remains separate history and unmerged.
Owner checkout and its environment were read-only. Ticket 01 remains **ready-for-agent**, unclosed;
this repair does not advance the graph or claim full-spec completion.

Separate review axes are retained: **Standards: two P2** (one behavior, one duplication heuristic);
**Spec: three P1 and two P2**. Both axes identified the same Habit lifecycle defect; that is one
actual bug, not two. The accepted assignment is five caller-visible behavior repairs plus one small
shared supported-view constant, not a redesign or a later-ticket implementation.

- Revision's visibility updater no longer reloads the active text/rating editor on Preferences
  Save, color reshuffle, initial application or irrelevant settings. Disabling Session Review still
  hides its tab and redirects an active Sessions view to Overview.
- The new Settings link is non-destructive on its active AI page and confirms dirty departure from
  initialized Preferences, Revision/day/task-review, task-detail and task/session editor owners.
  The parent explicitly confirmed these other callers are in scope because the old Settings action
  stayed in-page. Subtask/rating dialogs use the same small snapshot hook. AI Settings additionally
  guards other link departure and browser unload. Reverting is clean, successful Save checkpoints
  only its owner, failed Save stays dirty, Cancel/close discards that dialog explicitly, and explicit
  leave navigates without autosave/deletion. Modifier navigation can still open another tab.
- Populated AI provider names/instruction headings and light item-button foregrounds now participate
  in the existing light tokens. Provider/model/instruction strings stay inert. Dark CSS is unchanged.
- Calendar reads current preferences after held metadata and again for late settings application;
  a failed/late idle-toggle response cannot restore stale density/panels. Explicit URL date/view/tag/
  task precedence and history behavior remain in the existing Calendar boundary.
- Habit disposal removes registry entries; shared appearance updates skip valid absent/disposed
  Chart.js instances while still surfacing malformed-live-chart failures. Data/editor state is not
  rebuilt by appearance changes.
- `SUPPORTED_CALENDAR_VIEWS` is one frozen constant in already-shared `settings.js`, used by
  adoption, Calendar initialization and history restoration. HTTP tests verify include ordering.

No framework, dependency, model/schema, migration, service/API semantics or provider inference was
added. Browser Preferences, daemon AI behavior and provider saves remain separate. Existing explicit
Preferences Save may apply idle configuration through `/idle/toggle`; this is not a task/day/rating
mutation and was not removed to make a traffic assertion pass.

### Repair TDD and automation

Public seams are the approved Preferences/navigation/real-daemon editor, Calendar startup and real
chart/renderer seams, plus executable Node caller regressions. Red-before-green receipts under
`/tmp/timetrace-ui-implementation.rZwJP1/ticket-01-repair-red-{revision,navigation,startup,habits}.log`
retain the overwritten day draft, absent navigation guard, stale light snapshot and null-chart failure.
The parent measured populated-renderer RED before the CSS change (receipt below). The initial startup
harness lacked `restoreCalendarContext`; that harness error was corrected before recording the actual
stale-preference assertion failure. An interim existing Node fixture lacked the newly shared settings
include; it now loads the real include before Calendar, matching the daemon's template order.

Seven new Node caller cases (focused suite 12 → 19) cover actual Preferences Save/reshuffle/application,
dirty navigation/revert, delayed successful/failed metadata, Habit selection/disposal/recreation,
supported view adoption/history, failed Save/successful Save with failed refresh owner independence,
and late failed idle-toggle preferences. Six dependency-free manual browser probes add populated AI,
real Revision grade/custom-score/dismissal, independent dirty Settings saves, existing task/session
callers, held metadata and real Chart.js lifecycle coverage. No browser runner dependency was installed.

Current complete automated check receipts are execution-directory `ticket-01-repair-final-*` files:
352 Python tests passed / 85 existing SQLite warnings; all Node regressions passed 93/93; 19 focused
Calendar-shell Node tests, 72 task-knowledge caller tests and 11 HTTP/template tests passed. All 21 changed production/test JS/CJS and
new manual probes passed syntax. Scoped Python Ruff/format and whitespace checks passed. Repository
Ruff retains the identical 18 baseline diagnostics (16 E501, two E741), plus its existing invalid-noqa
warning; concise diagnostic comparison with `baseline-results/ruff-concise.stdout` passed. No unrelated
autofix was performed. These checks do not replace the independent review gates.

### Parent browser gate and final narrow focus repair

Actual parent execution receipt:
`/tmp/timetrace-ui-implementation.rZwJP1/ticket-01-repair-parent-browser-receipt.md`.
Parent used existing Playwright MCP, inspected each probe, and created/closed fresh Chromium contexts.
Scratch `http://127.0.0.1:18142`, PID 501081, DB
`/tmp/timetrace-ui01-repair.GHWSFT/timetrace.db`; own source/venv verified. Real synthetic public API
fixtures only, except explicit fake catalog/conversation/instruction responses and deliberate failed
metadata/settings responses. No provider activation, Test/connectivity, inference, personal storage,
real credentials or paid calls. Fixture cleanup is separate from observed page-triggered traffic.

| New regression | Parent observed result |
| --- | --- |
| Populated AI RED | All three lights: provider names 1.222–1.233:1; instruction headings 1.349–1.361:1 |
| Populated AI final GREEN | 13 samples per choice; minima Refined 11.1216, Stone 10.0794, Porcelain 11.0384; inert strings; zero page errors/writes |
| Retained dark comparison | Exactly unchanged: provider metadata and three item buttons remain 3.989858597:1; existing below-4.5 limitation, not whole-dark compliance |
| Revision real Preferences Save | Literal day text, grade 5, custom score 4 and dismissal retained; cancel/explicit leave work; domain/navigation writes zero |
| AI Settings dirty navigation | Self-link no reload/prompt; cancel/leave, clean/reverted/successful/failed saves correct; behavior/provider owners remain independent |
| Other Settings callers | Detail text/attachment/revert, task popup, session Notes/UUID attachment and Preferences Open AI Settings protected; no writes/errors |
| Held metadata startup | Both success and 503 preserve Dark/Porcelain, 56 density/14px slots, visible Totals, persisted preferences and URL date/view/tag |
| Real Habit Chart.js lifecycle | Numeric goal: 3 charts → second selection: 2 → deselect: 0 → reselect: 3; appearance keeps data/editor draft; no writes/errors |

The Settings-caller probe passed initially, then an **uninstrumented** run failed its combined
session note/attachment assertion. Its exact data cause remains **inconclusive**, not silently erased
by subsequent passes. Four enriched immediate runs independently exposed a confirmed focus bug:
existing 50ms create autofocus moved Notes focus to task search after canceled Settings confirmation.
Parent authorized a narrow fix, not a wait/sleep masking the behavior and not ticket-02 editing/layout.
The controlled-timer caller test first reproduced focus theft, then passed after the delayed initial
focus yielded to interaction, moved focus, closed popup and superseded popup generations. Normal
create-search/edit-Notes initialization remains tested. Red/green receipts:
`ticket-01-repair-{red,green}-session-focus.log`.

After that code repair, **four immediate enriched browser runs**, without arbitrary sleep/readiness
workarounds, retained Notes focus before/after canceled departure, literal Notes and task UUID,
all four caller confirmations, zero writes/errors. Receipts `ticket-01-repair-callers-focus-fixed-run1.json`
through `run4.json`. The normal scoped workflow passed 18 checks without a readiness workaround;
Revision and populated AI were rerun after the focus repair and passed. The earlier uninstrumented
failure remains in `ticket-01-repair-browser_dirty_settings_callers-round2.json`.

Original reusable matrix, all against 18142: 12 exact density/slot cases; 12 layout cases; 21 shared
page/theme cases with 1,113 sampled observations and no issues; three chart choices plus dark restore
with unchanged draft/data and zero writes; 80 fresh checks; 116 adoption/alias checks; 18 scoped
workflow checks. Do not sum overlapping suites into a unique assertion total. Other original suites
ran before the final isolated focus fix; the relevant caller/workflow/Revision/AI checks reran after it.
Raw receipts use the `ticket-01-repair-reuse-*-result.json` names and
`ticket-01-repair-final-workflow-no-readiness-workaround.json` in the execution directory.

Two helper failures are also retained rather than hidden: Revision originally counted the existing
explicit idle configuration apply as a domain write; the assertion now separates `/idle/toggle`
from task/review/rating writes and requires zero departure writes. The initial reused workflow
searched for a different synthetic fixture title and hid its Schedule button; correcting that test
fixture restored the existing flow. Neither required an idle-policy or product-search redesign.

Latest integration `2f978dc` merged before final checks: **Already up to date**. Final full Python
352/85 warnings and all Node 93 (including the new controlled-timer caller) passed. No schema changes
or existing-DB copy/migration experiments were made; the fresh scratch daemon applied the existing
chain through `0013_ai_data_scope`, and its foreign-key check was empty. Final scratch cleanup and
commit are recorded below after shutdown verification. Independent Standards/Spec review of the
repair **and combined ticket 01**, parent integration/closure and all later graph gates remain required.
Physical touch, screen readers, other engines, unsampled zoom/reduced-motion/exhaustive colors and
all gestures remain uncertified; the retained dark contrast and inconclusive original failure stay
explicitly disclosed.

Final cleanup: public-API shell fixture DELETE returned 204; synthetic timers are stopped with no
pending idle gap; idle detection was restored false before shutdown. PID 501081 received SIGINT,
disappeared, and port 18142 closed. Daemon logs confirm application shutdown/finished process.
Receipts: `ticket-01-repair-final-{timer.json,db-state.log,shutdown.log}`. Final checks after the last
source edit/shutdown returned Python 0, Node 0, syntax 0 (21 files), scoped Ruff 0, format 0,
repository Ruff 1 (unchanged baseline), exact baseline comparison 0 and diff-check 0. The single
focused repair commit uses the authorized subject
`fix(ui): preserve drafts and appearance lifecycle [ui-redesign/01]`; its exact SHA is in the
external delivery report, avoiding a self-referential commit hash here. No staged files are left
at delivery. No push, PR, integration merge or dev merge was performed by this repair worker.

## Fresh draft-ownership lifecycle repair (2026-11-01)

**Start:** `054d9373a199e862811bb99d2e2b75c1dc9349c1`, clean branch
`feat/ui-redesign-01-draft-ownership`. Integration remains ancestor
`2f978dcf4a3aef21f0d4a5438ba026db1b2e0fe2`; latest integration merge reports **Already up to date**.
Ticket 01 remains ready-for-agent/unclosed. Fresh independent per-commit **and combined01**
Standards/Spec review and a parent merger are still required. This is not review acceptance or merge
permission, nor completion of any other UI ticket.

The two fresh reports were read completely. Their separate axes are preserved: Standards amendment
one P1/one P2, combined two P1/one P2; Spec amendment/combined one P1/one P2, overlapping defects,
not duplicate independent bugs. This repair addresses the source-confirmed initialization, alternate
writer and missing-owner findings only. Previous Revision Preferences, Calendar startup, chart disposal,
light foregrounds, self-link/independent saves and narrow session-focus repairs remain intact.

### Ownership changes and audit

- Day text/grade checkpoint immediately when initialized, before rating definitions; custom-rating
  controls own a separate baseline. Initial unknown Save does not write, failed loads show retry state,
  and superseded reads cannot initialize another date. Same-day failed-summary retry and held rating
  hydration preserve already-initialized text/rating drafts instead of absorbing them.
- Successful day POST checkpoints text/grade immediately, including Dismiss, independently of summary
  refresh. Each successful custom-rating POST checkpoints only that input; partial failure leaves
  the failed rating dirty. No review/dismissal/required-rating/exemption/completion/scheduling policy changes.
- AI behavior fields register before initial GET and keep intervening typing through success/503/retry.
  Unknown Save does not send defaults. Accepted instructions/conflict reload update only a known-clean
  instruction field; unrelated behavior/provider drafts and already-unsaved instruction text survive.
  Server hash checks, explicit approval, inert text and domain services are unchanged.
- Habit definitions and structured/SQL widget forms register at initialized open. Capabilities failure
  keeps the unknown widget editor closed with an honest reopen/retry message. SQL metadata checkpoints
  only clean column inputs, retains known saved choices and never consumes title edits.
- The owner audit additionally found explicit-Save Add Status, inline AI proposal PATCH editors,
  standing-instruction proposal text and the unsent composer. Parent explicitly authorized minimal hooks
  at those existing owners. Drawer close retains protection; failed send restores text without replacing
  concurrently typed composer text. Successful inline PATCH checkpoints submitted fields before refresh.
- Full owner/exclusion inventory is in `docs/development.md`: existing task/session/detail/subtask,
  Revision review/definition, Preferences, AI behavior/provider and drawer forms remain distinct.
  View/date/search/filter/export/chart/tab/batch selections are read/navigation controls; status rows and
  Habit log amounts already write on change. Blocking name prompts cannot expose Settings mid-edit.
  No routing framework, persisted draft store, schema/API/product-policy change or future layout work.

### Caller-visible TDD and process limits

New `tests/test_draft_ownership.cjs` runs real feature handlers and the real API client with synthetic
held/failed HTTP boundaries, not merely imagined helper snapshots. Final **22 added tests** cover
held/503 day definitions and AI settings, unknown Save, instruction accept/conflict and field ownership,
Habit new/edit/revert/Cancel/save, structured/SQL widget initialization and metadata, Add Status,
closed-drawer proposal/composer edits, failed/successful PATCH, Dismiss/failed refresh, partial rating
Save, failed-summary retry and capability failure/reopen.

Raw receipts are in `/tmp/timetrace-draft-ownership.zAKOeP/`: `day-red.log` (two intended failures),
`ai-read-red.log` (two), `instruction-red.log` (three), `habit-red.log` (two), `widget-red.log` (two),
`additional-red.log` (three owner callers), `inline-red.log` (one), `partial-day-red.log` (one),
`retry-day-red.log` (one), `sql-preview-red.log` (one), followed by green logs and final aggregate checks.
The first all-CJS run also caught a new helper compatibility issue with root-ID-less DOM fixtures;
corrected before final green. Those failed receipts remain retained.

**Chronology deviation:** the paired Day Dismiss checkpoint was implemented alongside initial Day
ownership repair before its separate Dismiss regression was added. There is **no claimed separate
pre-green Dismiss RED**. Its later automated regression and actual parent browser case passed;
this does not retroactively certify a test-first sequence for that subcase. Capability-failure and
held same-owner hydration supplemental cases were also added after their paired lifecycle fixes;
only the explicit red receipts above are claimed as pre-green evidence.

### Parent browser gate: actual execution, not inferred from source

Parent receipt (including final re-gate):
`/tmp/timetrace-ui-implementation.rZwJP1/draft-ownership-parent-browser-receipt.md`.
Own scratch daemon `http://127.0.0.1:18143`; NEW DB
`/tmp/timetrace-draft-ownership.zAKOeP/timetrace.db`; uv/server PIDs `530766`/`530771`.
Own `.venv` and source imports verified; tracing/idle off, no personal DB/storage/credentials/provider
Test/Activate/inference/paid calls. Fresh DB applied existing migrations through `0013_ai_data_scope`.

Parent inspected and actually executed these dependency-free probes with fresh Chromium contexts:

| Probe | Observed result |
| --- | --- |
| `browser_draft_initialization.js` | Held day definitions success and 503 retain Notes/grade; canceled Settings writes zero. Real Dismiss POST + public summary readback persists text/grade/skipped; following refresh 503 cleans text only, independently dirty custom rating stays protected and reversion is clean. |
| `browser_ai_draft_ownership.js` | Held/503/retry keeps instruction/tag drafts; unknown Save writes zero; server-value reversion clean. Fake accept/409 boundaries preserve separate owners and unsaved instructions; clean acceptance clean. |
| `browser_editor_draft_ownership.js` | Actual Habit new/edit cancel/revert and real PUT/readback; widget held capabilities, real structured POST/readback, optional SQL fake preview/dirty cancel, Add Status draft/Cancel; no departure writes/errors. |
| `browser_drawer_draft_ownership.js` | Fake conversation/batch/PATCH/503-message boundaries: closed-drawer proposal edits guarded, failed PATCH dirty/success clean, unsent/concurrent/failed-send composer text protected; no inference. |
| `browser_draft_retry_hydration.js` | Failed-summary + explicit Save retry preserves existing Notes/custom rating; held same-owner definitions preserve intervening rating, zero writes/errors. Fake saved SQL/capabilities/schema/SELECT: capability 503/reopen and repeated held preview preserve known columns, title dirty then reverted clean. |

Original editor probe failed **only its helper**: X and Cancel both matched `closeWidgetBuilder()`.
Parent corrected the selector to semantic footer Cancel; the exact correction is in committed probe.
Raw failure is retained; no production change was made for that helper error. Parent reran complete
initialization/editor probes after final Day/widget fixes, both PASS. AI/drawer initial passes are not
misrepresented as reruns. Raw first/final files use `draft-ownership-browser_*-round1.json`,
`draft-ownership-editor-cancel-scoped-result.json`, and `draft-ownership-final-browser_*.json` in the
execution directory. Synthetic definition/Habit/dashboard fixtures were deleted via public APIs;
a synthetic today review remains only in the disposable DB because there is no delete-review API.

Parent also reused six existing suites, all PASS: Revision Preferences, dirty AI Settings, task-detail/
task/session/Preferences Settings callers (Notes focus retained), delayed Calendar success/503,
real Habit chart disposal/recreation, and chart appearance. Revision explicit Preferences Save's
existing `/idle/toggle` configuration apply is counted separately: domain/navigation writes zero,
not falsely zero total traffic. No overlapping suites are summed into invented unique assertions.

### Final checks / remaining gates

Full Python **352 passed, 85 existing warnings**, exit 0; all Node **115 passed** (93 existing +22
new), exit 0. All **39 combined-range JS/CJS files** (including these 15 changed/new scripts),
**41 focused Node** and **11 focused HTTP/template Python** tests, scoped Ruff/format checks on
`tests/test_calendar_shell.py`, and whitespace checks passed. No Python source changed, so changed-Python Ruff/format is not applicable;
repository Ruff exits 1 with exactly the existing 18 diagnostics (16 E501/two E741) and old invalid-noqa
warning. Exact concise baseline comparison exits 0; no unrelated autofix. Final logs and daemon logs
are under the scratch directory; exact shutdown/commit SHA/status are in the external delivery report.

Physical touch, screen readers, other engines, unsampled zoom/reduced-motion/exhaustive gestures/colors
remain unverified. Unchanged retained-dark contrast 3.98986:1 and the exact inconclusive cause of the
older uninstrumented session assertion remain disclosed; the separately confirmed focus race was
previously fixed and still passes. Independent review is required before integration/closure. One
focused authorized repair commit only; no push, PR, dev merge or integration-branch write.

## Fresh guard-edge repair from 60099fb (2026-11-02)

Start: `60099fbcb8b8ec4e7f70ed3bea5394135a2e2a05`, clean own branch
`feat/ui-redesign-01-guard-edge-cases`. Integration remains ancestor `2f978dc`; own-branch
`git merge --ff-only feat/ui-redesign-integration` returned **Already up to date** after the parent
browser gate. Owner checkout remained read-only. Ticket01 stays **ready-for-agent/unclosed**;
independent amendment and combined01 Standards/Spec review, parent merger/integration and closure
remain required. This is only the fresh scoped repair, not completion of the 25-ticket spec.

### Accepted findings and minimal changes

Separate source-review axes are preserved: Standards combined **one P1 + one P2 contract + one P2
heuristic** (amendment heuristic only); Spec combined **three P1**, including one amendment P1.
Task-detail initialization is a duplicate finding across axes, not two distinct bugs.

- Instruction acceptance/authoritative409 reload now advances baseline C while retaining dirty B.
  Reverting to obsolete A still guards; persisted C is clean. Other behavior/provider drafts,
  explicit approval, hashes and inert-text/backend semantics are unchanged.
- Task properties use the approved native fieldset-gating alternative: editing and keyboard/caller
  Save are unavailable until first successful tree hydration. Loading/failure explains the state;
  existing **Retry refresh** is usable. First success initializes ownership even with preserveEdits,
  and subsequent refreshes retain initialized drafts. No unloaded default write or detail-layout rewrite.
- Day's retained tab explicitly opts into hidden-owner checks; hidden Notes or grade-only drafts
  guard Settings, survive canceled departure and browser Back/re-entry. Reversion stays clean.
  Explicit modal Cancel remains discard; retained closed-drawer protection is unchanged.
- Task/session review text checkpoints immediately after its successful POST/PUT, independently of
  later ratings. Each successful rating checkpoints only its input; failed/pending ratings and
  edits arriving during writes remain dirty. Task refresh retains initialized edits; Session stays
  open if fresh edits remain. All three submitCustomRatings callers were inspected; submission is
  limited to that target-type's existing container, never another mounted form. No required-rating,
  exemption, completion or schedule policy, schema or API changes. Existing rating validation policy
  is not redesigned; full simultaneous Day/history integration remains ticket15.
- The accepted capability-loading duplicate is one small shared loading/error/supersession helper,
  preserving the generation check at each caller. No registry/plugin/refactor expansion.

### Fresh RED → GREEN and first failures (not reconstructed history)

Persistent receipt root:
`/home/user/.local/state/timetrace-ui-redesign/evidence/guard-edge-repair/` (`R` below).
New caller-visible tests exercise real feature handlers and api_client.js against explicit HTTP fakes.
Eight added Node cases (22→30 ownership; all Node115→123) cover instruction accept/conflict A/B/C,
held/failing/retried tree, hidden Day Notes/grade, task and session partial writes/concurrent input/retry.

Actual pre-fix assertion failures: `R/ai-red.log` (obsolete A false-clean, two),
`R/task-red-corrected.log` (unknown Save writes, two), `R/hidden-red.log` (hidden drafts bypass, two),
`R/task-review-red.log` and `R/session-review-red.log` (persisted text/rating wrongly dirty).
Green receipts: `ai-green.log`, `task-green.log`, `hidden-green.log`, `task-review-green.log`,
`ownership-green.log`; tiny helper review-stage recheck `caps-refactor-green.log`.
The first task harness lacked utils.js and errored before the assertion (`task-red.log`); the corrected
harness then produced the intended pre-fix RED. No product correction or fabricated RED for that error.
Old paired Dismiss/supplemental-case chronology limitations above remain unchanged.

The first full Node run (`full-node.log`) had two fixture compatibility failures: one old minimal
modal double omitted native dataset; another typed into task details before initializing the newly
gated editor. Fixtures now model dataset and initialize via real loadTaskDetailTree before editing.
`full-node-corrected.log` passes all123; no source workaround/disabled assertion. The first new browser
probe timed out looking for a nonexistent Day tab button (`browser-guard-first.json`); the probe
now uses actual browser Back from Overview to #day (`first-browser-classification.txt`). The full
corrected eight-case execution passed. These failures remain available, not silently relabeled PASS.

### Genuine isolated browser execution and parent gate

Own NEW DB `/tmp/timetrace-guard-edge.2TLjQy/timetrace.db`, own source/.venv verified before imports;
server18153/PID53127. Absolute DB env preceded all app imports/commands/tests. Fresh startup migrated
through0013; no personal DB/copies/keys/providers/inference/paid calls. Tracing disabled; provider
catalog faked in every runner-created context; all data synthetic. Existing installed native runner
`/home/user/.local/state/timetrace-ui-redesign/run-browser-probe.cjs` was read before use; no browser
dependency/framework installed. Each probe owns fresh browser contexts; API fixture cleanup uses
existing delete endpoints. The synthetic Day review remains only because no delete-review API exists.

`browser-guard-corrected.json`: all eight cases passed asserted paths. Task/session cases use **real**
text/first-rating/retry writes and public API readback; only second-rating503 is fake. They check
pending/failing drafts, own-target posts and unchanged task status/estimate. Each deliberately rejected
Save emits **exactly one expected synthetic503 pageerror**, explicitly recorded; the other six cases
have none. This is not a zero-pageerror claim or polished review-failure UI delivery (tickets16/17).

All15 previously committed probes were actually rerun (`browser-matrix-commands.json`, per-probe
JSON/stdout/stderr). Ownership initialization, retries, hidden drawer, modal Cancel, independent
provider/behavior, real Habit/widget Save/readbacks, failed capabilities/reopen/late SQL columns,
Calendar densities/layout, chart lifecycle, focus/UUID retention and preference guards pass asserted
paths. Parent independently reran all eight new cases (`parent-browser-guard.json`) and inspected
source/probe diffs and other receipts, then **approved the browser gate before commit**.

Precise probe corrections do not erase the earlier fresh-verifier failures:

- Settings callers record all mutation traffic. Only exact dashboard-startup
  `POST /idle/toggle {"enabled":true}` is allowed in its observed startup phase; canceled departures
  must produce zero writes. One explicit additional run reset scratch idle false before starting:
  `browser-traffic-startup-false.json` records that sole startup write, zero unexpected/departure
  writes, four confirmations, retained Notes focus and exact task UUID. The first matrix execution
  already had matching idle state and recorded no writes; these are distinct environment cases,
  not a retry-until-green or removed idle side effect.
- Shared appearance retains immediate diagnostic samples (21 below-threshold observations this run).
  Assertions wait actual finite animations plus rendering frames, with bounded eight batches and
  two-second per-batch deadline, not blind sleep, disabled CSS or lower thresholds. **21 settled
  cases /1119 samples /0 settled issues /0 pageerrors**; observed readiness19.6–178.9ms. Original
 60099fb immediate failures remain failures at `evidence/fresh-verification/run.zoEyTE/`.
  Neither transient nor all-frame contrast is certified.
- Populated AI: three light choices pass13 samples each (minimum11.1216/10.0794/11.0384);
  unchanged dark metadata +three buttons remain **3.989858597309983:1**, four reported issues.
  Returned runner status is not whole-app/accessibility PASS.

### Full checks and remaining gates

Fresh full Python **352 passed/85 existing SQLite warnings** (`full-pytest.log`); all Node
**123 passed** (`full-node-corrected.log`); all **40 combined-range JS/CJS** syntax checks passed
(`syntax-combined.txt`), as did whitespace. Repository Ruff exits1 with the same18 diagnostics
(16E501/twoE741) and old invalid-noqa warning; stdout/stderr byte comparisons with recovered
60099fb fresh receipts both exit0. No Python changed, so changed-Python format/scoped Ruff is N/A.
Final post-documentation/merge rechecks, exact repair commit SHA, clean index/tracked state,
DB/timer audit and PID/port shutdown are in the external delivery report and final receipts.

Physical touch/screen reader/other engines/exhaustive gestures, unsampled zoom/reduced-motion/colors,
full accessibility and human visual acceptance remain unverified. No personal existing-DB migration
copy was used (no schema change); no real provider/catalog discovery/Test/activation/inference.
Earlier lost /tmp evidence stays historical only. Parent fresh two-axis amendment and combined01
review remains mandatory; no ticket closure, later feature, integration/dev merge, push or PR.

Final own-branch post-gate/merge/doc rechecks: Python352/85warnings, Node123, syntax40 and
`git diff --check` pass. Cached final Ruff omitted the old invalid-noqa warning (stderr comparison1);
explicit `ruff check . --no-cache --output-format concise` restores it, and stdout+stderr comparisons
both0 with the original18-diagnostic baseline. No diagnostic was suppressed or autofixed.
Cleanup verified all task/session/Habit/rating/provider/conversation/chat/draft/instruction-proposal
fixture counts0; one synthetic Day review remains, no delete API. Migration version0013 and foreign
key check empty. Timer stopped/no pending idle gap, idle restoredfalse; no real provider
Test/activate/message requests in daemon audit. Owned server53127 and shell53122 absent after SIGINT,
port18153closed, normal application shutdown (`R/shutdown.json`, `db-final.json`, `daemon.log`).
One focused repair commit follows; exact SHA belongs in the external report, not a self-reference.

## Owner-transition repair and same-tool recovery (2026-11-02)

The two accepted combined01 P1 findings from reviewed06c5a86 are repaired, not a new feature slice:

- Session → +Task retains the actual initialized Session DOM/baseline while hidden, including the
  successful Task write → awaited metadata refresh gap. Nested Cancel resumes it; successful Task
  creation attaches the new Task without replacing Session Notes/times/tags. No implicit Session
  write. Explicit Session Cancel/unrelated Session open consumes retention; reverted/clean and
  standalone Cancel remain clean. Resuming the actual editor also preserves an existing edit ID,
  attachment and original guard baseline rather than rebuilding a falsely clean create form.
- Day Save/Dismiss continuations validate captured editor identity and selected date before
  checkpointing, rating submission/continuation or refresh. A→B→A is not the old editor; unrelated
  same-day reads do not invalidate legitimate successful writer checkpoints. Dismiss validates again
  after asynchronous confirmation. Already committed A writes remain committed, without rollback/retry.
  The optional rating-continuation predicate preserves the existing task/session caller defaults.
- Parent explicitly authorized one additional narrow lifecycle repair from positive browser evidence:
  existing Task create/edit50ms focus/select callbacks stole focus from already-edited Tags. Both
  entrypoints now focus/select immediately after visible initialization, with no stale callback to
  act on interaction, closure or reopening. No generic modal framework or ticket02/04 layout work.
  This observed race is **not proven to have caused** the earlier opaque Task-readback mismatch below.

### Preserved first failures / TDD / recovery boundary

Persistent root `R=/home/user/.local/state/timetrace-ui-redesign/evidence/owner-transitions-repair/`.
Original worker was interrupted by a harness update, not normally completed: HEAD06c5a86 plus six
tracked edits and one untracked probe were preserved byte-for-byte and continued, without reset/stash.
Original daemon was already dead; no retrospective normal-shutdown claim. All new receipts are `R/recovery/`.

Original actual pre-fix caller REDs remain `R/session-red.log` (3 Notes/time/tag-only handoffs) and
`R/day-red.log` (Save and Dismiss different editor); original green47/fullNode140 are preliminary
pre-interruption measurements, not final evidence. Additional lifecycle cases were supplemental,
not invented individual test-first cycles. `R/ownership-first-full.log` also records an initial failed
metadata-refresh fixture case; later original greens remain available. Recovery's fresh Task-focus
TDD is `recovery/task-focus-red.log` (6 intended assertions fail), then `task-focus-green.log` (6 pass).
Final focused ownership53/fullNode146 include23 cases added to the prior30/123 baselines.

Original browser attempt1 timed out: route glob missed query-bearing task metadata GET, no complete
receipt/no inferred passes. Attempt2 failed returning a held Save promise directly through Playwright:
`Resulting promise was garbage collected`. Recovery reproduced it unchanged, tracing completed HTTP,
no navigation/pageerrors, retained dirty Session, and **resolved actual saveTask/metadata promises**.
An explicit async evaluate wrapper awaiting that same Save and returning primitive true passes.
Classified bridge/DevTools result-observation boundary, not an unresolved app Save; exact Chromium GC
internals are unproven. Diagnostic/control/negative receipts and detailed classification are retained.

`recovery/browser-owner-corrected.json` then failed the opaque `Real Task created` readback assertion.
That first message omitted body details; HTTP201/200/no daemon exception do not explain the mismatch.
Focused diagnostic, hardened13-case suite and parent independent run subsequently pass exact POST/GET
identity/title/tags checks, but the **original mismatch stays undiagnosed**, not dismissed as helper-only
or declared fixed by the timer change. One bounded pre-fix focus/input/key/request/readback timeline
proved the separate Task focus theft; no blind sleep, CSS disable, ignored error or lowered assertion.

### Genuine browser, checks and gate

NEW `/tmp/timetrace-owner-recovery.NVvM4E/timetrace.db`, port18155, own source/.venv verified before
imports/tests/runtime; tracing off, credentials unset, synthetic/fake boundaries only. No personal
DB/copy/keys, real provider catalog/Test/activation/inference/paid calls or new dependency/framework.
`recovery/browser-owner-focus-final.json` is ONE post-focus-change13-case native Chromium execution:
Notes/time/tags-only handoffs, keyboard +/actual button, nested Save held/503 metadata gaps and real
Task readbacks, create/edit focus lifecycle, Save/Dismiss B Notes/grade and pending Day/rating writes.
Actual Settings link focus/Enter target/exact discard-confirm message are asserted. Two focus cases
explicitly advance the browser clock100ms at the timer seam (not a readiness sleep); Node additionally
covers roundtrip dates, confirmation, changed input before read, same-day refresh and failure/reopen.
All13 asserted paths pass,0pageerrors; no claim every Node scenario was separately browser exercised.

Parent independently ran all13 against verified NEWDB (`recovery/parent-owner-final.json`) and reran
Settings callers and Revision Preferences **after** the focus change: draft/attachment/Notes-focus
retention, no domain/departure writes/errors. Parent inspected exact source/probe hashes and approved
browser/one-commit gate. Source/tests remained unchanged after approval. Prior15 reused returned suites
(including8 guard-edge cases) were run **before** final focus repair; not relabeled post-focus checks.
The two partial-review guard cases each intentionally expose ONE fake503 pageerror; no blanket
zero-error claim or ticket16/17 polished error-UI delivery.

Reused shared-appearance first failed its missing-task prerequisite. Seeded execution then **FAILS**
settled dashboard fixture-title contrast4.33:1 in3light themes (auto #0284c7/#111827), not animation.
Read-only82fabdc/2f978dc/06c5a86 ancestry proves identical palette/color helpers/card text path; the
new light bridge exempts Task-card descendants. This is a pre-delivery color-helper hole, **not** a
baseline-browser proof or a visual PASS. No fixture recoloring/color fix bundled. Parent records
04/25 follow-up coverage separately. Populated AI also retains four dark3.98986:1 observations.
Transient/all-frame contrast, whole accessibility, physical touch, screen readers, other engines,
unsampled zoom/reduced motion/colors and exhaustive gestures remain unverified.

Final pre-documentation checks: Python352/85 existing warnings, Node146, ownership53, all42combined
JS/CJS syntax and diffcheck pass. Full Ruff exits1 with18baseline diagnostics +old invalid-noqa warning;
stdout/stderr byte comparisons with fresh fixed-base receipt both0 (`*focus-final*` logs).
No Python/schema/API changes; Python format/scoped lint and personal existing-DB migration N/A.
Post-documentation/own-branch ancestry rechecks, exact repair SHA, final fixture/timer audit and owned
PID/socket shutdown are recorded in the authoritative external recovery worker report. Independent
fresh amendment+combined01 Standards/Spec reviews and fresh merger still required. No integration/dev
merge, push/PR, ticket01 closure, later-ticket implementation or whole-spec completion claimed.

## Local integration and bounded closure (2026-11-02)

**Current state:** ticket01 **completed** per authorized local lifecycle, manual acceptance separately
limited below. Spec remains **Approved, not Built**. Tickets02–24 remain ready subject to graph;
25 is not done. Newly unblocked **02,03,04,10,11,15,18,19,21,24**; first parallel02/04/11 only after
parent fresh Standards/Spec review of the documentation-only closure commit. No dependent writers
started by this merger, no delegation/push/PR/dev merge/release or whole-delivery claim.

### Identity and review

Fresh merger owned clean `feat/ui-redesign-integration` at
`2f978dcf4a3aef21f0d4a5438ba026db1b2e0fe2`; verified clean read-only source worktree/ref at
`2f3024a701ac1ee0a9e79fdc77abdba868baf998` and ancestor relationship. Actual
`git merge --ff-only feat/ui-redesign-01-owner-transitions` reached **exactly** reviewed code tip,
zero merge commits. Reviewed tree `5406346c7f5f42085347c4e0acf627321fac2d70`;
combined5472-line diff SHA256 `4fe9da485115fe07c0befd65be3db74f95e11077667ca8675e3bc3cc2e1520ba`
independently matches pinned review artifacts. No source changes in integration/closure.

Final amendment `06c5a86...2f3024a` **and** combined01 `2f978dc...2f3024a` independently received
Standards **0 documented breaches / 0 smells**, Spec **0 P0/P1/P2, OK with notes**. Earlier four
code commits and their repairs also had independent reviews; failed earlier dispositions remain
above/in prior reports. No confirmed review finding remains unresolved. These code reviews do not
approve this new closure documentation, whole delivery, accessibility or human acceptance.

Persistent external root `R=/home/user/.local/state/timetrace-ui-redesign`:

- Final review axes: `R/evidence/prior-reviews/2f3024a-standards.md`, `2f3024a-spec.md`;
  disposition `R/review-ticket-01-owner-transitions/summary.md`; worker `2f3024a-worker.md`.
- Prior same-code parent gate: `R/evidence/owner-transitions-repair/recovery/parent-browser-gate.md`,
  `parent-owner-final.json` (13 cases), `parent-browser_dirty_settings_callers.json`,
  `parent-browser_revision_preferences.json`. Not rerun/relabelled as merger evidence.
- Fresh integration root `E=R/evidence/integrated-ticket-01/`: authoritative `merger-report.md`,
  `ancestry-before.txt`, `fast-forward.txt`, `code-identity.txt`, `reviewed-combined.diff/.sha256`,
  `source-runtime.txt`, full raw check logs and runtime receipts below. Machine-local links;
  tracked summary here remains portable. Lost original `/tmp` raw evidence is unavailable, not recreated.

### Acceptance-criterion evidence map (same order as ticket)

| Criterion | Implemented/automated seam | Runtime evidence and boundary |
| --- | --- | --- |
| 1. Aligned shell, planning/filter/density/totals adoption | `dashboard.html`, `calendar.js`, `sidebar_totals.js`, `settings.js`; `test_calendar_shell.cjs/.py` | Fresh `browser-layout.json`:12 width/theme cases; `browser-basic-workflow-corrected.json`: fresh88 density, persistent hashtag chip/history, attached Session keyboard Save/readback/render. Earlier density probe12 exact slot combinations is retained prior evidence, not freshly rerun. |
| 2. Three light themes, shared dark, selective per-browser adoption | Shared `appearance.css`/navbar/settings; Node fresh/existing/invalid/missing/reload fixtures in `test_calendar_shell.cjs` | Fresh12 light layout cases and manual-dark/timer-navigation smoke; prior same-code adoption/appearance receipts retained with known failures. No color-compliance certification. |
| 3. Retained Calendar/session/timer workflows | Existing FullCalendar/session/timer/recurrence contracts unchanged; full Python/Node regression suites | Fresh native Day/3-day/Week, Back/Forward, Escape no-write, Ctrl+Enter exactly one Session write, exact UUID/Notes/tags/3600s/render; timer start/status, theme/page retention, stop/Session readback. Physical drag/overlap/overnight/touch/exhaustive gestures not freshly exercised/certified; existing paths retained, broad gestures remain manual. |
| 4. Aliases/direct/history/dirty/old-new coexistence | Seven template includes, Node caller ownership/init/partial-write/keyboard regressions; reviewed source | Fresh10 route/alias browser loads and history. Prior parent's exact-code13-case owner gate plus two affected callers assert actual drafts, key focus/target, exact dialog and real writes/readbacks. `/settings` replacement remains ticket19; existing `/settings/ai` retained. |
| 5. Adoption and representative narrow/light/dark real app | Source-named adoption regressions and HTTP/template tests | Fresh390/768/1024/1440 three-light geometry/Vim badge sampling;390px browser scheduling/dark/navigation/timer smoke. Not every theme×page×state or other engine/human visual acceptance. |
| 6. Shared safety/regressions/honest unrun record | Exact pinned code reviews and full checks below; separate synthetic/fake runtime | Fresh isolation, migration/health/FK, fixture/timer/PID/socket cleanup audited. Known failures and manual limits retained; no personal data/credentials/provider calls. This checked item records scoped evidence and disclosure, not every shared whole-app acceptance test passed. |

### Actual fresh integrated checks

All app commands/imports/tests used `E/runtime.env` first: NEW absolute
`/tmp/timetrace-integrated-01.ixSJY3/timetrace.db`, own integration `.venv` and source, non8002
loopback18157 verified free; tracing disabled, credentials unset, idle disabled. Browser contexts
fresh/separate, provider catalog fake in all contexts; synthetic data only, no provider Test/Activate/
inference/paid calls or personal DB/copy/key use. No unknown `.tt-env` sourced or new dependency.

| Actual command/check | Result / fresh receipt |
| --- | --- |
| `uv run python -P -m pytest -q` | **352 passed /85 existing SQLite warnings**, exit0; `pytest.stdout/.stderr/.exit` |
| `node --test tests/*.cjs tests/test_tags_engine.js` | **146 passed /0 failed**, exit0; `node.stdout/.stderr/.exit` |
| `node --check` every `2f978dc..2f3024a` JS/CJS | **42 passed**; `syntax-files.txt`, `syntax.txt` |
| `uv run ruff check . --no-cache --output-format concise` | exit1, **18 baseline diagnostics** + old invalid-noqa warning; `ruff.stdout/.stderr/.exit` |
| `cmp` both Ruff streams with `R/evidence/fresh-verification/run.zoEyTE/baseline-ruff.*` | both exit0, byte-identical; `ruff-comparison.txt`; no cleanup/autofix |
| Scoped Ruff + `ruff format --check tests/test_calendar_shell.py` | pass, already formatted; `scoped-python-checks.txt`. No production Python/amendment/closure Python edits. |
| `git diff --check 2f978dc HEAD` | pass; `whitespace.txt` |
| Fresh actual daemon `timetrace.main:daemon_app` startup/health/FK | healthy exact DB/18157, migrations through0013, FK empty; `daemon.log`, `health.json`, `db-final.json` |
| Native runner `tests/browser_calendar_shell_layout.js` | **12 cases returned/pass**,390/768/1024/1440 ×three lights, bounded geometry/Vim contrast only; `browser-layout.json` |
| Native runner custom `basic-workflow.js` | first render-wait timeout **FAIL retained**; one parent-authorized harness correction, then **26 assertions/10 routes/0pageerrors PASS**; `browser-basic-workflow{,-corrected}.json` |

No schema/db changes, so personal existing-DB migration-copy check **N/A**, not run; fresh migration
chain was actually exercised without stamp/create-all fallback. Parent broad visual/ownership suites
were not all rerun. Prior15 reused suite matrix predates final Task focus change; two deliberate
partial-review503 pageerrors remain disclosed, not a blanket zero-error statement.

The first custom smoke used literal `?tag=merger` against fixture `#merger`: exact token filtering
excluded the real saved Session. Its keyboard201+GET UUID/Notes/duration succeeded, but render wait
timed out; no inferred full pass. Parent source-traced `seedTag`/history and exact hashtag-token
`sessionMatchesBreakdownFilter`, authorized ONE harness-only correction to `tag=%23merger`.
Original probe retained as `basic-workflow-original-failed.js`. Corrected run asserts actual filter
value `#merger`, exact saved/readback tags and matching predicate before real event rendering,
plus all prior readback/write-count assertions. Then timer/theme/navigation/stop path passed in that
single corrected full run. No production edit, assertion lowering or repeated green hunting.

### Cleanup and retained residuals

Fresh smoke deleted its two created Sessions and Task via public APIs; first failed attempt's own
fixtures also deleted in finally. DB final domain/AI counts0, seeded5statuses/1dashboard/9widgets/
1AISettings and FTS bookkeeping remain. `db-final.json` migration0013/FK empty; `timer-final.json`
stopped, not frozen, no pending gap, idlefalse. Siblings only disposable DB/active_timer.json.
Owned daemon237941 cwd/socket verified, SIGINT normal shutdown, PID absent/18157closed/health
curl7 (`process-before-shutdown.txt`, `shutdown.txt`, `daemon.log`). Provider-call audit empty.
Worktrees retained for parent review; original owner checkout and unrelated session-retro untouched.

Retained known **FAIL**: seeded shared-appearance Task title **4.33:1 in three light Calendar cases**
(auto#0284c7/text#111827). Helper/palette/card ancestry identical82/2f/06 and lightCSS exemption show
pre-delivery source hole, **not baseline-browser proof or all-palette compliance**. Four AI dark
**3.98986:1** observations are separate. No recoloring, threshold change or out-of-scope color fix;
parent04/25 follow-up remains `R/research/frontier-regressions.md`.

Original opaque Task readback mismatch **undiagnosed**; later passes and separately repaired focus
theft prove neither its cause nor flake-free behavior. PromiseGC traced actual Save RESOLVED/direct
bridge observation boundary, exact Chromium internal cause unknown. Historical unavailable raw
`/tmp` receipts and supplemental TDD/Dismiss chronology limitations remain as documented above.
Physical touch, screen readers, other engines, exhaustive gestures, unsampled zoom/reduced-motion/
colors, whole accessibility and human visual acceptance remain **unverified**. Completion is bounded
implementation/review/evidence lifecycle only; no later-ticket layout (02 multiline/04 queue/15
workspace/19 tabbed Settings), whole25 completion or futuredev/human approval implied.
