# AI Assistant — design spec

Status: **shipped 2026-09-05** — merged to `dev` via `feat/ai-assistant`. See CLAUDE.md's
"Resolved (2026-09-05): AI assistant" note for what actually landed. This document remains the
design record; decisions below were settled with the project owner on 2026-09-01 and should not
be silently re-opened just because the feature is now live.

---

## 0. Sequencing / blocker

The owner chose **"fix recurrence first, then AI"** on 2026-09-01. That prerequisite was
satisfied when the RRULE projection engine merged to `dev` on 2026-09-02 (`fa1dbcf`), replacing
bulk pre-generation. The AI feature subsequently shipped on 2026-09-05.

This was a hard prerequisite because the old implementation regenerated future rows on recurring
task edits, which could silently resurrect an accepted AI move. The current implementation uses
virtual projections and exceptions instead; the old `TaskService` call and line references are
historical rationale, not current code.

Consequence, now in force: recurring sessions **are** safe AI write targets. The "exclude
recurring from AI writes" carve-out described in earlier drafts is **not** needed and must not
be built. `TaskService.update_task` no longer regenerates ~90 sessions on every edit, so an
accepted AI move of a recurring occurrence stays put. A per-occurrence AI change should be
expressed the same way the UI expresses one: a `recurrenceexception` (`skip`/`override`) via
`SessionService`, never a direct write. Note occurrences may carry synthetic `virt:` ids, which
materialize on write -- AI draft items targeting one must record the materialized id.

## 1. What it is

A persistent AI assistant with three capabilities:

1. **NL quick-add (tier 2)** — free text like `lunch with Sarah next Tue 1-2pm` parsed into task
   fields + session placements. Tier 1 stays the existing regex parser.
2. **Reschedule assistant** — `I'm behind, replan this week` → proposed moves/splits of existing
   sessions.
3. **Whole-week auto-scheduler** — `schedule my whole next week, prioritize deep work in the
   mornings` → backlog tasks placed into open calendar time.

**Non-negotiables:** every AI suggestion is a non-destructive **draft** the user explicitly
accepts/rejects — the agent's mutating tools physically cannot write `task`/`session` rows, only
draft rows. A full **audit log** supports undoing a whole week of AI changes in one action. Task
text is sanitized before leaving the machine.

## 2. Original locked stack decisions

The following records the decisions used to ship the feature. For current implementation facts,
see `docs/ai-maintenance.md`, `docs/development.md`, and `pyproject.toml`.

| Decision | Choice |
| --- | --- |
| Orchestration | **LangChain + LangGraph** (`create_agent` tool-calling agent) |
| Providers | **Anthropic, OpenAI, OpenRouter, Ollama, Google, Groq**, swappable at runtime |
| Provider config | **DB-backed**, edited on a new `/settings/ai` page — no restart to switch |
| Primary surface | **Persistent right-side AI drawer**, global on all pages. Multi-turn chat, not a command palette |
| Audit/undo | **Separate append-only audit table with full transition history** — an item may go applied → undone → re-applied → undone; an undone batch can be re-applied |
| Build cadence | **One continuous run** in a feature worktree, single review at the end |

### 2.1 Deliberate deviation: no LangGraph checkpointer / `interrupt()`

LangGraph is used for provider abstraction, the tool loop, and middleware. It is **not** used for
the approval step, and no checkpointer is used for conversation memory.

Reasons: an `interrupt()` parks tool args in a checkpoint blob keyed by `thread_id` — you cannot
`SELECT` that into a calendar overlay by date range, cannot partially accept it, cannot let the user
edit a proposal, and fundamentally cannot undo it days after the graph resumed and finished. Batch
undo is post-graph by nature. Interrupt approval is also all-or-nothing per tool call, whereas our
unit of approval is the batch. And a checkpointer holding conversation history beside our own
`aichatmessage` rows is two sources of truth for the same data. `langgraph-checkpoint-sqlite` also
pulls compiled `sqlite-vec` into a project whose only native surface is stdlib `sqlite3`.

`ModelCallLimitMiddleware` / `ToolCallLimitMiddleware` / `ToolRetryMiddleware` / `PIIMiddleware`
**are** used. `HumanInTheLoopMiddleware` is not imported at all.

## 3. Dependencies — verified empirically 2026-09-01

Resolved and co-resolved against this project's existing pins on Python 3.14.6. No conflicts, no
forced major upgrades (only incidental patch bumps: `sqlmodel 0.0.39→0.0.42`, `pydantic
2.13.4→2.13.5`). `httpx`, `fastapi`, `sqlalchemy` unaffected.

```toml
"langchain>=1.3.18,<2",
"langgraph>=1.2.11,<2",
"langchain-anthropic>=1.7.0,<2",
"langchain-openai>=1.6.0,<2",
"langchain-ollama>=1.1.0,<2",
"langchain-google-genai>=2,<3",
"cryptography>=46",              # Fernet, for api_key_encrypted
```

- **Do not** pin `langchain-core` — transitive via `langchain` (`>=1.6.0,<2`); pinning it
  independently invites a resolver conflict on the next minor.
- **OpenRouter needs no extra package** — `model_provider="openai"` +
  `base_url="https://openrouter.ai/api/v1"`. The native `langchain-openrouter` is still 0.2.8
  (pre-1.0) and stays behind a config flag.
- **Not adding:** `langgraph-checkpoint-sqlite` (§2.1), `sse-starlette` (Starlette
  `StreamingResponse` suffices), `langsmith` tracing — arrives transitively, leave **off**; a
  local-first app must not phone home. Never set `LANGSMITH_TRACING`.

### Verified current API surface (do not code from memory — these were checked against `master`)

- `from langchain.agents import create_agent` — `create_agent(model, tools=None, *,
  system_prompt=None, middleware=(), response_format=None, state_schema=None, context_schema=None,
  checkpointer=None, store=None, ...)`
- `from langchain.tools import tool, ToolRuntime` — `ToolRuntime` carries `.context`/`.state` and is
  **invisible to the model's tool schema**. Inject via `create_agent(context_schema=...)`, read as
  `runtime.context`.
- `from langchain.chat_models import init_chat_model` — the original provider check covered
  `anthropic`, `openai`, `ollama`, and `openrouter`; the shipped implementation additionally maps
  Google to `google_genai` and Groq through the OpenAI-compatible client.
- `agent.astream(input, stream_mode=["messages","updates"], version="v2")`
- `PIIMiddleware(pii_type, *, strategy="redact", apply_to_input=True, apply_to_tool_results=False)`
  — `apply_to_tool_results=True` is the important one here: the leak surface is DB content flowing
  out through tool results, not user input.

## 4. Schema — 7 new tables

All ids UUIDv7 strings via the existing `generate_uuid7`; all datetimes **naive UTC** via `utc_now`.
Append after `ExternalSyncState` in `db/models.py`. The shipped schema uses migration
`0007_ai_assistant_tables`, `down_revision = '0006_recurrence_rrule'`; it is followed by
`0008_ai_custom_instructions`.
Inspect the migration chain rather than reusing historical design numbers.

**Naming:** the chat-message class is `AIChatMessage`, never `AIMessage` —
`langchain_core.messages.AIMessage` is imported in the same codebase.

1. **`aiproviderconfig`** — `name`, `provider`, `model`, `base_url`, `api_key_encrypted`,
   `api_key_last4`, `temperature`, `max_output_tokens`, `request_timeout_seconds`,
   `sanitization_level`, `use_native_openrouter`, `extra_params_json`, `is_active` (indexed;
   exactly one true, enforced in the service), timestamps.
2. **`aisettings`** — singleton row for the behavior toggles the settings page persists:
   `quickadd_fallback_enabled`, `redact_before_send`, `preview_on_calendar`,
   `scheduling_window_days`, `batch_undo_retention_days`.
3. **`aiconversation`** — `title`, `intent`, `provider_config_id`, `is_archived`, `message_count`,
   token totals, `last_message_at`.
4. **`aichatmessage`** — `conversation_id` (indexed, cascade), `position` (indexed — **order by
   this, never by `id`**: uuid7 is only coarsely monotonic and several messages per turn are minted
   in the same millisecond), `role`, `content`, `tool_calls_json`, `tool_call_id`, `tool_name`,
   `draft_batch_id` (**how a chat turn carries a proposal**), `provider`/`model`, tokens, latency,
   `error`.
5. **`aidraftbatch`** — `conversation_id` (nullable), `source_message_id` (plain String, **no FK** —
   avoids a circular FK pair), `intent`, `request_text` (sanitized), `summary`, `status` (indexed),
   `provider`/`model`, `item_count`, `created_at` (indexed — the undo-since axis), `decided_at`,
   `undone_at`.
6. **`aidraftitem`** — `batch_id` (indexed, cascade), `position`, `op`, `entity_type`, `target_id`
   (indexed, **deliberately not a FK** — precedent `RatingEntry.target_id`; a deleted target must
   yield a detectable stale draft, not a cascade that eats the proposal), `proposed_json`,
   `baseline_json` (propose-time, for the diff + staleness), `applied_before_json` (**accept**-time
   — this is what undo restores; restoring the propose-time snapshot would silently revert a user
   edit made in between), `applied_after_json` (what actually landed — our own services normalize),
   `applied_entity_id`, `status`, `rationale`, `error`, timestamps.
7. **`aiaudit`** — append-only transition log (the owner's choice over folding this into the draft
   tables): `batch_id` (indexed), `item_id` (nullable, indexed), `transition`
   (`proposed`/`applied`/`undone`/`reapplied`/`rejected`/`failed`), `entity_type`, `entity_id`,
   `before_json`, `after_json`, `actor` (`ai`/`user`), `reason`, `created_at` (indexed). Because
   this table holds the history, `undone` is **not** terminal: an undone batch may be re-applied,
   and each pass appends rows rather than overwriting state.

`is_stale` is **computed at read time**, never stored — compare the live target against
`baseline_json`.

Cascade rules: conversation → messages cascades. Conversation → batches **does not** — deleting a
chat thread must never destroy the audit trail of applied mutations; null `conversation_id` instead.

**API keys at rest:** Fernet-encrypted, key file `~/.timetrace/secret.key` mode `0600`, generated on
first use (`core/ai/secrets.py`). Justification: `~/.timetrace/backups/` already holds plaintext DB
copies, so a plaintext key in the DB is a plaintext key in an unencrypted backup. Honest limit,
which the settings UI must state: this defends against a stolen DB or backup, **not** against
anything that can read the user's home directory. Responses expose `api_key_set: bool` and
`api_key_last4` only.

## 5. Layering — how `core/` stays DB-free

`core/ai/tools.py` declares the tool surface against an `AIToolGateway` **Protocol** in
`core/ai/spec.py`; `services/ai_tool_gateway.py: DbAIToolGateway` implements it with real queries.
Keeps `core/` free of FastAPI and SQLModel, keeps every query in `services/`, and makes the whole
tool surface unit-testable against a fake gateway with no SQLite.

Gateway methods open their **own** short-lived `Session(engine)` — a documented deviation from
`Depends(get_session)`, inside tool bodies only. LangGraph's tool node executes multiple tool calls
from one AI message **concurrently**, and a single SQLModel `Session` is not safe under that.

### Files

**`core/`:** `timezones.py` (new — a **move** of the private `_daemon_timezone_name()` out of
`services/query_service.py:48`; two copies of "what is the daemon's timezone" is exactly how the
UTC-vs-local bucketing bug returns), `ai/spec.py`, `ai/secrets.py`, `ai/redaction.py`,
`ai/providers.py`, `ai/prompts.py`, `ai/tools.py`, `ai/quick_add_router.py`, `ai/agent.py`.

**`services/`:** `ai_provider_service.py`, `ai_draft_service.py` (the heart — accept/undo/re-apply),
`ai_tool_gateway.py`, `ai_chat_service.py`, `ai_audit_service.py`. All exported from
`services/__init__.py`.

**Router:** `interfaces/api/routers/ai.py`, registered in `routers/__init__.py`. New exception
`AIProviderError` in `core/exceptions.py` → **502** handler in the root `main.py` (not
`interfaces/api/main.py`, which is dead code).

**Frontend:** `templates/components/ai_drawer.html`, `templates/ai_settings.html`,
`static/css/ai.css` (**the project's first CSS file** — served by the existing
`/static/{file_path:path}` route, no mount needed), `static/js/ai_assistant.js`, `ai_drafts.js`,
`ai_draft_overlay.js`, `ai_settings_page.js`, `ai_quickadd.js`. Changed: `navbar.html` (Assistant
launcher + badge), all **six** page templates (there is no base template — each needs the `<link>`,
the `{% include %}` and the script tags), `task_modal.html`, `settings_modal.html`, `api_client.js`
(one new `stream()` method for SSE-over-fetch), `vim_engine.js` (drawer guard), `utils.js` (Escape
ordering), `web.py` (`/settings/ai` route).

## 6. Tool surface

Read tools: `list_tasks`, `get_task`, `resolve_task_reference` (**the UUID-era answer to the dead
`@123` scheme** — the model must call this before referencing a task by name; never invent an id),
`list_sessions`, `find_free_slots`, `get_time_stats` (an allow-listed passthrough to
`QueryService.run` — real SQL from stats slice 1; **never** `AnalyticsService`, which still loads
every session into Python).

Write tools, each of which only ever inserts an `aidraftitem`: `propose_create_session`,
`propose_update_session` (covers move **and** resize — this *is* reschedule),
`propose_delete_session`, `propose_split_session` (expands to 1 update + n−1 creates — **no compound
op**, keeping apply/undo per-row trivial), `propose_create_task`, `propose_update_task`,
`propose_delete_task`, `propose_create_subtasks`, `set_plan_summary`.

No `batch_id` argument on any write tool — the batch comes from the gateway the tools were
constructed around, so the model cannot address another batch. **No timer tools:** the running timer
is file state (`~/.timetrace/active_timer.json`), not a DB row.

Canonical draft ops are the 5 CRUD ops above; the API additionally emits a computed `ui_kind`
(`move`/`resize`/`split`/`add`/`remove`) for badge display, plus a `group_key` tying split parts
together. The frontend renders badges from `ui_kind` and never re-derives them.

### Tier-1 / tier-2 routing

New pure `core/ai/quick_add_router.py: route_quick_add(text, force_tier=None) -> QuickAddDecision`.
Explicitly **not** in `inline_parser.py`: `parse_inline_task` runs on every `create_task`/
`update_task` in the app, and an LLM branch there would put a model decision in the path of every
task write.

**There is no "parse failed" signal to fall back from** — `parse_inline_task` cannot fail; it
scrapes what it recognizes and silently drops the rest. So escalation is a positive heuristic on
what *remains* after tier-1 consumed its grammar: a weekday/month name, `tomorrow`/`next week`,
a clock time or range, a duration phrase, multi-clause joiners with >8 remaining words, or >14
remaining words. A bare short title never escalates — never pay latency or money for `fix login bug`.

## 7. API contract (reconciled)

`APIRouter(prefix="/api/ai")`. Static routes before dynamic (`/catalog` before `/{config_id}`).
Endpoints that invoke a model are `async def` — a week-scheduling turn can take 30-60s and a sync
handler would starve the threadpool.

- **Status:** `GET /status` → `{configured, default_provider, quickadd_fallback_enabled,
  pending_draft_count, undoable_batch_count, latest_batch}` — one cheap call for the navbar badge.
- **Providers:** `GET|POST /providers`, `PUT|DELETE /providers/{id}`, `POST /providers/{id}/activate`,
  `POST /providers/test` (accepts **either** a saved id **or** an unsaved inline config, so a bad key
  is caught before it is stored), `GET /providers/catalog`, `GET /providers/{id}/models`.
  `PUT` with `api_key` omitted = keep, `""` = clear (the classic "don't wipe the key because the form
  round-tripped a masked value" bug).
- **Settings:** `GET|PUT /settings`.
- **Chat:** `GET|POST /conversations`, `GET|PATCH|DELETE /conversations/{id}`,
  `POST /conversations/{id}/messages` → `AIChatTurnResponse`, and the same with `stream: true`
  returning `text/event-stream`.
- **Drafts:** `GET /drafts/batches` (**the undo history list**), `GET /drafts/batches/{id}`,
  `GET /drafts/overlay?start=&end=` (**the calendar draft layer**), `PATCH /drafts/items/{id}`
  (edit before accept), `POST /drafts/items/{id}/reject`,
  `POST /drafts/batches/{id}/accept {item_ids?}`, `POST /drafts/batches/{id}/reject`,
  `POST /drafts/batches/{id}/undo`, `POST /drafts/batches/{id}/reapply`,
  `POST /drafts/undo {batch_ids?, since?}` (**the one-action week undo**).
- **Quick add:** `POST /quick-add/parse` — **read-only, creates nothing**; returns task fields +
  session placements for the modal strip to fill in. `POST /quick-add/classify` — no LLM call, lets
  the UI say "AI will be used" before spending money.

**Datetimes:** `before`/`after` are naive UTC (DB truth, what the audit needs); every item also
carries `display.*_local` and a server-computed `day_key` (local calendar day, by session start
time) which is what the frontend renders and groups by. The frontend must **never** slice
`start_time[:10]` — that buckets by UTC and a 23:30 session lands under the wrong day header while
its calendar ghost sits on the correct column.

**Apply always returns 200 with per-item results** when the draft exists and the body is valid — a
blanket 409 on staleness makes partial application illegible. `AIApplyResult` carries
`completion_policies: list[CompletionPolicyPrompt]`, reusing the **existing** schema so
`completion_policy.js` works unchanged; dropping it would silently regress the 2026-08-24 feature.

**SSE events:** `message_start`, `status`, `token`, `draft` (**one complete payload — drafts never
stream**; a half-parsed 40-item draft is worthless to render), `message_end`, `error`. Non-streaming
is canonical; streaming must not invent a second shape.

## 8. Accept / undo semantics

`AIDraftService.accept_items` is the **only** place a draft becomes a real row. Per item, in
`position` order: re-check staleness (changed → `failed`, never clobber) → validate the referenced
`task_id` exists → **delegate to `SessionService`/`TaskService`, never write columns directly** (that
is what keeps `ensure_utc`, `end_time > start_time`, tag inheritance, the `status`/`status_id` loose
sync and the completion-policy hook alive) → record `applied_before_json`/`applied_after_json`/
`applied_entity_id` → append an `aiaudit` row.

`undo_batch` walks items in **descending** `position`: creates are deleted, updates restore
`applied_before_json`, a deleted session is recreated (with a **new** id, written back to
`applied_entity_id` so the trail stays honest). Before each, compare the live row against
`applied_after_json`; a mismatch means the user edited it since, so the item is reported as a
conflict and **left alone**. Silently reverting a later manual edit is the worst possible failure
for this feature.

## 9. Traps in this codebase this feature must respect

1. **`SessionService` silently coerces** — `create_session`/`update_session` null an unknown
   `task_id` (`session_service.py:24-28`, `:89-93`). Accept must validate first and fail loudly; a
   silently task-less session reported as "applied" is a false audit record.
2. **`TaskService.create_task` rewrites AI titles** — it runs `apply_quick_task_syntax` then
   `parse_title_estimation`, so an AI title containing `#`, `!high`, `(...)`, `due:3d` or `[15m]` is
   silently mutated and the estimate overwritten. Tool schemas must instruct the model to put
   tags/priority/estimate in their own fields, never in the title.
3. **`find_free_slots` must subtract the batch's own already-proposed items**, or a multi-step week
   plan double-books itself on the second call inside one turn.
4. **`vim_engine.js` switches on bare `e.key`** (`j k h l x d c e i o s v t w m a`) with no modifier
   check, bailing only when focus is in an input. Reading a draft card with the mouse and pressing
   `x` would delete a calendar session. Hence a drawer-open guard and `Ctrl+Shift+A`, **not**
   `Ctrl+K` (which also hits `case 'k'`).
5. **LLM output is the one prompt-injectable string in this app.** All model text is set via
   `textContent`, never `innerHTML` — a deliberate departure from surrounding conventions that must
   survive review. No Markdown rendering (`marked.js` is only loaded on `tasks.html`).
6. **UUIDv7 string ids** — no `parseInt`, no numeric sort, no unquoted id in an inline `onclick`.
   Renderers use `addEventListener` + `dataset`.
7. **Never `PIIMiddleware(strategy="block")`** — a task legitimately titled after an email address
   must degrade, not 500. And never add a bare `\d{9,}` detector: it can match inside a 32-hex-char
   id and break tool round-tripping silently.
8. **No `sa.func.now()` in the migration** — `0002` shipped that bug and broke every fresh database.
   Verify against a copy of the real DB **and** a genuinely fresh one; only the second catches a
   broken chain.

## 10. Conversational remembered instructions

The assistant may recognize an explicit future-directed request such as "remember this", "from
now on", or "for future conversations" and call `propose_remembered_instruction`. This creates a
separate `AIInstructionProposal`; it does not reuse `AIDraftItem` and does not modify
`AISettings.custom_instructions`. The drawer shows the proposed instruction, the before/after
custom-instructions text, and requires an explicit **Save to custom instructions** or **Dismiss**
action. Acceptance is append-only and hash-checked against manual edits. These remembered
instructions are global persisted custom instructions, not semantic memory or cross-conversation
retrieval. Structured scheduling settings remain authoritative for enforced constraints.

## 11. Explicitly not in this slice

No LangGraph checkpointer/`interrupt()`. No timer tools. No AI writes to habits, ratings, reviews or
`TaskStatus`. No changes to `core/inline_parser.py` (the three dead functions stay dead;
`resolve_task_reference` is the UUID-era answer to their `@123` scheme). No `timetrace ai` CLI
command (the CLI talks HTTP; addable later with no backend change). No embeddings/vector store/RAG,
no cross-conversation semantic memory. No cost budgeting beyond call-count limits (token counts are
recorded so a budget needs no migration later). No per-user scoping — ids are UUIDv7, an owner
column is additive. No multi-agent supervisor graph. No LangSmith tracing. No migration of the
existing localStorage settings to the server (only provider config and the AI behavior toggles go
server-side; theme/vim/`firstDayOfWeek` stay in `settings.js`).
