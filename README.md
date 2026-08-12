# TimeTrace

**TimeTrace** is an open-source, local-first time management and productivity engine built for developers. It unifies **CLI/TUI terminal workflows**, a **visual calendar dashboard**, **revision retrospectives**, **habit tracking**, **custom evaluation ratings**, and **plain-text Markdown syncing** through a single local background daemon running at `http://127.0.0.1:8002`.

---

## ✨ Features

- 🚀 **Local-First Daemon**: Single FastAPI background service (port **8002**) powering CLI, TUI, Web UI, and Tmux integration.
- 💻 **Terminal-First Workflow**: Fast CLI subcommands (`timetrace start`, `split`, `retro`, `summary`) and a Textual-powered interactive TUI.
- 📅 **Dynamic Calendar Dashboard**: Drag-and-drop schedule management with view-switching (**Day**, **3-Day**, **Week**, **Month**), auto-scrolling, and range totals.
- 🔄 **Revision & Retrospective Engine**: Review past days with structured **Highlights** and **Daily Friction** reflections, task post-mortems, and session timeline inspections.
- ⚡ **Per-Item & Per-Rating Dismissal**: Option to dismiss entire day/session reviews or individually dismiss custom rating metrics.
- 📊 **Habit Tracker Matrix**: 14-day interactive grid for tracking daily habits (Boolean checkmarks or numeric metrics) with consistency doughnut charts.
- 📈 **Custom Rating Scales**: Define custom evaluation metrics (1–5 or 1–10 ranges, essential/optional) for sessions, tasks, and days.
- 💤 **AFK / Idle Detection**: Automatically freezes running timers during 10 minutes of inactivity and provides an AFK resolution modal (Discard, Log as Break, Claim Work, or Re-tag).
- ⌨️ **Vim Navigation & Clean UI**: Navigation shortcuts (`h`/`j`/`k`/`l`, `v`, `i`, `o`, `x`), compact single-line modal controls with micro shortcut badges (`Ctrl+↵`, `Esc`), and toggleable UI sidebars.
- 📝 **Markdown Sync Engine**: Bidirectional import and export of structured `.md` log files with YAML frontmatter.

---

## 🛠️ Tech Stack

| Component | Technology |
| :--- | :--- |
| **Language** | Python 3.11+ |
| **Daemon Engine** | FastAPI + Uvicorn (Port 8002) |
| **Database** | SQLite (`~/.timetrace/timetrace.db`) + SQLModel |
| **Terminal UI (TUI)** | Textual |
| **CLI Framework** | Typer + HTTPX |
| **Web UI** | FullCalendar.js + Tailwind CSS + Chart.js |
| **Frontend API Layer** | Centralized `ApiClient` |

---

## 🚀 Quick Start

### 1. Installation

```bash
git clone [https://github.com/your-username/timetrace.git](https://github.com/your-username/timetrace.git)
cd timetrace

python3 -m venv .venv
source .venv/bin/activate
pip install -e .

```

### 2. Start the Daemon

```bash
timetrace daemon

```

*Runs locally at `http://127.0.0.1:8002/*`

### 3. Usage Modes

* **Web Dashboard**: Open `http://127.0.0.1:8002/` in your browser.
* **Interactive TUI**: Run `timetrace` in a new terminal tab.
* **CLI Commands**: Use subcommands like `timetrace start -t "#programming"` or `timetrace summary`.

---

## 💻 CLI Command Reference

| Command | Usage | Description |
| --- | --- | --- |
| `timetrace daemon` | `timetrace daemon` | Start the local background service on port 8002 |
| `timetrace` | `timetrace` | Launch the interactive Terminal UI (TUI) |
| `timetrace start` | `timetrace start -t "#tags" -n "notes"` | Start active timer |
| `timetrace split` | `timetrace split -t "#newtag" -n "notes"` | Save active session and start new one immediately |
| `timetrace stop` | `timetrace stop` | Stop active timer and save session |
| `timetrace retro` | `timetrace retro -s 120 -d 45 -t "#tags"` | Retroactively log a past session |
| `timetrace summary` | `timetrace summary` | View time totals grouped by `#tags` |
| `timetrace status` | `timetrace status [--tmux]` | Check timer state or output Tmux bar string |
| `timetrace task` | `timetrace task "Title" -p 1 -e 60` | Create a new task slot |

---

## 📝 Markdown Log Format

TimeTrace exports and imports daily markdown logs structured as follows:

```markdown
---
date: 2026-08-10
generated_by: TimeTrace
total_sessions: 2
---

# Logged Sessions
- [08:00 - 09:30] | #programming | Core FastAPI Daemon Refactoring
  - Highlights: Modular router architecture, sub-second API responses
  - Friction: Intermittent SQLite constraint issues
- [10:00 - 11:15] | #tui | Configured Vim Navigation Bindings
  - Highlights: Smooth h/j/k/l grid navigation


```

---

## 📄 License

Distributed under the [MIT License](https://www.google.com/search?q=LICENSE).

