# Focus implementation ledger (#63)

Authority: [reviewed owner brief](https://github.com/sinsenti/TimeTrace/issues/63#issuecomment-7102493844).
This is an engineering/evidence ledger, not a replacement specification or delivery receipt.

## Confirmed seams and decisions

Public root HTTP/service, public JS controller, isolated real browser. Existing receipt funnel
serializes writes; legacy request models and digest construction remain untouched. Defaults live in
the existing versioned timer file and use the existing SQLite operation receipt, not another store.
New timer identities capture creation independently of editable credited intervals. Period settings
are snapshots; later defaults affect future timers only. Validation is strict and bounded 1–1440
whole minutes. No external adapter or live notification has been invoked.

## Acceptance matrix (in progress, not delivered)

| Cell | Evidence |
| --- | --- |
| Initial defaults, future timer snapshot, exact replay, invalid boolean length | Public HTTP red 404 then green 1 passed (`tests/test_timer_focus.py`) |
| Overrides, next-period settings and disable | HTTP routes and period snapshots implemented; bounded evidence only |
| Independent active clock, pause/idle/correction and actions | Public fake-clock pause/Take break/early Resume/replay/observed-idle test passes; correction/race matrix not yet proved |
| Automatic boundary continuity and catch-up | Not implemented |
| Immutable warning evaluation | Creation anchor only; evaluation not implemented |
| Durable event claims, adapters and bounded daemon lifecycle | Not implemented |
| Browser settings, countdown, actions, drafts and narrow layout | Not implemented |
| Migration 0019 fresh/copied-synthetic/fault acceptance | Not implemented |
| Final Python/Node/scoped lint/browser | Partial-source Python 1114/Node 878 pass; scoped Ruff passes; browser unrun |

## Exact initial red/green

Second slice: settings POST initially 422 (legacy generic mutation rejected extra fields), then
2 focused tests passed in 0.26s. Third red: ordinary Resume retained break phase; minimal green
adds explicit break-to-work restart and idle checkpoint at observation onset. The focused pair
then passed in 0.33s with idle enabled explicitly in the idle test (not globally disabled).
A preliminary full Python run after slice two passed 1114 tests in 339.43s, with 4877 warnings;
this predates the last idle/ordinary-resume change and is not final-source acceptance.


## Final partial-source checks (not ticket delivery)

At production tip `531b1e6`, full `uv run python -P -m pytest -q`: **1114 passed**, 4877 warnings,
314.95s. `node --test tests/*.cjs`: **878 passed**, zero failures/skips, 3.94s. Scoped Ruff passes.
Repository Ruff reports the inherited **17** findings; every offending file (migration0002,
CLI commands, analytics service) and the models noqa warning is unchanged versus `e96497a`.
No JS was changed. No schema change or migration0019 was made; migration acceptance, native delivery,
real browser, clock discontinuity, external-send and focus-specific fault matrices remain unrun.
No daemon or real OS notification/sound was started. `git merge timer-workspace-integration`
reported already up to date at `e96497a`; this does not integrate the partial feature elsewhere.

**Incomplete: do not publish/close #63 or describe these checkpoints as the whole implementation.**
There is no notification evaluator, event table, delivery adapter, automatic-break boundary,
warning evaluation, UI or platform acceptance. The existing HTTP settings accept automatic-break
policy but its evaluator is absent: this branch is development-only, not a working automatic mode.

2026-11-23: isolated external HOME/TMPDIR/DB; `uv run python -P -m pytest tests/test_timer_focus.py -q`.
Red: 1 failed, GET `/timer-focus/defaults` returned 404. Green after minimal defaults slice: 1 passed
in 0.17s. This single slice is not acceptance of the full ticket.
