from datetime import datetime

from sqlmodel import select

from timetrace.db.models import MutationOperation, ScheduledSession, Task
from timetrace.db.models import Session as Work


def seed(db):
    task = Task(title="Task")
    db.add(task)
    db.flush()
    plan = ScheduledSession(
        task_id=task.id,
        original_start=datetime(2020, 1, 1, 9),
        original_end=datetime(2020, 1, 1, 10),
        start_time=datetime(2020, 1, 1, 9),
        end_time=datetime(2020, 1, 1, 10),
    )
    db.add(plan)
    db.flush()
    work = []
    for start, end, owned in [(10, 30, True), (50, 70, True), (15, 25, False)]:
        from datetime import timedelta

        base = datetime(2020, 1, 1, 9)
        row = Work(
            task_id=task.id,
            start_time=base + timedelta(minutes=start),
            end_time=base + timedelta(minutes=end),
            duration_seconds=(end - start) * 60,
            kind="recorded_work",
            provenance="manual",
            scheduled_session_id=plan.id if owned else None,
        )
        db.add(row)
        work.append(row)
    db.commit()
    return plan, work


def preview(client, plan):
    response = client.get(f"/scheduled-sessions/{plan.id}/removal-preview")
    assert response.status_code == 200, response.text
    return response.json()


def apply(client, plan, snapshot, action="delete_everything", key="test-op"):
    return client.post(
        f"/scheduled-sessions/{plan.id}/removal",
        json={"action": action, "consent_token": snapshot["consent_token"], "operation_id": key},
    )


def test_preview_cancel_no_write(client, db):
    plan, work = seed(db)
    result = preview(client, plan)
    assert len(result["manifest"]["work"]) == 2
    assert result["manifest"]["work"][1]["end_time"].startswith("2020-01-01T10:10")
    saved = client.get(f"/scheduled-sessions/{plan.id}")
    assert saved.status_code == 200
    assert saved.json()["revision"] == 1
    for row in work:
        assert client.get(f"/recorded-work/{row.id}").status_code == 200
    assert client.get("/operations/plan-removal:test-op").status_code == 404


def test_delete_whole_exact_and_retry(client, db):
    plan, work = seed(db)
    snap = preview(client, plan)
    result = apply(client, plan, snap)
    assert result.status_code == 200, result.text
    assert client.get(f"/scheduled-sessions/{plan.id}").status_code == 404
    assert client.get(f"/recorded-work/{work[0].id}").status_code == 404
    assert client.get(f"/recorded-work/{work[1].id}").status_code == 404
    remaining = client.get(f"/recorded-work/{work[2].id}")
    assert remaining.status_code == 200
    assert remaining.json()["scheduled_session_id"] is None
    recovered = client.get("/operations/" + result.json()["operation_id"])
    assert recovered.status_code == 200
    assert recovered.json()["result"] == result.json()
    assert apply(client, plan, snap).json() == result.json()
    assert apply(client, plan, snap, "squeeze").status_code == 409


def test_squeeze_preserves_gap_original_and_raw(client, db):
    plan, work = seed(db)
    result = apply(client, plan, preview(client, plan), "squeeze")
    assert result.status_code == 200, result.text
    response = client.get(f"/scheduled-sessions/{plan.id}")
    assert response.status_code == 200
    saved = response.json()
    assert saved["start_time"] == "2020-01-01T09:10:00Z"
    assert saved["end_time"] == "2020-01-01T10:10:00Z"
    assert saved["original_start"] == "2020-01-01T09:00:00Z"
    assert saved["original_end"] == "2020-01-01T10:00:00Z"
    for row, start, end, association in [
        (work[0], "2020-01-01T09:10:00Z", "2020-01-01T09:30:00Z", plan.id),
        (work[1], "2020-01-01T09:50:00Z", "2020-01-01T10:10:00Z", plan.id),
        (work[2], "2020-01-01T09:15:00Z", "2020-01-01T09:25:00Z", None),
    ]:
        read = client.get(f"/recorded-work/{row.id}")
        assert read.status_code == 200
        assert read.json()["start_time"] == start
        assert read.json()["end_time"] == end
        assert read.json()["scheduled_session_id"] == association


def test_stale_work_refuses_without_partial_write(client, db):
    plan, work = seed(db)
    snap = preview(client, plan)
    work[0].notes = "changed"
    db.add(work[0])
    db.commit()
    assert apply(client, plan, snap).status_code == 409
    assert len(db.exec(select(Work)).all()) == 3
    assert db.get(ScheduledSession, plan.id)


def test_unrelated_timer_and_append_only_audit_survive(client, db, tmp_path):
    from uuid import uuid4

    from timetrace.db.models import AIAudit

    plan, work = seed(db)
    started = client.post("/timers", json={"operation_id": str(uuid4())})
    assert started.status_code == 200
    audit = AIAudit(
        batch_id="historical",
        entity_id=work[0].id,
        entity_type="session",
        transition="applied",
        after_json='{"historical":true}',
    )
    db.add(audit)
    db.commit()
    path = tmp_path / "active_timer.json"
    before = path.read_bytes()
    assert apply(client, plan, preview(client, plan)).status_code == 200
    assert before == path.read_bytes()
    assert db.get(AIAudit, audit.id).entity_id == work[0].id
    assert not db.connection().exec_driver_sql("PRAGMA foreign_key_check").all()


def test_new_association_stales_old_consent(client, db):
    plan, work = seed(db)
    snap = preview(client, plan)
    work[2].scheduled_session_id = plan.id
    db.add(work[2])
    db.commit()
    assert apply(client, plan, snap).status_code == 409
    assert len(db.exec(select(Work)).all()) == 3


def test_recurrence_override_becomes_skip(client, db):
    from timetrace.db.models import RecurrenceException

    plan, _ = seed(db)
    anchor = RecurrenceException(
        task_id=plan.task_id, occurrence_start=plan.original_start, kind="override", scheduled_session_id=plan.id
    )
    db.add(anchor)
    db.commit()
    assert apply(client, plan, preview(client, plan)).status_code == 200
    db.refresh(anchor)
    assert anchor.kind == "skip"
    assert anchor.scheduled_session_id is None


def test_timer_context_manifest_blocks_without_file_mutation(client, db, monkeypatch, tmp_path):
    import json
    from uuid import uuid4

    plan, _ = seed(db)
    response = client.post(
        "/timers",
        json={
            "operation_id": str(uuid4()),
            "task_id": plan.task_id,
            "scheduled_session_id": plan.id,
            "expected_plan_revision": plan.revision,
        },
    )
    assert response.status_code == 200
    path = tmp_path / "active_timer.json"
    state = json.loads(path.read_text())
    timer = state["timers"][response.json()["timer"]["id"]]
    for context in ["frozen", "segment", "gap", "pending"]:
        from copy import deepcopy

        changed = deepcopy(state)
        current = changed["timers"][timer["id"]]
        current["scheduled_session_id"] = None
        current["state"] = "paused"
        if context == "frozen":
            current["state"] = "frozen_idle"
            current["scheduled_session_id"] = plan.id
        elif context == "segment":
            current["segments"] = [{"scheduled_session_id": plan.id}]
        elif context == "gap":
            current["idle_gaps"] = [{"scheduled_session_id": plan.id, "decision": None}]
        else:
            after = deepcopy(changed)
            after["timers"][timer["id"]]["scheduled_session_id"] = plan.id
            changed["pending_operation"] = {"after_state_json": json.dumps(after)}
        path.write_text(json.dumps(changed))
        before = path.read_bytes()
        snap = preview(client, plan)
        assert snap["blocked"]["delete_everything"]
        assert apply(client, plan, snap).status_code == 409
        assert apply(client, plan, snap, "squeeze").status_code == 409
        assert before == path.read_bytes()


def test_receipt_lookup_lost_ack(client, db):
    plan, _ = seed(db)
    result = apply(client, plan, preview(client, plan)).json()
    recovered = client.get("/operations/" + result["operation_id"])
    assert recovered.status_code == 200
    assert recovered.json()["result"] == result


def test_no_work_squeeze_refuses(client, db):
    plan, work = seed(db)
    for row in work:
        db.delete(row)
    db.commit()
    result = apply(client, plan, preview(client, plan), "squeeze")
    assert result.status_code == 409
    assert db.get(ScheduledSession, plan.id)


def test_running_and_paused_block_both(client, db):
    from uuid import uuid4

    plan, _ = seed(db)
    old = preview(client, plan)
    started = client.post(
        "/timers",
        json={
            "operation_id": str(uuid4()),
            "task_id": plan.task_id,
            "scheduled_session_id": plan.id,
            "expected_plan_revision": plan.revision,
        },
    )
    assert started.status_code == 200, started.text
    assert apply(client, plan, old).status_code == 409
    for action in ["delete_everything", "squeeze"]:
        snap = preview(client, plan)
        assert snap["manifest"]["unfinished_timers"]
        assert apply(client, plan, snap, action).status_code == 409
    timer_id = started.json()["timer"]["id"]
    assert client.post(f"/timers/{timer_id}/pause", json={"operation_id": str(uuid4())}).status_code == 200
    assert apply(client, plan, preview(client, plan)).status_code == 409


def test_rating_dependency_safe_refusal(client, db):
    from timetrace.db.models import RatingDefinition, RatingEntry

    plan, work = seed(db)
    definition = RatingDefinition(name="Quality")
    db.add(definition)
    db.flush()
    db.add(RatingEntry(rating_definition_id=definition.id, target_type="session", target_id=work[0].id))
    db.commit()
    snap = preview(client, plan)
    assert len(snap["manifest"]["ratings"]) == 1
    assert apply(client, plan, snap).status_code == 409
    assert len(db.exec(select(Work)).all()) == 3


def test_atomic_rollback_receipt_failure(client, db, monkeypatch):
    import pytest

    plan, _ = seed(db)
    snap = preview(client, plan)
    original = db.commit

    def fail():
        raise RuntimeError("simulated storage failure")

    monkeypatch.setattr(db, "commit", fail)
    with pytest.raises(RuntimeError):
        apply(client, plan, snap)
    monkeypatch.setattr(db, "commit", original)
    assert db.get(ScheduledSession, plan.id)
    assert len(db.exec(select(Work)).all()) == 3
    assert not db.exec(select(MutationOperation)).all()
