# Backend performance: published evidence and a TimeTrace benchmark plan

Research date: **2026-11-27**. Companion to [hosted backend options, §7](hosted-backend-options.md#7-falsifiable-selection-gates-and-break-even-experiments--all-unrun); that report is unchanged.

**Status: research, not benchmark results, an approved implementation plan, an SLO, or a backend/database/vendor decision.** No benchmarks, application tests, daemons, database access, package installation, or real-device experiments were performed. All TimeTrace experiment proposals here are **UNRUN**. Public result files were downloaded and parsed, and source was read statically.

TimeTrace observations below are pinned to public revision **`bfacc9d07d39ad8c3f592db05e8161485f38cd85`**, the earlier report's baseline. The isolated research checkout has no application-source/test differences from that baseline. The optional personal checkout was not needed or inspected; no private content or user data is included.

## 1. Short answer and search boundary

**A useful public comparison exists; a published equivalent of the whole §7 experiment was not found. We can build our own in stages, starting without a rewrite.**

- **TechEmpower rounds 22 and 23** contain public FastAPI and Fastify implementations, exact run identifiers, source revisions, raw results and verification status. They can answer narrowly defined HTTP/JSON and database-workload questions. They do **not** answer how quickly a TimeTrace Stop becomes durably accepted under reporting and offline reconciliation load [T22, T23, TM].
- There is a **first-party runnable SQLite contention study with published results**, including a nominal mixed read/write test. Its source reveals important limits: a process-local writer mutex in that mixed test, a `SELECT` issued through `Exec`, WAL `synchronous=NORMAL`, and aggregate `ns/op`, not individual latency percentiles [SC]. SQLite's own concurrent tests and documentation add mechanisms and correctness checks, not a TimeTrace capacity promise [ST, SW, SI, SP].
- The **official Fastify benchmark repository** offers runnable GET/POST framework-overhead and startup experiments, explicitly not a real-world scenario. It does not include Python/FastAPI, durable storage, receipts or offline recovery [FB]. FastAPI's own benchmarking guidance points to TechEmpower and warns against comparing different levels of functionality [FA].
- A synthetic **existing-FastAPI baseline is possible now** for online timer receipts, Agenda and report reads, plus exact retry/operation lookup. Original-time offline submission, cross-device conflict handling and a durable browser outbox are **not** supplied by simply delaying current Start/Stop calls [R1–R5]. Those need the resolved offline contract implemented before an equivalent small Fastify candidate can test that workload.

### Search limits — absence is not established

Discovery first attempted combinations of `FastAPI Fastify receipt benchmark`, `FastAPI Fastify offline reconciliation benchmark`, `idempotency benchmark reconciliation timer`, and `SQLite concurrent read write benchmark p99 github` / `SQLite mixed latency benchmark concurrent`. General-search access was degraded: Google returned JavaScript/interstitial pages, DuckDuckGo yielded no usable results, and Bing returned mostly generic/unrelated results even for constrained queries. Those snippets were not used as evidence. Direct investigation then covered TechEmpower's published rounds/result files and pinned implementations, FastAPI/Fastify project sources, SQLite's official sources, the original SQLite study and its code/results, and Grafana k6's official documentation.

**No inspected benchmark combines** original-time offline capture, fixed durable receipts, lost-ACK recovery, concurrent TimeTrace-style report/union reads, conflict retention, a reconnect backlog and physical-browser lifecycle faults. This is a bounded negative finding, not a claim that no such publication exists. Continuous TechEmpower runs and the whole public web were not exhaustively surveyed. Round 23 was the latest numbered round listed on the official site when consulted; that is not a claim that it contains today's fastest implementations [TM].

## 2. TechEmpower: a reproducible comparison, with the right filters

### Exact artifacts, hardware and workload controls

| Artifact | Round 22 | Round 23 |
| --- | --- | --- |
| Official round date | 2023-10-17 | 2025-02-24 |
| Result run UUID | `66d86090-b6d0-46b3-9752-5aa4913b2e33` | `91a66052-9d86-446c-b31a-eadbd669ed08` |
| Source commit recorded in result `git.commitId` | `625684fcc442767af013de2dfd1fc90dd73f1744` | `523534bb61450e3522d775a749ad060753e26e3a` |
| Official physical result JSON | [round22/ph.json][T22] | [round23/ph.json][T23] |
| Hardware named by official environment documentation | Citrine: three Dell R440 servers, Xeon Gold 5120, 32 GB each, enterprise SSD, dedicated 10-GbE switch | Citrine: three HPE ProLiant DL360 Gen10 Plus servers, Xeon Gold 6330 at 2 GHz, **56 cores as described by the benchmark site**, 64 GB each, enterprise SSD, ConnectX-6 40-GbE |
| Measurement configuration in JSON | 15 seconds per measured point; ordinary concurrency 16, 32, 64, 128, 256, 512; query counts 1, 5, 10, 15, 20 | Same listed duration/concurrency/query-count grids |

Sources: result metadata [T22, T23] and official environment/methodology [TM]. These are separate load/application/database machines, not an all-in-one 1-vCPU/1-GiB service. `environmentDescription` is simply `Citrine` in both files; the round-specific environment matters. Do not compare rounds as a controlled framework upgrade: hardware, network, runtime, framework, database and application code changed.

Actual configured HTTP routes, **not** TimeTrace routes [P22, P23, J22, J23]:

| Test | Request and work | What it does not establish |
| --- | --- | --- |
| JSON | `GET /json`, small greeting JSON | Request validation of a capture envelope, domain rules, authentication or any persistence |
| Plaintext | `GET /plaintext`, small greeting; separate high-concurrency/pipelining configuration | Browser/network Stop latency; not a meaningful application-selection gate |
| Single database query | `GET /db`, random `World` row by key, JSON | Report joins, interval unions, receipt writes or SQLite contention |
| Multiple queries | `GET /queries?queries=N`, multiple random row lookups | A concurrent mix of independent report and mutation clients |
| Fortunes | `GET /fortunes`, read fortune rows, add an in-memory row, sort and HTML-template render | TimeTrace Agenda composition, recurrence projection or widget queries |
| Updates | **`GET /updates?queries=N`**, random row reads/updates and JSON | Offline ingest, receipt identity/replay, conflict storage or durable acknowledgement after fsync |

These categories are tested separately. An update request doing reads followed by writes is not the §7 experiment of independent report reads concurrently competing with receipt mutations. The ordinary-concurrency scripts prime and warm up first; the query/update script fixes concurrency at the configured maximum while varying queries/request. It uses `wrk`, keep-alive and an 8-second timeout, not an externally scheduled reconnect-arrival model [TW].

### Same-round PostgreSQL/raw entries, not arbitrary leaderboard rows

For database comparisons below, select **`fastapi`** (default Gunicorn/Uvicorn-worker entry) against **`fastify-postgres`**, both labeled **raw / PostgreSQL**. Select **`fastify` only for JSON**. In round 22 its default database variant is **MongoDB**; in round 23 that unsuffixed variant exposes **JSON/plaintext only**. `fastify-mysql` is a different database experiment. `fastapi-gunicorn-orm` is a different ORM path: the round-23 application uses SQLAlchemy's async engine over **asyncpg** (its requirements also install psycopg2, but that is not the selected engine). It is not a matched raw-versus-raw comparator [P22, P23, J22, J23, PO].

Even the properly filtered pair is **not a language-only experiment**:

- **Round 22:** FastAPI 0.93.0, Python 3.11 image, asyncpg 0.27.0; Fastify 4.13.0, Node 18.12.1 Alpine image, Knex 2.4.2 / `pg` 8.5.1. The database image is PostgreSQL 15 Bullseye. Framework metadata calls the latter raw despite its query builder [P22, J22, D22].
- **Round 23:** FastAPI 0.109.1, Python 3.11 image, asyncpg 0.27.0, Uvicorn 0.20.0; Fastify's manifest specifies **ranges** `^5.1.0` and `postgres` `^3.4.5`, Node 20.16 slim image; PostgreSQL 17 Bookworm. Do not turn manifest ranges or mutable image tags into exact resolved package/image claims: build logs/digests would be needed [P23, J23, D23].
- Both configurations fan out workers based on available CPUs. FastAPI default uses Gunicorn with Uvicorn workers and `multiprocessing.cpu_count()`; `fastapi-uvicorn` instead uses Uvicorn `--workers $(nproc)`. Fastify forks a Node cluster worker per CPU. They are not single-process, equal-RSS or equal-connection-budget tests. The FastAPI round-23 pool permits `1000 // cpu_count()` connections per worker; the round-23 Fastify Postgres client uses **`max: 1` per worker** [P23, J23].
- Round-23 FastAPI multiple reads await prepared statement reads sequentially on an acquired connection; Fastify uses `Promise.all` and its driver's scheduling. Fastify updates use a sorted single `UPDATE ... FROM (VALUES ...)`, while FastAPI uses reads plus `executemany`. SQL/driver/pool/concurrency/serialization strategies differ even on the same database. Same-round numbers compare **these stacks**, not Python syntax against JavaScript syntax [P23, J23].
- **Both rounds' supplied PostgreSQL configurations set `synchronous_commit = off`**. Returning from an update is therefore not evidence that acknowledged work survives an OS crash/power loss. PostgreSQL documents that this setting can lose recently reported committed transactions while retaining database consistency. This is especially disqualifying as a substitute for durable-receipt ACK latency [D22, D23, PG].

### Concrete published numbers, without pretending they are tail latencies

The following are **fixed sampled points**, not rankings or each framework's peak. JSON, single-query and Fortunes use **512 connections**; updates use **20 queries/request at maximum ordinary concurrency (512)**. Each cell is **raw total requests / nominal RPS / reported mean latency**. Nominal RPS is `floor(totalRequests / duration)` with `duration=15`, matching the result-view convention for these error-free cells; it is **not** recomputed from the coarse integer `endTime-startTime`. No selected cell has an error field. This does not prove that no errors occurred elsewhere in the run [T22, T23, TM, TW].

| Round / workload | FastAPI `fastapi` | Fastify (`fastify` for JSON; `fastify-postgres` otherwise) |
| --- | --- | --- |
| 22 / JSON | 2,662,752 / 177,516 / 2.85 ms | 4,125,580 / 275,038 / 1.87 ms |
| 22 / single query | 1,069,646 / 71,309 / 7.13 ms | 1,105,527 / 73,701 / 6.89 ms |
| 22 / Fortunes | 703,442 / 46,896 / 10.82 ms | 1,076,730 / 71,782 / 7.10 ms |
| 22 / updates, N=20 | 76,911 / 5,127 / 215.08 ms | 41,665 / 2,777 / 180.97 ms |
| 23 / JSON | 5,323,486 / 354,899 / 1.42 ms | 12,674,401 / 844,960 / 608.14 µs |
| 23 / single query | 2,458,410 / 163,894 / 3.09 ms | 6,556,945 / 437,129 / 1.21 ms |
| 23 / Fortunes | 1,637,501 / 109,166 / 4.63 ms | 3,987,403 / 265,826 / 1.93 ms |
| 23 / updates, N=20 | 199,464 / 13,297 / 90.84 ms | 851,561 / 56,770 / 8.94 ms |

For independent extraction: inspect `rawData.json.fastapi[5]` / `rawData.json.fastify[5]`, `rawData.db.fastapi[5]` / `rawData.db.fastify-postgres[5]`, similarly `fortune[5]`, and `update[4]`; use `concurrencyLevels`, `queryIntervals` and `duration` rather than assuming array positions in other rounds. The named entries have `verify` = `pass` and appear in `succeeded` for these categories in both rounds [T22, T23]. That is TechEmpower workload verification, **not** TimeTrace correctness acceptance.

Important interpretation: in round 22's updates, the higher throughput entry has a higher reported mean. Do not derive response distributions by dividing concurrency by throughput, or assume a mean and RPS summarize the same latency population without understanding the load tool. No TimeTrace selection follows from the rank reversal in updates between rounds.

**p50/p95/p99 and operational coverage:** the inspected `ph.json` result records supply `latencyAvg`, `latencyStdev`, `latencyMax`, request counts, times and optional errors; they do **not** supply these three percentiles or per-operation samples. Neither means nor maxima can reconstruct them. The harness requests `wrk --latency`, so raw logs can contain additional latency information, but the linked `tfb-status` run/log host was not retrievable during this research; no percentile or resolved-dependency claim is made from those logs. The JSON artifacts were retrievable. These comparisons also supply no demonstrated TimeTrace CPU/RSS curves, threadpool/event-loop delay, lock/fsync attribution, reconnect drain time, lost-ACK recovery, restart/restore ledger, or browser local-commit latency [T22, T23, TW].

### Other official runnable material

[Fastify/benchmarks][FB], inspected at `368b4073f518288600e26b10eaf040c075b40585`, defines `GET /` greeting JSON and `POST /` parsed/echoed JSON scenarios. Its README describes two Autocannon rounds (warmup/measurement), currently 100 connections, pipelining 10, duration 40 seconds, and warns that GitHub Actions virtual hardware has noisy neighbors. It reports requests/s, a latency column and throughput, not the required TimeTrace p50/p95/p99 durable-ACK series. `METRICS.md` separately defines application setup and listen-ready startup measurements (five samples). Neither is migration/reconciliation recovery. Use the repository as runnable overhead-methodology material, not FastAPI-versus-Fastify application evidence, and do not compare its localhost numbers to TechEmpower's separate-machine runs [FB].

FastAPI's official benchmark documentation was consulted through its source Markdown after its rendered page returned HTTP 403. It explains the server/framework/validation distinctions and links to TechEmpower; no additional official FastAPI-versus-Fastify receipt/report/offline harness was found there [FA].

## 3. SQLite: reproducible contention evidence, not a universal limit

### Published original experiment and its actual mixed test

Victor Skvortsov's original study and accompanying [Go code/results][SC] are primary evidence from the experiment's author, **not an official SQLite benchmark**. Inspected revision: `f66ab93ba61e1628bae7862fdc68a5a68a74ddbd`, directory `extras/9922_sqlite_concurrent_writes/go_bench/`.

- Published output identifies **Darwin arm64 / Apple M1 Pro**. It includes commands, Go benchmark iteration counts and aggregate `ns/op`, WAL, 5,000-ms busy timeout, foreign keys enabled, separate auto-commit inserts, 1,000-byte content in concurrency tests, and process-local mutex/no-mutex variants. The inspected `go.mod` declares Go 1.23.5 and `mattn/go-sqlite3` v1.14.24. Exact original OS, SSD/fsync characteristics, compiled SQLite version, memory/resource curves and independent latency samples are not established by those output headers [SC].
- For `BenchmarkWriteParallelWithoutMutex`, the 10-second `synchronous=normal` output reports 13,887 `ns/op` at `-cpu=1`, 16,090 at `-cpu=128`, and `database is locked` failures at `-cpu=256`. These are that test's load/concurrency results, **not** a safe maximum for TimeTrace or all SQLite systems. The author notes instability of FULL-mode results. Average benchmark time per operation under parallel load is not individual request latency or p99; Go documents benchmark timing/count reporting [SC, GO].
- The README publishes `BenchmarkReadAndWriteConcurrentWithoutMutex` results, e.g. 17,851 `ns/op` at concurrency 1 and 19,626 at 256, run with `-benchtime=10s -cpu=1`. **Despite that name**, its loop calls `readBlogPost(db)` and **`writeBlogPostMutexed(db, content)`**. Reads occur before a separately mutexed insert; this is not a read-modify-write transaction and not an uncoordinated-writers result. The read helper issues `db.Exec("select * from posts limit 1")`: it does not fetch/materialize a report result. It tests neither long analytics snapshots nor TimeTrace joins/union accounting [SC].
- NORMAL-mode WAL commits are not equivalent to the receipt's desired power-loss durability. SQLite documents that WAL+NORMAL may roll back committed transactions after power loss/system crash, whereas FULL syncs the WAL at each commit. Do not use this study's headline throughput as a budget for durable Stops. An application mutex coordinates cooperating writers **in that process only**; it does not prevent a second process from contending [SC, SP, SW].
- The source and README are not a perfect frozen experiment capsule: for example, the current mutexed-concurrency loop includes 1024 whereas the displayed historical output includes 256. Preserve the supplied output as historical evidence, pin code separately, and do not claim that an unexecuted rerun at the current revision would reproduce every printed number [SC].

**Measured:** simple insert throughput/aggregate benchmark time; contention/errors as concurrency and sync/mutex configuration change; a very small read-before-mutexed-write variant. **Not measured:** p50/p95/p99 per mutation/read, server-side durable receipt acceptance, CPU/RSS scaling, independent concurrent report traffic, HTTP/network/authentication, offline reconnect, duplicate/conflict resolution, application/host recovery or restore [SC].

### Official SQLite runnable tests and mechanisms

SQLite's `test/threadtest3.c`, inspected from the upstream source, is useful for a **lower-layer concurrency/correctness control**, not a published tail-latency comparison. In particular, `walthread4` starts an integrity-check reader alongside a writer repeatedly replacing rows containing random blobs, with WAL auto-checkpoint at 15 pages. It checks concurrency/integrity; it has no TimeTrace HTTP endpoints or p50/p95/p99 receipt series. `test/speedtest1.c` supplies synthetic timed SQL workloads, also not the receipt/report/offline experiment. Pin a SQLite source/build before adopting either [ST].

Mechanisms to capture explicitly in our own benchmark:

| Property | Consequence for the experiment |
| --- | --- |
| Only one simultaneous SQLite writer; WAL allows a reader and writer concurrently | Increase arrival rates/transaction occupancy, not merely thread counts; measure admission and lock waits separately. More HTTP workers are not more SQLite writers [SI, SW]. |
| Long read snapshots can prevent checkpoint completion; default automatic checkpoint threshold is 1,000 WAL pages | Include bounded long/slow reports and sustained trials covering checkpoints; record WAL size, checkpoint duration and resulting mutation tails. A brief warm-cache insert test misses this [SW]. |
| Deferred read-to-write upgrade versus writer reservation | Include the real transaction shape and actual busy/error behavior; do not equate a larger busy timeout with guaranteed success. Current TimeTrace explicitly reserves the SQLite writer using a zero-row UPDATE [SI, R5]. |
| `journal_mode`, `synchronous`, busy timeout and filesystem sync semantics | Report effective values for all connections, not just a setup statement. Compare like durability/failure models. NORMAL and FULL results belong in different labeled lanes [SP, SW]. |
| WAL is same-host shared-memory coordination, not ordinary network-filesystem multi-host writing | Do not extrapolate a local-file result to multiple app hosts mounting an ordinary DB file [SW]. |

Current TimeTrace's engine configuration does **not** enable WAL. A WAL prototype is a separate configuration experiment, not a description of current measured behavior. A new synthetic DB's effective settings must be recorded, not inferred from an existing database or a driver's name [R5].

## 4. Make our own: practical tiers and their honest coverage

This section is a proposed test design, **not authorization to implement or run it**. Use synthetic deterministic fixtures, a separate expected ledger and disposable isolated state only. No personal database or provider calls. The earlier report's 100,000 intervals / 10-year fixture, 8 unfinished timers, 3 devices / 6 tabs, 30-day Agenda and 1,000-capture backlog are **proposed envelope values**, not established requirements or measured capacity. A smaller representative fixture must also be tested; record generation seed, overlap/tag/DST/recurrence distributions, indexes, DB/WAL sizes, selectivity and output bytes.

### Tier A — existing FastAPI baseline, no backend rewrite

Use the real `main.py:create_daemon_app`, not the unused API app or a `TestClient` harness that skips lifespan/migrations. A separate load driver can exercise these existing public routes with their actual request models [R1–R4]:

| Existing route/workflow | Useful synthetic measurement now | Explicit limit |
| --- | --- | --- |
| `POST /timers`, then `POST /timers/{timer_id}/stop` (also pause/resume when in the chosen mix) | Online fixed-intent mutation/receipt latency, current-revision contention, file/DB workflow cost; one operation ID per immutable intent | Uses server cutoff at mutation execution, not an offline captured boundary. Avoid accidental same-task collisions in the normal lane; label deliberate stale/conflict tests separately [R1, R2]. |
| `GET /operations/{operation_id}` plus exact original operation retry | Finalized versus `pending_reconciliation`, operation lookup time, fixed-result recovery after an ambiguous online request | An unavailable lookup is not rejection; 404 cannot authorize changed-intent replay. Does not implement the new cross-device offline contract. Operation lookup itself takes the timer writer/file locks and must be counted as load [R1, R2]. |
| `GET /timers`, `GET /timers/{timer_id}`; `GET /agenda?start=...&end=...`; `GET /recorded-work-progress?start_date=...&end_date=...` | Timer reads; complete bounded Agenda API response; existing progress/report SQL under online mutation traffic | An HTTP response is not fully rendered Agenda/interaction latency. Agenda requires `end > start` and caps its projection window at **400 days**; a 10-year history fixture does not imply a 10-year Agenda request. Recorded-work analytics require bounded local start-date selection, not `all_time` [R1, R3, R6, R11]. |
| `POST /analytics/query`, `POST /analytics/query/batch`; dashboard detail and `POST /api/dashboards/{id}/data` | Real structured query compiler, tags/union outputs, grouping/sort/limit, full widget set where specified | The browser currently loads independent card queries; an aggregate endpoint alone is not its request pattern. A fixed literal/single-row query is not the actual report workload [R4, R6]. |
| `POST /recorded-work`, reads of `/recorded-work/{id}`; supported correction preview/commit routes | Manual interval persistence and independent expected-ledger verification; signed correction/stale checks in a distinct scenario | Manual creation accepts explicit interval bounds but its request has **no operation ID** and is not the same receipt/retry/offline ingestion protocol. Do not put it into generic at-least-once replay. Correction routes are not a substitute for capture reconciliation [R1, R3, R7]. |
| Optional `POST /analytics/sql` | Separate SQL-sandbox read lane if explicitly enabled for the synthetic experiment | Disabled by default. Do not silently enable it or combine it with the normal structured-report score [R4]. |

The current timer funnel checks payload hashes and revisions, writes a persisted intent, commits receipt/work, installs timer file state and commits finalization. `operation()` exposes a result only for a finalized receipt. Measure **that complete online path**, not the first DB commit or response from a stub handler. Static source and existing fault tests offer test seams, not an already executed performance/durability guarantee [R2, R8].

Existing named tests `test_fixed_stop_reconciles_every_persistence_boundary` and `test_process_crash_stop_replays_fixed_transaction_once` are useful fault-oracle seeds. Their presence does not establish load behavior, host power-loss durability, browser survival or the new offline protocol. They were read, not run [R8].

**Cannot honestly exercise now:** a durable cross-session browser capture outbox; submission of original offline Start/Stop times via timer commands; the new original-capture/known-remote-Stop envelope, durable stale/conflict retention and exclusion/reassignment rules; or a 1,000-item backlog of that protocol. Replaying 1,000 online requests can measure offered load but records server execution cutoffs, not original work. A complete-interval ingestion path might reuse domain staging, but adding receipt/conflict acceptance is implementation work. Existing `sessionStorage` operation journals do not become an IndexedDB outbox because a load script retries requests [R1, R2, R3, R9].

Keep a single authoritative timer/evaluator process for the first baseline. Do not add `--workers N` solely to imitate TechEmpower: startup runs migrations and background reconciliation/focus/idle work, and the timer funnel includes process/file coordination. A later worker-count lane must establish safe authority semantics, not merely faster HTTP [R2, R5, R10]. Disable native sends and host-idle behavior in the synthetic lane as required by the hosted policy, and record whether the bounded focus evaluator runs; do not silently remove workload from only one candidate [R10].

### Tier B — small equivalent Fastify candidate, after the offline contract exists

Build only a bounded equivalent acceptance/read slice after versioned offline envelopes, receipt status, conflict policy and independent golden ledger have been settled and implemented. Not a second production authority or whole-application rewrite. At minimum it needs acceptance of complete captured intervals and the distinct known-live-timer Stop transition, exact receipt lookup/replay, stale/conflict outcomes, and representative concurrent report reads. A greeting, memory-only map, plain insert without a receipt, or immediate `202` queue response is **not equivalent**.

Control attribution through a matrix, not a single Python/SQLite versus Node/PostgreSQL race:

1. **Runtime/application-stack lane:** FastAPI and Fastify, same storage class and effective durability, schema/indexes, fixture, SQL/result semantics, receipt and locking contract, transport/TLS/auth validation, worker and total CPU/RAM/disk allocation. Drivers will differ; record their exact versions, blocking/async behavior, pool/connections, transaction/batching and serialization costs. This tests runtime **stacks**; claim language-only attribution only if profiling supports it. Start with one authoritative process in each.
2. **Database lane:** within **the same runtime/contract**, compare SQLite configuration or SQLite versus PostgreSQL only after correctness equivalence exists. Explicitly replacing timer JSON authority or SQLite-specific SQL is part of that candidate, not a driver URL swap. Repeat for the other runtime if necessary. Count remote DB CPU/RAM/storage/network against the total budget and measure DB round trips/connection waits.
3. **Lower-layer controls:** same-language direct SQL transaction workload without HTTP/domain logic, then full application workload; and a CPU-only pure-accounting fixture without DB. These locate lock/I/O/query/CPU costs rather than awarding a runtime the benefit of different DB code. A direct-SQL win is diagnostic, not application acceptance.

Use identical logical captures and expected outcomes, not identical resulting IDs that would collide across trials. Preserve opaque IDs, timestamp precision, tag allocation, whole-interval local-start-day rules, conflict exclusions, revisions and replay identity. Do not round microseconds through JavaScript `Date` (ECMAScript time values have millisecond precision), change normalization/unknown-field handling or replace atomic receipt+work with two writes in the name of equivalent performance. Existing semantic tests/golden examples are the oracle; correctness failure disqualifies a candidate regardless of latency [R2, R6, R7, R8, J1].

### Tier C — real-device and fault gates, separate from server capacity

Server load tools can inject response loss, disconnects, duplicate envelopes, reordering and controlled process failures. They cannot prove Safari/Chrome local storage survival or UI responsiveness. Keep distinct physical iPhone Safari, Android Chrome and desktop lanes, ordinary tabs first; carry forward the earlier report's browser matrix and resolved offline policy rather than inventing new behavior [B0].

Measure local capture transaction completion, foreground reopen/reconnect, network send, server durable acceptance, receipt recovery, outbox cleanup and UI acknowledgement separately. Include tab/process death, suspension/lock, storage denied/full/cleared, clock changes, expired authentication, offline cached-version/schema upgrades, two tabs/devices, stale remote Stop, same-task disputes, deleted tasks and laptop-off hosted access. Installation is not a backup or a blanket retention guarantee: WebKit documents best-effort eviction and storage-pressure limits, including standalone apps. For IndexedDB, time transaction completion rather than individual request success, record the requested/effective durability mode where observable, and keep power-loss durability distinct from eviction resistance; the standard describes `strict`/`relaxed` as durability hints. No synthetic HTTP result establishes those outcomes [B0, W1, W2].

Fault correctness and recovery timing need **separate** ledgers for locally pending, accepted, conflicting and rejected captures. Inject before durable intent, after DB commit/before file installation, after installation/before finalization, after finalization/before response, and after receipt recovery/before local cleanup. Verify exact retries and immutable results after restart; test backup/restore separately. Killing an app process is not host power-loss testing; restoration of a consistent DB alone is not restoration of the coordinated timer/receipt authority [R2, R8, SW, SP].

## 5. Measurement contract and k6 methodology

### What exactly is timed?

Define these before comparing candidates; do not label a generic HTTP percentile “durable acceptance.” Proposed observables:

| Observable | Proposed timing boundary and correctness condition |
| --- | --- |
| **Server-side durable acceptance** | Server monotonic admission/handler-entry timestamp → completion of the specified durable receipt+work commit, required timer-state installation and finalization. State which queueing occurs before admission. Instrument writer admission, DB lock/pool wait, query/commit, file fsync/replace, checkpoint and serialization separately. Finalization must have the same crash/durability contract in each candidate; `202`, pending reconciliation and DB commit alone do not meet it. |
| **Client-observed durable acknowledgement** | Before first send of immutable logical intent → validated finalized result (or explicit terminal conflict/rejection, reported separately). Include any lost-ACK lookup/exact retry time; never restart the stopwatch on retry. For ordinary one-request successes report network/connection and HTTP durations alongside this logical metric. |
| **Receipt recovery** | First recovery attempt after reconnect/restart → verified finalized receipt or explicit pending/conflict outcome. Also report outage/fault-injection → recovered-authority time, so a late first poll cannot hide downtime. |
| **Read/Agenda completion** | Entire HTTP body received and validated; in browser lane, separate all-required-data/render/interaction-ready time. Time each widget plus full dashboard readiness; tag query shapes/result bytes. |
| **Backlog drain** | Foreground reconnect start → all initial captures have verified terminal outcomes and local cleanup/checkpoints. Count accepted, conflict, rejected, still-pending and never-started separately. Conflicts retained for review are not accepted report time. |

These are proposed instrumented definitions, not claims that the current server exposes those metrics. Use local monotonic elapsed measurements within each process, correlation/operation IDs for traces, and separately record clock uncertainty; do not subtract unsynchronized client/server wall clocks. Exclude sensitive payloads from logs.

### Use open and closed load models deliberately

Grafana documents the **closed model** as VUs waiting for their iterations to finish; slower responses reduce the arrival rate (coordinated omission). It is useful for a fixed tab/device interaction population. An **open arrival-rate model**, such as k6 `constant-arrival-rate`, starts iterations on a schedule independently of response duration, subject to available VUs [K1, K2]. Use both:

- A small fixed-device/tab lane for representative interaction pacing and dependency chains.
- Independent scheduled timer/submission and report scenarios for offered-load sweeps, sustained mixed traffic and reconnect bursts. Define one iteration precisely: **10 iterations/s is not 10 submissions/s if an iteration sends several requests**. Polling/receipt lookup also consumes capacity; a serial dependency chain must not mutate a timer twice at the same expected revision inadvertently.
- For the backlog lane, assign a deterministic **finite** corpus of unique capture IDs, known original bounds and dependencies. Stop scheduling when that corpus is exhausted; never reset the dataset or generate a fresh logical intent because a request timed out. Repeated submissions of an existing ID are retry load, not more completed work.
- Report configured versus achieved starts, completions, active VUs, timeouts and `dropped_iterations`. k6 documents drops from insufficient VUs or inability to sustain the schedule; zero observed request errors with dropped submissions is not a pass. Keep the load generator off the measured service budget and verify that it is not the bottleneck [K2, K3].

### APIs and thresholds that support, but do not replace, that contract

k6 `http_req_duration` is sending + waiting + receiving; it **excludes initial DNS/connection time**. Separate built-ins include connection/TLS/blocking/waiting timings and failed requests. A custom `Trend('durable_ack_ms', true)` can hold logical acknowledgement durations, with `.add(value, tags)` and percentile thresholds. Use low-cardinality scenario/action/outcome tags, not one time series per operation ID [K4, K5].

For example, a **future** tagged Trend threshold could be `durable_ack_ms{scenario:online_mutation}: ['p(95)<=250', 'p(99)<=1000']`, with summary statistics explicitly including `p(50)`, `p(95)`, `p(99)`. This illustrates the API, **not a runnable benchmark script or approved budget**. It carries forward the earlier report's provisional 250-ms/1-second numbers only for discussion. Thresholds express pass/fail; `check()` alone does not fail the process. Add explicit correctness/error/drop counters and thresholds; HTTP 200 is not a receipt/ledger oracle [K5, K6, K7].

Do not silently omit timed-out/pending logical intents from latency results. Report their counts/time-to-timeout and unresolved fraction with success percentiles; use explicit recovery windows and failing completion/correctness gates. Separate accepted/conflict/rejected latencies and normal/exact-retry/lost-ACK/cold-restart lanes. Success-only p99 without the denominator and failed/unstarted work can reward loss.

### Resource, repetition and publication checklist

For every trial publish exact public revision/patch, runtime/framework/driver/DB versions, lockfile and image digests, OS/kernel/filesystem/disk and sync settings, CPU quota/cores, memory limits, worker/thread/pool counts, network/TLS/auth assumptions, query parameters/plans, seed and immutable logical workload. Measure steady/peak RSS for **all workers**, CPU and throttling, I/O and fsync/checkpoint costs, DB connection/lock waits, server event-loop/threadpool delay and load-generator utilization. Node offers event-loop delay/utilization instrumentation, but enabling comparable instrumentation in both stacks remains work [N1].

Use fresh synthetic state or a documented identical snapshot per trial. Separate fixture creation and migrations from warm measurements, but report cold startup/migration/reconciliation/restore in their own lanes. Run sustained trials long enough to include WAL/checkpoint and timer evaluator cycles, with repeated trials/order variation, sample counts and variability. A 1,000-capture run has only about ten samples in its upper 1%; a precise-looking p99 from a small corpus is not a stable tail estimate. Preserve raw per-operation outcomes/histograms and environment manifests, not just a chart or single best RPS. Tune one factor at a time and rerun the correctness ledger.

**Decision use:** first ask whether existing FastAPI meets an agreed useful budget under the real mixed workload. Only attribute a miss to runtime after profiling excludes query plans, lock occupancy, sync settings, network and client behavior. Consider the small Fastify candidate when that evidence warrants it; consider a database change for measured contention or placement/recovery needs, not because a different language topped a different benchmark. None of this requires choosing a vendor.

## Primary sources actually consulted

URLs to moving official docs were read on the research date; they are not version pins. Repository links below pin source where the claim depends on a specific implementation. Ranges such as [R1–R5] refer to the numbered entries, not an additional source.

### Published framework results and implementations

- **[T22]** [TechEmpower round 22 physical result JSON](https://www.techempower.com/benchmarks/results/round22/ph.json): exact run/revision, workload arrays, statistics, `verify` and `succeeded`.
- **[T23]** [TechEmpower round 23 physical result JSON](https://www.techempower.com/benchmarks/results/round23/ph.json): same artifact fields.
- **[TM]** [TechEmpower official results/methodology/environment](https://www.techempower.com/benchmarks/#section=environment), [round 22](https://www.techempower.com/benchmarks/#section=data-r22&hw=ph&test=db), [round 23](https://www.techempower.com/benchmarks/#section=data-r23&hw=ph&test=db). The served official application bundle supplied round dates/hardware descriptions and the nominal-duration result calculation. Linked run/log host `tfb-status.techempower.com` was attempted but not retrievable; no claims rely on its unread contents.
- **[P22]** [Round-22 FastAPI directory](https://github.com/TechEmpower/FrameworkBenchmarks/tree/625684fcc442767af013de2dfd1fc90dd73f1744/frameworks/Python/fastapi): consulted `app.py`, `requirements.txt`, `fastapi.dockerfile`, `fastapi_conf.py`.
- **[J22]** [Round-22 Fastify directory](https://github.com/TechEmpower/FrameworkBenchmarks/tree/625684fcc442767af013de2dfd1fc90dd73f1744/frameworks/JavaScript/fastify): consulted `benchmark_config.json`, `package.json`, `app.js`, `create-server.js`, `db/postgres.js`, default/Postgres Dockerfiles.
- **[P23]** [Round-23 FastAPI directory](https://github.com/TechEmpower/FrameworkBenchmarks/tree/523534bb61450e3522d775a749ad060753e26e3a/frameworks/Python/fastapi): consulted `benchmark_config.json`, `app.py`, default/Uvicorn/ORM Dockerfiles, `fastapi_conf.py`, requirements and Uvicorn requirements.
- **[PO]** [Round-23 `app_orm.py`](https://github.com/TechEmpower/FrameworkBenchmarks/blob/523534bb61450e3522d775a749ad060753e26e3a/frameworks/Python/fastapi/app_orm.py), [SQLAlchemy requirements](https://github.com/TechEmpower/FrameworkBenchmarks/blob/523534bb61450e3522d775a749ad060753e26e3a/frameworks/Python/fastapi/requirements-sqlalchemy.txt).
- **[J23]** [Round-23 Fastify directory](https://github.com/TechEmpower/FrameworkBenchmarks/tree/523534bb61450e3522d775a749ad060753e26e3a/frameworks/JavaScript/fastify): consulted config/manifest, `app.js`, `create-server.js`, `handlers.js`, `db/postgres.js`, default/Postgres Dockerfiles.
- **[D22]** [Round-22 PostgreSQL Dockerfile](https://github.com/TechEmpower/FrameworkBenchmarks/blob/625684fcc442767af013de2dfd1fc90dd73f1744/toolset/databases/postgres/postgres.dockerfile), [its `postgresql-min.conf`](https://github.com/TechEmpower/FrameworkBenchmarks/blob/625684fcc442767af013de2dfd1fc90dd73f1744/toolset/databases/postgres/postgresql-min.conf).
- **[D23]** [Round-23 PostgreSQL directory](https://github.com/TechEmpower/FrameworkBenchmarks/tree/523534bb61450e3522d775a749ad060753e26e3a/toolset/databases/postgres): consulted Dockerfile, `config.sh`, `postgresql.conf`.
- **[TW]** [Round-23 wrk harness](https://github.com/TechEmpower/FrameworkBenchmarks/tree/523534bb61450e3522d775a749ad060753e26e3a/toolset/wrk): consulted concurrency, query and pipeline scripts and Dockerfile.
- **[PG]** [PostgreSQL 17 WAL settings, `synchronous_commit`](https://www.postgresql.org/docs/17/runtime-config-wal.html#GUC-SYNCHRONOUS-COMMIT).
- **[FB]** [Official Fastify benchmark README](https://github.com/fastify/benchmarks/blob/368b4073f518288600e26b10eaf040c075b40585/README.md), [startup metrics](https://github.com/fastify/benchmarks/blob/368b4073f518288600e26b10eaf040c075b40585/METRICS.md).
- **[FA]** [FastAPI official benchmark guidance, source Markdown](https://github.com/fastapi/fastapi/blob/master/docs/en/docs/benchmarks.md). Moving source consulted; rendered documentation returned 403.

### SQLite and measurement methodology

- **[SC]** [Victor Skvortsov's original SQLite contention study](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/); pinned [code](https://github.com/r4victor/tenthousandmeters/blob/f66ab93ba61e1628bae7862fdc68a5a68a74ddbd/extras/9922_sqlite_concurrent_writes/go_bench/bench_test.go), [commands/results](https://github.com/r4victor/tenthousandmeters/blob/f66ab93ba61e1628bae7862fdc68a5a68a74ddbd/extras/9922_sqlite_concurrent_writes/go_bench/README.md), [module versions](https://github.com/r4victor/tenthousandmeters/blob/f66ab93ba61e1628bae7862fdc68a5a68a74ddbd/extras/9922_sqlite_concurrent_writes/go_bench/go.mod).
- **[ST]** SQLite upstream [threadtest3.c](https://github.com/sqlite/sqlite/blob/4460306eb112cda8b85a70e6e297934a8e477cec/test/threadtest3.c), [speedtest1.c](https://github.com/sqlite/sqlite/blob/4460306eb112cda8b85a70e6e297934a8e477cec/test/speedtest1.c).
- **[SW]** [SQLite WAL documentation](https://sqlite.org/wal.html): reader/writer concurrency, sync, checkpoints, starvation and same-host constraint.
- **[SI]** [SQLite isolation](https://sqlite.org/isolation.html): serial writers, snapshots and transaction upgrades.
- **[SP]** [SQLite PRAGMA reference](https://sqlite.org/pragma.html#pragma_synchronous): `synchronous`, journal/busy configuration and durability boundaries.
- **[GO]** [Go `testing`, benchmark documentation](https://pkg.go.dev/testing#hdr-Benchmarks).
- **[K1]** [k6 open/closed models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/).
- **[K2]** [k6 constant-arrival-rate executor](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/).
- **[K3]** [k6 dropped iterations](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/dropped-iterations/).
- **[K4]** [k6 built-in metrics and timing definitions](https://grafana.com/docs/k6/latest/using-k6/metrics/reference/).
- **[K5]** [k6 custom Trend API](https://grafana.com/docs/k6/latest/javascript-api/k6-metrics/trend/).
- **[K6]** [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/).
- **[K7]** [k6 checks and exit-status limits](https://grafana.com/docs/k6/latest/using-k6/checks/).
- **[N1]** [Node 24 performance hooks](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html): `monitorEventLoopDelay`, `eventLoopUtilization`.
- **[J1]** [ECMAScript time values and time range](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-time-values-and-time-range).
- **[W1]** [WebKit's storage-policy explanation](https://webkit.org/blog/14403/updates-to-storage-policy/): best-effort/persistent storage, eviction and standalone-app quotas.
- **[W2]** [IndexedDB standard](https://w3c.github.io/IndexedDB/#transaction-durability-hint): transaction durability hints and completion, not an eviction guarantee.

### TimeTrace public source and reused browser research

All R-links pin the public baseline, not the personal checkout. Static inspection only.

- **[R1]** [Timer HTTP requests/routes](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/interfaces/api/routers/timers.py).
- **[R2]** [MultipleTimerService receipt/transition/reconciliation funnel](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/services/multiple_timer_service.py).
- **[R3]** [Sessions/recorded-work/Agenda routes](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/interfaces/api/routers/sessions.py).
- **[R4]** [Analytics routes](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/interfaces/api/routers/analytics.py), [dashboard routes](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/interfaces/api/routers/dashboards.py).
- **[R5]** [Database engine, writer reservation and snapshots](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/db/session.py).
- **[R6]** [QueryService](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/services/query_service.py), [browser dashboard loading](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/interfaces/api/static/js/dashboards.js).
- **[R7]** [Recorded-work request schema](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/interfaces/api/schemas.py), [SessionService](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/services/session_service.py), [recorded-work boundary ADR](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/docs/adr/0001-explicit-recorded-work-boundaries.md).
- **[R8]** [Timer persistence/crash tests](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/tests/test_multiple_timers.py).
- **[R9]** [Browser timer/operation journal](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/interfaces/api/static/js/multiple_timers.js), [API client](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/interfaces/api/static/js/api_client.js).
- **[R10]** [Root daemon startup/lifecycle](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/main.py).
- **[R11]** [Recurrence projection bound](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/core/recurrence.py), [recorded-work compiler's bounded-range guard](https://github.com/sinsenti/TimeTrace/blob/bfacc9d07d39ad8c3f592db05e8161485f38cd85/src/timetrace/core/query_compiler.py).
- **[B0]** The [earlier hosted-backend report](hosted-backend-options.md), especially its settled-inputs and real-browser gate and its pinned public browser-platform research citation. Reused as project context, not an independently measured browser result.

[T22]: https://www.techempower.com/benchmarks/results/round22/ph.json
[T23]: https://www.techempower.com/benchmarks/results/round23/ph.json
[TM]: https://www.techempower.com/benchmarks/#section=environment
[P22]: https://github.com/TechEmpower/FrameworkBenchmarks/tree/625684fcc442767af013de2dfd1fc90dd73f1744/frameworks/Python/fastapi
[P23]: https://github.com/TechEmpower/FrameworkBenchmarks/tree/523534bb61450e3522d775a749ad060753e26e3a/frameworks/Python/fastapi
[J22]: https://github.com/TechEmpower/FrameworkBenchmarks/tree/625684fcc442767af013de2dfd1fc90dd73f1744/frameworks/JavaScript/fastify
[J23]: https://github.com/TechEmpower/FrameworkBenchmarks/tree/523534bb61450e3522d775a749ad060753e26e3a/frameworks/JavaScript/fastify
[FB]: https://github.com/fastify/benchmarks/tree/368b4073f518288600e26b10eaf040c075b40585
[SC]: https://github.com/r4victor/tenthousandmeters/tree/f66ab93ba61e1628bae7862fdc68a5a68a74ddbd/extras/9922_sqlite_concurrent_writes/go_bench
