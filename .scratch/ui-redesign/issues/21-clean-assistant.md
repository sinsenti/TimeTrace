# 21: Clean shared Assistant

**What to build:** Chat with the globally available Assistant in a clean drawer while retaining history, insights and real Calendar integration.

**Blocked by:** [01: Calendar shell and shared appearance](01-calendar-shell.md)

**Status:** ready-for-agent

**Approved decisions:** O8, O6, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain closed-first entry, conversations/history/deletion, read-only insights, streaming/cancel/errors, resize/fullscreen and actual Calendar integration.
- [ ] Use chat-first with proposal review/action history on demand and explicit approval cards retained. Keep Enter-send and Shift+Enter-newline; retain all existing capabilities.
- [ ] Remove final-UI mock/debug disclosures, sandbox counters and workflow selectors; keep current scope/instructions in Settings and relevant proposal/approval cards available.
- [ ] Render model/task text inertly; preserve JSON/SSE lifecycle and privacy/tool scope without inventing stronger isolation guarantees.
- [ ] Keep existing proposal/instruction approval paths and current Settings link usable until replacement tickets land; verify streaming failures, cancellation, keyboard behavior and real Calendar reparenting with fakes.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
