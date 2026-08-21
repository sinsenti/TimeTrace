"""API-level tests through TestClient - HTTP status codes and response shape,
proving ids are UUIDv7 strings end to end."""


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
