"""Explicit extension through the actual root HTTP contract."""

import os
import subprocess
import sys
from uuid import uuid4

import pytest


def test_overlap_running_timers_and_work_remain_independent_and_both_bases_refresh(client, tmp_path, monkeypatch):
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    tasks = [client.post("/api/tasks", json={"title": name}).json()["id"] for name in ("A", "B")]
    plans = [
        client.post(
            "/scheduled-sessions",
            json={"task_id": task, "start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"},
        ).json()
        for task in tasks
    ]
    work = client.post(
        "/recorded-work",
        json={"task_id": tasks[0], "start_time": "2000-01-04T09:30:00Z", "end_time": "2000-01-04T10:30:00Z"},
    ).json()
    for plan in plans:
        started = client.post(
            "/timers",
            json={
                "task_id": plan["task_id"],
                "scheduled_session_id": plan["id"],
                "expected_plan_revision": 1,
                "operation_id": str(uuid4()),
            },
        )
        assert started.status_code == 200, started.text
        assert any(item["code"] == "scheduled_session_ended" for item in started.json()["information"])
    before = client.get("/timers").json()
    plan = client.get(f"/scheduled-sessions/{plans[0]['id']}").json()
    # Starting an ended plan leaves its original/current times alone.
    assert plan["end_time"] == "2000-01-04T10:00:00Z"
    response = client.post(
        f"/scheduled-sessions/{plan['id']}/extend",
        json={"end_time": "2000-01-04T11:00:00Z", "expected_revision": plan["revision"], "operation_id": str(uuid4())},
    )
    assert response.status_code == 200, response.text
    assert "warnings" not in response.json()
    after = client.get("/timers").json()
    # elapsed is a read-time presentation; every durable segment/context/revision is unchanged.
    for status in (before, after):
        status.pop("observed_at", None)
        for timer in status["timers"]:
            timer.pop("elapsed_seconds", None)
            timer.pop("remaining_seconds", None)
    assert before == after
    assert client.get(f"/scheduled-sessions/{plans[1]['id']}").json()["end_time"] == "2000-01-04T10:00:00Z"
    assert client.get(f"/recorded-work/{work['id']}").json() == {k: v for k, v in work.items() if k != "warnings"}
    data = client.get(
        "/recorded-work-progress", params={"start_date": "2000-01-04", "end_date": "2000-01-04", "plan_ids": plan["id"]}
    ).json()
    assert data["original"]["fill"]["rows"][0]["value"] == 0.5
    assert data["current"]["fill"]["rows"][0]["value"] == 1


@pytest.mark.parametrize("end", ["2000-01-04T10:00:00Z", "2000-01-04T08:00:00Z"])
def test_extension_rejects_non_extension_and_stale_revision(client, end):
    plan = client.post(
        "/scheduled-sessions", json={"start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"}
    ).json()
    url = f"/scheduled-sessions/{plan['id']}"
    body = {"end_time": end, "operation_id": str(uuid4()), "expected_revision": 1}
    assert client.post(url + "/extend", json=body).status_code == 400
    assert client.get(url).json() == plan
    assert (
        client.post(
            url + "/extend", json={**body, "end_time": "2000-01-04T11:00:00Z", "expected_revision": 2}
        ).status_code
        == 409
    )


def test_virtual_extension_captures_only_selected_originals_with_retry_receipt(client):
    task = client.post(
        "/api/tasks",
        json={
            "title": "Series",
            "is_recurring": True,
            "recurrence_rule": "daily",
            "recurrence_dtstart": "2099-01-04T09:00:00Z",
            "recurrence_duration_minutes": 60,
            "recurrence_timezone": "UTC",
        },
    ).json()
    params = {"start": "2099-01-04T00:00:00Z", "end": "2099-01-06T00:00:00Z"}
    first, second = client.get("/agenda", params=params).json()["items"]
    url = f"/scheduled-sessions/{first['id']}/extend"
    body = {
        "end_time": "2099-01-04T11:00:00Z",
        "expected_projection_revision": first["projection_revision"],
        "operation_id": str(uuid4()),
    }
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["id"] != first["id"] and saved["original_end"] == first["end_time"]
    assert client.post(url, json=body).json() == saved
    assert client.post(url, json={**body, "operation_id": str(uuid4())}).status_code == 409
    assert client.get("/agenda", params=params).json()["items"] == [saved, second]
    assert client.get(f"/api/tasks/{task['id']}").json()["recurrence_duration_minutes"] == 60
    assert client.post(url, json={**body, "end_time": "2099-01-04T12:00:00Z"}).status_code == 409


def test_concurrent_extensions_require_review_and_old_receipt_stays_fixed(tmp_path):
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "concurrent.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "timers.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
    }
    script = """
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from fastapi.testclient import TestClient
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
init_db()
client = TestClient(create_daemon_app())
    plan = client.post(
        "/scheduled-sessions", json={"start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"}
    ).json()
    url = f"/scheduled-sessions/{plan['id']}"
    bodies = [
        {"end_time": f"2000-01-04T{hour}:00:00Z", "expected_revision": 1, "operation_id": str(uuid4())}
        for hour in ("11", "12")
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda body: client.post(url + "/extend", json=body), bodies))
    assert sorted(reply.status_code for reply in replies) == [200, 409]
    index = next(i for i, reply in enumerate(replies) if reply.status_code == 200)
    saved = replies[index].json()
    newer = client.post(
        url + "/extend", json={"end_time": "2000-01-04T13:00:00Z", "expected_revision": 2, "operation_id": str(uuid4())}
    )
    assert newer.status_code == 200
    assert client.post(url + "/extend", json=bodies[index]).json() == saved
    assert client.get(url).json() == newer.json()
"""
    # A real per-request DB session is required; the ordinary fixture intentionally shares one.
    script = script.replace("\n    ", "\n")
    result = subprocess.run([sys.executable, "-P", "-c", script], env=env, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr


def test_extension_is_explicit_preserves_original_and_replays_fixed_receipt(client):
    plan = client.post(
        "/scheduled-sessions",
        json={
            "start_time": "2000-01-04T09:00:00Z",
            "end_time": "2000-01-04T10:00:00Z",
        },
    ).json()
    url = f"/scheduled-sessions/{plan['id']}"
    assert client.get(url).json() == plan
    payload = {"end_time": "2000-01-04T11:00:00Z", "expected_revision": 1, "operation_id": "extension-tracer"}
    response = client.post(url + "/extend", json=payload)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved == {**plan, "end_time": payload["end_time"], "duration_seconds": 7200, "revision": 2}
    assert client.post(url + "/extend", json=payload).json() == saved
    assert client.post(url + "/extend", json={**payload, "end_time": "2000-01-04T12:00:00+01:00"}).json() == saved
    assert client.get("/operations/extension-tracer").json()["result"] == saved
    assert client.get(url).json() == saved
    assert client.get("/sessions").json() == []
