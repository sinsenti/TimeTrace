# 16: Session reviews

**What to build:** Use the optional session-review workflow to inspect and rate sessions without conflating review, exemption or task completion.

**Blocked by:** [15: Day workspace and independent history editors](15-day-workspace.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O5, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Preserve session-review visibility preference, session inspection, notes/tags/ratings and separate reviewed/exempt flags.
- [ ] Use scoped rating validation/submission with shipped required/dismissal/range/context/exemption behavior unchanged and five-grade mapping.
- [ ] Retain reset and confirmed deletion policies; review writes never complete tasks or clear schedules.
- [ ] Verify mixed reviewed/exempt states, editor initialization/late responses, save/dismiss/error paths and filter-aware session selection with focused API/service and browser regressions.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
