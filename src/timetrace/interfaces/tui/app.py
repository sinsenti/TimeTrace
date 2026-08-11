import time
import re
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from textual.app import App, ComposeResult
from textual.containers import Container, Vertical, ScrollableContainer
from textual.widgets import Header, Footer, Static, DataTable, Input
from textual.screen import ModalScreen
from textual.reactive import reactive
from textual.binding import Binding

from timetrace.config import settings
from timetrace.core.editor import open_in_nvim
from timetrace.core.examples import FULL_EXAMPLES_MARKDOWN
from timetrace.core.inline_parser import (
    parse_inline_task,
    parse_inline_timer,
    parse_inline_session_edit,
    parse_inline_reflection,
    parse_inline_retro,
)

BASE_URL = f"http://{settings.host}:{settings.port}/api/v1"


def parse_utc_dt(iso_str: Optional[str]) -> datetime:
    if not iso_str:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        clean = str(iso_str)
        if not clean.endswith("Z") and "+" not in clean and "-" not in clean[10:]:
            clean += "Z"
        dt = datetime.fromisoformat(clean.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)


def format_local_time(iso_str: Optional[str], fmt: str = "%Y-%m-%d %H:%M") -> str:
    if not iso_str:
        return ""
    try:
        dt = parse_utc_dt(iso_str)
        return dt.astimezone().strftime(fmt)
    except Exception:
        return str(iso_str)[:16].replace("T", " ")


def format_priority_badge(priority: str) -> str:
    p = str(priority).lower().strip()
    if p == "high":
        return "[bold white on red] HIGH [/bold white on red]"
    elif p in ("medium", "med"):
        return "[bold black on yellow] MED [/bold black on yellow]"
    elif p == "low":
        return "[bold white on #4b5563] LOW [/bold white on #4b5563]"
    return "[dim]-[/dim]"


def format_status_badge(status: str) -> str:
    s = str(status).lower().strip()
    if s == "in_progress":
        return "[bold cyan]in_progress[/bold cyan]"
    elif s == "ongoing":
        return "[bold magenta]ongoing[/bold magenta]"
    elif s == "completed":
        return "[bold green]completed[/bold green]"
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
[bold cyan]Navigation & Search Shortcuts[/bold cyan]
─────────────────────────────────────────────────────────────────────────────
[bold white]j / k[/bold white]         Move selection down / up
[bold white]/[/bold white]             Search text in real-time
[bold white]t[/bold white]             Toggle View mode ([bold yellow]Tasks[/bold yellow] ↔ [bold yellow]Sessions[/bold yellow] ↔ [bold yellow]Habits[/bold yellow])
[bold white]f[/bold white]             Cycle status filters
[bold white]o[/bold white]             Cycle sort modes
[bold white]r[/bold white]             Refresh current table data

[bold cyan]Fast Habit Tracking Controls (in Habits View)[/bold cyan]
─────────────────────────────────────────────────────────────────────────────
[bold white]Space[/bold white]         Toggle Today's Status (Done ✓ / Fail ✗ / Skip ↷)
[bold white]+ / -[/bold white]         Increment / Decrement numeric habit (e.g. +1 pull-up)

[bold cyan]Ultra-Fast Neovim Actions[/bold cyan]
─────────────────────────────────────────────────────────────────────────────
[bold white]a[/bold white]             Add Task  -> [dim]Title #tags !high @ip[/dim]
[bold white]e[/bold white]             Edit Row  -> [dim]Modify task, session, or habit in Neovim[/dim]
[bold white]dd[/bold white]            Delete Row ([dim]press 'd' twice[/dim])
[bold white]D[/bold white]             Clear Completed Tasks
[bold white]s[/bold white]             Start Timer -> [dim]Working notes #tags @task_id !25m[/dim]
[bold white]c[/bold white]             Split Timer -> [dim]New activity notes #newtag[/dim]
[bold white]x[/bold white]             Stop & Reflect -> [dim]5/5 water, focus[/dim]
[bold white]m[/bold white]             Retro Session  -> [dim]Past activity #tags @task_id -90m 30m[/dim]
[bold white]v[/bold white]             View Analytics Summary

[bold cyan]Command Line Mode (:)[/bold cyan]
─────────────────────────────────────────────────────────────────────────────
[bold white]:ex, :examples[/bold white] Open Markdown examples
[bold white]:habits[/bold white]       Switch to Habits View
[bold white]:help, :keys[/bold white]   Open help screen
[bold white]:theme[/bold white]        Toggle dark / light theme
[bold white]:start, :stop, :split, :add, :retro, :stats, :clear, :quit[/bold white] Execute
"""
        yield Container(
            Static("[bold magenta]TimeTrace Help & Keyboard Shortcuts[/bold magenta]", id="modal_title"),
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


class ExamplesModal(ModalScreen):
    BINDINGS = [
        ("escape", "cancel", "Close"),
        ("q", "cancel", "Close"),
        ("j", "scroll_down", "Scroll Down"),
        ("k", "scroll_up", "Scroll Up"),
    ]

    def compose(self) -> ComposeResult:
        yield Container(
            Static("[bold magenta]TimeTrace Markdown Syntax & File Examples[/bold magenta]", id="modal_title"),
            ScrollableContainer(
                Static(FULL_EXAMPLES_MARKDOWN, id="examples_content"),
                id="examples_scroll_container"
            ),
            id="help_dialog"
        )

    def action_cancel(self) -> None:
        self.dismiss(False)

    def action_scroll_down(self) -> None:
        self.query_one("#examples_scroll_container", ScrollableContainer).scroll_down()

    def action_scroll_up(self) -> None:
        self.query_one("#examples_scroll_container", ScrollableContainer).scroll_up()


class StatsModal(ModalScreen):
    BINDINGS = [("escape", "cancel", "Cancel")]

    def __init__(self, summary: List[Dict[str, Any]]):
        super().__init__()
        self.summary = summary

    def compose(self) -> ComposeResult:
        stats_text = "Activity Time Breakdown:\n" + "─" * 38 + "\n"
        if not self.summary:
            stats_text += "[dim]No session data logged yet.[/dim]"
        else:
            for item in self.summary:
                stats_text += f"• [bold green]{item['tag']:<18}[/bold green] : [bold purple]{item['total_hours']:>5.1f}[/bold purple] hrs ([cyan]{item['session_count']}[/cyan] sessions)\n"

        yield Container(
            Static("[bold magenta]TimeTrace Analytics Summary[/bold magenta] [dim](Esc to exit)[/dim]", id="modal_title"),
            Static(stats_text, id="stats_content"),
            id="modal_dialog_lg"
        )

    def action_cancel(self) -> None:
        self.dismiss(False)


class TimeTraceTUI(App):
    CSS = """
    Screen {
        background: #0b0b10;
    }
    #timer_box {
        height: 5;
        border: heavy #a855f7;
        background: #12111d;
        content-align: center middle;
        padding: 0 1;
        margin-bottom: 1;
    }
    #timer_display {
        text-style: bold;
    }
    #filter_status_bar {
        height: 1;
        background: #181a28;
        color: #d8b4fe;
        padding: 0 1;
        margin-bottom: 1;
        text-style: bold;
    }
    #main_table {
        height: 1fr;
        border: heavy #2e2e42;
        background: #12111d;
    }
    #command_input {
        display: none;
        height: 3;
        border: heavy #10b981;
        background: #12111d;
        color: #10b981;
        margin-bottom: 0;
    }
    #search_input {
        display: none;
        height: 3;
        border: heavy #6366f1;
        background: #12111d;
        color: #818cf8;
        margin-bottom: 0;
    }
    #help_dialog {
        padding: 1 2;
        background: #141424;
        border: thick #a855f7;
        width: 82;
        height: 26;
    }
    #help_scroll_container, #examples_scroll_container {
        height: 20;
        margin-top: 1;
    }
    """

    BINDINGS = [
        Binding("slash", "focus_search_input", "Search (/)"),
        Binding("colon", "focus_command_input", "Command (:)"),
        Binding("question_mark", "show_help", "Help (?)"),
        Binding("t", "toggle_view_mode", "Toggle View (t)"),
        Binding("j", "cursor_down", "Down", show=False),
        Binding("k", "cursor_up", "Up", show=False),
        Binding("space", "quick_toggle_habit", "Toggle Habit", show=False),
        Binding("plus", "quick_inc_habit", "+1 Habit", show=False),
        Binding("minus", "quick_dec_habit", "-1 Habit", show=False),
        Binding("a", "add_task_nvim", "Add Task"),
        Binding("e", "edit_item_nvim", "Edit Row"),
        Binding("f", "cycle_filter", "Filter (f)"),
        Binding("o", "cycle_sort", "Sort (o)"),
        Binding("D", "clear_completed", "Clear Completed"),
        Binding("s", "start_timer_nvim", "Start Timer"),
        Binding("c", "split_timer_nvim", "Split Timer"),
        Binding("x", "stop_timer_nvim", "Stop/Reflect"),
        Binding("m", "retro_log_nvim", "Retro Log"),
        Binding("v", "view_stats", "Stats"),
        Binding("r", "refresh_data", "Refresh"),
        Binding("q", "quit", "Quit"),
    ]

    timer_text = reactive("[dim]Timer Idle[/dim]")
    status_bar_text = reactive("VIEW: [bold cyan]TASKS[/bold cyan]  │  FILTER: [bold magenta]ALL[/bold magenta]  │  SORT: [bold green]PRIORITY[/bold green]")
    view_mode = reactive("tasks")

    def __init__(self):
        super().__init__()
        self.loaded_tasks: List[Dict[str, Any]] = []
        self.loaded_sessions: List[Dict[str, Any]] = []
        self.loaded_habits: List[Dict[str, Any]] = []
        self.active_task_id: Optional[int] = None
        self.filter_modes = ["all", "hide_completed", "in_progress", "ongoing", "completed"]
        self.filter_index = 0
        self.sort_modes = ["priority", "created_at", "title", "status"]
        self.sort_index = 0
        self.search_query: str = ""
        self.last_d_time: float = 0.0

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Container(
            Vertical(
                Static(self.timer_text, id="timer_display"),
                id="timer_box"
            ),
            Static(self.status_bar_text, id="filter_status_bar"),
            DataTable(id="main_table"),
            Input(placeholder="Search tasks or notes...", id="search_input"),
            Input(placeholder="Type command (e.g. :ex, :habits, :help, :start)...", id="command_input"),
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
        elif self.view_mode == "sessions":
            table.add_columns("ID", "Tags", "Start Time", "End Time", "Duration (m)", "Notes")
        else:
            table.add_columns("ID", "Habit Name", "Type / Target", "Today Progress", "Status", "Schedule")

    def action_show_help(self) -> None:
        self.push_screen(HelpModal())

    def action_show_examples(self) -> None:
        self.push_screen(ExamplesModal())

    def action_focus_search_input(self) -> None:
        s_input = self.query_one("#search_input", Input)
        s_input.styles.display = "block"
        s_input.value = self.search_query
        s_input.focus()

    def action_focus_command_input(self) -> None:
        cmd_input = self.query_one("#command_input", Input)
        cmd_input.styles.display = "block"
        cmd_input.value = ":"
        cmd_input.focus()

    def action_toggle_view_mode(self) -> None:
        if self.view_mode == "tasks":
            self.view_mode = "sessions"
        elif self.view_mode == "sessions":
            self.view_mode = "habits"
        else:
            self.view_mode = "tasks"
        self.setup_table_columns()
        self.update_status_label()
        self.run_worker(self.load_current_view())

    def update_status_label(self) -> None:
        v_mode = self.view_mode.upper()
        f_mode = self.filter_modes[self.filter_index].upper()
        s_mode = self.sort_modes[self.sort_index].upper()
        search_str = f"  │  SEARCH: [bold yellow]{self.search_query}[/bold yellow]" if self.search_query else ""
        self.status_bar_text = f"VIEW: [bold cyan]{v_mode}[/bold cyan]  │  FILTER: [bold magenta]{f_mode}[/bold magenta]  │  SORT: [bold green]{s_mode}[/bold green]{search_str}"
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
            cell_val = row_data[0]
            raw_str = cell_val.plain if hasattr(cell_val, "plain") else str(cell_val)
            clean_id = re.sub(r"[^\d]", "", raw_str).strip()
            return int(clean_id) if clean_id.isdigit() else None
        except Exception:
            return None

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id == "search_input":
            self.search_query = event.value.strip().lower()
            self.update_status_label()
            self.render_current_view()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id == "search_input":
            event.input.styles.display = "none"
            self.query_one("#main_table", DataTable).focus()
            return

        cmd_input = self.query_one("#command_input", Input)
        val = event.value.strip().lower()
        cmd_input.styles.display = "none"
        self.query_one("#main_table", DataTable).focus()

        if not val or val == ":":
            return

        cmd = val.lstrip(":")

        if cmd in ("ex", "example", "examples"):
            self.action_show_examples()
        elif cmd in ("help", "keys", "?"):
            self.action_show_help()
        elif cmd in ("tasks", "sessions", "habits", "view", "v", "t"):
            if cmd == "habits":
                self.view_mode = "habits"
                self.setup_table_columns()
                self.update_status_label()
                self.run_worker(self.load_current_view())
            else:
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
        elif cmd in ("quit", "q", "exit"):
            self.exit()

    def on_key(self, event) -> None:
        s_input = self.query_one("#search_input", Input)
        cmd_input = self.query_one("#command_input", Input)

        if s_input.has_focus:
            if event.key == "escape":
                s_input.styles.display = "none"
                self.query_one("#main_table", DataTable).focus()
            return

        if cmd_input.has_focus:
            if event.key == "escape":
                cmd_input.styles.display = "none"
                self.query_one("#main_table", DataTable).focus()
            return

        if event.key == "escape" and self.search_query:
            self.search_query = ""
            s_input.value = ""
            self.update_status_label()
            self.render_current_view()
            self.notify("Search filter cleared", timeout=1.0)
            return

        if event.key == "d":
            now = time.time()
            if now - self.last_d_time < 0.6:
                self.last_d_time = 0.0
                self.action_delete_item()
            else:
                self.last_d_time = now
                self.notify("Press 'd' again to delete row (dd)", timeout=1.2)

    async def update_timer(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/timer/status", timeout=2.0)
                if res.status_code == 200:
                    data = res.json()
                    if data["is_running"]:
                        self.active_task_id = data.get("task_id")
                        elapsed_min = data["elapsed_seconds"] // 60
                        elapsed_sec = data["elapsed_seconds"] % 60
                        task_title = data.get("task_title") or data.get("tags") or "#session"
                        self.timer_text = f"[bold green]RUNNING:[/bold green] [bold white]{elapsed_min:02d}:{elapsed_sec:02d}[/bold white]  │  Task: [bold purple][{task_title}][/bold purple]  │  Notes: [cyan]{data.get('notes', '')}[/cyan]"
                    else:
                        self.active_task_id = None
                        self.timer_text = "[dim]Timer Idle[/dim]"
        except Exception:
            self.active_task_id = None
            self.timer_text = "[bold red]Daemon Disconnected[/bold red]"

        self.query_one("#timer_display", Static).update(self.timer_text)

    async def load_current_view(self) -> None:
        if self.view_mode == "tasks":
            await self.load_tasks()
        elif self.view_mode == "sessions":
            await self.load_sessions()
        else:
            await self.load_habits()

    async def load_tasks(self) -> None:
        try:
            f_param = self.filter_modes[self.filter_index]
            s_param = self.sort_modes[self.sort_index]
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/tasks?status={f_param}&sort={s_param}", timeout=2.0)
                if res.status_code == 200:
                    self.loaded_tasks = res.json()
                    self.render_tasks()
        except Exception:
            pass

    def render_tasks(self) -> None:
        table = self.query_one("#main_table", DataTable)
        table.clear()

        filtered = self.loaded_tasks
        if self.search_query:
            filtered = [
                t for t in filtered
                if self.search_query in str(t.get("title", "")).lower()
                or self.search_query in str(t.get("description", "")).lower()
            ]

        if not filtered:
            table.add_row("-", "-", "[dim]No tasks match current filter/search.[/dim]", "-", "-", "-")
            return

        for task in filtered:
            created_str = format_local_time(task.get("created_at"))
            table.add_row(
                str(task["id"]),
                format_priority_badge(task.get("priority", "-")),
                f"[bold white]{task['title']}[/bold white]",
                format_status_badge(task.get("status", "in_progress")),
                f"[dim]{created_str}[/dim]",
                task.get("description") or ""
            )

    async def load_sessions(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/sessions", timeout=2.0)
                if res.status_code == 200:
                    self.loaded_sessions = res.json()
                    self.render_sessions()
        except Exception:
            pass

    def render_sessions(self) -> None:
        table = self.query_one("#main_table", DataTable)
        table.clear()

        filtered = self.loaded_sessions
        if self.search_query:
            filtered = [
                s for s in filtered
                if self.search_query in str(s.get("notes", "")).lower()
                or self.search_query in str(s.get("tags", "")).lower()
            ]

        if not filtered:
            table.add_row("-", "-", "[dim]No logged calendar sessions match search.[/dim]", "-", "-", "-")
            return

        now = datetime.now(timezone.utc)
        current_sessions = []
        upcoming_sessions = []
        past_sessions = []

        for s in filtered:
            s_start = parse_utc_dt(s.get("start_time"))
            s_end = parse_utc_dt(s.get("end_time")) if s.get("end_time") else now

            if s_start <= now <= s_end or (self.active_task_id and s.get("task_id") == self.active_task_id):
                current_sessions.append(s)
            elif s_start > now:
                upcoming_sessions.append(s)
            else:
                past_sessions.append(s)

        upcoming_sessions.sort(key=lambda s: parse_utc_dt(s.get("start_time")))
        past_sessions.sort(key=lambda s: parse_utc_dt(s.get("start_time")), reverse=True)

        if current_sessions:
            table.add_row("", "", "[bold cyan]--- CURRENT SESSION ---[/bold cyan]", "", "", "")
            for s in current_sessions:
                start_str = format_local_time(s.get("start_time"))
                end_str = format_local_time(s.get("end_time")) if s.get("end_time") else "NOW"
                duration_mins = round((s.get("duration_seconds") or 0) / 60, 1)
                table.add_row(
                    str(s["id"]),
                    f"[bold green]{s.get('tags') or '#general'}[/bold green]",
                    f"[bold cyan]{start_str}[/bold cyan]",
                    f"[bold cyan]{end_str}[/bold cyan]",
                    f"[bold purple]{duration_mins}[/bold purple]",
                    s.get("notes") or ""
                )

        if upcoming_sessions:
            table.add_row("", "", "[bold yellow]--- UPCOMING SESSIONS ---[/bold yellow]", "", "", "")
            for s in upcoming_sessions:
                start_str = format_local_time(s.get("start_time"))
                end_str = format_local_time(s.get("end_time")) if s.get("end_time") else ""
                duration_mins = round((s.get("duration_seconds") or 0) / 60, 1)
                table.add_row(
                    str(s["id"]),
                    f"[bold yellow]{s.get('tags') or '#general'}[/bold yellow]",
                    f"[bold yellow]{start_str}[/bold yellow]",
                    f"[dim]{end_str}[/dim]",
                    f"[bold purple]{duration_mins}[/bold purple]",
                    s.get("notes") or ""
                )

        if past_sessions:
            table.add_row("", "", "[bold dim]--- PAST SESSIONS ---[/bold dim]", "", "", "")
            for s in past_sessions:
                start_str = format_local_time(s.get("start_time"))
                end_str = format_local_time(s.get("end_time")) if s.get("end_time") else "NOW"
                duration_mins = round((s.get("duration_seconds") or 0) / 60, 1)
                table.add_row(
                    str(s["id"]),
                    f"[dim green]{s.get('tags') or '#general'}[/dim green]",
                    f"[dim]{start_str}[/dim]",
                    f"[dim]{end_str}[/dim]",
                    f"[bold purple]{duration_mins}[/bold purple]",
                    s.get("notes") or ""
                )

    async def load_habits(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/habits", timeout=2.0)
                if res.status_code == 200:
                    self.loaded_habits = res.json()
                    self.render_habits()
        except Exception:
            pass

    def render_habits(self) -> None:
        table = self.query_one("#main_table", DataTable)
        table.clear()

        if not self.loaded_habits:
            table.add_row("-", "[dim]No habits tracked yet. Use Web UI or API to add habits.[/dim]", "-", "-", "-", "-")
            return

        today_str = datetime.now().strftime("%Y-%m-%d")

        for h in self.loaded_habits:
            logs = h.get("logs", {})
            today_log = logs.get(today_str, {"status": "pending", "value": 0.0})

            if h.get("habit_type") == "numeric":
                prog_str = f"[bold yellow]{today_log.get('value', 0.0)}[/bold yellow] / [bold white]{h.get('target_value', 1.0)} {h.get('unit', '')}[/bold white]"
            else:
                prog_str = "[bold green]1 / 1[/bold green]" if today_log.get("status") == "completed" else "[dim]0 / 1[/dim]"

            st = today_log.get("status", "pending")
            if st == "completed":
                st_badge = "[bold white on #059669] DONE ✓ [/bold white on #059669]"
            elif st == "failed":
                st_badge = "[bold white on #dc2626] FAILED ✗ [/bold white on #dc2626]"
            elif st == "skipped":
                st_badge = "[bold white on #475569] SKIPPED ↷ [/bold white on #475569]"
            else:
                st_badge = "[bold black on #d97706] PENDING [/bold black on #d97706]"

            table.add_row(
                str(h["id"]),
                f"[bold white]{h['name']}[/bold white]",
                f"[cyan]{h.get('habit_type', 'boolean')}[/cyan]",
                prog_str,
                st_badge,
                f"[dim]{h.get('frequency', 'Every day')} @ {h.get('reminder_time', '09:00 AM')}[/dim]"
            )

    async def action_quick_toggle_habit(self) -> None:
        if self.view_mode != "habits":
            return
        item_id = self.get_selected_item_id()
        if not item_id:
            return

        today_str = datetime.now().strftime("%Y-%m-%d")
        habit = next((h for h in self.loaded_habits if h["id"] == item_id), None)
        if not habit:
            return

        curr_log = habit.get("logs", {}).get(today_str, {})
        curr_st = curr_log.get("status", "pending")

        next_st = "completed"
        if curr_st == "completed":
            next_st = "failed"
        elif curr_st == "failed":
            next_st = "skipped"
        elif curr_st == "skipped":
            next_st = "erase"

        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{BASE_URL}/habits/{item_id}/log",
                    json={"date_str": today_str, "status": next_st},
                    timeout=3.0
                )
            self.notify(f"Habit #{item_id} updated: {next_st.upper()}", timeout=1.2)
            await self.load_habits()
        except Exception as e:
            self.notify(f"Error: {e}", severity="error")

    async def action_quick_inc_habit(self) -> None:
        if self.view_mode != "habits":
            return
        item_id = self.get_selected_item_id()
        if not item_id:
            return

        today_str = datetime.now().strftime("%Y-%m-%d")
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{BASE_URL}/habits/{item_id}/log",
                    json={"date_str": today_str, "delta_value": 1.0},
                    timeout=3.0
                )
            self.notify(f"Habit #{item_id} +1", timeout=1.0)
            await self.load_habits()
        except Exception:
            pass

    async def action_quick_dec_habit(self) -> None:
        if self.view_mode != "habits":
            return
        item_id = self.get_selected_item_id()
        if not item_id:
            return

        today_str = datetime.now().strftime("%Y-%m-%d")
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{BASE_URL}/habits/{item_id}/log",
                    json={"date_str": today_str, "delta_value": -1.0},
                    timeout=3.0
                )
            self.notify(f"Habit #{item_id} -1", timeout=1.0)
            await self.load_habits()
        except Exception:
            pass

    # Neovim Quick Actions (a, e, s, c, x, m, v)
    async def action_add_task_nvim(self) -> None:
        template = (
            "\n\n\n\n\n"
            "> ADD TASK SYNTAX HELP: Title #tags !priority @status\n"
            "> Priority: !high !medium !low   Status: @in_progress @ongoing @completed\n"
            "> Example: Project(a1labs) #progr #work !medium @in_progress"
        )
        raw_text = None
        with self.suspend():
            raw_text = open_in_nvim(template)

        if raw_text:
            parsed = parse_inline_task(raw_text)
            if parsed and parsed.get("title"):
                try:
                    async with httpx.AsyncClient() as client:
                        res = await client.post(f"{BASE_URL}/tasks", json=parsed, timeout=3.0)
                        if res.status_code == 201:
                            self.notify("Task created!", timeout=1.5)
                        else:
                            self.notify(f"Failed to create task: {res.text}", severity="error")
                    await self.load_current_view()
                except Exception as e:
                    self.notify(f"Error: {e}", severity="error")

    async def action_edit_item_nvim(self) -> None:
        item_id = self.get_selected_item_id()
        if not item_id:
            return

        if self.view_mode == "tasks":
            task = next((t for t in self.loaded_tasks if t["id"] == item_id), None)
            if not task:
                return

            p_tag = f"!{task.get('priority', '-')}" if task.get('priority') != '-' else ""
            help_text = (
                "\n\n\n\n\n"
                "> EDIT TASK SYNTAX HELP: Title #tags !priority @status\n"
                "> Priority: !high !medium !low   Status: @in_progress @ongoing @completed\n"
                "> Line 2+: Task description"
            )
            pre_text = f"{task['title']} {p_tag} @{task.get('status', 'in_progress')}\n{task.get('description') or ''}{help_text}".strip()

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

        elif self.view_mode == "sessions":
            session = next((s for s in self.loaded_sessions if s["id"] == item_id), None)
            if not session:
                return

            start_str = format_local_time(session.get("start_time"), fmt="%H:%M")
            end_str = format_local_time(session.get("end_time"), fmt="%H:%M") if session.get("end_time") else "NOW"
            duration_mins = round((session.get("duration_seconds") or 0) / 60, 1)
            task_ref = f"@{session['task_id']}" if session.get("task_id") else ""

            help_text = (
                "\n\n\n\n\n"
                "> EDIT SESSION SYNTAX HELP: [start_time - end_time] (duration) #tags @task_id notes\n"
                "> Example: [09:00 - 10:30] #progr #backend @14 Refactored WebSocket connection pool"
            )
            pre_text = f"[{start_str} - {end_str}] ({duration_mins}m) {session.get('tags', '')} {task_ref} {session.get('notes', '')}{help_text}".strip()

            raw_text = None
            with self.suspend():
                raw_text = open_in_nvim(pre_text)

            if raw_text:
                parsed = parse_inline_session_edit(raw_text, base_session=session)
                try:
                    payload = {
                        "tags": parsed.get("tags", "#general"),
                        "notes": parsed.get("notes", "")
                    }
                    if "start_time" in parsed:
                        payload["start_time"] = parsed["start_time"].isoformat()
                    if "end_time" in parsed:
                        payload["end_time"] = parsed["end_time"].isoformat()

                    async with httpx.AsyncClient() as client:
                        res = await client.put(f"{BASE_URL}/sessions/{session['id']}", json=payload, timeout=3.0)
                        if res.status_code == 200:
                            self.notify("Session updated!", timeout=1.5)
                        else:
                            self.notify(f"Failed to update session: {res.text}", severity="error")
                    await self.load_sessions()
                except Exception as e:
                    self.notify(f"Error: {e}", severity="error")

    async def action_start_timer_nvim(self) -> None:
        item_id = self.get_selected_item_id()
        task_id = item_id if self.view_mode == "tasks" else None
        task_ref = f"@{task_id}" if task_id else "@task_id"
        template = (
            "\n\n\n\n\n"
            f"> START TIMER SYNTAX HELP: Working notes #tags {task_ref} !pomo_mins\n"
            "> Priority/Pomo: !15m !25m !50m   Tags: #progr #backend #meeting\n"
            f"> Example: Fixing WebSocket mutex lock #progr #backend {task_ref} !25m"
        )

        raw_text = None
        with self.suspend():
            raw_text = open_in_nvim(template)

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
        template = (
            "\n\n\n\n\n"
            "> SPLIT TIMER SYNTAX HELP: New activity notes #tags\n"
            "> Tags: #progr #review #meeting #design\n"
            "> Example: Code review for pull request #review #progr"
        )
        raw_text = None
        with self.suspend():
            raw_text = open_in_nvim(template)

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
                    template = (
                        "5/5 water, focus\n\n\n\n\n"
                        "> POST-SESSION REFLECTION SYNTAX HELP: [Energy 1-5]/5 habit1, habit2\n"
                        "> Line 2+: Optional obstacle or session notes\n"
                        "> Example: 5/5 water, focus, stretch\n"
                        "> Minor CORS issue on WebSocket handshake"
                    )

                    raw_text = None
                    with self.suspend():
                        raw_text = open_in_nvim(template)

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
        item_id = self.get_selected_item_id()
        task_id = item_id if self.view_mode == "tasks" else None
        task_ref = f"@{task_id}" if task_id else "@task_id"
        template = (
            "\n\n\n\n\n"
            f"> RETROACTIVE LOG SYNTAX HELP: Activity notes #tags {task_ref} -start_ago duration_mins\n"
            "> Time format: -90m 30m  OR  -2h 45m\n"
            f"> Example: Reviewed pull requests #review #progr {task_ref} -90m 30m"
        )

        raw_text = None
        with self.suspend():
            raw_text = open_in_nvim(template)

        if raw_text:
            parsed = parse_inline_retro(raw_text)
            try:
                start_ago = parsed["start_mins_ago"]
                dur_mins = parsed["duration_mins"]

                end_dt = datetime.now(timezone.utc) - timedelta(minutes=(start_ago - dur_mins))
                start_dt = end_dt - timedelta(minutes=dur_mins)

                payload = {
                    "task_id": parsed.get("task_id") or task_id,
                    "start_time": start_dt.isoformat(),
                    "end_time": end_dt.isoformat(),
                    "tags": parsed["tags"],
                    "notes": parsed["notes"]
                }

                async with httpx.AsyncClient() as client:
                    res = await client.post(
                        f"{BASE_URL}/sessions/retro",
                        json=payload,
                        timeout=3.0
                    )
                    if res.status_code == 201:
                        self.notify("Retro session logged!", timeout=1.5)
                    else:
                        self.notify(f"Failed to log retro session: {res.text}", severity="error")
                await self.load_current_view()
            except Exception as e:
                self.notify(f"Error: {e}", severity="error")

    async def action_view_stats(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(f"{BASE_URL}/analytics/summary", timeout=2.0)
                if res.status_code == 200:
                    summary = res.json()
                    self.push_screen(StatsModal(summary=summary))
        except Exception:
            pass

    async def action_clear_completed(self) -> None:
        try:
            async with httpx.AsyncClient() as client:
                await client.delete(f"{BASE_URL}/tasks/completed", timeout=3.0)
            self.notify("Cleared completed tasks", timeout=1.5)
            await self.load_current_view()
        except Exception:
            pass

    def action_delete_item(self) -> None:
        item_id = self.get_selected_item_id()
        if not item_id:
            return
        endpoint = f"/tasks/{item_id}" if self.view_mode == "tasks" else (f"/sessions/{item_id}" if self.view_mode == "sessions" else f"/habits/{item_id}")
        self.run_worker(self._async_delete_item(endpoint, item_id))

    async def _async_delete_item(self, endpoint: str, item_id: int) -> None:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.delete(f"{BASE_URL}{endpoint}", timeout=3.0)
                if res.status_code in (200, 204):
                    self.notify(f"Deleted #{item_id}", timeout=1.5)
            await self.load_current_view()
        except Exception as e:
            self.notify(f"Error deleting: {e}", severity="error")

    def action_refresh_data(self) -> None:
        self.run_worker(self.load_current_view())
        self.run_worker(self.update_timer())
