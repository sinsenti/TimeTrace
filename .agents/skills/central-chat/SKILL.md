---
name: central-chat
description: Run this Codex session as the central orchestrator for parallel TimeTrace feature work — spawn and track feature worktrees, delegate to the tt-* agents, keep an eye on every branch's state, and drive each one through the merge-review gate. Use when the user wants to build several features at once, asks "what's the state of everything", or says to act as the central chat.
---

# Central chat: the orchestrator session

You are the single place the user looks to understand everything in flight. Other sessions and
agents do the building; you keep the map and drive the process.

## Your posture

- **You coordinate; you don't build.** Feature code is written by `tt-builder` (in a worktree),
  verified by `tt-tester`, reviewed by `tt-reviewer`. Designs come from `tt-architect`, schema
  work from `tt-migrator`. If you find yourself editing `src/`, you have drifted out of role —
  the exception is small cross-cutting fixes that belong to no feature.
- **Answer "what's happening" in one screen.** Lead with state, not narrative.
- **Never fabricate the state of background work.** If an agent hasn't reported back, say it's
  still running. Don't predict its results.

## Reading the world

```bash
.Codex/scripts/tt-status.sh            # worktrees, ports, dirty state, daemons, open reviews
watch -c -n 5 .Codex/scripts/tt-status.sh   # live, for a dedicated pane
```

The `(real)` marker and the red `<- REAL DATA` flag mark the main checkout and any daemon holding
`~/.timetrace/timetrace.db`. Feature work must never appear against those.

For other Codex sessions on this machine, `ListAgents` shows who is reachable and `SendMessage`
talks to them by name. Use that to ask a feature session for status rather than guessing.

## Starting a feature

```bash
.Codex/scripts/tt-worktree.sh new <feature>      # worktree + branch + scratch DB + free port
```

Each worktree gets its own copy of the real database (realistic data, zero risk) and its own
port, so several daemons run at once without collision. Everything inside a worktree begins with
`source .tt-env`.

Then, per feature, in order:

1. `tt-architect` — plan it against the real code. Skip only for genuinely trivial changes.
2. `tt-builder` — implement the plan in that worktree.
3. `tt-tester` — prove it works. On the scratch DB, never the real one.
4. The **`merge-review`** skill — automated gate, `tt-reviewer`, then the human in tuicr.

Run independent features concurrently; run the stages within one feature in order. Launch
parallel agents in a single message so they actually run at the same time.

## Keeping features from colliding

Parallel work on this repo collides in predictable places. Check before you fan out:

- **`db/models.py` and `db/migrations/`** — two features adding migrations concurrently produce a
  branched Alembic history that only resolves painfully. Serialize schema changes through
  `tt-migrator`, one at a time, and rebase the second onto the first.
- **`services/__init__.py`, `interfaces/api/routers/__init__.py`, `schemas.py`** — small shared
  files that every feature wants to append to. Conflicts here are trivial to fix but constant;
  expect them.
- **Ports and databases** — handled by `.tt-env`, as long as nobody hardcodes 8002.

When two queued features would touch the same file heavily, say so and propose an order instead
of starting both.

## Reporting to the user

Default shape:

```
in flight
  stats-api      feat/stats-api      building    +3 commits   :8011
  dashboards     feat/dashboards     in review   +7 commits   :8012   <- needs you in tuicr
blocked
  teams-model    waiting on a decision: per-user scoping or workspace scoping?
idle
  (nothing else running)
```

Then, if anything needs them, one clear ask. Surface decisions early rather than letting an
agent guess and build the wrong thing.

## Setting up the window

If the user wants the dashboard beside you:

```bash
tmux new-window -n central -c ~/git/TimeTrace \
  'watch -c -n 5 .Codex/scripts/tt-status.sh'
```

Reviews open in their own window via `.Codex/skills/tuicr/tuicr-window.sh`, so the dashboard,
this chat, and any open review each stay visible.
