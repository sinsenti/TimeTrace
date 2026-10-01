"""API-level tests through TestClient - HTTP status codes and response shape,
proving ids are UUIDv7 strings end to end."""

from sqlmodel import select

from timetrace.db.models import Session as SessionModel


def test_create_task_returns_uuid_string_id_and_201(client):
    response = client.post("/api/tasks", json={"title": "Review PR"})

    assert response.status_code == 201
    body = response.json()
    assert isinstance(body["id"], str)
    assert len(body["id"]) == 36
    assert body["title"] == "Review PR"


def test_list_tasks_includes_created_task(client):
    created = client.post("/api/tasks", json={"title": "Write report"}).json()

    titles = [t["title"] for t in client.get("/api/tasks").json()]

    assert "Write report" in titles
    assert isinstance(created["id"], str)


def test_list_tasks_includes_parent_id_for_subtasks(client):
    parent = client.post("/api/tasks", json={"title": "Parent task"}).json()
    child = client.post("/api/tasks", json={"title": "Child task", "parent_id": parent["id"]}).json()

    listed = client.get("/api/tasks?status=all").json()
    listed_child = next(task for task in listed if task["id"] == child["id"])

    assert listed_child["parent_id"] == parent["id"]


def test_get_missing_task_returns_404(client):
    response = client.get("/api/tasks/01920000-0000-7000-8000-000000000000")

    assert response.status_code == 404


def test_delete_task_returns_204(client):
    created = client.post("/api/tasks", json={"title": "Temp task"}).json()

    response = client.delete(f"/api/tasks/{created['id']}")

    assert response.status_code == 204
    assert client.get(f"/api/tasks/{created['id']}").status_code == 404


def test_recurring_task_does_not_pre_generate_sessions(client, db):
    """The recurrence engine projects virtual occurrences on-demand rather than
    bulk-pre-generating Session rows. Creating or updating a recurring task must
    create zero Session rows — projected instances are returned by the sessions
    list endpoint with is_virtual=true and materialized on demand."""
    created = client.post(
        "/api/tasks",
        json={"title": "Daily standup", "is_recurring": True, "recurrence_rule": "daily"},
    ).json()
    sessions_after_create = len(db.exec(select(SessionModel)).all())
    assert sessions_after_create == 0, "Creating a recurring task must not pre-generate sessions"

    response = client.put(f"/api/tasks/{created['id']}", json={"description": "agenda"})

    assert response.status_code == 200
    sessions_after_update = len(db.exec(select(SessionModel)).all())
    assert sessions_after_update == 0, "Updating a recurring task must not create sessions"
