# Agenda shared technical contract

Canonical owner: [#2](https://github.com/sinsenti/TimeTrace/issues/2), parent
[#1](https://github.com/sinsenti/TimeTrace/issues/1). **Reviewed contract; the owner confirmed all six testing seams and requested the first test-first #2 foundation slice.** This is not completion of #2 or authorization to bypass downstream blockers, push or merge.
Static base: `c7b34560bd442f029c6fa5289ce318784c6791ec`.
Owner decisions [1–5](https://github.com/sinsenti/TimeTrace/issues/2#issuecomment-6959318824) and
[6–9](https://github.com/sinsenti/TimeTrace/issues/2#issuecomment-6959657373) supersede older questions.
[Q10–12](https://github.com/sinsenti/TimeTrace/issues/2#issuecomment-6959931616) are owner-approved.
See [accepted boundaries](adr/0001-explicit-recorded-work-boundaries.md).

## Implemented exact removal interface (#7)

`GET /scheduled-sessions/{id}/removal-preview` returns an immutable-scope manifest and
`consent_token` fingerprint, plus per-action refusal reasons. The manifest includes the whole
selected plan, exact `scheduled_session_id`-owned work (including outside portions), revisions,
metadata, recurrence anchors, rating/draft dependencies and unfinished timer contexts. Opening or
canceling persists nothing. The token is a scope fingerprint, not an authentication credential.

`POST /scheduled-sessions/{id}/removal` accepts `action` (`delete_everything` or `squeeze`),
`consent_token` and a fresh `operation_id`. One explicit choice confirms the displayed whole
manifest. Under SQLite writer ownership the server rebuilds and compares the manifest and reads
`MultipleTimerService.unfinished_for_plan` without taking its advisory lock. Changed scope and
unfinished timers refuse both actions. Squeeze changes only the current envelope, retaining gaps,
originals and work timestamps; empty associated work refuses. Delete removes whole owned work and
the selected plan atomically, converting its recurrence override to a skip. Work with live rating,
AI draft restoration or legacy recurrence dependencies currently safely refuses deletion; metadata
and append-only audit history are never silently discarded. Existing typed AI/legacy delete guards
remain in force, as do task-completion, detachment and series-history protections.

The existing private `MutationOperation` table stores database-only finalized receipts in the
`plan-removal:` namespace (no timer recovery state). The returned namespaced `operation_id` can be
read at `/operations/{operation_id}` after a lost acknowledgement. Same key/payload returns the
original result even after deletion; a different payload refuses. Browser recovery only reads;
a new preview/action is a new approval, not an automatic replay. No migration is required.

## 1. Settled boundaries and remaining owner choice

Retain Folio B/Calendar, multiple initial timers, warning-only same-task overlap, no cross-task
warning, default idle pause, no auto-extension/overlap reconfirmation, uncertain history and
original/current/work separation.

Nine settled inputs: explicit zero-or-one work association, never matching-based; new manual work
rejects future ends while old APIs retain compatibility; taskless work contributes elapsed and
separate unassigned unions, not recorded task time; old accounting basis remains alongside labeled
unions; no missed-virtual archive; Delete everything needs consent to the **whole** associated
record, including outside portions; Delete/Squeeze block on unfinished associated timers including
manual pause and unresolved gaps; Start selects unfinished paused/frozen timers without resuming;
gap resolution leaves paused, with absence ending at return activity, not review time.

Additional **settled owner inputs (Q10–12)**:

- Association requires equal non-null assigned task IDs. Taskless/different-task work needs an
  explicit task assignment change before attach; never implicitly retag. Work Task A → plan Task B
  rejects without changing either. Task deletion preserves work and removes invalid associations.
- Start from plan Y when the task already has an unfinished timer for X selects that timer with
  its association unchanged, visibly reporting it (`association_not_changed`). Changing association
  requires a separate explicit action; already-recorded work never moves retroactively. Proposed
  reassociation preview freezes its scope and refuses unresolved gaps.
- New unions select records by local start-date range, retain whole intervals without clipping,
  and use local start-day buckets. Example: 23:30–00:30 is wholly credited to its start day;
  tomorrow excludes it despite covering tomorrow's first 30 minutes. Recompute scalar unions
  independently of groups/limits; overlapping day/group totals are non-additive and labeled.
  Old measures and negative/unbounded budget behavior remain unchanged.

[Q14 is owner-approved](https://github.com/sinsenti/TimeTrace/issues/2#issuecomment-6960719516): minute-level split-evenly tag allocation before filtering for new union measures (§3), without renormalization. Existing duration-based measures remain unchanged.
Its recommendation is not an accepted policy. Technical interfaces and test seams also need shared review.

## 2. Representation, identity and recurrence

**Schema proposal:** retain `session` for legacy/work identity and metadata; add `kind`
(`legacy_uncertain` default, `recorded_work`), provenance (`manual`, `timer`, otherwise null),
nullable `scheduled_session_id`, `timer_id`, operation/segment identity, and revision. Existing
rows retain IDs and all timestamps, durations, links and metadata; originals stay null.
No timestamp/title/tag classification. Old untyped creates also default legacy.

Add `scheduled_session`: UUIDv7 string ID, nullable task FK for detachment compatibility, immutable
`original_start/end`, mutable `start_time/end_time`, metadata matching existing editable session
fields, revision. This physical separation prevents elapsed **new plans** entering saved raw
`session` SQL or performed-work readers. New work retains `session` review/rating identities.
Validate interval ordering and kind-specific
fields; one nullable FK gives work zero-or-one association, never inferred ownership. Reject direct
kind/original/provenance edits.

Enforce equal non-null task IDs **atomically on every associated work/plan edit and timer
retarget**, including legacy PUT adapters, not just attachment. Cross-table equality needs service
validation under the shared lock/transaction; FKs alone cannot enforce it. Reject task changes
that invalidate any work/timer association (`association_task_conflict`), unless an explicit,
previewed detach/reassociation accompanies the change. Never retag the opposite entity or silently
detach. Attach itself cannot change task assignment. Validate the final graph and target-task
unfinished-timer uniqueness before committing anything. Task deletion remains the separately
approved history-detachment behavior, not work deletion. Any attachment, detachment, task/context
change or affected record edit increments work/timer and old/new plan revisions; plan task edits
also invalidate all affected manifests, including those retaining matching-but-unowned work.

`SessionService` remains the real/virtual merge and mutation funnel, dispatching IDs without
numeric coercion; a bounded planning read returns a discriminated union (`scheduled_session`,
`recorded_work`, `legacy_uncertain`, plus `is_virtual`). Work-only reads never include plans.
Old GET/PUT/DELETE retain row-shaped adapters; typed plan deletes require consent.
Legacy edits stay uncertain; no migration moves legacy IDs. Audit/rating/JSON references retain type/ID.

Extend `RecurrenceException` with nullable scheduled-plan FK, retaining old `session_id` links;
require exactly one target for an override, neither for a skip. Existing links stay unchanged.
Explicit occurrence edit/start/record/attach captures projected start **and end before mutation**
in a materialized plan, atomically with exception/action; return the real ID.
Concurrent materialization uses the existing unique `(task_id, occurrence_start)` backstop.
`virt:` identity/anchor, only-this/all-future resize and following/all deletion scopes survive.
Keep existing fully-elapsed virtual rejection; no reads materialize/archive missed occurrences.
Transient originals reflect the current RRULE until capture, not invented historical originals.

Exclude new work from recurrence suppression/adoption; retain fingerprinted legacy reconciliation.
A work overlay leaves its projected plan visible; materialized plans replace only their occurrence. Series edits preserve captured
originals, skips/moves and recorded history; future schedule clearing never cascades into work.

## 3. Interval/query contract

Use positive half-open UTC intervals `[start,end)`, naive UTC storage and `ensure_utc()` boundaries.
Pure `core` union/intersection/difference/envelope functions supply service results and SQL-oracle
tests. Touching endpoints do not overlap; new durations derive from endpoints.

Select explicit, closed recorded rows ending at/before one captured measurement instant; exclude
legacy and all unfinished timer buffers. Apply record-start range and non-tag filters, preserve
whole intervals; group by local **record start**, with explicit week start and existing daemon-zone
fallback/warning. DST changes elapsed seconds, not wall-clock subtraction. A New York fall-back
00:30−04:00 → 02:30−05:00 record credits 180 minutes to its start day; never slice UTC dates.

For selected records `R`, task unions `U_t`, and taskless union `U_0`:

- Recorded task time = sum of lengths of `U_t` for non-null tasks.
- Elapsed recorded time = length of union of all R; unassigned = length of `U_0`.
- Per-plan fill = `U_t ∩ plan_interval`, separately original/current labeled.
- Aggregate inside = intersect each `U_t` with the **union** of matching plan windows; outside =
  its difference. Plan-window lookup includes overlapping windows regardless of their start day;
  plan filters are explicit and distinct from work filters. Taskless work fills no task plan.

Same task 09:00–10:00 + 09:30–10:30 retains two rows, credits 90 minutes. Different tasks credit
120 task minutes / 90 elapsed. Unowned work can fill two plans without becoming associated;
aggregate inside counts each same-task minute once. Taskless coverage may overlap task coverage:
unassigned + recorded task time is not elapsed time. Squeeze uses only associated work's envelope:
09:10–09:30 and 09:50–10:10 → 09:10–10:10, retaining the gap and original.

Extend registry/compiler/`QueryService`, not a hardcoded Stats page: `recorded_work` source;
seconds internally, labeled hours publicly. Bounded SQL uses running-maximum-end gaps/islands
(LAG end alone fails nesting); no full-table Python aggregation.

**Proposed capability boundary:** `time` = local start day/week/month/hour-of-day/weekday;
`task_metadata` = task/category/status/priority. Up to two dimensions, except plan fill below.
Common work filters: start-date range; time eq/in; task/task-parent/category/status/priority eq/in;
has_task boolean; notes contains; duration_seconds eq/gte/lte; provenance eq/in. Filters inspect
raw records, not derived union duration. Tag filters support eq/in only (any matching tag), not
implicit record exclusion via negative-tag predicates. Plan selection is a separate `plan_ids`
filter; comparisons require explicit `basis: original|current`. Other combinations fail capability
validation before execution, including unknown measures/operators and tag-based comparisons.

| Measure | Supported dimensions | Filters beyond required range | Basis / attribution |
| --- | --- | --- | --- |
| `recorded_task_time` | time, task_metadata, tag | Common + tag | Non-null tasks; fan-out default; owner-approved split-evenly rule below |
| `elapsed_recorded_time` | time, task_metadata, tag | Common + tag | Includes taskless; same attribution choices |
| `unassigned_recorded_time` | time, tag | time, notes, duration, provenance, tag; has_task=false only | Taskless only; same attribution choices |
| `inside_scheduled_task_time`, `outside_scheduled_task_time` | time, task_metadata | Common + plan_ids; no tag | Require original/current; aggregate matching windows unioned per task; no taskless credit |
| `plan_fill` | plan_id only | Common + plan_ids; no tag | Require original/current; return each plan's intersection, never sum overlapping fills |

Compute independent non-tag groups and an independent full-range scalar; neither uses the other's
result. All scalar calculations precede sorting/row limits. Start-day groups can overlap in UTC
across midnight; elapsed task/category groups and per-plan fills overlap. Return explicit basis,
cohort and `non_additive` labels; legacy measure totals/limits/attribution remain unchanged.

Concrete cohort/filter order (same for scalar and each non-tag group):

1. Select `R0`: closed explicit work, measurement instant, local start-date range, non-tag filters.
   Keep whole intervals; derive non-tag group membership from record-start/metadata.
2. For fan-out tag reads, tokenize/deduplicate tags per record (`#general` if none), apply tag
   eq/in, then union the **distinct matching record IDs**, not all of R0. A tag group gets only
   its matching records; the independent scalar gets all matching records once, not summed groups.
3. **Owner-approved Q14:** for split-evenly, within each non-tag group
   (and separately the scalar's full R0), sweep atomic segments before tag filtering/grouping.
   Divide each segment's credit among distinct active tags: per task for recorded task time,
   across tasks for elapsed, taskless-only for unassigned. Then filter allocated tag portions,
   group by tag if requested, and sum retained portions; never renormalize after filtering.
4. For split-evenly, `value_seconds`/`attributed_total_seconds` is the retained attribution, not
   the physical union. Separately return `physical_cohort_seconds`: the same measure's union of
   distinct tag-matching record IDs; return cohort count/predicate/basis for drilldown. For fan-out,
   scalar value equals that physical union; tag rows can overlap. No-tag reads credit all tags
   once, yielding the measure's physical total. Comparison queries apply their plan-window
   intersections/differences after record selection; neither tag filter nor tag grouping is enabled.

Q14 review examples: one 60-minute record tagged #a/#b splits 30 each; filter #a yields attributed
scalar **30**, physical cohort **60**, not value 60. Two simultaneous same-task #a-only/#b-only
60-minute records also split 30 each, while raw rows remain separate. Distinct tasks instead retain
independent recorded-task credits (120 total), versus elapsed 60; per-task split is 60 each,
while elapsed split is 30 each. Fan-out filter #a selects only #a-matching records, not unrelated
#b-only work; deduplicate IDs so multi-tag matches do not inflate the scalar. These examples implement
the accepted Q14 rule; advertise only actually implemented combinations and reject unsupported
capabilities rather than silently changing attribution.

## 4. Consumer compatibility (must land with storage, not wait for #8)

| Consumer / live seam | Required adapter or safe refusal |
| --- | --- |
| Calendar/session modal, Agenda, task quick-add `TaskService._create_scheduled_session` | Explicit scheduling creates new plans, including past blocks; minimal Calendar kind-aware dispatch in #2. Old arbitrary POST `/sessions` remains uncertain compatibility. Preserve quick-add/title parsing/inheritance. |
| CLI retro, `/sessions/retro`, old manual callers | Preserve future-end acceptance, response/status and legacy classification. New explicit CLI `work add` uses future-rejecting recorded flow. Never silently upgrade old intent. |
| `TimerService` stop/split/idle direct writes | Route through shared recording transaction/receipts; explicit timer provenance, never create plans. |
| Markdown import/export, merged agenda export | Preserve existing lossy Markdown shape and taskless legacy import behavior; never infer new kind/association or promise restoration of IDs/originals/metadata. Existing persisted metadata stays intact. Reject unsupported typed/snapshot restore explicitly rather than silently discard fields. Lossless/versioned interchange is deferred, not required Agenda scope. Agenda output merges projected/persisted plans separately from work and labels them, without treating the format as backup/restore. |
| Completion own-selection/subtree clear; series scopes | Preserve prompts/independent choices; clear schedules only, preserve work. Preview exact plan/association detachment scope; refuse unsupported consent or unfinished timers, never silently broaden clear into Delete everything. |
| Task deletion / bulk completed deletion | Preserve historical rows, detach task links including timer context under shared durability lock; keep originals/work. Clear invalid associations in the detachment transaction, never delete work. |
| Revision, session reviews/reflections, ratings | Existing `session` IDs and metadata unchanged. New plans excluded from performed evidence; legacy labeled separately, not rewritten. No plan ratings/review target invented. Audit dangling polymorphic references separately. |
| Inspector + AI task progress / estimation | Keep raw legacy-inclusive accounting basis and single measurement instant: logged legacy/work closed ≤ now; scheduled legacy closed future-start plus new future plans; no elapsed plans, virtuals or live buffers. No union replacement. Keep negative balances, >100%, nonpositive null progress, zero/missing/recurring unbounded and per-occurrence estimates; negative estimates remain accepted with existing balance semantics. |
| Persisted dashboards/queries; read-only SQL | Saved `sessions` SUM/count specs still address legacy/work, never new plans; label legacy-inclusive, do not rewrite specs/seeds. Add new capabilities explicitly. Existing SQL `session` stays compatible; review allowlisting only plan analytic fields, never receipt payloads/AI tables; preserve mode=ro/query_only/authorizer/timeouts. |
| AI drafts, snapshots, stale/accept/delete/undo/reapply | Version new snapshots with kind/original/current/provenance/association/revision, full preserved metadata and dependent-work manifest. Keep v1 JSON/audit immutable; allow old ordinary legacy operations only when exactly restorable, otherwise conflict/refuse with reason. New-plan/work mutations unsupported until version-aware adapters; no new AI scheduling. |
| AI undo and read-only insights | New associated work after proposal or apply makes plan delete/undo stale. Undo of a create cannot erase later work. Require same destructive preview/consent as humans, including reapply; no consent from model text. Preserve old new-ID undo trail for supported legacy restores; refuse unsupported dependent restoration rather than lose ratings/links. Keep `parse_title_syntax=False`, separate tool sessions, scope/redaction/fake-provider safeguards; scheduling reads consume plans, statistics keep labeled basis, timer reads consume targeted status. |

## 5. Proposed HTTP/CLI and consent

IDs symbolic; `D` = date:

```text
POST /scheduled-sessions {task_id:T,start_time:D09:00Z,end_time:D10:00Z}
201 {id:P,kind:scheduled_session,original_start:D09:00Z,original_end:D10:00Z,revision:1,...}
POST /recorded-work {task_id:T,start_time:D09:30Z,end_time:D10:30Z,scheduled_session_id:null}
201 {id:W,kind:recorded_work,provenance:manual,warnings:[{code:same_task_overlap,
     record_ids:[W0],overlap_seconds:1800}],...}
GET /agenda?start=...&end=... → 200 {items:[...],measurement_at:...,basis:...}
POST /timers {task_id:T,scheduled_session_id:P,pause_when_idle:true,operation_id:O}
200 {timer:{id:M,state:running,...},selected_existing:false,information:[...]}
GET /timers → 200 {revision:7,timers:[{id:M,state:paused,idle_gaps:[...],...},...]}
POST /timers/M/stop {operation_id:O2,expected_revision:7}
200 {operation_id:O2,recorded_work_ids:[W1,W2],timer:{id:M,state:stopped,...}}
timetrace start --task <suffix>; timetrace status
timetrace pause --timer <suffix>; timetrace stop --timer <suffix> --operation <uuid>
```

Targeting/association examples (all mutations use operation IDs, expected revisions and §6's barrier):

```text
POST /timers {task_id:T,scheduled_session_id:P2,operation_id:O3}
200 {selected_existing:true,timer:{id:M,state:frozen,scheduled_session_id:P1,...},
     information:[{code:association_not_changed,requested:P2,current:P1}]}
# Also applies to state:paused; no Resume, gap loss or second timer.
POST /timers/M/association-preview {scheduled_session_id:P2,expected_revision:8}
200 {manifest_token:KA,scope:future_segments_only,old:P1,new:P2,recorded_work_unchanged:true}
POST /timers/M/association {scheduled_session_id:P2,manifest_token:KA,operation_id:O4}
200 {timer:{id:M,scheduled_session_id:P2,...},effective_from:<commit cutoff>,recorded_work_ids_changed:[]}
# Frozen/unresolved gap: 409 {code:idle_gap_unresolved,timer_id:M,gap_ids:[G]}; no mutation.
POST /timers/M/gaps/G/resolve {decision:discard,expected_revision:9,operation_id:O5}
200 {timer:{id:M,state:paused,...},gap:{id:G,decision:discard,return_at:...},recorded_work_ids:[...]}
POST /recorded-work/W/association-preview {scheduled_session_id:P,expected_revision:3}
200 {manifest_token:KW,work_id:W,old:null,new:P,full_interval:[...],...}
POST /recorded-work/W/association {scheduled_session_id:P,manifest_token:KW,operation_id:O6}
200 {id:W,scheduled_session_id:P,revision:4,...}
# Detach uses the same preview/commit paths with scheduled_session_id:null.
PUT /sessions/W {task_id:OTHER} → 409 {code:association_task_conflict,work_id:W,plan_id:P}
# No opposite-side retag; explicit detach preview/consent is needed before incompatible task edits.
POST /scheduled-sessions/P/actions {action:squeeze,manifest_token:KS,operation_id:O7}
200 {id:P,start_time:D09:10Z,end_time:D10:10Z,original_start:D09:00Z,
     original_end:D10:00Z,recorded_work_ids_unchanged:[W1,W2],revision:...}
timetrace stop → ambiguity error listing M1,M2; no request to stop either
timetrace stop --timer <unique-suffix> --operation <uuid> → target M1 only
```

Running reassociation closes its old-context buffer segment at the commit cutoff and starts a new
context segment; paused reassociation changes only the context for a later explicit Resume.
Each buffered segment retains its task/association snapshot, including pre-cutoff work not yet
committed. Completed records never move. Frozen/gap refusal applies to preview and commit.
Plan manifests/invariant checks include the timer's current context **and all uncommitted
segment/gap associations**. Retargeting does not release the old plan's unfinished-timer block
while buffered work still references it.
Work/plan association previews identify affected old/new plans and full record scope; taskless or
mismatched attach returns 409 `association_task_conflict`; stale token returns 409 `manifest_stale`.
Timer task retargeting additionally checks the target task has no other unfinished timer; conflict
returns 409 `task_timer_exists`, preserving both timers. Direct adapters cannot bypass these checks.

New domain validation: 400 `future_recorded_end` / `invalid_interval`; missing entity 404;
schema errors 422. Proposed new conflict exception maps 409 for stale revisions/manifests,
`ambiguous_timer_target`, `associated_timer_unfinished`, `operation_payload_mismatch`.
Preserve ordinary old error mappings; new invariant/consent conflicts also apply to adapters.
Singular timer adapters work for zero/one eligible timer, preserve old shape, refuse ambiguity
with candidate IDs; never select-all. Ended-plan Start
returns information, not extension. Applying a previewed extension updates only current endpoints,
without overlap warning/second confirmation.

`POST /scheduled-sessions/P/delete-preview` returns plan original/current/revision, exact associated
work IDs/revisions/**full** intervals/metadata digests, affected review/rating references, associated
timer/gap states, action availability and opaque token. Preview/cancel writes no domain data.
With unfinished associated timer: both Delete/Squeeze unavailable; show stop/resolve instructions.
With no associated work: Squeeze unavailable, do not invent bounds. Confirmation body:
`POST /scheduled-sessions/P/actions {action:delete_everything,manifest_token:K,operation_id:O}`
returns 200 with deleted IDs and receipt; Squeeze uses this route with `action:squeeze` as above.
Under lock/transaction rederive the exact manifest; any work, attachment, timer or dependent-reference
change returns 409, requires new preview
and new consent. Delete plan/original/work and consented dependent cleanup atomically; preserve
unrelated matching work. For a 09:00–10:00 plan, owned 08:50–10:10 work is wholly listed/deleted.
Squeeze's manifest also shows its proposed envelope and unchanged work IDs; stale state is 409,
no work is `400 squeeze_no_associated_work`, unfinished associated timer is 409. It updates only
current endpoints; virtual deletion retains skip. Resume is always separate from gap resolution.

Calendar/Agenda adopt returned IDs/ACK/receipt before refresh; Retry refresh reads only. Uncertain
receipted requests query `GET /operations/O`, then retry **same key/payload**; old writes remain uncertain,
never auto-replayed. Consent changes require new approval, not a retry that broadens scope.

## 6. Timer v2 and crash reconciliation

File v2: `{version:2,revision,timers:{id:...},pending_operation:...}`; each timer has UUIDv7 ID,
task/context/association, mode/target, pause-on-idle, state `running|paused|frozen|stopped`, accumulated
active segments, running segment start, and independently identified gaps `{id,onset,return_at,
decision,boundary_source}`. Split preserves timer identity, closes selected segment, changes future
metadata only. Stop commits positive segments, leaves a receipt/tombstone; zero time creates no work.

Serialize daemon service mutations, including legacy adapters/direct-writer replacements, using a
shared local advisory file lock plus SQLite transaction; re-read state under lock. The reconciliation
barrier below runs **before every mutation**, including background idle, not only at startup.
Enforce at most one unfinished timer per non-null task (covers settled paused/frozen selection); taskless timers remain independent.
Resume refuses unresolved gaps. Idle onset clamps to each active segment start. Continue observing
activity while frozen: close absence at returned activity timestamp, not detection/review time;
manual pause creates no gap. Claim/discard selected gap only; both leave paused. At 10:30 approved
Writing/Phone/Background example yields 10/30/30 recorded minutes after targeted resolution/stop;
10:30–10:45 review delay adds zero.

Add private DB `mutation_operation` receipts: unique operation ID, payload hash, before/after file
revision, fixed cutoff, fixed after-file state, row IDs/result and `file_finalized` marker; unique
work operation/segment index. Under the shared lock: (0) reconcile pending intent or unfinalized
receipt before another mutation; (1) atomically write/fsync intent with fixed segments/cutoff,
after-state and expected generation; (2) one DB transaction writes work and unfinalized receipt;
(3) atomic temp-write/fsync/replace plus directory fsync installs post-state and clears intent;
(4) verify that file transition, mark receipt finalized, then ACK. The receipt retains recovery
data if replacement removed the intent but directory fsync/finalization failed.

At startup **and before every API/service/background-idle mutation**, pending intent + DB receipt
replays the file transition only; intent without receipt completes its fixed transaction once, then
the file transition. An unfinalized receipt without intent verifies/reinstalls its fixed after-state,
never reinserts work. Revalidate expected generations; corruption/conflict fails visibly closed.
A failed file replacement may leave a live daemon: it must finish reconciliation or refuse further
writes (`409 reconciliation_required`, background idle leaves state untouched). Another operation
ID must never replace the pending intent. Even a same-key replay returns the original result/IDs
**only after its file transition is finalized**, not merely because its DB receipt exists.
`GET /operations/O` distinguishes `pending_reconciliation` from `finalized`; an uncertain caller
cannot treat the former as ACK. Reconciliation cannot recalculate cutoffs or record the same segment
under another key. DB/file commits are not jointly atomic; no queue is introduced.

Upgrade singular file under lock with backup: assign/persist identity once, retain all fields and
pending-gap payload, never resume frozen state. Existing idle_end is detection-time, not proven
return: preserve/flag boundary uncertainty, never silently claim a full absence. Legacy gap recovery
and OS/reboot activity-timestamp limitations require the #4 checkpoint's concrete recovery review.

## 7. Migration and intermediate delivery

After current head `0013_ai_data_scope`: add plan table/constraints, session discriminator/nullable
links, exception alternative FK, revisions/indexes; backfill **only** default legacy kind. Add
receipt storage before enabling new timer writes. Index work task/start/end, association, plan task/
current interval, and unique operation/segment. Preserve quoted/Optional relationships. Verify
legacy row/metadata counts, FKs, recurrence links, ratings `(target_type,target_id)`, draft/audit
JSON and widget specs independently; FKs miss polymorphic references.

Set absolute `TIMETRACE_DB_FILE` in a private temporary directory before any app import/command;
timer/key siblings must also be isolated; use a non-8002 scratch port.
Run the full fresh Alembic chain **and a separate isolated existing-copy upgrade**. Safe source:
create a disposable synthetic DB at the old revision, seed realistic legacy data, stop its writers,
make a consistent SQLite backup/copy, then upgrade the copy. Compare source/copy IDs, all metadata,
relationships, rating targets, draft/audit JSON and widget specs before/after; require empty
`foreign_key_check` and expected revision/ORM reads. Never use personal data without separate
explicit authorization. Synthetic edge fixtures (null/open/future/straddling rows, moved/skipped
recurrences, reviews/ratings, pending/applied AI JSON and running/frozen v1 files) supplement, not
replace, the copy step. No stamping/create_all fallback.
Downgrade cannot encode separated plans/multiple timers: stop writers,
export/snapshot DB **and** file/receipts; after v2 writes restore a consistent backup or refuse
lossy downgrade, never drop new work to fit old schema.

Native edges unchanged: #2 → #3 → #4; #4 → #5/#6/#7/#8; #3 → #9; #5–#9 → #10.
#2 lands cohorts/adapters/minimal Calendar safety; #3 exposes manual/query semantics. Existing
singular timer writes remain legacy-compatible until #4 switches to receipts/shared recording.
#4 preserves default idle freeze/minimal targeted resolution before #5's screen. Parallel #6/#7/#8
expose only implemented capabilities, never fake success/destructive bypass; #9 shares query semantics.

## 8. Agreed verification seams

The owner confirmed all six seam groups below before Agenda tests were written. Apply them to the
active ticket's scope; agreement does not unblock later tickets or make unrun checks pass.

- Extend `test_session_service.py`/`test_session_editing.py`: public service + real-root HTTP create,
  immutable-original edits, elapsed plan zero work, unchanged legacy, warning-only overlap,
  association manifests/stale consent, both-sided task edits and legacy-adapter invariant rejection.
  Catches routing/schema filtering; not browser/restart.
- Pure interval tests plus `test_analytics_query_service.py` and `test_query_comparison_identity.py`:
  90/120/90, nested overlaps, two-plan unowned fill, taskless overlap, midnight/DST, tag attribution,
  scalar/top-N, tag filter/attribution order and original/current SQL-versus-pure oracle. Include
  the accepted Q14 examples, including attributed 30 versus physical cohort 60. Not migration proof.
- Extend `test_recurrence_service.py`, `test_task_work_accounting.py`, `test_ai_proposal_approval.py`:
  work overlay retains plan, original capture, no archive/resurrection, completion/task detachment,
  unchanged negative/unbounded budgets, v1 refusal/v2 stale delete and undo after new association.
  Fake gateways/providers only; not real-model quality evidence.
- Extend `test_timer_recovery.py`: public targeted HTTP/service tests, concurrent duplicate starts,
  paused/frozen selection, staggered idle and 10/30/30; inject failure before/after DB commit/file
  replace and retry same operation; force another operation ID/background idle mutation after
  replacement failure to prove the reconciliation barrier prevents duplicate work. Add isolated
  process restart/crash/file-upgrade cases. TestClient skips lifespan/create_all misses migration.
- Node caller tests around `session_modal.js`, `calendar.js`, `timer_control.js`, shared client:
  returned-ID adoption, held refresh, ACK/read-only retry and stale-target refusal. Actual isolated
  browser/daemon checks cover Calendar ↔ Agenda ↔ Stats, multiple timers across navigation/reload,
  per-gap review, consent changes, narrow layout and console errors. Mocks miss real DOM/lifecycle;
  synthetic idle misses OS behavior.
- Separate fresh-chain/existing-copy migration runner verifies constraints, JSON/polymorphic integrity and
  ORM-backed reads. Final #10 runs full Python/Node regression, changed-JS syntax, Ruff baseline
  comparison, whitespace and scratch health, independent integrated review and explicit human gate.

Unrun: tests/runtime/migrations/providers. Risks: adapters, SQL cost, gap recovery, lock/fsync
portability and AI restoration. Initial independent reviews blocked the earlier draft; subsequent
bounded verification found the repairs addressed all concrete technical findings, conditional on Q14
and test-seam agreement. The owner has now accepted Q14 and confirmed all six seam groups; the
first test-first #2 foundation slice is authorized in its isolated worktree. No downstream ticket
completion, push or merge is implied. AI wrapper bug #57 is separate.

## #3 implemented query capability boundary

`recorded_work` queries require a finite local start-date range (maximum 400 days).
Initial measures: recorded_task_time, elapsed_recorded_time, unassigned_recorded_time,
inside_scheduled_task_time, outside_scheduled_task_time and plan_fill. Values are hours.
Only scalar and task grouping are enabled initially; plan_fill uses plan_id only.
Only task eq/in filters and independent explicit plan_ids selection (up to 500 persisted or virtual IDs)
are enabled. Plan lookup is independent of work-start dates. Comparisons require
`plan_basis: original|current`. Tags, tag attribution, time grouping, other filters, baseline
comparisons and gap filling are rejected, not approximated. Existing sources are unchanged.
Work is whole closed typed intervals selected by local start day at one captured instant.
SQL interval arithmetic uses integer UTC microseconds; fractional endpoints are not rounded away.
Plan matching does not establish association. Task/plan groups are non-additive; totals are
independently calculated. This bounded interface is not the downstream custom-widget UI.


The real Folio `/agenda-view` has distinct **Plan session** and **Add recorded work** actions.
The latter creates via strict `POST /recorded-work`, with manual provenance, and can be reread at
`GET /recorded-work/{id}`. Same-task warnings list each intersecting raw record and seconds;
touching endpoints and different tasks are silent. Work is read-only after creation. A selected
plan prefills task context, but its explicit attachment checkbox starts unchecked. Attached
creates require `expected_plan_revision` or `expected_projection_revision`, invalidate the plan
revision and capture virtual originals in the same locked transaction. Unattached work never
captures projections. No task reassignment, timer protocol change or destructive work control is offered.

`GET /recorded-work-progress?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&plan_ids=ID` provides
Folio's shared-snapshot, shared-measurement read. Folio selects plans visible in that day's ledger;
its comparison label explicitly describes this plan cohort, not all plans for all dates. The
query interface can explicitly select other plan IDs regardless of their start day. Plans with
no matching work report zero fill. Original/current comparisons do not imply ownership. Raw
legacy-inclusive task accounting and old saved queries remain unchanged. Tags and full custom
union widgets remain downstream; unsupported query combinations return validation errors.

Schema `0016_recorded_work_index` adds only the `(kind,start_time,end_time,task_id)` index for
bounded cross-task work reads. It transforms no rows or JSON; fresh-chain and synthetic copied
0015 data tests check index use, FKs and retained IDs, recurrence, ratings, audit/draft JSON and widgets.


### Explicit extension capability

See [schedule-extension-contract.md](schedule-extension-contract.md) for the implemented #6
root HTTP action, fixed DB receipt, shared browser controller and Calendar consumer interface.
Only Apply after the displayed CURRENT-interval preview extends the explicitly selected plan;
running timers do not block it and overlap does not trigger warning or another confirmation.

### Shared recording producer interface

`SessionService.stage_recorded_work(RecordedWorkCreate(...), provenance="manual"|"timer")`
stages a closed positive past interval, explicit association/revision validation, overlap warnings,
and any projected-plan capture under the shared SQLite writer transaction. It flushes and returns
stable work UUID/revision/kind/provenance, but **does not commit or roll back**. The caller must
commit once or roll back the entire transaction on any failure; until commit the returned identity
is staged, not an ACK. The HTTP manual adapter wraps it with commit/rollback and always supplies
`manual`; the strict request DTO refuses a user-supplied provenance. Timer producers may pass
`timer` only server-internally. Timer v1 is intentionally not switched. This primitive provides no
operation receipts, file durability, replay or multi-timer policy; those remain #4 responsibilities.
