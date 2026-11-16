# 23: Remembered-instruction approval

**What to build:** Review a remembered-instruction suggestion and explicitly save or dismiss it without treating it as a domain proposal.

**Blocked by:** [21: Clean shared Assistant](21-clean-assistant.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O6, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Keep a separate explicit Save/Dismiss card with the existing hash/stale checks and editable review behavior.
- [ ] Only Save may update remembered instructions; dismissal never changes Settings, and ordinary chat/proposal approval does not implicitly save instructions.
- [ ] Preserve independent loading/dirty ownership and safe synchronization with whichever Settings entry is currently shipped; no dependency on its visual adoption.
- [ ] Render suggestion text inertly and show conflict/failure/retry without claiming success or replaying a successful write.
- [ ] Use fake providers/agents to test save/dismiss, changed baseline hashes, failed refresh and isolation from task/session draft approval.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
