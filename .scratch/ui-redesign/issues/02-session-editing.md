# 02: Session editing and scheduling

**What to build:** Create and change real or projected sessions through the adopted Calendar without losing attachment, recurrence or completion behavior.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain task search/attach/create/detach, tags, notes, full timestamps, duration feedback, quick actions and Start Timer Now; create focuses task search and edit focuses Notes.
- [ ] Ctrl+Enter saves, Escape cancels without writes, and ordinary Enter in Notes inserts a newline; preserve dirty state and focus restoration.
- [ ] Move/resize/delete through existing occurrence-aware services; preserve virtual identities, moved/skipped exceptions and logged history. Unknown recurrence blocks unsafe actions with action-specific retry.
- [ ] Offer this occurrence/all future where applicable without changing task estimates; preserve completion keep/clear prompts and independent own-session/subtree choices.
- [ ] Distinguish failed mutations from failed refreshes; regression-test overnight/local boundaries, recurrence materialization, cancellation and retry without duplicate writes.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
