# 04: Kanban and task quick editing

**What to build:** Manage tasks in default Kanban with ordinary task editing, queued subtasks and the separate human-reviewed AI Quick Add workflow.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Default fresh/invalid view choices to Kanban, retain the view selector, hierarchy, search/filtering, CRUD, scheduling/timer actions and completion prompts.
- [ ] Queue/remove children below the title with Enter/Add; include an unsubmitted child on Save; Cancel/Escape discards parent edits and queued children. Children inherit saved effective parent tags.
- [ ] Handle separate parent/child writes with explicit partial-success state and retry of only unsaved children; prove retries cannot duplicate successful children.
- [ ] Preserve classify → explicit Parse → editable prefill → human Save on Tasks and Calendar. Classification invokes no inference; Parse creates no task/session or conversational proposal draft.
- [ ] Retain tier routing/fallback, sanitized fake-provider extraction, parse errors/keyboard behavior, title syntax parsing and status synchronization; keep existing provider/Settings entry usable.
- [ ] Add focused task/API tests and browser checks for queued-child cancellation/partial failure, Quick Add read-only prefill and completion-policy forwarding.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

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
