# #72 remaining Node dialog-fixture regressions

Repair branch: `fix/ui72-dialog-regressions`, created in the dialogs worktree from exactly
`26acca819d0b9388eceb37d7c2924d8bfed5bec1`. The previous `feat/ui72-dialogs` branch is retained.
The worktree/index were clean before the explicitly approved branch switch.

## Diagnosis and scope

The parent full Node run reported **982 tests / 958 passed / 24 failed**. All 24 failures were
reproduced in their four source-named suites on the new baseline, before editing each suite.
They are **test-fixture integration issues**, not reproduced production bugs:

- Assistant lifecycle (13): the bounded browser fixture still supplied synchronous `window.confirm`
  instead of the now-public asynchronous `window.appDialogs.confirm` human-decision boundary.
- Habit cards (2): retained-draft departure checks encountered the same missing decision SDK surface.
- Performed-time widget (1): its capabilities-error assertion expected a native alert, while the
  production builder now renders an app-owned notice.
- Task knowledge/recurrence callers (8): missing `appDialogs.alert` or `confirm` in the metadata/Session
  fixture. Three resize assertions observed two reverts because the absent alert threw after the
  first revert, entering the existing exception path. Providing the correct boundary restores the
  original exactly-one-revert assertion without changing production error or recurrence handling.

Only the four test files and this evidence document changed. No production code, service, database,
recurrence behavior, ranking/frequency semantics or API fallback changed. In particular,
`dashboards.js` and `test_dashboard_canvas.cjs` remain exactly as inherited, preserving the parent
Spec P1 duplicate-title keyboard-focus repair.

## Fixture repairs

The existing Assistant, Habit and metadata DOM adapters lack native dialog/top-layer dispatch.
They now expose an explicit asynchronous app-decision SDK boundary; accepted/canceled test decisions
use that interface, not a reinstated browser fallback. Existing callback awaits and microtask drains
already accommodate the human-decision await, so no timing assertions were removed or weakened.

The richer performed-widget DOM adapter now runs the **real `app_dialogs.js`**, loaded before callers.
Its capabilities-failure regression checks the actual rendered explanatory notice, safe initial Close
focus, explicit Close removal, no native alert and zero widget writes. Ordinary fixture checks also
reject unexpected open app notices. The DOM adapter implements only the append/modal/removal methods
needed by that public UI entry path; no builder or decision implementation method is mocked.

## Original 24-failure inventory

### `tests/test_clean_assistant_lifecycle.cjs` — 13

1. Acknowledged Delete retains instruction edits typed while the actual DELETE callback is pending
2. Delete ACK retains task edits opened after submission and Cancel permits later selection
3. Delete rejection retains task edits opened after submission and Cancel permits later selection
4. Dirty Delete ACK retires its identity and Cancel then Send submits once
5. Dirty Delete rejection keeps its usable identity and Cancel then Send submits once
6. Deleted orphaned edit survives drawer list refresh with empty history and refuses Send/New/selection
7. Deleted orphaned edit survives drawer list refresh with another thread and refuses Send/New/selection
8. Canceled Delete sends nothing; a held acknowledged Delete cannot clear a newer selected owner
9. Held Delete pauses Send, Enter and presets until ACK without losing composer input
10. Held Delete pauses Send, Enter and presets until rejection without losing composer input
11. Old Delete ACK finalizer cannot unlock a newer selected active turn
12. Old Delete rejection finalizer cannot unlock a newer selected active turn
13. Canceled Delete keeps sending available and makes no DELETE request

### `tests/test_habit_cards.cjs` — 2

14. Settings guard retains hidden date drafts, successful Save cleans only captured owner, and Cancel clears its owner
15. Failed write retains dirty owner; numeric zero draft is distinct from no record

### `tests/test_performed_time_widget.cjs` — 1

16. capability failure leaves performed preset unsaved and builder closed

### `tests/test_task_knowledge.cjs` — 8

17. unresolved offline recurrence blocks only resize, reverts, and can be retried
18. unresolved missing recurrence blocks only resize, reverts, and can be retried
19. unresolved partial recurrence blocks only resize, reverts, and can be retried
20. delete with offline recurrence stops before confirmation and retries without replay
21. delete with missing recurrence stops before confirmation and retries without replay
22. delete with partial recurrence stops before confirmation and retries without replay
23. deleting an uncached session uses its authoritative daemon link and known nonrecurrence
24. keyboard Delete uses recurrence protection for unknown sessions

## Exact local red / green commands

Each command ran before its suite's edits and again after the repair. No test was skipped, removed,
renamed or added; the performed-widget regression was strengthened at the actual UI boundary.

| Command | Red | Green |
| --- | --- | --- |
| `node --test tests/test_clean_assistant_lifecycle.cjs` | 44 total / 31 passed / 13 failed | 44 passed |
| `node --test tests/test_habit_cards.cjs` | 15 total / 13 passed / 2 failed | 15 passed |
| `node --test tests/test_performed_time_widget.cjs` | 8 total / 7 passed / 1 failed | 8 passed |
| `node --test tests/test_task_knowledge.cjs` | 72 total / 64 passed / 8 failed | 72 passed |

The focused reds therefore account for all 24 original failures (139 cases / 115 passed / 24 failed).
Logs: `/tmp/ui72-repair-{assistant,habits,performed,knowledge}-{red,green}.log`.

## Full Node gate and checks

```bash
HOME=/tmp/timetrace-ui72-dialogs/home TMPDIR=/tmp/timetrace-ui72-dialogs/tmp TIMETRACE_DB_FILE=/tmp/timetrace-ui72-dialogs/dev.db TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED=false LANGSMITH_TRACING=false node --test tests/*.cjs
# 983 tests / 983 passed / 0 failed / 0 cancelled / 0 skipped / 0 todo

for f in tests/test_clean_assistant_lifecycle.cjs tests/test_habit_cards.cjs tests/test_performed_time_widget.cjs tests/test_task_knowledge.cjs; do node --check "$f" || exit; done
git diff --check
# All four syntax checks and whitespace passed.
```

Full Node log: `/tmp/ui72-repair-full-node.log`. The count is **983**, not the original 982: inherited
baseline `26acca8` adds the consecutive-keyboard-moves/identical-widget-titles regression after the
parent's original full run. This repair adds no test case. That inherited case passed in the full run;
the protected dashboard source/test files were not edited.

The parent's earlier Python result (**1281 passed / 1696 warnings**) is inherited parent evidence,
not a Python rerun in this repair. No Python import, environment sync, database command, daemon,
browser, provider/key/model/OS experiment, merge, push or publication occurred. Synthetic-idle test
behavior was not disabled. No new finding required a business/product decision; frequency remains
pending and was not implemented or relabeled.

## Remaining gates

Parent integration, required independent review disposition, actual-browser/owner visual acceptance,
and final combined-gate status remain parent-owned. This fixture repair's full Node run is green;
it is not a claim that the entire #72 batch is accepted or authorized for publication.
