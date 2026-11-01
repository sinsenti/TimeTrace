# 12: Structured widget builder and comparisons

**What to build:** Build and edit fully expressive structured widgets with independent ranges, attribution and comparison baselines.

**Blocked by:** [11: Dashboard and widget canvas](11-dashboard-canvas.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Preserve the full published capabilities/query builder, not reduced sample pickers, including edit/reopen and useful validation.
- [ ] Retain per-widget date ranges and previous-period/prior-year/custom baselines without adding a global dashboard filter.
- [ ] Preserve default multi-tag fan-out with overlapping-total labels and the split-evenly alternative.
- [ ] Keep local session-start-day bucketing, explicit timezone/week-start context and existing fallback/warning semantics.
- [ ] Keep the existing optional SQL entry usable independently; verify structured round trips, comparison boundaries, errors and saved widget compatibility through compiler/API and browser tests.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
