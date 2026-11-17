"""Comparison source identities survive presentation-key collisions at the analytics HTTP seam."""

from datetime import UTC, datetime, timedelta

import pytest

from timetrace.db.models import DayReview, Task
from timetrace.db.models import Session as SessionModel


def seed_category_periods(db, primary, baseline):
    tasks = {}
    for category, _hours in primary + baseline:
        if category is not None and category not in tasks:
            task = Task(title=f"Category {category!r}", category=category)
            db.add(task)
            db.flush()
            tasks[category] = task.id
    for day, groups in [(15, primary), (14, baseline)]:
        # Local noon keeps both the date filter and hour grouping independent of the host zone.
        start = datetime(2026, 4, day, 12).astimezone(UTC).replace(tzinfo=None)
        for category, hours in groups:
            db.add(
                SessionModel(
                    task_id=tasks.get(category),
                    start_time=start,
                    end_time=start + timedelta(hours=hours),
                    duration_seconds=hours * 3600,
                )
            )
    db.commit()


def category_comparison(client, group_by=None, **changes):
    response = client.post(
        "/analytics/query",
        json={
            "query": {
                "source": "sessions",
                "measure": "sum_duration",
                "group_by": ["category"] if group_by is None else group_by,
                "sort": "value_asc",
                "fill_gaps": False,
                "date_range": {"preset": "custom", "start_date": "2026-04-15", "end_date": "2026-04-15"},
                "comparison": {"mode": "custom", "start_date": "2026-04-14", "end_date": "2026-04-14"},
                **changes,
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    ("group_by", "keys", "labels"),
    [
        (["category"], [""], [""]),
        (["hour_of_day", "category"], ["12", ""], ["12:00", ""]),
        (["category", "hour_of_day"], ["", "12"], ["", "12:00"]),
    ],
)
def test_null_and_empty_category_receive_their_own_comparison_baselines(client, db, group_by, keys, labels):
    seed_category_periods(db, [(None, 1), ("", 2)], [(None, 3), ("", 5)])

    result = category_comparison(client, group_by)

    assert result["row_count"] == 2
    rows = result["rows"]
    assert [row["keys"] for row in rows] == [keys, keys]
    assert [row["labels"] for row in rows] == [labels, labels]
    assert [row["value"] for row in rows] == [1, 2]
    assert [row["count"] for row in rows] == [1, 1]
    assert [row["comparison_value"] for row in rows] == [3, 5]
    assert [row["delta"] for row in rows] == [-2, -3]
    assert [row["delta_pct"] for row in rows] == pytest.approx([-66.6666667, -60])
    assert result["comparison"]["alignment"] == "by_key"
    assert result["comparison"]["dropped_keys"] == 0
    assert sum(row["comparison_value"] is None for row in rows) == 0
    assert set(result) == {"columns", "rows", "total", "row_count", "meta", "comparison_total", "comparison"}
    assert all(
        set(row) == {"keys", "labels", "value", "count", "comparison_value", "delta", "delta_pct"} for row in rows
    )


@pytest.mark.parametrize(("primary", "baseline", "value"), [(None, "", 1), ("", None, 2)])
def test_missing_null_or_empty_category_counterpart_stays_unmatched(client, db, primary, baseline, value):
    seed_category_periods(db, [(primary, value)], [(baseline, 5)])

    result = category_comparison(client)

    assert result["row_count"] == 1
    row = result["rows"][0]
    assert row["keys"] == row["labels"] == [""]
    assert row["value"] == value
    assert row["count"] == 1
    assert row["comparison_value"] is None
    assert row["delta"] is None
    assert row["delta_pct"] is None
    assert sum(row["comparison_value"] is None for row in result["rows"]) == 1
    assert result["comparison"]["dropped_keys"] == 1


def test_baseline_only_null_and_empty_categories_count_as_two_dropped_groups(client, db):
    seed_category_periods(db, [("work", 7)], [(None, 3), ("", 5), ("work", 2)])

    result = category_comparison(client)

    assert result["row_count"] == 1
    assert result["rows"] == [
        {
            "keys": ["work"],
            "labels": ["work"],
            "value": 7,
            "count": 1,
            "comparison_value": 2,
            "delta": 5,
            "delta_pct": 250,
        }
    ]
    assert result["comparison"]["dropped_keys"] == 2


def test_colliding_category_baselines_match_source_identity_not_value_order(client, db):
    seed_category_periods(db, [(None, 1), ("", 2)], [(None, 5), ("", 3)])

    result = category_comparison(client)

    assert [row["value"] for row in result["rows"]] == [1, 2]
    assert [row["comparison_value"] for row in result["rows"]] == [5, 3]
    assert [row["delta"] for row in result["rows"]] == [-4, -1]
    assert [row["delta_pct"] for row in result["rows"]] == pytest.approx([-80, -33.3333333])
    assert result["comparison"]["dropped_keys"] == 0


def test_independent_period_limits_do_not_match_other_colliding_category(client, db):
    seed_category_periods(db, [(None, 1), ("", 2)], [(None, 5), ("", 3)])

    result = category_comparison(client, limit=1)

    assert result["meta"]["truncated"] is True
    assert result["row_count"] == 1
    assert result["rows"][0] == {
        "keys": [""],
        "labels": [""],
        "value": 1,
        "count": 1,
        "comparison_value": None,
        "delta": None,
        "delta_pct": None,
    }
    assert result["comparison"]["dropped_keys"] == 1


@pytest.mark.parametrize("dimension", ["hour_of_day", "weekday"])
@pytest.mark.parametrize("primary_only", [True, False])
@pytest.mark.parametrize("measure", ["sum_duration", "avg_session_length"])
def test_filled_time_buckets_match_real_integer_buckets_in_either_period(client, db, dimension, primary_only, measure):
    seed_category_periods(db, [(None, 1)] if primary_only else [], [] if primary_only else [(None, 3)])

    result = category_comparison(client, [dimension], fill_gaps=True, sort="dimension_asc", measure=measure)

    assert result["row_count"] == (24 if dimension == "hour_of_day" else 7)
    key = "12" if dimension == "hour_of_day" else ("3" if primary_only else "2")
    row = next(row for row in result["rows"] if row["keys"] == [key])
    assert row["count"] == (1 if primary_only else 0)
    assert result["comparison"]["alignment"] == "by_key"
    assert result["comparison"]["dropped_keys"] == 0
    if measure == "sum_duration":
        assert row["value"] == (1 if primary_only else 0)
        assert row["comparison_value"] == (0 if primary_only else 3)
        assert row["delta"] == (1 if primary_only else -3)
        assert row["delta_pct"] == (None if primary_only else -100)
        assert all(row["comparison_value"] is not None for row in result["rows"])
    else:
        # Average session length is in minutes, unlike sum_duration's hours.
        assert row["value"] == (60 if primary_only else None)
        assert row["comparison_value"] == (None if primary_only else 180)
        assert row["delta"] is None
        assert row["delta_pct"] is None


@pytest.mark.parametrize(("group_by", "alignment"), [([], "scalar"), (["day"], "positional")])
def test_scalar_and_calendar_comparisons_keep_aggregate_totals(client, db, group_by, alignment):
    seed_category_periods(db, [(None, 1), ("", 2)], [(None, 3), ("", 5)])

    result = category_comparison(client, group_by, sort="dimension_asc", fill_gaps=bool(group_by))

    assert result["row_count"] == 1
    row = result["rows"][0]
    assert row["value"] == 3
    assert row["count"] == 2
    assert row["comparison_value"] == 8
    assert row["delta"] == -5
    assert row["delta_pct"] == -62.5
    assert result["comparison"]["alignment"] == alignment
    assert result["comparison"]["dropped_keys"] == 0
    assert result["comparison_total"] == (8 if alignment == "scalar" else None)


@pytest.mark.parametrize("missing", [False, True])
def test_noncolliding_category_comparison_keeps_keyed_matching(client, db, missing):
    seed_category_periods(db, [("work", 1), ("study", 2)], [("other" if missing else "work", 5), ("study", 3)])

    result = category_comparison(client)

    assert [row["keys"] for row in result["rows"]] == [["work"], ["study"]]
    assert [row["comparison_value"] for row in result["rows"]] == [None if missing else 5, 3]
    assert [row["delta"] for row in result["rows"]] == [None if missing else -4, -1]
    assert result["rows"][0]["delta_pct"] == (None if missing else -80)
    assert result["rows"][1]["delta_pct"] == pytest.approx(-33.3333333)
    assert result["comparison"]["dropped_keys"] == (1 if missing else 0)


@pytest.mark.parametrize(
    ("source", "measure", "primary", "baseline", "delta"),
    [("tasks", "completion_rate", 50, 100, -50), ("day_reviews", "avg_rating", 2, 4, -2)],
)
def test_keyed_percentage_and_score_comparisons_use_points_not_percent_change(
    client, db, source, measure, primary, baseline, delta
):
    if source == "tasks":
        for day, statuses in [(15, ["done", "To Do"]), (8, ["done"])]:
            start = datetime(2026, 4, day, 12).astimezone(UTC).replace(tzinfo=None)
            db.add_all([Task(title=status, status=status, created_at=start) for status in statuses])
    else:
        db.add_all([DayReview(date_str="2026-04-15", rating=2), DayReview(date_str="2026-04-08", rating=4)])
    db.commit()

    result = category_comparison(
        client,
        ["weekday"],
        source=source,
        measure=measure,
        comparison={"mode": "custom", "start_date": "2026-04-08", "end_date": "2026-04-08"},
    )

    assert result["row_count"] == 1
    row = result["rows"][0]
    assert row["keys"] == ["3"]
    assert row["value"] == primary
    assert row["comparison_value"] == baseline
    assert row["delta"] == delta
    assert row["delta_pct"] is None
    assert result["comparison"]["alignment"] == "by_key"
    assert result["comparison"]["dropped_keys"] == 0
