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
