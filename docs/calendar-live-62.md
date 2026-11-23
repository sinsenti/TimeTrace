# Calendar live coverage (#62)

Authority: [#62](https://github.com/sinsenti/TimeTrace/issues/62), owner brief
7111764515 and parent #59. Implementation is ready for independent review, not publication,
closure, deployment or human visual acceptance. Earlier `ce970bd` was an incomplete checkpoint;
its 1113 Python/880 Node receipts remain historical, not the final evidence below.

## Engineering decisions

- Retain delivered FullCalendar and its range source. A separate synchronous source consumes the
  shared timer controller; no extra polling, writes, schema, or scheduling engine.
- `/timers` geometry owns intervals. Committed fragments are omitted from LIVE. Buffered ends
  are fixed; open coverage ends at additive service `observed_at` UTC cutoff, never browser
  extrapolation. Growth follows the existing three-second shared polling cadence.
- Controller state events carry the public snapshot. Direct/recovered ACK invalidate overlapping
  status generations and clear old open cutoffs before a fallible replacement read. Calendar
  range generation advances synchronously at ACK, before metadata/range refresh.
- Live events are noneditable and use `live:timer:segment` identities. Clicking selects the
  existing timer and invokes the existing workspace link, including its dirty-editor departure
  guard. No implicit Resume, idle resolution, association change, or duplicate Start.
- `observed_at` is volatile presentation like elapsed; the existing schedule-extension comparison
  excludes it when checking durable state. No signed payload/hash/receipt schema changes.
- Existing task metadata, notes, plan editor, recurrence and #65 SUM/export remain their owners.
  Full suites preserve their contracts; Calendar neither edits nor infers plans/task completion.

## Red/green evidence

Initial public Node RED: missing adapter module; GREEN exact uncommitted pause fixture. Public
HTTP RED: missing observation cutoff; GREEN Calendar HTTP tests. First full runs exposed a
volatile-status equality failure and a stale FullCalendar callback settlement regression;
comparison excludes volatile presentation and stale callbacks retain existing settlement behavior.

Recovery browser RED: clicking an actual live event left `/dashboard` rather than opening the
selected current timer. Minimal GREEN: delegate selection navigation to the existing guarded
workspace anchor. Separate post-navigation checks observed the selected visible Agenda card;
paused selection retained one paused timer with the same identity and note.

Expanded public checks exercise committed segment identities, corrected starts, pause/resume,
split/Stop and separate descriptions through root HTTP; actual exported controller tests hold
status reads across direct/recovered Stop ACK while replacement reads hang. No internal model
mocks or source-text assertions were added.

## Acceptance matrix / actual evidence

| Cell | Result |
| --- | --- |
| Shared cutoff and mixed saved/buffer identity HTTP | 4 focused tests passed |
| Exact live pause/growth/noneditable/stopped and ACK races | 4 focused Node tests passed |
| Taskless pause/resume/Stop and exact returned saved rows | Real browser passed |
| Running signed start correction, rename and unchanged plan/legacy | Real browser passed |
| Exact running exclusions, committed fragments omitted, separate notes | Real browser passed |
| Saved split, earliest identity and descriptions retained | Real browser passed |
| Parallel running + frozen, unresolved idle gap fixed | Real browser passed |
| Full task editor draft survives refresh; normal Save updates shared metadata | Real browser passed |
| Dirty task navigation confirm dismissed; draft/focus retained | Real browser passed |
| Calendar live select -> selected visible Agenda; paused state preserved | Real browser passed |
| Agenda -> Calendar; current note UI Save reflected in shared state | Real browser passed |
| Paused dated-start correction remains paused | Real browser passed |
| Lost Stop ACK -> reload -> recovered saved state; retries send zero POST | Real browser passed |
| Held old status and held old range after Stop | Real browser passed |
| Desktop 1280×900 / narrow 390×844 existing Calendar and plan source | Real DOM checks passed |
| Plan/work/legacy type distinctions and unique source identities | Real browser passed |
| Final full Python | **1114 passed**, 4877 warnings, 320.27s |
| Final full Node | **882 passed**, zero failed |
| Changed JS syntax / scoped Ruff / whitespace | Passed |
| Whole-repository Ruff | 17 unchanged inherited findings in three untouched files |
| Migration | Not applicable: no schema change |
| Raster / human / platform certification | Unrun; not implied by DOM proof |

Full commands: `uv run python -P -m pytest -q` with fresh external absolute database/HOME/TMPDIR;
`node --test tests/test_*.cjs`; `node --check` for calendar, calendar_live, dashboard,
multiple_timers and browser_calendar_live_62; scoped Ruff on changed Python and whitespace check.
Final logs: `/tmp/tt62-recovery-python-final.log`, `/tmp/tt62-recovery-node-final.log`.
Inherited lint paths are migration0002, CLI commands and analytics_service; all are unchanged
against the integration base. No unrelated lint cleanup.

## Reproducing the browser cases

`tests/browser_calendar_live_62.js` is evaluated in the owned synthetic Orca page via the supported
session CLI. Its cases are explicitly separated from navigation: `pause-resume-stop`,
`correction-fixture`, `mixed-exclusion`, `full-task-editor`, `lost-stop-ack`, reload,
`recovered-stop`, `saved-split`, `late-status-stop`, `late-range-stop`. The fixture guard requires
port18622 and the exact external synthetic DB, intentionally refusing personal data. Setup uses
normal HTTP. Synthetic idle onset/return uses public `MultipleTimerService.observe_activity`
with that same external environment, not OS activity or real alerts. Explicit discard resolves
that synthetic gap before saved correction; selection alone never resolves it.

Navigation: snapshot the exact owned page, click the live event, wait for `/agenda-view`, then
snapshot/assert the selected current card. Return explicitly to `/dashboard` and wait for the
FullCalendar harness. Do not await a Promise across navigation. The full task editor is
`openEditTaskModal`/normal Save; dirty navigation uses a real confirm dismissed by Orca dialog
command. Current work note uses the real Agenda textarea/Save button.

### Failed attempts retained honestly

The first dispatch's `Inspected target navigated or closed` was an evaluation context loss:
the page still existed at the newly selected Agenda URL. Coordinator-authorized recovery pinned
that same page, verified owned health, navigated explicitly, and split subsequent actions at
navigation boundaries. No alternate browser/tool/backend was used.

An initial exclusion assertion compared FullCalendar `event.start/end` Date accessors, which
truncate fractional seconds, rather than authoritative `startStr/endStr`; those strings retained
exact milliseconds. Corrected the browser assertion, with no production geometry workaround.
Saved correction initially correctly refused unresolved idle; explicit synthetic discard then
allowed it. Invalid -60-second step and a +300 context-crossing paused edit correctly refused;
a valid dated one-second paused trim passed. A wait for nonexistent note success copy timed out;
DOM/public status inspection confirmed the real note Save had succeeded without replay.

Browser receipts are `/tmp/tt62-browser-pause.json`, `tt62-browser-correction.json`,
`tt62-mixed-retry.json`, `tt62-frozen.json`, `tt62-saved-retry.json`, `tt62-full-editor.json`,
`tt62-recovered.json`, `tt62-late-status.json`, `tt62-late-range.json`, `tt62-desktop.json`
(with `/tmp/` prefix). These are local evidence, not published artifacts.
