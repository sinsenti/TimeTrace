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
- Legacy v1 acceptance, inverse deletion and reapply recheck destructive targets and their
  dependencies under the SQLite writer lock. They refuse deletion when ratings, reviews,
  recurrence exceptions, task children or history, plans/work, or unsnapshotted session metadata
  would be lost. Undo refuses to recreate a dangling session-task or parent link. Ordinary
  restorable rows keep the existing new-ID audit trail; old snapshots are not rewritten.
  Identity-preserving edits can retain linked evidence and external metadata, but v1 cannot
  restore a projected recurrence after claiming it. Session create, update and reapply also
  validate the normalized prospective row under the same lock, refusing edits that would create
  a new legacy anchor claim on the inverse operation.
- Treat model output, user custom instructions, task titles/descriptions/notes, imported text, and
  tool results as untrusted data. None may override system safety rules or gain authority merely by
  containing instructions.
- Render model text as text (`textContent`); never interpret it as HTML or executable markup.

## Remembered standing instructions

Conversational requests to remember a future preference create an `AIInstructionProposal` and
never update `AISettings.custom_instructions` directly. The user must explicitly accept the card
with **Save to custom instructions**; dismissing it leaves settings unchanged. Proposals are
append-only, global to the daemon, and affect later turns in every conversation after acceptance.
They are not semantic memory, embeddings, RAG, or cross-conversation retrieval. Acceptance checks
the settings hash captured at proposal time, so manual edits produce a conflict rather than being
overwritten. Structured scheduling fields remain authoritative for enforced breaks, hours, allowed
days, daily caps, and scheduling windows.

Instruction-card writes have their own recovery boundary. Once Save or Dismiss receives an
acknowledgment, later badge/Settings refresh failures remain read failures; the card keeps the
accepted or dismissed result and retries only reads. When a write response is uncertain or
conflicted, the card reads the proposal by ID before offering another action. Save and Dismiss
return only after the server confirms the proposal is still pending; a conflict is terminal and
offers Settings access plus read-only reconciliation. While a mutation or proposal-status read is
pending, the card remains a conversation-change guard. Settings synchronization still checkpoints
only the custom-instructions field and restores its unsaved local draft.

## Privacy and providers

- Never log prompts, task/session content, tool arguments/results, provider responses, API keys, or
  raw provider exceptions. Logs may contain opaque IDs, provider/model names, counts, durations, and
  error classes.
- Redact content before sending it to a third-party provider according to the configured privacy
  settings. The AI data scope defaults to tasks/sessions only; habits, reviews, ratings, and timer
  context require explicit opt-in. Redaction is not complete anonymization. Do not use real providers
  or personal data in automated tests; use fake models/gateways.
- Both chat and saved/inline connectivity probes use the DB-free `core.ai.providers.get_chat_model`
  constructor for routing, defaults and option precedence. Keep DB reads and decryption in the
  services; the provider-service wrapper preserves domain validation, while chat sanitizes
  initialization failures. Probes cap output at 16 tokens and timeout at 30 seconds (or a smaller
  configured value); explicit options still override `extra_params`. Pi credentials remain owned by Pi.
- Do not enable LangSmith tracing or add provider/network calls to tests.
- Fernet keys and provider configuration must remain masked in API responses and UI output.

## Chat-turn lifecycle

`AIChatService._run_turn` owns preparation, bounded history replay, eager batch creation,
agent execution, transcript persistence, final-message association and failure cleanup for both
public turn methods. `run_turn` returns the completed response; `run_turn_stream` serializes live
status/tokens and the completed draft/instruction/message events. Streaming reconstructs the
transcript from graph updates in that same execution, never a second model invocation.

Preserve `message_start` before batch/model setup, assistant-only text tokens and terminal event
ordering. Empty batches are deleted on success or handled failure; batches with draft items survive
provider/tool failure, while remembered-instruction proposals are marked failed. Initialization
failures leave only the user message; invocation failures also persist a sanitized assistant error.
The gateway still receives the original user text for intent gating and opens its own tool sessions.

## Model-facing read context

`DbAIToolGateway._read_context` owns scoped read execution and the lifetime of each private
SQLModel session. Static domain requirements are declared at the read's execution site; statistics,
rating targets and optional reflection timer context retain explicit payload-dependent checks in
the gateway before execution. Do not move authorization into `AIInsightsService` or the deterministic
domain services: human-local insight endpoints deliberately use those services independently.
Each concurrent tool call must still open and close its own session, including on failure.

This is the existing tool-visibility contract, **not** strict field-level domain isolation:

- Task-only `get_task_progress` includes recorded-session aggregates and session counts.
- Sessions-only `list_sessions` includes linked task IDs and projected occurrences' task metadata;
  `validate_schedule` can resolve linked tasks and expose their titles in diagnostics.
- Conflict, daily and weekly reads require both sessions and tasks. Day summaries additionally
  require reviews; task reviews require reviews and tasks.
- Statistics require the source domain (`habit_logs` → habits, `day_reviews` → reviews,
  `rating_entries` → ratings). Session task/category/status/priority grouping or filtering and
  `has_task` filtering also require tasks; ordinary session tag statistics do not. Task/session
  average ratings additionally require ratings; session average ratings cannot use tag grouping
  or filtering.
- Rating entries require ratings plus the explicit task/session/habit target's domain. An unfiltered
  target requires all three domains; day targets do not. Reflection requires sessions, tasks,
  habits, reviews and ratings, plus timer only when requested.

Habits, reviews, ratings and timer remain default-deny/explicit-opt-in. PII redaction is a separate
step, not authorization or a guarantee that permitted aggregates hide linked domain information.
`tests/test_ai_read_context.py` characterizes these exceptions, ordered scope errors, source/payload
requirements, and concurrent DB connection isolation/cleanup. Never tighten visibility as part of
an internal read-context refactor.

## Browser task refresh after approval

After a successful accept/undo/reapply or undo-all, `ai_drafts.js` calls
`taskKnowledge.changed()` before refreshing draft cards. Keep these paths independent: a failed
batch-detail read must not prevent calendar/task/attachment views from refreshing, and display
failures must not be reported as a failed write. The shared task-knowledge module is included on
every drawer page; it retains last-known metadata and provides a refresh-only retry notice.
It must not reopen forms or overwrite unsaved fields. Preserve review/rating edits only after those
fields have been initialized for the selected task; block Save until initialization finishes and
ignore superseded statistics/rating reads. Keep an excluded timer selection during option refresh.
Accepted task text must stay inert in every refreshed renderer (cards/date badges, calendar event
labels, suggestions, chips, task trees, history and breakdowns), not just draft cards. Use text nodes or context-appropriate HTML escaping;
Kanban description previews deliberately do not interpret Markdown/HTML. See the
[same-page metadata reference](development.md#same-page-task-metadata) for ownership and Node/browser
verification. These are display changes only; server-side approval, conflict and audit rules stay
in `AIDraftService`.

## Domain traps

- Recurring occurrence writes go through `SessionService`; support synthetic `virt:` IDs and record
  the materialized real ID after acceptance.
- Snapshot restoration uses `parse_title_syntax=False`; otherwise restoring a title can reapply
  quick-add parsing and change human-authored data.
- Never treat UUIDv7 IDs as numbers or invent IDs. Resolve references through the gateway read tools.
- Keep `find_free_slots` aware of proposals already made in the current batch and honor the saved
  scheduling hours, allowed days, break, and daily-cap preferences.
- Read-only insights (`get_daily_briefing`, `get_weekly_review`, `find_conflicts`,
  `get_task_progress`, `search_tasks`, habits, ratings, reviews, and reflection context) must use
  deterministic services/query SQL. They may include pending same-turn drafts in planning views,
  but never persist domain rows.
- Task progress consumes `TaskService.get_work_accounting` and its recorded-session SQL totals.
  Keep it separate from the richer task inspector: do not load session history, reviews or ratings
  for AI progress. Non-positive/missing estimates return null progress (explicit owner approval for
  negative estimates on 2026-10-31); existing balances, counts
  and recurring per-occurrence semantics remain unchanged. See
  [task work accounting](development.md#task-work-accounting).
- Timer controls and habit/rating/review writes remain out of scope. Day-review create/update is
  allowed only as a pending draft and must pass through `AIDraftService.accept_items` after approval.

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

Use fake models and gateways. Run the focused AI tests and the full suite with
`uv run python -P -m pytest -q` (`-P` avoids root `copy.py` shadowing), plus `uv run ruff check .`,
`git diff --check`, and `node --check` for each changed JavaScript file.

## Scope decisions

The assistant currently supports quick-add, rescheduling, whole-week scheduling, read-only daily and
weekly insights, deterministic conflict/schedule checks, local FTS task search, task/session draft
writes, provider configuration, chat, calendar overlays, audit, undo, and reapply. The shared drawer's
weekly report uses `/api/ai/insights/weekly-review/current`, whose daemon-resolved local week can
accept the browser's validated `firstDayOfWeek` setting. Provider configuration
supports the built-in LangChain providers plus **Pi**: Pi uses the locally installed
`@earendil-works/pi-coding-agent` ModelRuntime and its existing `~/.pi/agent` credentials. Configure
Pi authentication with `/login`, then select an exact `provider/model` ID (such as
`openai-codex/gpt-6-astra`) in `/settings/ai`. The daemon needs Node.js on its `PATH` and auto-detects
the standard managed package under `~/.pi/agent/install/current-version` (or `PI_MANAGED_INSTALL_ROOT`);
for a non-standard install, set `TIMETRACE_PI_PACKAGE_DIR` to the Pi package root. TimeTrace does not
store or receive the Pi API key;
Pi is used only for model inference, while TimeTrace retains ownership of all tools and draft approval.
It does not support timer controls or direct habit/rating/review writes: those domains are
read-only through explicit typed tools, while day-review create/update is an approval-gated draft.
Embeddings/RAG, cross-conversation semantic memory, external integrations, multi-user ownership, and
a CLI AI command are also out of scope. Do not add groundwork for those features without an explicit
owner decision.

## AI Settings editors

AI behavior Cancel restores the latest acknowledged field baselines, including custom instructions
reconciled by Assistant approval/conflict handling. It performs no read or write. A pending Save
still completes on the daemon; its acknowledgement updates only the submitted field baselines and
cannot erase newer typing or a newer authoritative instruction baseline.

Provider drafts have independent Save/Cancel ownership. A blank saved-key field keeps the key;
typing replaces it; **Clear saved key** sends the explicit empty string on Save. Cancel disposes the
typed password and clear intent. Acknowledged creates adopt the saved ID before a subsequent edit,
and post-write refresh Retry reads only. Unexposed extra parameters and the native OpenRouter option
remain preserved. Pi authentication stays with Pi.

Connectivity failures return stable, safe text for SDK construction/invocation and saved credential/
JSON extraction failures. Malformed-request domain errors remain distinct. Provider response extras
omit the known `api_key` option while stored values and SDK forwarding remain unchanged; this is not
arbitrary-secret detection or a storage migration. The shared API client logs static diagnostics only
for the known AI settings/provider paths, while preserving thrown errors and other endpoint logging.
