"""Permanent removal targets exactly one saved interval, never its task or plan."""

import json

import pytest

from timetrace.core.timer_store import TimerStore
from timetrace.db.models import RatingDefinition, RatingEntry


def test_delete_recorded_work_is_revision_guarded_and_preserves_other_work_and_plan(client, db):
    task = client.post("/api/tasks", json={"title": "Delete selected entry"}).json()
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2025-01-01T10:00:00Z", "end_time": "2025-01-01T11:00:00Z"},
    ).json()

    def record(start, end):
        response = client.post(
            "/recorded-work", json={"task_id": task["id"], "start_time": start, "end_time": end, "notes": "Saved note"}
        )
        assert response.status_code == 201, response.text
        return response.json()

    first = record("2025-01-01T10:00:00Z", "2025-01-01T10:20:00Z")
    other = record("2025-01-01T10:30:00Z", "2025-01-01T10:40:00Z")
    definition = RatingDefinition(name="Quality")
    db.add(definition)
    db.flush()
    rating = RatingEntry(rating_definition_id=definition.id, target_type="session", target_id=first["id"], score=8)
    other_rating = RatingEntry(
        rating_definition_id=definition.id, target_type="session", target_id=other["id"], score=6
    )
    db.add(rating)
    db.add(other_rating)
    db.commit()
    goal = client.post(
        "/goals",
        json={
            "operation_id": "delete-goal",
            "owner_kind": "task",
            "task_id": task["id"],
            "cadence": "total",
            "target_seconds": 1800.0,
        },
    ).json()
    assert (
        next(g for g in client.get("/goals").json()["goals"] if g["id"] == goal["id"])["summed_recorded_work_seconds"]
        == 1800
    )
    path = f"/recorded-work/{first['id']}"
    assert client.delete(path).status_code == 422
    assert client.delete(path, params={"expected_revision": first["revision"] + 1}).status_code == 409
    assert client.get(path).status_code == 200
    assert client.delete(path, params={"expected_revision": first["revision"]}).status_code == 204
    assert client.get(path).status_code == 404
    assert client.delete(path, params={"expected_revision": first["revision"]}).status_code == 404
    assert client.get(f"/recorded-work/{other['id']}").json()["notes"] == "Saved note"
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan
    assert client.get(f"/api/tasks/{task['id']}").status_code == 200
    assert db.get(RatingEntry, rating.id) is None
    assert db.get(RatingEntry, other_rating.id).score == 6
    assert (
        next(g for g in client.get("/goals").json()["goals"] if g["id"] == goal["id"])["summed_recorded_work_seconds"]
        == 600
    )


def test_deleted_timer_work_is_not_recreated_by_exact_stop_replay(client):
    started = client.post("/timers", json={"operation_id": "delete-start", "pause_when_idle": False}).json()["timer"]
    payload = {"operation_id": "delete-stop", "expected_revision": started["revision"]}
    stopped = client.post(f"/timers/{started['id']}/stop", json=payload)
    assert stopped.status_code == 200, stopped.text
    work_id = stopped.json()["recorded_work_ids"][0]
    saved = client.get(f"/recorded-work/{work_id}").json()
    assert (
        client.delete(f"/recorded-work/{work_id}", params={"expected_revision": saved["revision"]}).status_code == 204
    )
    replay = client.post(f"/timers/{started['id']}/stop", json=payload)
    assert replay.status_code == 200, replay.text
    assert replay.json() == stopped.json()
    assert client.get(f"/recorded-work/{work_id}").status_code == 404


def test_delete_saved_split_does_not_change_running_timer_or_restore_deleted_work(client):
    started = client.post("/timers", json={"operation_id": "split-delete-start", "pause_when_idle": False}).json()[
        "timer"
    ]
    split = client.post(
        f"/timers/{started['id']}/split",
        json={"operation_id": "split-delete-split", "expected_revision": started["revision"]},
    )
    assert split.status_code == 200, split.text
    before = split.json()["timer"]
    work_id = split.json()["recorded_work_ids"][0]
    saved = client.get(f"/recorded-work/{work_id}").json()
    assert (
        client.delete(f"/recorded-work/{work_id}", params={"expected_revision": saved["revision"]}).status_code == 204
    )
    after = client.get(f"/timers/{started['id']}").json()
    for field in ("revision", "state", "running_start", "running_segment_id", "segments", "scheduled_session_id"):
        assert after[field] == before[field]
    stopped = client.post(
        f"/timers/{started['id']}/stop",
        json={"operation_id": "split-delete-stop", "expected_revision": after["revision"]},
    )
    assert stopped.status_code == 200, stopped.text
    assert work_id not in stopped.json()["recorded_work_ids"]
    assert client.get(f"/recorded-work/{work_id}").status_code == 404


@pytest.mark.parametrize("kind", ["correction", "assignment"])
def test_delete_checks_pending_guards_without_taking_timer_lock(client, tmp_path, monkeypatch, kind):
    row = client.post(
        "/recorded-work", json={"start_time": "2025-01-01T10:00:00Z", "end_time": "2025-01-01T10:20:00Z"}
    ).json()
    path = tmp_path / "guard.json"
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(path))
    pending = {"id": "pending", "payload_hash": "hash"}
    if kind == "correction":
        pending["correction_guard"] = {"work_ids": [row["id"]]}
    else:
        pending["assignment"] = {"changes": [{"before": {"id": row["id"]}}], "task_id": "destination"}
    path.write_text(json.dumps({"version": 2, "revision": 0, "timers": {}, "pending_operation": pending}))
    with TimerStore(path).locked():
        response = client.delete(f"/recorded-work/{row['id']}", params={"expected_revision": row["revision"]})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == f"{kind}_pending"
    assert client.get(f"/recorded-work/{row['id']}").status_code == 200
