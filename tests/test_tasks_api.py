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


def test_get_missing_task_returns_404(client):
    response = client.get("/api/tasks/01920000-0000-7000-8000-000000000000")

    assert response.status_code == 404


def test_delete_task_returns_204(client):
    created = client.post("/api/tasks", json={"title": "Temp task"}).json()

    response = client.delete(f"/api/tasks/{created['id']}")

    assert response.status_code == 204
    assert client.get(f"/api/tasks/{created['id']}").status_code == 404


def test_recurring_task_update_does_not_duplicate_sessions(client, db):
    """An update unrelated to recurrence (e.g. editing the description) still
    re-runs schedule_recurrent_sessions_three_months for any is_recurring task.
    Regression: that function anchored on datetime.now(UTC) when the task had
    no assigned_date, so create and update landed on different day-sequences
    and the existing-session dedup check never matched, doubling every future
    session on each unrelated edit."""
    created = client.post(
        "/api/tasks",
        json={"title": "Daily standup", "is_recurring": True, "recurrence_rule": "daily"},
    ).json()
    sessions_after_create = len(db.exec(select(SessionModel)).all())

    response = client.put(f"/api/tasks/{created['id']}", json={"description": "agenda"})

    assert response.status_code == 200
    sessions_after_update = len(db.exec(select(SessionModel)).all())
    assert sessions_after_update == sessions_after_create
