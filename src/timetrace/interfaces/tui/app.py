import httpx
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical
from textual.widgets import Header, Footer, Static, Button, Input, DataTable
from textual.screen import ModalScreen
from textual.reactive import reactive

from timetrace.config import settings

BASE_URL = f"http://{settings.host}:{settings.port}/api/v1"


class ReflectionModal(ModalScreen):
    def __init__(self, session_id: int):
        super().__init__()
        self.session_id = session_id

    def compose(self) -> ComposeResult:
        yield Container(
            Static("🧠 Post-Session Reflection Prompt", id="modal_title"),
            Static("Energy Level (1 to 5):"),
            Input(placeholder="5", id="energy_input"),
            Static("Obstacles / Distractions (optional):"),
            Input(placeholder="None", id="obstacles_input"),
            Horizontal(
                Button("Submit Reflection", variant="success", id="submit_btn"),
                Button("Skip", variant="error", id="skip_btn"),
                id="modal_actions"
            ),
            id="modal_dialog"
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "submit_btn":
            energy = self.query_one("#energy_input", Input).value or "3"
            obstacles = self.query_one("#obstacles_input", Input).value or ""
            try:
                httpx.post(
                    f"{BASE_URL}/reflections",
                    json={
                        "session_id": self.session_id,
                        "energy_level": int(energy),
                        "obstacles": obstacles,
                        "habits_completed": ["Focus maintained"]
                    },
                    timeout=2.0
                )
            except Exception:
                pass
            self.dismiss()
        else:
            self.dismiss()


class TimeTraceTUI(App):
    CSS = """
    #timer_box {
        height: 7;
        border: solid green;
        content-align: center middle;
        padding: 1;
        margin-bottom: 1;
    }
    #timer_display {
        text-style: bold;
        text-opacity: 100%;
    }
    #actions_box {
        height: 3;
        margin-bottom: 1;
    }
    #tasks_table {
        height: 1fr;
        border: solid blue;
    }
    #modal_dialog {
        padding: 1 2;
        background: $surface;
        border: thick $accent;
        width: 60;
        height: 18;
    }
    #modal_title {
        text-style: bold;
        margin-bottom: 1;
    }
    #modal_actions {
        margin-top: 1;
    }
    """

    BINDINGS = [
        ("s", "start_timer", "Start Timer"),
        ("x", "stop_timer", "Stop Timer"),
        ("r", "refresh_data", "Refresh"),
        ("q", "quit", "Quit"),
    ]

    timer_text = reactive("⏸️ Timer Idle")

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Container(
            Vertical(
                Static(self.timer_text, id="timer_display"),
                id="timer_box"
            ),
            Horizontal(
                Button("Start Timer (S)", variant="success", id="start_btn"),
                Button("Stop & Reflect (X)", variant="error", id="stop_btn"),
                Button("Refresh (R)", variant="primary", id="refresh_btn"),
                id="actions_box"
            ),
            DataTable(id="tasks_table"),
        )
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one(DataTable)
        table.add_columns("ID", "Title", "Priority", "Status")
        self.set_interval(1.0, self.update_timer)
        self.load_tasks()

    def update_timer(self) -> None:
        try:
            res = httpx.get(f"{BASE_URL}/timer/status", timeout=1.0)
            if res.status_code == 200:
                data = res.json()
                if data["is_running"]:
                    elapsed_min = data["elapsed_seconds"] // 60
                    elapsed_sec = data["elapsed_seconds"] % 60
                    self.timer_text = f"⏱️ RUNNING: {elapsed_min:02d}:{elapsed_sec:02d} | Tags: {data.get('tags', '')}"
                else:
                    self.timer_text = "⏸️ Timer Idle"
        except Exception:
            self.timer_text = "❌ Daemon Disconnected"

        self.query_one("#timer_display", Static).update(self.timer_text)

    def load_tasks(self) -> None:
        table = self.query_one(DataTable)
        table.clear()
        try:
            res = httpx.get(f"{BASE_URL}/tasks", timeout=2.0)
            if res.status_code == 200:
                tasks = res.json()
                for task in tasks:
                    table.add_row(str(task["id"]), task["title"], f"P{task['priority']}", task["status"])
        except Exception:
            pass

    def action_start_timer(self) -> None:
        try:
            httpx.post(f"{BASE_URL}/timer/start", json={"tags": "#programming", "notes": "Started from TUI"}, timeout=2.0)
            self.update_timer()
        except Exception:
            pass

    def action_stop_timer(self) -> None:
        try:
            res = httpx.post(f"{BASE_URL}/timer/stop", timeout=2.0)
            if res.status_code == 200:
                session_data = res.json()
                self.push_screen(ReflectionModal(session_id=session_data["id"]))
            self.update_timer()
        except Exception:
            pass

    def action_refresh_data(self) -> None:
        self.load_tasks()
        self.update_timer()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "start_btn":
            self.action_start_timer()
        elif event.button.id == "stop_btn":
            self.action_stop_timer()
        elif event.button.id == "refresh_btn":
            self.action_refresh_data()
