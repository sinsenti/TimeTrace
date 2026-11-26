# #72 S1 — saved dashboard widget dragging

Baseline: `cacf046`. This lane changes only the Statistics grid interaction; no analytics,
query/spec, API, service, database, or ownership semantics are redesigned.

## Interaction and safety

- Each saved widget has a **Move** handle instead of permanent earlier/later arrow buttons.
  Drag the handle to another card's marked insertion edge. Full-row/narrow cards use top/bottom
  edges; other cards use left/right edges. Logical DOM order remains the persisted order;
  widget widths and full UUID identities travel with their cards.
- Focus Move and press an arrow key to move one position. Position/help text is available to
  assistive technology; successful rendering restores focus to the moved widget's handle.
  Escape cancels a drag. Repeated held keys do not queue writes.
- Only handles can start a drag. Card/chart/table/input content, external drops, obsolete
  owners, an open/initialized editor, and pending dashboard/editor writes cannot reorder.
- Both keyboard and native drag use the existing complete `widget_ids` reorder endpoint and
  writer ACK fence. Nothing moves optimistically. A late ACK cannot reorder another dashboard.
  No healthy analytics query is rerun just to move cards.
- A failed/unacknowledged reorder blocks new moves for that dashboard until a successful detail
  read **begun after the failure** reconciles its current order. Retry refresh reads; it never
  repeats the write. Independent dashboards retain their own uncertainty fences. The existing
  backend still rejects duplicate, foreign, stale/partial widget sets.

`dashboard_drag.js` is the native grid presenter/controller: delegated actual drag/key events,
owner/order snapshots, responsive insertion markers and cancellation. `dashboards.js` retains
persistence, uncertainty recovery, chart rendering and selection ownership.

## Automated evidence

Public seam: actual grid/handle events → real drag controller + dashboard presenter + shared
API client → fake external HTTP boundary; assertions use rendered cards and HTTP payload/readback.
No new test calls private helpers, mocks application modules, or asserts source strings.

Vertical red/green steps (`tests/test_dashboard_canvas.cjs`):

1. `node --test --test-name-pattern='dragging a handle' tests/test_dashboard_canvas.cjs`
   RED: no dedicated accessible drag handle; GREEN: 1 passed after native controller integration.
2. `node --test --test-name-pattern='unknown reorder' tests/test_dashboard_canvas.cjs`
   RED: a failed reorder blocked an independent dashboard; GREEN: 1 passed with dashboard-local fences.
3. `node --test --test-name-pattern='display read started' tests/test_dashboard_canvas.cjs`
   RED: a read started during a pending write released later uncertainty; GREEN: 1 passed with
   read-start reconciliation fencing.

The expanded canvas suite has 29 cases (six new), including full UUID payload/reload, mixed
widths, narrow insertion edges, real keyboard events/focus, pending/late ACKs, lost ACK/read-only
retry, editor/content/external/canceled/obsolete gestures and keyboard boundaries/repeat.

Focused final regression command:

```sh
node --test tests/test_dashboard_canvas.cjs tests/test_sql_widget_canvas.cjs \
  tests/test_widget_stack_collision.cjs tests/test_draft_ownership.cjs \
  tests/test_sql_widget_builder.cjs tests/test_performed_time_widget.cjs
```

Result: **133 passed, 0 failed**. Existing intentional failed-capability/SQL-preview fixtures
print their expected API diagnostics. All five changed JS/test JS files pass `node --check`;
`git diff --check` passes. Four unsafe native-probe invocations (personal port, remote host,
personal DB path, traversal) were refused before browser/HTTP access.

## Native gate — parent execution still required

`tests/browser_dashboard_drag_72.js` is a bounded external-runner function:

```js
await probe(page, 'http://127.0.0.1:18132', {
  expectedDbFile: '/tmp/timetrace-ui72-stats/dev.db'
});
```

The parent must first own a synthetic daemon/profile. The probe rejects the personal port,
non-loopback host, non-`/tmp/timetrace-ui72-*` path and mismatched `/health` DB/port before writes.
It creates/removes only its own dashboard/widgets via public HTTP; checks a native mouse drag,
visible insertion edge, complete UUID persistence, reload, mixed widths, keyboard focus/order,
narrow order/overflow and unchanged other-dashboard orders. It does not inspect or mutate private
storage. The legacy canvas probe's keyboard action now targets Move/ArrowLeft, not removed arrows.

No daemon was started, browser gesture executed, Python/full suite run, personal data accessed,
or final visual/accessibility acceptance claimed in this lane. Native drag/reload, full gates,
independent Standards/Spec review and owner visual verdict belong to the parent. Physical touch,
screen readers and other browser engines remain separate manual coverage.
