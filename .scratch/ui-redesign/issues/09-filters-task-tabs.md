# 09: Advanced filters and Calendar task tabs

**What to build:** Apply advanced task filters and configure Calendar task tabs without losing previously saved selections.

**Blocked by:** [04: Kanban and task quick editing](04-kanban-quick-edit.md)

**Status:** in-progress

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain existing query/status/category/estimate/priority filter capabilities and custom-filter configuration rather than prototype-only selectors.
- [ ] Preserve Calendar task-tab/sidebar configuration and client-owned saved preferences under the approved adoption rules.
- [ ] Keep Calendar tag/task query handoff and persistent chip coherent with filtering; support clear/reset and Back/Forward.
- [ ] Exercise saved/invalid/empty configuration, filtered empty states and navigation with focused tests and observable Calendar/Tasks workflows.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-13: Ticket09 implementation is in progress on the isolated supplied worktree. Saved advanced-filter and Calendar-tab recovery, safe status rendering, read ownership and keyboard controls have focused regressions. Full Python verification passed (567 tests); final Node checks and independent amendment reviews are being recorded separately. Native probes are authored only; combined 07/08/21 runtime proof and human acceptance remain unrun. No merge or acceptance completion is claimed.
