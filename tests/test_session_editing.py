"""Public HTTP preservation checks for the adopted Session editing workflow."""

from datetime import UTC, datetime, timedelta

import pytest


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
    response = client.put(
        f"/sessions/{first['id']}?scope=all_future",
        json={
            "start_time": first["start_time"],
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
