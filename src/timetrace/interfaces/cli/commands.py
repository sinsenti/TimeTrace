import typer
import uvicorn
from typing import Optional
from timetrace.config import settings
from timetrace.interfaces.cli.client import get_client, ensure_daemon_running

cli_app = typer.Typer(
    name="timetrace",
    help="TimeTrace: Developer-centric time tracking & productivity engine.",
    no_args_is_help=False
)


@cli_app.command("daemon")
def run_daemon():
    """Start the TimeTrace FastAPI background daemon."""
    print(f"🚀 Starting TimeTrace daemon on http://{settings.host}:{settings.port}...")
    uvicorn.run("timetrace.main:daemon_app", host=settings.host, port=settings.port, reload=False)


@cli_app.command("start")
def start_timer(
    tags: str = typer.Option("", "--tags", "-t", help="Tags for session (e.g. '#programming')"),
    notes: str = typer.Option("", "--notes", "-n", help="Notes for session"),
    task_id: Optional[int] = typer.Option(None, "--task", "-k", help="Task ID to attach")
):
    """Start active session timer."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.post("/timer/start", json={"task_id": task_id, "tags": tags, "notes": notes})
        if res.status_code == 200:
            print("⏱️ Timer started successfully!")
        else:
            print(f"❌ Error: {res.json().get('detail')}")


@cli_app.command("stop")
def stop_timer():
    """Stop active timer and save session."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.post("/timer/stop")
        if res.status_code == 200:
            data = res.json()
            duration_min = round(data.get("duration_seconds", 0) / 60, 1)
            print(f"🛑 Timer stopped! Saved Session #{data['id']} ({duration_min} mins).")
        else:
            print(f"❌ Error: {res.json().get('detail')}")


@cli_app.command("status")
def timer_status(
    tmux: bool = typer.Option(False, "--tmux", help="Output minimal format for Tmux status bar")
):
    """Check active timer status."""
    try:
        with get_client() as client:
            res = client.get("/timer/status")
            if res.status_code == 200:
                data = res.json()
                if not data["is_running"]:
                    if tmux:
                        print("⏹️ Idle")
                    else:
                        print("⏸️ No timer currently running.")
                    return

                elapsed_min = data["elapsed_seconds"] // 60
                elapsed_sec = data["elapsed_seconds"] % 60
                time_str = f"{elapsed_min:02d}:{elapsed_sec:02d}"
                tags = data.get("tags", "")

                if tmux:
                    print(f"⏱️ {time_str} [{tags}]")
                else:
                    print(f"⏱️ Active Timer: {time_str} | Tags: {tags} | Notes: {data.get('notes', '')}")
    except Exception:
        if tmux:
            print("❌ Daemon Offline")
        else:
            print("❌ Daemon Offline")


@cli_app.command("task")
def add_task(
    title: str = typer.Argument(..., help="Title of the task"),
    priority: int = typer.Option(1, "--priority", "-p", help="Priority (1-4)"),
    est: Optional[int] = typer.Option(None, "--est", "-e", help="Estimated time in minutes")
):
    """Create a new task."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.post("/tasks", json={"title": title, "priority": priority, "estimated_minutes": est})
        if res.status_code == 201:
            task = res.json()
            print(f"✅ Created Task #{task['id']}: '{task['title']}'")
        else:
            print("❌ Failed to create task.")
