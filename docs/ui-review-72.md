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

Implementation, review, native verification and final gate results: pending.
