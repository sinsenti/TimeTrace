# AI remembered-instructions release hardening plan

Status: implemented in this working tree after `3677c1b feat(ai): add conversational remembered instructions`;
interactive drawer smoke remains a manual follow-up because this repository has no browser test harness.

## Goal

Verify the complete conversational remembered-instructions path before starting the next product
feature. This is a hardening pass, not a redesign and not a semantic-memory project.

The release contract is:

- Explicit future-directed requests may create one pending `AIInstructionProposal`.
- Proposal creation never changes `AISettings.custom_instructions`.
- The user must explicitly save or dismiss the proposal.
- Acceptance appends safely, deduplicates equivalent text, and refuses stale settings changes.
- Normal chat, one-off facts, task descriptions, and imported text create no proposal.
- Task/session AI drafts retain their existing draft-only and accept/undo behavior.

## Phase 0 — repository and test baseline

1. Confirm the worktree is clean and keep `3677c1b` as the rollback point.
2. Update the durable project records:
   - add remembered-instruction hardening to `todo.md`;
   - update the observed test count in `docs/development.md` from 144 to the current count;
   - keep external integrations, multi-user work, and native clients explicitly deferred.
3. Use an isolated database and non-default daemon port for all smoke tests. Never use the personal
   database or a paid provider with personal data.

## Phase 1 — fake-model chat integration tests

Add focused tests using fake models/gateways; do not make network calls.

Likely location: `tests/test_ai_chat_service.py` or a new
`tests/test_ai_instruction_chat.py`.

Cover both `AIChatService.run_turn()` and `run_turn_stream()`:

1. **Positive flow**
   - fake model calls `propose_remembered_instruction` for
     “Remember this for future conversations: prefer mornings”;
   - response contains `instruction_proposal`;
   - proposal status is `pending`;
   - `AISettings.custom_instructions` is unchanged;
   - no `AIDraftItem` or retained empty draft batch is created;
   - assistant content uses proposal language and does not claim it was saved.
2. **Normal chat flow**
   - ordinary Q&A returns no instruction proposal;
   - “I prefer mornings” and “remember my dentist appointment” return no proposal;
   - a model attempting the proposal tool without explicit original-message evidence is rejected by
     the server-side intent gate.
3. **One proposal per turn**
   - repeated or concurrent proposal calls cannot create multiple proposals for one source message.
4. **Streaming parity**
   - SSE emits exactly one complete `instruction_proposal` event;
   - the event appears before `message_end`;
   - non-streaming and streaming turns expose equivalent proposal data.
5. **Failure behavior**
   - provider/model failure does not accept or apply a proposal;
   - any pending proposal created before a failed turn is marked `failed`;
   - no instruction text or provider response is written to logs.
6. **Regression guard**
   - existing task/session draft tool calls still produce `AIDraftItem` rows and do not use the
     instruction-proposal table.

Prefer dependency injection or monkeypatching the model/agent boundary rather than calling Pi,
Ollama, OpenAI, or another live provider.

## Phase 2 — service and API edge cases

Extend the existing instruction service/API tests for:

- empty, whitespace-only, and oversized instructions;
- preservation of existing text during append;
- case/whitespace/bullet-equivalent deduplication;
- edited instruction text at acceptance;
- accepting a proposal when the settings singleton does not yet exist;
- accepting/rejecting without a request body where the endpoint permits it;
- stale manual edit returns HTTP 409 and leaves settings untouched;
- undo succeeds only when the current value still equals the accepted result;
- undo conflicts after a later manual edit;
- accepted proposal remains retrievable after its conversation is deleted;
- conversation detail reload includes pending, accepted, rejected, conflict, and failed cards as
  applicable.

Keep the existing `PUT /api/ai/settings` contract unchanged.

## Phase 3 — manual drawer smoke test

Start a scratch daemon using the isolated-development recipe. Use a local fake/test provider or a
local Pi/Ollama model only.

Verify manually:

1. Open the drawer and send ordinary chat; no proposal card appears.
2. Send an explicit future-directed request; the card shows:
   - proposed instruction;
   - existing custom instructions;
   - resulting custom instructions;
   - editable instruction text;
   - Save and Dismiss buttons.
3. Save the proposal and confirm:
   - the card changes to an accepted state instead of disappearing;
   - `/settings/ai` reflects the resulting text;
   - a new conversation receives the accepted instructions in its prompt context.
4. Dismiss a proposal and confirm settings remain unchanged.
5. Reload the conversation and confirm proposal state is still visible.
6. Simulate a manual settings edit before accepting and confirm the UI reloads current settings and
   asks for review rather than overwriting them.
7. Confirm buttons are disabled while an action is in flight.
8. Try model text containing HTML/quotes/script-like content and confirm it renders as text, never
   markup.
9. Confirm UUID/string ids are passed through `dataset` and URL encoding without numeric parsing.

There is no browser test suite today, so record this as a manual acceptance checklist rather than
adding a browser framework during this hardening pass.

## Phase 4 — privacy and static verification

Run:

```bash
uv run python -P -m pytest -q
uv run ruff check <all changed Python files>
git diff --check
node --check src/timetrace/interfaces/api/static/js/ai_assistant.js
```

Also check logs while exercising the flow. They may contain opaque ids, counts, provider/model names,
error classes, and timings, but not prompts, proposal text, settings text, task/session content,
provider responses, or keys.

Full-repository Ruff currently has unrelated pre-existing failures. Do not mix those cleanups into
this hardening change; either report them separately or make a separately scoped cleanup commit.

## Phase 5 — documentation and closeout

After the checks pass:

- update `docs/ai-maintenance.md` only if the observed implementation differs from the release
  contract;
- update `docs/development.md` with the final test count and smoke-test result;
- update `todo.md` to mark the hardening checklist complete;
- commit the hardening changes separately from the feature commit;
- do not push or merge without explicit approval.

## Following feature

Once this hardening pass is accepted, implement the bounded calendar-grid item from `todo.md`:
**drag preview without database writes until `drag_end`**.

That feature should be planned separately because it touches calendar interaction, session update
contracts, recurrence occurrence handling, and frontend performance. Do not begin fixed/floating
travel semantics, external sync, Tauri/mobile, or multi-user scoping in the same change.

## Definition of done

The hardening pass is complete when:

- fake-model tests cover both chat modes and the normal-chat negative path;
- all service/API conflict and lifecycle cases pass;
- the manual drawer checklist passes on an isolated daemon;
- privacy/logging checks pass;
- changed-file lint, Python tests, JS syntax, and diff checks pass;
- project documentation reflects the new baseline and the next feature is still explicitly scoped.
