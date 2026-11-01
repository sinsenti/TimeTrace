# 10: Compact Habit cards

**What to build:** View and edit Habit results through compact cards with independent day navigation and retained definition/history capabilities.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O3, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Use Compact cards and a small independent day strip per habit; omit the shared date cube and per-card Entry date row. Week/Today navigation never logs data.
- [ ] Stage entry edits until explicit Save/Cancel. Offer explicit Done/Failed/Skipped choices instead of cycling clicks; Clear confirms removal only of that selected day's record, distinct from zero. Clamp negative numeric values to zero with visible feedback; Cancel never writes.
- [ ] Retain target/unit/color/frequency/reminder settings, definition editing, deletion, goal history, charts and inspector. Target changes do not rewrite historical logs.
- [ ] Missing logs are not failures, numeric zero is Pending, and compliance remains completed/all recorded logs rather than all dates.
- [ ] Keep one record per habit/local date and existing reminder/unit-conversion behavior. Defer clock time, editable notes and multiple daily entries; preserve existing stored metadata. A later amendment needs separate approval.
- [ ] Add API/service and browser coverage for approved entry policies, cancellation, historical targets, empty states and independent card navigation.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
