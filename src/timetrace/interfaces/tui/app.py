import httpx
from typing import Optional, List, Dict, Any
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import Header, Footer, Static, Button, DataTable
from textual.screen import ModalScreen
from textual.reactive import reactive
from textual.binding import Binding

from timetrace.config import settings
from timetrace.core.editor import open_in_nvim

BASE_URL = f"http://{settings.host}:{settings.port}/api/v1"


class StatsModal(ModalScreen):
    BINDINGS = [("escape", "cancel", "Cancel")]

    def __init__(self, summary: List[Dict[str, Any]]):
        super().__init__()
        self.summary = summary

    def compose(self) -> ComposeResult:
        stats_text = "📊 Activity Time Breakdown:\n" + "-" * 35 + "\n"
        if not self.summary:
            stats_text += "No session data logged yet."
        else:
            for item in self.summary:
                stats_text += f"• {item['tag']:<18} : {item['total_hours']:>5} hrs ({item['session_count']} sessions)\n"

        yield Container(
            Static("📊 TimeTrace Statistics & Summary  [dim](Esc to exit)[/dim]", id="modal_title"),
            Static(stats_text, id="stats_content"),
            id="modal_dialog_lg"
        )

    def action_cancel(self) -> None:
        self.dismiss(False)


class TimeTraceTUI(App):
    CSS = """
    #timer_box {
        height: 5;
        border: solid purple;
        content-align: center middle;
        padding: 0 1;
        margin-bottom: 1;
    }
    #timer_display {
        text-style: bold;
    }
    #actions_box {
        height: 3;
        margin-bottom: 1;
    }
    #tasks_table {
        height: 1fr;
        border: solid blue;
    }
    #modal_dialog_lg {
        padding: 1 2;
        background: $surface;
        border: thick $accent;
        width: 68;
        height: 20;
    }
    #modal_title {
        text-style: bold;
        margin-bottom: 1;
    }
    #stats_content {
        margin-bottom: 1;
    }
    """

    BINDINGS = [
        Binding("j", "cursor_down", "Down", show=False),
        Binding("k", "cursor_up", "Up", show=False),
        Binding("a", "add_task_nvim", "Add Task (Nvim)"),
        Binding("e", "edit_task_nvim", "Edit Task (Nvim)"),
        Binding("d", "delete_task", "Delete Task"),
        Binding("s", "start_timer_nvim", "Start (Nvim)"),
        Binding("c", "split_timer_nvim", "Split (Nvim)"),
        Binding("x", "stop_timer_nvim", "Stop/Reflect"),
        Binding("m", "retro_log_nvim", "Retro (Nvim)"),
        Binding("v", "view_stats", "Stats"),
        Binding("r", "refresh_data", "Refresh"),
        Binding("q", "quit", "Quit"),
    ]

    timer_text = reactive("⏸️ Timer Idle")

    def __init__(self):
        super().__init__()
        self.loaded_tasks: List[Dict[str, Any]] = []

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Container(
            Vertical(
                Static(self.timer_text, id="timer_display"),
                id="timer_box"
            ),
            Horizontal(
                Button("Start (S)", variant="success", id="start_btn"),
                Button("Split (C)", variant="warning", id="split_btn"),
                Button("Stop (X)", variant="error", id="stop_btn"),
                Button("Add Task (A)", variant="primary", id="add_btn"),
                Button("Stats (V)", variant="default", id="stats_btn"),
                id="actions_box"
            ),
            DataTable(id="tasks_table"),
        )
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one(DataTable)
        table.add_columns("ID", "Title", "Status", "Description")
        table.cursor_type = "row"
        self.set_interval(1.0, self.update_timer)
        self.set_interval(3.0, self.load_tasks)
        self.call_after_refresh(self.load_tasks)

    def action_cursor_down(self) -> None:
        table = self.query_one(DataTable)
        table.action_cursor_down()

    def action_cursor_up(self) -> None:
        table = self.query_one(DataTable)
        table.action_cursor_up()

    def get_selected_task(self) -> Optional[Dict[str, Any]]:
        table = self.query_one(DataTable)
        if table.row_count == 0 or table.cursor_row is None:
            return None
        try:
            row_data = table.get_row_at(table.cursor_row)
            task_id_str = str(row_data[0])
            if not task_id_str.isdigit():
                return None
            task_id = int(task_id_str)
            return next((t for t in self.loaded_tasks if t["id"] == task_id), None)
        except Exception:
            return None

    async def update_timer(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/timer/status", timeout=2.0)
                if res.status_code == 200:
                    data = res.json()
                    if data["is_running"]:
                        elapsed_min = data["elapsed_seconds"] // 60
                        elapsed_sec = data["elapsed_seconds"] % 60
                        task_title = data.get("task_title") or data.get("tags") or "#session"
                        self.timer_text = f"⏱️ RUNNING: {elapsed_min:02d}:{elapsed_sec:02d} | Task: [{task_title}] Notes: {data.get('notes', '')}"
                    else:
                        self.timer_text = "⏸️ Timer Idle"
        except Exception:
            self.timer_text = "❌ Daemon Disconnected"

        self.query_one("#timer_display", Static).update(self.timer_text)

    async def load_tasks(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/tasks", timeout=2.0)
                if res.status_code == 200:
                    new_tasks = res.json()
                    table = self.query_one(DataTable)
                    table.clear()
                    self.loaded_tasks = new_tasks

                    if not self.loaded_tasks:
                        table.add_row("-", "No tasks found. Press 'A' to create one in Nvim.", "-", "-")
                    else:
                        for task in self.loaded_tasks:
                            table.add_row(
                                str(task["id"]),
                                task["title"],
                                task.get("status", "in_progress"),
                                task.get("description") or ""
                            )
        except Exception:
            pass

    # WORKFLOW: Launch Neovim for Task Creation
    async def action_add_task_nvim(self) -> None:
        template = {
            "title": "ALP-101 New Feature",
            "status": "in_progress",
            "priority": 1,
            "color": "auto"
        }
        initial_notes = "Task description goes here..."

        data = None
        with self.suspend():
            data = open_in_nvim(template, initial_notes)

        if data and data.get("title"):
            try:
                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{BASE_URL}/tasks",
                        json={
                            "title": data["title"],
                            "description": data.get("notes", ""),
                            "status": data.get("status", "in_progress"),
                            "priority": int(data.get("priority", 1)),
                            "color": data.get("color", "auto")
                        },
                        timeout=3.0
                    )
                await self.load_tasks()
            except Exception:
                pass

    # WORKFLOW: Launch Neovim for Task Editing
    async def action_edit_task_nvim(self) -> None:
        task = self.get_selected_task()
        if not task:
            return

        template = {
            "title": task["title"],
            "status": task.get("status", "in_progress"),
            "priority": task.get("priority", 1),
            "color": task.get("color", "auto")
        }
        initial_notes = task.get("description") or ""

        data = None
        with self.suspend():
            data = open_in_nvim(template, initial_notes)

        if data and data.get("title"):
            try:
                async with httpx.AsyncClient() as client:
                    await client.put(
                        f"{BASE_URL}/tasks/{task['id']}",
                        json={
                            "title": data["title"],
                            "description": data.get("notes", ""),
                            "status": data.get("status", "in_progress"),
                            "priority": int(data.get("priority", 1)),
                            "color": data.get("color", "auto")
                        },
                        timeout=3.0
                    )
                await self.load_tasks()
            except Exception:
                pass

    async def action_delete_task(self) -> None:
        task = self.get_selected_task()
        if not task:
            return
        try:
            async with httpx.AsyncClient() as client:
                await client.delete(f"{BASE_URL}/tasks/{task['id']}", timeout=2.0)
            await self.load_tasks()
        except Exception:
            pass

    # WORKFLOW: Launch Neovim to Start Active Timer
    async def action_start_timer_nvim(self) -> None:
        task = self.get_selected_task()
        task_id = task["id"] if task else None

        template = {
            "task_id": task_id if task_id else "none",
            "tags": "#programming #frontend",
            "pomo_minutes": 0
        }
        initial_notes = "What are you working on in this session?"

        data = None
        with self.suspend():
            data = open_in_nvim(template, initial_notes)

        if data:
            raw_task_id = data.get("task_id")
            parsed_task_id = int(raw_task_id) if raw_task_id and str(raw_task_id).isdigit() else None
            pomo_mins = int(data.get("pomo_minutes", 0)) if str(data.get("pomo_minutes", "0")).isdigit() else 0
            mode = "pomodoro" if pomo_mins > 0 else "flowtime"

            try:
                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{BASE_URL}/timer/start",
                        json={
                            "task_id": parsed_task_id,
                            "tags": data.get("tags", "#general"),
                            "notes": data.get("notes", ""),
                            "mode": mode,
                            "target_minutes": pomo_mins if pomo_mins > 0 else None
                        },
                        timeout=3.0
                    )
                await self.update_timer()
            except Exception:
                pass

    # WORKFLOW: Launch Neovim for Timer Split
    async def action_split_timer_nvim(self) -> None:
        template = {
            "new_tags": "#documentation #api"
        }
        initial_notes = "Notes for switched activity..."

        data = None
        with self.suspend():
            data = open_in_nvim(template, initial_notes)

        if data:
            try:
                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{BASE_URL}/timer/split",
                        json={
                            "new_tags": data.get("new_tags", "#general"),
                            "new_notes": data.get("notes", "")
                        },
                        timeout=3.0
                    )
                await self.update_timer()
            except Exception:
                pass

    # WORKFLOW: Stop Timer and Reflection via Neovim
    async def action_stop_timer_nvim(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post(f"{BASE_URL}/timer/stop", timeout=3.0)
                if res.status_code == 200:
                    session_data = res.json()
                    
                    template = {
                        "session_id": session_data["id"],
                        "energy_level": 5,
                        "habits": ["Drank Water", "Focus Maintained"]
                    }
                    initial_notes = "Obstacles / Distractions faced..."

                    data = None
                    with self.suspend():
                        data = open_in_nvim(template, initial_notes)

                    if data:
                        await client.post(
                            f"{BASE_URL}/reflections",
                            json={
                                "session_id": session_data["id"],
                                "energy_level": int(data.get("energy_level", 3)),
                                "obstacles": data.get("notes", ""),
                                "habits_completed": data.get("habits", []) if isinstance(data.get("habits"), list) else []
                            },
                            timeout=3.0
                        )
            await self.update_timer()
        except Exception:
            pass

    # WORKFLOW: Retroactive Log via Neovim
    async def action_retro_log_nvim(self) -> None:
        from datetime import datetime, timedelta, timezone

        template = {
            "start_mins_ago": 120,
            "duration_mins": 45,
            "tags": "#programming"
        }
        initial_notes = "Past activity description..."

        data = None
        with self.suspend():
            data = open_in_nvim(template, initial_notes)

        if data:
            try:
                start_ago = int(data.get("start_mins_ago", 60))
                dur_mins = int(data.get("duration_mins", 30))
                tags = data.get("tags", "#general")
                notes = data.get("notes", "")

                end_dt = datetime.now(timezone.utc) - timedelta(minutes=(start_ago - dur_mins))
                start_dt = end_dt - timedelta(minutes=dur_mins)

                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{BASE_URL}/sessions/retro",
                        json={
                            "start_time": start_dt.isoformat(),
                            "end_time": end_dt.isoformat(),
                            "tags": tags,
                            "notes": notes
                        },
                        timeout=3.0
                    )
            except Exception:
                pass

    async def action_view_stats(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/analytics/summary", timeout=2.0)
                if res.status_code == 200:
                    summary = res.json()
                    self.push_screen(StatsModal(summary=summary))
        except Exception:
            pass

    def action_refresh_data(self) -> None:
        self.run_worker(self.load_tasks())
        self.run_worker(self.update_timer())

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "start_btn":
            self.run_worker(self.action_start_timer_nvim())
        elif event.button.id == "split_btn":
            self.run_worker(self.action_split_timer_nvim())
        elif event.button.id == "stop_btn":
            self.run_worker(self.action_stop_timer_nvim())
        elif event.button.id == "add_btn":
            self.run_worker(self.action_add_task_nvim())
        elif event.button.id == "stats_btn":
            self.run_worker(self.action_view_stats())

