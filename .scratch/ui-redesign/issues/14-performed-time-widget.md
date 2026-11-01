# 14: Performed-time widget and preset

**What to build:** Add or recreate the accepted performed-time chart without silently changing existing dashboards or original Logged metrics.

**Blocked by:** [11: Dashboard and widget canvas](11-dashboard-canvas.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O4, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Provide an editable/recreatable Performed time by day preset: sessions, total duration by day, line, last 14 days, past-only relative session time and previous-period comparison.
- [ ] Add the widget only to fresh default dashboards, plus its recreation preset. Never automatically insert it into existing dashboards or restore user-deleted widgets.
- [ ] Keep original Total Time Logged/Logged Sessions queries unchanged. Use Recorded session time / Recorded sessions labels and explain that past and future recorded rows are included, not only performed work; preserve custom widget names/configurations.
- [ ] Retain local start-day bucketing and fan-out/comparison semantics through existing query and seed services.
- [ ] Verify fresh/existing/deleted-widget fixtures, preset recreation, stored-query editability and performed-versus-scheduled boundary cases.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
