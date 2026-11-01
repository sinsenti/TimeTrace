# 03: Timer and idle recovery

**What to build:** Track work with the secondary timer and recover running, frozen or idle state while navigating the redesigned app.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Keep the timer secondary and retain start, pause/freeze, resume, stop, attachment and retag behavior through existing contracts.
- [ ] Timers remain isolated file state rather than premature session rows; navigation and theme changes do not reset them.
- [ ] Retain/re-skin the existing idle dialog, recovery choices and confirmation policy rather than inventing new idle semantics.
- [ ] Show honest daemon/recovery failures and allow safe retries without duplicating logged sessions.
- [ ] Exercise running/frozen navigation and each recovery path against isolated timer state; verify keyboard/focus and shared-page integration.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
