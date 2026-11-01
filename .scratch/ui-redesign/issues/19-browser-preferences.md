# 19: Tabbed browser preferences

**What to build:** Use tabbed Settings to edit browser-owned preferences without silently saving another owner's draft.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O2, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Use the selected full-working-area tabbed page at /settings; /settings/ai opens the AI category. Keep old entry paths usable during rollout.
- [ ] Retain view/week-start/slot/sidebar/Vim/session-review/auto-scroll/color preferences. Persist theme, task view, density and totals per browser across reloads; preserve valid existing preferences and default only missing/invalid individual settings.
- [ ] Keep browser, AI and provider saves separate. Retain unsaved drafts across Settings tabs and warn before leaving with unsaved changes; theme/navigation changes never silently save or lose drafts.
- [ ] Preserve the idle toggle's daemon side effect and honest failure state; do not report an unpersisted or failed change as successful.
- [ ] Verify reload/Back/Forward, independent dirty categories, saved/legacy fixtures and idle failures with isolated browser storage and fake state.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
