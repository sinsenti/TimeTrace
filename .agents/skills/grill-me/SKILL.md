---
name: grill-me
description: Relentless round-based interrogation of a plan or design before any TimeTrace code is written. Use when the user says "grill me", wants a plan stress-tested, or proposes a feature whose shape is not yet pinned down (new model/table, new endpoint, recurrence, sync, AI, timezone handling).
---

# Grill Me

Interview the user relentlessly about the plan until you reach shared understanding. Map the plan as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**, not one question at a time. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask *now* without guessing at answers you haven't heard yet. Ask the whole frontier in one round. A question whose answer depends on another question still open in this round belongs to a *later* round, not this one.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock whatever depended on them. Recompute the frontier and ask the next round.

The session is done when the frontier is empty — every branch of the design tree visited, nothing left silently assumed. Do not act on the plan until the user confirms shared understanding has been reached.

## Rules

1. **Round-based, not one-at-a-time.** Batch the whole current frontier into a single numbered round. Never trickle out one question per turn when more of the frontier is already askable.
2. **Always recommend an answer.** "What do you think?" alone is lazy. Give your call plus a one-sentence rationale, per question.
3. **Facts are your job, never the user's.** If `grep`/`Read` settles a question, go settle it — don't put it in front of the user. When a frontier question needs a fact from the environment (filesystem, code, tools) rather than a judgment call, dispatch exploration for it and don't let it block the rest of the round: ask everything else in the frontier now, and only the questions truly downstream of that fact wait for the next round.
4. **Order by dependency.** Compute the frontier correctly — don't ask B before A if B's phrasing depends on A's answer.
5. **Stop when the tree is resolved**, then restate the locked-in decisions as a short list.

## Output pattern per round

```
❓ **Q1** - **[question title]**: [question body — the ambiguity, and why it matters]

➡️ [your recommended answer] — [one sentence why]

---

❓ **Q2** - **[question title]**: [question body]

➡️ [your recommended answer] — [one sentence why]
```

When the codebase already answers something, don't spend a frontier slot on it — state it and move on:

```
Checked: services/timer_service.py:88 already creates the Session row on stop,
so the running timer never has a DB row. Treating that as settled.
```

## Branch checklist for this repo

Not a script — a prompt for where the real ambiguity usually hides in TimeTrace. Pick the branches that apply; use them to seed the design tree, not as a fixed question order.

**Data shape**
- Does this need a new table/column in `db/models.py`, or can it ride on an existing field? (Every model change costs an Alembic revision.)
- If a column: nullable with a default, or backfilled? SQLite can't alter a column type later without a full table rebuild.
- Is the new id a UUIDv7 string like every other PK, or is it a natural key?

**Layering**
- Which service owns this? (`TaskService`, `SessionService`, `TimerService`, `RevisionService`, `RatingService`, `HabitService`, `AnalyticsService`) — or is it a new one that needs exporting from `services/__init__.py`?
- Is any of it pure enough to live in `core/` with no FastAPI/DB import?

**Time**
- Is this an absolute instant (UTC) or a wall-clock time that should follow the user? The DB stores naive UTC; `session.timezone` exists but is unused.
- Where exactly does `ensure_utc()` get applied — on read, on write, or both?

**Timer interaction**
- Does this touch the running timer? Remember it is file state (`~/.timetrace/active_timer.json`), not a DB row, and the idle loop can retroactively freeze it every 10s.

**Surface**
- Web UI, CLI, or both? Which JS file, which Jinja template?
- New endpoint path — does it get the `/api/` prefix (like `tasks`) or not (like `timer`, `sessions`, `habits`)? The repo is inconsistent; pick deliberately.

**Scope discipline**
- What is explicitly *not* in this change?
- Is any part of this actually a roadmap item (RRULE projection, external sync, Tauri, AI drafts) being smuggled in early?

**Blast radius**
- What breaks if this is wrong? Is the failure mode "wrong number on a chart" or "data loss in the only SQLite file"?
- Is there a pre-change DB backup if it's the latter?
