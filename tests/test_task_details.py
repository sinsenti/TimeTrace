"""Ticket 05 HTTP characterization of the existing shared work-accounting contract.

These are not claimed as RED: no backend policy or endpoint changes are needed.
"""

from datetime import UTC, datetime, timedelta

import pytest

from timetrace.core.timer import timer_manager
from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task
from timetrace.services import session_service
from timetrace.services.ai_insights_service import AIInsightsService

INSTANT = datetime(2026, 11, 4, 12, tzinfo=UTC)


@pytest.mark.parametrize(
    ("estimate_fields", "canonical_estimate"),
    [({}, 15), ({"estimated_minutes": 0}, 0), ({"estimated_minutes": None}, 15), ({"estimated_minutes": -60}, -60)],
    ids=["omitted", "zero", "null-insert-default", "negative"],
)
def test_task_details_public_create_default_and_explicit_update_null(client, estimate_fields, canonical_estimate):
    """CREATE's mapped default and a genuine UPDATE-null receipt are different fixtures."""
    created = client.post("/api/tasks", json={"title": "Neutral estimate receipt", **estimate_fields})
    assert created.status_code == 201
    create_ack = created.json()
    assert create_ack["estimated_minutes"] == canonical_estimate
    task_id = create_ack["id"]
    read = client.get(f"/api/tasks/{task_id}")
    assert read.status_code == 200
    assert read.json()["estimated_minutes"] == canonical_estimate

    updated = client.put(f"/api/tasks/{task_id}", json={"estimated_minutes": None})
    assert updated.status_code == 200
    assert updated.json()["id"] == task_id
    assert updated.json()["estimated_minutes"] is None
    read = client.get(f"/api/tasks/{task_id}")
    assert read.status_code == 200
    assert read.json()["estimated_minutes"] is None

    omitted = client.put(f"/api/tasks/{task_id}", json={"description": "Estimate intentionally omitted"})
    assert omitted.status_code == 200
    assert omitted.json()["estimated_minutes"] is None
    read = client.get(f"/api/tasks/{task_id}")
    assert read.status_code == 200
    assert read.json()["estimated_minutes"] is None


@pytest.mark.parametrize(
    ("estimate", "recurring", "remaining", "unscheduled", "progress", "unbounded"),
    [
        (60, False, -1, -1.5, 200, False),
        (-60, False, -3, -3.5, None, False),
        (0, False, None, None, None, True),
        (None, False, None, None, None, True),
        (60, True, None, None, 200, True),
    ],
)
def test_task_details_http_accounting_is_own_real_history_not_performed_row_count(
    client, db, monkeypatch, estimate, recurring, remaining, unscheduled, progress, unbounded
):
    calls = []

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            calls.append(True)
            return INSTANT.astimezone(tz) if tz else INSTANT.replace(tzinfo=None)

    monkeypatch.setattr(session_service, "datetime", FixedDatetime)
    task = Task(
        title="Literal <task> #05",
        estimated_minutes=estimate,
        is_recurring=recurring,
        recurrence_rrule="FREQ=DAILY;COUNT=2" if recurring else None,
        recurrence_dtstart=(INSTANT + timedelta(days=1)).replace(tzinfo=None) if recurring else None,
        recurrence_duration_minutes=60 if recurring else None,
        recurrence_timezone="UTC" if recurring else None,
    )
    child = Task(title="Child history is separate", parent_id=task.id)
    db.add_all([task, child])
    db.flush()
    task.estimated_minutes = estimate  # SQLAlchemy's INSERT default otherwise replaces None with 15.
    rows = []
    for start, end, seconds in [
        (-180, -120, 3600),  # closed past
        (-60, 0, 3600),  # inclusive end exactly at the single measurement instant
        (1, 31, 1800),  # strictly future closed
        (0, 30, 1800),  # exclusive start exactly now
        (-30, 30, 3600),  # straddling
        (-10, None, 900),  # open retaining a duration
        (60, None, 900),  # future open retaining a duration
    ]:
        row = SessionModel(
            task_id=task.id,
            start_time=(INSTANT + timedelta(minutes=start)).replace(tzinfo=None),
            end_time=(INSTANT + timedelta(minutes=end)).replace(tzinfo=None) if end is not None else None,
            duration_seconds=seconds,
            notes="Recorded <not necessarily performed>",
        )
        rows.append(row)
    db.add_all(rows)
    db.add(
        SessionModel(
            task_id=child.id,
            start_time=(INSTANT - timedelta(hours=10)).replace(tzinfo=None),
            end_time=INSTANT.replace(tzinfo=None),
            duration_seconds=36000,
        )
    )
    db.commit()
    timer_manager.start(task_id=task.id, task_title=task.title)
    response = client.get(f"/api/tasks/{task.id}/stats")
    assert response.status_code == 200
    assert len(calls) == 1
    data = response.json()
    expected = {
        "logged_hours": 2.0,
        "scheduled_hours": 0.5,
        "remaining_hours": remaining,
        "unscheduled_hours": unscheduled,
        "progress_pct": progress,
        "is_unbounded": unbounded,
    }
    assert {key: data[key] for key in expected} == expected
    assert data["total_sessions"] == 7
    assert {row["id"] for row in data["sessions"]} == {row.id for row in rows}
    assert all(not row["id"].startswith("virt:") for row in data["sessions"])
    assert data["total_hours"] == 4.5  # All recorded rows, not the 2h logged accounting total.
    ai = AIInsightsService(db).get_task_progress(task.id)
    assert {key: ai[key] for key in expected} == expected
    assert ai["session_count"] == 7
    assert "sessions" not in ai
    child_stats = client.get(f"/api/tasks/{child.id}/stats").json()
    assert child_stats["logged_hours"] == 10
    assert child_stats["total_sessions"] == 1


@pytest.mark.parametrize("route", ["task-inspector", "tasks-detail"])
def test_task_details_alias_keeps_real_editor_controllers_and_scoped_style(client, route):
    response = client.get(f"/{route}/literal-task-id")
    assert response.status_code == 200
    assert 'id="inspector_task_id" value="literal-task-id"' in response.text
    assert "/static/css/task_details.css" in response.text
    for controller in ["task_modal", "session_modal", "tags_engine", "subtasks"]:
        assert f"/static/js/{controller}.js" in response.text
    assert 'id="task_modal"' in response.text
    assert 'id="session_modal"' in response.text
    assert "Cancel property edits" in response.text
