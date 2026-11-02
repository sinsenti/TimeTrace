# 01: Calendar shell and shared appearance

**What to build:** Plan a day in the selected Calendar shell while every existing page remains reachable and explicit user appearance choices survive adoption.

**Blocked by:** None (can start when implementation is requested).

**Status:** completed

**Approved decisions:** O8, O1, O2, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

Checked items record bounded implementation and the traceable automated/runtime evidence in
[the closure mapping](../ticket-01-evidence.md#local-integration-and-bounded-closure-2026-11-02),
not physical-touch, exhaustive-gesture, color-compliance or human acceptance. Historical unchecked/
unclosed comments below describe their own checkpoints and are retained unchanged.

- [x] Use the Aligned tool strip, planning task controls, persistent tag/task filter chip, fresh Spacious 88px/hour density and independently collapsible totals; honor the approved adoption policy instead of resetting existing preferences.
- [x] Offer all three light themes; brand-new browsers start Refined Archive/light. Manual light/dark switching uses existing dark appearance for every light option, preserves existing users' appearance/colors and adds no automatic OS switching. Persist theme, task view, density and totals per browser across reloads; default only missing/invalid individual settings.
- [x] Retain Day/3-day/Week, navigation, overlap/overnight display, drag/drop and keyboard/touch alternatives; session and timer workflows remain usable through existing components.
- [x] Preserve aliases, direct entry, Back/Forward, dirty editors and old/new page coexistence without duplicate shortcuts or missing shared components.
- [x] Verify fresh, existing, invalid and missing preferences plus real-daemon navigation and representative light/dark narrow-screen workflows.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-01 implementation delivery: Calendar/shared-appearance work is implemented on
  `feat/ui-redesign-01-calendar-shell`, based on verified integration ancestor
  `2f978dcf4a3aef21f0d4a5438ba026db1b2e0fe2`. Status deliberately remains **ready-for-agent**:
  independent per-commit Standards/Spec review, parent integration and closure are pending.
  See [scoped evidence](../ticket-01-evidence.md) for changes, TDD red/green receipts and limits.
  Final automated validation: 11 focused Python + 12 focused Node tests; full Python 352 passed /
  85 existing warnings; all Node 85 passed; 13 JS/CJS syntax checks and scoped Ruff/format/whitespace
  passed. Repository Ruff retains exactly the 18 supplied baseline diagnostics (comparison passed).
  Parent actually ran isolated Chromium probes: 12 density cases, 12 layout cases, 21 cross-page
  light cases / 1,122 sampled observations, three chart appearance cases, 80 fresh checks,
  116 adoption checks, 18 corrected workflow checks, and real Save/Cancel write/render evidence.
  These overlapping suites are separate, not an invented unique total. All confirmed browser findings
  were repaired/retested; raw failed receipts are retained. Physical touch/screen-reader/other-engine,
  unsampled zoom/reduced-motion/user-color states and exhaustive gestures remain deferred.
  The original multiline Notes helper was invalid against the existing single-line input; actual
  draft/focus preservation passed, while multiline Notes remains ticket 02. No provider/personal
  data, schema change, push or dev merge. Criteria remain unchecked pending independent acceptance;
  this comment records implementation evidence, not completion of this ticket or the graph.

- 2026-11-01 independent-review repair delivery: separate axes retained (Standards two P2;
  Spec three P1 + two P2), with Habit lifecycle one shared defect. Fresh repair from reviewed
  `4a723fc` fixes five accepted behavior defects plus the small shared supported-view constant;
  parent also confirmed and authorized a narrow delayed session-focus interaction repair from
  actual browser evidence. TDD includes controlled timers and populated-renderer RED evidence.
  Final Python 352 passed / 85 baseline warnings; all Node 93 passed; 21 changed JS/CJS syntax
  checks, scoped Ruff/format and whitespace passed; repository Ruff exactly matches 18 baseline
  diagnostics. Parent browser gate passed actual populated AI, Revision Preferences Save with
  grade/custom score/dismissal, independent dirty Settings saves/navigation, delayed metadata,
  real Habit chart disposal/recreation and the original reuse matrix. Four immediate runs retain
  Notes focus without sleep/readiness masking. Dark metadata/item-button contrast remains an
  unchanged 3.98986:1 baseline limitation; the exact cause of an earlier uninstrumented session
  assertion failure remains inconclusive and its raw receipt is retained. See the appended
  [evidence](../ticket-01-evidence.md) and parent receipt for exact boundaries, failures and limits.
  **Status remains ready-for-agent/unclosed**: fresh repair-commit and combined-ticket two-axis
  reviews, parent merger/integration/closure still apply. No push or dev merge.

- 2026-11-01 fresh owner-lifecycle repair: initial/failed reads no longer absorb or omit Day/AI
  drafts; Dismiss, partial rating saves and accepted-instruction synchronization checkpoint only
  actually persisted fields. Habit/widget, Add Status and shared drawer proposal/composer owners
  are covered by the new Settings departure guard without new layout/API/policy. Parent inspected
  and executed five new browser suites plus six reused regressions; final targeted retry/hydration
  re-gate passed. Full Python352/85 warnings and Node115 pass; Ruff exactly matches18 baseline
  diagnostics. Evidence preserves the explicit Dismiss test-first chronology deviation and the
  failed probe-selector receipt. **Status remains ready-for-agent/unclosed** pending fresh
  per-commit and combined01 two-axis review and parent integration/closure; no later ticket built.

- 2026-11-02 guard-edge repair from reviewed60099fb: authoritative instruction baselines,
  initial/failed/retried task-property gating, retained hidden Day text/grade and independent
  partial task/session-review checkpoints repaired; small shared capability loader only.
  Corrected probes distinguish observed startup idle configuration from departure writes and
  immediate contrast diagnostics from bounded finite-animation-settled samples. Fresh full
  Python352/85warnings, Node123,40combinedJS/CJS syntax, exact18baseline Ruff comparison pass.
  Actual native Chromium eight new cases +15 existing suites executed; parent independently
  reran eight and approved browser gate. Two review cases each intentionally surface one fake503
  pageerror; settled21cases/1119samples0issues, immediate/dark limitations remain disclosed.
  First helper/full-suite fixture failures remain recorded in [evidence](../ticket-01-evidence.md).
  **Still unclosed/ready-for-agent** pending fresh amendment+combined01 two-axis review and parent
  integration/closure; no later-ticket or whole-spec completion implied.

- 2026-11-02 owner-transition repair, recovered without discarding interrupted partial work:
  retained Session→+Task ownership spans Cancel/Save/metadata gaps, and late Day Save/Dismiss/rating
  continuations cannot mutate/clean a different date/editor. Parent additionally authorized minimal
  Task create/edit initial-focus repair after actual Tags focus theft. Fresh6focus RED→GREEN;
  final Python352/85warnings, Node146, ownership53,42syntax; exact18baseline Ruff. Parent independently
  ran hardened13-case browser suite and affected Settings/Revision callers, approved one-commit gate.
  Prior opaque Task-readback mismatch remains undiagnosed; PromiseGC is a traced bridge-observation
  limit, not exact Chromium diagnosis. Seeded shared-appearance4.33light failure and four dark3.98986
  samples remain disclosed; no visual/all-accessibility PASS or color fix. [Evidence](../ticket-01-evidence.md)
  distinguishes pre/post-focus runs, actual/supplemental TDD, synthetic503 pageerrors and manual limits.
  **Still ready-for-agent/unclosed** pending fresh amendment+combined01 two-axis review and fresh merger;
  no integration/dev merge or later ticket implemented.

- 2026-11-02 local integration/closure: fresh merger verified clean integration `2f978dc` and exact
  source `2f3024a701ac1ee0a9e79fdc77abdba868baf998`, ancestry and independent final amendment +
  combined01 Standards/Spec zero-finding axes, then **fast-forward only**, no merge commit. Status
  is now **completed** per the authorized implementation lifecycle, with criterion-by-criterion
  [recorded evidence](../ticket-01-evidence.md#local-integration-and-bounded-closure-2026-11-02).
  Fresh integrated352Python/85warnings,146Node,42syntax, scoped test lint/format and whitespace pass;
  full Ruff retains exact18baseline diagnostics+warning. Fresh0013health/FK,12native layout cases
  and26-assertion corrected scheduling/timer/navigation smoke pass; original custom-probe filter
  mismatch failure retained with parent-authorized single harness correction, not a product fix.
  All own fixtures cleaned; timer stopped/idlefalse, PID237941 absent/18157closed. Final parent
  13-case+two-caller browser gate remains prior same-source evidence, not merger execution.
  Seeded3light4.33FAIL, four dark3.98986 observations, opaque Task mismatch undiagnosed, exact GC
  internals unknown, lost historical raw evidence and supplemental TDD chronology limits remain.
  Physical touch/screen reader/other engines/exhaustive gestures/whole-a11y/human visual acceptance
  remain deferred; no blanket visual PASS. Spec **Approved, not Built**. Newly unblocked:
  02,03,04,10,11,15,18,19,21,24; first02/04/11 wait for parent fresh two-axis closure-commit review.
  No later ticket or whole-spec completion, push/PR/dev merge/release/human approval is claimed.
