# 10: Compact Habit cards

**What to build:** View and edit Habit results through compact cards with independent day navigation and retained definition/history capabilities.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** completed

**Approved decisions:** O8, O3, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [x] Use Compact cards and a small independent day strip per habit; omit the shared date cube and per-card Entry date row. Week/Today navigation never logs data.
- [x] Stage entry edits until explicit Save/Cancel. Offer explicit Done/Failed/Skipped choices instead of cycling clicks; Clear confirms removal only of that selected day's record, distinct from zero. Clamp negative numeric values to zero with visible feedback; Cancel never writes.
- [x] Retain target/unit/color/frequency/reminder settings, definition editing, deletion, goal history, charts and inspector. Target changes do not rewrite historical logs.
- [x] Missing logs are not failures, numeric zero is Pending, and compliance remains completed/all recorded logs rather than all dates.
- [x] Keep one record per habit/local date and existing reminder/unit-conversion behavior. Defer clock time, editable notes and multiple daily entries; preserve existing stored metadata. A later amendment needs separate approval.
- [x] Add API/service and browser coverage for approved entry policies, cancellation, historical targets, empty states and independent card navigation.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-02 implementation checkpoint (not completion): isolated ticket-10 worktree implements independent Compact cards, explicit entry Save/Cancel and result choices, selected-date confirmed Clear, visible negative clamping, retained hidden date drafts and existing definition/history/inspector/chart paths. Parent approved the demonstrated O3 service gap repair: newly written numeric zero derives Pending even for nonpositive targets, without historical rewrites or target validation. Older absent dates remain explicitly unknown; acknowledged older entries have card-only receipts without changing chart history windows. Full evidence/first-failure chronology is at `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-10/worker-report.md`. Shared-confirmation Escape compatibility still requires reviewed ticket-02 integration and independent parent browser/review gates. No ticket completion, commit, merge or human acceptance is claimed.

- Preserved-checkpoint continuation (not completion): parent-authorized disjoint FF from exact dd13994 to reviewed `118bb9d14c99e06da96199e9ea574e9afdf4e91e` preserved all ten hashes; all nine source/test files remain unchanged. Fresh checks: 14 API, 11 caller, full 391 Python/105 warnings, 212 Node, 74 JS/CJS syntax; scoped lint/format passed and full Ruff retains exactly 18 baseline findings plus warning in both streams. Native Stats89 first, then Habits82 + edges14 + confirmation8 all pass without pageerrors. The unchanged confirmation regression now genuinely passes current reviewed utils; no copied/injected helper or waiver. Portable behavior/criterion mappings, old RED chronology, new inspection-only errors and limits: [ticket-10 evidence](../ticket-10-evidence.md). Status/criteria remain unclosed; staging/commit held for independent parent browser gate and explicit release, followed by per-commit review/fresh merger closure and later human acceptance.

- Independent parent gate/release: parent independently passed Stats89 first → Habits82 → edges14 → unchanged confirmation8 on the frozen isolated runtime, zero pageerrors, with all eleven hashes identical before/after and all nine source/test bytes checkpoint-identical. Parent explicitly authorized one eleven-path feature commit on exact reviewed118 after this genuine gate, allowing own evidence/history additions only. Fresh per-commit Standards/Spec review and merger closure still required; this comment does not close status/criteria or claim human/whole-delivery acceptance.

- Clear-focus review repair (not completion): parent accepted the single Spec P2 on exact `5b022bad0167faec58e1be85bce1b678f59b68ce`; Standards had no findings. A fresh unchanged-base native Clear→Escape assertion genuinely failed before production edits. Local `habits.js` now focuses/traps Clear confirmation, makes Cancel Enter cancel before the unchanged helper's capture-Enter Proceed, and restores a live enabled same-card control only after pending clears and only for the unchanged focus owner. New owners revoke optional focus, never ACK delivery or pending cleanup. Fresh checks: 14 API, 13 caller, full391 Python/105 existing warnings,214 Node,75 syntax; full Ruff remains18 baseline violations plus old warning, both streams identical to exact5b and reviewed118. Stats89 first → unchanged Habits82/edges14/Definition confirmation8 → new Clear-focus31 all pass with no pageerrors and real public row readbacks. First source failure and fixture gaps are retained separately in the appended [evidence](../ticket-10-evidence.md). Own five-path fix is frozen on exact5b, index empty; parent independent browser gate and explicit release are still required before staging/commit, followed by fresh amendment/combined two-axis reviews and merger closure. No status/criteria/spec completion or human acceptance is claimed.

- Clear-focus independent parent gate/release: parent independently passed Stats89 first → Habits82 → edges14 → unchanged Definition8 → new Clear31 on the frozen own18199/PID165924/private DB,0 pageerrors, with all five hashes identical before/after and complete new readback assertions inspected. Parent explicitly released one five-path fix with exact5b parent, no changes to the three gated source/test files; only this own-issue/evidence gate-history append is allowed. Fresh amendment5b…FIX and combined118…FIX Standards/Spec reviews and fresh merger closure remain mandatory before12; this is not ticket completion, code-review/human/whole25 approval or dev merge permission.


- 2026-11-04 local integration and bounded closure: clean integration118 fast-forwarded ONLY to exact
  reviewed `9848fe7e919558576b04b255876c659c72208f17` (feature5b plus Clear-focus repair). Initial
  Standards0/Spec ONE P2 is repaired, not waived; fresh amendment AND combined Standards0/Spec0
  reports were fully read and reviewed bytes verified. All seven original criteria above retain their
  wording; ordered source/test/evidence mappings and deferred manual limits are in
  [closure evidence](../ticket-10-evidence.md#local-integration-and-bounded-closure-2026-11-04).
  Fresh391 Python/105 warnings,214 Node,75 syntax,14 API/13 callers and scoped lint/range format pass;
  full Ruff retains18 baseline findings plus warning, BOTH streams byte-identical fixed baseline.
  Fresh native Stats89 FIRST→Habits82→edges14→UNCHANGED Definition8→NEW Clear31 pass,0 pageerrors,
  actual row/receipt/pending/focus assertions inspected. Original TDD, old Definition8 RED, initial P2,
  fixture/oracle/audit failures and all earlier Comments remain history, not relabeled first-pass green.
  Only01+02+04+10+11 complete,20 pending; spec Approved NOT Built. One five-doc closure exactparent9848
  leaves source/tests/specs identical; parent fresh closure Standards/Spec review is REQUIRED BEFORE12
  continuation release. Known contrast/manual/accessibility/transport limits remain unwaived; completed
  means delivered bounded implementation, NOT human/whole25 acceptance or push/PR/dev-merge permission.
