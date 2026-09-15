import json
from datetime import UTC, datetime, timedelta

from timetrace.core.query_spec import (
    AnalyticsQuery,
    DateRange,
    FilterField,
    FilterOp,
    Measure,
    QueryFilter,
    QuerySource,
    RangePreset,
)
from timetrace.core.timezones import daemon_tzinfo, from_local_naive
from timetrace.db.models import AIDraftBatch, AIDraftItem, Task, TaskStatus
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.services import ai_tool_gateway
from timetrace.services.ai_chat_service import AIChatService
from timetrace.services.ai_insights_service import AIInsightsService
from timetrace.services.ai_provider_service import AISettingsService
from timetrace.services.ai_tool_gateway import DbAIToolGateway
from timetrace.services.query_service import QueryService


def _utc_from_local(local_value: datetime) -> datetime:
    return from_local_naive(local_value, daemon_tzinfo()).replace(tzinfo=UTC)


def test_task_search_uses_local_fts_and_tracks_task_updates(db):
    done_status = TaskStatus(name="Finished", is_completed=True)
    matching = Task(
        title="Prepare annual report",
        description="Review the finance forecast and supporting notes",
        tags="deep-work finance",
    )
    done = Task(title="Finished finance report", description="finance archive", status="Finished")
    db.add(done_status)
    db.add(matching)
    db.add(done)
    db.commit()

    service = AIInsightsService(db)
    results = service.search_tasks("finance forecast")
    assert [item["id"] for item in results] == [matching.id]

    assert service.search_tasks("finance archive") == []
    assert service.search_tasks("finance archive", include_done=True)[0]["id"] == done.id

    matching.description = "Plan the customer workshop"
    db.add(matching)
    db.commit()
    assert service.search_tasks("finance forecast") == []
    assert service.search_tasks("customer workshop")[0]["id"] == matching.id


def test_conflicts_include_sessions_started_before_the_requested_window(db):
    first = SessionModel(
        start_time=datetime(2026, 9, 10, 8, 50),
        end_time=datetime(2026, 9, 10, 9, 30),
        duration_seconds=2400,
        notes="Early session",
    )
    second = SessionModel(
        start_time=datetime(2026, 9, 10, 9, 15),
        end_time=datetime(2026, 9, 10, 10, 0),
        duration_seconds=2700,
        notes="Overlapping session",
    )
    db.add(first)
    db.add(second)
    db.commit()

    conflicts = AIInsightsService(db).find_conflicts(
        datetime(2026, 9, 10, 9, tzinfo=UTC),
        datetime(2026, 9, 10, 11, tzinfo=UTC),
    )
    assert len(conflicts) == 1
    assert conflicts[0]["session_a_id"] == first.id
    assert conflicts[0]["session_b_id"] == second.id
    assert conflicts[0]["overlap_minutes"] == 15


def test_free_slots_honor_hours_breaks_days_and_daily_capacity(db):
    tz = daemon_tzinfo()
    local_day = (datetime.now(tz).replace(tzinfo=None) + timedelta(days=2)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    settings = AISettingsService(db).update_settings(
        scheduling_day_start="09:00",
        scheduling_day_end="17:00",
        minimum_break_minutes=30,
        maximum_daily_minutes=300,
        scheduling_days=[local_day.strftime("%A").lower()],
    )
    assert settings.minimum_break_minutes == 30

    db.add(
        SessionModel(
            start_time=from_local_naive(local_day.replace(hour=10), tz),
            end_time=from_local_naive(local_day.replace(hour=11), tz),
            duration_seconds=3600,
            notes="Existing work",
        )
    )
    db.commit()

    slots = AIInsightsService(db).find_free_slots(
        _utc_from_local(local_day.replace(hour=8)),
        _utc_from_local(local_day.replace(hour=18)),
        min_duration_minutes=30,
    )
    assert [(slot["duration_minutes"]) for slot in slots] == [30, 240]
    assert slots[0]["start"] == _utc_from_local(local_day.replace(hour=9)).isoformat()
    assert slots[1]["start"] == _utc_from_local(local_day.replace(hour=11, minute=30)).isoformat()


def test_schedule_validation_counts_existing_sessions_for_the_whole_local_day(db):
    tz = daemon_tzinfo()
    local_day = (datetime.now(tz).replace(tzinfo=None) + timedelta(days=2)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    AISettingsService(db).update_settings(
        scheduling_day_start="09:00",
        scheduling_day_end="17:00",
        maximum_daily_minutes=90,
        scheduling_days=[local_day.strftime("%A").lower()],
    )
    task = Task(title="Plan review")
    db.add(task)
    db.add(
        SessionModel(
            start_time=from_local_naive(local_day.replace(hour=9), tz),
            end_time=from_local_naive(local_day.replace(hour=10), tz),
            duration_seconds=3600,
        )
    )
    db.commit()

    result = AIInsightsService(db).validate_schedule(
        [
            {
                "task_id": task.id,
                "start_time": _utc_from_local(local_day.replace(hour=11)).isoformat(),
                "end_time": _utc_from_local(local_day.replace(hour=11, minute=40)).isoformat(),
            }
        ]
    )
    assert result["valid"] is False
    assert any("daily limit" in error for error in result["errors"])
    assert result["daily_minutes"][local_day.date().isoformat()] == 100


def test_ai_settings_api_round_trips_scheduling_preferences(client):
    response = client.put(
        "/api/ai/settings",
        json={
            "scheduling_day_start": "08:30",
            "scheduling_day_end": "16:30",
            "minimum_break_minutes": 15,
            "maximum_daily_minutes": 360,
            "scheduling_days": ["monday", "wednesday"],
            "preferred_tags": ["deep-work"],
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["scheduling_day_start"] == "08:30"
    assert payload["minimum_break_minutes"] == 15
    assert payload["scheduling_days"] == ["monday", "wednesday"]
    assert payload["preferred_tags"] == ["deep-work"]

    fetched = client.get("/api/ai/settings")
    assert fetched.status_code == 200
    assert fetched.json()["maximum_daily_minutes"] == 360

    cleared = client.put("/api/ai/settings", json={"maximum_daily_minutes": None})
    assert cleared.status_code == 200
    assert cleared.json()["maximum_daily_minutes"] is None


def test_weekly_review_separates_logged_and_future_time_with_sql_stats(db):
    task = Task(title="Weekly report", tags="deep-work")
    db.add(task)
    db.flush()
    now = datetime.now(UTC).replace(microsecond=0)
    db.add(
        SessionModel(
            task_id=task.id,
            start_time=(now - timedelta(hours=2)).replace(tzinfo=None),
            end_time=(now - timedelta(hours=1)).replace(tzinfo=None),
            duration_seconds=3600,
        )
    )
    db.add(
        SessionModel(
            task_id=task.id,
            start_time=(now + timedelta(hours=1)).replace(tzinfo=None),
            end_time=(now + timedelta(hours=2)).replace(tzinfo=None),
            duration_seconds=3600,
        )
    )
    db.commit()

    review = AIInsightsService(db).get_weekly_review(now - timedelta(days=1), now + timedelta(days=1))
    logged_total = sum(row["value"] for row in review["logged_by_day"]["rows"])
    scheduled_total = sum(row["value"] for row in review["scheduled_by_day"]["rows"])
    assert logged_total == 1.0
    assert scheduled_total == 1.0
    assert review["session_count"]["rows"][0]["value"] == 1


def test_current_weekly_review_delegates_daemon_local_calendar_bounds(db, monkeypatch):
    service = AIInsightsService(db)
    tz = daemon_tzinfo()
    today = datetime.now(tz).date()
    first_day = 0  # Sunday, matching FullCalendar's browser setting.
    sqlite_weekday = (today.weekday() + 1) % 7
    expected_start_date = today - timedelta(days=(sqlite_weekday - first_day) % 7)
    expected_start = from_local_naive(datetime.combine(expected_start_date, datetime.min.time()), tz)
    expected_end = from_local_naive(datetime.combine(expected_start_date + timedelta(days=7), datetime.min.time()), tz)
    captured = {}

    def fake_review(start, end):
        captured["start"] = start
        captured["end"] = end
        return {"start": start, "end": end}

    monkeypatch.setattr(service, "get_weekly_review", fake_review)

    assert service.get_current_weekly_review(first_day) == {"start": expected_start, "end": expected_end}
    assert captured == {"start": expected_start, "end": expected_end}


def test_current_weekly_review_api_uses_local_week_and_supports_empty_data(client):
    tz = daemon_tzinfo()
    today = datetime.now(tz).date()
    sqlite_weekday = (today.weekday() + 1) % 7
    expected_start = today - timedelta(days=sqlite_weekday)

    response = client.get("/api/ai/insights/weekly-review/current", params={"firstDayOfWeek": 0})
    assert response.status_code == 200
    payload = response.json()
    assert payload["start_date"] == expected_start.isoformat()
    assert payload["end_date"] == (expected_start + timedelta(days=6)).isoformat()
    assert payload["timezone"] == str(tz)
    assert payload["logged_total"]["rows"] == [] or payload["logged_total"]["total"] in (0, None)
    assert payload["scheduled_total"]["rows"] == [] or payload["scheduled_total"]["total"] in (0, None)

    invalid = client.get("/api/ai/insights/weekly-review/current", params={"firstDayOfWeek": 7})
    assert invalid.status_code == 422


def test_preview_setting_can_disable_the_calendar_draft_overlay(db):
    AISettingsService(db).update_settings(preview_on_calendar=False)
    assert (
        AIChatService(db).get_draft_overlay(
            datetime(2026, 9, 10, tzinfo=UTC),
            datetime(2026, 9, 11, tzinfo=UTC),
        )
        == []
    )


def test_gateway_free_slots_subtract_pending_session_proposals(db, monkeypatch):
    tz = daemon_tzinfo()
    local_day = (datetime.now(tz).replace(tzinfo=None) + timedelta(days=2)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    batch = AIDraftBatch()
    db.add(batch)
    db.flush()
    db.add(
        AIDraftItem(
            batch_id=batch.id,
            position=0,
            op="create",
            entity_type="session",
            proposed_json=json.dumps(
                {
                    "start_time": _utc_from_local(local_day.replace(hour=11)).isoformat(),
                    "end_time": _utc_from_local(local_day.replace(hour=12)).isoformat(),
                }
            ),
        )
    )
    db.commit()
    monkeypatch.setattr(ai_tool_gateway, "engine", db.get_bind())

    slots = DbAIToolGateway(batch.id).find_free_slots(
        start=_utc_from_local(local_day.replace(hour=9)),
        end=_utc_from_local(local_day.replace(hour=17)),
        min_duration_minutes=30,
    )
    assert [(slot["duration_minutes"]) for slot in slots] == [120, 300]


def test_relative_session_time_filter_is_compiled_and_executed(db):
    now = datetime.now(UTC).replace(microsecond=0)
    old = SessionModel(
        start_time=(now - timedelta(hours=2)).replace(tzinfo=None),
        end_time=(now - timedelta(hours=1)).replace(tzinfo=None),
        duration_seconds=3600,
    )
    future = SessionModel(
        start_time=(now + timedelta(hours=1)).replace(tzinfo=None),
        end_time=(now + timedelta(hours=2)).replace(tzinfo=None),
        duration_seconds=3600,
    )
    db.add(old)
    db.add(future)
    db.commit()

    query = AnalyticsQuery(
        source=QuerySource.SESSIONS,
        measure=Measure.SESSION_COUNT,
        filters=[
            QueryFilter(
                field=FilterField.SESSION_TIME_RELATIVE,
                op=FilterOp.EQ,
                values=["future"],
            )
        ],
        date_range=DateRange(preset=RangePreset.ALL_TIME),
    )
    response = QueryService(db).run(query, QueryContextRequest())
    assert response.rows[0].value == 1
