"""Saved-parent inheritance and completion contracts used by quick edit."""

from datetime import UTC, datetime, timedelta

import pytest


@pytest.mark.parametrize("category", ["study", ""])
def test_queued_child_uses_saved_parent_effective_tags_category_and_status(client, category):
    parent = client.post(
        "/api/tasks",
        json={"title": "Synthetic parent #effective !high [45m]", "tags": "#obsolete", "category": category},
    ).json()
    child = client.post(
        "/api/tasks",
        json={
            "title": "Synthetic child",
            "parent_id": parent["id"],
            "tags": parent["tags"],
            "category": parent["category"],
        },
    ).json()
    rows = client.get("/api/tasks?status=all").json()
    parent_read = next(t for t in rows if t["id"] == parent["id"])
    child_read = next(t for t in rows if t["id"] == child["id"])
    assert parent_read["title"] == "Synthetic parent"
    assert parent_read["estimated_minutes"] == 45
    assert parent_read["priority"] == "high"
    assert (child_read["parent_id"], child_read["tags"], child_read["category"]) == (
        parent["id"],
        "#effective",
        category,
    )
    statuses = client.get("/api/tasks/statuses").json()
    updated = client.put(f"/api/tasks/{parent['id']}", json={"status": "Ongoing"}).json()
    assert updated["status_id"] == next(s["id"] for s in statuses if s["name"] == "Ongoing")


@pytest.mark.parametrize("next_status,reason", [("Done", "completed"), ("To Do", "left_scheduled")])
def test_quick_edit_completion_keeps_sessions_until_explicit_independent_clear(client, next_status, reason):
    parent = client.post("/api/tasks", json={"title": "Synthetic parent", "status": "Scheduled"}).json()
    child = client.post("/api/tasks", json={"title": "Synthetic child", "parent_id": parent["id"]}).json()
    now = datetime.now(UTC)

    def session(task_id, day):
        start = now + timedelta(days=day)
        response = client.post(
            "/sessions",
            json={
                "task_id": task_id,
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
            },
        )
        assert response.status_code == 201
        return response.json()["id"]

    own_one, own_two = session(parent["id"], 2), session(parent["id"], 3)
    subtree, logged = session(child["id"], 4), session(child["id"], -2)
    updated = client.put(f"/api/tasks/{parent['id']}", json={"status": next_status}).json()
    policy = updated["completion_policy"]
    assert policy["reason"] == reason
    assert {s["id"] for s in policy["scheduled_sessions"]} == {own_one, own_two}
    assert policy["subtask_scheduled_count"] == 1
    assert all(client.get(f"/sessions/{sid}").status_code == 200 for sid in [own_one, own_two, subtree, logged])
    # An empty own-selection must not disable subtree clearing.
    cleared = client.post(
        f"/api/tasks/{parent['id']}/clear-scheduled-sessions", json={"session_ids": [], "include_subtasks": True}
    ).json()
    assert cleared["deleted_session_ids"] == [subtree]
    assert client.get(f"/sessions/{logged}").status_code == 200
    # Explicit own subset, independently of subtree selection.
    cleared = client.post(
        f"/api/tasks/{parent['id']}/clear-scheduled-sessions",
        json={"session_ids": [own_one], "include_subtasks": False},
    ).json()
    assert cleared["deleted_session_ids"] == [own_one]
    assert client.get(f"/sessions/{own_two}").status_code == 200
