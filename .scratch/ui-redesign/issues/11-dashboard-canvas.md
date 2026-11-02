# 11: Dashboard and widget canvas

**What to build:** Create and use named dashboards whose widgets can be edited and arranged without losing saved queries or blocking each other.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Adopt Widget canvas with responsive stacking, dashboard CRUD and editable/reorderable/removable widgets.
- [ ] Preserve named configurations, explicit reset/seed rules and existing local-browser custom-widget handoff without destructive reseeding.
- [ ] Give each widget independent loading/error/retry behavior and keep existing builder/SQL entry paths usable while their adoption tickets wait.
- [ ] Continue totals through the structured query services; do not introduce Python full-table aggregation or a global date filter.
- [ ] Test saved/fresh/legacy dashboards, deleted widgets, independent query failures and real edit/reorder/persistence workflows.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-02 implementation checkpoint: Widget canvas, independent card reads/retry/identity, acknowledged-write refresh recovery and non-destructive legacy handoff implemented on the isolated ticket-11 branch. Dedicated caller/API regressions and genuine synthetic browser readbacks are recorded in [ticket-11-evidence.md](../ticket-11-evidence.md). Full checks: 356 Python / 162 Node pass; 57 syntax checks pass; full Ruff retains 18 unchanged baseline findings. Latest browser: 83 bounded checks, zero uncaught errors; explicit fakes and first failures retained. Parent independently repeated all 83 browser checks and approved its gate/first commit reservation; own-branch latest-integration fast-forward check returned Already up to date at 7ed9bf3. Own daemon/socket/timer state cleaned up. Still ready/unclosed: independent two-axis review, parent integration and closure remain pending; not manual acceptance, whole-spec completion or merge permission.

- 2026-11-02 independent-review repair: both reviews of `badbd787` blocked on one unique obsolete-detail-Retry P1 missed by the prior83 checks. Fresh scoped repair guards selection before canvas invalidation, owns detail retries by generation, restores underlying Saving/Saved/read-only notices and extracts one tiny shared clearing helper. Five added caller regressions; genuine new caller/native RED→GREEN retained. Parent independently repeated the frozen **89-assertion / zero-pageerror** browser gate and approved one focused repair commit. Checks: **356 Python/101 existing warnings, 167 Node (21 focused), 57 syntax**; full Ruff remains byte-identical baseline18 findings. Latest integration remains `7ed9bf3`; own-branch ancestry/ff-only recheck passed, Already up to date. Raw evidence in `evidence/ticket-11-repair/` outside the repository, details/limits appended to [ticket-11-evidence.md](../ticket-11-evidence.md). Still ready/unclosed: fresh independent repair+combined review, parent integration and closure pending; not manual acceptance or merge permission.
