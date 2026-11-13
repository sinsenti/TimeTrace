# Ticket 07: Outline and inline inspector candidate

Base: `1671f9fecc677c64fc806b3f2160a17179771101`, branch `codex/ui-redesign-07-outline-inspector`.
Software candidate only: independent review, guarded native execution and human acceptance remain open.
The executor created no daemon/browser, commits, merges, pushes or PRs. No backend/model/API change.

## Implementation

- `outline_tasks.js`: optional hierarchy with native selection/expansion buttons, literal escaped text, snapshot order, cycle/orphan safety, filtered ancestor context, selected-row notice and retained inline inspector coordination.
- `kanban.js`: dispatch three views and keep existing browser preference settings; retain the inspector outside replaced list rows and hide/inert it off Outline.
- `subtasks.js`: reuse the dedicated details controller with selection/request/generation ownership, dirty switch/close guards, pending property/child/other writes and completion-prompt guards, local shortcuts/navigation, explicit Cancel and canonical ACK receipts. Deletion confirms its captured owner before writing and clears only its acknowledged inline selection.
- `grouped_tasks.js`: keep page Session hooks authoritative, return to stable history/Tasks targets and yield to newer focus.
- `task_detail_panel.html` / `subtask_modal.html`: shared extracted markup with exactly one editor/modal per page; dedicated details retains its route and shell.
- `tasks.html`, `outline_tasks.css`: persistent inspector mount and scoped wrapping/stacked layout, existing shared editors retained.
- `test_outline_tasks.cjs/.py`: 20 public controller/renderer regressions and two real-app rendered-route composition checks. Grouped/quick-edit fixtures only reconcile obsolete Outline fallback expectations/composition.
- `browser_outline_tasks.js`: authored native real-API workflow with individually declared held tree/real mutation ACK and failed stats seams. Syntax checked, **not executed**.

## Automated checks

External receipt root: `/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-07/`.
Every command has separate `.command.json`, `.stdout`, `.stderr`, `.result.json` unless interrupted (see below).

- `focused-python01`: 50 passed / 4 inherited serializer warnings.
- `compatibility-node02`: 231 passed across nine relevant files. A later focused test-fixture barrier correction ensures the declared parent/stats response is actually held; `focused-outline06` passes all 15 Outline cases.
- `full-python01`: `uv --no-config run --offline --frozen --no-python-downloads python -P -m pytest -q`: **539 passed, 214 warnings**, 23.45s.
- `full-node01`: **412 passed**, discovered canonical inventory in `canonical-node-inventory.json`; browser probes excluded. Default Node process isolation and TAP counts, including real `test_tags_engine.js` cases.
- `scoped-ruff-fix01`, `scoped-format01`, `scoped-final01`: clean changed Python files; one new test file formatted, unrelated files untouched.
- `full-ruff01`: **18 inherited errors** in unchanged files plus the existing `db/models.py` invalid-noqa warning on stderr. No new Python lint finding; preserved both streams.
- `syntax-whitespace01`: all eight changed/new JS/CJS files pass `node --check`, `git diff --check` passes.

## RED and first-failure record

Meaningful RED → GREEN pairs: `red-dispatch03` → `green-dispatch01` (Outline fell back to Kanban); `red-hierarchy01` → `green-hierarchy01` (missing hierarchy/context); `red-selection01` → `green-selection01` (selection entry point absent); `red-composition02` → `green-composition01` (Tasks lacked mounted editor); `red-delete01` → `green-delete01` (stale confirmation deleted earlier selection); `red-focus01` → `green-focus01` (Session stole newer focus); `red-completion01` → `green-completion01` (synchronous completion handler left visible prompt unguarded); `red-root-order01` → `green-root-order01` (context ancestor root reordered).

All earlier failures remain preserved: `setup01` cache lock denied by sandbox, then successful reviewed escalation `setup02`; `red-dispatch01` sandbox Node child diagnostics incomplete, `red-dispatch02` missing fixture `window.addEventListener`, then meaningful RED03. `red-composition01` sandbox TestClient stalled and was interrupted via Ctrl-C (tool exit130, runner result absent); escalated RED02 completed. `red-delete01` also exposed missing fixture `localStorage.setItem`, fixed before GREEN. `preflight01` used an incorrect relative script path, corrected with absolute path in `preflight02`. `compatibility-node01` was 220/222: obsolete fallback assertion and missing fixture `querySelectorAll`; both fixed narrowly. `focused-outline03` was interrupted (tool exit130) because the synthetic parent seam also held B; fixture corrected in 04. `focused-outline05` caught that three microtasks had not yet reached the held stats seam; deterministic next-event-loop turn in 06 confirms one held read before switching. These fixture/transport failures are not product RED claims.

## Isolation and coverage boundaries

New `/tmp/timetrace-codex-07-xglhiyvq` private 0700 HOME/TMP/XDG/data, strict 24-variable sanitized environment, absolute DB before all imports, Python 3.14.6, safe-path/no bytecode, offline editable install at this worktree. Idle, SQL widgets and tracing disabled; no credentials inherited. `preflight02` verifies actual environment, editable direct URL, DB/engine/timer paths and initially empty private data. Tests use existing fake models/gateways and isolated test fixtures; no live providers/personal data.

The implementation preserves inherited property/child canonical ACK, NULL/default estimates, custom recurrence and tag contracts. Controller tests mock HTTP transport and DOM adapters at the approved browser-handler seam; rendered-route tests use the actual daemon app through TestClient without lifespan/daemon startup. Native rendering/focus/touch cannot be inferred from those tests.

Native workflow, shared Grouped/detail/Session browser compatibility, wide/narrow visual and contrast samples, physical touch, screen readers, other engines, exhaustive zoom/motion/colors, Timer idle/frozen closure, independent two-axis review, explicit human acceptance and whole-delivery review remain **unrun/open**. Dedicated route retention and existing backend accounting are automated compatibility evidence. No migration check is applicable because no models/backend changed. Shared README/implementation/development documentation is held for parent reconciliation; external `shared-docs-note.md` provides the intended text.

## Fresh review repair 02 — navigation and pending deletion (2026-11-13)

The first independent spec review found two caller-visible defects; the standards review found no
additional actionable defect. This amendment repairs those findings and is frozen for a fresh
independent two-axis review. No review acceptance is claimed yet.

- `kanban.js` routes its actual card click and self-targeted Enter handlers through the existing
  `navigateToTaskDetail(taskId, dedicatedPage)` contract. `subtasks.js` keeps inline hierarchy
  selection as its default; the explicit dedicated-page path confirms all retained initialized
  drafts, including the hidden Outline editor. Declined discard preserves selection, draft and
  card focus; accepted discard and ordinary clean navigation perform no domain writes.
- `subtasks.js` rejects property Cancel during pending property, child or task mutations and a
  visible completion prompt. Its shared task-mutation pending setter disables the actual property
  Cancel button in the extracted panel. Successful held DELETE acknowledgment can therefore clear
  its selected owner and return focus to Tasks; failed DELETE retains the draft and re-enables
  Cancel. Existing stale confirmation/newer-selection and A-B-A read controls remain covered.
- `test_outline_tasks.cjs` executes handlers extracted from actual Kanban markup and the actual
  property Cancel button, with held HTTP promises. Five added cases cover dirty click/Enter with
  declined/accepted discard, clean navigation/nested keyboard targets, successful pending DELETE
  plus Cancel/Escape/selection attempts, and failed DELETE followed by explicit Cancel.
- `browser_outline_tasks.js` adds the corresponding native click/Enter departures and an explicitly
  declared held real DELETE ACK with disabled-button click/Enter, public deletion readback and focus
  assertions. These new cases are **authored only**, not native execution evidence.

New receipts: external `evidence/ticket-07/repair02/`. New private 0700 root
`/tmp/timetrace-codex-07-repair02-7wi58tkj` has independent HOME/TMP/XDG/data/venv, strict 24-variable
launcher environment, Python 3.14.6, offline frozen editable installation and DB before imports.
Direct-Python preflight verifies the exact 24-variable child environment, safe path, no bytecode,
editable source, empty data directory and DB/timer paths. An earlier preflight through `uv run`
failed its exact-environment assertion because uv adds child launcher variables; that failure is
retained and corrected by direct invocation. The full Python command still uses the required
`uv --no-config run --offline --frozen --no-python-downloads python -P -m pytest -q`.

Fresh checks: focused Node **179 passed**; focused Python **50 passed / 4 warnings**; full Python
**539 passed / 214 warnings**, 51.65s; one canonical full Node run **417 passed / 0 failed**, 25 files.
All eight changed/new JavaScript/CJS syntax checks and diff whitespace pass. Scoped Python Ruff and
format checks pass. Uncached full Ruff reports the same **18 inherited findings** and invalid-noqa
warning: both stdout and stderr are byte-identical to the first freeze's receipts. The initial
sandbox uv cache-lock failure and incomplete sandbox Node RED diagnostics are retained; escalated
runs captured the meaningful RED failures and subsequent GREEN results.

Tasks-page caller audit: Kanban's two direct card handlers were the only unguarded direct departure
callers among scripts included by `tasks.html`. Grouped titles, navbar and explicit dedicated-detail
links are real anchors handled by the existing capture guard; Settings owns its shared handler.
Inline parent/hierarchy selection stays local, and existing `navigateBack` retains its guard.
Calendar-only Vim/sidebar and Statistics direct navigation scripts are not loaded by Tasks and were
not changed. No shared utilities, AI/Revision/ratings/API/model/policy or Grouped code was amended.
No daemon/browser, personal data, providers, Git writes or unrelated worktrees were used. All earlier
native, visual/accessibility, Timer, human acceptance and whole-delivery limits remain open.

## Branch reconciliation 03 — integration through ticket 20

The exact freeze02 17-path candidate was checkpointed as
`2a7933d9a603425f475394b98d580481cb30f932` with no byte changes. Fresh independent
standards and spec reviews (`standards-review02.md`, `spec-review02.md`) each recorded zero
confirmed findings. The exact integration commit `4e75ef02cf478165f6eaa48b0527c3f852b31dcd`
was then merged without conflicts as `8a9c94168fc2de3d4beb94442e1aebcff33e6a3b`. Incoming ticket-20 source, tests and
browser probes retain their exact integration bytes; ticket-07 product/test/probe bytes remain
identical to freeze02. This section and the issue comment are progress metadata only.

All 539 Python / 417 Node passes above are **historical checks of freeze02 before this merge**.
The inherited 214 Python warnings and 18 Ruff findings plus invalid-noqa warning remain recorded
as originally reported; no new check pass is claimed. Combined-source checks and native execution
are **UNRUN** at this checkpoint. The Outline native probe remains authored only; shared-consumer,
visual/accessibility, Timer, human acceptance and whole-delivery gates remain open. Issue07 remains
in-progress and no acceptance criterion is closed. Shared README, implementation and development
notes were not edited for ticket07; their incoming ticket20 changes are retained. External
`evidence/ticket-07/freeze03/` records the full source inventory and exact preservation bridges.


## Bounded software-completion candidate (2026-11-13)

Recommend ticket07 software completion under the local tracker's bounded delivery convention,
subject to fresh independent closure metadata Standards and Spec reviews and parent disposition.
This is a metadata-only candidate on `212680779190867c4c5c1da4010cdaa9dd75c47b` (freeze07).
The five original issue criteria remain verbatim. Existing historical sections above retain their
then-current UNRUN/open wording; this section supplies the current evidence and its limits.
No product, test, native helper, acceptance spec or historical receipt is changed by this closure.

External receipts are rooted at
`/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-07/`.
`freeze07/report.md`, `incoming-owned-bridge.json`, `full-source-freeze.json` and
`integrated-after24/report.md` establish the current combined source identity. Source-product
Standards/Spec reviews02 both report zero confirmed findings on their exact feature candidate;
focused probe-only/harness reviews04 have zero blockers in that separate scope. Neither substitutes
for the two fresh closure metadata reviews still required here.

### Five unchanged criteria: evidence and limits

| Criterion | Current bounded software evidence | Precise limits retained |
| --- | --- | --- |
| Dedicated route, optional normal Outline view and per-browser persistence | Actual rendered-route tests `test_outline_tasks.py` verify one shared editor on Tasks and retained dedicated details routes. CJS `outline preference renders Outline and retains unrelated preferences across three views` covers normal dispatch and valid settings. Native02 returned invalid-default, unrelated-setting preservation and cross-reload Outline assertions; dedicated own-history route was reached. | Native02 is FAILED overall. These are returned functional observations, not a clean 69-workflow certification. Broader browser/engine acceptance is pending. |
| Hierarchy, shared operations, own history/accounting and accessible selection | CJS filtered ancestor/orphan/cycle/root-order and literal-text cases; shared-controller child, deletion, Session-focus and shortcut cases; actual composition tests. Native02 observed exactly three own rows with ancestor context, own-vs-descendant history, shared accounting/negative overspend, real Save and child creation, Grouped Task Edit/Cancel and Schedule/Cancel, existing Session Cancel, actual Kanban click/Enter departures, literal unsafe text and inline Close. | Native02's 69 assertions are qualified by its fatal transport failure. Physical touch/screen-reader access, contrast measurement, other engines and exhaustive theme/zoom/motion remain unrun. Shared Session Save/nested Task handoff, queued-child fault recovery and recurrence mutation are not newly native-covered. Native02's disabled Cancel click hit the actual control; bounded Enter focus stayed BODY, so Enter targeting Cancel is unclaimed. |
| Stable selected identity/draft across refresh and stale-response protection | Current CJS dirty-selection/view-refresh, pending child ACK refresh, held parent/stats A→B→A continuations and concurrent-typing Save ACK regressions pass in the combined canonical run. Native02 observed retained hidden/filter drafts and held Save's later draft, with its FAILED-overall qualifier. Separate clean held03 proves actual Other→held Parent→Child→latest Parent ordering and canonical enabled Parent owner/title before and after stale delivery. | Dirty-preserving metadata refresh is established by controller regressions, not native02's replacement reload, which had a clean baseline. Held03 uses three synthetic Tasks and zero UI writes; it does not establish new Save/Delete boundary runtime certification. |
| Selection, Save/Cancel, stale/deleted tasks, narrow layouts and completion prompts with regressions and a real workflow | Current CJS covers failed initial reads/current retry, delayed delete confirmation, successful/failed held DELETE and actual Cancel handler, selection/close guards, explicit Save/Cancel, pending writes, visible completion follow-up and actual Kanban departures. Native02 returned the real mutation/readback/Cancel/Keep workflow, public deleted404, actual disabled Cancel click and widths1440/768/390 without horizontal overflow. Held03 provides a clean focused real-browser inspector-selection workflow and delivery ordering, independently of those returned69. | Native01/native02 failures remain fatal within their own runs. No clean rerun of all69 exists. Source06's completion helper now covers tree/Save/Delete; only the tree boundary has the new held03 native proof. Completion Clear/subtree independence, real idle/frozen Timer closure, other-engine and human acceptance remain outside this bounded evidence. |
| Shared safety, focused regressions, honest unrun checks and no personal/provider data | Combined full Python/Node, syntax, scoped lint/format, exact Ruff baseline comparison and whitespace receipts below; source/helper hash bridges; isolated synthetic native runs with original response captures, actual ACK/storage/FTS reconciliation and verified shutdown. Selection IDs remain UUIDv7 strings; no backend/model/schema/API change or migration is introduced. | Fakes and inert controls are explicitly identified below. No OS idle, physical accessibility, provider, whole25, owner acceptance or dev-merge gate is waived. See the remaining-gates paragraph; `completed` means bounded software delivery only. |

### Current combined checks and source bridge

`integrated-after24/report.md` records exactly one full run on freeze07, with all501 regular
tracked/nonignored files matching membership, lengths and SHA256 before/after, unchanged HEAD,
index and refs: **564 Python passed / 214 warnings**, **485 actual TAP cases passed** across27
canonical files under default Node process isolation, **127 JavaScript syntax checks passed**.
Scoped Ruff/format on the three relevant Python tests and both whitespace checks passed.
Full uncached Ruff reports **18 inherited findings** (16 E501/2 E741) and the existing invalid-noqa
stderr warning; stdout and stderr both byte-match an independently Git-audited493-file disposable
snapshot of incoming `564e25a51807c6809d191fa0f31e27d0d7bf6b6c`. The214 warnings are206 SQLite
datetime deprecations and8 Pydantic serialization warnings. Initial sandbox setup lock failure and
successful escalated setup receipts are retained. There was no daemon/browser/native rerun in
that combined check, and no suite is rerun for this metadata edit.

Freeze06 contains the source-local bounded delivery observer: it resolves only after the actual
fulfillment returns, preserves callback errors and original cause, times out after10,000ms without
advancing to removal, and uses exact handler identity for tree/Save/Delete. Its inert actual-source
controls retain original and removed-wait mutant RED failures and repaired GREEN; they model
transport and cannot reconstruct historical native event order. Freeze07 checkpoints the two
previously modified tests and merges incoming24 without conflicts. All17 paths differing from
incoming retain the ticket07 checkpoint bytes; all13 incoming changed/added paths match incoming.
Thus current combined checks and the source/helper bridges connect earlier observations to retained
feature bytes, without treating a historical run as a fresh combined browser run.

### Native history, focused repair and storage

- Native01 remains **FAILED** at its selector assertion. Native02 remains **FAILED** despite69
  returned assertions and zero page errors: one guard violation and two handler errors record
  `route.fulfill: Route is already handled!`. Its causal account remains uncertain: removal before
  completion is a demonstrated mechanism, but historical contender ordering is not established.
  No clean rerun or retrospective PASS is claimed.
- Native02 retained330 original captures and13 actual successful domain ACKs (six Task POSTs,
  three parent PUTs, one DELETE, three Session POSTs). Full final fields reconcile to ACKs;
  five Tasks/three Sessions remain, schema/FKs/unrelated/config state reconcile, copied-memory
  rank1 FTS integrity passes without changing copied logical storage, and post-browser/post-stop
  storage/private files match. These successful observations do not erase its failed transport gate.
- `native-execution-held03/report.md`, `observed-summary.json` and `held-action-timeline.json`
  report **PASS for the bounded focused transport proof only**: seven checks, three actual public
  Task201 ACKs, zero Session ACKs and zero UI domain writes. All47 original captures verify.
  Actual held fulfillment returned action452, callback finished453, explicit completion wait455,
  exact-handler removal456→457; latest callback436 and wait449 precede release450. All route,
  registration, capture and callback identities agree. Guard, handler/capture/request, unresolved
  callback, page, runner, emergency and source/driver errors are all zero; teardown completes.
  Full Task fields/topology, all logical tables/config/FK/FTS and private files reconcile;
  copied-memory rank1 integrity passes, with no physical shadow-delta replay claim. Post-browser
  and post-stop storage/private snapshots match. Sole pidfd SIGTERM of owned PID724009 reaped
  actual−15, with actual process absence and refused18385/errno111. Native02 separately retained
  its own sole−15 shutdown/process absence/refused18373; no lifecycle result is relabeled.

Held03 independently pinned all495 then-current source files,10 new helpers and both old9-helper
sets before/after. Freeze07's complete byte bridge carries those source bytes into the current501
source membership, adding incoming24 and its metadata/tests. The held03 proof is deliberately
narrow: no inherited Save/Delete/fake-response/Session grants and no69-workflow rerun. The native02
single503 stats seam is declared synthetic; CJS DOM/HTTP controls and source06 transport controls
are modeled seams, not real server failures or writes. All application storage was private synthetic
scratch data; no personal DB, provider, paid call, credential exposure or OS-idle test occurred.

### Remaining gates and candidate counts

No genuine failed gate is waived. Native01/native02 retain FAILED status and native02's causal
uncertainty. A clean complete69-workflow rerun, fresh Save/Delete completion-latch native checks,
dirty metadata-refresh native exercise, remaining shared Session Save/nested handoff/queued-child
fault recovery/Completion Clear-subtree/recurrence workflows, contrast/physical touch/screen readers/
other engines/exhaustive theme/zoom/motion and actual OS idle/frozen Timer remain unrun here.
These limits bound the software-completion recommendation; they are not claims of full shared,
physical accessibility or product acceptance. Whole25 still requires its fixed-base integrated review
and owner acceptance; any future dev merge retains the separate automated/adversarial/human gate.
Spec status stays **Approved, not Built**. Fresh closure metadata reviews and parent disposition
are still required before committing or integrating this five-path candidate.

Authoritative integration `564e25a51807c6809d191fa0f31e27d0d7bf6b6c` remains13 software-completed/
12 open. Candidate-local14 completed/11 open adds only07 to
01/02/04/05/06/10/11/12/14/15/19/20/24, conditional on review and integration. The metadata hash
bridge in external `closure-metadata/` proves all source/tests/native evidence unchanged; no new
runtime, full test, Git write, provider or personal-data operation accompanies this recommendation.
