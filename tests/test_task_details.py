"""HTTP adapter contracts; the budget matrix lives in test_task_work_accounting.py."""

from datetime import UTC, datetime, timedelta

import pytest
from data_builders import legacy_session_row

from timetrace.core.timer import timer_manager
from timetrace.db.models import Task
from timetrace.services import session_service

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
        (None, False, None, None, None, True),
        (60, True, None, None, 200, True),
    ],
    ids=["finite-overspent", "missing-serializes-nulls", "recurring-omits-projections"],
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
        (-180, -60, 7200),  # logged
        (1, 31, 1800),  # scheduled
        (-60, 60, 7200),  # visible in history, neither logged nor scheduled
    ]:
        row = legacy_session_row(
            task_id=task.id,
            start_time=(INSTANT + timedelta(minutes=start)).replace(tzinfo=None),
            end_time=(INSTANT + timedelta(minutes=end)).replace(tzinfo=None),
            duration_seconds=seconds,
            notes="Recorded <not necessarily performed>",
        )
        rows.append(row)
    db.add_all(rows)
    db.add(
        legacy_session_row(
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
    assert type(data["is_unbounded"]) is bool
    for key in ("logged_hours", "scheduled_hours", "remaining_hours", "unscheduled_hours", "progress_pct"):
        if expected[key] is not None:
            assert type(data[key]) in (int, float)
    assert data["task"]["id"] == task.id
    assert data["total_sessions"] == 3
    assert {row["id"] for row in data["sessions"]} == {row.id for row in rows}
    assert all(not row["id"].startswith("virt:") for row in data["sessions"])
    assert data["total_hours"] == 4.5  # All recorded rows, not the 2h logged accounting total.
    child_response = client.get(f"/api/tasks/{child.id}/stats")
    assert child_response.status_code == 200
    child_stats = child_response.json()
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
