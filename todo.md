Prompt (original):

That's my current version of this project. Find all inconsistencies and errors. Also write full files if i need to change something in those files. i don't want to use icons like this ✨ mostly(if they already exist in code,then its fine)

---

## Architecture / Backend (from chat.pdf gap analysis, see CLAUDE.md "Roadmap")

- [ ] Replace bulk pre-generated recurring session rows with an in-memory RFC 5545 `RRULE` projection
  engine (single master rule + exceptions table, evaluate only for the visible viewport range).
- [ ] Add `timezone` (IANA id, e.g. `America/New_York`) handling to distinguish fixed (absolute UTC)
  vs. floating (local wall-clock) events — the `session.timezone` column already exists in the live DB
  but isn't modeled or used yet.



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

## AI features — postponed, but ranked ABOVE external integrations

Not started. Settle the UX controls (draft layers + rollback log) before wiring up any model call.

- [ ] Two-tiered intent extraction: fast local parser for simple date/time syntax, LLM only for
  multi-constraint scheduling requests.
- [ ] Human-in-the-loop UX: render AI scheduling suggestions as non-destructive draft layers the user
  explicitly accepts/rejects — never a silent DB mutation.
- [ ] Audit log of AI-driven changes with one-tap rollback for a whole batch (e.g. a week of
  AI-rescheduled tasks).
- [ ] PII sanitization before sending calendar context (titles, attendee emails) to a third-party LLM API.

How its possible to create custom behaviors(like transmit from one status to another when soemthing happened) for users? Does it possible or no? or suggest better things
How to be able to user create custom dashboard with different views, etc?

## Calendar grid rendering

- [ ] Decouple drag-to-reschedule from state writes: render a lightweight preview layer at 60fps while
  dragging, commit to DB only on `drag_end`.

## Teams / multi-user — only if it proves needed

Not committed to. The shape if it happens: project tracking closer to Jira, scheduling closer to
Morgen, shared dashboards. Ranked below recurrence work and above AI. UUIDv7 ids already make
adding an owner/workspace column a non-rebuild change, so nothing needs pre-building for it.

- [ ] Decide whether scoping is per-user or per-workspace before any schema work.
- [ ] Sharing model (read-only links? real accounts?) — undecided.
