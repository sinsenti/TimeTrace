"""Actual signed correction interactions through the daemon root HTTP routes."""

import json
import os
import subprocess
import sys
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from test_timer_correction_preview import persisted_snapshot


@pytest.fixture
def clock(monkeypatch, tmp_path):
    from timetrace.config import settings
    from timetrace.services import multiple_timer_service as module

    monkeypatch.setattr(settings, "db_file", tmp_path / "installation.db")

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.at

    monkeypatch.setattr(module, "datetime", Clock)
    return Clock


def test_signed_running_step_commit_and_stop_preserve_exact_work(client, clock):
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    assert client.post("/timers/correction-initialize", json={"operation_id": "init"}).status_code == 200
    clock.at += timedelta(minutes=10)
    path = f"/timers/{timer['id']}"
    preview = client.post(
        path + "/correction-preview",
        json={
            "target": {"kind": "running", "segment_id": timer["running_segment_id"]},
            "change": {"kind": "step_start", "credited_delta_seconds": -300},
        },
    )
    assert preview.status_code == 200, preview.text
    envelope = preview.json()
    assert envelope["before"]["start_utc"] == "2026-11-23T10:00:00+00:00"
    assert envelope["after"]["start_utc"] == "2026-11-23T10:05:00+00:00"
    payload = {"operation_id": "correct", "preview": envelope}
    committed = client.post(path + "/correction", json=payload)
    assert committed.status_code == 200, committed.text
    stopped = client.post(path + "/stop", json={"operation_id": "stop"}).json()
    work = client.get("/recorded-work/" + stopped["recorded_work_ids"][0]).json()
    assert work["start_time"].startswith("2026-11-23T10:05:00")
    assert work["end_time"].startswith("2026-11-23T10:10:00")
    assert client.post(path + "/correction", json=payload).json() == committed.json()


def preview_step(client, path, target, delta=-300):
    return client.post(
        path + "/correction-preview",
        json={
            "target": target,
            "change": {"kind": "step_start", "credited_delta_seconds": delta},
        },
    )


@pytest.mark.parametrize("paused", [False, True])
@pytest.mark.parametrize("delta,expected", [(300, "09:55:00"), (-300, "10:05:00")])
def test_running_and_paused_steps_preserve_note_pointer_and_snapshots(
    client, db, tmp_path, clock, paused, delta, expected
):
    timer = client.post("/timers", json={"operation_id": "start", "notes": "original"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/timers/" + timer["id"]
    clock.at += timedelta(minutes=10)
    if paused:
        timer = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]
        target = {"kind": "buffered", "segment_id": timer["manual_pause_note_segment_id"]}
    else:
        target = {"kind": "running", "segment_id": timer["running_segment_id"]}
    before = persisted_snapshot(tmp_path, db)
    preview = preview_step(client, path, target, delta)
    assert preview.status_code == 200, preview.text
    assert persisted_snapshot(tmp_path, db) == before
    response = client.post(path + "/correction", json={"operation_id": "correct", "preview": preview.json()})
    assert response.status_code == 200, response.text
    current = response.json()["timer"]
    assert current["state"] == ("paused" if paused else "running")
    if paused:
        assert current["manual_pause_note_segment_id"] == timer["manual_pause_note_segment_id"]
        note = client.post(
            path + "/note",
            json={
                "operation_id": "note",
                "expected_revision": current["revision"],
                "new_notes": "edited",
                "expected_note_segment_id": current["manual_pause_note_segment_id"],
            },
        )
        assert note.status_code == 200, note.text
    stopped = client.post(path + "/stop", json={"operation_id": "stop"}).json()
    work = client.get("/recorded-work/" + stopped["recorded_work_ids"][0]).json()
    assert work["start_time"].startswith("2026-11-23T" + expected)
    assert work["notes"] == ("edited" if paused else "original")


def test_resume_floor_previous_buffer_and_positive_work_refusals(client, clock):
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/timers/" + timer["id"]
    clock.at += timedelta(minutes=10)
    old = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]["segments"][0]
    clock.at += timedelta(minutes=10)
    resumed = client.post(path + "/resume", json={"operation_id": "resume"}).json()["timer"]
    target = {"kind": "running", "segment_id": resumed["running_segment_id"]}
    clock.at += timedelta(minutes=5)
    assert preview_step(client, path, target, -300).status_code == 400
    assert preview_step(client, path, target, 300).status_code == 400
    clock.at += timedelta(minutes=5)
    approved = preview_step(client, path, target).json()
    corrected = client.post(path + "/correction", json={"operation_id": "trim", "preview": approved})
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["timer"]["segments"][0] == old
    restored = preview_step(client, path, target, 300)
    assert restored.status_code == 200
    assert restored.json()["after"]["start_utc"] == resumed["running_start"]


@pytest.mark.parametrize(
    "field", ["after", "cutoff", "resource", "dependency_digest", "request", "signature", "warnings"]
)
def test_semantic_tampering_never_writes(client, db, tmp_path, clock, field):
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/timers/" + timer["id"]
    clock.at += timedelta(minutes=10)
    envelope = preview_step(client, path, {"kind": "running", "segment_id": timer["running_segment_id"]}).json()
    if field == "after":
        envelope[field]["start_utc"] = "2026-11-23T09:00:00+00:00"
    elif field == "request":
        envelope[field]["target"]["segment_id"] = "forged"
    elif field == "warnings":
        envelope[field] = []
    elif field in ("signature", "dependency_digest"):
        envelope[field] = "0" * 64
    else:
        envelope[field] += "forged"
    before = persisted_snapshot(tmp_path, db)
    response = client.post(path + "/correction", json={"operation_id": "bad", "preview": envelope})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "correction_preview_invalid"
    assert persisted_snapshot(tmp_path, db) == before


@pytest.mark.parametrize("mutation", ["note", "pause"])
def test_target_revision_stales_preview_but_other_timer_does_not(client, clock, mutation):
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/timers/" + timer["id"]
    clock.at += timedelta(minutes=10)
    target = {"kind": "running", "segment_id": timer["running_segment_id"]}
    envelope = preview_step(client, path, target).json()
    other = client.post("/timers", json={"operation_id": "other"}).json()["timer"]
    client.post("/timers/" + other["id"] + "/pause", json={"operation_id": "other-pause"})
    payload = {"operation_id": "correct", "preview": envelope}
    response = client.post(path + "/correction", json=payload)
    assert response.status_code == 200, response.text
    fresh = preview_step(client, path, target, 300).json()
    now = client.get(path).json()
    client.post(
        path + "/" + mutation, json={"operation_id": "change", "expected_revision": now["revision"], "new_notes": "new"}
    )
    response = client.post(path + "/correction", json={"operation_id": "stale", "preview": fresh})
    assert response.status_code == 409
    assert response.json()["code"] == "correction_preview_stale"
    assert client.post(path + "/correction", json=payload).json()["operation_id"] == "correct"
    changed = deepcopy(payload)
    changed["preview"]["warnings"] = []
    assert client.post(path + "/correction", json=changed).json()["code"] == "operation_payload_mismatch"


def test_missing_foreign_saved_and_old_target_refuse(client, clock):
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    other = client.post("/timers", json={"operation_id": "other"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=10)
    path = "/timers/" + timer["id"]
    for kind, identity in [("running", "missing"), ("running", other["running_segment_id"]), ("buffered", "missing")]:
        response = preview_step(client, path, {"kind": kind, "segment_id": identity})
        assert response.status_code == 409
    assert preview_step(client, path, {"kind": "saved", "work_id": "saved", "expected_revision": 1}).status_code == 409
    envelope = preview_step(client, path, {"kind": "running", "segment_id": timer["running_segment_id"]}).json()
    assert (
        client.post(
            "/timers/" + other["id"] + "/correction", json={"operation_id": "wrong-route", "preview": envelope}
        ).status_code
        == 409
    )


def test_plan_and_other_timer_unchanged_and_task_dependency_stales(client, clock):
    task = client.post("/api/tasks", json={"title": "Keep description", "description": "unchanged"}).json()
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2026-11-23T10:00:00Z", "end_time": "2026-11-23T11:00:00Z"},
    ).json()
    timer = client.post(
        "/timers",
        json={
            "operation_id": "start",
            "task_id": task["id"],
            "scheduled_session_id": plan["id"],
            "expected_plan_revision": plan["revision"],
        },
    ).json()["timer"]
    other = client.post("/timers", json={"operation_id": "other", "notes": "untouched"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/timers/" + timer["id"]
    clock.at += timedelta(minutes=10)
    before_plan = client.get("/scheduled-sessions/" + plan["id"]).json()
    before_other = client.get("/timers/" + other["id"]).json()
    target = {"kind": "running", "segment_id": timer["running_segment_id"]}
    envelope = preview_step(client, path, target).json()
    response = client.post(path + "/correction", json={"operation_id": "correct", "preview": envelope})
    assert response.status_code == 200, response.text
    assert client.get("/scheduled-sessions/" + plan["id"]).json() == before_plan
    assert client.get("/timers/" + other["id"]).json() == before_other
    assert client.get("/api/tasks/" + task["id"]).json()["description"] == "unchanged"
    envelope = preview_step(client, path, target, 300).json()
    updated = client.put("/api/tasks/" + task["id"], json={"title": "Changed dependency"})
    assert updated.status_code == 200, updated.text
    response = client.post(path + "/correction", json={"operation_id": "stale", "preview": envelope})
    assert response.status_code == 409
    assert response.json()["code"] == "correction_preview_stale"


def test_task_detachment_stales_pending_approval(client, clock):
    task = client.post("/api/tasks", json={"title": "Detach"}).json()
    timer = client.post("/timers", json={"operation_id": "start", "task_id": task["id"]}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=10)
    path = "/timers/" + timer["id"]
    envelope = preview_step(client, path, {"kind": "running", "segment_id": timer["running_segment_id"]}).json()
    assert client.delete("/api/tasks/" + task["id"]).status_code == 204
    response = client.post(path + "/correction", json={"operation_id": "stale", "preview": envelope})
    assert response.status_code == 409
    assert response.json()["code"] == "correction_preview_stale"


def test_task_rating_change_stales_approval_without_timer_revision_change(client, clock):
    task = client.post("/api/tasks", json={"title": "Rated task"}).json()
    definition = client.post("/rating-definitions", json={"name": "Quality", "target_type": "task"}).json()
    timer = client.post("/timers", json={"operation_id": "start", "task_id": task["id"]}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=10)
    path = "/timers/" + timer["id"]
    target = {"kind": "running", "segment_id": timer["running_segment_id"]}
    envelope = preview_step(client, path, target).json()
    revision = client.get(path).json()["revision"]
    rated = client.post(
        "/rating-entries",
        json={"rating_definition_id": definition["id"], "target_type": "task", "target_id": task["id"], "score": 7},
    )
    assert rated.status_code == 201, rated.text
    assert client.get(path).json()["revision"] == revision
    response = client.post(path + "/correction", json={"operation_id": "stale", "preview": envelope})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "correction_preview_stale"


def test_unresolved_idle_and_future_buffer_refuse_without_mutation(client, db, tmp_path, clock):
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=10)
    path = "/timers/" + timer["id"]
    paused = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]
    target = {"kind": "buffered", "segment_id": paused["segments"][0]["id"]}
    state_path = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"])
    state = json.loads(state_path.read_text())
    state["timers"][timer["id"]]["segments"][0]["end_time"] = "2026-11-23T11:00:00+00:00"
    state_path.write_text(json.dumps(state))
    before = persisted_snapshot(tmp_path, db)
    assert preview_step(client, path, target).status_code == 400
    assert persisted_snapshot(tmp_path, db) == before
    state["timers"][timer["id"]]["idle_gaps"] = [{"decision": None}]
    state_path.write_text(json.dumps(state))
    before = persisted_snapshot(tmp_path, db)
    response = preview_step(client, path, target)
    assert response.status_code == 409
    assert response.json()["code"] == "idle_gap_unresolved"
    assert persisted_snapshot(tmp_path, db) == before


@pytest.mark.parametrize("conservative", [True, False])
def test_old_unknown_floor_and_forbidden_coverage_cannot_be_crossed(client, clock, conservative):
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=10)
    state_path = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"])
    state = json.loads(state_path.read_text())
    boundary = state["timers"][timer["id"]]["running_evidence"]
    if conservative:
        boundary["lower_bound"] = timer["running_start"]
        boundary["provenance"] = "legacy_unknown"
    else:
        boundary["forbidden_ranges"] = [{"start_utc": "2026-11-23T09:55:00+00:00", "end_utc": timer["running_start"]}]
    state_path.write_text(json.dumps(state))
    path = "/timers/" + timer["id"]
    target = {"kind": "running", "segment_id": timer["running_segment_id"]}
    assert preview_step(client, path, target, 300).status_code == 400
    assert preview_step(client, path, target, -300).status_code == 200


def test_step_process_crash_replays_fixed_start_and_stop_once(tmp_path):
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "crash.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "active_timer.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
    }
    setup = """
import os, json
from datetime import UTC, datetime, timedelta
from fastapi.testclient import TestClient
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
from timetrace.services import multiple_timer_service as module
class Clock(datetime):
    at = datetime(2026, 11, 23, 10, tzinfo=UTC)
    @classmethod
    def now(cls, tz=None): return cls.at
module.datetime = Clock
init_db()
c = TestClient(create_daemon_app())
"""
    crash = (
        setup
        + """
t = c.post('/timers',json={'operation_id':'start'}).json()['timer']
c.post('/timers/correction-initialize',json={'operation_id':'init'})
Clock.at += timedelta(minutes=10)
p = '/timers/' + t['id']
e = c.post(p + '/correction-preview',json={'target':{'kind':'running','segment_id':t['running_segment_id']},
    'change':{'kind':'step_start','credited_delta_seconds':-300}}).json()
payload = {'operation_id':'correct','preview':e}
open(os.environ['TIMETRACE_DB_FILE'] + '.request', 'w').write(json.dumps({'path':p,'payload':payload}))
replace = os.replace
calls = 0
def crash_replace(src,dst):
    global calls
    if str(dst) == os.environ['TIMETRACE_TIMER_STATE_FILE']:
        calls += 1
        if calls == 2: os._exit(77)
    return replace(src,dst)
os.replace = crash_replace
c.post(p + '/correction',json=payload)
"""
    )
    process = subprocess.run([sys.executable, "-P", "-c", crash], env=env, capture_output=True, text=True)
    assert process.returncode == 77, process.stderr
    restart = (
        setup
        + """
Clock.at += timedelta(minutes=10)
s = json.load(open(os.environ['TIMETRACE_DB_FILE'] + '.request'))
r = c.post(s['path'] + '/correction',json=s['payload'])
assert r.status_code == 200, r.text
assert r.json()['timer']['running_start'] == '2026-11-23T10:05:00+00:00'
a = c.post(s['path'] + '/stop',json={'operation_id':'stop'})
b = c.post(s['path'] + '/stop',json={'operation_id':'stop'})
assert a.status_code == 200, a.text
assert a.json() == b.json()
assert len(a.json()['recorded_work_ids']) == 1
w = c.get('/recorded-work/' + a.json()['recorded_work_ids'][0]).json()
assert w['start_time'].startswith('2026-11-23T10:05:00')
assert w['end_time'].startswith('2026-11-23T10:10:00')
assert c.get('/operations/correct').json()['status'] == 'finalized'
"""
    )
    for _ in range(2):
        subprocess.run([sys.executable, "-P", "-c", restart], env=env, capture_output=True, text=True, check=True)
