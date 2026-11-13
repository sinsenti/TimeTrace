# Ticket 06: Grouped task list evidence

Current disposition: **bounded software-completed**, subject to independent closure metadata review
and parent disposition. Reviewed product/test/probe bytes are locally integrated at
`563a7838a3fa52c6b7a31925ae860559ea79645f` on `codex/ui-redesign-06-grouped-tasks`.
Spec B3/O2 and the five unchanged ticket criteria are the boundary. Earlier sections below retain their
historical in-progress/unrun/authorization states; the final completion section is current authority.
Human/manual/whole25 acceptance and final whole-delivery review remain separate.

## Changes and contracts

- `kanban.js`: one current-view dispatcher for the existing board read, selector and search;
  filter Apply/Clear, task-knowledge refresh and Statuses Config close reach it through the existing
  `loadKanbanBoard` seam. Read identity plus existing metadata generation prevent stale completion;
  failed reads retain last-known rows and use the shared read-only Retry refresh. Switching views
  destroys Kanban Sortable instances. Outline retains its explicit Kanban fallback for ticket07.
- `grouped_tasks.js`: ordered status sections, one assignment per task with matching status id taking
  precedence over legacy status text; unknown statuses remain visible. Existing hidden-status policy
  has a visible exclusion count and Statuses Config instruction. Search/filtering retain parent context,
  literal descriptions/links/tags, priority/estimate/date metadata and dedicated-details navigation.
  Shared Task editor owns CRUD/queue/completion. Shared Session editor owns scheduling/Timer Now,
  nested Task suspension and explicit Save. Calendar-independent display/focus/clear-completed adapters
  reuse existing contracts. No global or partial `allSessions` is introduced.
- `tasks.html` and scoped `grouped_tasks.css`: normal selector, shared Session include/controller,
  persistent heading focus fallback, semantic lists and native 44px buttons. Existing navbar supplies
  the Timer/recovery controller once. No Calendar controller or task-details/subtasks state is imported.
- `test_grouped_tasks.cjs`, `test_grouped_tasks.py`, `browser_grouped_tasks.js`: agreed caller/HTTP/native
  seams. No service, API, schema, dependency or domain policy changes.

## Producer checks so far

All formal check subprocesses use the new Ticket06 private directory, strict24 environment and editable
Python3.14.6. Absolute DB, timer and key siblings and HOME/TMP/XDG directories are isolated. Evidence is
outside the worktree at `.scratch/codex-continuation/evidence/ticket-06/`; each label retains stdout,
stderr, command and exit separately using exclusive filenames. No personal/provider data or paid calls.

- `red-grouped-01`: intended Grouped caller assertion failed before implementation. `green-grouped-02`
  passed. `green-grouped-01` retained an incorrect test assertion checking innerHTML for the outer class;
  assertion corrected to the observable container class.
- `red-loading-01`: intended initial-loading aria-busy assertion failed; `green-loading-01` passed.
- `focused-node-01`: new Grouped and existing shared quick-edit test files passed.
- `full-node-01`: 21/22 files passed; `test_task_knowledge.cjs` failed. Direct diagnosis retained in
  `diagnose-task-knowledge-01`. Dispatcher initially read the settings helper on each render, breaking
  an existing embedded board caller. Explicit selected-view state now initializes through the selector,
  defaults to Kanban and avoids that added caller dependency. `focused-node-02` passed all three files.
- `focused-python-03`: six tests passed, including real ASGI page composition and shared task/child/
  schedule/completion/Keep/delete contracts. These are TestClient checks, not standalone-daemon proof.
- `full-python-01`:519 passed,242 warnings before ticket14's upcoming local integration.
- `scoped-ruff-01` and `scoped-ruff-format-02` passed; `full-ruff-01` found18 pre-existing violations.
  `syntax-01` passed all four changed/new JS files. Final integrated reruns remain pending.
- Preserved setup mistakes: a first Node-only RED attempt ran before the private wrapper was ready,
  exited1 with a generic file failure and made no TimeTrace import/write. First focused Python attempt
  exited4 because an escalated multiline command wrote the new test outside the worktree; exactly that
  new file was moved into this worktree, leaving no root stray. Second focused attempt passed5/failed1
  because the characterization incorrectly expected DELETE200 rather than existing204; corrected.
  Scoped uv formatting hit the expected sandbox cache-lock restriction; direct private Python Ruff
  formatting succeeded. None of these are product passes or discarded failures.

## Native and independent acceptance

`browser_grouped_tasks.js` is authored, not yet run. It covers actual selector/navigation/reload,
search/hierarchy/inert titles, shared Task cancel and acknowledged-child retry, nested Session→Task
Cancel/draft retention, explicit Session Save/focus, completion Keep, controlled concurrent-Timer
preflight, retained rows/read-only refresh and32 viewport/theme combinations. Its Timer status fault
is an explicit HTTP seam, not proof of all running/frozen/recovery cases.

No physical touch, screen-reader, second-browser-engine or whole-accessibility certification is claimed.
Contrast measurement, long-list/native error cases and final parent review/closure remain pending.

## Current-base source freeze for independent review

Current branch remains at `653012aca42b21446fdf5848a02f6964ba4f9493` with the nine Ticket06 paths
uncommitted. Ticket14's integration tip is `83fb87fed68afcff6565da55efa18807b04cbd12`, but automatic
approval review rejected the attempted fast-forward before any command in that tool call executed.
The rejection cited the explicit instruction against merging without user authorization; parent-agent
messages did not satisfy that trusted restriction. The parent also received a rejection and has an
explicit user approval question pending. No retry or alternate branch mutation was attempted. Final
integrated checks must wait for legitimate authorization and the branch advance.

The unaffected current-base gates are complete: `full-node-02` passed all22 canonical Node test files
with the dispatcher compatibility repair; `syntax-02` passed all four changed/new JS files.
`full-python-01` remains519passed/242warnings; focused Python6passed; scoped Ruff/format pass;
full Ruff remains18 existing violations. Whitespace check is clean. These are current-base receipts,
not Ticket14-integrated certification. Source/docs/tests are frozen for independent review; the external
freeze manifest captures exact file hashes and base. No commit is claimed.

Inherited limitation: shared Task popup's status select still offers its existing five static statuses.
Custom status presentation works here, but arbitrary custom-status editing is the existing shared
editor/status-management limitation reserved for ticket08; this slice adds no alternate status policy.
The manual fixture now also seeds27 synthetic rows, includes an unbroken long title, exercises real
Filter Apply/Clear and an empty search. Native results/contrast/daemon evidence remain unrun at freeze.

### Probe-only amendment before native execution

Independent current-base Standards and Spec reviews reported zero actionable findings/code defects.
The parent released freeze only for the native probe and this evidence note. Product code and tests
outside `browser_grouped_tasks.js` remain unchanged. No Git mutation, daemon or native execution occurred.

The probe initScript now checks HTTP(S) and exact scratch origin before localStorage access, avoiding
about:blank/other-origin storage initialization. Fault responses require exact scratch origin/method/
pathname, retain their limited phases and return counted event metadata: one rejected child POST400;
GET-only Timer status fake during concurrent-preflight checking; GET-only task-list500 during failed
refresh. No successful domain mutation is fabricated. Timer fake status proves the caller boundary
only, not actual running/frozen timer state.

The authored presentation check now waits at most2 seconds for finite animations to finish, measures
resolved opaque RGB foreground/background text contrast for six new Grouped selectors across32
viewport/theme combinations, and asserts4.5 minimum. Three inherited toolbar/navigation selectors are
sampled separately; inherited failures are returned explicitly and do not certify or fail new Grouped
text. Nonopaque/unsupported new samples fail rather than producing a guessed contrast ratio. Document
scroll width, row bounds and44px controls are checked independently of contrast. These192planned new
contrast samples and96inherited samples remain **unrun**; no measured values/pass claim exists yet.

### Probe-only Spec follow-up

The parent released freeze only for a second probe/evidence amendment. The queued-save probe now
requires authoritative readback of exactly one syntax-parsed parent and one row for each child. It
separately counts actual HTTP request attempts from captured traffic: original syntax-bearing parent1,
First child1, Second child2, with exactly one declared400 fault and a real retry. Attempt counts are not
labeled acknowledgements; readbacks supply acknowledgement evidence. This remains authored/unrun.

Presentation assertions additionally compare the Grouped container's scrollWidth/clientWidth and
check text/action descendants' rectangles and internal scroll widths against the local container. A
row fitting the viewport alone no longer passes when its unbroken title/actions overflow internally.
Contrast is explicitly a bounded first-match sample for each of six selectors per viewport/theme,
not every row, dialog, focus state or accessibility surface. The separately recorded three inherited
selector samples are also bounded first matches. No whole-dialog/focus contrast certification is claimed.

### Native1 failed-read seam correction

Parent native1 failed in the task-read fault seam: the broad route also matched the board's real
`?status=all&sort=smart_gap_filler` read, outside the intended exact-query exception. The guard rejected
that interception and an unhandled route error prevented the browser receipt. Earlier assertion counts
are not inferred or certified. Retained native evidence is outside the worktree at
`.scratch/codex-continuation/evidence/ticket-06/native-run`. Parent reported controller-only sole
SIGTERM/exit-15, reap/absence111 and storage equality checks passed; these do not certify browser checks.

Freeze03 was released only for this probe/evidence correction. The500fault predicate and returned
boundary metadata now require exact `?status=all`; the board's sorted query continues to real HTTP.
Product code, daemon and Git were not changed. Scoped syntax/whitespace are rechecked; native rerun
remains pending. Historical native1 failure/cleanup receipts remain retained.

### Probe-only shared Delete coverage

Freeze04 was released only for the native probe/evidence. After read-only refresh recovery, the probe
now opens the owned Other row through Grouped Edit, cancels the shared Delete confirmation and checks
zeroDELETE attempts/retained row. It reopens the same shared confirmation, explicitly proceeds, and
requires exactly oneDELETE to that task, hidden Task modal, absent Grouped row, authoritative public
list readback absence and persistent-heading focus. The scheduled parent's Session must remain.
This adds affected-caller coverage through existing contracts; no new endpoint/policy, fabricated
success, product change, runtime/daemon/native or Git action occurred. Native results remain pending.

## Bounded current-base validation record after native3

This section updates the historical authored/unrun checkpoints above. It does **not** mark ticket06
complete. Base remains `653012aca42b21446fdf5848a02f6964ba4f9493`, with no commit, branch update or
integration. Product source and the probe remain exactly freeze05; only this narrative and the issue
comment are released for amendment. The external freeze05 manifest is the bridge to the final
metadata-only manifest. Two independent current-base reviews reported Standards0 actionable findings
and Spec0 code defects. User Git approval and post-integration checks remain pending.

### Retained native outcomes

The original parent-owned receipts are in these separate root evidence directories; no receipt,
stream, exit or UNKNOWN has been replaced:

- `.scratch/codex-continuation/evidence/ticket-06/native-run`: actual browser exit1; browser receipt
  missing after the Node route-handler exception described above. No earlier assertion count is
  inferred. Controller cleanup evidence remains independently usable.
- `native-run-v2`: actual browser exit1. The probe returned101 checks,32 viewport/theme layouts and192
  opaque RGB first-match text samples; minimum ratio10.704942004960031, with zero failures among the96
  inherited first-match samples. Browser errors0 and source pin matched. The capture guard blocked
  four real `timer.css` GET requests and retained three CDP body UNKNOWNs. Audit records8 violations,
  handlerErrors4 and requestFailures6; returning the probe result did not make this a clean native gate.
- `native-run-v3`: corrected exact timer stylesheet allowance and captured original real-local HTTP
  responses before unchanged fulfillment. The probe again returned101 checks,32 layouts and192 RGB
  samples, minimum10.704942004960031;96 inherited samples had zero failures. Browser errors0,
  violations0, handlerErrors0, requestFailures0 and source pin matched. Its actual browser exit is
  still1, `disposition=FAILED`, `captureDisposition=REQUIRES_PARENT_INSPECTION` and
  `featureAcceptance=false`, solely because CDP could not read the owned task's DELETE204 body.
  This is **not** relabeled exit0 or reconstructed as a successful CDP capture.

The v3 `audit.api` channel `real-local-route-fetch` independently records that same owned DELETE,
actual status204, bodyBytes0 and empty-body SHA256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, captured from the real daemon
before unchanged fulfillment. Public task-list readback acknowledges deletion of only Other, and
public session readback retains the scheduled parent Session. These are separate authoritative HTTP
and domain readback receipts; they do not erase the CDP UNKNOWN. No further native rerun is proposed
solely to fill that capture gap.

All three controller dispositions record exactly one owned SIGTERM, actual daemon exit-15, reaped
process, process absence, post-stop connection refusal111, absent key/timer siblings and logical
storage equality after stop. V3 storage contains29 synthetic tasks, one Session, associated FTS/default
status data and the lazily created AI-settings singleton. Provider configurations remain0, foreign-key
check is empty and privateFiles is `{}`. These records describe scratch cleanup/data scope, not a
successful browser process exit or personal-data access. No real providers were called.

The declared childPOST400, exact task-metadata GET500 and controlled Timer-status fake each occurred
once. Task/session mutations otherwise reached the real isolated daemon. Timer-status injection is
caller-fault-boundary evidence for concurrent-preflight rejection only; it is **not** proof of actual
running/frozen Timer state. Real running/frozen/recovery behavior remains outside this bounded06probe.

### Criterion mapping and remaining gates

| Ticket06 criterion | Current-base evidence | Limit / outstanding gate |
| --- | --- | --- |
| Normal selector and per-browser retention | Node Grouped/legacy fallback caller checks; native navigation/reload and neighbor preference checks returned | Final integrated validation pending |
| Grouping, search/filtering, hierarchy, CRUD, scheduling, completion | Node ordered/id-first/unknown/hidden groups and stale-read checks; real native Filter Apply/Clear, shared Create/Edit/Delete/Cancel, Session Save and completion Keep readbacks | Custom-status editing retains inherited08 limitation; controlled Timer seam only |
| Shared parsing, inherited tags, queued subtasks | Python shared HTTP characterization; native exactly one parsed parent/readback, one each child, parent1/First1/Second2 attempts with one400 and real retry | Existing separate-write/lost-response uncertainty remains; no new atomicity guarantee |
| Navigation, empty/long lists, keyboard/touch/cancellation/errors |101 returned native assertions including27initial rows/unbroken text, nested Session→Task cancellation, failed-read Retry,32 layouts with document/container/descendant bounds and44px buttons | Physical touch, screen readers, second browser engine, full keyboard matrix and whole-dialog/focus contrast unverified |
| Shared acceptance and honest focused evidence | Current-base Python519passed/242warnings; focused6; canonical Node22files; scoped Ruff/format/syntax/whitespace; independent reviews0 defects | Full Ruff18 baseline; actual native browser exit1/CDP UNKNOWN preserved; final integrated suite and owner Git authorization pending |

The contrast result certifies only the six first matching Grouped text selectors at each sampled
viewport/theme after bounded finite-animation settlement. It does not certify every row, inherited
component, dialog, focus state or transient frame. Returned layout bounds/44px sizes are measurements,
not physical-touch or whole-accessibility certification.

The remaining gates are explicit user authorization for local Git operations; safe integration of the
approved tip; fresh integrated full Python/canonical Node/inventory/syntax/scoped Ruff/whitespace checks;
parent disposition of the independent review/native capture evidence; and any required closure metadata
review. No ticket-complete checkbox, commit, merge or release is claimed. This documentation-only
amendment requires whitespace/static verification; no behavior changed to justify repeating tests.

## Authorized integrated implementation checkpoint (2026-11-13)

The owner explicitly approved local ticket branch updates in response to the request covering local
updates, commits and integration merges. The earlier authorization hold above is historical. The
branch was normally fast-forwarded from653012a to83fb87f, preserving all nine feature paths exactly;
no reset, stash, dev merge, push or PR occurred. No native run was repeated for this base update.

Fresh isolated integrated receipts are at
`/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-06/integrated-validation/`:
full Python534 passed/214warnings; focused Python6; canonical default-isolation Node376 passed across
23files; focused Node97; syntax116; scoped Ruff/format and changed-line/new-file whitespace passed.
Full Ruff exits1 with18 pre-existing findings, both streams byte-identical to the retained baseline.
A separate whole-file whitespace audit exposed an inherited line outside this diff; its failed
attempts and baseline attribution remain retained. All nine feature hashes remained freeze06-identical.

Fresh independent integrated Standards and Spec reviews found zero confirmed new product defects.
Their bounded disposition permits a local implementation commit after these checks; it does not
establish full ticket acceptance. This is an in-progress implementation candidate: the native3
CDP204 UNKNOWN/actualexit1 remains distinct from the separate actual HTTP/readback evidence; native
Timer proof here covers controlled preflight, and real running/frozen/recovery remains a coverage
boundary. Manual/human/whole25 gates remain open. All five acceptance boxes stay unchecked.

Only this evidence, issue comments and the backlog's current-state note are released for metadata
closure; product, tests and probe remain byte-identical to the reviewed/tested source.


## Bounded software completion (2026-11-13)

This updates the preceding historical checkpoints without replacing their receipts or failed attempts.
No confirmed software blocker is demonstrated by the reviewed evidence. The local tracker records
`completed` for delivered implementation with recorded criteria evidence and disclosed manual limits.
This is software completion, subject to independent closure metadata review and parent disposition;
it supplies neither blanket acceptance nor a waiver. No specification or criterion text changed.

### Five unchanged criteria

| Criterion | Recorded implementation evidence | Retained limits |
| --- | --- | --- |
| Normal selector/per-browser retention | Native3 Grouped reload/details navigation and unchanged neighboring appearance; Node selection/fallback and Python shared page composition | Sampled browser adoption, not all historical profiles |
| Grouping/search/filter/hierarchy/CRUD/shared quick edit/schedule/timer/completion | Node ordered/id-first/unknown/hidden groups/stale reads; native3 Filter Apply/Clear, child/context/literal title, Cancel/Create/retry/Delete, explicit Session Save, completion Keep and authoritative reads; separate real Timer run below | Shared arbitrary custom-status editing remains inherited08; frozen/recovery/OS-idle and lost-ACK Timer behavior untested here |
| Existing services/title/status parsing/inherited tags/queued children | Focused Python HTTP characterization; native3 one parsed parent and each child once with effective tags; parent1/First1/Second2 attempts distinguish declared child400 from real retry | Existing separate-write/lost-response uncertainty; no atomicity promise or view-specific domain policy |
| Navigation/reload/empty/long lists/access/cancel/errors |101 native3 returned checks,27 initial rows/unbroken title, empty search, Escape/focus, nested Task Cancel retaining Session draft, partial-child failure/read-only Retry;32 layouts measuring document/container/descendant bounds and44px buttons; Node loading/stale-read/drag teardown/focus regressions | Physical touch, screen reader, second engine, full keyboard/focus matrix, zoom/reduced-motion and all dialog/transient/error contrasts unrun; sampled sizes/contrast do not certify accessibility |
| Shared acceptance/focused regressions/honest checks/privacy | Integrated534Python/214warnings, focused6Python; canonical376Node/23files, focused97Node;116syntax, scoped Ruff/format/changed-line/new-file whitespace pass; independently reviewed source axes report no new confirmed defects; isolated synthetic data/providers0 | Full Ruff exit1/18 baseline; native3 exit1/CDP UNKNOWN; human/whole25/manual acceptance and final whole-delivery checks/review against82fabdc remain separate |

### Exact integrated receipts and source bridge

External evidence root is
`/home/user/git/personal/TimeTrace/.scratch/codex-continuation/evidence/ticket-06/`.
`integrated-validation/validation/integrated-full-python-01.result.json` records exit0 and stdout
534passed/214warnings. `integrated-canonical-node-02.result.json` records exit0 with376pass/0fail/
0skipped in stdout. These ran on integrated feature bytes over83fb87f, before implementation commit
abc828f. `integrated-validation/local-commit-result.json` preserves seven product/test/probe hashes;
all seven still match563a783. `merge-status-correction.json` bridges the sole later formal-status
correction. No fresh suite run on563a783 or this metadata amendment is claimed.

`integrated-final-integrity-04.stdout` records477 unchanged hashes, no private test data/key/timer,
and both full Ruff streams equal to retained baseline:18 findings (16E501/2E741), exit1. Earlier audit
helper failures, inherited kanban whitespace, offline cache-lock failure, initial Node file-level counts
and earlier native failures remain retained; none is substituted for a clean process result.

### Separate actual Grouped Timer entry evidence

`timer-entry-run/browser.json`, `browser.json.probe-1.json` and `disposition.json` return **two scenario
groups**, actual browser exit0: Grouped Schedule / Timer → shared Session Timer Now → Calendar
navigation → public header Stop. Original real-local-route-fetch captures show exactly one POST
`/timer/start`200 and one `/timer/stop`200; no fake domain ACK/response is declared. Public reads show
zero Sessions while running, then one performed Session duration5 for the owned unchanged Task,
matching notes/start/end. Timer status remains running across navigation, then stopped/reset.
Probe/page/driver/source-pin errors, guard violations, routeActions, captureErrors, handlerErrors and
requestFailures are zero. `featureAcceptance=false` remains; this runner does not grant acceptance.
Duplicate CDP bodies are UNOBSERVED, not independently captured originals.

Actual timer-file observations begin absent, then running JSON383bytes/hash
`4d3f4f69b7583c78cc81e5ac3cf3707c0daf8f4ce5de8c5e8c15873ccce847c5` unchanged across navigation,
then persisted stopped JSON262bytes/hash
`22f50dc2d3e7acbb2d1043476bb0fd05afaef683270f0b1621ed6ef6c8365410`.
Stopped JSON persists by contract: no absence-after-stop claim. Final status is stopped/not frozen,
pending_idle_gap null. Controller PID397396/port18347 records one SIGTERM, actual exit-15, reaped,
process absent, refusal111, absent key and logical storage equality after stop. `after-storage.json`
contains providers0/FKempty and only stopped active_timer.json in privateFiles; one owned Task and
one performed Session intentionally remain in isolated storage. No runtime was rerun for closure.

### Original native3 disposition and remaining acceptance

Native3 still returns101 checks/32 layouts/192 first-match opaque Grouped text samples, minimum
10.704942004960031 (96 inherited samples without recorded failure), but actual browser exit is **1**,
`disposition=FAILED`, `captureDisposition=REQUIRES_PARENT_INSPECTION`, `featureAcceptance=false`:
one DELETE204 CDP body remains **UNKNOWN**. The separate original HTTP real-local-route-fetch
records status204/bodyBytes0/empty SHA256 before unchanged delivery; public readback verifies owned
deletion and retained scheduled parent Session. These channels do not repair or reconstruct CDP.
Native3 violations/handlerErrors/requestFailures/page errors are0; its owned one-SIGTERM/exit-15/
reaped/absent/refusal111/storageequal/keytimerabsent cleanup remains independently recorded.
Native1 missing browser receipt and native2 guard/capture failures remain failed history.

The new real running/navigation/Stop seam narrows the old blanket Timer-unrun statement only.
Frozen/recovery/OS-idle/lost-ACK Timer coverage, inherited08 arbitrary custom-status editing,
physical touch/screen-reader/second-engine/full accessibility matrix, broad shared cross-page checks,
human/whole25 acceptance and final whole-delivery review against82fabdc remain open. This amendment
runs no tests, browser, daemon or provider and makes no product/test/probe/Git mutation. Local commits
and integration are authorized separately; dev merge, push, PR and acceptance waivers are not.
