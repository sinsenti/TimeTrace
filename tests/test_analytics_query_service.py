from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

import timetrace.services.query_service as query_service_module
from timetrace.core.query_spec import (
    AnalyticsQuery,
    DateRange,
    Dimension,
    Measure,
    QuerySource,
    RangePreset,
    SortKey,
    TagAttribution,
)
from timetrace.db.models import DayReview
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.services.query_service import QueryService


@pytest.fixture
def utc_query_context(monkeypatch):
    monkeypatch.setattr(
        query_service_module,
        "_resolve_timezone",
        lambda _requested, _warnings: (ZoneInfo("UTC"), "UTC"),
    )
    monkeypatch.setattr(query_service_module, "_check_localtime_support", lambda _db: True)


def test_custom_session_range_includes_start_and_excludes_end(db, utc_query_context):
    for start_time in (
        datetime(2026, 4, 5, 0, 0),
        datetime(2026, 4, 6, 23, 59, 59),
        datetime(2026, 4, 7, 0, 0),
    ):
        db.add(
            SessionModel(
                start_time=start_time,
                end_time=start_time + timedelta(minutes=1),
                duration_seconds=60,
            )
        )
    db.commit()

    query = AnalyticsQuery(
        source=QuerySource.SESSIONS,
        measure=Measure.SESSION_COUNT,
        date_range=DateRange(preset=RangePreset.CUSTOM, start_date="2026-04-05", end_date="2026-04-06"),
    )
    result = QueryService(db).run(query, QueryContextRequest(timezone="UTC"))

    assert result.total == 2


def test_tag_attribution_fan_out_and_split_evenly(db, utc_query_context):
    start_time = datetime(2026, 4, 5, 12, 0)
    db.add(
        SessionModel(
            start_time=start_time,
            end_time=start_time + timedelta(hours=1),
            duration_seconds=3600,
            tags="#alpha #beta",
        )
    )
    db.commit()

    fan_out_query = AnalyticsQuery(
        source=QuerySource.SESSIONS,
        measure=Measure.SUM_DURATION,
        group_by=[Dimension.TAG],
        sort=SortKey.DIMENSION_ASC,
    )
    service = QueryService(db)
    fan_out = service.run(fan_out_query, QueryContextRequest(timezone="UTC"))
    split_evenly = service.run(
        fan_out_query.model_copy(update={"tag_attribution": TagAttribution.SPLIT_EVENLY}),
        QueryContextRequest(timezone="UTC"),
    )

    assert {row.keys[0]: row.value for row in fan_out.rows} == {"#alpha": 1.0, "#beta": 1.0}
    assert fan_out.meta.totals_overlap is True
    assert {row.keys[0]: row.value for row in split_evenly.rows} == {"#alpha": 0.5, "#beta": 0.5}
    assert split_evenly.meta.totals_overlap is False


def test_week_grouping_respects_requested_first_day_of_week(db, utc_query_context):
    db.add_all(
        [
            DayReview(date_str="2026-04-05", rating=3),  # Sunday
            DayReview(date_str="2026-04-06", rating=5),  # Monday
        ]
    )
    db.commit()
    query = AnalyticsQuery(
        source=QuerySource.DAY_REVIEWS,
        measure=Measure.AVG_RATING,
        group_by=[Dimension.WEEK],
        date_range=DateRange(preset=RangePreset.CUSTOM, start_date="2026-04-05", end_date="2026-04-06"),
        sort=SortKey.DIMENSION_ASC,
        fill_gaps=True,
    )
    service = QueryService(db)

    monday_start = service.run(
        query,
        QueryContextRequest(timezone="UTC", first_day_of_week=1),
    )
    sunday_start = service.run(
        query,
        QueryContextRequest(timezone="UTC", first_day_of_week=0),
    )

    assert [(row.keys, row.value) for row in monday_start.rows] == [(["2026-03-30"], 3.0), (["2026-04-06"], 5.0)]
    assert [(row.keys, row.value) for row in sunday_start.rows] == [(["2026-04-05"], 4.0)]
