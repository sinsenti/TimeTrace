Prompt (original):

That's my current version of this project. Find all inconsistencies and errors. Also write full files if i need to change something in those files. i don't want to use icons like this ✨ mostly(if they already exist in code,then its fine)

---

## Architecture / Backend (from chat.pdf gap analysis, see CLAUDE.md "Roadmap")

- [x] Replace bulk pre-generated recurring session rows with an in-memory RFC 5545 `RRULE` projection
  engine (single master rule + exceptions table, evaluate only for the visible viewport range).
  **Done 2026-09-02** via `feat/recurrence-rrule` (merged `fa1dbcf`) — see CLAUDE.md's Recurrence
  roadmap row.
- [ ] Define and implement fixed (absolute UTC) versus floating (local wall-clock) event semantics.
  `Session.timezone` is already modeled and persisted, but general travel semantics are not implemented;
  recurrence already uses `Task.recurrence_timezone` for DST-aware wall-clock expansion.



## External sync — DEFERRED (2026-08-21), do not start

Explicitly the lowest priority. Not being built now; don't add Redis/a job queue/Postgres for it,
and don't lay further groundwork. Parked for later:

- [ ] Google Calendar / Outlook via incremental delta tokens (`syncToken` / `$delta`) on a
  background job queue (SAQ/Arq + Redis).
- [ ] Internal `task_id` in Google's `extendedProperties` so webhooks map back to the right task.
- [ ] OAuth token manager: encrypt refresh tokens at rest, rotate before expiry.
- [ ] PostgreSQL + PowerSync replicating to local SQLite per client.
- [ ] Linear (idea from Morgen).

## Cross-platform / native shell

- [ ] Wrap the existing web UI in **Tauri v2** for a native desktop build (~70–90MB RAM vs. Electron's
  ~400MB) before considering a separate native client.
- [ ] React Native/Expo for mobile, sharing the web UI's components where practical.
- [ ] Once a native shell exists: global hotkey quick-add (e.g. `Ctrl+Shift+Space`), persistent system
  tray icon, OS-native notification daemon for reminders that fire even when the app is closed.

## AI features — DONE (2026-09-05)

Merged via `feat/ai-assistant`, built against `docs/ai-assistant-spec.md`. See CLAUDE.md's
"Resolved (2026-09-05): AI assistant" note for the full picture (tool surface, safety invariant,
traps found during the merge-review pass).

- [x] Two-tiered intent extraction: fast local parser for simple date/time syntax, LLM only for
  multi-constraint scheduling requests. (`core/ai/quick_add_router.py`)
- [x] Human-in-the-loop UX: render AI scheduling suggestions as non-destructive draft layers the user
  explicitly accepts/rejects — never a silent DB mutation. (`AIDraftService`, the AI chat drawer)
- [x] Audit log of AI-driven changes with one-tap rollback for a whole batch (e.g. a week of
  AI-rescheduled tasks). (`aiaudit` table, append-only; `POST /drafts/undo`)
- [x] PII sanitization before sending calendar context (titles, attendee emails) to a third-party LLM API.
  (`core/ai/redaction.py`)

Not built, and not currently planned unless asked for: habit/rating/day-review writes, timer
control, embeddings/RAG, a multi-agent supervisor graph, or external integrations. Read-only daily
briefings, weekly reviews, deterministic conflict/schedule validation, task progress, local FTS task
search, and persisted scheduling preferences are implemented through the AI insights service and
agent tools; they do not expand the draft-only write boundary.

## Product notes

- **Custom behaviors/automations:** not implemented. Do not add a generic automation engine or
  trigger schema without a settled scope. A future design should start with allow-listed events,
  conditions, actions, dry-run previews, audit history, and loop prevention; AI must not silently
  execute those actions.
- **Custom dashboards:** implemented through persisted named dashboards and widgets, structured
  query widgets, optional read-only SQL widgets, and comparison baselines. See `CLAUDE.md` and
  `docs/development.md`; this is no longer a todo item.

## Calendar grid rendering

- [ ] Decouple drag-to-reschedule from state writes: render a lightweight preview layer at 60fps while
  dragging, commit to DB only on `drag_end`.

## Teams / multi-user — only if it proves needed

Not committed to. The shape if it happens: project tracking closer to Jira, scheduling closer to
Morgen, shared dashboards. Ranked below recurrence work and above AI. UUIDv7 ids already make
adding an owner/workspace column a non-rebuild change, so nothing needs pre-building for it.

- [ ] Decide whether scoping is per-user or per-workspace before any schema work.
- [ ] Sharing model (read-only links? real accounts?) — undecided.
