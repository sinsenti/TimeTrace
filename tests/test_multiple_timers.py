"""Targeted timer behavior at the actual root HTTP seam; private files only."""

import json
import os
import subprocess
import sys
from uuid import uuid4

import pytest


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


def test_idle_gaps_are_independent_and_end_at_return_not_review(client, db, tmp_path, monkeypatch):
    from datetime import UTC, datetime

    import timetrace.services.multiple_timer_service as timers

    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))

    class Clock(datetime):
        instant = datetime(2025, 1, 1, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.instant

    monkeypatch.setattr(timers, "datetime", Clock)
    a = client.post("/timers", json={"operation_id": str(uuid4())}).json()["timer"]
    b = client.post("/timers", json={"operation_id": str(uuid4())}).json()["timer"]
    c = client.post("/timers", json={"operation_id": str(uuid4()), "pause_when_idle": False}).json()["timer"]
    Clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    timers.MultipleTimerService(db).observe_activity(600)
    Clock.instant = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    timers.MultipleTimerService(db).observe_activity(0)
    Clock.instant = datetime(2025, 1, 1, 10, 45, tzinfo=UTC)
    status = client.get("/timers").json()["timers"]
    by_id = {t["id"]: t for t in status}
    for timer, decision in ((a, "discard"), (b, "claim")):
        gap = by_id[timer["id"]]["idle_gaps"][0]
        result = client.post(
            f"/timers/{timer['id']}/resolve",
            json={"operation_id": str(uuid4()), "gap_id": gap["id"], "decision": decision},
        )
        assert result.status_code == 200, result.text
        assert result.json()["timer"]["state"] == "paused"
    assert by_id[c["id"]]["state"] == "running"
    assert by_id[a["id"]]["elapsed_seconds"] == 600
    assert by_id[b["id"]]["idle_gaps"][0]["return_at"] == "2025-01-01T10:30:00+00:00"
    for timer, expected in ((a, 600), (b, 1800)):
        stop = client.post(f"/timers/{timer['id']}/stop", json={"operation_id": str(uuid4())})
        assert stop.status_code == 200, stop.text
        rows = [client.get(f"/recorded-work/{i}").json() for i in stop.json()["recorded_work_ids"]]
        assert sum(row["duration_seconds"] for row in rows) == expected


def test_failed_replacement_blocks_different_keys_and_idle_until_reconciled(client, db, tmp_path, monkeypatch):
    from timetrace.services.multiple_timer_service import MultipleTimerService

    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    start = {"operation_id": str(uuid4())}
    timer = client.post("/timers", json=start).json()["timer"]
    assert client.post("/timers", json=start).json()["timer"]["id"] == timer["id"]
    stop = {"operation_id": str(uuid4())}
    replace = os.replace
    calls = 0

    def fail_after_intent(source, destination):
        nonlocal calls
        calls += 1
        if calls >= 2:
            raise OSError("injected replacement failure")
        return replace(source, destination)

    monkeypatch.setattr(os, "replace", fail_after_intent)
    with pytest.raises(OSError, match="injected"):
        client.post(f"/timers/{timer['id']}/stop", json=stop)
    pending = client.get(f"/operations/{stop['operation_id']}")
    assert pending.status_code == 200, pending.text
    assert pending.json()["status"] == "pending_reconciliation"
    with pytest.raises(OSError, match="injected"):
        client.post("/timers", json={"operation_id": str(uuid4())})
    with pytest.raises(OSError, match="injected"):
        MultipleTimerService(db).observe_activity(600)
    monkeypatch.setattr(os, "replace", replace)
    recovered = client.post(f"/timers/{timer['id']}/stop", json=stop)
    assert recovered.status_code == 200, recovered.text
    assert len(recovered.json()["recorded_work_ids"]) == 1
    assert client.post(f"/timers/{timer['id']}/stop", json=stop).json() == recovered.json()
    assert client.get(f"/operations/{stop['operation_id']}").json()["status"] == "finalized"
    assert client.get("/timers").json()["timers"] == []


def test_v1_frozen_upgrade_preserves_context_elapsed_and_uncertain_gap(client, tmp_path, monkeypatch):
    path = tmp_path / "active_timer.json"
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(path))
    raw = {
        "is_running": False,
        "is_frozen_idle": True,
        "task_id": None,
        "task_title": "Old title",
        "start_time": "2025-01-01T10:00:00+00:00",
        "tags": "#old",
        "notes": "preserved",
        "mode": "pomodoro",
        "target_minutes": 25,
        "idle_detection_enabled": True,
        "pending_idle_gap": {
            "idle_start": "2025-01-01T10:10:00+00:00",
            "idle_end": "2025-01-01T10:20:00+00:00",
            "opaque": ["preserve"],
            "saved_session": {
                "start_time": "2025-01-01T10:00:00+00:00",
                "end_time": "2025-01-01T10:10:00+00:00",
                "duration_seconds": 600,
            },
        },
    }
    path.write_text(json.dumps(raw))
    first = client.get("/timers")
    assert first.status_code == 200, first.text
    timer = first.json()["timers"][0]
    assert timer["state"] == "frozen"
    assert timer["elapsed_seconds"] == 600
    assert timer["notes"] == "preserved"
    assert timer["idle_gaps"][0]["return_at"] is None
    assert timer["idle_gaps"][0]["boundary_source"] == "legacy_uncertain"
    assert timer["legacy_payload"] == raw
    assert client.get("/timers").json()["timers"][0]["id"] == timer["id"]
    assert json.loads(path.with_suffix(".v1.backup").read_text()) == raw


def test_start_ended_plan_is_information_only_and_paused_selection_does_not_resume(client, tmp_path, monkeypatch):
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    task = client.post("/api/tasks", json={"title": "Writing"}).json()
    plan_response = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2025-01-01T09:00:00Z", "end_time": "2025-01-01T10:00:00Z"},
    )
    assert plan_response.status_code == 201, plan_response.text
    plan = plan_response.json()
    response = client.post(
        "/timers",
        json={
            "operation_id": str(uuid4()),
            "task_id": task["id"],
            "scheduled_session_id": plan["id"],
            "expected_plan_revision": plan["revision"],
        },
    )
    assert response.status_code == 200, response.text
    timer = response.json()["timer"]
    assert timer["scheduled_session_id"] == plan["id"]
    assert "scheduled_session_ended" in [i["code"] for i in response.json()["information"]]
    assert client.get(f"/scheduled-sessions/{plan['id']}").json()["end_time"] == plan["end_time"]
    paused = client.post(f"/timers/{timer['id']}/pause", json={"operation_id": str(uuid4())})
    assert paused.status_code == 200
    selected = client.post("/timers", json={"operation_id": str(uuid4()), "task_id": task["id"]})
    assert selected.json()["timer"]["id"] == timer["id"]
    assert selected.json()["timer"]["state"] == "paused"
    assert selected.json()["timer"]["scheduled_session_id"] == plan["id"]
    assert "association_not_changed" in [i["code"] for i in selected.json()["information"]]


def test_singular_mutations_refuse_ambiguity_without_mutating_timers(client, tmp_path, monkeypatch):
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    for _ in range(2):
        assert client.post("/timers", json={"operation_id": str(uuid4())}).status_code == 200
    before = client.get("/timers").json()
    response = client.post("/timer/stop")
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "ambiguous_timer_target"
    after = client.get("/timers").json()
    assert after["revision"] == before["revision"]
    assert {t["id"] for t in after["timers"]} == {t["id"] for t in before["timers"]}


def test_task_delete_detaches_unfinished_timer_and_preserves_recorded_history(client, tmp_path, monkeypatch):
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    task = client.post("/api/tasks", json={"title": "Protected"}).json()
    timer = client.post("/timers", json={"operation_id": str(uuid4()), "task_id": task["id"]}).json()["timer"]
    response = client.delete(f"/api/tasks/{task['id']}")
    assert response.status_code == 204, response.text
    current = client.get("/timers").json()["timers"][0]
    assert current["id"] == timer["id"]
    assert current["task_id"] is None
    stop = client.post(f"/timers/{timer['id']}/stop", json={"operation_id": str(uuid4())})
    assert stop.status_code == 200, stop.text
    stopped = stop.json()
    for work_id in stopped["recorded_work_ids"]:
        assert client.get(f"/recorded-work/{work_id}").json()["task_id"] is None


def test_start_projected_plan_captures_originals_with_stable_timer_association(client, tmp_path, monkeypatch):
    from datetime import UTC, datetime, timedelta

    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    start = (datetime.now(UTC) + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    task_response = client.post(
        "/api/tasks",
        json={
            "title": "Recurring writing",
            "is_recurring": True,
            "recurrence_rrule": "FREQ=DAILY",
            "recurrence_dtstart": start.isoformat(),
            "recurrence_duration_minutes": 30,
            "recurrence_timezone": "UTC",
        },
    )
    assert task_response.status_code == 201, task_response.text
    task = task_response.json()
    agenda = client.get("/agenda", params={"start": start.isoformat(), "end": (start + timedelta(hours=1)).isoformat()})
    assert agenda.status_code == 200, agenda.text
    plan = next(p for p in agenda.json()["items"] if p["task_id"] == task["id"])
    assert plan["is_virtual"] is True
    payload = {
        "operation_id": str(uuid4()),
        "task_id": task["id"],
        "scheduled_session_id": plan["id"],
        "expected_projection_revision": plan["projection_revision"],
    }
    response = client.post("/timers", json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    real_id = result["timer"]["scheduled_session_id"]
    assert not real_id.startswith("virt:")
    assert client.post("/timers", json=payload).json() == result
    real = client.get(f"/scheduled-sessions/{real_id}").json()
    assert real["original_start"] == plan["original_start"]
    assert real["original_end"] == plan["original_end"]


@pytest.mark.parametrize(
    "boundary", ["intent_directory_fsync", "database_commit", "post_state_directory_fsync", "finalization_commit"]
)
def test_fixed_stop_reconciles_every_persistence_boundary(client, db, tmp_path, monkeypatch, boundary):
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    timer = client.post("/timers", json={"operation_id": str(uuid4())}).json()["timer"]
    commit, fsync = db.commit, os.fsync
    commits = syncs = 0

    def commit_fault():
        nonlocal commits
        commits += 1
        if (boundary == "database_commit" and commits == 1) or (boundary == "finalization_commit" and commits == 2):
            raise OSError("injected durable boundary")
        commit()

    def fsync_fault(fd):
        nonlocal syncs
        syncs += 1
        if (boundary == "intent_directory_fsync" and syncs == 2) or (
            boundary == "post_state_directory_fsync" and syncs == 4
        ):
            raise OSError("injected durable boundary")
        fsync(fd)

    monkeypatch.setattr(db, "commit", commit_fault)
    monkeypatch.setattr(os, "fsync", fsync_fault)
    operation = {"operation_id": str(uuid4())}
    with pytest.raises(OSError, match="injected durable boundary"):
        client.post(f"/timers/{timer['id']}/stop", json=operation)
    assert client.get(f"/operations/{operation['operation_id']}").json()["status"] == "pending_reconciliation"
    monkeypatch.setattr(db, "commit", commit)
    monkeypatch.setattr(os, "fsync", fsync)
    # Startup's public barrier must recover without recalculating the stop cutoff.
    from timetrace.services.multiple_timer_service import MultipleTimerService

    MultipleTimerService(db).reconcile()
    result = client.post(f"/timers/{timer['id']}/stop", json=operation)
    assert result.status_code == 200, result.text
    assert len(result.json()["recorded_work_ids"]) == 1
    assert len(client.get("/sessions").json()) == 1
    assert client.post(f"/timers/{timer['id']}/stop", json=operation).json() == result.json()
    assert client.get(f"/operations/{operation['operation_id']}").json()["status"] == "finalized"


def test_concurrent_process_starts_select_one_assigned_timer(tmp_path):
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "concurrent.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "timers.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
    }
    setup = """
from fastapi.testclient import TestClient
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
init_db()
c = TestClient(create_daemon_app())
r = c.post("/api/tasks", json={"title":"Concurrent task"})
assert r.status_code == 201, r.text
print(r.json()["id"])
"""
    task = subprocess.run(
        [sys.executable, "-P", "-c", setup], env=env, capture_output=True, text=True, check=True
    ).stdout.strip()
    worker = """
import json, sys
from uuid import uuid4
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app
c = TestClient(create_daemon_app())
r = c.post("/timers", json={"operation_id":str(uuid4()),"task_id":sys.argv[1]})
assert r.status_code == 200, r.text
print(json.dumps(r.json()))
"""
    children = [
        subprocess.Popen(
            [sys.executable, "-P", "-c", worker, task],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for _ in range(2)
    ]
    results = []
    for child in children:
        stdout, stderr = child.communicate(timeout=60)
        assert child.returncode == 0, stderr
        results.append(json.loads(stdout))
    assert results[0]["timer"]["id"] == results[1]["timer"]["id"]
    assert sorted(r["selected_existing"] for r in results) == [False, True]


@pytest.mark.parametrize("boundary", ["before_db", "after_db", "after_replace", "after_finalization"])
def test_process_crash_stop_replays_fixed_transaction_once(tmp_path, boundary):
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "crash.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "timers.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
        "TIMETRACE_IDLE_DETECTION_ENABLED": "false",
    }
    setup = """
from fastapi.testclient import TestClient
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
from uuid import uuid4
init_db()
c = TestClient(create_daemon_app())
r = c.post("/timers",json={"operation_id":str(uuid4())})
assert r.status_code == 200, r.text
print(r.json()["timer"]["id"])
"""
    timer_id = subprocess.run(
        [sys.executable, "-P", "-c", setup], env=env, capture_output=True, text=True, check=True
    ).stdout.strip()
    operation = str(uuid4())
    crash = """
import os,sys
from fastapi.testclient import TestClient
from sqlmodel import Session
from timetrace.main import create_daemon_app
boundary, timer_id, operation = sys.argv[1:]
commit, replace = Session.commit, os.replace
commits = replacements = 0
def crash_commit(self):
    global commits
    commits += 1
    if boundary == "before_db" and commits == 1: os._exit(91)
    result = commit(self)
    if (boundary == "after_db" and commits == 1) or (boundary == "after_finalization" and commits == 2): os._exit(91)
    return result
def crash_replace(source,destination):
    global replacements
    replacements += 1
    result = replace(source,destination)
    if boundary == "after_replace" and replacements == 2: os._exit(91)
    return result
Session.commit, os.replace = crash_commit, crash_replace
c = TestClient(create_daemon_app())
c.post(f"/timers/{timer_id}/stop",json={"operation_id":operation})
raise AssertionError("crash boundary not reached")
"""
    failed = subprocess.run(
        [sys.executable, "-P", "-c", crash, boundary, timer_id, operation], env=env, capture_output=True, text=True
    )
    assert failed.returncode == 91, failed.stderr
    recovery = """
import json,sys
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app
with TestClient(create_daemon_app()) as c:
    timer_id, operation = sys.argv[1:]
    receipt = c.get(f"/operations/{operation}").json()
    assert receipt["status"] == "finalized", receipt
    r = c.post(f"/timers/{timer_id}/stop", json={"operation_id":operation})
    assert r.status_code == 200, r.text
    assert len(c.get("/sessions").json()) == 1
    assert c.get("/timers").json()["timers"] == []
    print(json.dumps(r.json()))
"""
    result = subprocess.run(
        [sys.executable, "-P", "-c", recovery, timer_id, operation], env=env, capture_output=True, text=True, check=True
    )
    assert len(json.loads(result.stdout)["recorded_work_ids"]) == 1


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
