"""Day workspace contracts through the real app and isolated database fixtures."""

from datetime import UTC, datetime, timedelta

from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task


def test_workspace_page_preserves_review_entry_points(client):
    response = client.get("/revision")
    assert response.status_code == 200
    for marker in [
        "day_editor_template",
        "day_main_editor",
        "day_history_panel",
        "session_review_modal",
        "task_inspector_body",
        "rating_def_modal",
        "day_workspace.css",
    ]:
        assert marker in response.text
    assert "day_kpi_badges" not in response.text


def test_same_definition_ratings_and_review_dismissals_are_date_owned(client):
    definition = client.post(
        "/rating-definitions",
        json={
            "name": "Shared scale",
            "target_type": "day",
            "min_score": 1,
            "max_score": 5,
            "is_required": True,
        },
    )
    assert definition.status_code == 201
    definition_id = definition.json()["id"]
    for day, score, dismissed in [("2026-11-01", 1, False), ("2026-11-02", 0, True)]:
        response = client.post(
            "/rating-entries",
            json={
                "rating_definition_id": definition_id,
                "target_type": "day",
                "target_id": day,
                "score": score,
                "dismissed": dismissed,
            },
        )
        assert response.status_code == 201
        assert (
            client.post(
                "/revision/day-review",
                json={
                    "date_str": day,
                    "rating": 4,
                    "notes": day,
                    "review_skipped": dismissed,
                },
            ).status_code
            == 200
        )
    for day, score, dismissed in [("2026-11-01", 1, False), ("2026-11-02", 0, True)]:
        summary = client.get("/revision/day-summary", params={"date_str": day}).json()
        assert summary["day_review"]["notes"] == day
        assert summary["day_review"]["review_skipped"] is dismissed
        (entry,) = summary["custom_ratings"]
        assert (entry["target_id"], entry["score"], entry["dismissed"]) == (day, score, dismissed)
    assert (
        client.post(
            "/rating-entries",
            json={
                "rating_definition_id": definition_id,
                "target_type": "day",
                "target_id": "2026-11-01",
                "score": 5,
                "dismissed": False,
            },
        ).status_code
        == 201
    )
    other = client.get("/revision/day-summary?date_str=2026-11-02").json()
    assert other["custom_ratings"][0]["dismissed"] is True


def test_day_evidence_keeps_full_rows_fanout_created_task_count_and_review_has_no_task_effect(client, db):
    # Build naive UTC rows from the same local calendar day used by the existing service.
    start = datetime(2026, 11, 1, 10).astimezone().astimezone(UTC).replace(tzinfo=None)
    done = Task(title="Done task created today", status="Done", created_at=start)
    older = Task(title="Done task created yesterday", status="Done", created_at=start - timedelta(days=1))
    active = Task(title="Active", status="To Do", created_at=start)
    db.add_all([done, older, active])
    db.commit()
    first = SessionModel(
        task_id=active.id,
        start_time=start,
        end_time=start + timedelta(hours=1),
        duration_seconds=3600,
        tags="#one #two",
    )
    direct = SessionModel(
        start_time=start + timedelta(hours=2), end_time=start + timedelta(hours=3), duration_seconds=3600, tags="#two"
    )
    db.add_all([first, direct])
    db.commit()
    db.refresh(first)
    before = first.model_dump()
    summary = client.get("/revision/day-summary?date_str=2026-11-01").json()
    assert summary["total_hours"] == 2
    assert summary["total_sessions"] == 2
    assert summary["completed_tasks_count"] == 1
    assert summary["tag_attribution"] == "fanout"
    assert sum(row["total_hours"] for row in summary["tag_breakdown"]) == 3
    assert {row["task_id"] for row in summary["task_breakdown"]} == {None, active.id}
    assert (
        client.post(
            "/revision/day-review",
            json={
                "date_str": "2026-11-01",
                "rating": 5,
                "notes": "Review only",
                "review_skipped": True,
            },
        ).status_code
        == 200
    )
    db.refresh(active)
    db.refresh(first)
    assert active.status == "To Do"
    assert first.model_dump() == before
