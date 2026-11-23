# Calendar live coverage — incomplete checkpoint (#62)

Authority: issue #62 and owner comment 7111764515; parent #59. This is not completion,
independent review, publication, or an acceptance claim.

## Engineering decisions

- Keep the delivered FullCalendar and its existing range source. A separate synchronous source
  consumes the shared timer controller; no extra polling, writes, schema, or scheduling engine.
- Existing `/timers` segment geometry owns intervals. Committed fragments are omitted from LIVE.
  Buffered ends are fixed; the open interval ends at the additive service `observed_at` UTC cutoff,
  never a browser extrapolation. Status refresh supplies growth at the existing polling cadence.
- A controller state event carries the existing snapshot to the adapter. Direct and recovered
  ACK invalidate overlapping status generations and clear the old open cutoff before refresh.
  Calendar range generation also advances synchronously at ACK, before fallible display reads.
- Live events are noneditable and use a separate stable `live:timer:segment` namespace. Clicking
  selects the existing shared timer without resuming. Saved/plan row writers remain unchanged.
- `observed_at` is volatile presentation, like elapsed; the existing schedule-extension test now
  excludes it when comparing unchanged durable timer state.

## Evidence / acceptance matrix

| Cell | Actual result |
| --- | --- |
| Public status cutoff | RED missing `observed_at`, then GREEN 3 HTTP Calendar tests |
| Uncommitted-only pause geometry | RED missing module, then GREEN exact Node fragment fixture |
| Running cutoff / stopped suppression | GREEN Node public adapter fixture |
| Final full Python | 1113 passed, 4877 warnings, 315.93s |
| Final full Node | 880 passed, 0 failed |
| Changed JS syntax / scoped Ruff / whitespace | Passed |
| Whole-repo Ruff | 17 inherited findings in three untouched files |
| Browser | FAILED before assertions; see exact error below |
| Migration | Not applicable: no schema change |
| All requested navigation/correction/late-read fault browser scenarios | UNRUN |
| Complete public controller race matrix | INCOMPLETE |
| Desktop/narrow visual acceptance | UNRUN |

First full runs found one new Python comparison failure (volatile cutoff) and one Node regression
from returning without settling stale FullCalendar callbacks. The Python comparison now excludes
volatile presentation, and existing settled-callback behavior was retained; final suites above pass.

The isolated server used port 18622 and external HOME/TMPDIR/database; both exact owned uv/python
processes were terminated and confirmed absent. No personal DB or provider calls were used.
The session Orca headless tab was created, then navigation and evaluation were attempted. The
first evaluation failed with `browser_error`: `Failed to evaluate in browser page
34610d0c-e331-4228-a9e7-ba4854dc8879: Inspected target navigated or closed`.
Per dispatch instruction, no alternate browser/tool/backend or retry was attempted.

Full logs: `/tmp/tt62-python-final.log`, `/tmp/tt62-node-final.log`,
`/tmp/tt62-ruff-full.log`; red logs `/tmp/tt62-red.log`, `/tmp/tt62-python-red.log`.

## Remaining work

Do not merge as completed #62. Real browser acceptance and expanded public controller/HTTP cases
remain outstanding, including mixed saved/buffered correction, lost ACK/reload, task edits,
selection/editor ownership and both-direction navigation. Adapter initial-state delivery and
Calendar live click focus need actual browser validation. This checkpoint has not proved every
acceptance criterion and is explicitly returned as failed/incomplete after the browser failure.
