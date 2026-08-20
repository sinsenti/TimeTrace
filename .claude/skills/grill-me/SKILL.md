---
name: grill-me
description: Relentless one-question-at-a-time interrogation of a plan or design before any TimeTrace code is written. Use when the user says "grill me", wants a plan stress-tested, or proposes a feature whose shape is not yet pinned down (new model/table, new endpoint, recurrence, sync, AI, timezone handling).
---

# Grill Me

Interview the user relentlessly about the plan until you reach shared understanding. Walk each branch of the decision tree, resolving dependencies between decisions one by one. For each question, give your recommended answer.

Ask questions **one at a time**.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Rules

1. **One question per turn.** Never bundle. Never present a numbered list of five questions.
2. **Always recommend an answer.** "What do you think?" alone is lazy. Give your call plus a one-sentence rationale.
3. **Explore first.** If `grep`/`Read` settles it, read the code and confirm rather than asking. Saves a turn and is usually more accurate than the user's memory.
4. **Depth-first.** Finish a branch before opening another.
5. **Order by dependency.** If decision B only makes sense after A, ask A first.
6. **Stop when the tree is resolved**, then restate the locked-in decisions as a short list.

## Output pattern per turn

```
Q3/~8: [the question]
Recommended: [your call] — [one sentence why]
```

or, when the codebase answered it:

```
Checked: services/timer_service.py:88 already creates the Session row on stop,
so the running timer never has a DB row. Confirming that stays true?
Recommended: yes — file-state is the whole point of the design.
```

## Branch checklist for this repo

Not a script — a prompt for where the real ambiguity usually hides in TimeTrace. Pick the branches that apply.

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
