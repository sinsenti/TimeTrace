# 04: Kanban and task quick editing

**What to build:** Manage tasks in default Kanban with ordinary task editing, queued subtasks and the separate human-reviewed AI Quick Add workflow.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** completed

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [x] Default fresh/invalid view choices to Kanban, retain the view selector, hierarchy, search/filtering, CRUD, scheduling/timer actions and completion prompts.
- [x] Queue/remove children below the title with Enter/Add; include an unsubmitted child on Save; Cancel/Escape discards parent edits and queued children. Children inherit saved effective parent tags.
- [x] Handle separate parent/child writes with explicit partial-success state and retry of only unsaved children; prove retries cannot duplicate successful children.
- [x] Preserve classify → explicit Parse → editable prefill → human Save on Tasks and Calendar. Classification invokes no inference; Parse creates no task/session or conversational proposal draft.
- [x] Retain tier routing/fallback, sanitized fake-provider extraction, parse errors/keyboard behavior, title syntax parsing and status synchronization; keep existing provider/Settings entry usable.
- [x] Add focused task/API tests and browser checks for queued-child cancellation/partial failure, Quick Add read-only prefill and completion-policy forwarding.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-02: Local implementation prepared on `feat/ui-redesign-04-kanban-quick-edit` from
  `7ed9bf3`: adopted Kanban controls, queued child receipt/partial-retry workflow and independently
  human-saved Quick Add on Tasks/Calendar. [Owned evidence](../ticket-04-evidence.md) records caller/API
  tests, actual synthetic browser readbacks, retained first failures and known contrast/manual limits.
  Status remains ready-for-agent/unclosed pending parent browser/commit/integration/review gates;
  this comment is not closure, human acceptance or dev-merge permission.

- 2026-11-02: Fresh continuation independently verified/preserved the complete dirty checkpoint and
  fast-forwarded disjointly to reviewed `dfda0aaa67e4014f7123fe5fd659d179c9576dd6`. Fresh377 Python,
  195 Node,68 syntax and both native probes pass; new assertions verify actual combined02 declined
  partial-discard Escape retains child focus/value with no writes, then resumes retained Session DOM.
  [Evidence](../ticket-04-evidence.md#fresh-native-continuation-on-reviewed-dfda-final-parent-gate-pending)
  preserves fixture/command failures and baseline Ruff/manual/contrast/transport limits. Parent final
  browser/commit release remains pending; no ticket closure, human acceptance or integration claim.

- 2026-11-02: Parent independently passed all four current native probes/zero errors, verified frozen
  twelve hashes and exact DFDA runtime/base, then explicitly released one owned-scope feature commit.
  Source/tests unchanged; final evidence appendix records precise scope/fakes and retained limits.
  This is browser/commit authorization only: fresh independent two-axis review, fresh merger and
  serialized closure remain required; status/criteria are not changed to completed here.

- 2026-11-02: Bounded post-review repair on exact `e5afa8d`: Task-modal preset buttons and
  `selectSwatch` now respect pending/acknowledged-parent locks; metadata completion yields to
  intervening focus/dialog owners and disconnected launchers, including superseding nested Sessions.
  Dedicated caller/native RED receipts reproduced both accepted Spec P2 findings before production
  edits. All original assertions remain; new public-caller and native coverage includes partial retry,
  ordinary color editing/unlock, Session Notes, planning input, unsent Assistant text and nested resume.
  Fresh377 Python/105 warnings,198 Node,69 syntax checks pass; full Ruff remains baseline18.
  External `evidence/ticket-04-review-fixes/` preserves raw failures, readbacks and frozen candidate.
  Parent genuine-browser/commit gate and fresh amendment/combined two-axis review remain mandatory;
  status/criteria remain unclosed and no integration/human/whole-spec acceptance is claimed.

- 2026-11-02: Parent independently passed all five frozen repair/affected native probes (20 new P2
  checks true, zero pageerrors), verified all four candidate hashes before/after and the inactive
  private timer, then explicitly released ONE four-path fix commit directly on E5. Three source/test
  files remain byte-identical to the gate; only this permitted history Comment was appended afterward.
  Fresh E5…FIX amendment AND DFDA…FIX combined Standards/Spec reviews, fresh merger and serialized
  closure remain parent-owned mandatory gates; this authorization does not close the ticket/spec.

- Fresh nested-owner review repair on exact `e2c1094`: completed nested Task P now reaches its
  matching retained Session at acknowledgement, before fallible metadata. Later focus restoration
  remains optional and cannot strand that handoff or let standalone Q inherit its suspension.
  Native E2 RED reproduced lost P and standalone Cancel/Save mixups across planning/Assistant and
  successful/failed reads; new GREEN adds pre-read delivery and superseding Session ownership.
  Existing color locks, all20 focus/color checks, full04 main/edges, two declined-Escape cases and
  authoritative empty-category receipts remain green. Parent approved only the two shared nested
  test timing expectations changing from hidden to resumed at ACK, retaining all existing draft/write
  assertions; its overlap with stopped12's unrelated fixture hunk requires parent-coordinated replay,
  not a blind dirty fast-forward. The old nested-new-Session probe now explicitly calls its public
  initializer because ACK correctly returns the Session overlay; no forced background pointer click.
  External `evidence/ticket-04-nested-ownership/worker-report.md` records scope, raw first failures,
  isolation, checks and frozen bytes. Genuine parent native/commit gate and fresh E2…FIX amendment
  AND DFDA…FIX combined Standards/Spec reviews, fresh merger and serialized closure remain mandatory.
  Status/criteria remain unclosed; no human/whole-spec/integration approval is claimed.

- Parent independently passed all six frozen nested-repair/affected native probes: all66 new and
  original20 checks true, zero pageerrors, preserved public/native boundaries and actual row readbacks.
  All six candidate hashes and all207 source/test manifest hashes matched before/after the gate;
  private timer remained inactive/unfrozen/idlefalse. Parent explicitly released ONE six-path fix
  directly on exact E2, permitting only this issue history appendix afterward; five source/test files
  remain byte-identical to the gate. Fresh E2…FIX AND DFDA…FIX Standards/Spec, fresh merger/closure and
  later stopped12 shared-test reconciliation remain mandatory parent gates, not approval or closure here.

- 2026-11-04: Locally integrated exact reviewed `f15003b821ee60383a7baf4344de3d74b732c1a9`
  by clean FF-only from DFDA. Original E5 Spec **two P2** (unsavable color/late focus) repaired in E2;
  E2's **one unique new P2** (stranded nested handoff, reported in both ranges) repaired in F150,
  not waived or double-counted. Fresh amendment E2→F150 AND combined DFDA→F150 Standards/Spec
  reviews each report zero findings. [Criterion-linked closure evidence](../ticket-04-evidence.md#local-integration-and-bounded-closure-2026-11-04)
  maps criteria 1–7 in order to source/tests and fresh actual receipts: 377 Python/105 warnings,
  201 Node,70 syntax; Stats89 first,all7 Session and all6 Task native probes (66+20 checks true),
  real readbacks/zero unexpected reported errors. Full Ruff remains18 unchanged baseline findings.
  Two additional read-only audit mistakes (guessed preset color, then const/let regex) are preserved;
  parent authorized bounded inspection-only corrections, no app/probe changes or native reruns.
  `completed` records delivered implementation and bounded evidence, **not** manual/human acceptance:
  known4.33/3.98986 contrast, physical/accessibility/engine coverage and lost-response uncertainty
  remain unwaived. Grouped/Outline layouts remain06/07; Quick Add is not Assistant21–23. One five-doc
  closure on exact parentF150 still needs fresh parent Standards/Spec review before next checkpoint
  release. Stopped12's unrelated shared-test fixture overlap needs later parent-coordinated fresh-base
  own-patch replay/reconciliation, not blind dirty FF; no12 source is consumed or changed here.
