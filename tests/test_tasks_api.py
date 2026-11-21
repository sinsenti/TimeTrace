"""API-level tests through TestClient - HTTP status codes and response shape,
proving ids are UUIDv7 strings end to end."""

from datetime import UTC, datetime, timedelta

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


def test_quick_add_posts_and_edits_explicit_schedules_without_legacy_work(client):

    now = datetime.now(UTC)
    parent = client.post("/api/tasks", json={"title": "Parent #research"}).json()
    response = client.post(
        "/api/tasks", json={"title": "Reading t:2h [45m]", "status": "Scheduled", "parent_id": parent["id"]}
    )
    assert response.status_code == 201
    task = response.json()
    assert (task["title"], task["estimated_minutes"], task["tags"], task["status"]) == (
        "Reading",
        45,
        "#research",
        "Scheduled",
    )
    changed = client.put(f"/api/tasks/{task['id']}", json={"title": "Draft t:4h [3h] #writing"}).json()
    assert changed["title"] == "Draft" and changed["status_id"] == task["status_id"]
    client.post("/api/tasks", json={"title": "Another day t:2d"})
    plans = client.get(
        "/agenda", params={"start": now.isoformat(), "end": (now + timedelta(days=3)).isoformat()}
    ).json()["items"]
    assert [(p["task_id"], p["kind"], p["duration_seconds"], p["tags"], p["notes"]) for p in plans] == [
        (task["id"], "scheduled_session", 2700, "#research", "Scheduled: Reading"),
        (task["id"], "scheduled_session", 1800, "#writing", "Scheduled: Draft"),
    ]
    assert (
        now + timedelta(hours=2)
        <= datetime.fromisoformat(plans[0]["start_time"])
        <= datetime.now(UTC) + timedelta(hours=2)
    )
    assert all(p["original_start"] == p["start_time"] and p["original_end"] == p["end_time"] for p in plans)
    assert client.get("/sessions").json() == []


def test_quick_add_plan_rolls_back_with_invalid_task_recurrence(client):
    payload = {"title": "Not saved t:1h", "is_recurring": True, "recurrence_rrule": "FREQ=NOT_A_RULE"}
    task = client.post("/api/tasks", json={"title": "Original"}).json()
    assert client.post("/api/tasks", json=payload).status_code == 400
    assert client.put(f"/api/tasks/{task['id']}", json=payload).status_code == 400
    current = client.get("/api/tasks?status=all").json()
    assert [(row["id"], row["title"]) for row in current] == [(task["id"], "Original")]
    now = datetime.now(UTC)
    params = {"start": now.isoformat(), "end": (now + timedelta(days=2)).isoformat()}
    assert client.get("/agenda", params=params).json()["items"] == []
