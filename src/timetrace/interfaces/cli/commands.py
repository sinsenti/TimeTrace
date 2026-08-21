from datetime import UTC, datetime, timedelta
from pathlib import Path

import typer
import uvicorn

from timetrace.config import settings
from timetrace.core.ids import short_id
from timetrace.interfaces.cli.client import ensure_daemon_running, get_client, resolve_task_id

cli_app = typer.Typer(
    name="timetrace",
    help="TimeTrace: Developer-centric time tracking & productivity engine.",
    no_args_is_help=False,
)

db_cli = typer.Typer(help="Database migration and maintenance subcommands.")
cli_app.add_typer(db_cli, name="db")


@cli_app.callback(invoke_without_command=True)
def main_callback(ctx: typer.Context):
    """Default invocation when running 'timetrace' with no subcommands."""
    if ctx.invoked_subcommand is None:
        timer_status(tmux=False)


def format_local_cli_time(iso_str: str | None) -> str:
    """Helper to convert UTC ISO strings to local system timezone string for CLI."""
    if not iso_str:
        return ""
    try:
        clean = str(iso_str)
        if not clean.endswith("Z") and "+" not in clean and "-" not in clean[10:]:
            clean += "Z"
        dt = datetime.fromisoformat(clean.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone().strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(iso_str)[:16].replace("T", " ")


@cli_app.command("daemon")
def run_daemon():
    """Start the TimeTrace FastAPI background daemon."""
    print(f"Starting TimeTrace daemon on http://{settings.host}:{settings.port}...")
    uvicorn.run("timetrace.main:daemon_app", host=settings.host, port=settings.port, reload=False)


@db_cli.command("migrate")
def db_migrate():
    """Run all pending Alembic database migrations."""
    from timetrace.db.session import run_migrations

    print("Running database migrations...")
    run_migrations()
    print("Database is up to date.")


@db_cli.command("revision")
def db_revision(message: str = typer.Option(..., "--message", "-m", help="Revision description message")):
    """Generate a new auto-detected migration revision."""
    from alembic import command
    from alembic.config import Config

    project_root = Path(__file__).resolve().parents[4]
    ini_path = project_root / "alembic.ini"

    if not ini_path.exists():
        print(f"Error: Could not locate alembic.ini at {ini_path}")
        raise typer.Exit(1)

    alembic_cfg = Config(str(ini_path))
    alembic_cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.revision(alembic_cfg, message=message, autogenerate=True)
    print(f"Generated revision: {message}")


@cli_app.command("idle-toggle")
def toggle_idle_cli():
    """Toggle the automatic idle detector on or off."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.post("/idle/toggle", json={})
        if res.status_code == 200:
            state = res.json()["idle_detection_enabled"]
            status_str = "ENABLED" if state else "DISABLED"
            print(f"Inactivity Idle Detector is now {status_str}")


@cli_app.command("start")
def start_timer(
    tags: str = typer.Option("", "--tags", "-t", help="Tags for session (e.g. '#programming')"),
    notes: str = typer.Option("", "--notes", "-n", help="Notes for session"),
    task_id: str | None = typer.Option(None, "--task", "-k", help="Task ID to attach"),
    pomo: int | None = typer.Option(None, "--pomo", "-p", help="Pomodoro duration in minutes"),
):
    """Start active session timer."""
    ensure_daemon_running()
    mode = "pomodoro" if pomo and pomo > 0 else "flowtime"
    if task_id:
        task_id = resolve_task_id(task_id)
    with get_client() as client:
        res = client.post(
            "/timer/start",
            json={
                "task_id": task_id,
                "tags": tags,
                "notes": notes,
                "mode": mode,
                "target_minutes": pomo,
            },
        )
        if res.status_code == 200:
            print(f"Timer started ({mode}).")
        else:
            print(f"Error: {res.json().get('detail')}")


@cli_app.command("split")
def split_timer(
    tags: str = typer.Option("", "--tags", "-t", help="New tags for switched activity"),
    notes: str = typer.Option("", "--notes", "-n", help="New notes for switched activity"),
):
    """Split active timer and start a new session immediately."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.post("/timer/split", json={"new_tags": tags, "new_notes": notes})
        if res.status_code == 200:
            print("Timer split successfully. New session started.")
        else:
            print(f"Error: {res.json().get('detail')}")


@cli_app.command("stop")
def stop_timer():
    """Stop active timer and save session."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.post("/timer/stop")
        if res.status_code == 200:
            data = res.json()
            duration_min = round(data.get("duration_seconds", 0) / 60, 1)
            print(f"Timer stopped. Saved Session #{data['id']} ({duration_min} mins).")
        else:
            print(f"Error: {res.json().get('detail')}")


@cli_app.command("retro")
def retro_session(
    start_mins_ago: int = typer.Option(60, "--start-ago", "-s", help="Minutes ago session started"),
    duration_mins: int = typer.Option(30, "--duration", "-d", help="Duration of past session in minutes"),
    tags: str = typer.Option("#general", "--tags", "-t", help="Tags for session"),
    notes: str = typer.Option("", "--notes", "-n", help="Notes for session"),
):
    """Retroactively log a past untracked session."""
    ensure_daemon_running()
    end_dt = datetime.now(UTC) - timedelta(minutes=(start_mins_ago - duration_mins))
    start_dt = end_dt - timedelta(minutes=duration_mins)

    with get_client() as client:
        res = client.post(
            "/sessions/retro",
            json={
                "start_time": start_dt.isoformat(),
                "end_time": end_dt.isoformat(),
                "tags": tags,
                "notes": notes,
            },
        )
        if res.status_code == 201:
            data = res.json()
            print(f"Retroactive Session #{data['id']} saved ({duration_mins} mins).")
        else:
            print(f"Error: {res.json().get('detail')}")


@cli_app.command("status")
def timer_status(tmux: bool = typer.Option(False, "--tmux", help="Output minimal format for Tmux status bar")):
    """Check active timer status."""
    try:
        with get_client() as client:
            res = client.get("/timer/status")
            if res.status_code == 200:
                data = res.json()
                if not data["is_running"]:
                    if data.get("is_frozen_idle"):
                        msg = "AFK Frozen" if tmux else "Timer frozen due to AFK inactivity."
                    else:
                        msg = "Idle" if tmux else "No timer currently running."
                    print(msg)
                    return

                elapsed_min = data["elapsed_seconds"] // 60
                elapsed_sec = data["elapsed_seconds"] % 60
                time_str = f"{elapsed_min:02d}:{elapsed_sec:02d}"
                tags = data.get("tags", "")

                if tmux:
                    print(f"{time_str} [{tags}]")
                else:
                    print(f"Active Timer: {time_str} | Tags: {tags} | Notes: {data.get('notes', '')}")
    except Exception:
        print("Daemon Offline")


@cli_app.command("summary")
def summary_stats():
    """View aggregated hours grouped by tags and activities."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.get("/analytics/summary")
        if res.status_code == 200:
            data = res.json()
            print("\nTimeTrace Activity Breakdown:")
            print("-" * 40)
            for item in data:
                print(f"- {item['tag']:<20} : {item['total_hours']:>5.1f} hrs ({item['session_count']} sessions)")
            print("-" * 40 + "\n")


@cli_app.command("tasks")
def list_tasks_cli(
    status_filter: str = typer.Option("all", "--status", "-s", help="Filter status: all, To Do, Ongoing, Scheduled, Done, Backlog"),
    category_filter: str = typer.Option("all", "--category", "-c", help="Filter category: all, work, family, personal, study"),
    sort_by: str = typer.Option("smart_gap_filler", "--sort", "-o", help="Sort by: smart_gap_filler, priority, created_at, title"),
):
    """List tasks with filtering and sorting."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.get(f"/api/tasks?status={status_filter}&category={category_filter}&sort={sort_by}")
        if res.status_code == 200:
            tasks = res.json()
            print(f"\nTasks [{status_filter.upper()} / {category_filter.upper()}] sorted by [{sort_by.upper()}]:")
            print("-" * 95)
            if not tasks:
                print("No tasks found.")
            today = datetime.now().date()
            for t in tasks:
                t_tags = f"[{t.get('tags', '')}]" if t.get("tags") else ""
                parent_str = f"(Subtask of #{short_id(t['parent_id'])})" if t.get("parent_id") else ""
                title_str = f"{t['title']} {t_tags} {parent_str}".strip()
                est_str = f"{t.get('estimated_minutes', 15)}m"

                due_alert = ""
                if t.get("due_date"):
                    try:
                        due_dt = datetime.fromisoformat(t["due_date"].replace("Z", "+00:00")).date()
                        if due_dt < today:
                            due_alert = " | [OVERDUE]"
                        elif due_dt == today:
                            due_alert = " | [DUE TODAY]"
                        elif due_dt == today + timedelta(days=1):
                            due_alert = " | [DUE TOMORROW]"
                        else:
                            due_alert = f" | [Due: {due_dt.strftime('%b %d')}]"
                    except Exception:
                        pass

                print(
                    f"#{short_id(t['id']):<8} | [{t['priority']:<6}] | [{t['status']:<10}] | "
                    f"[{t.get('category', 'work'):<8}] | {est_str:<4} | {title_str}{due_alert}"
                )
            print("-" * 95 + "\n")


@cli_app.command("task")
def add_task(
    title: str = typer.Argument(..., help="Title of the task"),
    priority: str = typer.Option("-", "--priority", "-p", help="Priority (-, low, medium, high)"),
    category: str = typer.Option("work", "--category", "-c", help="Category (work, family, personal, study)"),
    tags: str = typer.Option("", "--tags", "-t", help="Default tags for task"),
    est: int = typer.Option(15, "--est", "-e", help="Estimated duration in minutes"),
    parent_id: str | None = typer.Option(None, "--parent", "-parent", help="Parent task ID for subtasks"),
    status_name: str = typer.Option("To Do", "--status", "-s", help="Initial status name"),
):
    """Create a new task slot or subtask."""
    ensure_daemon_running()
    if parent_id:
        parent_id = resolve_task_id(parent_id)
    with get_client() as client:
        res = client.post(
            "/api/tasks",
            json={
                "title": title,
                "priority": priority.lower(),
                "category": category.lower(),
                "tags": tags,
                "estimated_minutes": est,
                "parent_id": parent_id,
                "status": status_name,
            },
        )
        if res.status_code == 201:
            task = res.json()
            parent_msg = f" (Subtask of #{parent_id})" if parent_id else ""
            print(f"Created Task #{task['id']}{parent_msg}: '{task['title']}' [Category: {task['category']}, Est: {task['estimated_minutes']}m]")
        else:
            print("Failed to create task.")


@cli_app.command("task-tree")
def view_task_tree_cli(task_id: str = typer.Argument(..., help="ID of the root task to inspect")):
    """View nested subtasks hierarchy tree for a parent task."""
    ensure_daemon_running()
    task_id = resolve_task_id(task_id)
    with get_client() as client:
        res = client.get(f"/api/tasks/{task_id}/tree")
        if res.status_code == 200:
            tree = res.json()

            def print_node(node, depth=0):
                indent = "  " * depth
                st = node.get("status", "To Do")
                prio = node.get("priority", "-")
                est = node.get("estimated_minutes", 15)
                print(f"{indent}- #{node['id']} [{st}] [{prio}] ({est}m) : {node['title']}")
                for child in node.get("subtasks", []):
                    print_node(child, depth + 1)

            print(f"\nSubtask Hierarchy Tree for #{task_id}:")
            print("-" * 60)
            print_node(tree)
            print("-" * 60 + "\n")
        else:
            print(f"Task #{task_id} not found.")


@cli_app.command("task-delete")
def delete_task_cli(task_id: str = typer.Argument(..., help="ID of the task to delete")):
    """Delete a task slot by ID."""
    ensure_daemon_running()
    task_id = resolve_task_id(task_id)
    with get_client() as client:
        res = client.delete(f"/api/tasks/{task_id}")
        if res.status_code == 204:
            print(f"Task #{task_id} deleted successfully.")
        else:
            print(f"Failed to delete Task #{task_id}.")


@cli_app.command("task-clean")
def clean_completed_tasks_cli():
    """Remove all completed tasks."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.delete("/api/tasks/completed")
        if res.status_code == 200:
            data = res.json()
            print(f"Cleaned up {data['deleted_count']} completed tasks.")
        else:
            print("Failed to clean completed tasks.")


@cli_app.command("export-md")
def export_markdown(out_file: Path | None = typer.Option(None, "--out", "-o", help="File path to save markdown log")):
    """Export tracked sessions to structured Markdown format."""
    ensure_daemon_running()
    with get_client() as client:
        res = client.get("/markdown/export")
        if res.status_code == 200:
            content = res.text
            if out_file:
                out_file.write_text(content, encoding="utf-8")
                print(f"Log exported to {out_file}")
            else:
                print(content)


@cli_app.command("import-md")
def import_markdown(in_file: Path = typer.Argument(..., help="Path to markdown file to import")):
    """Import sessions and reflections from a structured Markdown log."""
    ensure_daemon_running()
    if not in_file.exists():
        print(f"File '{in_file}' not found.")
        return

    content = in_file.read_text(encoding="utf-8")
    with get_client() as client:
        res = client.post("/markdown/import", content=content, headers={"Content-Type": "text/plain"})
        if res.status_code == 201:
            data = res.json()
            print(f"Imported {data['imported_sessions']} sessions from '{in_file}'.")
        else:
            print("Failed to import markdown file.")
