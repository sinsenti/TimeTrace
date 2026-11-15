# 18: Rating-definition administration

**What to build:** Manage rating definitions and scale presentation without changing existing review policy or requiring the history-editor rewrite.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** completed

**Approved decisions:** O8, O5, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [x] Retain existing definition creation/editing, target/context, required flag, bounds and deletion behavior under the approved policy of preserving shipped behavior.
- [x] Preserve five ordered red-to-green grades consistently across applicable badges, heatmaps and sliders, including non-default ranges.
- [x] Keep existing consumers usable while other review pages wait; do not expand required/exemption policy or mutate historical scores silently.
- [x] Test definition administration, range/context boundaries, error recovery and existing review compatibility through API/service and browser checks.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- Continuation reconciliation: the reviewed freeze02 ten-path implementation is checkpointed at `5e3fbe4fc5315e936c215e2738b459ae9942bd33`; exact incoming AI settings integration `4e75ef02cf478165f6eaa48b0527c3f852b31dcd` was merged without conflicts. Both prior P2 source defects are repaired; independent Standards/Spec review02 reports zero confirmed source findings. Pre-ticket20 automated evidence reports 545 Python / 426 Node passes; these counts do not describe the newly combined tree. Native acceptance remains UNRUN and combined checks remain pending. No completion or acceptance is claimed. See [bounded ticket18 evidence](../ticket-18-evidence.md).

- 2026-11-15 bounded software-completion candidate: all five unchanged criteria map to
  [current evidence and limits](../ticket-18-evidence.md#bounded-software-completion-candidate-2026-11-15).
  Combined product checks passed572 Python/583 actual Node/132 syntax, with18 inherited Ruff
  findings and both baseline streams matched. Current freeze10 adds only the finite timestamp
  oracle repair (13 controls; other510 files unchanged); no full-suite rerun follows that probe edit.
  Independent feature/search/resolution source reviews found zero confirmed findings within their
  respective scopes. Native-v2 and consumer-v3 remain FAILED, v4 UNRUN and v5 FAILED; their
  returned Admin/Recovery/Session observations remain individually qualified. Separate v6 PASSES
  the bounded held-search/Task-prefix/Day workflow with26 real ACKs,10 Day grade samples, full
  logical storage reconciliation and verified owned shutdown. It did not rerun the whole prior
  matrix. Presentation390/1024/1440, zoom/motion, physical/accessibility/other engines, broader
  shared native workflows, explicit owner acceptance and whole25 remain open and unwaived.
  Candidate15completed/10open adds18 only; integratione0c6989 remains14/11 pending TWO fresh
  closure metadata axes, parent disposition and integration. No new tests/runtime/Git writes
  accompany this candidate; spec remains Approved, not Built.
