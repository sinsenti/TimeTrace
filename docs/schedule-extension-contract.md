# Explicit schedule extension (#6)

Shared root HTTP action: `POST /scheduled-sessions/{encoded plan ID}/extend`.
Body: `end_time` (UTC-compatible datetime), `operation_id` (1–200 characters), and exactly
one applicable revision: `expected_revision` for a saved plan, or
`expected_projection_revision` for a virtual occurrence. The end must be strictly after
the current end; start is the selected plan's current start, never inferred from work.
Returns the complete `ScheduledSessionRead` identity/revision and immutable originals.
A virtual extension captures just that occurrence and its originals in the existing
projection-token transaction; series duration and other occurrences remain unchanged.

The existing SessionService interval mutation and private MutationOperation receipt are
committed together under SQLite writer ownership. This DB-only operation is immediately
finalized; it never reads or replaces timer state. No schema change or second schedule
engine is introduced. Same operation ID and exact normalized payload return the original
fixed response (even after subsequent edits); different payload is 409
`operation_payload_mismatch`. Stale plan/projection is 409; invalid end is 400;
malformed/extra request fields are 422. Read `GET /operations/{operation_id}` to reconcile
an uncertain response. The result is the original complete plan response, not a new read.

`plan_extension.js` exports `createPlanExtensionAction({api, acknowledge, refresh,
onState, operationId})`: `preview(plan,end)`, `apply()`, `recover()`, `snapshot()`.
Preview is read-only; Apply alone consents. Acknowledge adopts returned ID/revision before
refresh; refresh failure permits read-only recovery, never another Apply. Uncertain
responses check receipts without replay. Stale results retain attempted interval and
require explicit latest-plan review/new preview. This is the available Calendar consumer
contract; Calendar integration does not require unpublished sibling code.

Real Agenda offers the action for a selected plan and from an explicitly associated timer
row, including a timer running beyond plan end. Same-task matching never selects ownership.
Proposed CURRENT interval is displayed before Apply, without overlap warning or another
confirmation. Running associated/parallel timers do not block it. Original/current fill
refresh together from `/recorded-work-progress`, preserving their separate bases and same
recorded-work snapshot. Starting an ended plan retains informational timer feedback only.
No elapsed-time automatic extension, reassociation, destructive action or new widget exists.
