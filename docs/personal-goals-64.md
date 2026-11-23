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

## Acceptance matrix

| Contract | Current evidence |
| --- | --- |
| First real goal create/read; full overlapping physical durations and >100% | Public HTTP test |
| Absent until configured; global day/week and task day coexist | Public HTTP tests |
| Exact settings retry, changed payload conflict, stale edit, disable/re-enable | Public HTTP test |
| Total includes work older than 400 days; optional inclusive start | Public HTTP tests |
| Nested descendant scopes and global independence | Public HTTP test |
| Historical target and current-hierarchy reparent attribution | Public HTTP test |
| Effective reporting context epochs and complete settings validation | Pending |
| Full legacy/live/plan/lineage, DST and week-start coverage | Pending |
| Task deletion/history integrity and concurrency restart coverage | Pending |
| Weekly A/C and compact workspace/task UI | Pending |
| Existing/new atomic ID-preserving assignment, strict manifest, retries, stale multi-record rollback | Public HTTP tests |
| Pre/post DB file-boundary failure, exact recovery, later-note preservation | Public HTTP tests with injected filesystem failure |
| Optional post-Stop assignment prompt and subprocess crash/concurrency proof | Pending |
| Fresh/copied synthetic migrations and repeated startup | Pending |
| Real browser desktop/narrow and integration | Pending |
| Final full Python/Node, lint comparison and independent reviews | Pending |

Migration `0020_personal_goals` follows `0019_timer_focus`, adds empty settings/receipt tables
only, and never backfills targets or reclassifies evidence. Downgrade removes goal settings and
receipts permanently; export/back up first. Work and existing timer receipt tables are unchanged.
