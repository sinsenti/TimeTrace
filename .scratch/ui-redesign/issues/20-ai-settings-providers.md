# 20: AI settings and providers

**What to build:** Configure AI privacy, scheduling, instructions and providers in Settings with safe credentials and independent draft ownership.

**Blocked by:** [19: Tabbed browser preferences](19-browser-preferences.md)

**Status:** in-progress

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

- 2026-11-13 continuation: claimed in the fresh `codex/ui-redesign-20-ai-settings` worktree at
  `563a7838a3fa52c6b7a31925ae860559ea79645f`, using the approved adoption plan and frozen two-file
  regression checkpoint. Current software evidence is in [ticket20 evidence](../ticket-20-evidence.md).
  The historical raw probe-error oracle conflicts with B7 privacy; four fake SDK error assertions
  and one unsupported-provider returned-error assertion now expect safe content. Malformed-call
  domain assertions, request/response shapes, forwarding and caps remain intact. Parent approved a
  narrow shared `api_client.js` exception to suppress raw diagnostics only on known AI settings/
  provider paths, preserving thrown errors and every unrelated endpoint's logging. Native workflows,
  independent Standards (including API design)/Spec reviews, parent integration and human/whole-app
  acceptance remain pending. This is not bounded completion or a manual waiver.

- 2026-11-13 review repair: fixed confirmed shared status-read visibility P2 with an always-visible
  Provider notice and GET-only Retry after acknowledged Save/Activate; late outcomes cannot repaint
  newer notice/badge state. Exact `/api/ai/status` diagnostic suppression was justified by a real
  failed-status privacy regression. Removed authored native Tailwind substitution in favor of exact
  asset fallback to mandatory parent guard. Freeze03 software checks: 548 Python/214 warnings,
  425 actual elevated canonical Node, focused 167 Python/116 Node; scoped Ruff/syntax/diff pass and
  whole-tree 18 Ruff findings match both baseline streams exactly. All RED receipts are preserved in
  [evidence](../ticket-20-evidence.md#confirmed-review-repair-and-authored-probe-fidelity-freeze03-2026-11-13).
  Parent re-review, native/daemon verification, integration and acceptance remain pending; no done claim.
