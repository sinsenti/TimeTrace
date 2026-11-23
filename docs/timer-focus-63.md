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
| Overrides, next-period settings and disable | Not implemented |
| Independent active clock, pause/idle/correction and actions | Not implemented |
| Automatic boundary continuity and catch-up | Not implemented |
| Immutable warning evaluation | Creation anchor only; evaluation not implemented |
| Durable event claims, adapters and bounded daemon lifecycle | Not implemented |
| Browser settings, countdown, actions, drafts and narrow layout | Not implemented |
| Migration 0019 fresh/copied-synthetic/fault acceptance | Not implemented |
| Final Python/Node/scoped lint/browser | Not yet run |

## Exact initial red/green

2026-11-23: isolated external HOME/TMPDIR/DB; `uv run python -P -m pytest tests/test_timer_focus.py -q`.
Red: 1 failed, GET `/timer-focus/defaults` returned 404. Green after minimal defaults slice: 1 passed
in 0.17s. This single slice is not acceptance of the full ticket.
