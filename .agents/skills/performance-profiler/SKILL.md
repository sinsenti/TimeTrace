---
name: performance-profiler
description: Measure-then-optimize workflow for TimeTrace's real bottlenecks - full-table analytics aggregation in Python, per-node recursive queries, bulk recurrence pre-generation, and browser-side chart rendering. Use when an endpoint or page feels slow, before optimizing anything, or when asked to speed something up.
---

# Performance Profiler (TimeTrace)

Single-user local daemon. There is no traffic, no P99, no load test worth running. "Slow" here means *one* request takes long enough that the user notices — which almost always means one of the patterns below, not CPU contention.

## Golden rule: measure first

Never optimize on suspicion. Get a number, change one thing, get the number again.

```bash
# wall-clock for an endpoint, against the running daemon
curl -s -o /dev/null -w 'total=%{time_total}s\n' localhost:8002/analytics/detailed

# how much data is actually involved
sqlite3 ~/.timetrace/timetrace.db "SELECT COUNT(*) FROM session; SELECT COUNT(*) FROM task;"

# is it SQL or Python? count and time the queries
uv run python -c "
import logging; logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
from timetrace.db.session import engine
from sqlmodel import Session
from timetrace.services import AnalyticsService
import time
with Session(engine) as db:
    t=time.perf_counter(); AnalyticsService(db).get_detailed(); print(f'{time.perf_counter()-t:.3f}s')
"

# where the Python time goes
uv run python -X importtime -c "..."        # import cost
uv run python -m cProfile -s cumtime <script.py> | head -30
```

For the browser side: DevTools Performance tab, and the Network panel for how long the JSON took versus how long the chart took to draw. A "slow page" is often 40ms of API and 900ms of Chart.js.

## The known hot spot: `/analytics/detailed`

`AnalyticsService.get_detailed()` (`services/analytics_service.py`) does this on **every request**:

```python
sessions = self.db.exec(select(SessionModel)).all()   # every session, ever
tasks    = self.db.exec(select(Task)).all()           # every task, ever
# ...then model_dump() each one into a dict, isoformat every datetime...
return calculate_detailed_analytics(session_dicts, task_dicts)
```

and `core/analytics.py` then loops over that full list **four separate times** — daily trend, hourly distribution, status/priority counts, estimation accuracy — plus `calculate_tag_summaries` walking it a fifth time. It also builds a 14-day trend by filtering the entire history for 14 days of data, and re-parses every `start_time` from the ISO string it just serialized.

Cost is O(all rows) and grows forever, for a dashboard that mostly shows the last two weeks.

### Fix order (cheapest first)

1. **Filter in SQL, not in Python.** The daily trend needs 14 days. Push the bound into the query:

   ```python
   cutoff = (datetime.now(UTC) - timedelta(days=14)).replace(tzinfo=None)   # naive, DB-side
   sessions = self.db.exec(select(SessionModel).where(SessionModel.start_time >= cutoff)).all()
   ```

   Careful: totals and estimation-accuracy currently cover *all* history. Splitting the query means deciding what each number is supposed to mean — ask before changing semantics.

2. **Aggregate in SQL.** Sums and counts don't need Python objects:

   ```python
   from sqlalchemy import func
   total_seconds = self.db.exec(select(func.sum(SessionModel.duration_seconds))).one() or 0
   per_task = self.db.exec(
       select(SessionModel.task_id, func.sum(SessionModel.duration_seconds))
       .group_by(SessionModel.task_id)
   ).all()
   ```

   `task_actual_secs` (currently built by looping every session) is exactly this GROUP BY.

3. **Stop round-tripping datetimes through strings.** The service `isoformat()`s every timestamp and `calculate_detailed_analytics` parses it back with `fromisoformat`. Pass the datetime objects, or do the date bucketing in SQL with `strftime('%Y-%m-%d', start_time)`.

4. **One pass instead of five.** If the aggregation must stay in Python, walk the list once and update all the accumulators together.

5. **Only then consider caching.** A single-user daemon can memoize the previous result keyed on `MAX(session.id)` (UUIDv7 is time-ordered, so it moves when anything is added) — but this is the last resort, not the first move, and it adds an invalidation bug surface.

Keep the split: `core/analytics.py` stays pure and DB-free; SQL-side aggregation belongs in `AnalyticsService`.

## Other real patterns in this codebase

| Pattern | Where | Why it costs | Fix |
|---|---|---|---|
| One query per tree node | `TaskService.get_task_tree` — `select(Task).where(parent_id == t.id)` inside a recursive `build_node` | N queries for N nodes | Load all tasks once, build the tree in memory from `parent_id` |
| Existence check inside a 90-iteration loop | `TaskService.schedule_recurrent_sessions_three_months` | 90 SELECTs plus up to 90 INSERTs, re-run on **every** task update | Fetch existing start times once into a set; better, stop pre-generating (the roadmap's RRULE projection) |
| Full-table load then Python filter | `AnalyticsService.export_agenda_briefing`, `get_summary` | Same shape as `get_detailed` | Push date filters into the `where` |
| Per-row `commit()` | `AnalyticsService.import_markdown` | One fsync per row | Add all, commit once |
| Sort key recomputed per comparison | `TaskService.list_tasks` `smart_score` calls `ensure_utc` and `.timestamp()` inside the key fn | Cheap at current sizes | Leave it. Not a bottleneck; don't "fix" it |

That last row is the point: only the first four are worth touching, and only after you've measured them.

## Checking your work

```bash
# before
curl -s -o /dev/null -w '%{time_total}\n' localhost:8002/analytics/detailed
# ...change one thing, restart the daemon...
# after
curl -s -o /dev/null -w '%{time_total}\n' localhost:8002/analytics/detailed
```

Also diff the **response body** before and after. An optimization that changes the numbers is a bug, not a speedup:

```bash
curl -s localhost:8002/analytics/detailed > /tmp/before.json
# ...change...
curl -s localhost:8002/analytics/detailed | diff /tmp/before.json -
```

Report the result as `before → after` with the row counts it was measured against. "Feels faster" is not a result.

## Don't

- Don't add a cache, a background job, Redis, or a materialized table before trying SQL aggregation. There is no job queue in this project and adding one is a roadmap-scale decision.
- Don't add indexes without an `EXPLAIN QUERY PLAN` showing a scan that matters.
- Don't micro-optimize Python in `core/` — at a few thousand rows the loop is microseconds; the cost is loading and serializing the rows.
- Don't optimize the frontend before checking whether the API call or the chart render was the slow half.
