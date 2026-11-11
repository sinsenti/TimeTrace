"""Custom date validation through the public query service and actual root ASGI app."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from timetrace.core.exceptions import ValidationError
from timetrace.core.query_spec import AnalyticsQuery, DateRange, Measure, QuerySource, RangePreset
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.services.query_service import QueryService
from timetrace.services.session_service import SessionService


@pytest.fixture
def recorded_sessions(db):
    db.add(
        SessionModel(
            start_time=datetime(2026, 4, 5, 12),
            end_time=datetime(2026, 4, 5, 13),
            duration_seconds=3600,
            notes="query date validation control",
        )
    )
    db.commit()
    return SessionService(db).list_sessions()


def custom_session_count(start_date, end_date):
    return AnalyticsQuery(
        source=QuerySource.SESSIONS,
        measure=Measure.SESSION_COUNT,
        date_range=DateRange(preset=RangePreset.CUSTOM, start_date=start_date, end_date=end_date),
    )


@pytest.mark.parametrize("invalid_bound", ["start_date", "end_date"])
def test_query_service_malformed_custom_date_raises_domain_validation(db, recorded_sessions, invalid_bound):
    bounds = {"start_date": "2026-04-01", "end_date": "2026-04-30", invalid_bound: "not-a-date"}
    query = custom_session_count(**bounds)

    try:
        with pytest.raises(ValidationError):
            QueryService(db).run(query, QueryContextRequest())
    finally:
        assert SessionService(db).list_sessions() == recorded_sessions


@pytest.mark.parametrize("invalid_bound", ["start_date", "end_date"])
def test_analytics_query_malformed_custom_date_returns_400(client, db, recorded_sessions, invalid_bound):
    bounds = {"start_date": "2026-04-01", "end_date": "2026-04-30", invalid_bound: "not-a-date"}
    query = custom_session_count(**bounds)
    # Retain the existing real-root app and DB override, without entering its lifespan.
    http = TestClient(client.app, raise_server_exceptions=False)

    try:
        response = http.post("/analytics/query", json={"query": query.model_dump(mode="json")})
        assert response.status_code == 400, f"{response.status_code}: {response.text}"
        assert isinstance(response.json()["detail"], str)
        assert response.json()["detail"]
    finally:
        assert SessionService(db).list_sessions() == recorded_sessions


# The current date.fromisoformat path accepts all three ISO spellings; do not impose
# a stricter calendar-date-only policy while diagnosing malformed input.
VALID_CUSTOM_RANGES = [
    pytest.param("2026-04-01", "2026-04-30", id="calendar-iso"),
    pytest.param("20260401", "20260430", id="basic-iso"),
    pytest.param("2026-W14-3", "2026-W18-4", id="week-iso"),
]


@pytest.mark.parametrize(("start_date", "end_date"), VALID_CUSTOM_RANGES)
def test_query_service_supported_custom_dates_remain_valid(db, recorded_sessions, start_date, end_date):
    result = QueryService(db).run(custom_session_count(start_date, end_date), QueryContextRequest(first_day_of_week=0))

    assert result.total == 1
    assert result.row_count == 1
    assert result.meta.first_day_of_week == 0
    assert SessionService(db).list_sessions() == recorded_sessions


@pytest.mark.parametrize(("start_date", "end_date"), VALID_CUSTOM_RANGES)
def test_analytics_query_supported_custom_dates_remain_valid(client, db, recorded_sessions, start_date, end_date):
    query = custom_session_count(start_date, end_date)
    response = client.post("/analytics/query", json={"query": query.model_dump(mode="json"), "first_day_of_week": 0})

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["total"] == 1
    assert result["row_count"] == 1
    assert result["meta"]["first_day_of_week"] == 0
    assert SessionService(db).list_sessions() == recorded_sessions
