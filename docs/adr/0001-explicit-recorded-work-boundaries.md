# Keep recorded work, work association, and existing accounting distinct

The owner accepted these Agenda boundaries during the contract discussion for GitHub issue [#2](https://github.com/sinsenti/TimeTrace/issues/2). They are settled inputs to the shared contract, not approval of a production implementation.

Recorded work has at most one scheduled-session association, established by an explicit action such as recording from that session or deliberately attaching an existing record. Same-task/time matching may fill other plans without granting destructive ownership. Delete everything removes the entire explicitly associated work record, including any portion outside the schedule, only after the confirmation shows that full interval. Unrelated work is preserved.

The new manual recorded-work flow rejects an end in the future; scheduled sessions express future intentions. Existing session APIs currently permit future ends, so the shared compatibility contract must distinguish old callers from this new explicit recording action rather than silently changing their meaning.

Taskless work contributes to elapsed recorded time and separately displayed unassigned recorded time, but not recorded task time. Unassigned recorded time unions taskless intervals; these metrics can overlap and are not simply additive. Existing task progress/balances retain their accounting basis alongside clearly labeled new union-based metrics; no historical reclassification is authorized.

Delete everything and Squeeze require the associated timer to be stopped and its pending idle gap resolved first; manually paused timers are still unfinished. Neither action silently stops, detaches or discards a timer. Starting a task with an unfinished paused/frozen timer selects that existing timer, preserving its elapsed work, association and gaps, without resuming or creating another. Resolving an idle gap leaves the timer paused until explicit Resume; the gap ends at return to activity, and review delay is not automatically credited.

Untouched, unmaterialized recurring plans do not acquire a new permanent historical archive. Preserve immutable originals for persisted or explicitly changed plans without read-side materialization or recurrence pre-generation. This avoids manufacturing history from projections while retaining explicit plans and performed work.

The owner subsequently accepted [questions 10–12](https://github.com/sinsenti/TimeTrace/issues/2#issuecomment-6959931616):

- A work association requires the same non-null assigned task on the work and scheduled session. Taskless or different-task work requires an explicit task assignment change before attachment; attachment must not retag automatically.
- Starting from another plan for a task with an unfinished timer selects the existing timer with its current association unchanged and visibly reports that association. Changing it requires a separate explicit action; already-recorded work is not moved retroactively.
- New union measures select records by local start-date range, retain each selected record's whole interval without clipping, and bucket by local record-start day. Scalar unions are recomputed independently of groups and limits. Overlapping day/group unions are non-additive and must be labeled accordingly. Existing measures and negative/unbounded accounting behavior remain unchanged.

The owner also accepted [Q14 split-evenly attribution](https://github.com/sinsenti/TimeTrace/issues/2#issuecomment-6960719516) for the new union metrics: divide each covered minute among its distinct active tags before filtering, without renormalizing hidden shares. Use per-task domains for recorded task time, cross-task domains for elapsed time, and taskless domains for unassigned time. A 60-minute record tagged `a` and `b` allocates 30 minutes each; filtering to `a` retains 30 attributed minutes, distinguished from its 60 physical cohort minutes. Existing duration-based measures remain unchanged.

The technical review repairs are independently verified. The owner subsequently confirmed all six testing seam groups and requested the first test-first #2 foundation slice in its isolated worktree. This settles the shared contract prerequisite, not downstream ticket completion or permission to push or merge.

## Scoped supersession: unassigned interval sums (#68)

The owner subsequently approved [#68](https://github.com/sinsenti/TimeTrace/issues/68), replacing
**only** the unassigned union decision above with the sum of each unassigned saved interval's full
duration, including overlap. Two taskless 10:00–10:20 records contribute 40 unassigned minutes,
20 elapsed minutes and zero task minutes. Neither record is merged, rewritten, deleted or reclassified.
Elapsed recorded time, recorded task time, plan comparisons, task estimate accounting and goals retain
their existing bases. The earlier union and Q14 text remains as the historical decision, not the
current rule for unassigned recorded time.

For this measure only, Q14's attribution domain becomes **each record**, not the shared taskless
clock: fan-out deduplicates matching record IDs before summing full durations; tag rows can overlap.
Split-evenly divides each record among its own distinct tags before filtering, without redistributing
hidden shares. Two overlapping 20-minute records tagged {a,b} and {b,c} split to a=10, b=20, c=10;
filtering to b retains 20 attributed minutes and 40 physical-cohort minutes. That physical cohort is
the sum of matching record durations, **not elapsed clock coverage**. All other measures keep their
original active-tag union rules. Local start-day cohort selection, whole intervals, independent
scalars before row limits, explicit exclusion of legacy/live buffers and existing filter restrictions
remain unchanged. Unassigned day groups reconcile; fan-out tag groups remain non-additive. Task,
elapsed and unassigned totals must never be presented as additive components of one clock total.
