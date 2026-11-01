# 05: Task details and work accounting

**What to build:** Inspect and edit a task with its subtasks, own recorded session history and truthful work accounting without losing drafts.

**Blocked by:** [04: Kanban and task quick editing](04-kanban-quick-edit.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain dedicated detail entries, aliases, properties/tags/subtasks, session actions and draft-safe editing using the shared task workflow.
- [ ] Use shared task work accounting at one measurement instant: logged closed rows ended by it; scheduled closed rows starting after it; exclude open/straddling rows, timers and virtual projections.
- [ ] Remaining work subtracts logged time; unscheduled work subtracts logged and scheduled time. Preserve negative balances and progress over 100%.
- [ ] Zero/missing estimates and recurring tasks are unbounded; non-positive estimates have null progress, but negative estimates retain finite balances and current unbounded classification. Recurring estimates are per occurrence.
- [ ] Cover own versus descendant history, deleted/stale metadata and refresh-only retry without lost drafts or duplicate mutations in focused tests and a real details workflow.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
