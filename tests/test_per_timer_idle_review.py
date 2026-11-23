"""Per-timer preferences and absence review through the root HTTP seam."""

import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from uuid import uuid4


def test_unselected_gap_and_preferences_survive_process_restart(tmp_path):
    env = {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "restart.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "timers.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
    }
    setup = """
import json
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlmodel import Session
from timetrace.db.session import init_db, engine
from timetrace.main import create_daemon_app
from timetrace.services.multiple_timer_service import MultipleTimerService
init_db()
c = TestClient(create_daemon_app())
a = c.post('/timers', json={'operation_id':str(uuid4())}).json()['timer']
b = c.post('/timers', json={'operation_id':str(uuid4())}).json()['timer']
c.post('/timers', json={'operation_id':str(uuid4()), 'pause_when_idle':False})
with Session(engine) as db:
    MultipleTimerService(db).observe_activity(600)
    MultipleTimerService(db).observe_activity(0)
a = c.get('/timers/'+a['id']).json()
payload = {'operation_id':str(uuid4()),'gap_id':a['idle_gaps'][0]['id'],'decision':'discard'}
r = c.post('/timers/'+a['id']+'/resolve',json=payload)
assert r.status_code == 200, r.text
print(json.dumps(c.get('/timers').json()['timers']))
"""
    read = """
import json
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app
c = TestClient(create_daemon_app())
print(json.dumps(c.get('/timers').json()['timers']))
"""
    before = subprocess.run([sys.executable, "-P", "-c", setup], env=env, capture_output=True, text=True, check=True)
    after = subprocess.run([sys.executable, "-P", "-c", read], env=env, capture_output=True, text=True, check=True)
    a, b = json.loads(before.stdout), json.loads(after.stdout)
    assert [t["state"] for t in b] == ["paused", "frozen", "running"]
    assert [t["pause_when_idle"] for t in b] == [True, True, False]
    assert [t["idle_gaps"] for t in b] == [t["idle_gaps"] for t in a]
    assert b[1]["idle_gaps"][0]["decision"] is None
    assert b[1]["idle_gaps"][0]["return_at"] is not None


def test_preference_is_persisted_targeted_and_does_not_resolve_a_gap(client, db, tmp_path, monkeypatch):
    from timetrace.services.multiple_timer_service import MultipleTimerService

    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    a = client.post("/timers", json={"operation_id": str(uuid4())}).json()["timer"]
    b = client.post("/timers", json={"operation_id": str(uuid4())}).json()["timer"]
    payload = {"operation_id": str(uuid4()), "expected_revision": a["revision"], "pause_when_idle": False}
    changed = client.post(f"/timers/{a['id']}/idle_preference", json=payload)
    assert changed.status_code == 200, changed.text
    assert client.post(f"/timers/{a['id']}/idle_preference", json=payload).json() == changed.json()
    assert client.get(f"/timers/{a['id']}").json()["pause_when_idle"] is False
    MultipleTimerService(db).observe_activity(600)
    assert client.get(f"/timers/{a['id']}").json()["state"] == "running"
    frozen = client.get(f"/timers/{b['id']}").json()
    assert frozen["state"] == "frozen"
    refused = client.post(
        f"/timers/{b['id']}/idle_preference", json={"operation_id": str(uuid4()), "pause_when_idle": False}
    )
    assert refused.status_code == 409
    assert client.get(f"/timers/{b['id']}").json()["idle_gaps"] == frozen["idle_gaps"]


def test_approved_absence_late_review_and_staggered_start(client, db, tmp_path, monkeypatch):
    import timetrace.services.multiple_timer_service as module

    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))

    class Clock(datetime):
        instant = datetime(2025, 1, 1, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.instant

    monkeypatch.setattr(module, "datetime", Clock)
    rows = []
    for title in ("Writing", "Phone", "Background"):
        task = client.post("/api/tasks", json={"title": title}).json()
        rows.append(
            client.post(
                "/timers",
                json={"operation_id": str(uuid4()), "task_id": task["id"], "pause_when_idle": title != "Background"},
            ).json()["timer"]
        )
    Clock.instant = datetime(2025, 1, 1, 10, 15, tzinfo=UTC)
    late = client.post("/timers", json={"operation_id": str(uuid4())}).json()["timer"]
    Clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    module.MultipleTimerService(db).observe_activity(600)
    assert client.get(f"/timers/{late['id']}").json()["idle_gaps"][0]["onset"] == "2025-01-01T10:15:00+00:00"
    Clock.instant = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    module.MultipleTimerService(db).observe_activity(1200)  # still idle, not return
    assert client.get(f"/timers/{rows[0]['id']}").json()["idle_gaps"][0]["return_at"] is None
    module.MultipleTimerService(db).observe_activity(0)
    assert client.post(f"/timers/{rows[2]['id']}/pause", json={"operation_id": str(uuid4())}).status_code == 200
    Clock.instant = datetime(2025, 1, 1, 11, tzinfo=UTC)
    for timer, decision in zip(rows[:2], ("discard", "claim"), strict=True):
        current = client.get(f"/timers/{timer['id']}").json()
        gap = current["idle_gaps"][0]
        payload = {
            "operation_id": str(uuid4()),
            "expected_revision": current["revision"],
            "gap_id": gap["id"],
            "decision": decision,
        }
        resolved = client.post(f"/timers/{timer['id']}/resolve", json=payload)
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()["timer"]["state"] == "paused"
        assert client.post(f"/timers/{timer['id']}/resolve", json=payload).json() == resolved.json()
    assert client.get(f"/timers/{late['id']}").json()["idle_gaps"][0]["decision"] is None
    for timer, seconds in zip(rows, (600, 1800, 1800), strict=True):
        stopped = client.post(f"/timers/{timer['id']}/stop", json={"operation_id": str(uuid4())})
        work = [client.get(f"/recorded-work/{wid}").json() for wid in stopped.json()["recorded_work_ids"]]
        assert (
            sum(
                (datetime.fromisoformat(w["end_time"]) - datetime.fromisoformat(w["start_time"])).total_seconds()
                for w in work
            )
            == seconds
        )
