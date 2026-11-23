"""Workspace bounded task discovery through the root HTTP interface."""


def test_work_note_edits_are_independent_revision_checked_and_do_not_correct_time(client):
    work = client.post(
        "/recorded-work",
        json={"start_time": "2026-01-01T10:00:00Z", "end_time": "2026-01-01T10:10:00Z", "notes": "Before"},
    ).json()
    response = client.patch(
        f"/recorded-work/{work['id']}/note", json={"expected_revision": work["revision"], "notes": "After"}
    )
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["notes"] == "After"
    assert saved["start_time"] == work["start_time"]
    assert saved["end_time"] == work["end_time"]
    assert saved["task_id"] == work["task_id"]
    assert saved["provenance"] == work["provenance"]
    assert saved["revision"] == work["revision"] + 1
    assert (
        client.patch(
            f"/recorded-work/{work['id']}/note", json={"expected_revision": work["revision"], "notes": "Stale"}
        ).status_code
        == 409
    )
    assert client.get(f"/recorded-work/{work['id']}").json()["notes"] == "After"


def test_workspace_search_bounds_matching_task_title_and_tags(client):
    first = client.post("/api/tasks", json={"title": "Writing", "tags": "#paper", "description": "Draft notes"}).json()
    client.post("/api/tasks", json={"title": "Writing second", "tags": "#other"})
    response = client.get("/api/tasks", params={"title_contains": "Writing", "tag_contains": "#paper", "limit": 1})
    assert response.status_code == 200
    assert [task["id"] for task in response.json()] == [first["id"]]
    assert client.get("/api/tasks", params={"limit": 0}).status_code == 422
    assert client.get("/api/tasks", params={"limit": 201}).status_code == 422
