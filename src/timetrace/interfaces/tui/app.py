import httpx
from datetime import datetime, timezone
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
    #filter_status_bar {
        height: 1;
        background: $boost;
        color: $text-muted;
        padding: 0 1;
        margin-bottom: 1;
        text-style: italic;
    }
    #main_table {
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
        Binding("t", "toggle_view_mode", "Toggle View (t)"),
        Binding("j", "cursor_down", "Down", show=False),
        Binding("k", "cursor_up", "Up", show=False),
        Binding("a", "add_task_nvim", "Add Task"),
        Binding("e", "edit_item_nvim", "Edit Item"),
        Binding("f", "cycle_filter", "Filter (f)"),
        Binding("o", "cycle_sort", "Sort (o)"),
        Binding("d", "delete_item", "Delete Row"),
        Binding("D", "clear_completed", "Clear Completed"),
        Binding("s", "start_timer_nvim", "Start Timer"),
        Binding("c", "split_timer_nvim", "Split Timer"),
        Binding("x", "stop_timer_nvim", "Stop/Reflect"),
        Binding("m", "retro_log_nvim", "Retro Log"),
        Binding("v", "view_stats", "Stats"),
        Binding("r", "refresh_data", "Refresh"),
        Binding("q", "quit", "Quit"),
    ]

    timer_text = reactive("⏸️ Timer Idle")
    status_bar_text = reactive("Mode: TASKS | Filter: ALL | Sort: PRIORITY")
    view_mode = reactive("tasks")  # "tasks" or "sessions"

    def __init__(self):
        super().__init__()
        self.loaded_tasks: List[Dict[str, Any]] = []
        self.loaded_sessions: List[Dict[str, Any]] = []
        self.filter_modes = ["all", "hide_completed", "in_progress", "ongoing", "completed"]
        self.filter_index = 0
        self.sort_modes = ["priority", "created_at", "title", "status"]
        self.sort_index = 0

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Container(
            Vertical(
                Static(self.timer_text, id="timer_display"),
                id="timer_box"
            ),
            Horizontal(
                Button("View: TASKS (T)", variant="primary", id="view_toggle_btn"),
                Button("Start (S)", variant="success", id="start_btn"),
                Button("Split (C)", variant="warning", id="split_btn"),
                Button("Stop (X)", variant="error", id="stop_btn"),
                Button("Add (A)", variant="default", id="add_btn"),
                Button("Filter (F)", variant="default", id="filter_btn"),
                Button("Sort (O)", variant="default", id="sort_btn"),
                Button("Clear Done (D)", variant="error", id="clear_btn"),
                id="actions_box"
            ),
            Static(self.status_bar_text, id="filter_status_bar"),
            DataTable(id="main_table"),
        )
        yield Footer()

    def on_mount(self) -> None:
        self.setup_table_columns()
        self.set_interval(1.0, self.update_timer)
        self.set_interval(3.0, self.load_current_view)
        self.call_after_refresh(self.load_current_view)

    def setup_table_columns(self) -> None:
        table = self.query_one("#main_table", DataTable)
        table.clear(columns=True)
        table.cursor_type = "row"
        if self.view_mode == "tasks":
            table.add_columns("ID", "Title", "Status", "Priority", "Start/Created", "Description")
        else:
            table.add_columns("ID", "Tags", "Start Time", "End Time", "Duration (m)", "Notes")

    def action_toggle_view_mode(self) -> None:
        self.view_mode = "sessions" if self.view_mode == "tasks" else "tasks"
        btn = self.query_one("#view_toggle_btn", Button)
        btn.label = f"View: {self.view_mode.upper()} (T)"
        btn.variant = "primary" if self.view_mode == "tasks" else "warning"
        self.setup_table_columns()
        self.update_status_label()
        self.run_worker(self.load_current_view())

    def update_status_label(self) -> None:
        v_mode = self.view_mode.upper()
        f_mode = self.filter_modes[self.filter_index].upper()
        s_mode = self.sort_modes[self.sort_index].upper()
        self.status_bar_text = f"📱 VIEW: [{v_mode}]  |  🔍 Filter: [{f_mode}]  |  🔀 Sort: [{s_mode}]  (Press 't' to toggle Tasks/Sessions)"
        self.query_one("#filter_status_bar", Static).update(self.status_bar_text)

    def action_cycle_filter(self) -> None:
        self.filter_index = (self.filter_index + 1) % len(self.filter_modes)
        self.update_status_label()
        self.run_worker(self.load_current_view())

    def action_cycle_sort(self) -> None:
        self.sort_index = (self.sort_index + 1) % len(self.sort_modes)
        self.update_status_label()
        self.run_worker(self.load_current_view())

    def action_cursor_down(self) -> None:
        self.query_one("#main_table", DataTable).action_cursor_down()

    def action_cursor_up(self) -> None:
        self.query_one("#main_table", DataTable).action_cursor_up()

    def get_selected_item_id(self) -> Optional[int]:
        table = self.query_one("#main_table", DataTable)
        if table.row_count == 0 or table.cursor_row is None:
            return None
        try:
            row_data = table.get_row_at(table.cursor_row)
            item_id_str = str(row_data[0])
            return int(item_id_str) if item_id_str.isdigit() else None
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

    async def load_current_view(self) -> None:
        if self.view_mode == "tasks":
            await self.load_tasks()
        else:
            await self.load_sessions()

    async def load_tasks(self) -> None:
        try:
            f_param = self.filter_modes[self.filter_index]
            s_param = self.sort_modes[self.sort_index]
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/tasks?status={f_param}&sort={s_param}", timeout=2.0)
                if res.status_code == 200:
                    new_tasks = res.json()
                    table = self.query_one("#main_table", DataTable)
                    table.clear()
                    self.loaded_tasks = new_tasks

                    if not self.loaded_tasks:
                        table.add_row("-", "No tasks found. Press 'A' to create.", "-", "-", "-", "-")
                    else:
                        for task in self.loaded_tasks:
                            created_str = str(task.get("created_at", ""))[:16].replace("T", " ")
                            table.add_row(
                                str(task["id"]),
                                task["title"],
                                task.get("status", "in_progress"),
                                f"P{task.get('priority', 1)}",
                                created_str,
                                task.get("description") or ""
                            )
        except Exception:
            pass

    async def load_sessions(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/sessions", timeout=2.0)
                if res.status_code == 200:
                    new_sessions = res.json()
                    table = self.query_one("#main_table", DataTable)
                    table.clear()
                    self.loaded_sessions = new_sessions

                    if not self.loaded_sessions:
                        table.add_row("-", "No logged calendar sessions found.", "-", "-", "-", "-")
                    else:
                        # Render sessions reverse sorted by ID (newest top)
                        for s in reversed(self.loaded_sessions):
                            start_str = str(s.get("start_time", ""))[:16].replace("T", " ")
                            end_str = str(s.get("end_time", ""))[:16].replace("T", " ") if s.get("end_time") else "NOW"
                            duration_mins = round((s.get("duration_seconds") or 0) / 60, 1)
                            table.add_row(
                                str(s["id"]),
                                s.get("tags") or "#general",
                                start_str,
                                end_str,
                                str(duration_mins),
                                s.get("notes") or ""
                            )
        except Exception:
            pass

    async def action_add_task_nvim(self) -> None:
        template = {
            "title": "ALP-101 New Feature",
            "status": "in_progress",
            "priority": 1,
            "created_at": datetime.now(timezone.utc).isoformat()[:19],
            "color": "auto"
        }
        initial_notes = "Task description goes here..."

        data = None
        with self.suspend():
            data = open_in_nvim(template, initial_notes)

        if data and data.get("title"):
            try:
                payload = {
                    "title": data["title"],
                    "description": data.get("notes", ""),
                    "status": data.get("status", "in_progress"),
                    "priority": int(data.get("priority", 1)),
                    "color": data.get("color", "auto")
                }
                if data.get("created_at"):
                    payload["created_at"] = data["created_at"]

                async with httpx.AsyncClient() as client:
                    await client.post(f"{BASE_URL}/tasks", json=payload, timeout=3.0)
                await self.load_current_view()
            except Exception:
                pass

    async def action_edit_item_nvim(self) -> None:
        item_id = self.get_selected_item_id()
        if not item_id:
            return

        if self.view_mode == "tasks":
            task = next((t for t in self.loaded_tasks if t["id"] == item_id), None)
            if not task:
                return

            template = {
                "title": task["title"],
                "status": task.get("status", "in_progress"),
                "priority": task.get("priority", 1),
                "created_at": str(task.get("created_at", ""))[:19],
                "color": task.get("color", "auto")
            }
            initial_notes = task.get("description") or ""

            data = None
            with self.suspend():
                data = open_in_nvim(template, initial_notes)

            if data and data.get("title"):
                try:
                    payload = {
                        "title": data["title"],
                        "description": data.get("notes", ""),
                        "status": data.get("status", "in_progress"),
                        "priority": int(data.get("priority", 1)),
                        "color": data.get("color", "auto")
                    }
                    if data.get("created_at"):
                        payload["created_at"] = data["created_at"]

                    async with httpx.AsyncClient() as client:
                        await client.put(f"{BASE_URL}/tasks/{task['id']}", json=payload, timeout=3.0)
                    await self.load_tasks()
                except Exception:
                    pass
        else:
            session = next((s for s in self.loaded_sessions if s["id"] == item_id), None)
            if not session:
                return

            template = {
                "tags": session.get("tags", "#general"),
                "start_time": str(session.get("start_time", ""))[:19],
                "end_time": str(session.get("end_time", ""))[:19] if session.get("end_time") else ""
            }
            initial_notes = session.get("notes") or ""

            data = None
            with self.suspend():
                data = open_in_nvim(template, initial_notes)

            if data:
                try:
                    payload = {
                        "tags": data.get("tags", "#general"),
                        "notes": data.get("notes", ""),
                        "start_time": data.get("start_time"),
                        "end_time": data.get("end_time") if data.get("end_time") else None
                    }
                    async with httpx.AsyncClient() as client:
                        await client.put(f"{BASE_URL}/sessions/{session['id']}", json=payload, timeout=3.0)
                    await self.load_sessions()
                except Exception:
                    pass

    async def action_delete_item(self) -> None:
        item_id = self.get_selected_item_id()
        if not item_id:
            return
        try:
            endpoint = f"/tasks/{item_id}" if self.view_mode == "tasks" else f"/sessions/{item_id}"
            async with httpx.AsyncClient() as client:
                await client.delete(f"{BASE_URL}{endpoint}", timeout=2.0)
            await self.load_current_view()
        except Exception:
            pass

    async def action_clear_completed(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                await client.delete(f"{BASE_URL}/tasks/completed", timeout=3.0)
            await self.load_current_view()
        except Exception:
            pass

    async def action_start_timer_nvim(self) -> None:
        item_id = self.get_selected_item_id()
        task_id = item_id if self.view_mode == "tasks" else None

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

    async def action_split_timer_nvim(self) -> None:
        template = {"new_tags": "#documentation #api"}
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
            await self.load_current_view()
        except Exception:
            pass

    async def action_retro_log_nvim(self) -> None:
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
                await self.load_current_view()
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
        self.run_worker(self.load_current_view())
        self.run_worker(self.update_timer())

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "view_toggle_btn":
            self.action_toggle_view_mode()
        elif event.button.id == "start_btn":
            self.run_worker(self.action_start_timer_nvim())
        elif event.button.id == "split_btn":
            self.run_worker(self.action_split_timer_nvim())
        elif event.button.id == "stop_btn":
            self.run_worker(self.action_stop_timer_nvim())
        elif event.button.id == "add_btn":
            self.run_worker(self.action_add_task_nvim())
        elif event.button.id == "filter_btn":
            self.action_cycle_filter()
        elif event.button.id == "sort_btn":
            self.action_cycle_sort()
        elif event.button.id == "clear_btn":
            self.run_worker(self.action_clear_completed())

