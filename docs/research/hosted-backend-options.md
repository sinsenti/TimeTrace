# Hosted TimeTrace backend: Python or TypeScript

Research date: **2026-11-27**. TimeTrace source inspected: public `dev` baseline
**`bfacc9d07d39ad8c3f592db05e8161485f38cd85`** only.
For [Choose Python or TypeScript for the hosted TimeTrace backend (#80)][I80], under
[Wayfinding: TimeTrace on desktop web, iPhone, and Android (#74)][I74].

**Status:** research and a recommendation, not an owner decision, implementation specification,
security audit, deployment approval, or performance result. Official documentation was read on the
research date; moving documentation URLs are not dependency pins. No application, database, browser,
provider, or benchmark tests were run. All proposed checks below are **UNRUN**.

## Recommendation

**Choose a hardened Python/FastAPI authority with an explicit OpenAPI contract and generated
TypeScript client as the preferred direction.** It can supply every required browser, reconciliation,
and accounting capability without putting Python in the browser. Node/Fastify is a technically
credible alternative, but TypeScript alone adds neither durable acceptance nor safe offline replay.
Its distinctive potential benefit is executing the **same substantial pure rule implementation** in
client and server. That benefit needs a real TimeTrace workload demonstrating that it improves a
required outcome, rather than a count of shared types or a generic HTTP benchmark [F1–F3], [N1–N3].

For the one-owner workload, **evaluate an independently hosted, persistent single-host authority
with local SQLite first**, conditional on measured writer contention, operational recovery and
availability requirements. This is not the owner's laptop and does not require it to stay on.
If the eventual placement requires replaceable instances without durable local storage, multiple
active hosts, or a recovery/availability objective that a single host cannot meet, evaluate a
shared transactional database (PostgreSQL is the concrete comparison here) with **either** backend.
Changing the database or placement does not require changing the language [S1–S3], [P1].

Reasons are capability and testability, **not rewrite effort or framework popularity**:

- FastAPI can describe typed input/output and generate a TypeScript SDK; runtime client validation
  can also be generated. A Python server is not a barrier to one React/TypeScript client [F1], [F2], [G1].
- Both candidates can implement atomic receipts, revision checks, conflict retention and precise
  interval accounting. Neither framework automatically implements the resolved offline contract.
  The current source supplies inspectable domain oracles, including submillisecond accounting and
  crash-boundary tests, not proof that the current daemon is ready for hosting [R2–R6], [T1], [T2].
- Offline clients need durable capture and a versioned submission protocol more urgently than
  authoritative offline recurrence, analytics or correction approvals. These latter rules depend
  on server state; sharing their source cannot make a disconnected copy authoritative [I77], [R2–R5].
- Single-host versus distributed authority changes the correctness boundary more fundamentally than
  Python versus TypeScript. A process-local lock, persistent file, and shared transactional database
  are different capabilities, whatever the language [R2], [R3], [S2], [P1], [E1], [E2].

This recommendation is conditional: section 7 states evidence that would justify choosing Fastify,
a shared rules package, or a shared database instead. Vendor selection remains in
[Plan a hosted deployment of TimeTrace (#73)][I73]. Nothing here authorizes provisioning or exposing
the local daemon.

## 1. Settled inputs and reused platform research

The following requirements are resolved, not alternatives reopened by this report:

- One owner on multiple devices, online access with the laptop off, mandatory ordinary iPhone Safari,
  Android Chrome and desktop web. No native package, installation, lock-screen control or native
  notification prerequisite [I74], [I79].
- One responsive **React + TypeScript** frontend, initially built with Vite. The first real React
  Agenda uses the **existing FastAPI API**, keeping the current Agenda available until checked.
  A long-term server decision must not turn this into a prerequisite backend rewrite [I79].
- Online outcome parity includes recurrence, corrections, task management, report/widget editing,
  reviews, habits, settings and recorded-work export; not just viewing dashboards. The current
  Assistant is deferred on **both** redesigned desktop and mobile. Hosted-machine inactivity must
  not pause the owner's timer [I75].
- Offline Start and Stop from a previously loaded browser, including a pending Stop for a remote
  timer that device has already seen; not an unknown remote timer. Preserve original captures,
  recover ambiguous requests without duplicates, and distinguish **Saved on this device**,
  **Stop pending sync** and **Synced**. A stale Stop is retained for review, not rebased onto a
  changed timer. Same-task competing captures remain disputed and outside reports until resolved;
  different-task overlaps remain legitimate. Deleted tasks require explicit reassignment or
  unassigned work, never implicit resurrection [I77].

Reuse the already published [mobile/browser platform and offline durability research][B0], especially
sections 6–8. It is pinned to its research commit rather than assumed present on `dev`. Its 16
real-phone checks remain unrun; this report does not upgrade them to acceptance evidence.

That research traces the limits to WebKit storage policy, Chrome lifecycle documentation, IndexedDB
and Service Worker standards: a committed timestamp-based capture can survive ordinary suspension
without a continuously executing timer loop, but browsers can discard pages, deny persistence,
evict storage, or lose local-only work when data is cleared. Installation is not a backup. A service
worker is event-driven, and unattended background replay is not an interoperable delivery deadline.
Foreground reopen/reconnect recovery remains required. IndexedDB transaction completion is distinct
from individual request success and from protection against eviction [B0], [W1–W4].

**Backend consequence:** neither runtime repairs erased local-only work, observes work on a locked
phone, guarantees an offline focus transition while closed, or resolves an unknown clock change.
Those boundaries must remain visible in either product [I77], [B0].

## 2. What the public source actually supports

These are static observations, not executed guarantees. Links pin all TimeTrace code to `bfacc9d`.

| Source seam | Observation and consequence |
| --- | --- |
| `main.py:create_daemon_app`, lifespan [R1] | Actual FastAPI runtime, JSON API plus Jinja pages; startup migrations, reconciliation, idle and focus loops. Narrow loopback CORS and a health response containing the DB path are local-daemon assumptions, not a hosted security design. The inspected wiring does not establish general owner authentication. CORS is not authentication; do not expose this daemon merely by changing its bind address. This is not a complete security audit. |
| `MultipleTimerService.mutate`, `operation`, `_complete`, `_reconcile` [R2] | Stable operation ID, payload digest, fixed result, timer revisions and serialized transition funnel. Reuse of an ID with a different payload conflicts. Recovery spans JSON intent, DB receipt/work commit, file installation and receipt finalization. `operation()` distinguishes finalized from pending reconciliation. This is useful local crash-recovery machinery, not a distributed offline protocol. |
| `TimerStore.locked`, `write` [R3] | Advisory filesystem locking; temporary-file write, file flush/fsync, atomic replace and directory fsync on POSIX. The service also uses an in-process `RLock`. These coordinate access under the relevant local filesystem semantics, not independent copies of timer JSON on different hosts. |
| `routers/timers.py`, service cutoff [R2], [R4] | Current Start/Stop mutation requests do **not** accept original offline Start/Stop boundaries. A new accepted mutation uses `datetime.now(UTC)` (or an internal evaluator cutoff). Delaying existing HTTP commands would record reconnect time, not captured time. Many timer routes return unannotated service dictionaries with no `response_model`; generating a rich response contract is additional work, not an automatic property of the existing API. |
| `db/session.py` [R5] | SQLite-specific engine; zero-row UPDATE reserves the writer before rereading guards, explicit read-snapshot helper, Alembic upgrade on startup. This engine setup does not itself enable WAL. Do not describe a proposed WAL deployment as measured current behavior or translate the zero-row lock unchanged into a PostgreSQL concurrency guarantee. |
| `query_compiler.py`, SQL widget service/sandbox [R6], [R7] | SQLite SQL, local-day context and integer microsecond interval geometry are meaningful behavior. Optional SQL widgets use a separate read-only connection, authorizer, deadline and row cap. A storage change must preserve outcomes and restrictions, not merely make ORM CRUD work. |
| Browser `api_client.js`, `multiple_timers.js` [R8] | Existing uncertain-operation journals use `sessionStorage`; the ordinary request path parses JSON without establishing a generated runtime response validator. These journals are not a durable multi-entry, cross-session offline outbox. |
| `FocusRuntime`, timezones and reporting [R6], [R9], [R10], [R13] | A bounded daemon evaluator runs independently of browser display; timezone conversion and explicit local/UTC correction validation have different rules from permissive local conversion. Some report paths use the daemon timezone or SQLite `localtime`; moving to a host in a different zone must not silently move work to a different report day. Hosting must honor the inactivity policy and must not equate Linux session-bus notices with phone notifications. |

**Two ingestion shapes, not one generic replay.** `SessionService.stage_recorded_work` already
lets its caller own the database transaction [R13]. A future submission of a complete offline
interval could use one transaction for accepted work plus its receipt or a durable conflict,
without changing live timer JSON. An offline Stop for a known live timer also changes that timer's
authoritative state. It needs the existing recoverable workflow or an explicit state-storage
redesign; adding a typed endpoint alone does not make DB and JSON atomic. A server commit cannot
atomically clear the phone's outbox either, so require repeatable acknowledgement, not an
unqualified “exactly once” promise. This is a proposed distinction, not existing offline support.

The [glossary][R11] and [recorded-work boundary ADR][R12] remain the semantic reference: scheduled
sessions are intentions, recorded intervals are evidence of work, associations are explicit, and
recorded task time is not elapsed recorded time. Current source/test evidence is more specific
than the historical native/sync roadmap. This research does not add Redis, sync replication,
external integrations, multi-user scoping, or a new native runtime.

## 3. Two concrete backend candidates

### A. Python 3.14 + FastAPI/Uvicorn + generated TypeScript SDK

Candidate boundary: Pydantic request **and response** models, stable operation identifiers and
explicit domain-error responses in OpenAPI; a pinned generator such as **Hey API `openapi-ts`**;
React imports generated transport/types rather than maintaining a parallel handwritten API model.
FastAPI officially documents this SDK route and OpenAPI 3.1 support [F1]. FastAPI response models
validate and filter returned data and supply response schemas [F2]. Hey API documents generated
Zod schemas and SDK validation when explicitly enabled; generating TypeScript interfaces alone
is not runtime validation [G1], [N3]. This is a candidate toolchain, not an installed one.

**Concrete strengths:** a browser can type-check an operation receipt/status union, handle a stale
revision separately from validation failure, and preserve opaque IDs without executing Python.
A generated schema can validate an offline envelope's shape locally. Python rules can remain
server-authoritative while the client owns capture, drafts, pending state and recoverable transport.
This supplies the selected React path without a server-language dependency [F1], [F2], [G1], [I79].

**Limits to resolve:** current timer output schemas must be made explicit; schemas must describe
all domain-relevant error/status bodies, optional-versus-null fields and versioned envelopes.
OpenAPI does not encode every Pydantic custom validator, database dependency, correction signature
check or business invariant. Generate only from the real root app, pin schema/generator versions,
and check generated artifacts for drift. SDK generation does not justify generic mutation retries.
HTTP itself cautions against automatic retries of non-idempotent methods without an application
basis for safety [R1], [R2], [R4], [F1], [H1].

**Execution:** FastAPI runs ordinary `def` route functions and dependencies in a threadpool; an
ordinary helper called directly from `async def` is not automatically offloaded. Async helps waiting
on I/O, not the cost of CPU-heavy recurrence/interval work. Multiprocessing is available, but workers
do not normally share memory, and startup migrations must be coordinated once. More HTTP workers
must not silently create competing focus/idle authorities or evade the timer writer funnel.
Measure DB lock waits, threadpool saturation and event-loop lag rather than assuming `async`
removes them [F3], [F4], [R1], [R2].

### B. Supported Node.js LTS + Fastify 5 + route schemas, optionally shared TS rules

Concrete comparison: **Node 24 LTS line** (recheck supported patched runtime at implementation),
**Fastify 5**, application-owned JSON Schemas with the official `json-schema-to-ts` type provider,
Ajv runtime validation, explicit response schemas/serialization and `@fastify/swagger` OpenAPI.
The official type-provider docs show inference from route schemas, and the Swagger plugin can
export OpenAPI. Keep an external contract for the CLI and old clients; this need not become a
TypeScript-only RPC API [N1], [N2], [N4], [N5]. No Node candidate was installed or executed.

**Concrete strengths:** runtime schemas can also drive compile-time types; a narrowly isolated
browser-safe package can execute a pure interval calculation or local validation on both ends.
This is genuine implementation sharing when both ends need the calculation, not just matching
interfaces. Fastify's schema compilation/serialization is a documented capability, **not evidence
of faster TimeTrace Stops or reporting** [N1], [N2].

**Important semantic trap:** Fastify's documented Ajv defaults include `coerceTypes: 'array'`,
`useDefaults: true` and `removeAdditional: true`. These can change input before the handler; unknown
fields can be removed instead of rejected. Current TimeTrace correction models use strict typing
and `extra='forbid'` (not every existing request model is strict). A candidate must deliberately
match the intended boundary, including which representation is bound to an operation receipt.
Do not assume a TypeScript annotation enforces it. Treat schemas as application code, not
user-provided input; Fastify warns its compilation uses `new Function()` [N1], [N3], [R4].

**Execution:** synchronous JS computation blocks that process's event loop; promises do not turn
CPU work into parallel work. Node documents worker threads for CPU-heavy work. The Node 24
`node:sqlite` `DatabaseSync` API is synchronous and its documented module stability is release
candidate at access time; this is not a driver selection. A production SQLite driver/worker strategy
must demonstrate authorizer, timeout/cancellation, transaction and integer behavior needed by
TimeTrace, not just query execution. A shared-database async driver still leaves serialization,
recurrence and JS CPU work to bound [N6–N8], [R6], [R7].

### Capability comparison, holding protocol and placement constant

| Required outcome | FastAPI + generated TS | Node/Fastify + possible shared rules |
| --- | --- | --- |
| Ordinary Safari/Chrome and laptop-off access | HTTP/HTTPS contract; independently hosted runtime | Same; Node on the phone is not required |
| Typed React requests/responses | Explicit output/error schemas plus generation | Runtime route schemas plus type inference; export OpenAPI for other clients |
| Runtime trust boundary | Pydantic plus domain/DB checks; optional generated browser validators | Ajv or configured validator plus domain/DB checks; TS types alone insufficient |
| Offline original times, pending Stop, receipts/conflicts | New durable capture/reconciliation contract required | Same; importing server types does not supply it |
| Pure rule execution on both ends | Separate TS implementation or generated shape validators, common fixtures | Same source possible in a browser-safe rules package; old cached clients still differ |
| Precise history, recurrence and reports | Concrete existing behavior to preserve | Equally expressible; must demonstrate identical intended outcomes, including precision |
| Multi-instance authority | Shared state, transaction constraints and evaluator coordination | Same; one JS event loop does not serialize other processes |
| Long-term browser parity | One shared React product plus compatible API evolution | Same; shared rules can reduce some rule drift but do not ensure UI/accessibility parity |

These comparisons follow the documented mechanisms above, not measured superiority [F1–F4],
[N1–N8], [I77], [I79]. There is no exclusive required hosting/offline capability established for
one language by this research.

## 4. What can actually be shared safely?

**Recommendation:** begin with a strong wire contract and language-neutral golden examples. Add a
shared implementation only for rules that must genuinely execute offline and have identical inputs
and semantics. Do not split one mutation authority between Python and a second TS service merely
to share a few functions. A TS package used only by React also does not require a TS backend.

| Rule/example | Useful client sharing | Limit / authoritative check |
| --- | --- | --- |
| Envelope shape, discriminated capture/status variants, nonempty IDs, finite numeric bounds | Generate validators/types from the API, or share application-owned runtime schemas in the TS candidate | Validate again on server. Structural schemas cannot prove the task still exists or an operation belongs to the owner [F1], [G1], [N1–N3]. |
| Immutable local Start/Stop capture state, dependencies and pending/synced labels | Browser-safe pure state reducer and fixture tests; some logic may also help server interpretation | Durable IndexedDB commit is an adapter boundary. A reducer result is not saved work, nor a server receipt [I77], [W3]. |
| Union/intersection of explicitly supplied intervals | A worthwhile shared TS candidate if offline previews actually require it | Same-task 10:00–10:30 plus 10:15–10:45 gives 45 minutes task credit; different tasks give 60 task minutes and 45 elapsed minutes. Accepted reports select authoritative records and exclude unresolved captures; a local subset cannot compute global totals [I77], [R6], [R11]. |
| Displayed elapsed time from a saved running anchor and explicit pauses | Pure calculation, with clock discontinuity represented as uncertainty | Never infer user activity from lock state or manufacture automatic missed breaks. A monotonic clock in one execution epoch does not establish cross-device/reboot truth [I77], [B0]. |
| Local time entry, recurrence expansion and schedule-fit previews | Optional preview on a bounded snapshot; reusable examples help | Preserve explicit UTC/IANA zone/offset checks, DST ambiguity rules, recurrence exceptions and original/current plan distinctions. A stale recurrence preview is not authorization to materialize or overwrite a plan [R2], [R10], [R12]. |
| Signed corrections, one accepted running timer per task, deletion/assignment guards, competing Stop resolution | Share presentation and tentative explanation, not acceptance | Needs current dependency graph, revisions, server-only signing material and serialization/constraints. No package can make offline state current [R2–R4], [I77]. |
| Fan-out/split-tag analytics and scalar unions | Shared fixture oracle or limited preview may help | Current selection, allocation-before-filtering and independent scalar/group behavior must remain. Copying full analytics tables to the browser or summing overlapping groups changes the capability/privacy boundary; it is not implied by offline capture [R6], [R11], [R12], [T2]. |

### Two non-obvious portability gates

1. **Time precision:** current recorded-work SQL deliberately retains microseconds and has a
   submillisecond regression test. ECMAScript `Date` time values use millisecond precision.
   Round-tripping raw captured/history boundaries through `Date` can lose meaningful work. Preserve
   exact wire boundaries and define arithmetic/serialization explicitly before sharing a union
   engine; this report does not choose a new timestamp format or authorize rounding. Also check
   safe integer ranges and wire handling if using `BigInt`; a TS `number` type alone is no proof
   [R6], [T2], [J1].
2. **Receipt identity and cached versions:** current payload hashing uses Python's sorted JSON
   serialization. A new JS serialization is not automatically byte-compatible; different omitted
   fields/defaults can also change intent. Preserve old operation recovery, signed preview versions
   and submitted payloads across upgrades. An old offline tab can run yesterday's shared package
   after the server has upgraded. Version compatibility, server revalidation and retention rules
   remain necessary even with one repository and one language [R2], [R4], [N1], [I77].

## 5. Placement and persistence: a separate comparison

“Laptop off” means an independently hosted online authority. It does **not** mean “must use functions,”
“must use PostgreSQL,” or “must use TypeScript.” A long-running container also needs a durable-volume
contract: long process lifetime is not persistent storage [I74], [S1], [E1].

| Placement + storage | Capability and limit | Assessment for this owner |
| --- | --- | --- |
| **One independent host, durable local volume, SQLite + coordinated timer state** | SQLite supports an application server serving remote clients. Writes serialize; clients do not directly open the DB file. The current JSON/DB funnel relies on local locking and recovery [S1], [S3], [R2], [R3]. | Preferred baseline to evaluate. Start with one mutation/evaluator authority; multiple devices do not imply multiple database writers on multiple hosts. Host outage is service outage; restart/restore objectives must be acceptable. |
| **One host, shared transactional DB** | Both runtimes can use a client/server DB. Can separate database durability from app-host replacement, at the cost of DB network round trips and connection/recovery management [P1], [F3], [N6]. | Valid if managed persistence/restore or later placement requirements justify it, even at low traffic. Not evidence that Node is preferable. |
| **Multiple active app hosts or ephemeral functions, shared transactional DB** | Durable receipts, captures, accepted timer state and conflict decisions must survive replacement and be visible to every writer. DB constraints/transactions coordinate accepted state; process locks do not [P1], [P2], [F4], [E1], [E2]. | Feasible with either backend, but current file-state authority is not portable as-is. Use a clearly coordinated evaluator/scheduler if needed; do not assume one daemon loop per instance is safe. |
| **Multiple hosts/functions, each with its own SQLite and timer JSON** | Separate local files are separate histories. A warm function's temporary files or globals are not a shared durable authority. For example, Lambda documents freezing/reuse, environment termination and transient `/tmp`; concurrent requests can receive separate environments [E1], [E2]. | Reject as the authoritative design. Keeping concurrency at one does not by itself make ephemeral storage durable across replacement. This example is a lifecycle warning, not a choice of AWS or a universal description of every function service. |
| **Multiple hosts opening an ordinary SQLite file on a network mount** | SQLite advises against direct concurrent network-filesystem access; WAL requires same-host shared memory and does not work over a network filesystem [S1], [S2]. | Not the assumed route to scale current code. A specialized remotely served/replicated SQLite product would need its own primary-source and failure-semantics evaluation; it is not ordinary local SQLite. |

### SQLite versus PostgreSQL: concrete correctness implications

- **Concurrency:** SQLite's single writer can be entirely adequate for one owner's devices; count
  timer operations, report reads and reconnect bursts, not “users” alone. WAL permits concurrent
  readers/writer but still only one writer; checkpoints and long read snapshots matter. Busy/lock
  waits need bounded, visible handling. WAL is an option to evaluate, not a blanket throughput or
  durability improvement [S1–S3].
- **Shared acceptance:** PostgreSQL's default Read Committed isolation gives each statement a
  snapshot, not automatically one consistent multi-statement business decision. A check-then-insert
  for one running timer per task can race. Evaluate appropriate unique constraints/partial indexes,
  row locking or serializable transactions with retry; null task IDs need deliberate treatment
  because taskless parallel timers are legitimate. Serialization retry must retain the same logical
  capture/operation identity and must not replay irreversible external side effects [P1], [P2], [R11].
- **Atomicity:** for a redesigned multi-instance authority, prefer committing the submission's
  identity, accepted result or durable conflict disposition, work rows and relevant state changes
  in one transaction where practical. This is a design recommendation, not a selected schema.
  A shared DB alongside separate per-instance timer JSON still has a split authority. Conversely,
  the current coordinated JSON/SQLite recovery protocol must not be called broken merely because
  it spans files; it already explicitly reconciles its persistence stages [R2], [R3].
- **Functions:** explicitly verify runtime/package support, cold startup, request duration, DB
  connection limits, transaction completion after disconnect, scheduler guarantees and storage
  durability for a shortlisted service. No post-response thread/task is a durable job merely because
  the runtime lets it start. Lambda's documented freeze/reuse is one counterexample to an assumed
  continuous focus loop; other services must be checked on their own terms [E1], [E2].

**Unsettled, not answered by language:** acceptable outage and restore time, longest supported
offline period, compatible old-client window, capture/receipt retention and operational ownership.
If these require app-host replacement without state transfer or active multi-host writes, choose the
shared-state design on that requirement even when SQLite throughput would have sufficed. No
unmeasured claim about cheaper functions, lower Node memory, or “Postgres means high availability”
is made here.

## 6. Data portability, safe evolution and hosted prerequisites

**Proposed obligations for either candidate**, derived from the existing semantics and resolved
contracts; these are not a migration plan or approval to move personal data [I73], [I74], [I75], [I77], [R11], [R12]:

- Treat tasks, plans/originals, raw recorded intervals, explicit links, revisions, recurrence
  exceptions, accepted receipts and unresolved captures as distinct information. Preserve IDs and
  provenance; do not convert old uncertain rows or schedule projections into performed work.
- Keep a versioned, documented export/import contract with synthetic round-trip examples. Recorded-
  work Markdown/CSV exports are useful user outputs, **not a complete disaster-recovery archive**:
  they do not by themselves carry running timer state, pending operations and all application data.
- For the current split state, a SQLite online backup produces a DB snapshot, not a coordinated
  snapshot of timer JSON and sibling signing/encryption material. Use a deliberate quiesced or
  application-coordinated backup/restore procedure and prove reconciliation afterward. Do not copy
  an actively changing DB/JSON pair and assume they agree. Do not publish or inspect real key values
  in research. SQLite documents a backup API; the rest is an application consistency obligation
  [S4], [R2], [R3].
- A shared DB migration must preserve query meanings, microsecond boundaries,
  recurrence behavior and optional SQL widget safety. SQLite-specific SQL and sandbox authorizers
  do not acquire equivalents just by changing a connection URL. Saved user SQL may need compatibility
  handling; dropping that optional capability when enabled would conflict with parity [R5–R7], [I75].
- Specify upgrade compatibility for old outboxes and receipts **before** moving authority. Retain
  fixed accepted results and original pending captures across deploy/rollback. A rollback must not
  forget operation IDs accepted by the newer version. Run migration once per authority, not on
  every concurrent replica boot [R1], [R2], [F4].
- Before real hosted data: HTTPS/secure browser origin, owner authentication/authorization on all
  relevant reads/writes and operation lookups, safe session handling (including CSRF protection if
  cookie-authenticated), bounded input/query resources, redacted errors/logs, private secrets and
  tested restore/update procedures. A single owner still needs access control. Exact access and
  deployment design belongs in #73; CORS or a hidden URL is not a substitute [I73], [R1], [B0].

## 7. Falsifiable selection gates and break-even experiments — all UNRUN

Do not run these against personal data. A later approved prototype should use an isolated synthetic
fixture, independent expected ledger and fault injection. First run the same workload against each
candidate on the **same persistence/placement class**; changing language, database and hosting at once
cannot attribute a result. Existing tests listed here were **read, not executed**.

### Correctness gates: zero silent loss or unintended duplicates

| Experiment | Observable pass/fail oracle |
| --- | --- |
| **Typed Agenda vertical slice** using existing FastAPI first | Generate the SDK from the root app contract. Type-check real list/start/stop/operation/correction paths without `any`/unchecked casts at these domain boundaries. Exercise success and each relevant error/status shape, including nullable and absent fields; malformed wire responses fail visibly. CI detects schema/generated-client drift. Current routes need explicit output schemas first [R4], [F1], [F2]. |
| **Original-time capture and known pending Stop** | Locally commit Start, kill/reopen offline, commit Stop, reconnect later. Recorded endpoints match captured endpoints, not receipt time. Repeat a Stop for a previously observed remote timer after another device changed/stopped it: pending evidence remains for review and the accepted result is unchanged. Unknown remote timer cannot be stopped offline [I77]. |
| **ACK loss + every persistence boundary** | Inject loss before commit, after commit before response, and after receipt read before local cleanup. Restart app/host separately, then lookup/exact retry. Each original intent yields its fixed result or explicit pending/conflict state; same ID/different payload fails. Never infer rejection from an unavailable lookup. Use `test_fixed_stop_reconciles_every_persistence_boundary` and `test_process_crash_stop_replays_fixed_transaction_once` as source-named starting points, not sufficient offline coverage [T1]. |
| **Competing writers and changed context** | Two devices reconnect in both orders for the same task; conflicting capture is preserved but excluded from reports until explicit resolution. Concurrent online starts cannot create two accepted running timers for one task. Rename/tag edit does not block recording against the same ID; deletion offers unassigned/reassignment; invalid plan link needs an explicit decision. Include different-task and taskless parallel timers [I77], [T1]. |
| **Accounting golden ledger** | A 10:00–10:30 / B 10:15–10:45 = 60 task minutes / 45 elapsed. Same-task case = 45 / 45. Add taskless overlaps, full intervals crossing midnight/DST, fan-out and split allocation before tag filtering, independent scalar versus limited groups, negative/unbounded task balances, original/current plan selection, and legacy exclusion. Preserve submillisecond work. Compare named outputs, raw bounds and provenance, not just one grand total [R6], [R11], [R12], [T2]. |
| **Correction/recurrence invariants** | Fixed signed preview/version and stale dependency checks, correction lineage/undo history, DST/offset validation, synthetic occurrence IDs, skipped/moved exceptions, no read-side plan materialization. No silent clamp/rebase or rewrite of historical work. Use timer-correction and recurrence tests as a semantic corpus [T3], [T4]. |
| **Old client and storage/authority migration** | Leave a version-N offline capture, deploy N+1 and then attempt rollback, recover the original receipt/result without new work IDs. Synthetic fresh and prior-schema migrations, export/import and backup restore preserve counts, IDs, raw intervals, links, revisions and unresolved state. Compare accepted-history and pending-capture ledgers independently; a successful HTTP response is not sufficient. |

### Operational/performance measurements, not hello-world requests per second

Use both a representative fixture and a deliberately larger envelope. **Proposed starting envelope,
not a launch requirement:** 10 years / 100,000 recorded intervals with nested overlaps and tags,
recurring plans across DST, a busy 30-day Agenda, 8 unfinished timers, 3 devices / 6 tabs, concurrent
report/widget reads and a reconnect backlog of 1,000 captures. Also test the actual supported read
bounds (for example the current recorded-work query's bounded start-date range), rather than bypassing
limits to manufacture throughput. Record fixture generation rules, DB/index sizes and result sizes
[R6], [T2].

For each candidate record p50/p95/p99 **durable mutation acknowledgement** latency, receipt recovery
latency, complete Agenda/read latency, backlog drain time, CPU, peak/steady RSS, event-loop or
threadpool delay, DB lock/connection wait, checkpoint/fsync cost, query time, output bytes and errors.
Separate warm requests, cold startup and fault recovery. Browser measurements must distinguish
network time, local commit time and UI responsiveness; a lower server median may not improve touch
Stop at all. Use repeated trials with exact versions, resources and variability, not a single run.

A concrete **provisional** service budget to discuss before prototyping: on an equal 1-vCPU/1-GiB
allocation, p95 durable online mutations at or below 250 ms and p99 at or below 1 s during concurrent
reads and a 10-submission/s reconnect burst. These are proposed experiment thresholds, **not**
owner-approved SLOs or measured capabilities. Fix/report network assumptions separately and include
the DB's resources for shared-DB configurations; never compare an uncounted remote DB with an
all-in-one allocation. Correctness failure disqualifies a candidate regardless of speed.

| Decision to revisit | Measurable break-even evidence |
| --- | --- |
| **Switch FastAPI to Fastify for execution/resource fit** | FastAPI misses an agreed user-relevant latency/resource budget reproducibly; traces identify runtime/application execution rather than network, query plan, DB locks or durability settings as the limiting component. Equivalent Fastify implementation passes the same correctness corpus and budget on equal total resources. Include worker/driver overhead and cold recovery. A framework's hello-world benchmark does not satisfy this gate. |
| **Choose a shared TS rules package** | Identify a required nontrivial calculation that must execute offline and authoritatively online. Demonstrate it in both actual paths, zero fixture differences at required precision, browser bundle/interaction budget met, no server/DB/key dependencies, and compatible old-package replay after a rule change. Compare with generated validators plus golden fixtures in the Python option. Sharing type declarations or reducing handwritten lines alone is not a product break-even result. |
| **Move SQLite to shared DB** | Either an agreed placement/restore requirement already rules out single-host local state, or measured writer/long-reader contention causes unacceptable mutation/recovery delay after bounded query/transaction improvements. The shared-DB prototype must satisfy the same ledger/crash/concurrency gates; lower lock time alone does not prove correct receipt/timer semantics. |
| **Use ephemeral/multi-instance execution** | Demonstrate replacement of any instance, overlapping starts/stops, out-of-order reconnect, lost ACK and scheduler ownership without reliance on local files/globals. Meet agreed availability/cold-start/connection/restore budgets. A warm-cache success or `async` handler is not evidence. |

### Real browser gate remains mandatory

Carry forward all 16 checks from [the published platform matrix][B0], applying the resolved #77
oracles rather than its earlier open policy questions. Required ordinary-tab lanes include physical
iPhone Safari and Android Chrome, plus desktop. Include storage denied/full/cleared, process death,
clock changes, authentication expiry, failed/conflicting submission, two tabs/devices, service-worker
and local-schema upgrades, and foreground recovery. Verify hosted reads/writes with the laptop off.
Installed lanes are supplemental, never substitutes. Report exact versions and local/server ledgers;
no backend result establishes browser durability, accessibility or indefinite storage retention
[B0], [I77], [I79].

## 8. Suggested decision handoff

For #80, the evidence currently favors **FastAPI + generated TS contracts**, with a deliberately
narrow client capture/reconciliation boundary and common semantic fixtures. Keep Node/Fastify as an
explicit alternative if the shared-execution or measured-runtime gates above become material.
Do not select a second server solely because React uses TypeScript.

For #73, carry forward **persistent independent host + SQLite as the first placement to evaluate**,
not an approved vendor or permanent storage decision. Set outage/restore and old-client/offline
compatibility budgets before deciding whether a shared DB or replaceable/multi-host execution is
necessary. No conclusion here depends on paid services or personal data.

The next useful proof is the already approved **real React Agenda on existing FastAPI**, with explicit
response contracts and recoverable workflow state; a later reconciliation prototype must prove
original-time submission and conflicts rather than wrap current Start/Stop in a generic retry queue.
This report itself makes no tracker changes and supplies no benchmark or release-acceptance proof.

## Sources

Ranges such as [F1–F3] refer to the individual entries below. Repository links pin observations to
`bfacc9d`; issue resolution comments are the product decisions. The published browser research is
reused at its own pinned research commit, not treated as merged application source.

### Decisions and prior research

- **I80:** [Backend question](https://github.com/sinsenti/TimeTrace/issues/80).
- **I74:** [Parent map](https://github.com/sinsenti/TimeTrace/issues/74).
- **I75:** [Browser parity resolution](https://github.com/sinsenti/TimeTrace/issues/75#issuecomment-7205024067).
- **I77:** [Offline reconciliation resolution](https://github.com/sinsenti/TimeTrace/issues/77#issuecomment-7205246692).
- **I79:** [React/TypeScript client resolution](https://github.com/sinsenti/TimeTrace/issues/79#issuecomment-7219665370).
- **I73:** [Separate deployment planning](https://github.com/sinsenti/TimeTrace/issues/73).
- **B0:** [Published browser/platform research](https://github.com/sinsenti/TimeTrace/blob/ebd5a5b4887ff728c8728cea277edc481034cb06/docs/research/mobile-multidevice-platform-options.md), resolved in [#76](https://github.com/sinsenti/TimeTrace/issues/76#issuecomment-7204443079).

### Frameworks, runtimes and wire semantics — official primary sources

- **F1:** [FastAPI: Generating SDKs](https://fastapi.tiangolo.com/advanced/generate-clients/) — OpenAPI, TypeScript generation, operation IDs.
- **F2:** [FastAPI: Response Model / Return Type](https://fastapi.tiangolo.com/tutorial/response-model/) — response validation, filtering and schema.
- **F3:** [FastAPI: Concurrency and async/await](https://fastapi.tiangolo.com/async/) — threadpool behavior, I/O and CPU work.
- **F4:** [FastAPI: Deployment concepts](https://fastapi.tiangolo.com/deployment/concepts/) — process memory, workers, startup/migration coordination.
- **G1:** [Hey API: Zod plugin](https://heyapi.dev/docs/openapi/typescript/plugins/zod) — generated schemas and opt-in SDK runtime validation.
- **N1:** [Fastify: Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) — Ajv, response serialization, defaults, coercion, schema trust.
- **N2:** [Fastify: Type Providers](https://fastify.dev/docs/latest/Reference/Type-Providers/) — inference from schemas.
- **N3:** [TypeScript: Erased Types](https://www.typescriptlang.org/docs/handbook/2/basic-types.html#erased-types) — annotations do not change runtime behavior.
- **N4:** [Official `@fastify/swagger` source/documentation](https://github.com/fastify/fastify-swagger) — schema-derived OpenAPI export.
- **N5:** [Fastify LTS policy](https://fastify.dev/docs/latest/Reference/LTS/) and [Node release lines](https://nodejs.org/en/about/previous-releases) — supported runtime/framework lines must be rechecked when pinned.
- **N6:** [Node: Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — callback/CPU/I/O scheduling constraints.
- **N7:** [Node: Worker threads](https://nodejs.org/api/worker_threads.html) — CPU-intensive JS offload.
- **N8:** [Node 24: SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) — synchronous `DatabaseSync`, type conversion and module stability; other Node lines can differ.
- **J1:** [ECMAScript: Date time values](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-time-values-and-time-range) and [safe integers](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.max_safe_integer).
- **H1:** [RFC 9110 §9.2.2: Idempotent Methods](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) — retry limits; application receipts remain an application contract.

### Persistence and placement — official primary sources

- **S1:** [SQLite: Appropriate Uses](https://sqlite.org/whentouse.html) — application server use, network-filesystem and writer-concurrency considerations.
- **S2:** [SQLite: Write-Ahead Logging](https://sqlite.org/wal.html) — same-host restriction, readers/writer, checkpoints and durability settings.
- **S3:** [SQLite: Isolation](https://sqlite.org/isolation.html) — serialized writes, rollback and WAL snapshots, busy-snapshot behavior.
- **S4:** [SQLite: Online Backup API](https://sqlite.org/backup.html) — consistent database snapshot, not application sidecar backup.
- **P1:** [PostgreSQL: Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — statement snapshots, locking interactions and serialization retries.
- **P2:** [PostgreSQL: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) — uniqueness, partial unique indexes and null semantics.
- **E1:** [AWS Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html) — example of freeze/reuse, transient storage and replacement; not a vendor recommendation.
- **E2:** [AWS Lambda concurrency](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html) — separate execution environments for concurrent requests in the documented model.

### Browser limits reused from the earlier research

- **W1:** [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/) — best effort, eviction and persistence heuristics.
- **W2:** [Chrome: Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) — suspension/discard and persistence timing.
- **W3:** [W3C IndexedDB](https://w3c.github.io/IndexedDB/) — transactions and durability hints.
- **W4:** [W3C Service Workers](https://w3c.github.io/ServiceWorker/) — event-driven lifetime; see B0 for background-sync support distinctions.

### TimeTrace public source and source-named regression corpus — inspected, not run

- **R1:** [Root app/lifecycle](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/main.py).
- **R2:** [MultipleTimerService](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/services/multiple_timer_service.py).
- **R3:** [TimerStore](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/core/timer_store.py).
- **R4:** [Targeted timer HTTP schemas/routes](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/interfaces/api/routers/timers.py).
- **R5:** [SQLite session/migration helpers](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/db/session.py).
- **R6:** [Query compiler](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/core/query_compiler.py).
- **R7:** [SQL query service](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/services/sql_query_service.py) and [read-only engine](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/db/readonly.py).
- **R8:** [API client](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/interfaces/api/static/js/api_client.js) and [multi-timer controller](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/interfaces/api/static/js/multiple_timers.js).
- **R9:** [Focus runtime](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/services/focus_runtime.py).
- **R10:** [Timezone conversion and explicit instant validation](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/core/timezones.py).
- **R11:** [Glossary](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/GLOSSARY.md).
- **R12:** [Recorded-work boundary ADR](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/docs/adr/0001-explicit-recorded-work-boundaries.md).
- **R13:** [Recorded-work staging](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/services/session_service.py) and [reporting time context](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/services/query_service.py).
- **T1:** [`tests/test_multiple_timers.py`](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_multiple_timers.py) — retries, task selection, process concurrency/crash and persistence boundaries.
- **T2:** [`tests/test_recorded_work.py`](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_recorded_work.py) and [`tests/test_recorded_work_widgets.py`](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_recorded_work_widgets.py) — raw interval, precision, union/attribution and local cohort oracles.
- **T3:** [`tests/test_timer_correction_durability.py`](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_timer_correction_durability.py), [`tests/test_timer_correction_intervals.py`](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_timer_correction_intervals.py) and [`tests/test_timer_correction_preview.py`](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_timer_correction_preview.py).
- **T4:** [`tests/test_recurrence.py`](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_recurrence.py) and [`tests/test_recurrence_service.py`](https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_recurrence_service.py).

[I80]: https://github.com/sinsenti/TimeTrace/issues/80
[I74]: https://github.com/sinsenti/TimeTrace/issues/74
[I75]: https://github.com/sinsenti/TimeTrace/issues/75#issuecomment-7205024067
[I77]: https://github.com/sinsenti/TimeTrace/issues/77#issuecomment-7205246692
[I79]: https://github.com/sinsenti/TimeTrace/issues/79#issuecomment-7219665370
[I73]: https://github.com/sinsenti/TimeTrace/issues/73
[B0]: https://github.com/sinsenti/TimeTrace/blob/ebd5a5b4887ff728c8728cea277edc481034cb06/docs/research/mobile-multidevice-platform-options.md
[F1]: https://fastapi.tiangolo.com/advanced/generate-clients/
[F2]: https://fastapi.tiangolo.com/tutorial/response-model/
[F3]: https://fastapi.tiangolo.com/async/
[F4]: https://fastapi.tiangolo.com/deployment/concepts/
[G1]: https://heyapi.dev/docs/openapi/typescript/plugins/zod
[N1]: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
[N2]: https://fastify.dev/docs/latest/Reference/Type-Providers/
[N3]: https://www.typescriptlang.org/docs/handbook/2/basic-types.html#erased-types
[N4]: https://github.com/fastify/fastify-swagger
[N5]: https://fastify.dev/docs/latest/Reference/LTS/
[N6]: https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop
[N7]: https://nodejs.org/api/worker_threads.html
[N8]: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
[J1]: https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-time-values-and-time-range
[H1]: https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2
[S1]: https://sqlite.org/whentouse.html
[S2]: https://sqlite.org/wal.html
[S3]: https://sqlite.org/isolation.html
[S4]: https://sqlite.org/backup.html
[P1]: https://www.postgresql.org/docs/current/transaction-iso.html
[P2]: https://www.postgresql.org/docs/current/ddl-constraints.html
[E1]: https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html
[E2]: https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html
[W1]: https://webkit.org/blog/14403/updates-to-storage-policy/
[W2]: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
[W3]: https://w3c.github.io/IndexedDB/
[W4]: https://w3c.github.io/ServiceWorker/
[R1]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/main.py
[R2]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/services/multiple_timer_service.py
[R3]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/core/timer_store.py
[R4]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/interfaces/api/routers/timers.py
[R5]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/db/session.py
[R6]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/core/query_compiler.py
[R7]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/services/sql_query_service.py
[R8]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/interfaces/api/static/js/api_client.js
[R9]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/services/focus_runtime.py
[R10]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/core/timezones.py
[R11]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/GLOSSARY.md
[R12]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/docs/adr/0001-explicit-recorded-work-boundaries.md
[R13]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/src/timetrace/services/session_service.py
[T1]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_multiple_timers.py
[T2]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_recorded_work.py
[T3]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_timer_correction_durability.py
[T4]: https://github.com/sinsenti/TimeTrace/blob/bfacc9d/tests/test_recurrence.py
