"""Outline and dedicated details share exactly one mounted editor per document."""

import re


def test_outline_tasks_page_composes_one_shared_detail_editor(client):
    response = client.get("/tasks")
    assert response.status_code == 200
    html = response.text
    for marker in [
        "outline_inspector",
        "outline_inspector_panel",
        "inspector_task_id",
        "task_properties_editor",
        "subtask_modal",
        "task_modal",
        "session_modal",
        "detail_task_sessions_list",
    ]:
        assert html.count(f'id="{marker}"') == 1
    for script in ["subtasks.js", "outline_tasks.js", "grouped_tasks.js", "task_modal.js", "session_modal.js"]:
        assert html.count(f"/static/js/{script}") == 1
    assert 'id="outline_inspector" hidden inert' in html
    assert 'data-settings-draft-retained="true"' in html
    ids = re.findall(r'\bid="([^"]+)"', html)
    assert len(ids) == len(set(ids))


def test_dedicated_details_retains_shared_panel_route(client):
    task = client.post("/api/tasks", json={"title": "Dedicated inspector"}).json()
    response = client.get(f"/task-inspector/{task['id']}")
    assert response.status_code == 200
    html = response.text
    assert f'id="inspector_task_id" value="{task["id"]}"' in html
    assert html.count('id="task_properties_editor"') == 1
    assert html.count('id="subtask_modal"') == 1
    assert 'id="outline_inspector"' not in html
