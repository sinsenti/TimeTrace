# TimeTrace agent guide

Shared working instructions for coding assistants in this repository.

## Read first

- Read this file at the start of a coding session.
- Use [docs/development.md](docs/development.md) for the code map, isolated development setup,
  testing guidance, and current implementation status.
- Read the relevant sections of [CLAUDE.md](CLAUDE.md) for owner decisions and historical rationale.
  Its statistics/dashboard decisions remain settled; do not silently redesign them.
- Before AI changes, read [docs/ai-assistant-spec.md](docs/ai-assistant-spec.md).
- Before recurrence changes, read [docs/recurrence-engine-plan.md](docs/recurrence-engine-plan.md),
  including its final **Settled owner decisions** section, which overrides earlier proposals.
- Specs and roadmap notes contain historical code snapshots. Check current source and tests before
  treating a feature as missing. Report a conflict with an owner decision rather than quietly
  changing either the decision or the behavior.

## Working agreement

1. Inspect `git status --short` and the relevant diff before editing. Preserve existing user changes;
   do not reset, stash, or overwrite them to get a clean tree.
2. Trace the affected slice: JS/template or CLI → router/schema → service → core/model. Check other
   callers before changing a shared contract. Keep fixes scoped; do not bundle unrelated cleanup.
3. Add regression tests for behavior changes. Run relevant checks and report exactly what passed,
   failed, or was not run. Separate pre-existing failures from new ones.
4. Update the relevant documentation when behavior, commands, or architectural constraints change.
   Keep this file short and durable; put detailed maps/runbooks in `docs/`, not another history here.
5. Do not commit, push, merge, or open a PR unless asked. Before a feature merge into `dev`, follow
   [.claude/skills/merge-review/SKILL.md](.claude/skills/merge-review/SKILL.md): automated checks,
   adversarial review, then explicit human review/approval. Passing tests is not merge permission.
6. No new emoji in UI copy or code unless matching an existing convention in that file.

## Commands

Python **3.14**, managed with `uv`; there is no frontend build step.

```bash
uv sync
uv run pytest -q
uv run ruff check .
uv run ruff check --fix path/to/changed.py
uv run ruff format path/to/changed.py
node --check src/timetrace/interfaces/api/static/js/calendar.js  # substitute each changed JS file
```

Use scoped autofix/format commands so unrelated files and user edits stay untouched. Ruff uses
`E/F/I/UP/B`, 120 columns, `py314`; `B008` is currently ignored in `pyproject.toml`.

**Never use the personal database for experiments.** Set `TIMETRACE_DB_FILE` to an absolute path
in a temporary directory **before any `timetrace` import or command**. Settings, the DB engine,
and timer state are initialized at import time. Timer JSON and the AI encryption key are siblings
of the database, so use a separate directory, not just a different filename in `~/.timetrace`.
Use a non-8002 port for a scratch daemon and the same environment for its CLI. The safe recipe is
in [docs/development.md](docs/development.md#isolated-development).

## Architectural boundaries

- The actual app is `src/timetrace/main.py:create_daemon_app` / `daemon_app`, served by
  `timetrace daemon` (default `127.0.0.1:8002`). Do not wire features into the unused
  `interfaces/api/main.py` app. Bare `timetrace` shows timer status; there is no current Textual TUI.
- Ordinary CLI operations talk HTTP. Routers stay thin; business logic and DB queries belong in
  `services/`. Export new services from `services/__init__.py`. Keep `core/` free of FastAPI/DB
  dependencies; the structured query compiler produces SQL but does not execute it.
- Raise domain exceptions from `core/exceptions.py`, not `HTTPException` inside services.
  The root app maps not-found to 404, validation/timer errors to 400, and AI provider errors to 502.
- Frontend code is plain JS plus Jinja2 templates under `interfaces/api/`; use the shared
  `static/js/api_client.js`. There is no common base template, so check every affected page include.

## Invariants to preserve

- **Data and migrations:** schema changes in `db/models.py` require an Alembic migration in
  `db/migrations/versions/`. Startup runs migrations. Test both a fresh DB and a disposable copy of
  an existing DB; never hide a failed upgrade by stamping head or falling back to `create_all`.
  Keep the `Optional[...]`/quoted `Relationship()` annotations and Ruff exemptions: modernizing
  these can break SQLAlchemy mapper resolution at the first query, despite a successful import.
- **Identifiers:** DB ids are UUIDv7 strings. Short display ids are **suffixes** via `core/ids.py`,
  not timestamp-heavy prefixes. Never `int()`/`parseInt()` an id or emit an unquoted inline JS id.
  Session APIs also accept synthetic `virt:` recurrence ids; do not reject them as invalid UUIDs.
- **Time:** DB datetimes are naive UTC. Normalize at API/comparison boundaries with `ensure_utc()`
  in `interfaces/api/utils.py`; use `core/timezones.py` for shared local conversions. Statistics
  bucket by local calendar day of session **start**, with explicit week-start context. Do not
  derive a local day by slicing a UTC ISO string.
- **Timers and recurrence:** running timers are file state, not session rows. Route calendar reads
  and occurrence writes through `SessionService` so real rows, virtual projections, and exceptions
  stay consistent. Do not restore bulk pre-generation, resurrect skipped/moved occurrences on task
  edits, or let series-wide operations erase logged history.
- **Tasks:** preserve quick-add title parsing, parent-tag inheritance, and loose `status`/`status_id`
  synchronization in `TaskService`. Forward completion-policy prompts to the caller; never silently
  clear scheduled sessions on completion. Own-session selection and subtree clearing are independent.
- **Analytics:** use `QueryService`/the structured compiler rather than Python full-table aggregation.
  Default multi-tag attribution is fan-out (label overlapping totals); split-evenly is the alternative.
  Do not conflate scheduled/projected time with performed work.
- **AI approval and privacy:** tools propose draft rows only, never real task/session writes.
  Accept/undo/reapply go through `AIDraftService` and the domain services, with stale/conflict checks
  and append-only audit history. Preserve `parse_title_syntax=False` on snapshot restoration.
  Render model text as text, not HTML. Do not log/expose API keys, enable LangSmith tracing, or
  make paid/provider calls with personal data for testing without permission; use fakes.

## Scope guard

Statistics/custom dashboards remain the current focus and now include the query engine, persisted
named dashboards/widgets, optional read-only SQL widgets, and comparison baselines. Review the
sandbox and migration carefully when touching that slice. Recurrence and the AI assistant have
shipped. External integrations are explicitly deferred: do not add Redis, queues, Postgres, OAuth,
or sync groundwork. Multi-user scoping and native clients are not implicit follow-up work. See
`CLAUDE.md` for the detailed agreed ship order.
