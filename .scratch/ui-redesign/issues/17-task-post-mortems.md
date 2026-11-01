# 17: Task post-mortems

**What to build:** Record a task post-mortem from task details with its own ratings and evidence, independently of the day-review redesign.

**Blocked by:** [05: Task details and work accounting](05-task-details-accounting.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O5, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain task review text, rating targets and existing required/dismissal/range/context/exemption policies unchanged under approved O5.
- [ ] Use editor-scoped rating identity/load/save ownership; retain own-history/accounting context and dirty drafts across refresh.
- [ ] Never complete a task or clear scheduled sessions as a side effect of reviewing it; preserve reset/confirmed destructive operations.
- [ ] Test task-target isolation, cancellation, failed/partial saves and successful post-mortem round trips through real details and existing domain services.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
