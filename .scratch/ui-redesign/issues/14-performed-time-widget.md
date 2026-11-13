# 14: Performed-time widget and preset

**What to build:** Add or recreate the accepted performed-time chart without silently changing existing dashboards or original Logged metrics.

**Blocked by:** [11: Dashboard and widget canvas](11-dashboard-canvas.md)

**Status:** completed

**Approved decisions:** O8, O4, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [x] Provide an editable/recreatable Performed time by day preset: sessions, total duration by day, line, last 14 days, past-only relative session time and previous-period comparison.
- [x] Add the widget only to fresh default dashboards, plus its recreation preset. Never automatically insert it into existing dashboards or restore user-deleted widgets.
- [x] Keep original Total Time Logged/Logged Sessions queries unchanged. Use Recorded session time / Recorded sessions labels and explain that past and future recorded rows are included, not only performed work; preserve custom widget names/configurations.
- [x] Retain local start-day bucketing and fan-out/comparison semantics through existing query and seed services.
- [x] Verify fresh/existing/deleted-widget fixtures, preset recreation, stored-query editability and performed-versus-scheduled boundary cases.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- 2026-11-13 current delivery: independent source reviews clear; final532 Python/22 Node files,
  actual native37/exit0 and separate presentation65/exit0 pass with disclosed response/manual limits.
  See [criterion reconciliation and current evidence](../ticket-14-codex-delivery-evidence.md).
  `completed` means bounded software delivery, not human acceptance or whole-redesign completion.
  Earlier failed native37/exit1 and all intermediate failures remain historical evidence below.

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-13: The owner-authorized continuation prepared this slice on
  `codex/ui-redesign-14-performed-time` from `e4ad345`. Fresh seed/preset/accurate-label changes and
  public regressions are implemented; initial510 Python tests/18 Node files pass, and after the
  required fast-forward to reviewed ticket05 integration `653012a`,521 Python tests/22 Node files pass. Existing dashboards
  remain untouched; no query compiler/API/schema change. Independent review/native/shared/manual
  acceptance remain pending, and the pre-existing exact-whole-second filter boundary is unwaived.
  See [implementation evidence](../ticket-14-evidence.md). Criteria remain unchecked until their
  pending verification is reconciled; this is not ticket closure or human acceptance.

- 2026-11-13 independent-review amendment: corrected the Spec review's P2 scope-description finding.
  The past/future recorded-row explanation now requires the original session measure, all-time
  range and no filters/grouping; customized seeded queries/names remain unchanged. A caller-visible
  past-only RED and seven-scenario GREEN regression are retained. Full521 Python/22 Node-file
  checks pass again; independent re-review/native/shared/human gates remain pending.

- 2026-11-13 authorized boundary/native-fixture amendment: the original native attempt returned all37
  product checks but browser exit1 due to opaque-origin fixture localStorage access. The initializer
  is now guarded to HTTP loopback; failed evidence remains. A separately authorized narrow relative-time
  compiler bind-format correction restores whole-second past/ongoing/future equality without changing
  predicates/policy. Genuine4-case RED and real-service precision/boundary controls now pass; final532
  Python tests and22 Node files pass. This supersedes the earlier unwaived exact-second limitation;
  independent amendment review and a fresh overall native pass remain pending.
