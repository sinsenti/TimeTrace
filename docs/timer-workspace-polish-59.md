# Timer workspace UI polish — #59

## Contract and implementation

The owner-approved revision 6 is archived at
`prototype/timer-workspace-polish-59:docs/prototypes/timer-workspace-polish-59.md`
(commit `abfd67db1c34ff5bd2ccd301317cee2be07867c2`). Approval receipt:
https://github.com/sinsenti/TimeTrace/issues/59#issuecomment-7145716670.
This implementation starts at `bb899fc7095aeccce5b4eaa4bf5921f06dbad021`.

- Normal templates mount `components/timer_workspace_bar.html` outside the header.
  Calendar retains actual task cards/FullCalendar, with one compact start/selected-timer strip.
  Other timers, idle review and exact operation recovery remain accessible. Ordinary writes do
  not leave the recovery popup open. Live Calendar intervals are explicitly labelled LIVE,
  not uncertain legacy sessions; their exact geometry/ACK fences are unchanged.
- `/timer-settings` provides named goal cards, direct target editing and explicit activity/group,
  cadence, descendants, enabled and optional total-start controls. Weekly history stays linked.
  Existing tiny positive targets survive unit conversion and unrelated settings edits unchanged.
  Metadata refresh updates names without replacing target typing or launcher selections.
- Focus defaults and selected-timer overrides use the existing controllers. Defaults remain
  Off/25/5/notify-only; sound stays global and automatic breaks never auto-resume. Urgent notices,
  due/break actions and dismissal remain outside settings. Other/stopped-timer focus drafts stay
  visible and explicitly reviewable/discardable rather than trapping an invisible dirty editor.
- Reporting preferences use weekday buttons and Save/Cancel. An unchanged choice creates no
  context, but exact uncertain retries are not suppressed. Historical context boundaries remain
  authoritative and must not be merged.
- Agenda retains its current card, circular B-style ±5 controls, real pins, on-demand discovery,
  history and contextual inspector. The summary presents authoritative elapsed union, task credit,
  unassigned work and original/current-plan evidence; it never recomputes or redefines them.
- The collapsed work note has one primary Save, dirty/Saving/Saved text and secondary explicit
  Discard. It remains separate from task description and protects Stop/navigation. Delayed own
  acknowledgements do not erase newer typing.
- Corrections use ordinary dialog controls and dated before/after previews. IDs, exact values,
  timezone/offset choices and full signed evidence remain in Advanced. Unchanged native date
  input events preserve six-digit fractions, including browser normalization of zero seconds.
  Explicit initialization, pinned identities, DST validation, preview-before-apply and uncertain
  recovery continue through the original controller/service protocol.

No schema, migration, accounting compiler, timer protocol, provider integration or production
fixture/default goal is added. Prototype overlays/observers are not production dependencies.
Original #60–65 contracts and the five-repair ledger remain supporting contracts, not rewritten
historical verification receipts.

## Verification

Final gates on implementation + repair commit `823c279`:

- **Python: 1,236 passed**, 1,694 warnings, 22m23s; safe-path mode, external test DB/HOME,
  native sends disabled. Unit tests retain their synthetic idle observation; the separate browser
  daemon has actual OS idle observation disabled.
- **Node: 916 passed**, zero failures. Changed production JavaScript and the manual browser probe
  pass `node --check`.
- Scoped Ruff passes for the router and changed Python tests; full Ruff retains exactly **17
  inherited findings**. Whitespace checks pass.
- Four guarded real-browser cases pass: note ACK, date precision, task names/selection ownership,
  and actual live Calendar labelling. Additional integrated checks are listed below.

The first complete Python run passed 1,235 tests and failed one obsolete hard-coded asset-version
assertion. The corrected fixture tests one versioned controller on every route, including settings;
its recovery/page suites passed 33 tests before the final all-green run. An earlier environment
incorrectly disabled synthetic idle observation; it was corrected. Two 600-second limits were
insufficient for the process/crash matrices, whose individual subprocess cases take around 28s.
These interrupted/initial runs are not represented as passing gates.

### Independent review

- **Standards:** no documented-standard violations; two P2 judgement notes: copy-derived status
  presentation and duplicated task-option replacement. These are recorded maintainability follow-ups,
  not correctness blockers; this delivery does not broaden the controller/metadata interfaces to
  address them.
- **Spec:** two findings, both repaired in `823c279`: primary selected-timer navigation now shares
  the existing dirty-editor confirmation guard; legacy timers retain secondary, named disclosure
  of prospective unknown-history warning anchors. Both regression tests failed before their fixes.
  The independent Spec reviewer rechecked both repairs and found no residual issue in that scope.

Initial review counts remain Standards **2 notes**, Spec **2 findings**; do not relabel the initial
review as zero findings. Implementation is committed on `feat/timer-workspace-polish-59`; this is
not a claim of merge, deployment or manual platform acceptance.

Actual application verification uses port **18128**, external DB/HOME/TMPDIR under
`/tmp/timetrace-polish-browser-*`, native delivery and OS idle observation disabled, and AI routes
blocked by the external test harness. No personal database/daemon or provider is used. The normal
application components, controllers and FullCalendar renderer are used without prototype overlays.
One synthetic dataset exercised:

- Work group target 2→3→2 hours, plus delayed 3-hour ACK while 4-hour typing remained owned;
- explicit All activities creation without an invalid task association;
- future focus 25→30→25, Off throughout, with delayed 30-minute ACK retaining newer 45-minute typing;
- reporting same-choice Save disabled, changed choice/Cancel without another context;
- delayed work-note ACK retaining later typing, explicit discard/restore and blocked dirty-note Stop;
- stopped timer's retained focus draft exposed by name and explicitly discarded;
- native date normalization preserving microseconds and explicit initialized signed +5-minute apply,
  preserving immutable creation origin; task estimate/description and plan meaning unchanged;
- overlapping physical work: goal SUM 3,600.033429s versus about 45 minutes elapsed union;
- actual Calendar/task cards/full task editor, original 120-minute estimate and distinct work note.

`tests/browser_timer_workspace_polish.js` supplies guarded, repeatable public-UI cases for note ACK,
exact date precision, metadata ownership and live Calendar labelling. Run its function through the
owned Orca page only after seeding ordinary synthetic HTTP data. Its origin/DB guards reject the
personal daemon; it does not reset storage, request notification permission or send OS alerts.
Historical dated browser probes target their original interfaces, not a claim that all their old
label selectors were replayed against this polish.

Raster capture succeeded in this runtime (the earlier prototype runtime timed out). AI-blocking
and existing Tailwind-CDN warnings are known harness/environment messages, not clean-console proof.
Screenshots/DOM checks are not manual OS notification, sound, accessibility or platform certification.

## Approved saved-entry feedback follow-up

After testing the implementation, the owner requested background saved-note refresh, Save directly
below its input, and deletion from the recorded-entry inspector. The owner explicitly approved
**permanent deletion after confirmation**, for the selected recorded interval only. No Undo or
bulk/task/plan deletion is added.

- Saved notes quietly read on open, window focus, note-field blur and a visible-page 30-second cadence. Focus,
  dirty input, pending/blocked writes and newer acknowledgements fence read adoption. A retry control
  appears only after an error, not as a permanent technical action. Save is grouped below its input;
  the duplicate read-only note field is removed for recorded entries.
- The confirmation names the entry and full interval, explains that its note/attached ratings are
  removed, and preserves tasks, plans and other entries. While deletion is pending, the selected
  note is read-only. Stale revisions and pending correction/assignment guards refuse mutation.
  Unknown deletion outcomes use GET-only checking, never automatic DELETE replay.
- `SessionService.delete_recorded_work` owns the SQLite transaction; the dedicated DELETE route
  requires `expected_revision`. Immutable correction/operation/AI snapshots are retained. Recurrence
  references fail closed; the legacy session-removal contract is not widened. Tests cover totals,
  unrelated ratings/records/plans, held-lock guards, active split buffers and exact Stop replay
  without resurrecting deleted work.
- The `5e-324` goal was a synthetic precision fixture, not a default. Only that unchanged demo goal
  definition was removed from the isolated preview; other data, historical settings and receipts
  were retained. Production tiny-positive-target support is unchanged.

Final follow-up gates: **1,241 Python tests passed** (1,695 warnings, 8m33s), **919 Node tests
passed**, and all changed-JS syntax/scoped Ruff/whitespace checks passed. Full Ruff retains the
same 17 inherited findings. The five focused Python removal tests include both held-lock pending
operation cases and active/cached timer recovery; no schema changes or migration bypasses were used.

Actual isolated Orca checks confirmed Save placement, hidden normal retry, clean background
adoption, preservation of newer typing, Cancel preserving the record, confirmed DELETE returning
404 thereafter, inspector closure, and read-only/disabled controls during a held real deletion ACK.
Both disposable verification entries were removed; existing demo entries and the preview database
were preserved.

Independent follow-up review (baseline `9a0f037`, implementation `7a4e533`): **Standards 1 P2**
documentation mismatch, resolved by clarifying that blur means note-field blur rather than window
blur; **Spec 0 findings**. No additional baseline smells were identified. The earlier two optional
maintainability notes remain separately recorded. The previous 1,236/916 gates above remain frozen
historical results. This follow-up is still local to the implementation branch, not merged/deployed
to the personal daemon.

## Owner-approved direct clock ±5 follow-up

The owner then asked why clock minus opened the editor instead of applying directly, and requested
seeing the explanation once rather than on every click. The owner requested full implementation
of the agreed change: one remembered explanation, subsequent direct ±5 clicks, invalid adjustments
refused without clamping, and previews retained for full **Adjust time**. This explicitly supersedes
the earlier per-click human preview requirement **for clock ±5 only**; server signing, CAS, receipt
hashes and exact interval/idle/lineage rules are unchanged.

`createQuickTimeAdjustments` stores only an accepted explanation preference in browser-local
storage, scoped to this TimeTrace origin. Each click captures the selected timer/revision and exact
running or manual-pause interval, obtains a signed preview, verifies its revision/target/delta and
checks current selection generation/drafts before committing through the original journal.
Concurrent clicks are not queued. Frozen/ambiguous/stale targets and dirty editors refuse; other
intervals are never substituted. One-time initialization is explicitly covered by the explanation;
fresh authoritative state must show only that initialization before the original intent continues.
A finalized own ACK remains usable if its display read hangs. Unknown writes hold the original
receipt; read-only recovery updates the quick result without issuing another correction.

Twelve public-controller regressions cover remembered consent/reload, Cancel/storage failure,
server refusal/current paused identity, stale signed revisions, duplicate clicks, A→B→A selection,
new typing, preparation races and ACK/uncertainty/recovery behavior. Actual fresh production-app
checks use a second isolated server on **18129**, not the owner's existing 18128 preview: first
explanation, automatic initialization, repeated direct running/paused steps and reload, refusal of
an under-five-minute subtraction without changing its timestamps, full editor preview/disabled
Apply preservation, and a deliberately dropped actual correction response recovered with one GET
and exactly one correction POST. Six-digit starts, creation anchor, note, other timer and associated
plan were preserved. Pre-Start plan creation revision 1 is not the correct baseline: the immutable
Start receipt establishes its reservation revision 2. GET-only focus enrichment was also excluded
from comparison against raw POST output. Those initial over-broad probe comparisons were corrected,
not represented as passing checks. Native Cancel was not claimed: the first dialog was already
accepted before the dismissal command; deterministic controller tests cover Cancel.

Final direct-control gates: **1,242 Python tests passed** (1,695 warnings, 9m09s), **931 Node tests
passed**, changed-JS syntax/scoped Python lint/whitespace checks passed. Full Ruff still has exactly
17 inherited findings. No backend protocol/schema/migration change was required.

Independent review of `fc836fd...c47af93`: **Standards 1 P2** (outdated user-facing Agenda help),
**Spec 0 findings**, and no new judgement smells. The help now distinguishes one-time-explained
clock clicks from full Preview/Apply; a public HTTP regression failed before that copy repair and
passes in the final full gate. Initial review counts are retained rather than rewritten as zero.
The older optional maintainability notes remain separate. The disposable 18129 server was stopped
without altering the owner's 18128 preview or its browser preference. Previous gates above remain
historical. These commits remain local/unmerged, with no personal-daemon deployment or native OS
notification/sound/platform certification claimed.
