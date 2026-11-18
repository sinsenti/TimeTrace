"""Public HTTP preservation checks for the adopted Session editing workflow."""

from datetime import UTC, datetime, timedelta

import pytest


def test_explicit_future_and_past_plans_reload_without_creating_session_rows(client):
    task_id = client.post("/api/tasks", json={"title": "Writing"}).json()["id"]
    for date in ("2099-01-04", "2000-01-04"):
        response = client.post(
            "/scheduled-sessions",
            json={
                "task_id": task_id,
                "start_time": f"{date}T09:00:00-05:00",
                "end_time": f"{date}T10:15:00-05:00",
                "notes": "Writing block",
            },
        )
        assert response.status_code == 201, response.text
        saved = response.json()
        reloaded = client.get(f"/scheduled-sessions/{saved['id']}")
        assert reloaded.status_code == 200, reloaded.text
        assert reloaded.json() == {
            "id": saved["id"],
            "kind": "scheduled_session",
            "is_virtual": False,
            "task_id": task_id,
            "start_time": f"{date}T14:00:00Z",
            "end_time": f"{date}T15:15:00Z",
            "original_start": f"{date}T14:00:00Z",
            "original_end": f"{date}T15:15:00Z",
            "duration_seconds": 4500,
            "revision": 1,
            "notes": "Writing block",
            "tags": "",
        }
    assert client.get("/sessions").json() == []


def test_editing_current_schedule_preserves_originals_and_rejects_old_revision(client):
    payload = {"start_time": "2000-01-04T14:00:00Z", "end_time": "2000-01-04T15:15:00Z"}
    plan = client.post("/scheduled-sessions", json=payload).json()
    url = f"/scheduled-sessions/{plan['id']}"
    edit = {"start_time": "2000-01-05T16:00:00Z", "end_time": "2000-01-05T16:30:00Z", "expected_revision": 1}
    response = client.put(url, json=edit)
    assert response.status_code == 200, response.text
    assert client.get(url).json() == {
        **plan,
        "start_time": "2000-01-05T16:00:00Z",
        "end_time": "2000-01-05T16:30:00Z",
        "duration_seconds": 1800,
        "revision": 2,
    }
    stale = client.put(url, json={**payload, "expected_revision": 1})
    assert stale.status_code == 409, stale.text
    assert (
        client.put(url, json={**edit, "expected_revision": 2, "original_start": edit["start_time"]}).status_code == 422
    )
    assert client.get(url).json() == response.json()
    assert client.get("/sessions").json() == []


def test_agenda_distinguishes_overlapping_past_plan_from_legacy_history(client):
    task_id = client.post("/api/tasks", json={"title": "Writing"}).json()["id"]
    legacy = post_session(client, task_id, "2000-01-04T14:00:00Z", "2000-01-04T15:00:00Z", notes="Historical")
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task_id, "start_time": "2000-01-04T14:15:00Z", "end_time": "2000-01-04T16:00:00Z"},
    ).json()
    response = client.get("/agenda", params={"start": "2000-01-04T14:30:00Z", "end": "2000-01-04T16:00:00Z"})
    assert response.status_code == 200, response.text
    assert response.json()["basis"] == "current"
    assert [(s["kind"], s["id"]) for s in response.json()["items"]] == [
        ("legacy_uncertain", legacy["id"]),
        ("scheduled_session", plan["id"]),
    ]
    assert client.get(f"/sessions/{legacy['id']}").json()["notes"] == "Historical"
    assert [s["id"] for s in client.get("/sessions").json()] == [legacy["id"]]


def test_plan_accounting_counts_only_future_schedule_and_task_deletion_detaches_plan(client):
    task_id = client.post("/api/tasks", json={"title": "Writing", "estimated_minutes": 120}).json()["id"]
    plans = [
        client.post(
            "/scheduled-sessions",
            json={"task_id": task_id, "start_time": f"{date}T14:00:00Z", "end_time": f"{date}T15:30:00Z"},
        ).json()
        for date in ("2000-01-04", "2099-01-04")
    ]
    accounting = client.get(f"/api/tasks/{task_id}/stats").json()
    assert [accounting[key] for key in ("logged_hours", "scheduled_hours", "unscheduled_hours")] == [0, 1.5, 0.5]
    assert client.delete(f"/api/tasks/{task_id}").status_code == 204
    for plan in plans:
        assert client.get(f"/scheduled-sessions/{plan['id']}").json() == {**plan, "task_id": None, "revision": 2}


def test_legacy_session_read_modify_write_preserves_the_old_row_shape(client):
    task = client.post("/api/tasks", json={"title": "Review notes"}).json()
    start, end = "2000-01-04T14:00:00Z", "2000-01-04T15:15:00Z"
    created = post_session(client, task["id"], start, end, notes="Original", tags="#writing", review_skipped=True)
    url = f"/sessions/{created['id']}"
    read = client.get(url).json()
    update = client.put(url, json={**read, "notes": "Edited"})
    assert update.status_code == 200, update.text

    base = {
        "id": created["id"],
        "task_id": task["id"],
        "start_time": start,
        "end_time": end,
        "duration_seconds": 4500,
        "tags": "#writing",
        "notes": "Original",
        "review_skipped": True,
        "timezone": "UTC",
        "external_sync_id": None,
        "external_provider": None,
        "extended_properties_json": "{}",
    }
    assert created == base
    assert update.json() == {**base, "notes": "Edited"}
    result = client.get(url).json()
    assert result.pop("task")["id"] == task["id"]
    expected = {
        **base,
        "notes": "Edited",
        "start_time": "2000-01-04T14:00:00+00:00",
        "end_time": "2000-01-04T15:15:00+00:00",
    }
    assert result == expected
    window = {"start": "2000-01-04T00:00:00Z", "end": "2000-01-05T00:00:00Z"}
    for params in ({}, window):
        assert client.get("/sessions", params=params).json() == [{**expected, "is_virtual": False}]
    typed = client.get("/agenda", params=window).json()["items"][0]
    assert typed == {**base, "notes": "Edited", "kind": "legacy_uncertain", "is_virtual": False, "revision": 1}

    retro = client.post("/sessions/retro", json={"start_time": start, "end_time": end})
    assert retro.status_code == 201, retro.text
    assert set(retro.json()) == base.keys()


def test_legacy_routes_refuse_typed_writes_without_silently_creating_history(client):
    payload = {"start_time": "2000-01-04T14:00:00Z", "end_time": "2000-01-04T15:15:00Z"}
    saved = client.post("/scheduled-sessions", json=payload).json()
    plan_id = saved["id"]
    assert client.post("/sessions", json={**payload, "kind": "scheduled_session"}).status_code == 422
    assert client.post("/sessions/retro", json={**payload, "scheduled_session_id": plan_id}).status_code == 422
    assert client.post("/timer/start", json={"scheduled_session_id": plan_id}).status_code == 422
    assert client.get(f"/sessions/{plan_id}").status_code == 404
    assert client.delete(f"/sessions/{plan_id}").json()["code"] == "plan_delete_unsupported"
    assert client.put(f"/sessions/{plan_id}", json=payload).json()["code"] == "typed_session_unsupported"
    assert client.get(f"/scheduled-sessions/{plan_id}").json() == saved
    assert client.get("/sessions").json() == []


def test_scheduled_sessions_are_not_performed_evidence_or_rating_targets(client):
    saved = client.post(
        "/scheduled-sessions",
        json={"start_time": "2000-01-04T14:00:00Z", "end_time": "2000-01-04T15:00:00Z"},
    ).json()
    definition = client.post("/rating-definitions", json={"name": "Focus", "target_type": "session"}).json()
    response = client.post(
        "/rating-entries",
        json={"target_type": "session", "target_id": saved["id"], "rating_definition_id": definition["id"], "score": 5},
    )
    assert response.status_code == 409, response.text
    assert client.get("/rating-entries", params={"target_type": "session", "target_id": saved["id"]}).json() == []
    result = client.post("/analytics/query", json={"query": {"source": "sessions", "measure": "session_count"}})
    assert result.status_code == 200, result.text
    assert result.json()["total"] == 0


def test_legacy_completion_clear_refuses_typed_subtree_scope_before_deleting_anything(client):
    client.post("/api/tasks/statuses", json={"name": "Done", "is_completed": True})
    parent_id = client.post("/api/tasks", json={"title": "Parent"}).json()["id"]
    child_id = client.post("/api/tasks", json={"title": "Child", "parent_id": parent_id}).json()["id"]
    start, end = "2099-01-04T14:00:00Z", "2099-01-04T15:00:00Z"
    legacy = post_session(client, parent_id, start, end)
    plan = client.post("/scheduled-sessions", json={"task_id": child_id, "start_time": start, "end_time": end}).json()
    completion = client.put(f"/api/tasks/{parent_id}", json={"status": "Done"}).json()["completion_policy"]
    assert completion["subtask_scheduled_count"] == 1
    response = client.post(
        f"/api/tasks/{parent_id}/clear-scheduled-sessions",
        json={"session_ids": [legacy["id"]], "include_subtasks": True},
    )
    assert response.status_code == 409, response.text
    assert client.get(f"/sessions/{legacy['id']}").status_code == 200
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan
    selected_only = client.post(
        f"/api/tasks/{parent_id}/clear-scheduled-sessions", json={"session_ids": [legacy["id"]]}
    )
    assert selected_only.status_code == 200, selected_only.text
    assert client.get(f"/sessions/{legacy['id']}").status_code == 404
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan


def post_session(client, task_id, start, end, **fields):
    response = client.post(
        "/sessions",
        json={"task_id": task_id, "start_time": start, "end_time": end, **fields},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize("reason", ["completed", "left_scheduled"])
@pytest.mark.parametrize("choice", ["keep", "selected_own", "subtree_only"])
def test_completion_session_selection_and_subtree_clear_remain_independent(client, reason, choice):
    for name, completed, scheduled in [("Todo", False, False), ("Scheduled", False, True), ("Done", True, False)]:
        response = client.post(
            "/api/tasks/statuses",
            json={"name": name, "is_completed": completed, "is_scheduled_trigger": scheduled},
        )
        assert response.status_code == 201
    parent = client.post("/api/tasks", json={"title": "Parent", "status": "Scheduled"}).json()
    child = client.post("/api/tasks", json={"title": "Child", "parent_id": parent["id"]}).json()
    future = datetime.now(UTC).replace(microsecond=0) + timedelta(days=5)
    own = [
        post_session(client, parent["id"], future.isoformat(), (future + timedelta(hours=1)).isoformat())
        for _ in range(2)
    ]
    descendant = post_session(client, child["id"], future.isoformat(), (future + timedelta(hours=1)).isoformat())
    logged = post_session(client, parent["id"], "2000-01-01T23:45:00Z", "2000-01-02T00:30:00Z", notes="Logged\nhistory")
    response = client.put(f"/api/tasks/{parent['id']}", json={"status": "Done" if reason == "completed" else "Todo"})
    assert response.status_code == 200, response.text
    policy = response.json()["completion_policy"]
    assert policy["reason"] == reason
    assert {s["id"] for s in policy["scheduled_sessions"]} == {s["id"] for s in own}
    assert policy["subtask_scheduled_count"] == 1
    if choice != "keep":
        response = client.post(
            f"/api/tasks/{parent['id']}/clear-scheduled-sessions",
            json={
                "session_ids": [own[0]["id"]] if choice == "selected_own" else [],
                "include_subtasks": choice == "subtree_only",
            },
        )
        assert response.status_code == 200, response.text
    remaining = {s["id"] for s in client.get("/sessions").json()}
    assert (own[0]["id"] in remaining) == (choice != "selected_own")
    assert own[1]["id"] in remaining
    assert (descendant["id"] in remaining) == (choice != "subtree_only")
    assert client.get(f"/sessions/{logged['id']}").json()["notes"] == "Logged\nhistory"


@pytest.mark.parametrize("delete_scope", ["following", "all"])
def test_session_materialization_resize_move_skip_and_series_delete_preserve_history_and_estimate(client, delete_scope):
    start = (datetime.now(UTC) + timedelta(days=7)).replace(hour=23, minute=45, second=0, microsecond=0)
    task = client.post(
        "/api/tasks",
        json={
            "title": "Recurring",
            "is_recurring": True,
            "recurrence_rule": "daily",
            "estimated_minutes": 123,
            "recurrence_dtstart": start.isoformat(),
            "recurrence_duration_minutes": 45,
            "recurrence_timezone": "UTC",
        },
    ).json()
    task_id = task["id"]
    history = post_session(client, task_id, "2000-01-01T23:45:00Z", "2000-01-02T00:30:00Z", notes="Past work")
    params = {"start": start.isoformat(), "end": (start + timedelta(days=5)).isoformat()}
    occurrences = client.get("/sessions", params=params).json()
    assert len(occurrences) == 5 and all(s["id"].startswith("virt:") for s in occurrences)
    first = occurrences[0]
    assert first["is_virtual"] is True
    assert first["series_task_id"] == task_id and first["occurrence_start"] == first["start_time"]
    response = client.put(
        f"/sessions/{first['id']}?scope=all_future",
        json={
            **first,
            "end_time": (start + timedelta(minutes=60)).isoformat(),
            "notes": "Edited\noccurrence",
        },
    )
    assert response.status_code == 200, response.text
    materialized = response.json()
    assert materialized["id"] != first["id"] and not materialized["id"].startswith("virt:")
    assert client.get(f"/api/tasks/{task_id}").json()["estimated_minutes"] == 123
    move = client.put(
        f"/sessions/{materialized['id']}",
        json={
            "start_time": (start + timedelta(hours=2)).isoformat(),
            "end_time": (start + timedelta(hours=3)).isoformat(),
        },
    )
    assert move.status_code == 200
    skip_id = occurrences[1]["id"]
    assert client.delete(f"/sessions/{skip_id}?scope=only_this").status_code == 204
    assert client.put(f"/api/tasks/{task_id}", json={"description": "Unrelated task edit"}).status_code == 200
    refreshed = client.get("/sessions", params=params).json()
    assert first["id"] not in {s["id"] for s in refreshed}
    assert skip_id not in {s["id"] for s in refreshed}
    assert client.get(f"/sessions/{materialized['id']}").json()["notes"] == "Edited\noccurrence"
    assert client.get(f"/api/tasks/{task_id}").json()["recurrence_duration_minutes"] == 60
    assert client.delete(f"/sessions/{occurrences[2]['id']}?scope={delete_scope}").status_code == 204
    assert client.get(f"/sessions/{history['id']}").json()["notes"] == "Past work"
    assert client.get(f"/api/tasks/{task_id}").json()["estimated_minutes"] == 123
