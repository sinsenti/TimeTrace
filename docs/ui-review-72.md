# Owner UI review #72 — first implementation batch

Canonical review map: https://github.com/sinsenti/TimeTrace/issues/72.
Review baseline: `cacf0466df45cb72400c57c0f249f5bed025e853`.
This ledger describes local work, not deployment or final visual acceptance.

## Owner decisions

- Use **Entry note** for both current timer notes and saved recorded-interval notes. The task
  description and a scheduled session's notes remain separate concepts.
- **Discard timer** removes only the selected timer's not-yet-recorded work and timer-bound notes.
  Saved recorded intervals, tasks, original/current plans and other timers remain unchanged.
- The owner authorized starting the full initial review batch with subagents. Existing root edits
  in `docs/development.md` and the dashboard prototype wrapper are unrelated and protected.
- The existing real test UI on18131 stays available while isolated work is developed. No personal
  database/provider/key access, personal-daemon restart, deployment, push or dev merge is implicit.

## Work and shared contracts

Parallel isolated lanes: shared in-app dialogs/Agenda presentation/light-mode controls;
selected-timer discard/secondary timer presence; real dashboard widget drag-and-drop. Activity
layout/frequency source feasibility is investigated separately before inventing a historical metric.

The shared browser API is `window.appDialogs.confirm({title, message, confirmLabel, cancelLabel,
danger}) -> Promise<boolean>`; any needed alert/prompt equivalents are app-owned too. Confirmations
must capture their intended target before awaiting and revalidate stale state afterward; no global
Promise-returning replacement masquerading as synchronous `window.confirm`. Cancel/Escape send no
mutation and cannot leave pending ownership stuck on a delayed native close event. Platform-owned
file/permission/unload dialogs are outside this application-controlled contract.

Use the established public service/root-HTTP and JS-controller/presenter test seams, fake external
boundaries and isolated synthetic actual-app checks. Workers run focused red/green slices; the parent
runs full Python/Node gates at the end and the independent Standards/Spec review. No passing drag
unit test substitutes for a real drag gesture, persisted order and reload verification.

## Integration and bounded evidence

- Statistics lane commit `bd8190f` integrated as `1448502`: handle-only native widget dragging,
  keyboard reordering, persisted full-ID order and dashboard-local uncertainty/read-start fences.
  Worker focused Node checks:133 passed; full gates/review remain pending.
- Parent's Orca-native equivalent of the tracked drag probe passed against the owned18132 scratch
  app: actual mouse down/moves/up exposed the insertion indicator, one intended drag reorder was
  persisted, reload retained it, keyboard moved exactly one place, and other dashboards stayed
  unchanged. The temporary dashboard alone was removed after the check. Narrow viewport, physical
  touch, other engines/screen readers and owner visual acceptance remain unclaimed here.
- Source correction: the existing Agenda note filter matches both saved-entry notes and scheduled
  plan notes (not task descriptions/live timer notes). Preserve that behavior with neutral label
  **Notes contain** and accurate help; do not silently hide plans under a presentation change.
- Discard note input may be read-only only for that target while discard is sent/uncertain, retaining
  text until own confirmed ACK and leaving other drafts editable. New typing before submission
  invalidates approval; refusal restores editability; unknown outcomes recover by GET only.

- Timer lane commit `ee77193` integrated as `e7ed44a`: durable selected discard, target-note
  ownership/unknown recovery, Entry note editor label, and stable secondary-timer presence. Worker
  focused checks:106 Python passed/84 warnings and41 Node passed. Parent added the presence CSS
  include; combined native discard and review/full gates remain pending.

- Dialog/presentation commits `095de12`/`53063ef` integrated as `130864f`/`547dc7d`. The single
  conflict was the shared canvas DOM adapter/test additions; both sets were retained and30 canvas
  cases passed. Worker focused gates:646 Node and39 Python passed. Parent cache-versioned changed
  assets across every serving template; two old fixed-version assertions were updated to require
  versioned assets without pinning an obsolete literal. Combined focused checks:24 Python/56 Node
  passed after those test repairs.
- Priority discovery `bb6cb36` integrated as `7872b12`: Agenda's compact High/Medium/Low/No priority
  groups use server-filtered selectors before bounds; shared Suggested defaults stay unchanged.
  Worker focused gates:62 Python/87 Node passed. Start-frequency/history ranking remains entirely
  pending the owner's choice; no false Frequent label or historical reconstruction was added.
- Combined owned18132 native checks passed: actual mouse drag + persisted/reloaded order and keyboard
  movement; default Enter and Escape cancel discard with zero writes; target Entry note becomes
  read-only during a held actual discard response; own ACK removes only that timer/draft, with one
  discard POST and unchanged saved rows and other timer geometry. Early discard-probe attempts used
  an over-broad closed-dialog selector and an unbound fetch spy (Illegal invocation); those harness
  faults were corrected, not represented as product failures or passing checks.
- Help/filter dialogs have footer Close; filter copy accurately includes plan notes; schedule inputs
  use second granularity. Native computed styles across Refined Archive/Stone/Porcelain show no
  purple estimate badge fill, while the existing purple dark Edit/badge styling remains.

## Independent review and repair

Initial `cacf046...ce3f30b` review: **Standards0 findings**, **Spec1 P1**. The Spec finding was
identity loss during keyboard reorder when widget titles match: focus restoration used a display
label rather than the owning widget ID. `26acca8` adds ID/control ownership; a mounted consecutive
keyboard-move regression failed before the fix and all31 canvas cases passed afterward. Two actual
native keyboard moves on identically titled widgets also kept the exact UUID and persisted order.
An additional duplicate-title mouse probe exceeded its harness timeout and is not counted as passed;
the earlier actual mouse drag/persistence/reload evidence remains separate.

Initial combined gates: **1281 Python passed/1696 warnings; Node958 passed/24 failed** out of982.
All24 failures reproduced as missing async app-dialog boundaries in four older test adapters. No
production fallback or weakened assertions were introduced. Repair `d0e9bf2`, integrated as
`e01cfcf`, gives983/983 Node passes in that lane (the extra case is the P1 regression, not a removed
failure). Scope/syntax/whitespace passed; broad Ruff retains17 inherited findings.

Post-repair independent recheck and final combined gates: pending. Owner visual acceptance and the
history-ranking choice remain separate; the ongoing #72 review map is not completed by this batch.
