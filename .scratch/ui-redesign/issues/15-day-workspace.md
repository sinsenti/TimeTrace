# 15: Day workspace and independent history editors

**What to build:** Review a day alongside optional historical days with independent drafts, rating writes, evidence filters and Calendar handoff.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O5, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Use Day workspace with bottom history initially closed; expand one other-day editor, exclude duplicate main-day editing and preserve drafts when switching/hiding or promoting that day.
- [ ] Give each editor unique rating-control identities, scoped validation/submission and independent load/dirty ownership; same-definition scores/dismissal cannot cross-write another day.
- [ ] Ordinary Enter supports text; Ctrl+Enter saves only its form. Preserve shipped required/dismissal/range/context/exemption policies unchanged and honest partial/failed-save recovery.
- [ ] Omit the standalone summary strip; use one full-width Activity/Tasks breakdown with heading-aligned switch, 13px labels, explicit hours, larger clickable rows and no percentage column.
- [ ] Keep recorded-session matching/total counts, task counts based on creation day, full-day recorded-time bars, scheduled-row/fan-out caveats and independent evidence filters.
- [ ] Preserve Calendar date plus tag/task handoff and persistent chip. Test same-definition two-day edits, stale loads, partial saves, hiding/switching and real handoff without task completion or schedule mutation.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
