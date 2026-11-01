# Ticket 01 — implementation evidence, review pending

Status remains **ready-for-agent**. Implementation and bounded browser verification are delivered;
independent per-commit Standards/Spec review and parent integration/closure are still required.
This is not completion of the graph, whole-app accessibility certification or permission to merge to dev.

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
