# 08: Status management

**What to build:** Manage custom task statuses from the redesigned task workflow while preserving existing order, flags and deletion rules.

**Blocked by:** [04: Kanban and task quick editing](04-kanban-quick-edit.md)

**Status:** in-progress

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain status creation/editing, order, colors and flags through existing APIs; do not replace the domain policy.
- [ ] Preserve confirmation/deletion restrictions and task status/status-id synchronization, including completion-policy prompts.
- [ ] Refresh affected views after success without losing task drafts or treating refresh failure as mutation failure.
- [ ] Test create/reorder/update/delete failures and resulting Kanban task behavior, including keyboard/focus and readable user colors.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
