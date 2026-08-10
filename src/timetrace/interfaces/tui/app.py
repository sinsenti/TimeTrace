import httpx
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from textual.app import App, ComposeResult
from textual.containers import Container, Vertical, ScrollableContainer
from textual.widgets import Header, Footer, Static, DataTable, Input
from textual.screen import ModalScreen
from textual.reactive import reactive
from textual.binding import Binding

from timetrace.config import settings
from timetrace.core.editor import open_in_nvim
from timetrace.core.inline_parser import (
    parse_inline_task,
    parse_inline_timer,
    parse_inline_reflection,
    parse_inline_retro,
)

BASE_URL = f"http://{settings.host}:{settings.port}/api/v1"


def format_priority_badge(priority: str) -> str:
    p = str(priority).lower().strip()
    if p == "high":
        return "[bold white on red] 🔴 HIGH [/bold white on red]"
    elif p == "medium":
        return "[bold black on yellow] 🟡 MED [/bold black on yellow]"
    elif p == "low":
        return "[bold white on blue] 🔵 LOW [/bold white on blue]"
    return "[dim text] ⚪ - [/dim text]"


def format_status_badge(status: str) -> str:
    s = str(status).lower().strip()
    if s == "in_progress":
        return "[bold cyan]⚡ in_progress[/bold cyan]"
    elif s == "ongoing":
        return "[bold magenta]🔄 ongoing[/bold magenta]"
    elif s == "completed":
        return "[bold green]✓ completed[/bold green]"
    return f"[dim]{s}[/dim]"


class HelpModal(ModalScreen):
    BINDINGS = [
        ("escape", "cancel", "Close"),
        ("q", "cancel", "Close"),
        ("question_mark", "cancel", "Close"),
        ("j", "scroll_down", "Scroll Down"),
        ("k", "scroll_up", "Scroll Up"),
    ]

    def compose(self) -> ComposeResult:
        help_text = """
[bold cyan]Navigation & Shortcuts[/bold cyan]
─────────────────────────────────────────────────────────────────────────────
[bold white]j / k[/bold white]         Move selection down / up
[bold white]t[/bold white]             Toggle View mode ([bold yellow]Tasks[/bold yellow] ↔ [bold yellow]Sessions[/bold yellow])
[bold white]f[/bold white]             Cycle status filters
[bold white]o[/bold white]             Cycle sort modes
[bold white]r[/bold white]             Refresh current table data

[bold cyan]Ultra-Fast Neovim Actions[/bold cyan]
─────────────────────────────────────────────────────────────────────────────
[bold white]a[/bold white]             Add Task  -> [dim]Title #tags !high @ip[/dim]
[bold white]e[/bold white]             Edit Row  -> [dim]Modify title / tags / priority[/dim]
[bold white]d[/bold white]             Delete Row
[bold white]D[/bold white]             Clear Completed Tasks
[bold white]s[/bold white]             Start Timer -> [dim]Working notes #tags @task_id !25m[/dim]
[bold white]c[/bold white]             Split Timer -> [dim]New activity notes #newtag[/dim]
[bold white]x[/bold white]             Stop & Reflect -> [dim]5/5 water, focus[/dim]
[bold white]m[/bold white]             Retro Session  -> [dim]Past activity #tags -90m 30m[/dim]
[bold white]v[/bold white]             View Analytics Summary

[bold cyan]Command Line Mode (:)[/bold cyan]
─────────────────────────────────────────────────────────────────────────────
[bold white]:help, :keys[/bold white]   Open this help overlay screen
[bold white]:theme[/bold white]        Toggle dark / light theme
[bold white]:start, :stop, :split, :add, :retro, :stats, :clear, :quit[/bold white] Execute
"""
        yield Container(
            Static("📖 [bold magenta]TimeTrace Help & Keyboard Shortcuts[/bold magenta]", id="modal_title"),
            ScrollableContainer(
                Static(help_text, id="help_content"),
                id="help_scroll_container"
            ),
            id="help_dialog"
        )

    def action_cancel(self) -> None:
        self.dismiss(False)

    def action_scroll_down(self) -> None:
        self.query_one("#help_scroll_container", ScrollableContainer).scroll_down()

    def action_scroll_up(self) -> None:
        self.query_one("#help_scroll_container", ScrollableContainer).scroll_up()


class StatsModal(ModalScreen):
    BINDINGS = [("escape", "cancel", "Cancel")]

    def __init__(self, summary: List[Dict[str, Any]]):
        super().__init__()
        self.summary = summary

    def compose(self) -> ComposeResult:
        stats_text = "📊 Activity Time Breakdown:\n" + "─" * 38 + "\n"
        if not self.summary:
            stats_text += "[dim]No session data logged yet.[/dim]"
        else:
            for item in self.summary:
                stats_text += f"• [bold green]{item['tag']:<18}[/bold green] : [bold purple]{item['total_hours']:>5.1f}[/bold purple] hrs ([cyan]{item['session_count']}[/cyan] sessions)\n"

        yield Container(
            Static("📊 [bold magenta]TimeTrace Analytics Summary[/bold magenta] [dim](Esc to exit)[/dim]", id="modal_title"),
            Static(stats_text, id="stats_content"),
            id="modal_dialog_lg"
        )

    def action_cancel(self) -> None:
        self.dismiss(False)


class TimeTraceTUI(App):
    CSS = """
    Screen {
        background: #0d0d14;
    }
    #timer_box {
        height: 5;
        border: heavy #a855f7;
        background: #13111c;
        content-align: center middle;
        padding: 0 1;
        margin-bottom: 1;
    }
    #timer_display {
        text-style: bold;
    }
    #filter_status_bar {
        height: 1;
        background: #1e1b2e;
        color: #c084fc;
        padding: 0 1;
        margin-bottom: 1;
        text-style: bold;
    }
    #main_table {
        height: 1fr;
        border: panel #3b82f6;
        background: #13111c;
    }
    #command_input {
        display: none;
        height: 3;
        border: heavy #059669;
        background: #10101a;
        color: #10b981;
        margin-bottom: 0;
    }
    #help_dialog {
        padding: 1 2;
        background: #141424;
        border: thick #a855f7;
        width: 78;
        height: 24;
    }
    #help_scroll_container {
        height: 18;
        margin-top: 1;
    }
    #modal_dialog_lg {
        padding: 1 2;
        background: #181826;
        border: thick #a855f7;
        width: 68;
        height: 20;
    }
    #modal_title {
        text-style: bold;
        margin-bottom: 1;
    }
    """

    BINDINGS = [
        Binding("colon", "focus_command_input", "Command (:)"),
        Binding("question_mark", "show_help", "Help (?)"),
        Binding("t", "toggle_view_mode", "Toggle View (t)"),
        Binding("j", "cursor_down", "Down", show=False),
        Binding("k", "cursor_up", "Up", show=False),
        Binding("a", "add_task_nvim", "Add Task"),
        Binding("e", "edit_item_nvim", "Edit Row"),
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

    timer_text = reactive("[dim]⏸️ Timer Idle[/dim]")
    status_bar_text = reactive("📱 VIEW: [bold cyan][TASKS][/bold cyan]  │  🔍 FILTER: [bold magenta][ALL][/bold magenta]  │  🔀 SORT: [bold green][PRIORITY][/bold green]")
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
            Static(self.status_bar_text, id="filter_status_bar"),
            DataTable(id="main_table"),
            Input(placeholder="Type command (e.g. :help, :keys, :view, :start, :stop)...", id="command_input"),
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
            table.add_columns("ID", "Priority", "Title", "Status", "Created At", "Description")
        else:
            table.add_columns("ID", "Tags", "Start Time", "End Time", "Duration (m)", "Notes")

    def action_show_help(self) -> None:
        self.push_screen(HelpModal())

    def action_focus_command_input(self) -> None:
        cmd_input = self.query_one("#command_input", Input)
        cmd_input.styles.display = "block"
        cmd_input.value = ":"
        cmd_input.focus()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        cmd_input = self.query_one("#command_input", Input)
        val = event.value.strip().lower()
        cmd_input.styles.display = "none"
        self.query_one("#main_table", DataTable).focus()

        if not val or val == ":":
            return

        cmd = val.lstrip(":")

        if cmd in ("help", "keys", "?"):
            self.action_show_help()
        elif cmd in ("tasks", "sessions", "view", "v", "t"):
            self.action_toggle_view_mode()
        elif cmd == "theme":
            self.dark = not self.dark
        elif cmd == "start":
            self.run_worker(self.action_start_timer_nvim())
        elif cmd == "stop":
            self.run_worker(self.action_stop_timer_nvim())
        elif cmd == "split":
            self.run_worker(self.action_split_timer_nvim())
        elif cmd == "add":
            self.run_worker(self.action_add_task_nvim())
        elif cmd == "retro":
            self.run_worker(self.action_retro_log_nvim())
        elif cmd == "stats":
            self.run_worker(self.action_view_stats())
        elif cmd in ("clear", "clean"):
            self.run_worker(self.action_clear_completed())
        elif cmd == "filter":
            self.action_cycle_filter()
        elif cmd == "sort":
            self.action_cycle_sort()
        elif cmd in ("quit", "q", "exit"):
            self.exit()

    def on_key(self, event) -> None:
        cmd_input = self.query_one("#command_input", Input)
        if cmd_input.has_focus and event.key == "escape":
            cmd_input.styles.display = "none"
            self.query_one("#main_table", DataTable).focus()

    def action_toggle_view_mode(self) -> None:
        self.view_mode = "sessions" if self.view_mode == "tasks" else "tasks"
        self.setup_table_columns()
        self.update_status_label()
        self.run_worker(self.load_current_view())

    def update_status_label(self) -> None:
        v_mode = self.view_mode.upper()
        f_mode = self.filter_modes[self.filter_index].upper()
        s_mode = self.sort_modes[self.sort_index].upper()
        self.status_bar_text = f"📱 VIEW: [bold cyan][{v_mode}][/bold cyan]  │  🔍 FILTER: [bold magenta][{f_mode}][/bold magenta]  │  🔀 SORT: [bold green][{s_mode}][/bold green]  (Press ':' for commands, '?' for help)"
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
                        self.timer_text = f"[bold green]⏱️ RUNNING:[/bold green] [bold white]{elapsed_min:02d}:{elapsed_sec:02d}[/bold white]  │  Task: [bold purple][{task_title}][/bold purple]  │  Notes: [cyan]{data.get('notes', '')}[/cyan]"
                    else:
                        self.timer_text = "[dim]⏸️ Timer Idle[/dim]"
        except Exception:
            self.timer_text = "[bold red]❌ Daemon Disconnected[/bold red]"

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
                        table.add_row("-", "-", "[dim]No tasks found matching filter. Press 'A' to create.[/dim]", "-", "-", "-")
                    else:
                        for task in self.loaded_tasks:
                            created_str = str(task.get("created_at", ""))[:16].replace("T", " ")
                            table.add_row(
                                str(task["id"]),
                                format_priority_badge(task.get("priority", "-")),
                                f"[bold white]{task['title']}[/bold white]",
                                format_status_badge(task.get("status", "in_progress")),
                                f"[dim]{created_str}[/dim]",
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
                        table.add_row("-", "-", "[dim]No logged calendar sessions found.[/dim]", "-", "-", "-")
                    else:
                        for s in reversed(self.loaded_sessions):
                            start_str = str(s.get("start_time", ""))[:16].replace("T", " ")
                            end_str = str(s.get("end_time", ""))[:16].replace("T", " ") if s.get("end_time") else "NOW"
                            duration_mins = round((s.get("duration_seconds") or 0) / 60, 1)
                            table.add_row(
                                str(s["id"]),
                                f"[bold green]{s.get('tags') or '#general'}[/bold green]",
                                f"[dim]{start_str}[/dim]",
                                f"[dim]{end_str}[/dim]",
                                f"[bold purple]{duration_mins}[/bold purple]",
                                s.get("notes") or ""
                            )
        except Exception:
            pass

    async def action_add_task_nvim(self) -> None:
        raw_text = None
        with self.suspend():
            raw_text = open_in_nvim()

        if raw_text:
            parsed = parse_inline_task(raw_text)
            if parsed and parsed.get("title"):
                try:
                    async with httpx.AsyncClient() as client:
                        await client.post(f"{BASE_URL}/tasks", json=parsed, timeout=3.0)
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

            p_tag = f"!{task.get('priority', '-')}" if task.get('priority') != '-' else ""
            pre_text = f"{task['title']} {p_tag} @{task.get('status', 'in_progress')}\n{task.get('description') or ''}".strip()

            raw_text = None
            with self.suspend():
                raw_text = open_in_nvim(pre_text)

            if raw_text:
                parsed = parse_inline_task(raw_text)
                if parsed and parsed.get("title"):
                    try:
                        async with httpx.AsyncClient() as client:
                            await client.put(f"{BASE_URL}/tasks/{task['id']}", json=parsed, timeout=3.0)
                        await self.load_tasks()
                    except Exception:
                        pass
        else:
            session = next((s for s in self.loaded_sessions if s["id"] == item_id), None)
            if not session:
                return

            pre_text = f"{session.get('notes', '')} {session.get('tags', '')}".strip()

            raw_text = None
            with self.suspend():
                raw_text = open_in_nvim(pre_text)

            if raw_text:
                parsed = parse_inline_timer(raw_text)
                try:
                    payload = {
                        "tags": parsed.get("tags", "#general"),
                        "notes": parsed.get("notes", "")
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

        pre_text = f"@task {task_id}" if task_id else ""

        raw_text = None
        with self.suspend():
            raw_text = open_in_nvim(pre_text)

        if raw_text:
            parsed = parse_inline_timer(raw_text)
            if not parsed.get("task_id") and task_id:
                parsed["task_id"] = task_id

            mode = "pomodoro" if parsed.get("pomo_minutes", 0) > 0 else "flowtime"

            try:
                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{BASE_URL}/timer/start",
                        json={
                            "task_id": parsed.get("task_id"),
                            "tags": parsed.get("tags", "#general"),
                            "notes": parsed.get("notes", ""),
                            "mode": mode,
                            "target_minutes": parsed.get("pomo_minutes") if parsed.get("pomo_minutes", 0) > 0 else None
                        },
                        timeout=3.0
                    )
                await self.update_timer()
            except Exception:
                pass

    async def action_split_timer_nvim(self) -> None:
        raw_text = None
        with self.suspend():
            raw_text = open_in_nvim()

        if raw_text:
            parsed = parse_inline_timer(raw_text)
            try:
                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{BASE_URL}/timer/split",
                        json={
                            "new_tags": parsed.get("tags", "#general"),
                            "new_notes": parsed.get("notes", "")
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

                    raw_text = None
                    with self.suspend():
                        raw_text = open_in_nvim("5/5 water, focus")

                    if raw_text:
                        parsed = parse_inline_reflection(raw_text)
                        await client.post(
                            f"{BASE_URL}/reflections",
                            json={
                                "session_id": session_data["id"],
                                "energy_level": parsed["energy_level"],
                                "obstacles": parsed["obstacles"],
                                "habits_completed": parsed["habits"]
                            },
                            timeout=3.0
                        )
            await self.update_timer()
            await self.load_current_view()
        except Exception:
            pass

    async def action_retro_log_nvim(self) -> None:
        raw_text = None
        with self.suspend():
            raw_text = open_in_nvim("-120m 45m #programming Activity notes...")

        if raw_text:
            parsed = parse_inline_retro(raw_text)
            try:
                start_ago = parsed["start_mins_ago"]
                dur_mins = parsed["duration_mins"]

                end_dt = datetime.now(timezone.utc) - timedelta(minutes=(start_ago - dur_mins))
                start_dt = end_dt - timedelta(minutes=dur_mins)

                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{BASE_URL}/sessions/retro",
                        json={
                            "start_time": start_dt.isoformat(),
                            "end_time": end_dt.isoformat(),
                            "tags": parsed["tags"],
                            "notes": parsed["notes"]
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

