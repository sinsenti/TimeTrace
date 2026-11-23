# Timer corrections #61 — implementation checkpoints

Authority: [#61 finalized contract](https://github.com/sinsenti/TimeTrace/issues/61#issuecomment-7101764274).
This checkpoint is **not delivery of #61**; the finalized contract remains required.
Existing #60 evidence in `timer-workspace-60.md` is unchanged.

Latest checkpoint: signed steps, dated starts and exact exclusions below supersede earlier
blanket preview refusals **only** for initialized explicit running/uncommitted-buffered targets. Earlier
checkpoint sections retain their historical evidence; this is still not full #61 delivery.

## Non-writing preview preparation gate

`POST /timers/{timer_id}/correction-preview` now has a dedicated strict schema and precedes
the legacy generic mutation route. This first checkpoint accepts only the contract's single
target shapes (`running`, `buffered`, `saved`) with `step_start` of exactly +300 or -300
integer elapsed seconds. Extra fields, coercions and other actions are rejected (422).
Explicit-date and exclusion request schemas are not implemented yet.

The endpoint **never issues a successful preview**. It inspects JSON without acquiring the
writing store lock, calling legacy `read`, reconciling receipts, upgrading files, allocating
identities, creating a backup/key, or persisting rows. Missing state, legacy v1 and old v2
return 409 `correction_initialization_required`, explicitly explaining that corrections are
not yet available in this build. After explicit initialization it returns `correction_not_enabled`.
An outstanding file intent or unfinalized DB receipt returns
409 `reconciliation_required` and directs recovery of the existing operation first. Corrupt
JSON/unknown formats fail closed. No automatic retry is performed.
The existing timer controls, mutation schemas/hashes and legacy store consumers are unchanged;
correction UI remains unavailable. The gate does not establish target existence/ownership or
validate a proposed interval, and its refusal must not be interpreted as an approved correction.

Public regressions in `tests/test_timer_correction_preview.py` exercise the real daemon root
HTTP route with synthetic persisted state. They compare all table rows and file bytes/identities/
modification times and directory entries before/after preview. The first regression failed
before implementation with 422 from the legacy mutation adapter rather than the required 409.
Subsequent coverage includes v1, old v2 missing running identity, pending old intent, unfinalized
receipt, absent parent directory, strict input rejection and all three single-target shapes.

## Explicit initialization and additive lifecycle checkpoint

`POST /timers/correction-initialize` accepts only a strict bounded string `operation_id`.
It runs inside the existing serialized mutation funnel: reconcile old fixed intent first,
check canonical operation hash/receipt, build an additive after-state, persist intent, commit
receipt, install file and finalize. Duplicate exact operations return their original result;
reusing a key for another canonical action conflicts. Old request schemas and hash calculation
are unchanged. No pending old after-state is normalized before replay.

Open work has `running_segment_id`; close reuses it as the closed segment ID. Start allocates
an unbounded uninterrupted identity, Resume allocates an identity bounded at actual resume,
and a running context split allocates one bounded at its split cutoff. Idle claims carry their
own onset-bound evidence. Closing copies `running_evidence` to segment `correction_evidence`.
Both evidence forms use `{version: 1, lower_bound: UTC instant or null, provenance,
forbidden_ranges: []}`. Provenance is `uninterrupted`, `resume`, `context_split`, `idle_claim`
or `legacy_unknown`. Forbidden exclusion ranges will be added by the later correction module;
the initialization checkpoint refused unknown/nonempty evidence rather than extrapolating it.
The exclusion checkpoint now validates and retains explicitly recorded forbidden UTC ranges.

Initialization classifies old shapes conservatively: only a validated plain open timer without
segments, idle gaps or opaque legacy payload receives an unbounded floor. Old closed work and
open timers with history/opaque recovery evidence receive their existing start as a conservative
`legacy_unknown` floor; this does not assert a real pause at that instant. Legacy v1 conversion
retains opaque payload and therefore cannot grant earlier extension. Existing closed IDs,
snapshots, associations and manual-pause note targets remain intact. New unknown/corrupt evidence
refuses initialization. A future correction trim must retain this evidence, not infer a new bound.

A separate `correction-signing.key` beside the configured DB is created only during explicit
initialization, using random 32-byte material, owner-only permissions and a fully fsynced temporary
file linked without replacing an existing key. Directory fsync follows. This happens before timer
intent persistence: a crash can leave only a key, reused on retry, not acknowledged initialization.
There is no cross-file atomicity claim. Existing invalid/symlink/insecure keys refuse rather than
being replaced; secrets are absent from intents, receipts and responses. Repeated initialization
and recovery preserve key bytes and segment IDs. Post-initialization preview remains nonwriting
and returns `correction_not_enabled`; missing/corrupt key requires recovery and is never recreated
by preview. Windows-specific key creation/permission behavior is not verified by this checkpoint.

Public regressions include initial 405-before/200-after initialization, duplicate and conflicting
operation IDs, old v1/v2, old fixed start-intent recovery before additive initialization, stable
pause/resume/stop identities and note targets, corrupt key/evidence and a real subprocess killed
at file replacement after initialization's DB commit. Two fresh process restarts then recover
through root HTTP with identical IDs/receipt results/key material. Focused suites passed 66 tests;
full delivery suites, other crash points and actual interval correction remain unrun.

## Signed five-minute start-step checkpoint

Initialized timers now support read-only signed preview and strict
`POST /timers/{id}/correction` commit for an explicit running segment or an explicit uncommitted
buffer. Saved targets refuse as unsupported; dated starts/exclusions are not implemented.
`+300` credits five elapsed minutes by moving actual start earlier; `-300` moves it later.
Pure core validation enforces positive work and conservative context floors/forbidden ranges.
Uninterrupted original start is not a false floor. Identity-preserving paused edits never
resume and retain the existing manual-pause note target. Snapshots, plans and unrelated timers
are not rewritten. These actual-work timestamps must not be treated as immutable focus-clock
origins by later features.

Version-1 strict envelopes authenticate resource, action, normalized request, cutoff, target
revision, dependency digest, exact before/after UTC intervals, duration and warnings with
HMAC-SHA256. Commit verifies in constant time, refreshes DB reads and reconstructs full approved
content under the existing locks/writer reservation before fixing intent. Dependency digests
include the selected timer/context and relevant tasks, plan/work/rating/recurrence/draft
manifests; unrelated timer/global generation and live elapsed seconds are not dependencies.
No client after-state is accepted. Target note/state/context changes, task detachment and
rating edits without timer revision invalidate approval. Exact accepted operation retries
return the original receipt before reconsidering stale signature/dependencies; different
payload reuse conflicts.

Running preview displays a pinned cutoff but commit changes only actual start; work continues
after the pinned cutoff until the normal lifecycle closes it. Accepted after-state/receipt
recovery never repeats arithmetic. Public root HTTP tests prove running/paused +/-300, bounds,
short/zero work refusal, explicit ownership, immutable previews, semantic/route/signature
forgery, stale dependencies, unrelated activity, note-pointer preservation and exact retry.
A subprocess dies before file replacement after correction DB commit, then two processes
recover the fixed correction and idempotent Stop with one exact saved interval. Other crash
points/full concurrency remain delivery checks, not passing claims for this checkpoint.

## Dated-start and exact-exclusion checkpoint

Dated starts use `{kind: 'set_start', start_utc, timezone, local_datetime, offset_seconds}`.
The IANA zone must exist; explicit naive local date/time and chosen offset must roundtrip from
aware zero-offset UTC. Nonexistent DST times refuse; both fall-back folds are selectable only
with their correct explicit offsets. There is no same-day restriction. Version-2 signed dated
envelopes include local dates/offsets on both sides, absolute durations and rebucketing consequence.
Running and paused identity-preserving trims keep state and eligible note pointer; real context
floors and forbidden coverage remain immutable through trim/restore.

Exclusions use `{kind: 'exclude', start_utc, end_utc, timezone, start_local_datetime,
end_local_datetime, start_offset_seconds, end_offset_seconds}`. Target may be one explicit
running/buffered target, or `{kind: 'selection', targets: [...]}` for up to 64 explicitly chosen
running/buffered targets. Duplicate targets refuse; selection order is normalized. Saved targets
remain unsupported. Every selected interval must intersect positively and retain positive work;
zero/reversed/future/touching/no-op and complete removal refuse atomically. End exactly at signed
cutoff is allowed. No subtraction spills into an unselected interval.

Version-2 exclusion approval authenticates every retained fragment's source/allocated identity,
UTC endpoints and running status, exact removed coverage, already-uncredited gap duration,
unselected-covered duration and positive-work warnings. Allocation during preview is nonpersistent;
commit authenticates and reconstructs with those server-signed allocations, rejects collisions,
then fixes server-owned after-state through existing receipts. A real pause gap is labeled as
already uncredited, not treated as removed work; unselected covered work is disclosed separately.

11:00–11:30 minus 11:10–11:15 retains 11:00–11:10 and 11:15–11:30. Earliest retained work keeps
original ID. Running middle split closes left and continues right with a new stable ID; paused
stays paused. For tail exclusion ending at running cutoff, the positive left is closed and a new
open continuation starts at cutoff with zero previewed work, never persisted as a zero row.
All snapshots are preserved; forbidden coverage is appended to each affected fragment and survives
reinitialization so later step/date edits cannot resurrect the break. Pointer clearing is scoped
to splitting its own eligible interval; splitting an older interval preserves untouched pointer.

Version-1 step wire dumps/hashes gain no defaults. A genuine accepted request/hash/result fixture
from `7a3a37e` is replayed unchanged through two fresh processes, without its historical signing key.
Version-2 date/exclusion envelopes coexist explicitly rather than changing v1 receipt meaning.
Public tests also cover overnight/DST, exact edge/middle/multi-target gaps, invalid atomic selection,
pointer scope, forged allocations/ranges/cutoffs, stale/unrelated state and post-DB/pre-file process
crash followed by fixed fragment IDs and idempotent exact Stop rows across two restarts.

Focused related suites passed 123 tests before final gap-disclosure hardening; final correction/
initialization/gate suites passed 89 tests after it, followed by 35 interval-specific tests
including final presentation-schema hardening and mixed buffer/running selection. Other durability/concurrency, SQL lineage,
UI/browser and full-delivery suites remain unrun. The immutable focus/warning clock origins of
neighboring features are not edited or implemented here.

## Next milestone

Implement saved interval lineage/staging, CAS and replay guards with migration verification,
then complete durability/recovery, controller/browser UI and complete #61 acceptance. Do not
enable correction controls based on these backend checkpoints. Full Python/Node, migration,
crash/concurrency and real-browser acceptance remain required at eventual complete delivery.
