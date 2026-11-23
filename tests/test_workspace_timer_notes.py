"""Note-only timer edits at the root HTTP seam, using synthetic clock/state."""

import json
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from uuid import uuid4


def test_running_note_updates_current_description_without_closing_or_committing(client, tmp_path, monkeypatch):
    from timetrace.services import multiple_timer_service as module

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.at

    monkeypatch.setattr(module, "datetime", Clock)
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "notes.json"))
    before = client.post("/timers", json={"operation_id": str(uuid4()), "notes": "Before"}).json()["timer"]
    Clock.at += timedelta(minutes=10)
    payload = {"operation_id": str(uuid4()), "expected_revision": before["revision"], "new_notes": "After"}
    response = client.post(f"/timers/{before['id']}/note", json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    updated = result["timer"]
    assert updated["state"] == "running"
    assert updated["running_start"] == before["running_start"]
    assert updated["segments"] == before["segments"]
    assert updated["notes"] == "After"
    assert result["recorded_work_ids"] == []
    assert client.post(f"/timers/{before['id']}/note", json=payload).json() == result
    assert (
        client.post(f"/timers/{before['id']}/note", json={**payload, "operation_id": str(uuid4())}).status_code == 409
    )
    stopped = client.post(f"/timers/{before['id']}/stop", json={"operation_id": str(uuid4())}).json()
    assert len(stopped["recorded_work_ids"]) == 1
    work = client.get(f"/recorded-work/{stopped['recorded_work_ids'][0]}").json()
    assert work["notes"] == "After"
    assert work["start_time"].startswith("2026-11-23T10:00:00")
    assert work["end_time"].startswith("2026-11-23T10:10:00")


def test_paused_note_targets_only_current_manual_pause_interval_and_immediate_stop(client, tmp_path, monkeypatch):
    from timetrace.services import multiple_timer_service as module

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.at

    monkeypatch.setattr(module, "datetime", Clock)
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "paused-note.json"))
    timer = client.post("/timers", json={"operation_id": str(uuid4()), "notes": "Older"}).json()["timer"]
    path = f"/timers/{timer['id']}"
    Clock.at += timedelta(minutes=5)
    client.post(path + "/pause", json={"operation_id": str(uuid4())})
    Clock.at += timedelta(minutes=5)
    client.post(path + "/resume", json={"operation_id": str(uuid4())})
    client.post(
        path + "/note",
        json={
            "operation_id": str(uuid4()),
            "expected_revision": client.get(path).json()["revision"],
            "new_notes": "Current",
        },
    )
    Clock.at += timedelta(minutes=5)
    paused = client.post(path + "/pause", json={"operation_id": str(uuid4())}).json()["timer"]
    payload = {
        "operation_id": str(uuid4()),
        "expected_revision": paused["revision"],
        "new_notes": "Edited paused",
        "expected_note_segment_id": paused.get("manual_pause_note_segment_id"),
    }
    response = client.post(path + "/note", json=payload)
    assert response.status_code == 200, response.text
    saved = response.json()["timer"]
    assert saved["state"] == "paused"
    assert saved["running_start"] is None
    assert saved["segments"][0] == paused["segments"][0]
    assert saved["segments"][1] == {**paused["segments"][1], "notes": "Edited paused"}
    assert client.post(path + "/note", json=payload).json() == response.json()
    invalid = {
        **payload,
        "operation_id": str(uuid4()),
        "expected_revision": saved["revision"],
        "expected_note_segment_id": saved["segments"][0]["id"],
    }
    assert client.post(path + "/note", json=invalid).status_code == 409
    stopped = client.post(path + "/stop", json={"operation_id": str(uuid4())}).json()
    assert len(stopped["recorded_work_ids"]) == 2
    notes = [client.get(f"/recorded-work/{work_id}").json()["notes"] for work_id in stopped["recorded_work_ids"]]
    assert notes == ["Older", "Edited paused"]


def test_note_refuses_unresolved_idle_without_erasing_gap(client, db, tmp_path, monkeypatch):
    from timetrace.services import multiple_timer_service as module

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.at

    monkeypatch.setattr(module, "datetime", Clock)
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "idle-note.json"))
    service = module.MultipleTimerService(db)
    service.mutate("idle_toggle", None, {"operation_id": str(uuid4()), "enabled": True})
    timer = client.post(
        "/timers", json={"operation_id": str(uuid4()), "notes": "Original", "pause_when_idle": True}
    ).json()["timer"]
    Clock.at += timedelta(minutes=10)
    service.observe_activity(600)
    path = f"/timers/{timer['id']}"
    frozen = client.get(path).json()
    assert frozen["state"] == "frozen"
    response = client.post(
        path + "/note",
        json={"operation_id": str(uuid4()), "expected_revision": frozen["revision"], "new_notes": "Refuse"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "idle_gap_unresolved"
    assert client.get(path).json() == frozen


def test_note_refuses_missing_or_invalidated_pause_target_without_guessing(client, tmp_path, monkeypatch):
    from timetrace.services import multiple_timer_service as module

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.at

    monkeypatch.setattr(module, "datetime", Clock)
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "invalid-target.json"))
    timer = client.post("/timers", json={"operation_id": str(uuid4()), "notes": "Original"}).json()["timer"]
    path = f"/timers/{timer['id']}"
    paused = client.post(path + "/pause", json={"operation_id": str(uuid4())}).json()["timer"]
    assert paused.get("manual_pause_note_segment_id") is None
    assert (
        client.post(
            path + "/note",
            json={"operation_id": str(uuid4()), "expected_revision": paused["revision"], "new_notes": "Must refuse"},
        ).status_code
        == 409
    )
    client.post(path + "/resume", json={"operation_id": str(uuid4())})
    Clock.at += timedelta(minutes=5)
    paused = client.post(path + "/pause", json={"operation_id": str(uuid4())}).json()["timer"]
    split = client.post(path + "/split", json={"operation_id": str(uuid4()), "new_notes": "Future"}).json()
    current = split["timer"]
    assert current.get("manual_pause_note_segment_id") is None
    assert (
        client.post(
            path + "/note",
            json={
                "operation_id": str(uuid4()),
                "expected_revision": current["revision"],
                "new_notes": "Must refuse",
                "expected_note_segment_id": paused["manual_pause_note_segment_id"],
            },
        ).status_code
        == 409
    )
    work = client.get("/recorded-work/" + split["recorded_work_ids"][0]).json()
    assert work["notes"] == "Original"
    assert work["end_time"].startswith("2026-11-23T10:05:00")


def test_start_again_uses_now_without_old_association_or_gap(client, tmp_path, monkeypatch):
    from timetrace.services import multiple_timer_service as module

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.at

    monkeypatch.setattr(module, "datetime", Clock)
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "again.json"))
    task = client.post("/api/tasks", json={"title": "Again"}).json()
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2026-11-23T10:00:00Z", "end_time": "2026-11-23T11:00:00Z"},
    ).json()
    first = client.post(
        "/timers",
        json={
            "operation_id": str(uuid4()),
            "task_id": task["id"],
            "scheduled_session_id": plan["id"],
            "expected_plan_revision": plan["revision"],
        },
    ).json()["timer"]
    Clock.at += timedelta(minutes=10)
    stopped = client.post(f"/timers/{first['id']}/stop", json={"operation_id": str(uuid4())}).json()
    work_id = stopped["recorded_work_ids"][0]
    previous = client.get(f"/recorded-work/{work_id}").json()
    Clock.at += timedelta(minutes=5)
    again = client.post("/timers", json={"operation_id": str(uuid4()), "task_id": task["id"]}).json()["timer"]
    assert again["scheduled_session_id"] is None
    assert again["running_start"].startswith("2026-11-23T10:15:00")
    assert again["segments"] == []
    assert client.get(f"/recorded-work/{work_id}").json() == previous


def test_paused_note_receipt_and_target_survive_process_restart(tmp_path):
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "restart.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "timers.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
    }
    setup = """
import json, os
from uuid import uuid4
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
    first = (
        setup
        + """
t = c.post('/timers',json={'operation_id':str(uuid4()),'notes':'Before'}).json()['timer']
Clock.at += timedelta(minutes=10)
p = c.post('/timers/' + t['id'] + '/pause',json={'operation_id':str(uuid4())}).json()['timer']
payload = {'operation_id':str(uuid4()),'expected_revision':p['revision'],
           'new_notes':'Restart note','expected_note_segment_id':p['manual_pause_note_segment_id']}
r = c.post('/timers/' + t['id'] + '/note',json=payload)
assert r.status_code == 200, r.text
print(json.dumps({'payload':payload,'result':r.json()}))
"""
    )
    received = subprocess.run([sys.executable, "-P", "-c", first], env=env, capture_output=True, text=True, check=True)
    saved = json.loads(received.stdout)
    second = (
        setup
        + """
saved = json.loads(os.environ['NOTE_RECEIPT'])
payload, expected = saved['payload'], saved['result']
path = '/timers/' + expected['timer']['id']
r = c.post(path + '/note',json=payload)
assert r.status_code == 200, r.text
assert r.json() == expected
assert c.get(path).json()['state'] == 'paused'
r = c.post(path + '/stop',json={'operation_id':str(uuid4())})
assert r.status_code == 200, r.text
ids = r.json()['recorded_work_ids']
assert len(ids) == 1
w = c.get('/recorded-work/' + ids[0]).json()
assert w['notes'] == 'Restart note'
assert w['start_time'].startswith('2026-11-23T10:00:00')
assert w['end_time'].startswith('2026-11-23T10:10:00')
"""
    )
    subprocess.run(
        [sys.executable, "-P", "-c", second],
        env={**env, "NOTE_RECEIPT": json.dumps(saved)},
        capture_output=True,
        text=True,
        check=True,
    )
