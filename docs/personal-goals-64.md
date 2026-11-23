# Personal goals and weekly review (#64)

Work in progress, **not delivery evidence**. Canonical contract:
<https://github.com/sinsenti/TimeTrace/issues/64#issuecomment-7102449436>.

## Initial public slice

`POST /goals`, `PUT /goals/{id}` and `GET /goals?period_start=YYYY-MM-DD`
provide optional global day/week and task day/week/total settings. Targets have no default.
Goal definitions use a non-null owner key and cadence uniqueness, avoiding SQLite's NULL
uniqueness hole. Append-only effective versions preserve prior day/week targets and scopes;
DB-only receipts are separate from timer file recovery. This is not estimate accounting.

Evidence reuses the structured `summed_recorded_work` compiler. An internal typed scalar
execution path permits all-time totals without widening public widget date-range capabilities.
Recursive descendant membership uses bound SQL and UNION identity deduplication/cycle defense.

Context epochs are persisted append-only settings series. Explicit `PUT /goal-reporting-context`
starts a current/future epoch and CAS-increments affected goal definitions; prior complete periods
retain prior timezone/week start. Closed epoch periods cannot be extended into current/future time.
Epoch totals are incomparable and never merged. SQLite cannot reliably rebucket a captured timezone
that differs from the daemon: goal progress is explicitly unavailable, with retained context/warnings,
rather than a falsely precise fallback total. A single snapshot/cutoff covers weekly goal/query evidence.

## Acceptance matrix

| Contract | Current evidence |
| --- | --- |
| First real goal create/read; full overlapping physical durations and >100% | Public HTTP test |
| Absent until configured; global day/week and task day coexist | Public HTTP tests |
| Exact settings retry, changed payload conflict, stale edit, disable/re-enable | Public HTTP test |
| Total includes work older than 400 days; optional inclusive start | Public HTTP tests |
| Nested descendant scopes and global independence | Public HTTP test; normal task updates now refuse self/descendant cycles using a bound recursive SQL cohort |
| Historical target and current-hierarchy reparent attribution | Public HTTP test |
| Effective reporting context epochs and settings validation | Public HTTP context CAS/retry, frozen prior scope/week bounds, stale settings revision, daemon-zone capability/unavailable progress, finite positive targets and precise microsecond evidence passed; context editor integration pending |
| Full legacy/live/plan/lineage, DST and week-start coverage | Pending |
| Task deletion/history integrity and concurrency restart coverage | Pending |
| Weekly A/C and compact workspace/task UI | Initial public HTTP/Node slices; real DOM A→C and explicit goal save exercised, remaining matrix pending |
| Existing/new atomic ID-preserving assignment, strict manifest, retries, stale multi-record rollback | Public HTTP tests |
| Pre/post DB file-boundary failure, exact recovery, later-note preservation | Public HTTP tests with injected filesystem failure |
| Optional post-Stop assignment prompt and subprocess crash/concurrency proof | Pending |
| Fresh/copied synthetic migrations and repeated startup | Normal fresh0020 chain and20 focused migration tests passed, including rich copied0019 pre/postDB receipts and two starts |
| Real browser desktop/narrow and integration | Desktop actual Stop→optional create/assign worked; remainder pending. Both bounded raster captures failed (no frame); coordinator explicitly deferred raster/manual visual only, DOM acceptance remains required |
| Final full Python/Node, lint comparison and independent reviews | Pending |

Migration `0020_personal_goals` follows `0019_timer_focus`, adds empty settings/receipt tables
only, and never backfills targets or reclassifies evidence. Downgrade removes goal settings and
receipts permanently; export/back up first. Work and existing timer receipt tables are unchanged.
