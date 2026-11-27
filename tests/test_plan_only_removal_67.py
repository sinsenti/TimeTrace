"""Exact plan-only removal preserves recorded work and history through root HTTP."""

from test_plan_removal import apply, preview, seed


def test_remove_schedule_detaches_but_preserves_work_ratings_and_original_evidence(client, db):
    from timetrace.db.models import RatingDefinition, RatingEntry

    plan, rows = seed(db)
    definition = RatingDefinition(name="Quality")
    db.add(definition)
    db.flush()
    db.add(RatingEntry(rating_definition_id=definition.id, target_type="session", target_id=rows[0].id, score=4))
    db.commit()
    before = [client.get(f"/recorded-work/{r.id}").json() for r in rows]
    snap = preview(client, plan)
    assert snap["blocked"]["delete_everything"]
    assert snap["blocked"]["remove_schedule"] == []
    response = apply(client, plan, snap, "remove_schedule", "remove-plan-only")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["removed_plan"] == snap["manifest"]["plan"]
    assert result["work_before"] == snap["manifest"]["work"]
    assert set(result["preserved_work_ids"]) == {rows[0].id, rows[1].id}
    assert client.get(f"/scheduled-sessions/{plan.id}").status_code == 404
    for original, row in zip(before, rows, strict=True):
        current = client.get(f"/recorded-work/{row.id}").json()
        assert current == {
            **original,
            "scheduled_session_id": None,
            "revision": original["revision"] + (1 if original["scheduled_session_id"] else 0),
        }
    ratings = client.get(f"/rating-entries?target_type=session&target_id={rows[0].id}")
    assert ratings.status_code == 200, ratings.text
    assert ratings.json()[0]["score"] == 4
    assert apply(client, plan, snap, "remove_schedule", "remove-plan-only").json() == result
    assert client.get("/operations/plan-removal:remove-plan-only").json()["result"] == result


def test_plan_ratings_or_unfinished_timer_refuse_removal_without_detaching_work(client, db):
    from uuid import uuid4

    plan, rows = seed(db)
    timer = client.post(
        "/timers",
        json={
            "operation_id": str(uuid4()),
            "task_id": plan.task_id,
            "scheduled_session_id": plan.id,
            "expected_plan_revision": plan.revision,
        },
    ).json()["timer"]
    client.post(f"/timers/{timer['id']}/pause", json={"operation_id": str(uuid4())})
    snap = preview(client, plan)
    assert snap["blocked"]["remove_schedule"]
    refused = apply(client, plan, snap, "remove_schedule")
    assert refused.status_code == 409, refused.text
    for row in rows[:2]:
        assert client.get(f"/recorded-work/{row.id}").json()["scheduled_session_id"] == plan.id


def test_plan_only_recurrence_removal_retains_skip_and_work(client, db):
    from timetrace.db.models import RecurrenceException

    plan, rows = seed(db)
    anchor = RecurrenceException(
        task_id=plan.task_id, occurrence_start=plan.original_start, kind="override", scheduled_session_id=plan.id
    )
    db.add(anchor)
    db.commit()
    response = apply(client, plan, preview(client, plan), "remove_schedule")
    assert response.status_code == 200, response.text
    db.refresh(anchor)
    assert anchor.kind == "skip"
    assert anchor.scheduled_session_id is None
    assert all(client.get(f"/recorded-work/{r.id}").status_code == 200 for r in rows)


def projected_plan(client, monkeypatch):
    from datetime import UTC, datetime

    import timetrace.services.recurrence_service as recurrence

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2025, 1, 1, 8, tzinfo=UTC)

    monkeypatch.setattr(recurrence, "datetime", Clock)
    task = client.post(
        "/api/tasks",
        json={
            "title": "Remove one projection",
            "is_recurring": True,
            "recurrence_rrule": "FREQ=DAILY",
            "recurrence_dtstart": "2025-01-01T09:00:00Z",
            "recurrence_duration_minutes": 60,
            "recurrence_timezone": "UTC",
        },
    ).json()
    items = client.get("/agenda", params={"start": "2025-01-01T00:00:00Z", "end": "2025-01-03T00:00:00Z"}).json()[
        "items"
    ]
    return task, items


def test_remove_projected_schedule_is_read_only_until_consent_and_skips_only_selected(client, monkeypatch, tmp_path):
    task, (plan, other) = projected_plan(client, monkeypatch)
    work = client.post(
        "/recorded-work",
        json={"task_id": task["id"], "start_time": "2024-12-30T09:00:00Z", "end_time": "2024-12-30T10:00:00Z"},
    ).json()
    before = client.get(f"/api/tasks/{task['id']}").json()
    path = tmp_path / "active_timer.json"
    timer_before = path.read_bytes() if path.exists() else None
    response = client.get(f"/scheduled-sessions/{plan['id']}/removal-preview")
    assert response.status_code == 200, response.text
    snapshot = response.json()
    assert snapshot["manifest"]["plan"]["projection_revision"] == plan["projection_revision"]
    assert snapshot["blocked"]["remove_schedule"] == []
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan
    assert (path.read_bytes() if path.exists() else None) == timer_before
    payload = {
        "operation_id": "one-projection",
        "action": "remove_schedule",
        "consent_token": snapshot["consent_token"],
    }
    removed = client.post(f"/scheduled-sessions/{plan['id']}/removal", json=payload)
    assert removed.status_code == 200, removed.text
    assert removed.json()["preserved_work_ids"] == []
    assert client.get(f"/scheduled-sessions/{plan['id']}").status_code == 404
    assert client.get(f"/scheduled-sessions/{other['id']}").json() == other
    assert client.get(f"/recorded-work/{work['id']}").status_code == 200
    assert client.get(f"/api/tasks/{task['id']}").json() == before
    assert client.get("/operations/plan-removal:one-projection").json()["result"] == removed.json()
    assert client.post(f"/scheduled-sessions/{plan['id']}/removal", json=payload).json() == removed.json()


def test_projection_materialized_between_preview_and_removal_is_not_deleted(client, monkeypatch):
    _, (plan, _) = projected_plan(client, monkeypatch)
    previewed = client.get(f"/scheduled-sessions/{plan['id']}/removal-preview")
    assert previewed.status_code == 200, previewed.text
    captured = client.put(
        f"/scheduled-sessions/{plan['id']}",
        json={
            "expected_projection_revision": plan["projection_revision"],
            "start_time": "2025-01-01T10:00:00Z",
            "end_time": "2025-01-01T11:00:00Z",
        },
    )
    assert captured.status_code == 200, captured.text
    result = client.post(
        f"/scheduled-sessions/{plan['id']}/removal",
        json={
            "operation_id": "stale-projection",
            "action": "remove_schedule",
            "consent_token": previewed.json()["consent_token"],
        },
    )
    assert result.status_code == 409, result.text
    assert result.json()["code"] == "stale_plan_manifest"
    assert client.get(f"/scheduled-sessions/{captured.json()['id']}").json() == captured.json()


def test_pending_projection_capture_blocks_only_this_removal_without_mutation(client, db, monkeypatch, tmp_path):
    import os
    from uuid import uuid4

    import timetrace.services.multiple_timer_service as timers
    import timetrace.services.recurrence_service as recurrence

    task, (plan, _) = projected_plan(client, monkeypatch)
    monkeypatch.setattr(timers, "datetime", recurrence.datetime)
    original = os.fsync
    calls = 0

    def fail_after_intent(fd):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("accepted capture not yet committed")
        original(fd)

    monkeypatch.setattr(os, "fsync", fail_after_intent)
    response = client.post(
        "/timers",
        json={
            "operation_id": str(uuid4()),
            "task_id": task["id"],
            "scheduled_session_id": plan["id"],
            "expected_projection_revision": plan["projection_revision"],
        },
    )
    assert response.status_code == 409, response.text
    monkeypatch.setattr(os, "fsync", original)
    path = tmp_path / "active_timer.json"
    before = path.read_bytes()
    snapshot = client.get(f"/scheduled-sessions/{plan['id']}/removal-preview")
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()["blocked"]["remove_schedule"]
    refused = client.post(
        f"/scheduled-sessions/{plan['id']}/removal",
        json={
            "operation_id": "pending-capture",
            "action": "remove_schedule",
            "consent_token": snapshot.json()["consent_token"],
        },
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "plan_removal_blocked"
    assert path.read_bytes() == before
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan


def test_projection_removal_receipt_failure_rolls_back_skip(client, db, monkeypatch):
    import pytest

    _, (plan, _) = projected_plan(client, monkeypatch)
    snapshot = client.get(f"/scheduled-sessions/{plan['id']}/removal-preview").json()
    original = db.commit

    def fail():
        raise RuntimeError("synthetic receipt failure")

    monkeypatch.setattr(db, "commit", fail)
    with pytest.raises(RuntimeError, match="synthetic receipt failure"):
        client.post(
            f"/scheduled-sessions/{plan['id']}/removal",
            json={
                "operation_id": "rollback-projection",
                "action": "remove_schedule",
                "consent_token": snapshot["consent_token"],
            },
        )
    monkeypatch.setattr(db, "commit", original)
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan
    assert client.get("/operations/plan-removal:rollback-projection").status_code == 404


def test_plan_ratings_block_plan_only_removal_and_stale_work_keeps_all_rows(client, db):
    from timetrace.db.models import RatingDefinition, RatingEntry

    plan, rows = seed(db)
    snapshot = preview(client, plan)
    note = client.patch(f"/recorded-work/{rows[0].id}/note", json={"expected_revision": 1, "notes": "Keep history"})
    assert note.status_code == 200, note.text
    stale = apply(client, plan, snapshot, "remove_schedule")
    assert stale.status_code == 409, stale.text
    assert stale.json()["code"] == "stale_plan_manifest"
    definition = RatingDefinition(name="Plan quality")
    db.add(definition)
    db.flush()
    db.add(RatingEntry(rating_definition_id=definition.id, target_type="session", target_id=plan.id, score=3))
    db.commit()
    snapshot = preview(client, plan)
    assert snapshot["blocked"]["remove_schedule"]
    assert apply(client, plan, snapshot, "remove_schedule").status_code == 409
    assert client.get(f"/recorded-work/{rows[0].id}").json() == note.json()
    assert client.get(f"/scheduled-sessions/{plan.id}").status_code == 200
