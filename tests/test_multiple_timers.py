"""Targeted timer behavior at the actual root HTTP seam; private files only."""

import json
import os
import subprocess
import sys
from uuid import uuid4


def test_independent_taskless_timers_survive_new_reader(client, tmp_path, monkeypatch):
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "active_timer.json"))
    first = client.post("/timers", json={"operation_id": str(uuid4())})
    assert first.status_code == 200, first.text
    second = client.post("/timers", json={"operation_id": str(uuid4())})
    assert second.status_code == 200, second.text
    a, b = first.json()["timer"], second.json()["timer"]
    assert a["id"] != b["id"]
    # Each request constructs a new service and rereads durable state.
    status = client.get("/timers")
    assert status.status_code == 200, status.text
    assert {row["id"] for row in status.json()["timers"]} == {a["id"], b["id"]}
    assert all(row["state"] == "running" for row in status.json()["timers"])


def test_start_same_task_selects_existing_without_changing_context(client, tmp_path, monkeypatch):
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "active_timer.json"))
    task = client.post("/api/tasks", json={"title": "Writing"}).json()
    first = client.post("/timers", json={"operation_id": str(uuid4()), "task_id": task["id"], "notes": "first"})
    assert first.status_code == 200, first.text
    second = client.post("/timers", json={"operation_id": str(uuid4()), "task_id": task["id"], "notes": "second"})
    assert second.status_code == 200, second.text
    assert second.json()["timer"]["id"] == first.json()["timer"]["id"]
    assert second.json()["selected_existing"] is True
    assert second.json()["timer"]["notes"] == "first"


def test_targeted_pause_resume_stop_and_retry_preserve_other_timer(client, tmp_path, monkeypatch):
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    a = client.post("/timers", json={"operation_id": str(uuid4())}).json()["timer"]
    b = client.post("/timers", json={"operation_id": str(uuid4())}).json()["timer"]
    paused = client.post(f"/timers/{a['id']}/pause", json={"operation_id": str(uuid4())})
    assert paused.status_code == 200, paused.text
    assert paused.json()["timer"]["state"] == "paused"
    running = client.post(f"/timers/{a['id']}/resume", json={"operation_id": str(uuid4())})
    assert running.status_code == 200, running.text
    operation = {"operation_id": str(uuid4())}
    stopped = client.post(f"/timers/{a['id']}/stop", json=operation)
    assert stopped.status_code == 200, stopped.text
    again = client.post(f"/timers/{a['id']}/stop", json=operation)
    assert again.json() == stopped.json()
    assert len(stopped.json()["recorded_work_ids"]) == 2
    for work_id in stopped.json()["recorded_work_ids"]:
        row = client.get(f"/recorded-work/{work_id}")
        assert row.status_code == 200, row.text
        assert row.json()["provenance"] == "timer"
    assert {t["id"] for t in client.get("/timers").json()["timers"]} == {b["id"]}


def test_independent_timers_survive_process_restart(tmp_path):
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "restart.db"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "timers.json"),
    }
    code = """
import json
from uuid import uuid4
from fastapi.testclient import TestClient
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
init_db()
c = TestClient(create_daemon_app())
for _ in range(2):
    r = c.post("/timers", json={"operation_id": str(uuid4())})
    assert r.status_code == 200, r.text
print(json.dumps(c.get("/timers").json()))
"""
    first = subprocess.run([sys.executable, "-P", "-c", code], env=env, capture_output=True, text=True, check=True)
    read = code[0 : code.index("for _ in range(2):")] + 'print(json.dumps(c.get("/timers").json()))'
    second = subprocess.run([sys.executable, "-P", "-c", read], env=env, capture_output=True, text=True, check=True)
    a, b = json.loads(first.stdout), json.loads(second.stdout)
    assert len(a["timers"]) == 2
    for before, after in zip(a["timers"], b["timers"], strict=True):
        assert after.pop("elapsed_seconds") >= before.pop("elapsed_seconds")
        assert after == before
    assert b["revision"] == a["revision"]
