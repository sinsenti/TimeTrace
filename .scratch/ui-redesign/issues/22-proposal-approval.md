# 22: Proposal approval and recovery

**What to build:** Review and apply Assistant proposals with editable overlays, explicit approval, conflict checks and recoverable refresh failures.

**Blocked by:** [02: Session editing and scheduling](02-session-editing.md); [05: Task details and work accounting](05-task-details-accounting.md); [15: Day workspace and independent history editors](15-day-workspace.md); [21: Clean shared Assistant](21-clean-assistant.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O6, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain proposal editing, real Calendar overlays, batch/selected accept/reject, action history/audit, undo/reapply and materialized occurrence identities.
- [ ] Tools only propose drafts; acceptance and undo/reapply use existing draft/domain services, stale/conflict checks, restoration semantics and append-only audit.
- [ ] Preserve completion-policy forwarding, partial-batch feedback and domain-level safeguards without recreating approval logic in the browser.
- [ ] After successful writes, refresh task/calendar metadata without losing unsaved fields, selected attachment/timer IDs or last-known labels.
- [ ] Offer refresh-only retry after refresh failure; failed draft-card reload cannot prevent successful task/calendar refresh or replay a successful mutation.
- [ ] Add fake-agent/API and real-browser tests for stale conflicts, partial approvals, undo/reapply, overlays and exactly-one-write behavior across refresh failures.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
