# TimeTrace

**TimeTrace** is an open-source, local-first time management and productivity engine built for developers. It unifies **CLI/TUI terminal workflows**, a **visual calendar dashboard**, **qualitative post-session reflections**, and **plain-text Markdown syncing** through a single local background daemon.

---

## ✨ Features

- 🚀 **Local-First Daemon**: Single FastAPI background service powering all clients (CLI, TUI, Web UI, Tmux, Neovim).
- 💻 **Terminal-First Workflow**: Fast CLI subcommands (`timetrace start`, `split`, `retro`, `summary`) and a `tuicr`-inspired interactive TUI (`Textual`).
- 📅 **Dynamic Calendar Dashboard**: Drag-and-drop schedule management with dynamic view view-switching (**Day**, **Week**, **Month**) and synchronized range totals.
- 🎨 **Custom Task Slots**: Create, edit, recolor, and delete task cards with progress status tags (`in progress`, `ongoing`, `completed`).
- 🧠 **Post-Session Reflections**: Capture qualitative effort data after every session (Energy level 1–5, obstacles faced, habits completed).
- 📊 **Activity & Tag Observability**: Aggregate tracked hours by activity (`#programming`, `#design`) and view real-time tab titles in your browser window (`⏱️ 00:24:15 - [Task Name] (#tags)`).
- 📝 **Markdown Sync Engine**: Bidirectional import and export of structured `.md` log files with YAML frontmatter.
- 🔌 **Tmux & Editor Ready**: Status bar string formatter (`timetrace status --tmux`) and Lua hooks for Neovim.

---

## 🛠️ Tech Stack

| Component | Technology |
| :--- | :--- |
| **Language** | Python 3.11+ |
| **Daemon Engine** | FastAPI + Uvicorn |
| **Database** | SQLite + SQLModel (SQLAlchemy + Pydantic v2) |
| **Terminal UI (TUI)** | Textual |
| **CLI Framework** | Typer + HTTPX |
| **Web UI** | FullCalendar.js + Tailwind CSS |
| **Markdown Parser** | `python-frontmatter` |

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

*Runs locally at `http://127.0.0.1:8000/*`

### 3. Usage Modes

* **Web Dashboard**: Open `http://127.0.0.1:8000/` in your browser.
* **Interactive TUI**: Run `timetrace` in a new terminal tab.
* **CLI Commands**: Use subcommands like `timetrace start -t "#programming"` or `timetrace summary`.

---

## 💻 CLI Command Reference

| Command | Usage | Description |
| --- | --- | --- |
| `timetrace daemon` | `timetrace daemon` | Start the local background service |
| `timetrace` | `timetrace` | Launch the interactive Terminal UI (TUI) |
| `timetrace start` | `timetrace start -t "#tags" -n "notes" -k 1` | Start active timer |
| `timetrace split` | `timetrace split -t "#newtag" -n "new notes"` | Save active session and start new one immediately |
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
- [08:00 - 09:30] | #programming | Core FastAPI Daemon Setup
  - Energy: 5/5
  - Obstacles: None
- [10:00 - 11:15] | #tui | Configured Textual Keybindings
  - Energy: 4/5

```

---

## 📄 License

Distributed under the [MIT License](https://www.google.com/search?q=LICENSE).

