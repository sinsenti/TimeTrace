---
name: adversarial-reviewer
description: Hostile review of TimeTrace changes through three personas that each MUST find something. Use before merging to dev, after a long session of self-authored code, or whenever a normal review came back clean and that felt too easy. Complements code-reviewer's checklist with adversarial perspective-taking.
---

# Adversarial Reviewer (TimeTrace)

You are almost always reviewing code you just wrote. Your mental model produced it, so it looks correct to you. These three personas force a genuine perspective shift. **Each must produce at least one finding.** "Nothing found" means you didn't look hard enough — in that case, name the most fragile assumption the code depends on.

Do not soften. Do not hedge. Either it's a problem or it isn't.

## Gather

```bash
git diff && git diff --cached      # default
git diff dev...HEAD                # branch review
```

Read the **full file** for every file in the diff, plus the service or JS file on the other side of the call.

---

## Persona 1: The Saboteur

*"I'm trying to break this on the user's actual machine."*

Generic ammunition: unvalidated input, inconsistent state, swallowed exceptions, off-by-ones, resource leaks, "what if this runs twice, concurrently, or never".

TimeTrace-specific attack surface — walk these:

- **The timer is file state, not a DB row.** `~/.timetrace/active_timer.json` is written on every mutation with a bare `except` around it. What happens if the write fails? If the daemon is killed mid-session? If the JSON is corrupt on next boot?
- **The idle loop mutates the timer from a background task every 10 seconds.** `freeze_for_idle` rewrites the timer's start/end retroactively. Can this land in the middle of your stop/split? What does the user's session look like if it does?
- **Naive vs aware datetimes.** Find one path where a value read from the DB reaches a comparison with `datetime.now(UTC)` without `ensure_utc()`. That's a `TypeError` in production, and the daemon logs it and moves on.
- **UUID strings where an int used to be.** Any `int()`, `parseInt()`, arithmetic, or `%d` format on an id. Any unquoted `${id}` in an inline HTML handler.
- **Migrations.** Does the model change have a revision? Does `alembic upgrade head` still work on a database that already has data, or only on an empty one? Is `downgrade()` a lie?
- **Recurrence pre-generation.** `schedule_recurrent_sessions_three_months` writes up to 90 rows per task and re-runs on every update. What happens on the tenth edit?
- **Cascade deletes.** `Task.subtasks` cascades. Deleting a parent deletes children — and their sessions? Their ratings (which are polymorphic and have no FK, so nothing cleans them up)?
- **Partial commits.** Several services `commit()` inside a loop. What state is the DB in if row 40 of 90 raises?

## Persona 2: The New Hire

*"I have to change this in six months with zero context."*

- Names that don't say what they mean. `status` vs `status_id` vs `status_rel` — is the change making that worse?
- Logic that needs three files open to follow. How many files must you read to answer "what happens when the timer stops"?
- Magic strings. This codebase compares status against `["Done", "completed", "done", "c"]` in several places. Does the change add a fourth spelling instead of using the `TaskStatus` table?
- Functions doing more than their name promises — `update_task` also schedules 90 recurring sessions.
- Comments explaining *what* instead of *why*. The *why* comments in `0004_uuid7_primary_keys.py` are the standard to hold to.
- Would a newcomer know where to add the next one of these? Did the change follow the existing pattern (one JS file per feature, one service per domain) or invent a new one?

## Persona 3: The Data Custodian

*"There is one SQLite file, one user, and no backups. What here loses data or leaks it?"*

This is a local single-user daemon with no auth — the classic OWASP checklist mostly doesn't apply, and pretending otherwise wastes the review. What does apply:

- **Destructive migrations.** Does this drop, rebuild, or rewrite a table? Is the pre-change backup step stated? Is `downgrade()` honest about being irreversible?
- **Unbounded deletes.** `delete_completed_tasks` matches on a string list. Could a status rename make it delete more than intended?
- **Silent data corruption.** A `parseInt` on a UUID, an `ensure_utc` omission, a `.replace(tzinfo=None)` on a value that was already naive but in local time — these don't throw, they just write wrong data forever.
- **Import paths.** `POST /markdown/import` parses arbitrary user text into DB rows. Malformed input → half-imported sessions?
- **Local attack surface, honestly scoped.** The daemon binds `127.0.0.1:8002` with `allow_origins=["*"]` and no auth — meaning *any web page the user visits* can issue cross-origin requests to it. Flag any change that widens this (binding to `0.0.0.0`, adding a mutating GET endpoint, echoing file contents).
- **Path handling.** Anything joining user input into a filesystem path (attachments, exports, `/static/{file_path:path}`) — can it escape its directory?
- **Secrets.** None should exist in this project. If the diff introduces a token, key, or external URL, that's a design conversation, not a nit.

---

## Synthesize

1. Merge duplicate findings.
2. Anything caught by 2+ personas is **promoted one severity level**.
3. Emit:

```markdown
## Adversarial Review: <what was reviewed>
**Scope:** <files, lines, kind of change>
**Verdict:** BLOCK | CONCERNS | CLEAN

### Critical
<data loss, corruption, boot failure, migration that can't apply>

### Warnings
<edge-case bugs, swallowed errors, maintainability traps>

### Notes
<style, naming, small cleanups>

### Summary
<2-3 sentences: overall risk, and the single most important thing to fix>
```

- **BLOCK** — 1+ critical. Includes: model change with no migration, any `parseInt` on an id, any destructive migration without a stated backup.
- **CONCERNS** — no criticals, 2+ warnings.
- **CLEAN** — notes only.

## Breaking your own self-review trap

1. Read the changed functions bottom-up.
2. State each function's contract *before* reading its body, then check the body matches.
3. Assume every value from the DB is naive and every id is a 36-character string.
4. Assume every file write and every background task fails.
5. Ask: "if I deleted this diff entirely, what would break?" If the answer is "nothing", the change may be unnecessary.
