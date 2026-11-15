"""Grouped Tasks composes existing HTTP contracts; no view-specific domain API."""

from datetime import UTC, datetime, timedelta


def test_grouped_tasks_page_composes_shared_editors_and_dispatches_search(client):
    response = client.get("/tasks")
    assert response.status_code == 200
    html = response.text
    assert 'value="grouped"' in html
    assert 'oninput="renderCurrentTaskView()"' in html
    for marker in ['id="tasks_heading"', 'id="session_modal"', 'id="task_modal"', 'id="idle_resolution_modal"']:
        assert html.count(marker) == 1
    for script in ["kanban.js", "grouped_tasks.js", "session_modal.js", "task_modal.js", "timer_control.js"]:
        assert html.count(f"/static/js/{script}") == 1
    assert "/static/css/grouped_tasks.css" in html
    assert "/static/js/calendar.js" not in html
    assert html.count("/static/js/subtasks.js") == 1
    assert html.count('id="task_properties_editor"') == 1


def test_grouped_tasks_shared_create_child_schedule_completion_and_delete_contracts(client):
    parent = client.post("/api/tasks", json={"title": "Grouped parent #effective [45m]", "category": "study"}).json()
    assert parent["estimated_minutes"] == 45
    child_response = client.post("/api/tasks", json={"title": "Grouped child", "parent_id": parent["id"]})
    assert child_response.status_code == 201
    child = child_response.json()
    assert "#effective" in child["tags"]
    start = datetime.now(UTC) + timedelta(days=4)
    session_response = client.post(
        "/sessions",
        json={
            "task_id": parent["id"],
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(minutes=30)).isoformat(),
            "notes": "Explicit session save",
        },
    )
    assert session_response.status_code == 201
    session_id = session_response.json()["id"]
    completed = client.put(f"/api/tasks/{parent['id']}", json={"status": "done"})
    assert completed.status_code == 200
    assert completed.json()["completion_policy"]
    # Returning a prompt does not clear the scheduled row; Keep needs no extra write.
    assert client.get(f"/sessions/{session_id}").status_code == 200
    rows = client.get("/api/tasks?status=all&sort=smart_gap_filler").json()
    assert {parent["id"], child["id"]} <= {row["id"] for row in rows}
    assert client.delete(f"/api/tasks/{child['id']}").status_code == 204
    assert client.get(f"/api/tasks/{child['id']}").status_code == 404
    assert client.get(f"/sessions/{session_id}").status_code == 200
