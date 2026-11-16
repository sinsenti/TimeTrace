"""Characterize the existing status API policy; ticket08 changes presentation only."""

import uuid
from html.parser import HTMLParser

import pytest
from sqlalchemy.exc import IntegrityError


def test_status_api_preserves_literal_name_raw_color_flags_and_separate_order_writes(client):
    defaults = client.get("/api/tasks/statuses").json()
    assert [row["name"] for row in defaults] == ["To Do", "Ongoing", "Scheduled", "Done", "Backlog"]
    response = client.post(
        "/api/tasks/statuses",
        json={
            "name": "  <img src=x onerror='bad()'> literal  ",
            "color": "rebeccapurple",
            "position": 20,
            "is_hide_by_default": True,
            "is_completed": True,
            "is_scheduled_trigger": True,
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert uuid.UUID(created["id"]).version == 7
    assert created["name"] == "  <img src=x onerror='bad()'> literal  "
    assert created["color"] == "rebeccapurple"
    assert all(created[key] for key in ["is_hide_by_default", "is_completed", "is_scheduled_trigger"])
    reordered = [created, *defaults]
    for position, row in enumerate(reordered):
        assert client.put(f"/api/tasks/statuses/{row['id']}", json={"position": position}).status_code == 200
    rows = client.get("/api/tasks/statuses").json()
    assert [row["id"] for row in rows] == [row["id"] for row in reordered]
    assert rows[0]["color"] == "rebeccapurple"
    assert client.delete(f"/api/tasks/statuses/{created['id']}").status_code == 204
    assert created["id"] not in {row["id"] for row in client.get("/api/tasks/statuses").json()}


def test_status_rename_and_in_use_delete_keep_existing_loose_task_sync(client):
    statuses = client.get("/api/tasks/statuses").json()
    todo = statuses[0]
    default_task = client.post("/api/tasks", json={"title": "Synthetic default task"}).json()
    assert (default_task["status"], default_task["status_id"]) == ("To Do", None)
    task = client.post("/api/tasks", json={"title": "Synthetic linked task", "status": "To Do"}).json()
    assert task["status_id"] == todo["id"]
    renamed = client.put(f"/api/tasks/statuses/{todo['id']}", json={"name": "New To Do"}).json()
    assert renamed["name"] == "New To Do"
    read = client.get(f"/api/tasks/{task['id']}").json()
    assert (read["status"], read["status_id"]) == ("To Do", todo["id"])
    # No seed/in-use protection exists: SQLAlchemy clears the optional FK, not stored status text.
    assert client.delete(f"/api/tasks/statuses/{todo['id']}").status_code == 204
    read = client.get(f"/api/tasks/{task['id']}").json()
    assert (read["status"], read["status_id"]) == ("To Do", None)
    ongoing = next(row for row in statuses if row["name"] == "Ongoing")
    updated = client.put(f"/api/tasks/{task['id']}", json={"status_id": ongoing["id"]}).json()
    assert (updated["status"], updated["status_id"]) == ("Ongoing", ongoing["id"])
    updated = client.put(f"/api/tasks/{task['id']}", json={"status": "Backlog"}).json()
    assert updated["status_id"] == next(row["id"] for row in statuses if row["name"] == "Backlog")


@pytest.mark.parametrize("method", ["put", "delete"])
def test_missing_status_is_not_found_without_replacing_initial_statuses(client, method):
    initial = client.get("/api/tasks/statuses").json()
    url = f"/api/tasks/statuses/{uuid.uuid4()}"
    response = client.put(url, json={"name": "Missing"}) if method == "put" else client.delete(url)
    assert response.status_code == 404
    assert client.get("/api/tasks/statuses").json() == initial


def test_duplicate_status_name_is_existing_database_constraint_not_a_new_ui_policy(client, db):
    initial = client.get("/api/tasks/statuses").json()
    with pytest.raises(IntegrityError):
        client.post("/api/tasks/statuses", json={"name": "To Do"})
    db.rollback()
    assert client.get("/api/tasks/statuses").json() == initial


class _TaskPageControls(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.styles = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "id" in values:
            self.ids.append(values["id"])
        if tag == "link" and values.get("rel") == "stylesheet":
            self.styles.append(values.get("href"))


def test_tasks_page_composes_status_controls_once_with_existing_view_selector(client):
    response = client.get("/tasks")
    assert response.status_code == 200
    page = _TaskPageControls()
    page.feed(response.text)
    for control in (
        "status_manager_entry",
        "status_board_feedback",
        "status_board_order_retry",
        "status_manager_modal",
        "status_manager_list",
        "status_manager_feedback",
        "status_order_retry",
        "add_status_modal",
        "status_add_retry",
        "status_add_save",
        "task_view_selector",
        "tasks_search",
        "tasks_workspace",
    ):
        assert page.ids.count(control) == 1, control
    assert page.styles.count("/static/css/status_management.css") == 1
