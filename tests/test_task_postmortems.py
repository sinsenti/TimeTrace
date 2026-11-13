"""Task post-mortem HTTP characterizations of existing O5 policy.

These shipped domain contracts are GREEN characterizations, not invented server policy.
"""

from datetime import datetime, timedelta

import pytest

from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task


def post_created(client, path, payload):
    response = client.post(path, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def entries(client, target_type, target_id):
    response = client.get("/rating-entries", params={"target_type": target_type, "target_id": target_id})
    assert response.status_code == 200
    return response.json()


def test_task_postmortem_roundtrip_upserts_review_and_own_ratings(client):
    task = post_created(client, "/api/tasks", {"title": "Literal <task>"})
    other = post_created(client, "/api/tasks", {"title": "Other task"})
    definition = post_created(client, "/rating-definitions", {"name": "Quality", "target_type": "task"})
    isolated = []
    for target_type, target_id in [("task", other["id"]), ("day", "2026-11-13"), ("session", task["id"])]:
        post_created(
            client,
            "/rating-entries",
            {
                "rating_definition_id": definition["id"],
                "target_type": target_type,
                "target_id": target_id,
                "score": 2,
            },
        )
        isolated.append((target_type, target_id, entries(client, target_type, target_id)))
    review_payload = {
        "task_id": task["id"],
        "difficulty": 7,
        "what_went_well": "<script>literal</script>",
        "blockers": "Blocked\nthen resumed",
        "key_takeaways": "Keep notes",
    }
    first = post_created(client, "/api/task-reviews", review_payload)
    rating_payload = {
        "rating_definition_id": definition["id"],
        "target_type": "task",
        "target_id": task["id"],
        "score": 8,
    }
    rating = post_created(client, "/rating-entries", rating_payload)
    updated = post_created(client, "/api/task-reviews", {**review_payload, "blockers": "Resolved"})
    updated_rating = post_created(client, "/rating-entries", {**rating_payload, "score": 9})
    assert updated["id"] == first["id"]
    assert updated_rating["id"] == rating["id"]
    read = client.get(f"/api/task-reviews/{task['id']}")
    assert read.status_code == 200
    assert read.json() == updated
    stats = client.get(f"/api/tasks/{task['id']}/stats")
    assert stats.status_code == 200
    assert stats.json()["task_review"]["what_went_well"] == "<script>literal</script>"
    assert [(r["id"], r["target_type"], r["target_id"], r["score"]) for r in stats.json()["custom_ratings"]] == [
        (rating["id"], "task", task["id"], 9)
    ]
    for target_type, target_id, baseline in isolated:
        assert entries(client, target_type, target_id) == baseline
    assert client.get(f"/api/task-reviews/{other['id']}").json() is None


def test_task_postmortem_missing_task_is_404(client):
    response = client.post("/api/task-reviews", json={"task_id": "01920000-0000-7000-8000-000000000000"})
    assert response.status_code == 404


@pytest.mark.parametrize(
    ("score", "dismissed", "context", "expected"),
    [
        (0, False, "task", 400),
        (11, False, "task", 400),
        (0, True, "task", 201),
        (5, False, "day", 201),
    ],
)
def test_task_postmortem_rating_dismissal_bounds_and_context_remain_existing_policy(
    client, score, dismissed, context, expected
):
    task = post_created(client, "/api/tasks", {"title": "Rating policy"})
    definition = post_created(
        client,
        "/rating-definitions",
        {
            "name": "Required quality",
            "target_type": "task",
            "min_score": 1,
            "max_score": 10,
            "is_required": True,
        },
    )
    # Existing server context is a free string; the UI still submits task-target entries.
    response = client.post(
        "/rating-entries",
        json={
            "rating_definition_id": definition["id"],
            "target_type": context,
            "target_id": task["id"],
            "score": score,
            "dismissed": dismissed,
        },
    )
    assert response.status_code == expected
    persisted = entries(client, context, task["id"])
    if expected == 201:
        assert len(persisted) == 1
        assert persisted[0]["dismissed"] is dismissed
        assert persisted[0]["score"] == score
    else:
        assert persisted == []


@pytest.mark.parametrize("recurring", [False, True])
def test_task_postmortem_preserves_status_scheduled_logged_and_child_rows(client, db, recurring):
    anchor = datetime(2099, 1, 1, 9)
    task = Task(
        title="Review does not complete",
        status="in_progress",
        is_recurring=recurring,
        recurrence_rrule="FREQ=DAILY;COUNT=2" if recurring else None,
        recurrence_dtstart=anchor if recurring else None,
        recurrence_duration_minutes=30 if recurring else None,
        recurrence_timezone="UTC" if recurring else None,
    )
    child = Task(title="Child", parent_id=task.id)
    db.add_all([task, child])
    db.flush()
    db.add_all(
        [
            SessionModel(
                task_id=task.id,
                start_time=datetime(2020, 1, 1, 9),
                end_time=datetime(2020, 1, 1, 10),
                duration_seconds=3600,
            ),
            SessionModel(
                task_id=task.id, start_time=anchor, end_time=anchor + timedelta(minutes=30), duration_seconds=1800
            ),
            SessionModel(task_id=task.id, start_time=anchor + timedelta(hours=1), end_time=None),
            SessionModel(
                task_id=child.id,
                start_time=datetime(2020, 1, 2, 9),
                end_time=datetime(2020, 1, 2, 10),
                duration_seconds=3600,
            ),
        ]
    )
    db.commit()
    task_before = client.get(f"/api/tasks/{task.id}").json()
    child_before = client.get(f"/api/tasks/{child.id}").json()
    sessions_before = client.get("/api/sessions", params={"include_virtual": False}).json()
    own_before = client.get(f"/api/tasks/{task.id}/stats").json()
    assert own_before["total_sessions"] == 3
    for difficulty in [8, 4]:
        post_created(client, "/api/task-reviews", {"task_id": task.id, "difficulty": difficulty})
        assert client.get(f"/api/tasks/{task.id}").json() == task_before
        assert client.get(f"/api/tasks/{child.id}").json() == child_before
        assert client.get("/api/sessions", params={"include_virtual": False}).json() == sessions_before
        stats = client.get(f"/api/tasks/{task.id}/stats").json()
        assert stats["sessions"] == own_before["sessions"]
        assert stats["logged_hours"] == own_before["logged_hours"]
        assert stats["scheduled_hours"] == own_before["scheduled_hours"]
        assert stats["task_review"]["difficulty"] == difficulty


@pytest.mark.parametrize("path", ["/task-inspector/", "/tasks-detail/"])
def test_task_postmortem_dedicated_aliases_render_shared_editor(client, path):
    task = post_created(client, "/api/tasks", {"title": "Task detail review"})
    response = client.get(path + task["id"])
    assert response.status_code == 200
    html = response.text
    assert html.count('id="details_task_postmortem"') == 1
    assert 'data-task-review="save" disabled' in html
    assert html.index("/static/js/ratings_config.js") < html.index("/static/js/task_postmortem.js")
    assert html.index("/static/js/task_postmortem.js") < html.index("/static/js/subtasks.js")


def test_task_postmortem_revision_renders_independent_shared_editor(client):
    response = client.get("/revision")
    assert response.status_code == 200
    html = response.text
    assert html.count('id="revision_task_postmortem"') == 1
    assert 'id="details_task_postmortem"' not in html
    assert html.index("/static/js/task_postmortem.js") < html.index("/static/js/task_inspector.js")
