Prompt (original):

That's my current version of this project. Find all inconsistencies and errors. Also write full files if i need to change something in those files. i don't want to use icons like this ✨ mostly(if they already exist in code,then its fine)

---

## Architecture / Backend (from chat.pdf gap analysis, see CLAUDE.md "Roadmap")

- [x] **Reconcile migration history first**: done 2026-08-20 — `0003_uuid7_and_sync_fields.py` now
  exists and reconstructs the already-live sync columns/table.
- [x] Migrate primary keys from auto-increment `int` to **UUIDv7**: done 2026-08-20
  (`0004_uuid7_primary_keys.py`, `db/models.py`, all routers/services/CLI/schemas, plus several
  frontend JS bugs it uncovered — unquoted ids in inline `onclick` handlers and `parseInt(taskId)`
  calls that would have corrupted UUIDs). Applied to the live database; backup kept in
  `~/.timetrace/backups/`. See CLAUDE.md "Resolved" note for details and remaining follow-ups
  (CLI/export readability, dormant `inline_parser.py` numeric `@task_id` syntax).
- [ ] Replace bulk pre-generated recurring session rows with an in-memory RFC 5545 `RRULE` projection
  engine (single master rule + exceptions table, evaluate only for the visible viewport range).
- [ ] Add `timezone` (IANA id, e.g. `America/New_York`) handling to distinguish fixed (absolute UTC)
  vs. floating (local wall-clock) events — the `session.timezone` column already exists in the live DB
  but isn't modeled or used yet.
- [ ] Task/session completion policy: when a parent task is marked done, evaluate remaining scheduled
  sessions and prompt to keep/clear them; compute remaining balance as
  `estimated_duration - sum(logged_session_durations)` dynamically instead of a stored counter.

Maybe use uuid7. maybe update my pyproject.toml to use latest versions of technologies

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

- [ ] Interval-graph overlap clustering for overlapping sessions (group contiguous overlaps, compute
  max concurrent columns, assign fractional widths e.g. `33.3%`) — only worth doing if the current
  FullCalendar-based grid actually collapses on real overlap cases.
- [ ] Decouple drag-to-reschedule from state writes: render a lightweight preview layer at 60fps while
  dragging, commit to DB only on `drag_end`.

## Statistics & custom dashboards — ACTIVE

Design settled 2026-08-21; full decision record in CLAUDE.md "Current focus". Summary: widgets are
structured queries (source × measure × group-by × filters × chart) with a read-only SQL escape
hatch; local-day bucketing by session start; per-widget tag attribution (default fan-out);
per-widget comparison baselines; `/stats` becomes a seeded, editable "Overview" dashboard.

- [ ] **Slice 1** — query engine + `POST /analytics/query` + seeded Overview. Compiles structured
  queries to SQL. Fixes two standing defects on the way: analytics no longer loads every session
  and task into Python, and UTC-vs-local date bucketing is unified on local.
- [ ] **Slice 2** — builder UI: add/edit/remove/reorder widgets, save named dashboards.
- [ ] **Slice 3** — read-only SQL escape hatch (SELECT-only, single statement, LIMIT, timeout).
- [ ] **Slice 4** — per-widget comparison baselines (prev period / last year / custom).

Deliberately not in scope yet: per-user scoping on dashboards (UUIDv7 ids mean an owner column can
be added later without a table rebuild).

## Frontend

Check how good my current frontend, and maybe i need to rewrite everything on react.

## Teams / multi-user — only if it proves needed

Not committed to. The shape if it happens: project tracking closer to Jira, scheduling closer to
Morgen, shared dashboards. Ranked below recurrence work and above AI. UUIDv7 ids already make
adding an owner/workspace column a non-rebuild change, so nothing needs pre-building for it.

- [ ] Decide whether scoping is per-user or per-workspace before any schema work.
- [ ] Sharing model (read-only links? real accounts?) — undecided.
