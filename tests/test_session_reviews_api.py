"""Session review contracts through the real app and its isolated database fixture."""

import pytest


def created(client, path, payload):
    response = client.post(path, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def entries(client, target_type, target_id):
    response = client.get("/rating-entries", params={"target_type": target_type, "target_id": target_id})
    assert response.status_code == 200
    return response.json()


def read_session(client, session_id):
    response = client.get(f"/sessions/{session_id}")
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def scene(client):
    status = created(client, "/api/tasks/statuses", {"name": "Review work", "is_completed": False})
    tasks = [
        created(
            client,
            "/api/tasks",
            {
                "title": title,
                "status_id": status["id"],
                "status": status["name"],
                "requires_session_review": required,
            },
        )
        for title, required in [("Exempt task", False), ("Other task", True)]
    ]
    sessions = [
        created(
            client,
            "/sessions",
            {
                "task_id": task["id"],
                "start_time": start,
                "end_time": end,
                "notes": notes,
                "tags": "#original",
            },
        )
        for task, start, end, notes in [
            (tasks[0], "2026-11-01T10:00:00Z", "2026-11-01T11:00:00Z", "First logged session"),
            (tasks[1], "2026-11-02T10:00:00Z", "2026-11-02T10:30:00Z", "Other logged session"),
            (tasks[0], "2099-11-01T10:00:00Z", "2099-11-01T11:00:00Z", "Future scheduled session"),
        ]
    ]
    definitions = [
        created(
            client,
            "/rating-definitions",
            {"name": name, "target_type": target, "min_score": low, "max_score": high, "is_required": True},
        )
        for name, target, low, high in [("Session quality", "session", -2, 2), ("Day-only scale", "day", 3, 7)]
    ]
    # GET and POST legitimately use different equivalent UTC ISO spellings.
    # Compare before/after at the same public read boundary.
    return tasks, [read_session(client, session["id"]) for session in sessions], definitions


def assert_collateral_unchanged(client, tasks, sessions):
    for task in tasks:
        response = client.get(f"/api/tasks/{task['id']}")
        assert response.status_code == 200
        actual = response.json()
        for field in ("id", "title", "status", "status_id", "requires_session_review"):
            assert actual[field] == task[field]
    for session in sessions:
        actual = read_session(client, session["id"])
        for field in ("id", "task_id", "start_time", "end_time", "duration_seconds", "tags", "notes", "review_skipped"):
            assert actual[field] == session[field]


def post_rating(client, definition, session, **values):
    return client.post(
        "/rating-entries",
        json={
            "rating_definition_id": definition["id"],
            "target_type": "session",
            "target_id": session["id"],
            "score": 0,
            **values,
        },
    )


def test_session_review_flags_notes_tags_round_trip_without_task_or_schedule_changes(client, scene):
    tasks, sessions, definitions = scene
    target, other, scheduled = sessions
    assert post_rating(client, definitions[0], target, score=0, dismissed=False).status_code == 201
    for skipped in [True, False]:
        response = client.put(
            f"/sessions/{target['id']}",
            json={
                "tags": "#review #literal",
                "notes": "First line\n<script>literal text</script>",
                "review_skipped": skipped,
            },
        )
        assert response.status_code == 200
        actual = read_session(client, target["id"])
        assert actual["tags"] == "#review #literal"
        assert actual["notes"] == "First line\n<script>literal text</script>"
        assert actual["review_skipped"] is skipped
        for field in ("id", "task_id", "start_time", "end_time", "duration_seconds"):
            assert actual[field] == target[field]
        (rating,) = entries(client, "session", target["id"])
        assert rating["dismissed"] is False
        assert rating["score"] == 0
        # A task-level exemption coexists with an actual, non-dismissed rating.
        assert client.get(f"/api/tasks/{tasks[0]['id']}").json()["requires_session_review"] is False
        assert_collateral_unchanged(client, tasks, [other, scheduled])


def test_session_rating_bounds_dismissal_and_target_upsert_preserve_shipped_policy(client, scene):
    tasks, sessions, definitions = scene
    target, other, _ = sessions
    definition, day_definition = definitions
    assert post_rating(client, definition, other, score=1).status_code == 201
    original_other = entries(client, "session", other["id"])
    created_rating = post_rating(client, definition, target, score=-2)
    assert created_rating.status_code == 201
    rating_id = created_rating.json()["id"]
    assert isinstance(rating_id, str)
    for score in [-3, 3]:
        response = post_rating(client, definition, target, score=score)
        assert response.status_code == 400
        assert "between -2 and 2" in response.json()["detail"]
        assert entries(client, "session", target["id"])[0]["score"] == -2
    # Required definitions may be dismissed, including a score outside their scale.
    response = post_rating(client, definition, target, score=99, dismissed=True)
    assert response.status_code == 201
    assert response.json()["id"] == rating_id
    assert response.json()["dismissed"] is True
    assert post_rating(client, definition, target, score=0, dismissed=False).status_code == 201
    (rating,) = entries(client, "session", target["id"])
    assert (rating["id"], rating["score"], rating["dismissed"]) == (rating_id, 0, False)
    # Historical writes do not introduce a definition-context rejection policy.
    assert post_rating(client, day_definition, target, score=3).status_code == 201
    assert {entry["rating_definition_id"] for entry in entries(client, "session", target["id"])} == {
        definition["id"],
        day_definition["id"],
    }
    assert entries(client, "session", other["id"]) == original_other
    assert_collateral_unchanged(client, tasks, sessions)


def test_reset_is_session_target_scoped_and_retains_task_exemption(client, scene):
    tasks, sessions, definitions = scene
    target, other, _ = sessions
    for session in [target, other]:
        assert post_rating(client, definitions[0], session, score=2).status_code == 201
    # Same string target in another context must survive a session reset.
    created(
        client,
        "/rating-entries",
        {"rating_definition_id": definitions[1]["id"], "target_type": "day", "target_id": target["id"], "score": 5},
    )
    untouched_day = entries(client, "day", target["id"])
    untouched_other = entries(client, "session", other["id"])
    assert client.put(f"/sessions/{target['id']}", json={"review_skipped": True}).status_code == 200
    # These are the existing caller's two reset operations, each independently committed.
    assert (
        client.delete("/rating-entries", params={"target_type": "session", "target_id": target["id"]}).status_code
        == 204
    )
    assert read_session(client, target["id"])["review_skipped"] is True
    assert entries(client, "session", target["id"]) == []
    assert client.put(f"/sessions/{target['id']}", json={"review_skipped": False}).status_code == 200
    assert entries(client, "session", other["id"]) == untouched_other
    assert entries(client, "day", target["id"]) == untouched_day
    assert_collateral_unchanged(client, tasks, sessions)


def test_review_delete_preserves_other_sessions_and_task_status(client, scene):
    tasks, sessions, definitions = scene
    target, other, scheduled = sessions
    assert post_rating(client, definitions[0], other, score=1).status_code == 201
    untouched_other = entries(client, "session", other["id"])
    response = client.delete(f"/sessions/{target['id']}")
    assert response.status_code == 204
    assert client.get(f"/sessions/{target['id']}").status_code == 404
    rows = client.get("/sessions").json()
    assert {row["id"] for row in rows} == {other["id"], scheduled["id"]}
    assert entries(client, "session", other["id"]) == untouched_other
    assert_collateral_unchanged(client, tasks, [other, scheduled])
