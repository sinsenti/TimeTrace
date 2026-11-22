# Multiple timer implementation contract (#4)

Consumes [Agenda §6](agenda-contract.md#6-timer-v2-and-crash-reconciliation); no product-policy changes.

## Public interface

`GET /timers` returns a revision and all unfinished timer objects. Each carries UUIDv7 `id`,
`revision`, `state`, `task_id`, title, zero-or-one `scheduled_session_id`, tags, notes, mode,
target minutes, `pause_when_idle` (default true), active segments and independently identified gaps.
`POST /timers` starts taskless timers independently or selects the assigned task's existing
unfinished timer (running, paused or frozen), without Resume or association changes. Selection
returns `selected_existing` and `association_not_changed` information where applicable.
Starting an ended plan returns `scheduled_session_ended`; it does not edit that plan.

`POST /timers/{id}/{pause,resume,stop,split}` targets exactly one ID; mutation bodies include
`operation_id`, optional `expected_revision`; split additionally accepts new tags/notes.
Pause closes a buffer segment; Resume starts a new segment, refusing unresolved gaps. Stop records
positive segments using `SessionService.stage_recorded_work(..., provenance="timer")`, atomically
with its operation receipt, and retains a stopped tombstone. Split records completed segments but
retains identity. No live segment enters completed totals. Stable work IDs and operation/segment
identities are persisted, not reconstructed from current time on retries.

`GET /operations/{operation_id}` distinguishes `pending_reconciliation` and `finalized`.
Same key/payload returns the original result only after finalization; mismatched payload is 409.
Singular adapters retain zero/one shapes, otherwise refuse with `ambiguous_timer_target` and
candidate IDs. CLI status lists all timers; pause/resume/stop/split accept `--timer` unique suffix,
and recording controls accept `--operation` for retry across CLI invocations. No global action.

## State and idle

State is running → paused → running, running → frozen on idle, frozen → paused after selected
gap resolution, unfinished → stopped after recording. Each buffered segment snapshots task and
association; later metadata/context edits cannot retag past work. Manual pause creates no gap.
Idle clamps onset to each running segment start and freezes only opted-in timers. Activity polling
continues while frozen and closes each gap at return, not review. Claim/discard leaves paused;
open/uncertain gaps cannot be silently claimed. Keep the minimal targeted review controls until #5.

Under advisory lock, v1 conversion saves a backup and assigns one identity once. Retain all legacy
fields and complete pending-gap payload. Frozen work before idle is retained as a closed segment,
not resumed; legacy `idle_end` is detection evidence, not a proven return. Mark the gap boundary
uncertain and wait for observed return. Do not replace elapsed work by a guessed absence.

## Durability and reconciliation

One process-local serialization guard plus interprocess advisory file lock surrounds reread,
SQLite writer transaction and file reconciliation. The JSON file has version 2, revision, timers
and pending intent. An intent fixes payload hash, cutoff, expected generation, segment/work IDs,
result and complete after-state before any DB work. Atomic temp writes fsync file, replace and
fsync parent directory; failures propagate, never become warning-only success.

Every mutation, including idle and legacy callers, first reconciles pending intent or unfinalized
DB receipts. Intent without receipt completes its fixed DB transaction; receipt without installed
file installs its fixed after-state without reinserting work. DB receipt and staged work commit
together. File replacement then receipt finalization precede ACK. Different-key writes cannot
replace a pending intent. Revision mismatch/corruption fails closed `reconciliation_required`.
There is no cross-file/DB atomic commit claim. Recovery payloads are private, not SQL-widget data.
Task deletion/detachment and AI safety checks must observe all current and buffered contexts;
unsupported snapshot restoration refuses explicitly rather than bypassing timer invariants.

## Executable failure examples / agreed test seams

The first tracer is real-root HTTP start A/start B → distinct IDs → reread from a new service/process
→ both IDs preserved. It must fail before implementation and pass before the next behavior.
Subsequent public timer/restart tests cover these fixed expected outcomes:

- concurrent same-task starts yield one unfinished ID; paused/frozen Start selects without Resume;
- targeted pause A leaves B running; resume A excludes pause; repeated stop yields identical work IDs;
- fault before DB commit + restart records each fixed segment once; after DB commit never inserts again;
- replacement/finalization faults leave no ACK; another key and background idle must reconcile or refuse;
- same key/different payload refuses; no gap/segment is lost after a crash at any persistence boundary;
- legacy frozen payload preserves elapsed context and uncertainty through two independent restarts;
- Writing/Phone/Background 10:00, idle 10:10–10:30, discard/claim/keep yields 10/30/30, not review-delay work;
- singular HTTP/CLI with two timers refuses ambiguity without touching either;
- actual Agenda/Calendar shared controls preserve IDs on navigation/reload, stopped work remains outside plan fill
  when its timestamps are outside the plan, and original/current endpoints remain unchanged.

Use the six already-approved seams in Agenda §8. Migration evidence must include fresh chain and a
consistent synthetic old-copy upgrade with FK, JSON, polymorphic and existing saved-query checks.
The preceding interface is the checkpoint design, not a claim that every proposed adapter is enabled.

## Implemented #4 interface and recovery runbook

The additive root `/timers`, `/timers/{id}` and targeted pause/resume/stop/split/resolve routes
are implemented by `MultipleTimerService`; `TimerService` is the singular compatibility adapter.
All real timer writers, background activity, CLI and shared page controls use this funnel.
`GET /operations/{id}` exposes status/result, never recovery payloads. Timer recording stamps
`timer_id` and `timer_segment_id` on explicit work and commits through the #3 staging interface.
The private receipt table and unique operation/segment constraint are migration `0017_timer_receipts`.
Startup reconciles without inventing input activity; every subsequent timer mutation repeats the barrier.

Human task/subtree deletion stages history detachment, timer/buffer/gap detachment and its receipt
in one DB transaction, then finalizes the fixed file transition. AI v1 refuses unfinished timer
contexts; it cannot infer restoration or consent. Assistant reads list timers but omit opaque legacy
payloads and segment buffers. `unfinished_for_plan(plan_id)` is a read-only manifest seam for later
#6/#7 consumers holding SQLite's writer lock: it includes before/pending-after state and all
uncommitted segment/unresolved-gap associations without acquiring the advisory lock.

Timer reassociation/retarget preview/commit is **not enabled** by #4; there is no silent context
change through Start or Split. Later callers must not invent success for that proposed interface.
The independent minimal Claim/Discard controls are not #5's richer review screen. Legacy `break`
and `re_tag` adapters explicitly refuse unsupported classification instead of guessing. A legacy
uncertain first-return boundary cannot be claimed even after later activity is observed; retain it
for explicit review or discard once a return is observed. Known pre-idle segments remain intact.
An unavailable OS activity source returns unknown, never zero/proof of return. Polling observes
last input, not every physical event; exact first-input/reboot boundaries are not certified.

After a failed stop/split/resolve, keep the original operation ID **and payload**. Read its operation
status; `pending_reconciliation` is not success. Startup or the next mutation completes the fixed
intent/receipt transition before doing anything else; an explicit retry with the same key returns
the stable original work IDs only after finalization. Browser journals survive reload; Refresh is
read-only, Check saved operation reads the receipt, and Retry same operation uses the saved request.
Definite 4xx refusals are released only after serialized operation-not-found, never from a lost
response alone. Do not remove intent/receipt files or manually lower their generation to clear a
failure. Corruption/generation conflicts require preserving the DB, JSON, v1 backup and receipts
for diagnosis, not stamping or recreating schema. Back up DB and timer state consistently with
writers stopped. A receipt-bearing schema downgrade is refused; restore a matching backup instead.

File fsync/atomic replacement/directory fsync and advisory locking are exercised on this Linux host.
Other operating systems/filesystems and physical OS-idle inputs are not certified by the synthetic
fault/restart tests. See the task delivery evidence for actual suite/browser/migration results.
