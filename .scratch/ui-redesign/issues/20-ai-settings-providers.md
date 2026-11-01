# 20: AI settings and providers

**What to build:** Configure AI privacy, scheduling, instructions and providers in Settings with safe credentials and independent draft ownership.

**Blocked by:** [19: Tabbed browser preferences](19-browser-preferences.md)

**Status:** ready-for-agent

**Approved decisions:** O8, resolved by the owner's acceptance of all recommendations and final specification on 2026-11-01. Apply the approved spec; technical blockers remain in force. No implementation start is requested by this approval record.

**Spec:** [Whole-UI redesign](../../../specs/ui-redesign.md). Read the [shared acceptance and safety requirements](../README.md#shared-acceptance-and-safety) before implementation.

## Acceptance criteria

- [ ] Retain default task/session scope with sensitive domains opt-in, structured scheduling constraints, custom instructions and existing provider capabilities.
- [ ] Keep settings/instruction and provider save/discard ownership independent from each other and from browser preferences.
- [ ] Support masked credential keep/replace/clear according to existing API semantics; never disclose keys in rendered output, diagnostics, logs or responses.
- [ ] Retain explicit activation, confirmed deletion, model catalogs, safe saved/inline probes and Pi-owned authentication; adding an activation confirmation is not required.
- [ ] Use fake providers only; verify failure/retry, credential clearing without mistaken replacement, unsaved navigation and existing Assistant/settings compatibility.
- [ ] Satisfy shared acceptance, include focused regression evidence and record unrun checks honestly; no personal data or real provider calls.

## Comments

- Owner approved the 25-ticket granularity/dependency proposal and local publication with “everything feels right, approved”. Implementation-spec/product decision gates remain recorded above. Move to ready-for-agent only after the spec and applicable decisions are explicitly approved; technical blockers still govern execution order.

- 2026-11-01: Owner answered “yes to all answer. and final approve as well” to the full decision questionnaire. All applicable decisions and the final spec/verification plan are approved; status is now ready-for-agent, subject to technical blockers. No implementation has begun.
