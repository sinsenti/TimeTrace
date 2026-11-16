# 15: Day workspace and independent history editors

**What to build:** Review a day alongside optional historical days with independent drafts, rating writes, evidence filters and Calendar handoff.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** completed

**Approved decisions:** O8, O5, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [x] Use Day workspace with bottom history initially closed; expand one other-day editor, exclude duplicate main-day editing and preserve drafts when switching/hiding or promoting that day.
- [x] Give each editor unique rating-control identities, scoped validation/submission and independent load/dirty ownership; same-definition scores/dismissal cannot cross-write another day.
- [x] Ordinary Enter supports text; Ctrl+Enter saves only its form. Preserve shipped required/dismissal/range/context/exemption policies unchanged and honest partial/failed-save recovery.
- [x] Omit the standalone summary strip; use one full-width Activity/Tasks breakdown with heading-aligned switch, 13px labels, explicit hours, larger clickable rows and no percentage column.
- [x] Keep recorded-session matching/total counts, task counts based on creation day, full-day recorded-time bars, scheduled-row/fan-out caveats and independent evidence filters.
- [x] Preserve Calendar date plus tag/task handoff and persistent chip. Test same-definition two-day edits, stale loads, partial saves, hiding/switching and real handoff without task completion or schedule mutation.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-13 producer checkpoint: approved Day workspace implementation prepared on unchanged
  `83fb87fed68afcff6565da55efa18807b04cbd12`, with retained date-owned editors, scoped ratings,
  separate ACK/retry checkpoints and preserved evidence/Calendar contracts. Full Python535 and
  Node384 pass; 18 Ruff diagnostics exactly match the base and 114 JS/CJS files parse. Acceptance
  boxes remain unchecked pending independent review/native/parent disposition. See
  [producer evidence](../ticket-15-evidence.md) for original failures, checks and limits. No commit,
  integration, provider call or personal-data experiment occurred in this implementation checkpoint.


- 2026-11-13 bounded native candidate: the second actual run returned seven Day groups and three
  real definition-repair groups with browser exit0;32 layouts and192 RGB samples passed the bounded
  checks. The first failed run and its one UNKNOWN read-only Calendar-overlay body remain retained.
  Final product checks remain535 Python/214 warnings,392 Node and zero new Ruff diagnostics against
  the18-diagnostic baseline. Status remains **in-progress**; acceptance boxes are not blanket-checked.
  Local Git approval/integration, full Task/Session/rating-admin UI native compatibility, native
  interleaved Discard-race/lost-ACK coverage, manual/human and whole25 acceptance remain pending.
  [Current bounded evidence](../ticket-15-evidence.md#native2-bounded-candidate-and-metadata-bridge-after-freeze05)
  distinguishes returned groups from assertion totals, real API fixtures from admin UI certification,
  safe controller shutdown and all remaining limits. This metadata amendment runs no tests or runtime
  and performs no Git action.


- 2026-11-13 bounded software closure: all seven unchanged criteria are reconciled in the
  [current closure mapping](../ticket-15-evidence.md#bounded-software-closure-2026-11-13).
  Integrated candidate HEAD `563a7838a3fa52c6b7a31925ae860559ea79645f` plus fourteen frozen
  uncommitted Day paths passed 537 Python / 397 canonical Node, 118 syntax checks and zero new
  Ruff diagnostics against the inherited eighteen. Actual native-v2 (seven Day plus three repair
  groups), shared Session/Task/admin compatibility (three groups) and task/direct Calendar handoff
  (two groups) each exited 0 with owned daemon lifecycle proof. Independent source axes report
  no confirmed findings; closure metadata review and local commit/integration remain parent-owned.
  `completed` means bounded implementation delivery, with deferred shared manual, accessibility,
  human and whole-25 acceptance recorded separately. The original native exit 1 / CDP UNKNOWN,
  lost-response uncertainty and prior failed receipts remain preserved. Criteria text/dependencies
  are unchanged; checked boxes do not certify unrun checks or waive acceptance. No Git action or
  runtime was performed by this closure editor.
