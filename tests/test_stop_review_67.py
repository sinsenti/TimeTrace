"""Stop review through the actual daemon HTTP API; synthetic clock and private timer file."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest


@pytest.fixture
def clock(monkeypatch):
    import timetrace.services.multiple_timer_service as timers

    class Clock(datetime):
        instant = datetime(2025, 1, 1, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.instant

    monkeypatch.setattr(timers, "datetime", Clock)
    return Clock


def post(client, path, **payload):
    response = client.post(path, json={"operation_id": str(uuid4()), **payload})
    assert response.status_code == 200, response.text
    return response.json()


def prepare(client, timer):
    return post(client, f"/timers/{timer['id']}/stop-review", expected_revision=timer["revision"])


def preview(client, timer, **selection):
    response = client.post(
        f"/timers/{timer['id']}/stop-preview",
        json={"review_id": timer["stop_review"]["id"], "expected_revision": timer["revision"], **selection},
    )
    assert response.status_code == 200, response.text
    return response.json()


def commit(client, timer, approval, policy="actual", **selection):
    return post(
        client,
        f"/timers/{timer['id']}/stop-commit",
        review_id=timer["stop_review"]["id"],
        expected_revision=timer["revision"],
        consent_token=approval["consent_token"],
        policy=policy,
        **selection,
    )


def test_review_pauses_selected_at_cutoff_and_continue_excludes_decision_time(client, clock):
    timer = post(client, "/timers")["timer"]
    other = post(client, "/timers")["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    review = prepare(client, timer)
    paused = review["timer"]
    assert paused["state"] == "paused"
    assert paused["stop_review"] == {
        "id": review["operation_id"],
        "cutoff": "2025-01-01T10:10:00+00:00",
        "was_running": True,
        "timer_revision": 2,
    }
    assert client.get(f"/operations/{review['operation_id']}").json()["result"] == review
    assert client.get(f"/timers/{other['id']}").json()["state"] == "running"
    approval = preview(client, paused)
    clock.instant = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    continued = commit(client, paused, approval, "continue")["timer"]
    assert continued["running_start"] == "2025-01-01T10:30:00+00:00"
    clock.instant = datetime(2025, 1, 1, 10, 35, tzinfo=UTC)
    final = prepare(client, continued)["timer"]
    result = commit(client, final, preview(client, final))
    rows = [client.get(f"/recorded-work/{i}").json() for i in result["recorded_work_ids"]]
    assert [r["duration_seconds"] for r in rows] == [600, 300]
    assert all(r["task_id"] is None for r in rows)
    assert client.get(f"/timers/{other['id']}").json()["state"] == "running"


def test_previously_paused_review_cancel_stays_paused_and_cannot_continue(client, clock):
    timer = post(client, "/timers")["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    paused = post(client, f"/timers/{timer['id']}/pause")["timer"]
    reviewed = prepare(client, paused)["timer"]
    clock.instant = datetime(2025, 1, 1, 11, tzinfo=UTC)
    assert client.get(f"/timers/{timer['id']}").json()["state"] == "paused"
    assert reviewed["stop_review"]["was_running"] is False
    approval = preview(client, reviewed)
    assert approval["blocked"]["continue"]
    response = client.post(
        f"/timers/{timer['id']}/stop-commit",
        json={
            "operation_id": str(uuid4()),
            "review_id": reviewed["stop_review"]["id"],
            "expected_revision": reviewed["revision"],
            "consent_token": approval["consent_token"],
            "policy": "continue",
        },
    )
    assert response.status_code == 409
    result = commit(client, reviewed, approval)
    assert client.get(f"/recorded-work/{result['recorded_work_ids'][0]}").json()["duration_seconds"] == 600


def task_plan(client, start="2025-01-01T09:00:00Z", end="2025-01-01T11:00:00Z"):
    task = client.post("/api/tasks", json={"title": "Write"}).json()
    response = client.post("/scheduled-sessions", json={"task_id": task["id"], "start_time": start, "end_time": end})
    assert response.status_code == 201, response.text
    return task, response.json()


def linked_start(client, task, plan):
    return post(
        client, "/timers", task_id=task["id"], scheduled_session_id=plan["id"], expected_plan_revision=plan["revision"]
    )["timer"]


def select_plan(client, plan):
    current = client.get(f"/scheduled-sessions/{plan['id']}").json()
    return {"scheduled_session_id": current["id"], "expected_plan_revision": current["revision"]}


def test_actual_fit_is_one_operation_and_keeps_original_and_unrelated_plans(client, clock):
    task, plan = task_plan(client)
    _, other = task_plan(client)
    timer = linked_start(client, task, plan)
    clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    assert approval["blocked"]["fit"] == []
    assert approval["effects"]["fit"]["parts"] == [
        {"start_time": "2025-01-01T10:00:00+00:00", "end_time": "2025-01-01T10:20:00+00:00"}
    ]
    result = commit(client, timer, approval, "fit", **selection)
    current = client.get(f"/scheduled-sessions/{plan['id']}").json()
    assert (current["start_time"], current["end_time"]) == ("2025-01-01T10:00:00Z", "2025-01-01T10:20:00Z")
    assert (current["original_start"], current["original_end"]) == (plan["original_start"], plan["original_end"])
    assert current["revision"] == selection["expected_plan_revision"] + 2
    assert client.get(f"/scheduled-sessions/{other['id']}").json() == other
    assert result["schedule"]["part_ids"] == [plan["id"]]
    work = client.get(f"/recorded-work/{result['recorded_work_ids'][0]}").json()
    assert work["scheduled_session_id"] == plan["id"]
    assert work["duration_seconds"] == 1200


def test_opt_in_split_keeps_pauses_out_and_returns_stable_mapping_and_links(client, clock):
    task, plan = task_plan(client)
    timer = linked_start(client, task, plan)
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    post(client, f"/timers/{timer['id']}/pause")
    clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    timer = post(client, f"/timers/{timer['id']}/resume")["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    assert approval["blocked"]["fit"]
    assert approval["blocked"]["split"] == []
    operation_id = str(uuid4())
    result = commit(client, timer, approval, "split", operation_id=operation_id, **selection)
    mapping = result["schedule"]
    assert mapping["source_plan_id"] == plan["id"]
    assert mapping["original_start"] == plan["original_start"]
    assert mapping["original_end"] == plan["original_end"]
    assert len(mapping["part_ids"]) == 2
    assert mapping["part_ids"][0] == plan["id"]
    parts = [client.get(f"/scheduled-sessions/{i}").json() for i in mapping["part_ids"]]
    assert [(p["start_time"], p["end_time"]) for p in parts] == [
        ("2025-01-01T10:00:00Z", "2025-01-01T10:10:00Z"),
        ("2025-01-01T10:20:00Z", "2025-01-01T10:30:00Z"),
    ]
    rows = [client.get(f"/recorded-work/{i}").json() for i in result["recorded_work_ids"]]
    assert [r["scheduled_session_id"] for r in rows] == mapping["part_ids"]
    assert [r["duration_seconds"] for r in rows] == [600, 600]
    assert client.get(f"/operations/{operation_id}").json()["result"] == result
    assert commit(client, timer, approval, "split", operation_id=operation_id, **selection) == result


def test_record_as_scheduled_replaces_only_unsaved_result_with_exact_current_plan(client, clock):
    task, plan = task_plan(client, "2025-01-01T08:30:00Z", "2025-01-01T09:15:00Z")
    timer = linked_start(client, task, plan)
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    result = commit(client, timer, approval, "scheduled", **selection)
    assert len(result["recorded_work_ids"]) == 1
    work = client.get(f"/recorded-work/{result['recorded_work_ids'][0]}").json()
    assert (work["start_time"], work["end_time"]) == ("2025-01-01T08:30:00Z", "2025-01-01T09:15:00Z")
    assert work["duration_seconds"] == 2700
    assert result["replacement"]["unsaved_segments"][0]["start_time"] == "2025-01-01T10:00:00+00:00"
    assert result["replacement"]["unsaved_segments"][0]["end_time"] == "2025-01-01T10:10:00+00:00"
    current = client.get(f"/scheduled-sessions/{plan['id']}").json()
    assert (current["start_time"], current["end_time"]) == (plan["start_time"], plan["end_time"])


def rejected_commit(client, timer, approval, policy, **selection):
    response = client.post(
        f"/timers/{timer['id']}/stop-commit",
        json={
            "operation_id": str(uuid4()),
            "review_id": timer["stop_review"]["id"],
            "expected_revision": timer["revision"],
            "consent_token": approval["consent_token"],
            "policy": policy,
            **selection,
        },
    )
    assert response.status_code == 409, response.text
    return response.json()["code"]


def test_future_plan_never_becomes_recordable_by_waiting_in_review(client, clock):
    task, plan = task_plan(client)
    timer = linked_start(client, task, plan)
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    assert "time you pressed Stop" in " ".join(approval["blocked"]["scheduled"])
    clock.instant = datetime(2025, 1, 1, 12, tzinfo=UTC)
    assert preview(client, timer, **selection) == approval
    assert rejected_commit(client, timer, approval, "scheduled", **selection) == "stop_policy_blocked"
    assert client.get(f"/timers/{timer['id']}").json()["state"] == "paused"


def test_unlinked_overlapping_candidates_need_explicit_choice_and_actual_keeps_unlinked(client, clock):
    task, plan = task_plan(client)
    second = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2025-01-01T09:45:00Z", "end_time": "2025-01-01T10:45:00Z"},
    ).json()
    timer = post(client, "/timers", task_id=task["id"])["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    approval = preview(client, timer)
    assert {p["id"] for p in approval["candidates"]} == {plan["id"], second["id"]}
    assert approval["selected_plan_id"] is None
    assert rejected_commit(client, timer, approval, "fit") == "stop_policy_blocked"
    result = commit(client, timer, approval)
    row = client.get(f"/recorded-work/{result['recorded_work_ids'][0]}").json()
    assert row["scheduled_session_id"] is None
    assert select_plan(client, plan)["expected_plan_revision"] == 1


def test_saved_split_history_blocks_optional_actions_but_actual_saves_only_remaining(client, clock):
    task, plan = task_plan(client)
    timer = linked_start(client, task, plan)
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    saved = post(client, f"/timers/{timer['id']}/split")
    first_work = client.get(f"/recorded-work/{saved['recorded_work_ids'][0]}").json()
    clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    timer = prepare(client, saved["timer"])["timer"]
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    for policy in ("fit", "split", "scheduled"):
        assert rejected_commit(client, timer, approval, policy, **selection) == "stop_policy_blocked"
    result = commit(client, timer, approval, **selection)
    assert len(result["recorded_work_ids"]) == 1
    assert result["recorded_work_ids"][0] != first_work["id"]
    assert client.get(f"/recorded-work/{first_work['id']}").json() == first_work


def test_selected_plan_revision_and_timer_snapshot_changes_reject_before_effects(client, clock):
    task, plan = task_plan(client)
    timer = linked_start(client, task, plan)
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    changed = client.put(
        f"/scheduled-sessions/{plan['id']}",
        json={
            "start_time": "2025-01-01T09:30:00Z",
            "end_time": "2025-01-01T10:30:00Z",
            "expected_revision": selection["expected_plan_revision"],
        },
    )
    assert changed.status_code == 200, changed.text
    assert rejected_commit(client, timer, approval, "fit", **selection) == "revision_stale"
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == changed.json()
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    post(client, f"/timers/{timer['id']}/resume")
    assert rejected_commit(client, timer, approval, "actual", **selection) == "revision_stale"


def test_matching_work_created_after_preview_invalidates_consent_and_preserves_saved_row(client, clock):
    task, plan = task_plan(client)
    timer = linked_start(client, task, plan)
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    work = client.post(
        "/recorded-work",
        json={"task_id": task["id"], "start_time": "2025-01-01T10:02:00Z", "end_time": "2025-01-01T10:05:00Z"},
    ).json()
    assert rejected_commit(client, timer, approval, "fit", **selection) == "stop_preview_stale"
    latest = preview(client, timer, **selection)
    assert latest["blocked"]["fit"]
    assert client.get(f"/recorded-work/{work['id']}").json()["duration_seconds"] == 180


def test_frozen_unresolved_gap_refuses_preparation_without_changing_other_timer(client, db, clock):
    from timetrace.services import MultipleTimerService

    timer = post(client, "/timers")["timer"]
    other = post(client, "/timers", pause_when_idle=False)["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    MultipleTimerService(db).observe_activity(600)
    before = client.get(f"/timers/{timer['id']}").json()
    response = client.post(
        f"/timers/{timer['id']}/stop-review",
        json={"operation_id": str(uuid4()), "expected_revision": before["revision"]},
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "idle_gap_unresolved"
    assert client.get(f"/timers/{timer['id']}").json() == before
    assert client.get(f"/timers/{other['id']}").json()["state"] == "running"


def test_internal_review_actions_cannot_bypass_strict_http_schema(client):
    timer = post(client, "/timers")["timer"]
    for action in ("stop_review", "stop_commit"):
        response = client.post(f"/timers/{timer['id']}/{action}", json={"operation_id": str(uuid4())})
        assert response.status_code in (400, 422), response.text
    assert client.get(f"/timers/{timer['id']}").json()["state"] == "running"


@pytest.mark.parametrize("failure", ["before_db", "after_db"])
@pytest.mark.parametrize("policy", ["split", "scheduled"])
def test_composite_fault_recovers_same_result_by_daemon_barrier_and_get_only(
    client, db, clock, monkeypatch, failure, policy
):
    import os

    from sqlalchemy.exc import OperationalError

    from timetrace.services import MultipleTimerService

    end = "2025-01-01T09:45:00Z" if policy == "scheduled" else "2025-01-01T11:00:00Z"
    task, plan = task_plan(client, end=end)
    timer = linked_start(client, task, plan)
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    post(client, f"/timers/{timer['id']}/pause")
    clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    timer = post(client, f"/timers/{timer['id']}/resume")["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    operation_id = str(uuid4())
    payload = {
        "operation_id": operation_id,
        "review_id": timer["stop_review"]["id"],
        "expected_revision": timer["revision"],
        "consent_token": approval["consent_token"],
        "policy": policy,
        **selection,
    }
    original_replace, original_commit = os.replace, db.commit
    calls = 0

    def fail_replace(source, destination):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("synthetic failure after work and receipt commit")
        return original_replace(source, destination)

    def fail_commit():
        raise OperationalError("synthetic receipt commit", {}, Exception("disk unavailable"))

    if failure == "before_db":
        monkeypatch.setattr(db, "commit", fail_commit)
    else:
        monkeypatch.setattr(os, "replace", fail_replace)
    failed = client.post(f"/timers/{timer['id']}/stop-commit", json=payload)
    assert failed.status_code == 409, failed.text
    assert failed.json()["code"] == "reconciliation_required"
    pending = client.get(f"/operations/{operation_id}").json()
    assert pending["status"] == "pending_reconciliation"
    assert pending["result"] is None
    if failure == "before_db":
        assert client.get(f"/scheduled-sessions/{plan['id']}").json()["start_time"] == plan["start_time"]
        conflicting = client.post(
            "/recorded-work",
            json={"task_id": task["id"], "start_time": "2025-01-01T10:01:00Z", "end_time": "2025-01-01T10:05:00Z"},
        )
        assert conflicting.status_code == 409, conflicting.text
        assert conflicting.json()["code"] == "correction_pending"
        task_change = client.put(f"/api/tasks/{task['id']}", json={"title": "Unsafe intervening edit"})
        assert task_change.status_code == 409, task_change.text
        assert task_change.json()["code"] == "correction_pending"
    monkeypatch.setattr(os, "replace", original_replace)
    monkeypatch.setattr(db, "commit", original_commit)
    MultipleTimerService(db).reconcile()  # The same public daemon startup barrier, never a repeated POST.
    recovered = client.get(f"/operations/{operation_id}").json()
    assert recovered["status"] == "finalized"
    result = recovered["result"]
    if policy == "split":
        assert len(result["recorded_work_ids"]) == 2
        assert len(result["schedule"]["part_ids"]) == 2
        assert result["schedule"]["parts"] == [
            client.get(f"/scheduled-sessions/{i}").json() for i in result["schedule"]["part_ids"]
        ]
        assert [client.get(f"/recorded-work/{i}").json()["duration_seconds"] for i in result["recorded_work_ids"]] == [
            600,
            600,
        ]
    else:
        assert len(result["recorded_work_ids"]) == 1
        work = client.get(f"/recorded-work/{result['recorded_work_ids'][0]}").json()
        assert work["start_time"] == "2025-01-01T09:00:00Z"
        assert work["end_time"] == "2025-01-01T09:45:00Z"
        assert result["replacement"]["plan"] == client.get(f"/scheduled-sessions/{plan['id']}").json()
    assert client.get(f"/operations/{operation_id}").json() == recovered
    assert client.get("/timers").json()["timers"] == []


def test_other_unfinished_timer_plan_context_blocks_composite_but_not_actual(client, clock, tmp_path):
    import json

    task, plan = task_plan(client)
    timer = linked_start(client, task, plan)
    other = post(client, "/timers")["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    # Simulate a retained/imported context at the filesystem boundary; never personal state.
    path = tmp_path / "active_timer.json"
    state = json.loads(path.read_text())
    state["timers"][other["id"]]["scheduled_session_id"] = plan["id"]
    path.write_text(json.dumps(state))
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    assert any("Another unfinished timer" in s for s in approval["blocked"]["fit"])
    assert rejected_commit(client, timer, approval, "fit", **selection) == "stop_policy_blocked"
    commit(client, timer, approval, **selection)
    assert client.get(f"/timers/{other['id']}").json()["state"] == "running"


def test_review_note_ack_preserves_original_cutoff_and_continue_eligibility(client, clock):
    timer = post(client, "/timers")["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 50, tzinfo=UTC)
    timer = post(
        client,
        f"/timers/{timer['id']}/note",
        expected_revision=timer["revision"],
        expected_note_segment_id=timer["manual_pause_note_segment_id"],
        new_notes="Reviewed note",
    )["timer"]
    assert timer["stop_review"]["cutoff"] == "2025-01-01T10:10:00+00:00"
    approval = preview(client, timer)
    assert approval["blocked"]["continue"] == []
    assert approval["unsaved_segments"][0]["notes"] == "Reviewed note"
    continued = commit(client, timer, approval, "continue")["timer"]
    assert continued["running_start"] == "2025-01-01T10:50:00+00:00"


def test_review_preparation_lost_ack_is_exact_idempotent_and_get_recovers_cutoff(client, clock):
    timer = post(client, "/timers")["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    operation_id = str(uuid4())
    payload = {"operation_id": operation_id, "expected_revision": timer["revision"]}
    result = post(client, f"/timers/{timer['id']}/stop-review", **payload)
    clock.instant = datetime(2025, 1, 1, 11, tzinfo=UTC)
    assert client.get(f"/operations/{operation_id}").json()["result"] == result
    assert post(client, f"/timers/{timer['id']}/stop-review", **payload) == result
    duplicate = client.post(
        f"/timers/{timer['id']}/stop-review",
        json={"operation_id": str(uuid4()), "expected_revision": result["timer"]["revision"]},
    )
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.json()["code"] == "stop_review_active"
    assert client.get(f"/timers/{timer['id']}").json()["stop_review"] == result["timer"]["stop_review"]


def test_split_retains_selected_recurrence_override_and_leaves_next_occurrence_unchanged(client, clock, monkeypatch):
    import timetrace.services.recurrence_service as recurrence
    import timetrace.services.session_service as sessions

    monkeypatch.setattr(recurrence, "datetime", clock)
    monkeypatch.setattr(sessions, "datetime", clock)
    clock.instant = datetime(2025, 1, 1, 9, 55, tzinfo=UTC)
    task = client.post(
        "/api/tasks",
        json={
            "title": "Recurring Stop",
            "is_recurring": True,
            "recurrence_rrule": "FREQ=DAILY",
            "recurrence_dtstart": "2025-01-01T10:00:00Z",
            "recurrence_duration_minutes": 60,
            "recurrence_timezone": "UTC",
        },
    ).json()
    agenda = client.get("/agenda", params={"start": "2025-01-01T00:00:00Z", "end": "2025-01-03T00:00:00Z"}).json()
    projection, next_plan = agenda["items"]
    assert projection["is_virtual"] is True
    timer = post(
        client,
        "/timers",
        task_id=task["id"],
        scheduled_session_id=projection["id"],
        expected_projection_revision=projection["projection_revision"],
    )["timer"]
    source_id = timer["scheduled_session_id"]
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    post(client, f"/timers/{timer['id']}/pause")
    clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    timer = post(client, f"/timers/{timer['id']}/resume")["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    selection = select_plan(client, {"id": source_id})
    result = commit(client, timer, preview(client, timer, **selection), "split", **selection)
    source = result["schedule"]["parts"][0]
    assert source["id"] == source_id
    assert source["original_start"] == "2025-01-01T10:00:00Z"
    assert source["original_end"] == "2025-01-01T11:00:00Z"
    assert source["series_task_id"] == task["id"]
    assert source["occurrence_start"] == "2025-01-01T10:00:00Z"
    assert "series_task_id" not in result["schedule"]["parts"][1]
    assert client.get(f"/scheduled-sessions/{next_plan['id']}").json() == next_plan
    resolved = client.get(f"/agenda/occurrences/{projection['id']}").json()
    assert resolved["id"] == source_id
    assert client.get(f"/api/tasks/{task['id']}").json()["recurrence_rrule"] == "FREQ=DAILY"


@pytest.mark.parametrize("different_notes", [False, True])
def test_scheduled_replacement_preserves_consistent_entry_metadata_or_refuses_mixed_notes(
    client, clock, different_notes
):
    task, plan = task_plan(client, end="2025-01-01T09:45:00Z")
    timer = post(
        client,
        "/timers",
        task_id=task["id"],
        scheduled_session_id=plan["id"],
        expected_plan_revision=plan["revision"],
        tags="writing",
        notes="First entry",
    )["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    post(client, f"/timers/{timer['id']}/pause")
    clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    timer = post(client, f"/timers/{timer['id']}/resume")["timer"]
    if different_notes:
        timer = post(
            client, f"/timers/{timer['id']}/note", expected_revision=timer["revision"], new_notes="Second entry"
        )["timer"]
    clock.instant = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    if different_notes:
        assert any("metadata" in reason.lower() for reason in approval["blocked"]["scheduled"])
        assert rejected_commit(client, timer, approval, "scheduled", **selection) == "stop_policy_blocked"
        result = commit(client, timer, approval, "split", **selection)
        rows = [client.get(f"/recorded-work/{i}").json() for i in result["recorded_work_ids"]]
        assert [(r["tags"], r["notes"]) for r in rows] == [("writing", "First entry"), ("writing", "Second entry")]
    else:
        assert approval["blocked"]["scheduled"] == []
        result = commit(client, timer, approval, "scheduled", **selection)
        work = client.get(f"/recorded-work/{result['recorded_work_ids'][0]}").json()
        assert (work["tags"], work["notes"]) == ("writing", "First entry")


def test_paused_before_review_uses_stop_click_cutoff_without_crediting_decision_time(client, clock):
    task, plan = task_plan(client, end="2025-01-01T10:15:00Z")
    timer = linked_start(client, task, plan)
    clock.instant = datetime(2025, 1, 1, 10, 10, tzinfo=UTC)
    timer = post(client, f"/timers/{timer['id']}/pause")["timer"]
    original_segments = timer["segments"]
    clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    timer = prepare(client, timer)["timer"]
    assert timer["segments"] == original_segments
    assert timer["stop_review"]["cutoff"] == "2025-01-01T10:20:00+00:00"
    assert timer["stop_review"]["was_running"] is False
    selection = select_plan(client, plan)
    approval = preview(client, timer, **selection)
    assert approval["blocked"]["continue"]
    assert approval["blocked"]["scheduled"] == []
    clock.instant = datetime(2025, 1, 1, 11, tzinfo=UTC)
    assert preview(client, timer, **selection) == approval
    result = commit(client, timer, approval, "scheduled", **selection)
    work = client.get(f"/recorded-work/{result['recorded_work_ids'][0]}").json()
    assert work["start_time"] == "2025-01-01T09:00:00Z"
    assert work["end_time"] == "2025-01-01T10:15:00Z"
    assert work["duration_seconds"] == 4500
