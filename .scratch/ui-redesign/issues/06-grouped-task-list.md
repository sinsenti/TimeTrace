# 06: Grouped task list

**What to build:** Choose the optional Grouped list and perform the same task operations without a reduced or divergent task model.

**Blocked by:** [04: Kanban and task quick editing](04-kanban-quick-edit.md)

**Status:** completed

**Approved decisions:** O8, O2, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [x] Expose Grouped list through the normal selector, retaining explicit choice per browser across reloads without resetting valid existing preferences.
- [x] Keep grouping/search/filtering, hierarchy, CRUD, shared quick editing, schedule/timer actions and completion-policy prompts working.
- [x] Preserve status/title parsing, inherited tags and queued-subtask behavior through existing services, not view-specific domain writes.
- [x] Verify navigation/reload, empty/long lists, keyboard/touch access, cancellation and shared-editor errors with focused regressions.
- [x] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.

- 2026-11-13: Authorized continuation implementation is underway on
  `codex/ui-redesign-06-grouped-tasks`, starting at `653012a`. The optional view now has an actual
  status-group renderer using shared task/session contracts; no API/schema changes. Producer checks,
  retained first failures and pending independent/native gates are recorded in
  [ticket06 evidence](../ticket-06-evidence.md). Criteria remain unchecked until the bounded review gate.

- 2026-11-13: Current-base independent Standards/Spec reviews report0 actionable findings/code defects.
  Parent native3 returned101 workflow checks,32 viewport/theme layouts and192 bounded RGB samples
  (minimum10.704942004960031), while actual browser exit1 and the DELETE204 CDP body UNKNOWN remain
  preserved. Separate real-local HTTP status204/empty-body capture and public readbacks acknowledge
  the owned deletion and preserved parent Session. All three scratch controller cleanups passed.
  [Bounded validation record](../ticket-06-evidence.md#bounded-current-base-validation-record-after-native3)
  distinguishes earlier failed runs, controlled Timer/read/child faults, capture limits and pending
  user Git authorization/post-integration checks. This ticket is **not complete**; criteria stay unchecked.

### Authorized local implementation checkpoint — 2026-11-13

Owner approved local ticket updates/commits/integration; branch FF83fb preserved all feature bytes.
Fresh integrated534Python/376canonicalNode, scoped checks and exact18-Ruff baseline passed as
recorded in [evidence](../ticket-06-evidence.md#authorized-integrated-implementation-checkpoint-2026-11-13).
Two fresh integrated review axes found no new confirmed defects. Local implementation commit is
authorized; this issue remains in-progress, with acceptance criteria unchecked and native transport,
Timer/manual/human/whole25 boundaries unchanged. No dev merge, push or PR is authorized.


### Bounded software completion — 2026-11-13

The five checked criteria record delivered software with bounded evidence under the local completion
convention; they do not certify every manual check. The approved specification and criteria are unchanged.
[Current five-criterion mapping](../ticket-06-evidence.md#bounded-software-completion-2026-11-13)
supersedes the earlier in-progress checkpoint. Integrated Python534 passed/214warnings and canonical
Node376 passed across23files; full Ruff remains exit1/18 baseline findings. The separate actual Grouped
Timer entry run returned two scenario groups with browser exit0 and real start/navigation/Stop/readbacks.
Original native3 remains101 returned checks with actual exit1 and DELETE204 CDP body UNKNOWN;
separate original HTTP204/zero-byte capture and domain readback remain distinct evidence channels.

Software completion remains subject to independent closure metadata review and parent disposition.
Physical touch, screen reader, second engine, full keyboard/focus/contrast matrix, frozen/recovery/OS-idle
Timer coverage, shared arbitrary custom-status editing (08), human/whole25 acceptance and final
whole-delivery review against82fabdc remain separate. No gate is waived; no dev merge/push/PR is approved.
