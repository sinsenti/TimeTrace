# ⏱️ TimeTrace

**TimeTrace** is an open-source, local-first time management and productivity engine built for developers.

## ✨ Features
- 🚀 **Local-First Daemon:** Single background service powering all clients via REST & WebSockets.
- 💻 **Terminal Native:** Fast CLI subcommands & rich interactive TUI (`Textual`).
- 📅 **Visual Web Calendar:** Drag-and-drop task timeboxing (Google Calendar style).
- 🧠 **Post-Session Reflections:** Track qualitative metrics like energy level (1–5) and habits.
- 📝 **Markdown Sync:** Native `.md` log import/export support.
- 🔌 **Integrations:** Designed for Tmux and Neovim (`chronopulse.nvim`).

## 🛠️ Tech Stack
- **Language:** Python 3.11+
- **Daemon:** FastAPI + Uvicorn
- **Storage:** SQLite + SQLModel
- **CLI/TUI:** Typer + Textual

## 🚀 Quick Start
```bash
# Install dependencies
pip install -e .

# Run the TUI
timetrace
