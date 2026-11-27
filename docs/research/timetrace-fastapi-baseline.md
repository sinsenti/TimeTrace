# TimeTrace FastAPI: synthetic online performance baseline

**Scope:** existing FastAPI and SQLite behavior, not a FastAPI/Fastify comparison or a deployed-service SLO. Related: [public benchmark evidence and proposed workload](backend-performance-benchmark-evidence.md), [hosted backend options](hosted-backend-options.md), and [Choose Python or TypeScript for the hosted TimeTrace backend](https://github.com/sinsenti/TimeTrace/issues/80).

**Source:** exact archive of the working repository's committed `753074a8e642d5530adeacaf22f7e27e83b91532`. Uncommitted UI or prototype edits were excluded. This is not the earlier public `bfacc9d` research baseline; it includes the reviewed Stop endpoint. The research branch contains the harness and summarized evidence, not the application-source revisions under test. No production, personal data, provider calls, external deployment, multi-device offline implementation or Fastify port was used.

## Workloads and controls

- Linux 7.0.0-43-generic, Core i5-1135G7 (four physical cores/eight logical CPUs), ext4 on a local NVMe filesystem, Python 3.14.6, SQLite 3.53.1, FastAPI 0.141.1, Uvicorn 0.52.4, SQLAlchemy 2.0.52, httpx 0.28.1. A shared workstation was not a quiet or dedicated performance lab. No RAM cap, TLS, hosted WAN or browser rendering was measured.
- One real Uvicorn app process with enabled lifespan, on loopback and one pinned logical CPU (CPU 2); driver pinned to a different physical core (CPU 0). A separately labeled probe allowed CPU 2 and 3. Timezone UTC, host idle detection, native notifications and SQL widgets off. Daemon focus lifecycle was not removed. Every copied fixture used its own private DB, timer state, home and bound port. The HTTP health result had to name the private DB and port.
- Fixtures: 10,000 recorded intervals over up to a year and 100,000 over up to ten years. Both include dense recent periods, overlapping intervals, tags and some unassigned work. The six recurring tasks and 72 plans were made via HTTP; historical work was seeded directly in the migrated schema with `kind=recorded_work` and `provenance=manual`, not written through historical HTTP requests. The fixture histories are syntactic stress inputs, not assumptions about how one person works. Foreign-key checks were clean before measurement.
- **Mutation-only:** two direct Stop and two reviewed Stop flows offered per second. **Mixed:** one each, plus one two-calendar-day Agenda read, one grouped elapsed-time report over 31 inclusive dates, and two Timer list calls per second. **Wide:** two of each stop flow, four Agenda reads spanning 31 calendar days, three grouped reports spanning 366 dates, and two Timer list calls per second. **Wide, paced** uses the wide windows at the mixed rate. **Wide reads only** removes offered timer workflows after the warm-up. Normal test lanes intentionally omit user confirmation/think time and use distinct ready task IDs to avoid accidental same-task conflicts. These rates are synthetic pressure, not reported user arrival rates.
- Each timer flow independently does Start, a 25 ms hold outside the Stop measurement, and either direct Stop or the real `stop-review → stop-preview → stop-commit` sequence with policy `actual`. The reviewed E2E metric includes those three HTTP responses, not the initial Start or the 25 ms hold. Two flows are warmed up and separately accounted for. In successful trials the test reconciled acknowledged operation IDs, recorded-work IDs and row counts against the database after shutdown. Timings are observed HTTP responses on loopback, including client/network queueing; they are not host power-loss measurements.
- Normal runs used rollback-journal `delete`; labeled WAL runs enabled WAL on the stopped fixture copy without editing application code or intentionally lowering sync. Fresh verification connections reported SQLite `synchronous=2` (`FULL`) for the primary comparison. An instrumented lane sampled the process/file-lock acquisition, SQLite writer reservation, SQLite DBAPI commit and timer-file write wrappers. These sample wrappers are not end-to-end request timing, and do not sum to the client latency. Read-only evidence and failed/forced-shutdown cases are reported separately. Primed snapshots were copied per trial rather than reused.

## Results

The p95 values below are milliseconds, rounded to the nearest millisecond. A range is the two per-trial p95 values, not a pooled confidence interval. Short trials have roughly 20–50 observations per Stop path; p99 often denotes the maximum and is not a stable tail estimate. The [aggregate evidence](backend-baseline-harness/aggregates.json) includes n, p50, p95, p99, errors, drops, successful response sizes, CPU and RSS per trial.

| Lane | DB / server CPUs | Start p95 | Direct Stop p95 | Reviewed Stop p95 | Agenda / report p95 | Completion |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 10k, mutation-only | DELETE / 1 | 185 | 185 | 407 | — | 100 measured stops; no failures/drops |
| 10k, mixed, two repetitions | DELETE / 1 | 488–519 | 249–301 | 320–323 | 281–291 / 369–371 | 140 measured stops; no failures/drops |
| 10k, mixed | WAL / 1 | 339 | 274 | 286 | 427 / 369 | 60 measured stops; no failures/drops |
| 100k, mixed, two repetitions | DELETE / 1 | 7,407–7,517 | 7,074–7,554 | 14,932–15,295 | 1,195–1,655 / 1,201–1,647 | 137 measured stops; one task-slot drop in one trial, two errors and one unfinished timer in the other. Percentiles are successes only. |
| 100k, mixed, plain and separately instrumented | WAL / 1 | 4,777–5,239 | 4,477–4,736 | 9,607–10,109 | 1,508–1,616 / 1,230–1,293 | 90 measured stops; no failures/drops; 98% of a logical CPU used |
| 100k, mixed | WAL / 2 | 563 | 614 | 1,750 | 593 / 499 | 50 measured stops; no failures/drops; ~1.44 CPU cores used |

The 10k mixed DELETE runs had a **99–103 ms p95 on the final reviewed commit by itself**, but the full click-to-response API sequence took 320–323 ms. Treat those as different performance questions. On the 100k one-CPU WAL runs, no protocol failure was observed in the mixed lane but several-second mutation queues are not an acceptable speed claim. Two allowed CPUs helped substantially without a language or database change, but a single run cannot set a capacity guarantee.

### Wide stress and instrumentation

The first 2-second wide DELETE pilot produced six failures, including `database is locked` and `reconciliation_required`; the Agenda success responses averaged approximately 1.16 MB uncompressed. Subsequent full-rate wide DELETE and WAL attempts timed out during final verification/shutdown; they were not counted as normal completed trials. A revised harness saved partial evidence on these deliberate one-CPU reruns:

- **Wide DELETE/WAL:** 38/37 scheduled iterations were dropped at the driver cap; 64/65 counted errors include final verification. The instrumented paced wide DELETE run logged ten `database is locked` exceptions; 83 errors and 42 drops. Making that paced workload WAL did not make it pass (80 errors and 48 drops).
- **Wide reads only:** after warm-up there were no offered timer mutations. It still saturated the CPU, and just one grouped report succeeded among the 56 scheduled reads. The error count of 56 includes final verification. This shows write contention was not necessary for failure in this overload case; it does not identify the exact CPU hotspot. A separate two-CPU WAL full-rate wide trial also failed (63 errors, 61 drops, and a forced shutdown), so the two-CPU improvement shown above is limited to the mixed lane.
- In paced wide DELETE, sampled DBAPI `commit()` p95 was **3.06 s** (two failed commits took ~5.02 s); timer process-lock acquisition p95 was **29.9 s**. In the instrumented 100k mixed WAL lane the corresponding p95 values were **19 ms** and **5.01 s**. The SQLite writer-reservation statement p95 was **3.9 ms** and the timer-file lock acquisition p95 **0.25 ms** in that WAL lane. These timings represent different populations; they are not a request breakdown or direct measurements of how long code held each lock. Wide loads also showed SQLAlchemy pool timeout exceptions. WAL helped some cases but did not remove queueing or the wide overload.
- Some stress calls never supplied a valid response or left a timer needing recovery; in several captured diagnostic runs the disk-side ledger contained a small number of accepted rows whose responses had not been observed by the driver. No captured trial showed an acknowledged work row missing from disk. That is not a safety verdict for every interrupted request; timeouts require receipt recovery, not a fresh operation ID.

### Lost-response checks

A separate local proxy forwarded each Stop to the real daemon and discarded its entire successful response before the caller received any HTTP status or body. The caller then read `GET /operations/{id}`, verified equality with the finalized upstream result, exact-retried the same body/ID, and verified changed payload under the same ID was refused. The daemon was stopped and started on the same disposable fixture; receipt results and all work IDs were still readable and there was exactly one work row per operation. A second independent timer stayed running.

**24/24 passed** (12 per journal mode; half direct, half reviewed). Median receipt lookup was ~6 ms and exact retry ~7.5 ms on loopback without competing readers. This is dropped-response plus **graceful daemon restart** evidence, not physical power-loss, concurrent offline or phone-browser evidence. Separately, all **8 existing timer crash/reconciliation boundary tests** passed against the same source archive (21 unrelated cases deselected). Those tests use injected and process-crash persistence boundaries, not power loss.

### Recommendation

Keep FastAPI as the baseline. Do not treat either the passing 10k case or TechEmpower rankings as proof of hosted production capacity. First reduce broad Agenda payloads and unnecessary report work, profile why timer mutations queue behind those requests, and repeat the same tests on realistic hosting resources. Evaluate WAL and durable backups explicitly, not as a one-line fix. Revisit Fastify only if an equivalent slice can demonstrate the same receipt/accounting behavior and profiling points to replaceable runtime work rather than SQL/query shape, queues or disk. No Fastify, real offline reconciliation, WAN, browser rendering, crash-at-power-loss, database migration or vendor was tested.

## Reproduce locally

Use a Linux machine with the benchmarked TimeTrace revision available and its matching project virtual environment installed. Select distinct physical cores available to your shell (the command uses the cores on this host only). Do not run against an existing daemon or use real records.

```bash
# From a checkout of the application with the benchmark revision available.
root=$(mktemp -d -t tt-baseline.XXXXXX)
mkdir "$root/src"
# Set this to the absolute path of the backend-baseline-harness directory on the research branch.
cp "$HARNESS_DIR"/{bench,serve,recovery,summarize}.py "$root/"
git archive 753074a8e642d5530adeacaf22f7e27e83b91532 | tar -x -C "$root/src"
python="$PWD/.venv/bin/python"
PYTHONNOUSERSITE=1 BENCH_SERVER_CPUS=2 taskset -c 0 "$python" -P "$root/bench.py" seed 10000 small
PYTHONNOUSERSITE=1 BENCH_SERVER_CPUS=2 taskset -c 0 "$python" -P "$root/bench.py" trial small mixed-delete mixed 35
PYTHONNOUSERSITE=1 BENCH_SERVER_CPUS=2 taskset -c 0 "$python" -P "$root/bench.py" trial small mixed-wal mixed 35 --wal
PYTHONNOUSERSITE=1 PYTHONPATH="$root" taskset -c 0 "$python" -P "$root/recovery.py" wal
python3 -P "$root/summarize.py" "$root" > "$root/aggregates.json"
```

Use new trial names. Run trials and recovery serially so they do not compete. A non-zero trial exit means errors, dropped work, unavailable or nonempty timer state, or a ledger mismatch; inspect the synthetic `measurements.json` and `daemon.log`. The published [harness](backend-baseline-harness/) includes diagnostic capture improvements made after the first failed stress runs; it retains partial evidence when the daemon has to be terminated. It does not turn a failed workload into a passing one. The aggregate file omits work IDs, payloads and private paths. The tests did not mutate the existing TimeTrace checkout.
