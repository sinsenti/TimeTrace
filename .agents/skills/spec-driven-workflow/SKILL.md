---
name: spec-driven-workflow
description: Write a short spec before building a TimeTrace feature - what it does, which layer owns each piece, what the schema/API change is, and what is explicitly out of scope. Use for anything touching db/models.py, adding an endpoint plus UI, or any change big enough that "just start coding" would mean guessing at product decisions.
---

# Spec-Driven Workflow (TimeTrace)

Write down what you're building before you build it. Not a document for a review board — a one-page contract that makes the design decisions explicit so they can be argued with cheaply, and so the diff has something to be checked against.

## When this is worth it

**Yes:** anything that changes `db/models.py`; a feature spanning model → service → router → JS; anything that changes existing data semantics; anything the user is likely to have opinions about.

**No:** a bug fix, a copy change, a refactor with no behavior change, or anything where writing the spec takes longer than the change. Say "this doesn't need a spec" and get on with it.

## Where specs live

`specs/<feature>.md`, in the repo, in the same branch as the implementation. The checked-in
[`specs/README.md`](../../../specs/README.md) describes the directory and status lifecycle.

## The template

Keep it to one screen. Sections that don't apply get `N/A — <reason>` so a reader knows it was considered.

```markdown
# <Feature name>
Status: Draft | Approved | Built
Date: YYYY-MM-DD

## Problem
2-4 sentences. What is annoying today, with a concrete example from actual use.

## Behavior
Numbered, testable statements. MUST / SHOULD / WON'T.
1. MUST — <observable behavior>
2. MUST — <observable behavior>
3. SHOULD — <nice-to-have, may slip>

## Data
Schema changes to db/models.py, or "no schema change".
- `session.foo: str | None` — nullable, default None
- Migration: rebuild required? (SQLite can't alter a column type — see database-designer)
- Backfill: what happens to existing rows?

## Layers
Where each piece lives, before writing any of it.
- core/     : <pure logic, or none>
- services/ : <which service, which methods>
- routers/  : <method + path, status codes>
- schemas.py: <new request/response models>
- static/js/: <which file>
- CLI       : <command, or none>

## Time and ids
- Is any new datetime an absolute instant (naive UTC in DB) or a wall-clock local time?
- Where does ensure_utc() get applied?
- Any new id: UUIDv7 string like everything else? Any polymorphic reference?

## Edge cases
- What if the timer is running / frozen for idle when this happens?
- What if the referenced task is deleted?
- What does the empty state look like?
- What happens on the second run (idempotent)?

## Out of scope
Explicit exclusions, with reasons. This is the section that stops scope creep.
- <thing> — deferred, needs the RRULE engine
- <thing> — roadmap item, not now

## Verification
How you'll know it works. Concretely.
- uv run ruff check . clean
- migration applies to a copy of the real DB, foreign_key_check empty
- curl <endpoint> returns <shape>
- <page> renders <thing> with no console errors
```

## Flow

1. **Gather.** Read the existing code first — half the "requirements" are already answered by `services/` or an existing column. If real ambiguity remains, use the `grill-me` skill: one question at a time, with a recommendation.
2. **Write the spec.** Every numbered behavior must be checkable by looking at something. "Feels responsive" is not a behavior; "the kanban column updates without a page reload" is.
3. **Get it approved.** For a solo local project this means: show it, get a yes. Don't start on a Draft.
4. **Build behavior by behavior.** MUST items in order, simplest first. Add a focused regression test for each behavior change using the existing suite; see `tdd-guide`.
5. **Check the diff against the spec** before calling it done — every MUST satisfied, nothing from Out of Scope built.

## Stop and ask when

- The implementation needs something not in the spec. Even if it's obviously needed. It may have been excluded on purpose.
- The change would alter what an existing number *means* (e.g. narrowing analytics to 14 days changes every total on the dashboard).
- The change would rewrite or drop existing rows.
- More than ~30% of a behavior statement is guesswork.

When you stop, present options and a recommendation — never an open question:

```
Blocked on: behavior 3
Question: should a completed recurring task's future pre-generated sessions be deleted or kept?
  A. Delete — matches "done means done", but loses a scheduled calendar view
  B. Keep and mark — more information, more state to maintain
Recommendation: A, with a confirm prompt. Impact of waiting: behaviors 3-5 blocked.
```

## Anti-patterns

| Symptom | Why it's wrong |
|---|---|
| Spec written after the code | That's documentation. It can't catch a design error in a design that's already frozen. |
| "The system should work well" | Untestable. Rewrite as something observable. |
| Nine sections of ceremony for a two-line change | The spec should be cheaper than the mistake it prevents. |
| No Out of Scope section | Guarantees the feature grows during implementation. |
| Data section says "add a column", no migration line | SQLite constraints decide whether this is a five-line migration or a table rebuild. Decide before building. |
| Spec quietly includes a roadmap item | RRULE projection, external sync, Tauri, AI drafts are *intent*, not this feature. |
