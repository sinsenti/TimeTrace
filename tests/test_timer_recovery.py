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
