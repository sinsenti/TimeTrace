# SQL widget: reachable guarded Settings departure
Status: Built — integrated with the owner-accepted UI in dev at `2992d96`
Date: 2026-11-11

Original owner approval: “approve for now. maybe later i will change this”. Approval alone did not
establish implementation or acceptance; subsequent delivery is recorded below. Original Draft
provenance is `ticket-13-after-reviewed-date` (a historical local branch, not a public attachment).

## Delivery reconciliation (2026-11-17)

The SQL Settings link, focus-trap integration and narrow unchanged-input deferred-blur repair are
implemented. Recorded bounded native evidence includes Cancel retention and accepted Settings
departure; source/regression checks are part of the integrated UI delivery. The original problem,
conditional approvals and verification requirements below are historical, not new open work.
No historical failed/unknown capture is relabelled, and broad platform/manual limits remain deferred.
See the [delivered successor](https://github.com/sinsenti/TimeTrace/issues/52) for sanitized bounded
native evidence and reachable accepted-source/regression links, and the
[shared delivery summary](README.md#delivery-status-and-evidence) for current checks and remaining
verification. The [migration mapping](../docs/agents/github-migration.md) preserves original IDs.

## Original problem (pre-repair snapshot)
The SQL editor's full-viewport modal covers the navbar Settings link. Its Tab loop stays inside the dialog; Vim navigation ignores open dialogs. The existing `followSettingsLink(event)` dirty-draft confirmation therefore has no established native Settings caller while this editor is open. Current real-browser evidence records cancellation retaining the SQL draft as blocking UNRUN, not PASS. Independent Spec review of b8884c9 retains this as a P1 acceptance gap.

## Approved behavior
1. MUST add a normal **Settings** link inside the existing SQL pane, targeting `/settings` and using the existing `followSettingsLink(event)` handler. It is visible/reachable only with that pane, without raising the navbar above the modal or changing other editors.
2. MUST let native pointer activation and ordinary keyboard Enter on that link invoke the existing dirty confirmation. Cancel leaves the editor open with unchanged SQL, title, width, limit, chart, selected columns and current preview provenance; it does not navigate or save anything.
3. MUST preserve the existing accepted-departure behavior: confirming discard follows the normal link. Clean drafts and modified/new-tab clicks keep the current handler's semantics. No new draft persistence or Save-and-leave choice.
4. MUST include the visible anchor in the modal's existing focusable-element enumeration so Tab/Shift+Tab trapping remains correct. Keep Escape and existing SQL Enter/Ctrl+Enter contracts; no general shortcut redesign.
5. MUST retain the old UNRUN/failure/sequence/capture records. A new, separately isolated native result can demonstrate this new caller; it cannot retroactively pass the old run or supply its missing DELETE-response body.

## Data, API, time and identifiers
No schema, migration, backfill, JSON endpoint, query resource limit, identifier or datetime change. `/settings` already exists. No timer/session/provider writes or scheduled/performed-time semantics change.

## Layers
- Template: `interfaces/api/templates/components/widget_builder_modal.html`, SQL pane only.
- JS: `interfaces/api/static/js/widget_builder.js`, existing focusable selector plus the conditionally approved narrow deferred-blur repair below. No other preview or navigation redesign.
- Existing guard: `interfaces/api/static/js/settings.js:followSettingsLink`, reused unchanged.
- Tests: focused widget keyboard/draft regressions and a new actual native caller check; preserve the earlier probe and raw receipts as historical evidence.
- Core/services/routers/models/CLI: unchanged.

## Deferred-blur follow-up approval (historical)
Owner: “continue according to your recommendation” after the explicit request to reproduce the independently reported Ctrl+Enter → blur → Settings Cancel edge, then narrowly repair preview invalidation if confirmed. Approval is conditional on reproduction, not a claim that the browser sequence has already been executed. Preserve the original clean `5dc48b7` worktree and receipts.

An unchanged SQL/limit/chart deferred `change` MUST NOT revoke a current pending request or completed preview. Genuine input edits MUST still invalidate immediately; editing away and back MUST NOT resurrect an obsolete response. Add meaningful first-failing regressions and fresh native pointer/TabEnter Cancel coverage with newly edited, still-focused SQL and a completed Ctrl+Enter preview. No automatic queries/saves, new global guard, shortcut, confirmation policy or structured-builder redesign. Existing fresh-isolation, shutdown, evidence and independent-review requirements apply. Historical settled-input native passes remain valid, not proof of this additional ordering.

## Edge cases
Cancel with dirty or clean inputs; visible/hidden SQL pane and SQL-disabled UI; native pointer versus keyboard activation; Tab/Shift+Tab boundaries; delayed preview/Save ownership unchanged. Running/frozen timers remain file state and must not be toggled by navigation. No alternate route if a native dialog or transport check fails.

## Out of scope
Global beforeunload/history/navigation guards, navbar stacking changes, a new Settings shortcut, helper-dispatched clicks, forced clicks, browser Back substitution, automatic draft saving/restoration, new confirmation wording/policy, structured-builder redesign, provider/Test/Activate/inference calls, merging/pushing or acceptance waivers.

## Original verification requirements

These requirements describe the delivered amendment's verification contract, not a new execution
request. The delivery note above takes precedence over historical pending-gate language below;
failed/UNRUN receipts and platform/transport exclusions are preserved.
- Meaningful first failing regressions against current source, then scoped implementation and focused green checks. Native tests must use real DOM input/link activation and the real confirmation, never direct handler invocation.
- New private0700 roots/strict24 environment/new offline editable Python3.14.6 before app imports; safe-path full pytest/canonical Node/enumerated syntax, scoped lint/format and actual full Ruff compared to its fixed18/BOTH-stream baseline (not called lint-clean).
- Fresh guarded SQL-on native fixture: edit all draft fields, register real confirmation before activating the new link, dismiss natively, verify route/all fields/preview/no persistence writes and unchanged full storage. Exercise native keyboard and focus trapping. Accepted departure, if tested, uses the real readonly Settings page with guarded requests and no provider/model calls.
- Full owned storage/source/traffic capture inspection and sole-owned-pidfd shutdown proofs; no old roots/venvs/DBs, passing reruns for cosmetic evidence, fabricated successful CRUD or cleanup deletion.
- Fresh exact amendment/combined independent reviews after the follow-up local commit. Existing all-six-criteria/manual/a11y/provider/transport/human/whole25 gates stay pending unless independently satisfied.
