"""Characterize existing agenda/legacy contracts; no backend behavior change."""

import os
import time
from datetime import UTC, datetime, timedelta

import pytest

from timetrace.db.models import Habit, Task
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import SessionCreate, SessionUpdate, TaskCreate, TaskUpdate
from timetrace.services import AnalyticsService, SessionService, TaskService, analytics_service


@pytest.mark.parametrize(
    ("mode", "heading"),
    [
        ("sessions", "# TimeTrace Session Agenda"),
        ("tasks_short", "# TimeTrace Task Agenda Summary"),
        ("tasks_full", "# TimeTrace Complete Task Dossier"),
        ("habits", "# TimeTrace Habits Briefing"),
        ("all", "# TimeTrace System-Wide Export"),
        ("all_date_range", "# TimeTrace System-Wide Export"),
    ],
)
def test_agenda_export_six_real_scopes_and_attachment_headers(client, db, mode, heading):
    db.add(Task(title="Unfiltered definition", assigned_date="1999-01-01", description="Literal <img> Markdown"))
    db.add(Habit(name="Habit definition outside range"))
    db.commit()
    result = client.get(
        "/api/agenda/export", params={"mode": mode, "start_date": "2026-11-10", "end_date": "2026-11-10"}
    )
    assert result.status_code == 200
    assert result.headers["content-type"].startswith("text/markdown")
    assert result.headers["content-disposition"] == f"attachment; filename=timetrace_export_{mode}.md"
    assert heading in result.text
    if mode in ("tasks_short", "tasks_full", "all", "all_date_range"):
        assert "Unfiltered definition" in result.text
    if mode in ("habits", "all", "all_date_range"):
        assert "Habit definition outside range" in result.text
    if mode == "tasks_full":
        assert "Literal <img> Markdown" in result.text


def test_agenda_range_includes_entire_utc_start_day_not_overlap_or_end_or_definitions(client, db):
    fixtures = [
        (datetime(2026, 11, 9, 23, 59, 59, 999999), datetime(2026, 11, 10, 1), "excluded overlap"),
        (datetime(2026, 11, 10), datetime(2026, 11, 11), "included midnight and long duration"),
        (datetime(2026, 11, 10, 23, 59, 59, 999999), datetime(2026, 11, 12), "included last microsecond"),
        (datetime(2026, 11, 11), datetime(2026, 11, 11, 1), "excluded next midnight"),
    ]
    for start, end, notes in fixtures:
        db.add(SessionModel(start_time=start, end_time=end, notes=notes))
    db.add(Task(title="Old task survives", assigned_date="1900-01-01", due_date=datetime(1900, 1, 2)))
    db.add(Habit(name="All habit definitions survive", created_at=datetime(1900, 1, 1)))
    db.commit()
    text = client.get("/api/agenda/export?mode=all_date_range&start_date=2026-11-10&end_date=2026-11-10").text
    assert "Sessions Log (2 entries)" in text
    assert "included midnight and long duration" in text
    assert "included last microsecond" in text
    assert "excluded overlap" not in text
    assert "excluded next midnight" not in text
    assert "Old task survives" in text
    assert "All habit definitions survive" in text
    assert "Sessions Log (4 entries)" in client.get("/api/agenda/export?mode=all").text
    assert "Sessions Log (3 entries)" in client.get("/api/agenda/export?mode=all_date_range&end_date=2026-11-10").text
    assert "Sessions Log (3 entries)" in client.get("/api/agenda/export?mode=all_date_range&start_date=2026-11-10").text


@pytest.mark.parametrize("zone", ["America/New_York", "Pacific/Kiritimati"])
def test_agenda_utc_today_tomorrow_anchors_with_server_local_display(db, monkeypatch, zone):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 10, 0, 30, tzinfo=UTC)

    old_zone = os.environ.get("TZ")
    monkeypatch.setattr(analytics_service, "datetime", Clock)
    monkeypatch.setenv("TZ", zone)
    time.tzset()
    try:
        db.add(
            SessionModel(
                start_time=datetime(2026, 11, 10, 23, 30),
                end_time=datetime(2026, 11, 10, 23, 45),
                notes="Local display example",
            )
        )
        db.commit()
        text = AnalyticsService(db).export_agenda_briefing()
        assert "generated_at: 2026-11-10 00:30:00 UTC" in text
        assert "## Tomorrow (2026-11-11)" in text
        if zone == "America/New_York":
            assert "## Later Today\n- [18:30 - 18:45] Local display example" in text
        else:
            assert "## Tomorrow (2026-11-11)\n- [13:30 - 13:45] Local display example" in text
    finally:
        if old_zone is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old_zone
        time.tzset()


def test_agenda_merged_projection_preserves_skip_move_and_logged_history(db):
    now = datetime.now(UTC).replace(microsecond=0)
    tasks, sessions = TaskService(db), SessionService(db)
    task = tasks.create_task(
        TaskCreate(
            title="Projected agenda",
            is_recurring=True,
            recurrence_rule="daily",
            recurrence_dtstart=now + timedelta(days=2),
        )
    )
    occurrences = sessions.list_sessions(start=now + timedelta(days=2), end=now + timedelta(days=6))
    assert len(occurrences) == 4
    assert all(row["id"].startswith("virt:") for row in occurrences)
    sessions.delete_session(occurrences[0]["id"])
    moved_start = now + timedelta(days=3, hours=2)
    moved = sessions.update_session(
        occurrences[1]["id"],
        SessionUpdate(start_time=moved_start, end_time=moved_start + timedelta(minutes=30), notes="Moved occurrence"),
    )
    logged = sessions.create_session(
        SessionCreate(
            start_time=now - timedelta(days=2),
            end_time=now - timedelta(days=2) + timedelta(minutes=30),
            task_id=task.id,
            notes="Logged history",
        )
    )
    tasks.update_task(task.id, TaskUpdate(description="Unrelated edit"))
    text = AnalyticsService(db).export_agenda_briefing()
    assert "Projected agenda" in text
    merged = sessions.list_sessions(start=now + timedelta(days=2), end=now + timedelta(days=6))
    assert len(merged) == 3
    assert not any(row["id"] in (occurrences[0]["id"], occurrences[1]["id"]) for row in merged)
    assert any(row["id"] == moved.id and not row["is_virtual"] for row in merged)
    # Read-only export must neither materialize remaining projections nor erase logged history.
    assert sessions.get_session_by_id(logged.id)["notes"] == "Logged history"
    assert sum(row["is_virtual"] for row in merged) == 2
    expected_local = moved_start.astimezone().strftime("%Y-%m-%d %H:%M")
    assert expected_local in text


def test_legacy_markdown_export_and_import_contract_remains_available(client):
    exported = client.get("/markdown/export")
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/plain")
    imported = client.post("/markdown/import", content=exported.text, headers={"Content-Type": "text/plain"})
    assert imported.status_code == 201
    assert imported.json()["status"] == "success"
