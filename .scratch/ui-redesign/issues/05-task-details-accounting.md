# 05: Task details and work accounting

**What to build:** Inspect and edit a task with its subtasks, own recorded session history and truthful work accounting without losing drafts.

**Blocked by:** [04: Kanban and task quick editing](04-kanban-quick-edit.md)

**Status:** completed

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [x] Retain dedicated detail entries, aliases, properties/tags/subtasks, session actions and draft-safe editing using the shared task workflow.
- [x] Use shared task work accounting at one measurement instant: logged closed rows ended by it; scheduled closed rows starting after it; exclude open/straddling rows, timers and virtual projections.
- [x] Remaining work subtracts logged time; unscheduled work subtracts logged and scheduled time. Preserve negative balances and progress over 100%.
- [x] Zero/missing estimates and recurring tasks are unbounded; non-positive estimates have null progress, but negative estimates retain finite balances and current unbounded classification. Recurring estimates are per occurrence.
- [x] Cover own versus descendant history, deleted/stale metadata and refresh-only retry without lost drafts or duplicate mutations in focused tests and a real details workflow.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- 2026-11-13: Current-base adoption and scoped implementation verification delivered under the
  owner's renewed implement-spec authorization. See [current evidence](../ticket-05-codex-adoption-evidence.md)
  for criterion mapping, independent Standards/Spec findings and repairs, Python517/Node21files,
  actual native135 assertions with blocked-overlay harnessFAIL plus focused15/exit0, retained
  UNKNOWN captures and normal owned shutdowns. `completed` records software delivery with explicit
  manual limits; it is not human acceptance or whole-redesign completion. Historical entries below
  remain chronological evidence, including earlier failures and superseded blockers.

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-04: Uncommitted ticket05 checkpoint on reviewed118; status and acceptance boxes remain
  unchanged. Dedicated/inline details, truthful shared accounting presentation, draft/ACK/pending
  handling and real shared Session/Task composition implemented. Parent approved narrow inert-tag
  DOM and signed-estimate-parser fixes; no backend/schema policy changed. Final384Python/232Node/
  76syntax and scoped lint/format/whitespace pass; full Ruff18 byte-matches both baseline streams.
  Stats89 first, final owned native65+23+15 and all7 Session/all6 Task regressions pass with explicit
  fake boundaries. All first failures/corrections remain in [ticket evidence](../ticket-05-evidence.md).
  **Not ready for acceptance:** own final inspection found a missing-tree child zero/null estimate
  continuation dereference; minimal persisted-receipt fix awaiting parent decision (contacts timed
  out), not implemented/RED-claimed. No staged files/commit or stale-base integration. Parent genuine
  browser gate, exact-latest serial release, independent reviews and human acceptance remain open.

- 2026-11-04 reload: Parent explicitly authorized the bounded child persisted-receipt repair.
  Real-utils RED first: zero/null later Save dereference fails, negative control passes. Only owned
  subtasks production changed;41 focused/384Python/244Node/78syntax pass; Ruff18 matches both baseline
  streams. New private18207 runtime Stats89 FIRST passes. **STOPPED NOT VERIFIED:** new receipt native
  workflow passes zero continuation, then unexpectedly fails the null ACK real-row assertion; no
  correction/rerun/diagnosis. Old3 owned/all7 Session/all6 Task native reruns not run this reload.
  Only own PID255708 shut down normally; actual3tasks/0sessions/FK[]/0013, timer inactive, port closed.
  [Reload evidence](../ticket-05-reload-evidence.md) preserves raw failure and ALL20-path uncommitted
  checkpoint. Original17-path parent archive/old reports remain intact. No staged files, FF, commit,
  final parent gate or ticket/spec completion; latest-base/reviewer/human gates remain outstanding.

- 2026-11-04 NULL follow-up: Parent authorized characterization/owned fixture correction only.
  Real neutral CREATE omitted/0/null/−60 raw ACK+GET is15/0/15/−60; real explicit PUT-null ACK+GET
  establishes null and later omitted UPDATE preserves it. Prior raw POST ACK was not captured and
  historical failed9-check/undiagnosed-at-STOP ledgers are unchanged. New native32 passes once with
  canonical15m CREATE assertion, SAME private-child real PUT-null receipt, missing tree/later strict
  null canonical-ID PUT, read-only Retries/no duplicate; no backend/app source changed. Fresh11
  focusedPy/41Node/full388Py109warnings/244Node/78syntax, Ruff18 both-baseline-stream match; Stats89
  FIRST then owned65+23+15/all7 Session/all6 Task including66/20 pass. Final audit guessed wrong timer
  URL404: STOP once, no workflow rerun/correction; only required read-only cleanup/checkpoint followed.
  New private18209 PID297474 normally stopped,75Tasks/20Sessions/0013/FK[], timer inactive, port closed.
  See appended [reload evidence](../ticket-05-reload-evidence.md) and external null-verification report.
  All20 dirty paths preserved; only two tests/this comment/portable append changed this follow-up.
  STOPPED UNCOMMITTED, not final acceptance; no FF/stage/commit/final parent gate or status completion.
