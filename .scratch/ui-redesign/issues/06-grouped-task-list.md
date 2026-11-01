# 06: Grouped task list

**What to build:** Choose the optional Grouped list and perform the same task operations without a reduced or divergent task model.

**Blocked by:** [04: Kanban and task quick editing](04-kanban-quick-edit.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O2, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Expose Grouped list through the normal selector, retaining explicit choice per browser across reloads without resetting valid existing preferences.
- [ ] Keep grouping/search/filtering, hierarchy, CRUD, shared quick editing, schedule/timer actions and completion-policy prompts working.
- [ ] Preserve status/title parsing, inherited tags and queued-subtask behavior through existing services, not view-specific domain writes.
- [ ] Verify navigation/reload, empty/long lists, keyboard/touch access, cancellation and shared-editor errors with focused regressions.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
