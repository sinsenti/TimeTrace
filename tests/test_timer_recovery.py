"""Real daemon/API + private timer-file recovery; freeze time is synthetic, never OS idle."""

import json
import re
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import OperationalError

from timetrace.core.timer import ActiveTimerState, timer_manager


@pytest.fixture(autouse=True)
def private_timer_file(tmp_path, monkeypatch):
    monkeypatch.setattr(timer_manager, "state_file", tmp_path / "active_timer.json")
    monkeypatch.setattr(timer_manager, "mode", "flowtime")
    monkeypatch.setattr(timer_manager, "target_minutes", None)


def freeze(client, before=120):
    task = client.post("/api/tasks", json={"title": "Synthetic recovery task"}).json()
    response = client.post(
        "/timer/start",
        json={
            "task_id": task["id"],
            "tags": "#focus",
            "notes": "Original notes",
            "mode": "pomodoro",
            "target_minutes": 25,
        },
    )
    assert response.status_code == 200
    timer_manager.start_time = datetime.now(UTC) - timedelta(seconds=before + 600)
    gap = timer_manager.freeze_for_idle(600)
    assert client.get("/sessions").json() == []
    return task, gap


def test_frozen_file_reload_preserves_context_without_resuming(client, monkeypatch):
    task, gap = freeze(client)
    # New state instance simulates process boot, from the exact persisted private file.
    monkeypatch.setattr("timetrace.core.timer.settings.db_file", timer_manager.state_file.parent / "test.db")
    loaded = ActiveTimerState()
    status = loaded.get_status()
    assert status["mode"] == "pomodoro"
    assert status["target_minutes"] == 25
    assert status["task_id"] == task["id"]
    assert status["task_title"] == "Synthetic recovery task"
    assert status["tags"] == "#focus"
    assert status["notes"] == "Original notes"
    assert status["pending_idle_gap"] == gap
    assert status["is_running"] is False
    assert status["is_frozen_idle"] is True
    assert status["elapsed_seconds"] == 0
    assert status["remaining_seconds"] is None
    assert client.get("/sessions").json() == []


@pytest.mark.parametrize(
    "option,gap_tags,gap_notes",
    [
        ("break", "#break", "AFK Break Time"),
        ("claim_work", "#focus", "Claimed AFK Work: Original notes"),
        ("re_tag", "#other", "Retagged notes"),
        ("skip", None, None),
    ],
)
@pytest.mark.parametrize("before", [0, 120])
def test_explicit_idle_choices_log_exact_intervals_and_clear_file(client, option, gap_tags, gap_notes, before):
    task, gap = freeze(client, before)
    response = client.post(
        "/idle/resolve", json={"option": option, "new_tags": "#other", "new_notes": "Retagged notes"}
    )
    assert response.status_code == 200
    rows = client.get("/sessions").json()
    assert len(rows) == (1 if before else 0) + (1 if gap_tags else 0)
    if before:
        work = next(row for row in rows if row["notes"] == "Original notes")
        assert work["duration_seconds"] == 120
        assert work["tags"] == "#focus"
    if gap_tags:
        idle = next(row for row in rows if row["notes"] == gap_notes)
        assert idle["duration_seconds"] == 600
        assert idle["tags"] == gap_tags
        assert datetime.fromisoformat(idle["start_time"]) == datetime.fromisoformat(gap["idle_start"])
        assert datetime.fromisoformat(idle["end_time"]) == datetime.fromisoformat(gap["idle_end"])
    assert all(row["task_id"] == task["id"] for row in rows)
    status = client.get("/timer/status").json()
    assert status["is_running"] is False
    assert status["is_frozen_idle"] is False
    assert status["pending_idle_gap"] is None
    persisted = json.loads(timer_manager.state_file.read_text())
    assert persisted["pending_idle_gap"] is None
    assert persisted["is_running"] is False
    assert client.post("/idle/resolve", json={"option": option}).status_code == 400
    assert len(client.get("/sessions").json()) == len(rows)


def test_second_commit_failure_really_leaves_preidle_row_and_pending_gap(client, db, monkeypatch):
    _, gap = freeze(client)
    commit = db.commit
    commits = 0

    def fail_second_commit():
        nonlocal commits
        commits += 1
        if commits == 2:
            raise OperationalError("synthetic second commit", {}, Exception("synthetic"))
        commit()

    monkeypatch.setattr(db, "commit", fail_second_commit)
    with pytest.raises(OperationalError):
        client.post("/idle/resolve", json={"option": "break"})
    db.rollback()
    # This is deliberately NOT atomic: readback cannot establish safe replay of the gap.
    rows = client.get("/sessions").json()
    assert len(rows) == 1
    assert rows[0]["duration_seconds"] == 120
    assert rows[0]["notes"] == "Original notes"
    assert client.get("/timer/status").json()["pending_idle_gap"] == gap
    assert json.loads(timer_manager.state_file.read_text())["pending_idle_gap"] == gap


@pytest.mark.parametrize(
    "raw,expected",
    [
        (
            {"is_running": True, "start_time": "2026-10-01T10:00:00+00:00", "mode": "pomodoro", "target_minutes": 25},
            True,
        ),
        ({"is_running": False, "mode": "pomodoro", "target_minutes": 25}, False),
        ({"is_running": False, "is_frozen_idle": True, "pending_idle_gap": {"idle_seconds": 600}}, False),
    ],
)
def test_running_stopped_and_legacy_file_defaults(client, monkeypatch, raw, expected):
    timer_manager.state_file.write_text(json.dumps(raw))
    monkeypatch.setattr("timetrace.core.timer.settings.db_file", timer_manager.state_file.parent / "test.db")
    loaded = ActiveTimerState()
    assert loaded.is_running is expected
    assert loaded.pending_idle_gap == raw.get("pending_idle_gap")
    assert loaded.mode == ("pomodoro" if expected else "flowtime")
    assert loaded.target_minutes == (25 if expected else None)
    assert client.get("/sessions").json() == []


def test_all_seven_pages_and_aliases_render_one_controller_and_reachable_recovery(client):
    task = client.post("/api/tasks", json={"title": "Synthetic route task"}).json()
    paths = [
        "/dashboard",
        "/tasks",
        "/kanban",
        "/tasks-view",
        "/stats",
        "/habits-view",
        "/revision",
        "/settings/ai",
        "/settings",
        "/settings?category=providers",
        f"/task-inspector/{task['id']}",
        f"/tasks-detail/{task['id']}",
    ]
    for path in paths:
        response = client.get(path)
        assert response.status_code == 200
        html = response.text
        assert html.count('src="/static/js/timer_control.js"') == 1
        assert html.count('id="idle_resolution_modal"') == 1
        assert len(re.findall(r'href="/static/css/timer\.css(?:\?[^"]*)?"', html)) == 1
        assert html.count('id="toggle_btn"') == (1 if path == "/dashboard" else 0)
        assert 'href="/settings" onclick="return followSettingsLink(event)"' in html
    root = client.get("/", follow_redirects=False)
    assert root.status_code == 307
    assert root.headers["location"] == "/dashboard"


def test_status_retains_mode_target_attachment_and_idle_toggle_does_not_clear_gap(client):
    task, gap = freeze(client)
    response = client.post("/idle/toggle", json={"enabled": False})
    assert response.json() == {"idle_detection_enabled": False}
    status = client.get("/timer/status").json()
    assert status["task_id"] == task["id"]
    assert status["mode"] == "pomodoro"
    assert status["target_minutes"] == 25
    assert status["pending_idle_gap"] == gap
    assert status["elapsed_seconds"] == 0
    assert status["remaining_seconds"] is None
    assert client.get("/sessions").json() == []


def test_idle_status_names_next_persisted_plan_without_changing_legacy_wire(client):
    start = datetime.now(UTC) + timedelta(hours=2)
    response = client.post(
        "/scheduled-sessions",
        json={
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=1)).isoformat(),
            "notes": "Reserved focus",
        },
    )
    assert response.status_code == 201
    status = client.get("/timer/status").json()
    upcoming = status["next_session"]
    assert upcoming == status["next_scheduled_session"]
    assert set(upcoming) == {"title", "start_time", "starts_in_minutes"}
    assert upcoming["title"] == "Reserved focus"
    assert datetime.fromisoformat(upcoming["start_time"]) == start


@pytest.mark.parametrize("order", ["stop-first", "approval-first"])
def test_ai_delete_and_stop_serialize_without_losing_the_task_link(tmp_path, monkeypatch, order):
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path
    from threading import Event

    from sqlalchemy import event
    from sqlmodel import Session, SQLModel, create_engine

    from timetrace.interfaces.api.schemas import TaskCreate, TimerStartRequest
    from timetrace.services.ai_draft_service import AIDraftService
    from timetrace.services.session_service import SessionService
    from timetrace.services.task_service import TaskService
    from timetrace.services.timer_service import TimerService

    engine = create_engine(f"sqlite:///{tmp_path / 'race.db'}")

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        tid = TaskService(db).create_task(TaskCreate(title="Timer race")).id
        drafts = AIDraftService(db)
        batch = drafts.create_batch(None, None, None, None, None, None).id
        drafts.add_item(batch, "delete", "task", tid, {})
        TimerService(db).start_timer(TimerStartRequest(task_id=tid))

    def approve():
        with Session(engine) as db:
            return AIDraftService(db).accept_items(batch)["items"][0]

    def stop():
        with Session(engine) as db:
            return TimerService(db).stop_timer().task_id

    if order == "stop-first":
        cleared, resume = Event(), Event()
        write = Path.write_text

        def hold_after_timer_file_clear(path, text, *args, **kwargs):
            result = write(path, text, *args, **kwargs)
            if path == timer_manager.state_file and not json.loads(text)["is_running"]:
                cleared.set()
                assert resume.wait(5)
            return result

        monkeypatch.setattr(Path, "write_text", hold_after_timer_file_clear)
        with ThreadPoolExecutor(max_workers=2) as pool:
            stopping = pool.submit(stop)
            try:
                assert cleared.wait(5)
                approval = pool.submit(approve)
                # Let the actual competing SQLite transaction run while file clear is held.
                try:
                    result = approval.result(timeout=0.3)
                    assert result["status"] == "failed", result
                except TimeoutError:
                    pass
            finally:
                resume.set()
            assert stopping.result(timeout=5) == tid
            result = approval.result(timeout=5)
    else:
        locked, resume = Event(), Event()

        # Observe the approval connection's actual first successful SQLite write.
        # Hold it before the rest of the approval can inspect live timer context.
        def hold_sqlite_writer(_conn, _cursor, statement, _params, _context, _many):
            if not locked.is_set() and statement.lstrip().upper().startswith("UPDATE "):
                locked.set()
                assert resume.wait(5)

        event.listen(engine, "after_cursor_execute", hold_sqlite_writer)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                approval = pool.submit(approve)
                try:
                    assert locked.wait(5)
                    stopping = pool.submit(stop)
                    with pytest.raises(TimeoutError):
                        stopping.result(timeout=0.3)
                    assert json.loads(timer_manager.state_file.read_text())["task_id"] == tid
                finally:
                    resume.set()
                result = approval.result(timeout=5)
                assert stopping.result(timeout=5) == tid
        finally:
            event.remove(engine, "after_cursor_execute", hold_sqlite_writer)

    assert result["status"] == "failed"
    with Session(engine) as db:
        (saved,) = SessionService(db).list_sessions()
        assert saved["task_id"] == tid
        assert TaskService(db).get_task_tree(tid)["id"] == tid
        assert not TimerService(db).get_status()["is_running"]
    engine.dispose()


def test_timer_start_revalidates_task_before_publishing_context(client):
    tid = client.post("/api/tasks", json={"title": "No dangling timer"}).json()["id"]
    assert client.delete(f"/api/tasks/{tid}").status_code == 204
    response = client.post("/timer/start", json={"task_id": tid})
    assert response.status_code == 404
    assert client.get("/timer/status").json()["task_id"] is None
    assert client.get("/sessions").json() == []
