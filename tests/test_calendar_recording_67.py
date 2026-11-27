"""Reviewed Calendar recording uses the public work creation boundary and receipt reads."""

from uuid import uuid4


def plan_for(client):
    task = client.post("/api/tasks", json={"title": "Calendar work"}).json()
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2025-01-01T09:00:00Z", "end_time": "2025-01-01T10:00:00Z"},
    ).json()
    return task, plan


def recording(plan):
    return {
        "task_id": plan["task_id"],
        "scheduled_session_id": plan["id"],
        "expected_plan_revision": plan["revision"],
        "start_time": plan["start_time"],
        "end_time": plan["end_time"],
    }


def test_reviewed_recording_keeps_schedule_and_task_and_lost_ack_recovers_by_get(client):
    task, plan = plan_for(client)
    request = recording(plan)
    preview = client.post("/recorded-work/preview", json=request)
    assert preview.status_code == 200, preview.text
    assert preview.json()["existing_work"] == []
    operation_id = str(uuid4())
    request.update(operation_id=operation_id, consent_token=preview.json()["consent_token"])
    response = client.post("/recorded-work", json=request)
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["scheduled_session_id"] == plan["id"]
    assert result["duration_seconds"] == 3600
    assert client.get(f"/operations/recorded-work:{operation_id}").json()["result"] == result
    assert client.post("/recorded-work", json=request).json() == result
    current = client.get(f"/scheduled-sessions/{plan['id']}").json()
    assert current["start_time"] == plan["start_time"]
    assert current["end_time"] == plan["end_time"]
    assert current["original_start"] == plan["original_start"]
    assert current["revision"] == 2
    assert client.get(f"/api/tasks/{task['id']}").json()["status"] == task["status"]


def test_reviewed_duplicate_requires_fresh_preview_and_explicit_acknowledgement(client):
    _, plan = plan_for(client)
    original = client.post("/recorded-work", json=recording(plan))
    assert original.status_code == 201, original.text
    plan = client.get(f"/scheduled-sessions/{plan['id']}").json()
    request = recording(plan)
    preview = client.post("/recorded-work/preview", json=request).json()
    assert [w["id"] for w in preview["existing_work"]] == [original.json()["id"]]
    assert preview["duplicate_warning"] is True
    request.update(operation_id=str(uuid4()), consent_token=preview["consent_token"])
    refused = client.post("/recorded-work", json=request)
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "recording_overlap_unacknowledged"
    request["acknowledge_existing_work"] = True
    created = client.post("/recorded-work", json=request)
    assert created.status_code == 201, created.text
    assert created.json()["id"] != original.json()["id"]
    # Intentional overlap remains supported, not globally prohibited.
    assert client.post("/recorded-work", json=request).json() == created.json()


def test_new_recording_after_preview_invalidates_consent_without_creating_another(client):
    _, plan = plan_for(client)
    request = {"task_id": plan["task_id"], "start_time": plan["start_time"], "end_time": plan["end_time"]}
    preview = client.post("/recorded-work/preview", json=request)
    assert preview.status_code == 200, preview.text
    first = client.post("/recorded-work", json=request).json()
    response = client.post(
        "/recorded-work",
        json={
            **request,
            "operation_id": str(uuid4()),
            "consent_token": preview.json()["consent_token"],
            "acknowledge_existing_work": True,
        },
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "recording_preview_stale"
    latest = client.post("/recorded-work/preview", json=request).json()
    assert [w["id"] for w in latest["existing_work"]] == [first["id"]]


def test_taskless_recording_is_receipted_but_taskless_plan_cannot_be_linked(client):
    request = {"start_time": "2025-01-01T09:00:00Z", "end_time": "2025-01-01T10:00:00Z"}
    approval = client.post("/recorded-work/preview", json=request)
    assert approval.status_code == 200, approval.text
    response = client.post(
        "/recorded-work",
        json={**request, "operation_id": str(uuid4()), "consent_token": approval.json()["consent_token"]},
    )
    assert response.status_code == 201, response.text
    assert response.json()["task_id"] is None
    plan = client.post("/scheduled-sessions", json=request).json()
    invalid = client.post(
        "/recorded-work/preview",
        json={**request, "scheduled_session_id": plan["id"], "expected_plan_revision": plan["revision"]},
    )
    assert invalid.status_code == 409, invalid.text
    assert invalid.json()["code"] == "association_task_conflict"


def test_receipted_recording_storage_failure_rolls_back_row_and_plan_revision(client, db, monkeypatch):
    import pytest

    _, plan = plan_for(client)
    request = recording(plan)
    approval = client.post("/recorded-work/preview", json=request).json()
    original = db.commit

    def fail():
        raise RuntimeError("synthetic DB failure")

    monkeypatch.setattr(db, "commit", fail)
    with pytest.raises(RuntimeError, match="synthetic DB failure"):
        client.post(
            "/recorded-work",
            json={**request, "operation_id": "recording-rollback", "consent_token": approval["consent_token"]},
        )
    monkeypatch.setattr(db, "commit", original)
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan
    assert client.post("/recorded-work/preview", json=request).json()["existing_work"] == []
    assert client.get("/operations/recorded-work:recording-rollback").status_code == 404


def test_receipted_recording_rejects_payload_reuse_and_future_end(client):
    _, plan = plan_for(client)
    request = recording(plan)
    approval = client.post("/recorded-work/preview", json=request).json()
    payload = {**request, "operation_id": "immutable-recording", "consent_token": approval["consent_token"]}
    created = client.post("/recorded-work", json=payload)
    assert created.status_code == 201, created.text
    changed = client.post("/recorded-work", json={**payload, "notes": "Changed after acceptance"})
    assert changed.status_code == 409, changed.text
    assert changed.json()["code"] == "operation_payload_mismatch"
    assert client.get("/operations/recorded-work:immutable-recording").json()["result"] == created.json()
    future = client.post(
        "/recorded-work/preview", json={"start_time": "2099-01-01T09:00:00Z", "end_time": "2099-01-01T10:00:00Z"}
    )
    assert future.status_code == 400, future.text
    assert future.json()["code"] == "future_recorded_end"
