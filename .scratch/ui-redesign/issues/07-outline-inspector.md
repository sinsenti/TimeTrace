# 07: Outline and inline inspector

**What to build:** Navigate task hierarchy in the optional Outline view and inspect/edit a task inline without losing its draft or history.

**Blocked by:** [05: Task details and work accounting](05-task-details-accounting.md)

**Status:** completed

**Approved decisions:** O8, O2, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [x] Retain the dedicated details route and expose Outline + inspector as an optional normal view with per-browser cross-reload selection persistence, preserving valid existing choices.
- [x] Support hierarchy navigation, shared task operations, own history/accounting and accessible task selection.
- [x] Keep selected-task identity and drafts stable across metadata refresh; guard late responses from overwriting newer selection.
- [x] Cover selection changes, Save/Cancel, stale/deleted tasks, narrow layouts and completion prompts with regressions and a real inspector workflow.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-13: Candidate implemented from clean integration `1671f9fecc677c64fc806b3f2160a17179771101` using the approved B3/O2 plan. Outline/retained inspector, shared dedicated-details partials, draft/read/write ownership guards and regressions are present. Full checks: 539 Python / 412 canonical Node pass; 18 inherited Ruff errors remain. Native probe is authored only; independent review, guarded native/shared-consumer checks and human acceptance are still open. See [candidate evidence](../ticket-07-evidence.md) and external continuation `evidence/ticket-07/` receipts. No acceptance criterion is closed by this implementation note.

- 2026-11-13: Fresh spec review P1/P2 repaired: actual Kanban click/Enter now guards retained Outline
  drafts; pending DELETE blocks property Cancel/owner invalidation and disables its button until ACK.
  New actual-handler RED→GREEN regressions pass. Fresh full checks: 539 Python / 417 canonical Node;
  scoped lint/format/syntax pass, full Ruff matches all 18 inherited findings and warning in both
  streams. New native cases are authored only. Candidate is frozen for fresh two-axis review;
  guarded native/shared-consumer and human acceptance gates remain open. See candidate evidence's
  repair 02 section and external `evidence/ticket-07/repair02/` receipts.

- 2026-11-13: Exact freeze02 candidate checkpointed as `2a7933d9a603425f475394b98d580481cb30f932`
  after fresh standards/spec reviews both found zero confirmed findings. Exact integration
  `4e75ef02cf478165f6eaa48b0527c3f852b31dcd` merged without conflicts. Prior 539 Python /
  417 Node results and inherited warnings are historical pre-merge receipts, not combined-source
  checks. Combined checks and native probe execution remain UNRUN; native is authored only.
  Status stays in-progress with acceptance criteria open. See evidence reconciliation 03 and
  external `evidence/ticket-07/freeze03/` full inventory/preservation bridge.


- 2026-11-13: Bounded software-completion candidate at clean source checkpoint
  `212680779190867c4c5c1da4010cdaa9dd75c47b`, subject to fresh independent closure metadata
  Standards/Spec review and parent disposition. All five unchanged criteria map to
  [current bounded evidence](../ticket-07-evidence.md#bounded-software-completion-candidate-2026-11-13).
  Combined checks: 564 Python/214 warnings, 485 actual canonical Node cases, 127 syntax checks;
  scoped lint/format and diff checks pass; full Ruff's 18 inherited findings and stderr warning
  byte-match incoming564e25a. Source reviews02 and focused probe/harness reviews04 report zero
  findings within their respective scopes. Native01 and native02 remain FAILED; native02's
  69 returned functional assertions/13 actual ACKs are qualified observations, not a clean run.
  Held03 separately passes only seven focused A→B→A checks/three Task ACKs/zero UI writes, with
  verified callback completion before exact-handler removal, full storage/FTS and sole actual−15
  shutdown. It does not rerun69 or certify the repaired Save/Delete delivery latches. Physical
  touch/screen readers/other engines, exhaustive contrast/theme/zoom/motion, remaining shared
  workflows, OS idle/frozen Timer, human and whole25 acceptance stay separate and unwaived.
  Candidate-local14 completed/11 open is conditional on review/integration; authoritative integration
  `564e25a51807c6809d191fa0f31e27d0d7bf6b6c` remains13 completed/12 open until then.
