"""Half-open interval arithmetic, independent worked-example oracle for SQL."""

from timetrace.core.intervals import difference, envelope, intersection, union


def test_nested_touching_union_intersection_difference_and_envelope():
    assert union([(0, 100), (10, 20), (90, 110), (110, 120)]) == [(0, 120)]
    assert intersection([(0, 60), (30, 90)], [(15, 45), (40, 75)]) == [(15, 75)]
    assert intersection([(0, 60)], [(60, 90)]) == []
    assert difference([(0, 90)], [(15, 30), (45, 60)]) == [(0, 15), (30, 45), (60, 90)]
    assert envelope([(10, 30), (50, 70)]) == (10, 70)
    assert envelope([]) is None


def test_recorded_work_compiler_accepts_bounded_utc_context_without_presentation_dates():
    from datetime import datetime

    from timetrace.core.query_compiler import QueryContext, compile_query
    from timetrace.core.query_spec import AnalyticsQuery

    query = AnalyticsQuery(source="recorded_work", measure="elapsed_recorded_time")
    compiled = compile_query(
        query,
        QueryContext(
            timezone="UTC",
            first_day_of_week=1,
            range_start_utc=datetime(2000, 1, 4),
            range_end_utc=datetime(2000, 1, 5),
            now_utc=datetime(2001, 1, 1),
        ),
    )
    # Text execution must retain SQLite's six fractional digits at exact-second boundaries.
    assert compiled.params["start"] == "2000-01-04 00:00:00.000000"
