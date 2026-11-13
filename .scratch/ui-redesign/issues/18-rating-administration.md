# 18: Rating-definition administration

**What to build:** Manage rating definitions and scale presentation without changing existing review policy or requiring the history-editor rewrite.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** in-progress

**Approved decisions:** O8, O5, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain existing definition creation/editing, target/context, required flag, bounds and deletion behavior under the approved policy of preserving shipped behavior.
- [ ] Preserve five ordered red-to-green grades consistently across applicable badges, heatmaps and sliders, including non-default ranges.
- [ ] Keep existing consumers usable while other review pages wait; do not expand required/exemption policy or mutate historical scores silently.
- [ ] Test definition administration, range/context boundaries, error recovery and existing review compatibility through API/service and browser checks.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- Continuation reconciliation: the reviewed freeze02 ten-path implementation is checkpointed at `5e3fbe4fc5315e936c215e2738b459ae9942bd33`; exact incoming AI settings integration `4e75ef02cf478165f6eaa48b0527c3f852b31dcd` was merged without conflicts. Both prior P2 source defects are repaired; independent Standards/Spec review02 reports zero confirmed source findings. Pre-ticket20 automated evidence reports 545 Python / 426 Node passes; these counts do not describe the newly combined tree. Native acceptance remains UNRUN and combined checks remain pending. No completion or acceptance is claimed. See [bounded ticket18 evidence](../ticket-18-evidence.md).
