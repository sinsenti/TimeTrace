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

INLINE_GRAMMAR_EXAMPLE_MD = """# Neovim & Inline Quick Syntax Examples

When you trigger quick actions in Neovim/TUI (a, s, x, m), type 1-2 lines and save (`:x` or `ZZ`):

## 1. Add Task (`a`)
Format: `Title #tags !priority @status`
Example:
  Refactor FastAPI WebSocket pool #backend #async !high @in_progress
  Need to prevent race conditions during reconnect.

## 2. Start Active Timer (`s`)
Format: `Working notes #tags @task_id !pomo_mins`
Example:
  Fixing WebSocket mutex lock #backend @14 !25m

## 3. Post-Session Reflection (`x`)
Format: `[Energy 1-5]/5 habit1, habit2`
Example:
  5/5 water, stretched, focus
  Minor CORS issue on WebSocket handshake.

## 4. Retroactive Session Log (`m`)
Format: `Activity notes #tags -start_ago duration_mins`
Example:
  Reviewed open PRs #review -90m 30m
"""

FULL_EXAMPLES_MARKDOWN = f"""[bold magenta]1. Daily Markdown Log File Template (Importable via :import-md)[/bold magenta]
─────────────────────────────────────────────────────────────────────────────
{DAILY_LOG_EXAMPLE_MD}
─────────────────────────────────────────────────────────────────────────────

[bold cyan]2. Inline Neovim / Buffer Quick Syntax Grammars[/bold cyan]
─────────────────────────────────────────────────────────────────────────────
{INLINE_GRAMMAR_EXAMPLE_MD}
"""
