# 13: Optional read-only SQL widgets

**What to build:** Opt into the existing read-only SQL widget workflow within the adopted dashboard while retaining the query sandbox.

**Blocked by:** [11: Dashboard and widget canvas](11-dashboard-canvas.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain disabled-by-default opt-in and actual SQL authoring, validation, result rendering and saved-widget edit/reopen through existing contracts.
- [ ] Preserve sandbox restrictions, read-only execution, allowed schema/capabilities and existing resource limits; no unsafe bypass or expanded database access.
- [ ] Keep SQL failures local to their widget and show useful non-secret feedback with retry.
- [ ] Use the existing builder entry if structured-builder adoption has not landed; this ticket does not depend on that visual rewrite.
- [ ] Run focused sandbox/API regressions and fake-data browser workflows for allowed/rejected SQL, persistence and error isolation.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
