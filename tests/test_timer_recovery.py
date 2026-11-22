"""Public timer recovery regressions; synthetic time is not OS-idle certification.

V1's two-commit/clear-before-ACK assertions are superseded by v2's durable receipt contract.
The separate multiple-timer suite covers restart, independent gaps and file-replacement barriers.
"""

import json
import re
from datetime import UTC, datetime, timedelta
from uuid import uuid7

import pytest
from sqlalchemy.exc import OperationalError

from timetrace.core.timer import ActiveTimerState, timer_manager
from timetrace.services.multiple_timer_service import MultipleTimerService


@pytest.fixture(autouse=True)
def private_timer_file(tmp_path, monkeypatch):
    monkeypatch.setattr(timer_manager, "state_file", tmp_path / "active_timer.json")
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "active_timer.json"))


def freeze(client, db, monkeypatch, before=120):
    import timetrace.services.multiple_timer_service as module

    class Clock(datetime):
        instant = datetime(2025, 1, 1, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.instant

    monkeypatch.setattr(module, "datetime", Clock)
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
    assert response.status_code == 200, response.text
    Clock.instant += timedelta(seconds=before + 600)
    MultipleTimerService(db).observe_activity(600)
    MultipleTimerService(db).observe_activity(0)
    status = client.get("/timer/status").json()
    assert client.get("/sessions").json() == []
    return task, status["pending_idle_gap"], status["id"]


def test_frozen_file_reload_preserves_context_without_resuming(client, db, monkeypatch):
    task, gap, timer_id = freeze(client, db, monkeypatch)
    status = client.get("/timer/status").json()
    assert status["mode"] == "pomodoro"
    assert status["target_minutes"] == 25
    assert status["task_id"] == task["id"]
    assert status["task_title"] == "Synthetic recovery task"
    assert status["tags"] == "#focus"
    assert status["notes"] == "Original notes"
    assert status["pending_idle_gap"] == gap
    assert status["is_running"] is False
    assert status["is_frozen_idle"] is True
    assert status["elapsed_seconds"] == 120
    assert MultipleTimerService(db).list_timers()["timers"][0]["id"] == timer_id
    assert client.get("/sessions").json() == []


@pytest.mark.parametrize("option", ["break", "claim_work", "re_tag", "skip"])
@pytest.mark.parametrize("before", [0, 120])
def test_explicit_idle_choices_preserve_exact_intervals_and_require_separate_resume(
    client, db, monkeypatch, option, before
):
    task, gap, timer_id = freeze(client, db, monkeypatch, before)
    response = client.post(
        "/idle/resolve", json={"option": option, "new_tags": "#other", "new_notes": "Retagged notes"}
    )
    if option in ("break", "re_tag"):
        # Old ambiguous classification is explicitly refused, never silently recast as claim.
        assert response.status_code == 409, response.text
        assert client.get("/sessions").json() == []
        assert client.get("/timer/status").json()["pending_idle_gap"] == gap
        return
    assert response.status_code == 200, response.text
    status = client.get("/timer/status").json()
    assert status["is_running"] is False
    assert status["is_frozen_idle"] is False
    assert status["pending_idle_gap"] is None
    stop = client.post(f"/timers/{timer_id}/stop", json={"operation_id": str(uuid7())})
    assert stop.status_code == 200, stop.text
    rows = [client.get(f"/recorded-work/{i}").json() for i in stop.json()["recorded_work_ids"]]
    assert sum(row["duration_seconds"] for row in rows) == before + (600 if option == "claim_work" else 0)
    assert all(row["task_id"] == task["id"] and row["tags"] == "#focus" for row in rows)
    assert all(row["provenance"] == "timer" for row in rows)


def test_second_commit_failure_recovers_stable_work_without_inserting_again(client, db, monkeypatch):
    _, _, timer_id = freeze(client, db, monkeypatch)
    assert client.post("/idle/resolve", json={"option": "claim_work"}).status_code == 200
    commit = db.commit
    commits = 0

    def fail_finalization():
        nonlocal commits
        commits += 1
        if commits == 2:
            raise OperationalError("synthetic finalization commit", {}, Exception("synthetic"))
        commit()

    payload = {"operation_id": str(uuid7())}
    monkeypatch.setattr(db, "commit", fail_finalization)
    failed = client.post(f"/timers/{timer_id}/stop", json=payload)
    assert failed.status_code == 409, failed.text
    assert failed.json()["code"] == "reconciliation_required"
    monkeypatch.setattr(db, "commit", commit)
    assert client.get(f"/operations/{payload['operation_id']}").json()["status"] == "pending_reconciliation"
    response = client.post(f"/timers/{timer_id}/stop", json=payload)
    assert response.status_code == 200, response.text
    assert client.post(f"/timers/{timer_id}/stop", json=payload).json() == response.json()
    assert len(client.get("/sessions").json()) == 2
    assert client.get(f"/operations/{payload['operation_id']}").json()["status"] == "finalized"


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
    assert client.get("/sessions").json() == []


def test_all_seven_pages_and_aliases_render_one_controller_and_reachable_recovery(client):
    task = client.post("/api/tasks", json={"title": "Synthetic route task"}).json()
    for path in [
        "/dashboard",
        "/tasks",
        "/kanban",
        "/tasks-view",
        "/agenda-view",
        "/stats",
        "/habits-view",
        "/revision",
        "/settings/ai",
        "/settings",
        "/settings?category=providers",
        f"/task-inspector/{task['id']}",
        f"/tasks-detail/{task['id']}",
    ]:
        response = client.get(path)
        assert response.status_code == 200
        html = response.text
        assert html.count('src="/static/js/timer_control.js?v=timers4"') == 1
        assert html.count('src="/static/js/multiple_timers.js?v=timers4d"') == 1
        assert html.count('id="multiple_timers"') == 1
        assert html.count('id="idle_resolution_modal"') == 1
        assert len(re.findall(r'href="/static/css/timer\.css(?:\?[^\"]*)?"', html)) == 1
    assert client.get("/", follow_redirects=False).headers["location"] == "/dashboard"


def test_status_retains_mode_target_and_idle_toggle_does_not_clear_gap(client, db, monkeypatch):
    task, gap, _ = freeze(client, db, monkeypatch)
    assert client.post("/idle/toggle", json={"enabled": False}).json() == {"idle_detection_enabled": False}
    status = client.get("/timer/status").json()
    assert status["task_id"] == task["id"]
    assert status["mode"] == "pomodoro"
    assert status["target_minutes"] == 25
    assert status["pending_idle_gap"] == gap
    assert status["elapsed_seconds"] == 120
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
def test_ai_delete_and_stop_preserve_task_link(client, db, monkeypatch, order):
    from timetrace.services.ai_draft_service import AIDraftService

    task, _, timer_id = freeze(client, db, monkeypatch)
    assert client.post("/idle/resolve", json={"option": "skip"}).status_code == 200
    drafts = AIDraftService(db)
    batch = drafts.create_batch(None, None, None, None, None, None).id
    drafts.add_item(batch, "delete", "task", task["id"], {})

    def stop():
        result = client.post(f"/timers/{timer_id}/stop", json={"operation_id": str(uuid7())})
        assert result.status_code == 200, result.text
        return result.json()

    if order == "stop-first":
        result = stop()
        approval = drafts.accept_items(batch)["items"][0]
    else:
        approval = drafts.accept_items(batch)["items"][0]
        result = stop()
    assert approval["status"] == "failed"
    assert client.get(f"/api/tasks/{task['id']}").status_code == 200
    for work_id in result["recorded_work_ids"]:
        assert client.get(f"/recorded-work/{work_id}").json()["task_id"] == task["id"]


def test_timer_start_revalidates_task_before_publishing_context(client):
    tid = client.post("/api/tasks", json={"title": "No dangling timer"}).json()["id"]
    assert client.delete(f"/api/tasks/{tid}").status_code == 204
    assert client.post("/timer/start", json={"task_id": tid}).status_code == 404
    assert client.get("/timer/status").json()["task_id"] is None
    assert client.get("/sessions").json() == []
