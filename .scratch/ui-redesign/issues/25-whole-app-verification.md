# 25: Whole-app adoption verification

**What to build:** Verify the adopted workflows coexist across the whole app and existing users retain data, preferences and safe approval boundaries.

**Blocked by:** [02: Session editing and scheduling](02-session-editing.md); [03: Timer and idle recovery](03-timer-idle-recovery.md); [04: Kanban and task quick editing](04-kanban-quick-edit.md); [05: Task details and work accounting](05-task-details-accounting.md); [06: Grouped task list](06-grouped-task-list.md); [07: Outline and inline inspector](07-outline-inspector.md); [08: Status management](08-status-management.md); [09: Advanced filters and Calendar task tabs](09-filters-task-tabs.md); [10: Compact Habit cards](10-compact-habits.md); [11: Dashboard and widget canvas](11-dashboard-canvas.md); [12: Structured widget builder and comparisons](12-structured-widget-builder.md); [13: Optional read-only SQL widgets](13-read-only-sql-widgets.md); [14: Performed-time widget and preset](14-performed-time-widget.md); [15: Day workspace and independent history editors](15-day-workspace.md); [16: Session reviews](16-session-reviews.md); [17: Task post-mortems](17-task-post-mortems.md); [18: Rating-definition administration](18-rating-administration.md); [19: Tabbed browser preferences](19-browser-preferences.md); [20: AI settings and providers](20-ai-settings-providers.md); [21: Clean shared Assistant](21-clean-assistant.md); [22: Proposal approval and recovery](22-proposal-approval.md); [23: Remembered-instruction approval](23-instruction-approval.md); [24: Markdown export workflow](24-markdown-export.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O1, O2, O3, O4, O5, O6, O7, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] All preceding adoption tickets carry their own passing regression evidence; this ticket is cross-page acceptance, not deferred basic integration.
- [ ] Exercise all seven pages, aliases/direct loads, shared dialogs/Assistant/Settings, Back/Forward and old/new entry compatibility without duplicated handlers or stylesheet leakage.
- [ ] Check fresh/existing/invalid preference and dashboard fixtures, deleted presets, independent drafts and failed-refresh recovery without duplicate mutations.
- [ ] Verify real scheduling/recurrence/timer, task accounting, Habit history, reviews/ratings, widget queries, Assistant approvals and actual Markdown exports with isolated data and fake providers.
- [ ] Cover 390/768/1024/1440 widths, available approved light treatments and retained dark appearance, keyboard/focus/touch alternatives, long text, zoom/reduced motion and measured contrast.
- [ ] Record focused/full Python, Node, changed-JS syntax, Ruff and whitespace results separately from baseline failures; disclose deferred physical-touch/screen-reader/engine checks and obtain human review rather than claiming certification.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
