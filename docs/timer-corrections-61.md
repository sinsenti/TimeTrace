# Timer corrections #61 — implementation checkpoints

Authority: [#61 finalized contract](https://github.com/sinsenti/TimeTrace/issues/61#issuecomment-7101764274).
This checkpoint is **not delivery of #61**; the finalized contract remains required.
Existing #60 evidence in `timer-workspace-60.md` is unchanged.

## Non-writing preview preparation gate

`POST /timers/{timer_id}/correction-preview` now has a dedicated strict schema and precedes
the legacy generic mutation route. This first checkpoint accepts only the contract's single
target shapes (`running`, `buffered`, `saved`) with `step_start` of exactly +300 or -300
integer elapsed seconds. Extra fields, coercions and other actions are rejected (422).
Explicit-date and exclusion request schemas are not implemented yet.

The endpoint **never issues a successful preview**. It inspects JSON without acquiring the
writing store lock, calling legacy `read`, reconciling receipts, upgrading files, allocating
identities, creating a backup/key, or persisting rows. Missing state, legacy v1 and old v2
return 409 `correction_initialization_required`, explicitly explaining that corrections are
not yet available in this build. An outstanding file intent or unfinalized DB receipt returns
409 `reconciliation_required` and directs recovery of the existing operation first. Corrupt
JSON/unknown formats fail closed. No automatic retry or initialization endpoint is advertised.
The existing timer controls, mutation schemas/hashes and legacy store consumers are unchanged;
correction UI remains unavailable. The gate does not establish target existence/ownership or
validate a proposed interval, and its refusal must not be interpreted as an approved correction.

Public regressions in `tests/test_timer_correction_preview.py` exercise the real daemon root
HTTP route with synthetic persisted state. They compare all table rows and file bytes/identities/
modification times and directory entries before/after preview. The first regression failed
before implementation with 422 from the legacy mutation adapter rather than the required 409.
Subsequent coverage includes v1, old v2 missing running identity, pending old intent, unfinalized
receipt, absent parent directory, strict input rejection and all three single-target shapes.

## Next milestone

Implement explicit serialized receipt-backed correction initialization, including reconciliation
of old pending shapes before additive identity/boundary installation and separate durable HMAC
key creation. Then implement signed canonical previews and commits, interval/evidence algebra,
lineage migration, writer guards, durability/recovery, controller/browser UI and complete #61
acceptance. Do not enable correction controls based on this gate. Full Python/Node, migration,
crash/concurrency and real-browser acceptance remain required at eventual complete delivery.
