"""Selected unfinished discard through the real root HTTP interface."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest


@pytest.fixture
def clock(tmp_path, monkeypatch):
    import timetrace.services.multiple_timer_service as timers

    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))

    class Clock(datetime):
        instant = datetime(2025, 1, 1, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.instant

    monkeypatch.setattr(timers, "datetime", Clock)
    return Clock


def start(client, **values):
    response = client.post("/timers", json={"operation_id": str(uuid4()), **values})
    assert response.status_code == 200, response.text
    return response.json()["timer"]


def test_discard_only_unrecorded_time_preserves_saved_work_plan_task_and_other_timer(client, clock):
    task = client.post("/api/tasks", json={"title": "Writing", "description": "Task text"}).json()
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2025-01-01T09:00:00Z", "end_time": "2025-01-01T11:00:00Z"},
    ).json()
    timer = start(
        client,
        task_id=task["id"],
        scheduled_session_id=plan["id"],
        expected_plan_revision=plan["revision"],
        notes="Saved note",
    )
    other = start(client, notes="Other note")
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    split = client.post(
        f"/timers/{timer['id']}/split", json={"operation_id": str(uuid4()), "new_notes": "Unrecorded note"}
    ).json()
    work_id = split["recorded_work_ids"][0]
    work_before = client.get(f"/recorded-work/{work_id}").json()
    rating = client.post("/rating-definitions", json={"name": "Quality", "target_type": "session"}).json()
    assert (
        client.post(
            "/rating-entries",
            json={"rating_definition_id": rating["id"], "target_type": "session", "target_id": work_id, "score": 7},
        ).status_code
        == 201
    )
    rating_params = {"target_type": "session", "target_id": work_id}
    ratings_before = client.get("/rating-entries", params=rating_params).json()
    manifest = client.get(f"/scheduled-sessions/{plan['id']}/removal-preview").json()["manifest"]
    assert [t["id"] for t in manifest["unfinished_timers"]] == [timer["id"]]
    task_before = client.get(f"/api/tasks/{task['id']}").json()
    plan_before = client.get(f"/scheduled-sessions/{plan['id']}").json()
    other_before = client.get(f"/timers/{other['id']}").json()
    clock.instant = datetime(2025, 1, 1, 10, 15, tzinfo=UTC)
    payload = {"operation_id": str(uuid4()), "expected_revision": split["timer"]["revision"]}
    response = client.post(f"/timers/{timer['id']}/discard", json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["timer"]["state"] == "stopped"
    assert result["timer"]["discarded"] is True
    assert result["timer"]["notes"] == ""
    assert result["timer"]["running_start"] is None
    assert all(s.get("recorded_work_id") for s in result["timer"]["segments"])
    assert result["recorded_work_ids"] == []
    assert client.get(f"/recorded-work/{work_id}").json() == work_before
    assert client.get("/rating-entries", params=rating_params).json() == ratings_before
    assert client.get("/rating-definitions").json() == [rating]
    assert client.get(f"/scheduled-sessions/{plan['id']}/removal-preview").json()["manifest"]["unfinished_timers"] == []
    assert client.get(f"/api/tasks/{task['id']}").json() == task_before
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan_before
    other_after = client.get(f"/timers/{other['id']}").json()
    assert other_after.pop("elapsed_seconds") == 900
    other_before.pop("elapsed_seconds")
    assert other_after == other_before
    assert [t["id"] for t in client.get("/timers").json()["timers"]] == [other["id"]]
    assert client.post(f"/timers/{timer['id']}/discard", json=payload).json() == result
    assert client.get(f"/operations/{payload['operation_id']}").json()["result"] == result
    assert client.post(f"/timers/{timer['id']}/discard", json={**payload, "expected_revision": 999}).status_code == 409
    assert client.post(f"/timers/{timer['id']}/resume", json={"operation_id": str(uuid4())}).status_code == 400


@pytest.mark.parametrize("state", ["running", "paused", "frozen"])
def test_discard_requires_exact_revision_and_removes_selected_unfinished_state(client, db, clock, state):
    from timetrace.services.multiple_timer_service import MultipleTimerService

    timer = start(client, notes="Timer-bound note")
    if state == "paused":
        client.post(f"/timers/{timer['id']}/pause", json={"operation_id": str(uuid4())})
    elif state == "frozen":
        clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
        MultipleTimerService(db).observe_activity(600)
    before = client.get(f"/timers/{timer['id']}").json()
    assert before["state"] == state
    path = f"/timers/{timer['id']}/discard"
    missing = client.post(path, json={"operation_id": str(uuid4())})
    assert missing.status_code == 422
    stale = client.post(path, json={"operation_id": str(uuid4()), "expected_revision": before["revision"] + 1})
    assert stale.status_code == 409
    assert client.get(f"/timers/{timer['id']}").json() == before
    payload = {"operation_id": str(uuid4()), "expected_revision": before["revision"]}
    result = client.post(path, json=payload)
    assert result.status_code == 200, result.text
    assert result.json()["timer"]["idle_gaps"] == []
    assert result.json()["timer"]["segments"] == []
    assert client.get("/sessions").json() == []
    assert client.get("/timers").json()["timers"] == []
    # Retrying the old Start acknowledges its original receipt but cannot resurrect.
    assert client.get(f"/timers/{timer['id']}").json()["discarded"] is True


def test_new_discard_does_not_complete_another_pending_operation(client, db, clock, monkeypatch):
    timer = start(client)
    commit = db.commit

    def fail():
        raise OSError("DB boundary unavailable")

    monkeypatch.setattr(db, "commit", fail)
    pause_payload = {"operation_id": str(uuid4())}
    assert client.post(f"/timers/{timer['id']}/pause", json=pause_payload).status_code == 409
    monkeypatch.setattr(db, "commit", commit)
    discard_payload = {"operation_id": str(uuid4()), "expected_revision": timer["revision"]}
    refused = client.post(f"/timers/{timer['id']}/discard", json=discard_payload)
    assert refused.status_code == 409
    assert refused.json()["code"] == "reconciliation_required"
    assert client.get(f"/operations/{pause_payload['operation_id']}").json()["status"] == "pending_reconciliation"
    assert client.get(f"/operations/{discard_payload['operation_id']}").status_code == 404


@pytest.mark.parametrize("boundary", ["intent_fsync", "database_commit", "state_fsync", "finalization_commit"])
def test_discard_recovers_fixed_receipt_without_recording_or_resurrection(client, db, clock, monkeypatch, boundary):
    import os

    from timetrace.services.multiple_timer_service import MultipleTimerService

    start_payload = {"operation_id": str(uuid4()), "notes": "Throw away"}
    timer = client.post("/timers", json=start_payload).json()["timer"]
    other = start(client)
    commit, fsync = db.commit, os.fsync
    commits = syncs = 0

    def commit_fault():
        nonlocal commits
        commits += 1
        if (boundary == "database_commit" and commits == 1) or (boundary == "finalization_commit" and commits == 2):
            raise OSError("injected commit boundary")
        commit()

    def fsync_fault(fd):
        nonlocal syncs
        syncs += 1
        if (boundary == "intent_fsync" and syncs == 2) or (boundary == "state_fsync" and syncs == 4):
            raise OSError("injected directory fsync boundary")
        fsync(fd)

    monkeypatch.setattr(db, "commit", commit_fault)
    monkeypatch.setattr(os, "fsync", fsync_fault)
    payload = {"operation_id": str(uuid4()), "expected_revision": timer["revision"]}
    failed = client.post(f"/timers/{timer['id']}/discard", json=payload)
    assert failed.status_code == 409, failed.text
    assert client.get(f"/operations/{payload['operation_id']}").json()["status"] == "pending_reconciliation"
    monkeypatch.setattr(db, "commit", commit)
    monkeypatch.setattr(os, "fsync", fsync)
    # Startup's public reconciliation barrier finishes the fixed original intent.
    MultipleTimerService(db).reconcile()
    receipt = client.get(f"/operations/{payload['operation_id']}").json()
    assert receipt["status"] == "finalized"
    assert receipt["result"]["timer"]["discarded"] is True
    assert receipt["result"]["recorded_work_ids"] == []
    assert client.get("/sessions").json() == []
    assert [t["id"] for t in client.get("/timers").json()["timers"]] == [other["id"]]
    assert client.post("/timers", json=start_payload).json()["timer"]["id"] == timer["id"]
    assert client.get(f"/timers/{timer['id']}").json()["state"] == "stopped"
    assert client.get(f"/operations/{payload['operation_id']}").json() == receipt


def test_discard_preserves_signed_correction_receipt_and_rejects_unused_approval(client, clock, monkeypatch, tmp_path):
    from timetrace.config import settings

    monkeypatch.setattr(settings, "db_file", tmp_path / "installation.db")
    timer = start(client)
    assert client.post("/timers/correction-initialize", json={"operation_id": str(uuid4())}).status_code == 200
    path = f"/timers/{timer['id']}"
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    request = {
        "target": {"kind": "running", "segment_id": timer["running_segment_id"]},
        "change": {"kind": "step_start", "credited_delta_seconds": -300},
    }
    preview = client.post(path + "/correction-preview", json=request)
    assert preview.status_code == 200, preview.text
    correction_payload = {"operation_id": str(uuid4()), "preview": preview.json()}
    corrected = client.post(path + "/correction", json=correction_payload)
    assert corrected.status_code == 200, corrected.text
    unused_response = client.post(
        path + "/correction-preview", json={**request, "change": {"kind": "step_start", "credited_delta_seconds": 300}}
    )
    assert unused_response.status_code == 200, unused_response.text
    unused = unused_response.json()
    discarded = client.post(
        path + "/discard",
        json={"operation_id": str(uuid4()), "expected_revision": corrected.json()["timer"]["revision"]},
    )
    assert discarded.status_code == 200, discarded.text
    assert client.post(path + "/correction", json=correction_payload).json() == corrected.json()
    assert client.get(f"/operations/{correction_payload['operation_id']}").json()["result"] == corrected.json()
    stale = client.post(path + "/correction", json={"operation_id": str(uuid4()), "preview": unused})
    assert stale.status_code == 409, stale.text
    assert client.get(path).json()["discarded"] is True
    assert client.get("/timers").json()["timers"] == []


def test_discard_legacy_frozen_timer_removes_live_note_copy_but_preserves_migration_backup(client, clock, tmp_path):
    import json

    path = tmp_path / "timers.json"
    legacy = {
        "is_running": False,
        "is_frozen_idle": True,
        "notes": "Legacy note",
        "start_time": "2025-01-01T10:00:00+00:00",
        "pending_idle_gap": {"idle_start": "2025-01-01T10:10:00+00:00"},
    }
    path.write_text(json.dumps(legacy))
    timer = client.get("/timers").json()["timers"][0]
    response = client.post(
        f"/timers/{timer['id']}/discard", json={"operation_id": str(uuid4()), "expected_revision": timer["revision"]}
    )
    assert response.status_code == 200, response.text
    assert response.json()["timer"]["notes"] == ""
    assert "legacy_payload" not in response.json()["timer"]
    assert json.loads(path.with_suffix(".v1.backup").read_text()) == legacy


def test_discard_leaves_other_running_paused_and_frozen_timers_unchanged(client, db, clock):
    from timetrace.services.multiple_timer_service import MultipleTimerService

    selected = start(client, pause_when_idle=False)
    running = start(client, pause_when_idle=False, notes="Running note")
    paused = start(client, notes="Paused note")
    assert client.post(f"/timers/{paused['id']}/pause", json={"operation_id": str(uuid4())}).status_code == 200
    frozen = start(client, notes="Frozen note")
    clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    MultipleTimerService(db).observe_activity(600)
    ids = [running["id"], paused["id"], frozen["id"]]
    before = [client.get(f"/timers/{identity}").json() for identity in ids]
    assert [timer["state"] for timer in before] == ["running", "paused", "frozen"]
    response = client.post(
        f"/timers/{selected['id']}/discard",
        json={"operation_id": str(uuid4()), "expected_revision": selected["revision"]},
    )
    assert response.status_code == 200, response.text
    assert [client.get(f"/timers/{identity}").json() for identity in ids] == before
