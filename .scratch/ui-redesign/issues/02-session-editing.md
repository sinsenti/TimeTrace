# 02: Session editing and scheduling

**What to build:** Create and change real or projected sessions through the adopted Calendar without losing attachment, recurrence or completion behavior.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** completed

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [x] Retain task search/attach/create/detach, tags, notes, full timestamps, duration feedback, quick actions and Start Timer Now; create focuses task search and edit focuses Notes.
- [x] Ctrl+Enter saves, Escape cancels without writes, and ordinary Enter in Notes inserts a newline; preserve dirty state and focus restoration.
- [x] Move/resize/delete through existing occurrence-aware services; preserve virtual identities, moved/skipped exceptions and logged history. Unknown recurrence blocks unsafe actions with action-specific retry.
- [x] Offer this occurrence/all future where applicable without changing task estimates; preserve completion keep/clear prompts and independent own-session/subtree choices.
- [x] Distinguish failed mutations from failed refreshes; regression-test overnight/local boundaries, recurrence materialization, cancellation and retry without duplicate writes.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-02: Authorized 02 implementation from reviewed integration `7ed9bf330677fb317793aa4371c4f36f407a2595` is present in the owned worktree, uncommitted pending parent browser/integration gate. [Owned evidence](../ticket-02-evidence.md) records caller-visible RED/GREEN, 360 Python /154 Node passes, six native browser probes and retained failures/limits. Ruff retains18 baseline violations;2 new-slice Task serialization warnings are disclosed. Recurrence/services/completion and reviewed Session↔Task retained ownership remain unchanged; parent approved the narrow actual Calendar launcher caller repair. Status stays ready/unclosed; this comment is not review, closure or merge permission.

- 2026-11-02 (parent-confirmed shared repair): Parent assigned02 a narrow global Escape fix after an actual04 browser repro of focus loss on declined partial-child discard. Actual dialog visibility now gates blur/unselect, including AI openClass, with no new close-return contract or TaskModal edit.13 owned Node cases /159 total Node passes and360 Python passes; affected native02 dialog/workflow/recurrence/preservation probes rerun. See owned evidence for provenance/limits. Reservation is11→02→04; commit/review/closure still held.

- 2026-11-02 (checkpoint pending commit reservation): Parent verified all18 candidate hashes and independently passed all six native probes after the Escape repair (`evidence/ticket-02/parent-browser-gate.md`). Commit reservation remains held behind11's review repair/integration; parent requested preserved uncommitted checkpoint/fresh continuation, no further wait. Owned18161 daemon stopped normally and PID/socket/timer audited. Source/tests frozen, exact patch/archive/manifest preserved. Ticket remains ready/unclosed; no commit/merge/feature-complete claim.

- 2026-11-02 (fresh continuation): Independently verified18 checkpoint hashes/disjoint paths and dirty-FF-only to revieweddd13994; all original bytes preserved. NEW private18161 runtime0013/FK/health,364Python/103warnings,180Node,64source+test syntax and6native probes PASS; Ruff18baseline exact both streams. Parent-authorized one-line preservation probe Promise-bridge helper correction follows retained first failure and ONE instrumented settling/readback diagnosis, no production/assertion change. See owned evidence and external `evidence/ticket-02/finalize/`; renewed parent browser gate/explicit commit release still held. Status remains ready/unclosed; no closure/spec-completion claim.

- 2026-11-02 (renewed parent gate PASS): Parent independently reran current dialog+workflows against the new exact18161 DB, verified all16 frozen source/test hashes before/after, asserted four widths/six workflow cases with0pageerrors and authoritative readbacks. Explicitly released ONE owned18-file feature commit with exact parentdd13994; no further source/test edits. Fresh independent Standards/Spec review and parent merger/closure remain pending; ticket stays ready/unclosed, manual/contrast/transport limits unwaived.

- 2026-11-02 (fresh bounded Spec P2 repair; gate pending): On exact110cc0d, native keyboard planning Schedule→Save reproduced focus loss **after actual sidebar replacement**, with one real POST/readback. Minimal Session-only fallback now focuses stable Calendar before refresh for disposable planning-list launchers; connected Cancel, failed/concurrent-dirty Save and existing Calendar-event paths retained. New owned native/caller regressions RED→GREEN;364Python/103warnings,181Node,65explicit syntax,6existing+1new native probes pass; full Ruff18 exact baseline. See appended owned evidence and external `evidence/ticket-02-focus-repair/`. Frozen source/tests and healthy private18177 runtime await parent genuine-browser gate/explicit one-fix-commit release; status ready/unclosed, no completion or merge permission.

- 2026-11-02 (fresh repair parent browser gate PASS): Parent independently reran planning_focus4cases + existing workflows6cases on exact isolated18177 DB,0pageerrors; verified3source/test hashes before/after, real Schedule Save payload/row and focus after actual sidebar replacement, exact connected Cancel/no write, failed/concurrent-dirty focus plus existing FC/nested workflows. Explicitly released ONE five-owned-path fix commit with exact parent110cc0d, source/tests unchanged since freeze. Fresh amendment AND combined02 independent Standards/Spec reviews and parent integration/closure still mandatory; ready/unclosed, no spec/human/whole-delivery completion claim.

- 2026-11-02 (local integration and bounded closure): Clean integration `dd1399487172ab08516ace6ce6e88979ae1f63b1` fast-forwarded only to reviewed `abd7a6da11a9f9589371a8f876ebf38b45fb4d96` (feature110 + focus repairABD). Fresh amendment and combined02 Standards/Spec reviews each report zero findings; original Schedule-focus P2 repaired, not waived. Fresh integrated364Python/103warnings,181Node,65explicit syntax, scoped Python Ruff/format and whitespace pass; full Ruff18 unchanged baseline, both streams exact. Native Stats89 ran first, then all7 Session probes passed, including actual Schedule Save focus AFTER sidebar replacement, Cancel/no write, rejected/concurrent focus, old Calendar/nested Task, UTC/metadata/recurrence/completion and Timer Now. [Closure evidence and criterion mapping](../ticket-02-evidence.md#local-integration-and-bounded-closure-2026-11-02) records isolation, first-failure history and normal owned cleanup. Acceptance boxes mean bounded implementation delivery/evidence under the owner lifecycle, not unrun manual acceptance. Physical gestures/touch, screen-reader/other engines, zoom/reduced-motion/exhaustive accessibility and lost-response transport uncertainty remain deferred; known contrast failures unwaived. Only01+02+11 completed,22 pending; spec Approved, not Built. This ONE five-document closure requires fresh parent Standards/Spec review before04 continuation; no human/dev-merge permission.
