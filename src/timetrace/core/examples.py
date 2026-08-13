"""Embedded Markdown examples and templates for TimeTrace."""

DAILY_LOG_EXAMPLE_MD = """---
date: 2026-08-11
generated_by: TimeTrace
total_sessions: 3
---

# Logged Sessions
- [09:00 - 11:30] | #programming #backend | Refactored FastAPI WebSocket connection pool
  - Energy: 5/5
  - Obstacles: None
  - Habits: Drank Water, Stretched

- [13:00 - 14:15] | #review #github | Reviewed open PRs and merged documentation updates
  - Energy: 4/5
  - Obstacles: Minor CI pipeline timeout

- [15:00 - 17:00] | #frontend #tui | Implemented Textual custom modals and shortcuts
  - Energy: 3/5
  - Habits: Drank Water

# Daily Reflection
Productive focus block in the morning. Afternoon session faced a slight dip in energy.
"""

INLINE_GRAMMAR_EXAMPLE_MD = """# Neovim & Inline Quick Syntax Examples (With Shorthand Aliases)

When you trigger quick actions in Neovim/TUI (a, s, x, m), type 1-2 lines and save (`:x` or `ZZ`):

## 1. Add Task (`a`)
Format: `Title #tags !priority @status`
Shorthands:
  - Priority: !high (!h) | !medium (!m) | !low (!l) | !-
  - Status:   @in_progress (@ip) | @ongoing (@og) | @completed (@c / @done)
Examples:
  Refactor FastAPI WebSocket pool #backend !h @ip
  Project(a1labs) #progr #work !m @og

## 2. Start Active Timer (`s`)
Format: `Working notes #tags @task_id !pomo_mins`
Examples:
  Fixing WebSocket mutex lock #backend @14 !25m
  Code review for API router #review !15m

## 3. Post-Session Reflection (`x`)
Format: `[Energy 1-5]/5 habit1, habit2`
Example:
  5/5 water, stretched, focus
  Minor CORS issue on WebSocket handshake.

## 4. Retroactive Session Log (`m`)
Format: `Activity notes #tags @task_id -start_ago duration_mins`
Examples:
  Reviewed open PRs #review @12 -90m 30m
  Team sync meeting #meeting -2h 45m
"""

FULL_EXAMPLES_MARKDOWN = f"""[bold magenta]1. Daily Markdown Log Template (Import via :import-md)[/bold magenta]
─────────────────────────────────────────────────────────────────────────────
{DAILY_LOG_EXAMPLE_MD}
─────────────────────────────────────────────────────────────────────────────

[bold cyan]2. Inline Neovim / Buffer Quick Syntax Grammars & Shorthands[/bold cyan]
─────────────────────────────────────────────────────────────────────────────
{INLINE_GRAMMAR_EXAMPLE_MD}
"""
