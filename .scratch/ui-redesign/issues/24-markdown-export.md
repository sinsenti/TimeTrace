# 24: Markdown export workflow

**What to build:** Select and export the six supported agenda Markdown scopes with honest preview/download feedback and explicit date semantics.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** in-progress

**Approved decisions:** O8, O7, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain sessions, tasks_short, tasks_full, habits, all and all_date_range through existing export endpoints, not synthetic data.
- [ ] Label the six modes, in order: Sessions; Tasks—compact; Tasks—detailed; Habit definitions; Everything; Everything—with session date range. Provide generated Markdown preview and explicit Copy/Download actions. Keep Ctrl+Enter-download; omit the separate legacy session-export menu entry without removing its existing endpoint/CLI capability.
- [ ] Date-range mode filters inclusive UTC session-start dates only; tasks/habit definitions remain unfiltered. Disclose UTC Today/Tomorrow anchors versus local display.
- [ ] Preserve upcoming merged recurring projections and distinguish this export from backup, Calendar image or new formats/import UI.
- [ ] Verify all scopes, boundary dates, unfiltered definitions, projected recurrence, failures/stale previews and actual downloads with fake-data API/service and browser tests.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-13: Local implementation candidate checkpointed and exact incoming Day workspace integration reconciled without source conflicts. This ticket remains in progress. The two original review axes confirmed the same P2 layering/focus defect; its test-first repair is present, with fresh independent Standards/Spec review still pending. Pre-incoming15 checks are recorded in [ticket 24 evidence](../ticket-24-evidence.md); combined integration checks, guarded native execution, human acceptance and fixed-base whole-delivery review remain pending.
