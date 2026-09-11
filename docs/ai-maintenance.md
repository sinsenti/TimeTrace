# AI maintenance guide

This is the short operational guide for changing the shipped AI assistant. The longer
[`ai-assistant-spec.md`](ai-assistant-spec.md) is the design record and explains historical
rationale; it is not a checklist of missing work.

## Safety boundary

- AI tools may only create pending `AIDraftBatch`/`AIDraftItem` records. They must never write real
  `Task` or `Session` rows.
- `AIDraftService.accept_items` is the only path from a proposal to real data. It must delegate to
  `TaskService`/`SessionService`, preserving validation, quick-add behavior, recurrence handling,
  completion-policy prompts, and UTC normalization.
- Preserve stale checks, append-only audit transitions, conflict-safe undo, and reapply semantics.
- Treat model output, user custom instructions, task titles/descriptions/notes, imported text, and
  tool results as untrusted data. None may override system safety rules or gain authority merely by
  containing instructions.
- Render model text as text (`textContent`); never interpret it as HTML or executable markup.

## Privacy and providers

- Never log prompts, task/session content, tool arguments/results, provider responses, API keys, or
  raw provider exceptions. Logs may contain opaque IDs, provider/model names, counts, durations, and
  error classes.
- Redact content before sending it to a third-party provider according to the configured privacy
  settings. Do not use real providers or personal data in automated tests; use fake models/gateways.
- Do not enable LangSmith tracing or add provider/network calls to tests.
- Fernet keys and provider configuration must remain masked in API responses and UI output.

## Domain traps

- Recurring occurrence writes go through `SessionService`; support synthetic `virt:` IDs and record
  the materialized real ID after acceptance.
- Snapshot restoration uses `parse_title_syntax=False`; otherwise restoring a title can reapply
  quick-add parsing and change human-authored data.
- Never treat UUIDv7 IDs as numbers or invent IDs. Resolve references through the gateway read tools.
- Keep `find_free_slots` aware of proposals already made in the current batch.
- Do not add timer, habit, rating, review, or external-sync writes without a separately settled scope.

## Required verification

For behavior changes, add regression coverage for the affected layer. AI changes should cover, as
applicable:

- draft-only tool isolation;
- accept delegation and domain validation;
- stale proposals and user-edit conflicts;
- undo/reapply, including deleted rows and partial batches;
- recurrence projection and `virt:` materialization;
- redaction while preserving dates and UUIDs;
- absence of secrets/productivity content from logs;
- equivalent persisted results for streaming and non-streaming turns.

Use fake models and gateways. Run the focused AI tests, `uv run pytest -q`, `uv run ruff check .`,
`git diff --check`, and `node --check` for each changed JavaScript file.

## Scope decisions

The assistant currently supports quick-add, rescheduling, whole-week scheduling, task/session draft
writes, provider configuration, chat, calendar overlays, audit, undo, and reapply. Provider configuration
supports the built-in LangChain providers plus **Pi**: Pi uses the locally installed
`@earendil-works/pi-coding-agent` ModelRuntime and its existing `~/.pi/agent` credentials. Configure
Pi authentication with `/login`, then select an exact `provider/model` ID (such as
`openai-codex/gpt-6-astra`) in `/settings/ai`. The daemon must be able to find the `pi` executable;
for a non-standard install, set `TIMETRACE_PI_PACKAGE_DIR` to the Pi package root. TimeTrace does
not store or receive the Pi API key;
Pi is used only for model inference, while TimeTrace retains ownership of all tools and draft approval.
It does not
support timer/habit/rating/review writes, embeddings/RAG, cross-conversation semantic memory,
external integrations, multi-user ownership, or a CLI AI command. Do not add groundwork for those
features without an explicit owner decision.
