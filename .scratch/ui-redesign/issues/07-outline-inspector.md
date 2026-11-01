# 07: Outline and inline inspector

**What to build:** Navigate task hierarchy in the optional Outline view and inspect/edit a task inline without losing its draft or history.

**Blocked by:** [05: Task details and work accounting](05-task-details-accounting.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O2, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain the dedicated details route and expose Outline + inspector as an optional normal view with per-browser cross-reload selection persistence, preserving valid existing choices.
- [ ] Support hierarchy navigation, shared task operations, own history/accounting and accessible task selection.
- [ ] Keep selected-task identity and drafts stable across metadata refresh; guard late responses from overwriting newer selection.
- [ ] Cover selection changes, Save/Cancel, stale/deleted tasks, narrow layouts and completion prompts with regressions and a real inspector workflow.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
