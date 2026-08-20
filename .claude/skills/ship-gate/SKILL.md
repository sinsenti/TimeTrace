---
name: ship-gate
description: The mechanical pre-merge verification for a TimeTrace branch - ruff clean, JS parses, migrations apply cleanly to a COPY of the real database, and the daemon boots and serves /health on that copy. Use before merging to dev, before saying a change is done, or whenever a diff touches db/models.py or db/migrations/.
---

# Ship Gate (TimeTrace)

The automated half of the pre-merge gate. Run this **before** involving the human — their review time is for design judgement, not for things a command could have caught.

This skill verifies. It does not merge. The `merge-review` skill owns the full flow (this gate → adversarial agent pass → human review in tuicr → merge to `dev`); the human review is not optional and green checks here are not permission to merge.

## The four checks

| # | Check | Blocking |
|---|---|---|
| 1 | `uv run ruff check .` — no **new** violations | yes |
| 2 | Every changed `.js` file parses | yes |
| 3 | Migrations apply to a **copy** of the real DB, `PRAGMA foreign_key_check` empty, row counts preserved | yes, if `db/` changed |
| 4 | Daemon boots against that copy and `/health` returns ok | yes |

## Run it

```bash
.claude/skills/ship-gate/ship-gate.sh            # against dev
.claude/skills/ship-gate/ship-gate.sh main       # against another base
```

Or by hand, which is worth doing at least once so you know what the script does:

```bash
# 1. lint
uv run ruff check .

# 2. JS syntax (catches the unquoted-UUID-in-onclick class of bug)
for f in $(git diff --name-only dev...HEAD -- '*.js'); do node --check "$f"; done

# 3. migrations against a COPY - never the real file
cp ~/.timetrace/timetrace.db /tmp/tt-gate.db
TIMETRACE_DB_FILE=/tmp/tt-gate.db uv run timetrace db migrate
sqlite3 /tmp/tt-gate.db "PRAGMA foreign_key_check;"                  # must print nothing
sqlite3 ~/.timetrace/timetrace.db "SELECT COUNT(*) FROM task;"        # compare
sqlite3 /tmp/tt-gate.db          "SELECT COUNT(*) FROM task;"         # ...to this

# 4. daemon boots and serves, on a scratch port and the scratch DB
TIMETRACE_DB_FILE=/tmp/tt-gate.db TIMETRACE_PORT=8099 uv run timetrace daemon &
sleep 3 && curl -s localhost:8099/health && kill %1
```

## Rules that are not negotiable

**Never run a migration against `~/.timetrace/timetrace.db` to "see if it works."** It is the user's only copy of their data, it has no automatic backup, and `0004_uuid7_primary_keys.py` demonstrates that a `downgrade()` may be impossible by design. Always a copy. If the migration must eventually touch the real database, take a dated backup into `~/.timetrace/backups/` first.

**Never boot the gate daemon on port 8002 or the real DB file.** The user's daemon may be running; two processes on one SQLite file plus a live timer file is how you corrupt state. Use `TIMETRACE_PORT` and `TIMETRACE_DB_FILE`.

**Never `git push` or open a PR from this gate.** Those stay explicitly user-initiated.

## Reading the results

**Ruff:** the repo has pre-existing violations on files nobody has touched. Compare against the base branch rather than demanding a globally clean tree:

```bash
uv run ruff check . --output-format=concise | sort > /tmp/after.txt
git stash && uv run ruff check . --output-format=concise | sort > /tmp/before.txt && git stash pop
comm -13 /tmp/before.txt /tmp/after.txt        # violations this branch introduced
```

Anything in that output is blocking. Fix with `uv run ruff check --fix .`, then re-run.

**Migrations:** these are the failures to expect, and what they mean:
- `Can't locate revision identified by '...'` — `down_revision` doesn't chain onto the real head, or a revision file is missing.
- `no such column` at boot — `db/models.py` changed without a migration. Blocking, always.
- `index ... already exists` in a table rebuild — the old index is still attached to the renamed `<table>_old`. Drop it first (see `database-designer`).
- Non-empty `foreign_key_check` — the rebuild lost or mis-mapped a reference. Blocking.
- Row counts differ from the original — data was dropped. Blocking, and investigate before doing anything else.

**Daemon boot:** the boot itself runs `alembic upgrade head` (`run_migrations()` in `db/session.py`), and it no longer swallows failures, so a boot failure is a real migration failure. If `/health` never answers, read the daemon's stdout — the exception is there.

### Two things to know before you trust check 3

- **`TIMETRACE_DB_FILE` is the only way to redirect Alembic.** `db/migrations/env.py` hardcodes `get_url()` to `settings.database_url`, overwriting anything set via `alembic.ini`, `-x`, or `set_main_option`. That's why the gate uses `TIMETRACE_DB_FILE=... uv run timetrace db migrate` and not a bare `alembic` invocation — get this wrong and you migrate the user's real database while believing you're on a copy.
- **From-scratch bootstrap is broken today, for a pre-existing reason.** With no `~/.timetrace/timetrace.db` to copy, the gate migrates an empty database, which currently fails at `0002_add_task_statuses_and_subtasks` (`sa.func.now()` in a `DateTime` bulk-insert → `TypeError`). If check 3 fails that way on an empty DB, it is not your branch's fault — say so, and don't "fix" it inside a feature diff. Migrating a copy of a real database, which is already past 0002, works fine.

## Report

```
SHIP GATE — feat/<branch>
  [1] ruff             PASS  (0 new violations)
  [2] js syntax        PASS  (2 files checked)
  [3] migrations       PASS  (0003 -> 0005 on copy; task 412 -> 412, session 8801 -> 8801; fk_check empty)
  [4] daemon /health   PASS  (port 8099, scratch DB)

VERDICT: READY FOR REVIEW
```

Verdicts: **READY FOR REVIEW** (all pass — hand to `merge-review`), **BLOCKED** (any failure; fix and re-run). There is no "ship with caution" here — the gate is four mechanical checks and they either pass or they don't.

## What this gate deliberately does not check

Not out of laziness — these don't apply to a local-first single-user daemon, and pretending otherwise produces noise:

- Secrets scanning, auth coverage, HTTPS, CSRF, RLS — no auth, no server, no cloud.
- `npm audit` / dependency CVEs — nine Python deps, no npm.
- Bundle size, SSR, OG tags, analytics — no build step, no public site.
- Load tests, rate limits, error budgets — one user, localhost.
- Docker, Kubernetes, staging environments, rollback plans — none exist. Rollback is `git` plus the DB backup.

If you want a *judgement* pass rather than a mechanical one, that's the `adversarial-reviewer` and `code-reviewer` skills. This gate only answers: does it lint, does it parse, does the schema migrate without losing data, does it boot.
