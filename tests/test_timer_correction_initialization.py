"""Explicit initialization at the root HTTP seam, with synthetic installation files."""

import json
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from test_timer_correction_preview import persisted_snapshot


def test_explicit_initialization_is_receipted_and_idempotent(client, tmp_path, monkeypatch):
    from timetrace.config import settings

    monkeypatch.setattr(settings, "db_file", tmp_path / "installation.db")
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    response = client.post("/timers/correction-initialize", json={"operation_id": "initialize"})
    assert response.status_code == 200, response.text
    assert response.json()["correction_initialized"] is True
    current = client.get(f"/timers/{timer['id']}").json()
    assert current["running_segment_id"]
    assert current["running_evidence"]["lower_bound"] is None
    assert client.post("/timers/correction-initialize", json={"operation_id": "initialize"}).json() == response.json()
    assert client.get("/operations/initialize").json()["status"] == "finalized"
    key = tmp_path / "correction-signing.key"
    assert key.is_file()
    assert len(key.read_bytes()) == 32
    assert key.stat().st_mode & 0o777 == 0o600
    assert client.post("/timers", json={"operation_id": "initialize"}).status_code == 409
    assert "key" not in response.text.lower()
    before_key = key.read_bytes()
    second = client.post("/timers/correction-initialize", json={"operation_id": "initialize-again"})
    assert second.status_code == 200
    assert client.get(f"/timers/{timer['id']}").json()["running_segment_id"] == current["running_segment_id"]
    assert key.read_bytes() == before_key


def test_old_v2_initialization_and_manual_pause_note_identity(client, tmp_path, monkeypatch):
    from timetrace.config import settings
    from timetrace.services import multiple_timer_service as module

    monkeypatch.setattr(settings, "db_file", tmp_path / "installation.db")

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.at

    monkeypatch.setattr(module, "datetime", Clock)
    timer = client.post("/timers", json={"operation_id": "start", "notes": "snapshot"}).json()["timer"]
    path = f"/timers/{timer['id']}"
    Clock.at += timedelta(minutes=10)
    paused = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]
    assert paused["segments"][0]["id"] == timer["running_segment_id"]
    state_path = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"])
    state = json.loads(state_path.read_text())
    for segment in state["timers"][timer["id"]]["segments"]:
        segment.pop("correction_evidence")
    state_path.write_text(json.dumps(state))
    assert client.post("/timers/correction-initialize", json={"operation_id": "init"}).status_code == 200
    current = client.get(path).json()
    assert current["manual_pause_note_segment_id"] == paused["manual_pause_note_segment_id"]
    assert current["segments"][0]["correction_evidence"]["lower_bound"] == timer["running_start"]
    edited = client.post(
        path + "/note",
        json={
            "operation_id": "note",
            "expected_revision": current["revision"],
            "expected_note_segment_id": current["manual_pause_note_segment_id"],
            "new_notes": "edited",
        },
    )
    assert edited.status_code == 200, edited.text
    Clock.at += timedelta(minutes=10)
    resumed = client.post(path + "/resume", json={"operation_id": "resume"}).json()["timer"]
    assert resumed["running_segment_id"] != timer["running_segment_id"]
    assert resumed["running_evidence"]["lower_bound"] == resumed["running_start"]
    assert resumed["running_evidence"]["provenance"] == "resume"
    Clock.at += timedelta(minutes=5)
    stopped = client.post(path + "/stop", json={"operation_id": "stop"}).json()
    assert stopped["timer"]["segments"][1]["id"] == resumed["running_segment_id"]
    works = [client.get("/recorded-work/" + i).json() for i in stopped["recorded_work_ids"]]
    assert [w["notes"] for w in works] == ["edited", "edited"]


def test_initialized_preview_never_recreates_missing_key(client, db, tmp_path, monkeypatch):
    from timetrace.config import settings

    monkeypatch.setattr(settings, "db_file", tmp_path / "installation.db")
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    assert client.post("/timers/correction-initialize", json={"operation_id": "init"}).status_code == 200
    (tmp_path / "correction-signing.key").unlink()
    before = persisted_snapshot(tmp_path, db)
    response = client.post(
        "/timers/" + timer["id"] + "/correction-preview",
        json={
            "target": {"kind": "running", "segment_id": timer["running_segment_id"]},
            "change": {"kind": "step_start", "credited_delta_seconds": 300},
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "reconciliation_required"
    assert persisted_snapshot(tmp_path, db) == before
    assert client.post("/timers/correction-initialize", json={"operation_id": "init", "extra": 1}).status_code == 422


@pytest.mark.parametrize("legacy", [False, True])
def test_old_open_shapes_initialize_conservatively(client, tmp_path, monkeypatch, legacy):
    from timetrace.config import settings

    monkeypatch.setattr(settings, "db_file", tmp_path / "installation.db")
    path = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"])
    if legacy:
        path.write_text(json.dumps({"is_running": True, "start_time": "2026-11-23T10:00:00+00:00"}))
    else:
        timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
        state = json.loads(path.read_text())
        state["timers"][timer["id"]].pop("running_segment_id")
        state["timers"][timer["id"]].pop("running_evidence")
        path.write_text(json.dumps(state))
    assert client.post("/timers/correction-initialize", json={"operation_id": "init"}).status_code == 200
    timers = client.get("/timers").json()
    timer = timers["timers"][0]
    assert timer["running_segment_id"]
    assert timer["running_evidence"]["lower_bound"] == (timer["running_start"] if legacy else None)


def test_pending_old_start_is_reconciled_before_additive_initialization(client, db, tmp_path, monkeypatch):
    from timetrace.config import settings
    from timetrace.db.models import MutationOperation

    monkeypatch.setattr(settings, "db_file", tmp_path / "installation.db")
    result = client.post("/timers", json={"operation_id": "old-start"}).json()
    receipt = db.get(MutationOperation, "old-start")
    old_after = json.loads(receipt.after_state_json)
    old_timer = old_after["timers"][result["timer"]["id"]]
    old_timer.pop("running_segment_id")
    old_timer.pop("running_evidence")
    result["timer"] = old_timer
    receipt.after_state_json = json.dumps(old_after)
    receipt.result_json = json.dumps(result)
    intent = {**receipt.model_dump(exclude={"file_finalized"}), "work": []}
    path = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"])
    path.write_text(json.dumps({"version": 2, "revision": 0, "timers": {}, "pending_operation": intent}))
    db.delete(receipt)
    db.commit()
    response = client.post("/timers/correction-initialize", json={"operation_id": "init"})
    assert response.status_code == 200, response.text
    assert client.post("/timers", json={"operation_id": "old-start"}).json() == result
    current = client.get("/timers/" + old_timer["id"]).json()
    assert current["running_segment_id"]
    before = persisted_snapshot(tmp_path, db)
    preview = client.post(
        "/timers/" + old_timer["id"] + "/correction-preview",
        json={
            "target": {"kind": "running", "segment_id": current["running_segment_id"]},
            "change": {"kind": "step_start", "credited_delta_seconds": 300},
        },
    )
    assert preview.status_code == 409
    assert persisted_snapshot(tmp_path, db) == before


def test_process_crash_after_db_commit_then_two_restarts_preserve_ids_and_key(tmp_path):
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "restart.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "active_timer.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
    }
    setup = """
import os, json
from fastapi.testclient import TestClient
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
init_db()
c = TestClient(create_daemon_app())
"""
    crash = (
        setup
        + """
c.post('/timers', json={'operation_id':'start'})
replace = os.replace
calls = 0
def crash_replace(src, dst):
    global calls
    if str(dst) == os.environ['TIMETRACE_TIMER_STATE_FILE']:
        calls += 1
        if calls == 2: os._exit(77)
    return replace(src, dst)
os.replace = crash_replace
c.post('/timers/correction-initialize', json={'operation_id':'init'})
"""
    )
    process = subprocess.run([sys.executable, "-P", "-c", crash], env=env, capture_output=True, text=True)
    assert process.returncode == 77, process.stderr
    key_path = tmp_path / "correction-signing.key"
    key_before = key_path.read_bytes()
    recover = (
        setup
        + """
r = c.post('/timers/correction-initialize', json={'operation_id':'init'})
assert r.status_code == 200, r.text
assert c.get('/operations/init').json()['status'] == 'finalized'
t = c.get('/timers').json()['timers'][0]
print(json.dumps({'result':r.json(), 'timer':{k:t[k] for k in
    ['id','running_segment_id','running_evidence','revision','segments','notes','running_start']}}))
"""
    )
    outputs = []
    for _ in range(2):
        process = subprocess.run(
            [sys.executable, "-P", "-c", recover], env=env, capture_output=True, text=True, check=True
        )
        outputs.append(json.loads(process.stdout))
        assert key_path.read_bytes() == key_before
    assert outputs[0] == outputs[1]
    assert outputs[0]["timer"]["running_segment_id"]


@pytest.mark.parametrize("corruption", ["key", "evidence"])
def test_corrupt_material_is_not_replaced(client, db, tmp_path, monkeypatch, corruption):
    from timetrace.config import settings

    monkeypatch.setattr(settings, "db_file", tmp_path / "installation.db")
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    if corruption == "key":
        (tmp_path / "correction-signing.key").write_bytes(b"corrupt")
    else:
        path = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"])
        state = json.loads(path.read_text())
        state["timers"][timer["id"]]["running_evidence"]["version"] = 99
        path.write_text(json.dumps(state))
    before = persisted_snapshot(tmp_path, db)
    response = client.post("/timers/correction-initialize", json={"operation_id": "init"})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "reconciliation_required"
    assert persisted_snapshot(tmp_path, db) == before
