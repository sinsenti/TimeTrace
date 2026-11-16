"""Ticket 12 compatibility at existing capabilities/query/widget API seams (real compiler/SQL)."""

import time
from datetime import datetime, timedelta

import pytest

from timetrace.core import timezones
from timetrace.db.models import Session as SessionModel
from timetrace.db.models import Task


@pytest.fixture
def new_york_zone(monkeypatch):
    try:
        with monkeypatch.context() as patch:
            patch.setenv("TZ", "America/New_York")
            time.tzset()
            timezones._reset_caches()
            yield
    finally:
        time.tzset()
        timezones._reset_caches()


def save_reopen(client, query):
    dashboard = client.post("/api/dashboards", json={"name": "Builder API fixture"}).json()
    created = client.post(
        f"/api/dashboards/{dashboard['id']}/widgets",
        json={"title": "Custom <literal> title", "width": "full", "spec": {"mode": "structured", "query": query}},
    )
    assert created.status_code == 201, created.text
    saved = created.json()
    reopened = client.get(f"/api/dashboards/{dashboard['id']}").json()["widgets"][0]
    assert reopened == saved
    updated = client.put(
        f"/api/dashboards/{dashboard['id']}/widgets/{saved['id']}",
        json={"title": "Explicit title edit", "spec": reopened["spec"]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["spec"] == reopened["spec"]
    return reopened


@pytest.mark.parametrize("source", ["sessions", "tasks", "habit_logs", "day_reviews", "rating_entries"])
def test_published_source_measures_and_dimensions_roundtrip_through_widget_api(client, source):
    capabilities = client.get("/analytics/capabilities").json()
    capability = next(item for item in capabilities["sources"] if item["source"] == source)
    for measure in capability["measures"]:
        query = {"source": source, "measure": measure["value"], "chart": "tile", "sort": "value_asc", "limit": 37}
        result = client.post("/analytics/query", json={"query": query})
        assert result.status_code == 200, result.text
        assert save_reopen(client, query)["spec"]["query"]["limit"] == 37
    for dimension in capability["dimensions"]:
        query = {
            "source": source,
            "measure": capability["measures"][0]["value"],
            "group_by": [dimension["value"]],
            "chart": "stacked_bar",
            "sort": "dimension_desc",
        }
        result = client.post("/analytics/query", json={"query": query})
        assert result.status_code == 200, result.text
        assert save_reopen(client, query)["spec"]["query"]["group_by"] == [dimension["value"]]


@pytest.mark.parametrize(
    ("field", "op", "values", "expected"),
    [
        ("duration_seconds", "eq", [1200], 1),
        ("duration_seconds", "neq", [1200], 2),
        ("duration_seconds", "gt", [1200], 1),
        ("duration_seconds", "gte", [1200], 2),
        ("duration_seconds", "lt", [1200], 1),
        ("duration_seconds", "lte", [1200], 2),
        ("duration_seconds", "in", [600, 1800], 2),
        ("duration_seconds", "not_in", [600, 1800], 1),
        ("notes", "contains", ["needle"], 1),
        ("task", "is_null", [], 3),
        ("task", "is_not_null", [], 0),
    ],
)
def test_filter_operators_and_typed_values_survive_query_save_reopen(client, db, field, op, values, expected):
    for minutes, notes in [(10, "needle"), (20, "other"), (30, "other")]:
        start = datetime(2024, 2, 29, 12)
        db.add(
            SessionModel(
                start_time=start,
                end_time=start + timedelta(minutes=minutes),
                duration_seconds=minutes * 60,
                notes=notes,
            )
        )
    db.commit()
    query = {
        "source": "sessions",
        "measure": "session_count",
        "chart": "tile",
        "filters": [
            {"field": field, "op": op, "values": values},
            {"field": "has_task", "op": "eq", "values": [False]},
            {"field": "session_time_relative", "op": "in", "values": ["past"]},
        ],
    }
    result = client.post("/analytics/query", json={"query": query})
    assert result.status_code == 200, result.text
    assert result.json()["total"] == expected
    assert save_reopen(client, query)["spec"]["query"]["filters"] == query["filters"]


@pytest.mark.parametrize(
    ("start", "end", "mode", "baseline", "expected_start", "expected_end"),
    [
        ("2024-03-10", "2024-03-10", "previous_period", "2024-03-09", "2024-03-10T05:00:00", "2024-03-11T04:00:00"),
        (
            "2024-02-29",
            "2024-02-29",
            "same_period_last_year",
            "2023-02-28",
            "2024-02-29T05:00:00",
            "2024-03-01T05:00:00",
        ),
        ("2024-11-03", "2024-11-03", "custom", "2024-03-10", "2024-11-03T04:00:00", "2024-11-04T05:00:00"),
    ],
)
def test_local_comparison_boundaries_and_fallback_metadata_roundtrip(
    client, new_york_zone, start, end, mode, baseline, expected_start, expected_end
):
    comparison = {"mode": mode}
    if mode == "custom":
        comparison.update(start_date=baseline, end_date=baseline)
    query = {
        "source": "sessions",
        "measure": "session_count",
        "group_by": ["day"],
        "date_range": {"preset": "custom", "start_date": start, "end_date": end},
        "chart": "line",
        "sort": "dimension_asc",
        "fill_gaps": True,
        "comparison": comparison,
    }
    response = client.post(
        "/analytics/query", json={"timezone": "Europe/Warsaw", "first_day_of_week": 0, "query": query}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["meta"]["range_start_utc"] == expected_start
    assert result["meta"]["range_end_utc"] == expected_end
    assert result["meta"]["timezone"] == "America/New_York"
    assert result["meta"]["first_day_of_week"] == 0
    assert any("Requested timezone" in warning for warning in result["meta"]["warnings"])
    assert baseline in result["comparison"]["label"]
    assert result["comparison"]["alignment"] == "positional"
    assert result["rows"][0]["comparison_value"] == 0
    assert save_reopen(client, query)["spec"]["query"]["comparison"]["mode"] == mode


@pytest.mark.parametrize(("first_day", "keys"), [(0, ["2024-03-10"]), (1, ["2024-03-04", "2024-03-11"])])
def test_custom_week_buckets_use_explicit_week_start(client, new_york_zone, first_day, keys):
    query = {
        "source": "sessions",
        "measure": "session_count",
        "group_by": ["week"],
        "sort": "dimension_asc",
        "fill_gaps": True,
        "date_range": {"preset": "custom", "start_date": "2024-03-10", "end_date": "2024-03-11"},
    }
    result = client.post(
        "/analytics/query", json={"timezone": "America/New_York", "first_day_of_week": first_day, "query": query}
    )
    assert result.status_code == 200, result.text
    assert [row["keys"][0] for row in result.json()["rows"]] == keys


def test_fanout_overlap_split_evenly_and_invalid_save_preserve_existing_widget(client, db):
    start = datetime(2024, 2, 29, 12)
    db.add(SessionModel(start_time=start, end_time=start + timedelta(hours=1), duration_seconds=3600, tags="#one #two"))
    db.commit()
    query = {"source": "sessions", "measure": "sum_duration", "group_by": ["tag"], "chart": "doughnut"}
    fanout = client.post("/analytics/query", json={"query": query}).json()
    split = client.post("/analytics/query", json={"query": {**query, "tag_attribution": "split_evenly"}}).json()
    assert sorted(row["value"] for row in fanout["rows"]) == [1, 1]
    assert fanout["meta"]["totals_overlap"] is True
    assert sorted(row["value"] for row in split["rows"]) == [0.5, 0.5]
    assert split["meta"]["totals_overlap"] is False
    saved = save_reopen(client, query)
    path = f"/api/dashboards/{saved['dashboard_id']}/widgets/{saved['id']}"
    invalid = client.put(path, json={"spec": {"mode": "structured", "query": {**query, "group_by": ["tag", "tag"]}}})
    assert invalid.status_code == 400
    assert "distinct" in invalid.json()["detail"]
    reopened = client.get(f"/api/dashboards/{saved['dashboard_id']}").json()["widgets"][0]
    assert reopened["spec"] == saved["spec"]


@pytest.mark.parametrize("dimension", ["task", "category", "status", "priority"])
@pytest.mark.parametrize("tag_group", ["none", "first", "last"])
@pytest.mark.parametrize("attribution, expected", [("fan_out", 1), ("split_evenly", 0.5)])
def test_tag_attribution_non_time_dimensions_compile_and_roundtrip(
    client, db, dimension, tag_group, attribution, expected
):
    task = Task(title="Tag dimension fixture", category="work", status="To Do", priority="high")
    db.add(task)
    db.flush()
    start = datetime(2024, 2, 29, 12)
    db.add(
        SessionModel(
            task_id=task.id,
            start_time=start,
            end_time=start + timedelta(hours=1),
            duration_seconds=3600,
            tags="#one #two",
        )
    )
    db.commit()
    query = {
        "source": "sessions",
        "measure": "sum_duration",
        "chart": "stacked_bar",
        "sort": "dimension_asc",
        "group_by": ["tag", dimension]
        if tag_group == "first"
        else [dimension, "tag"]
        if tag_group == "last"
        else [dimension],
        "filters": [{"field": "tag", "op": "eq", "values": ["#one"]}],
        "tag_attribution": attribution,
    }
    response = client.post("/analytics/query", json={"query": query})
    assert response.status_code == 200, response.text
    result = response.json()
    expected_key = {"task": task.id, "category": "work", "status": "To Do", "priority": "high"}[dimension]
    expected_keys = (
        ["#one", expected_key]
        if tag_group == "first"
        else [expected_key, "#one"]
        if tag_group == "last"
        else [expected_key]
    )
    assert result["rows"][0]["keys"] == expected_keys
    assert result["rows"][0]["value"] == expected
    assert save_reopen(client, query)["spec"]["query"]["group_by"] == query["group_by"]


@pytest.mark.parametrize("dimension", ["category", "status", "priority"])
@pytest.mark.parametrize("bucket_first", [False, True])
def test_estimation_bucket_non_time_dimensions_use_projected_columns(client, db, dimension, bucket_first):
    task = Task(
        title="Estimation dimension fixture", category="work", status="To Do", priority="high", estimated_minutes=60
    )
    db.add(task)
    db.flush()
    start = datetime(2024, 2, 29, 12)
    db.add(SessionModel(task_id=task.id, start_time=start, end_time=start + timedelta(hours=1), duration_seconds=3600))
    db.commit()
    query = {
        "source": "tasks",
        "measure": "task_count",
        "chart": "stacked_bar",
        "group_by": ["estimation_bucket", dimension] if bucket_first else [dimension, "estimation_bucket"],
        "sort": "dimension_asc",
    }
    response = client.post("/analytics/query", json={"query": query})
    assert response.status_code == 200, response.text
    expected = {"category": "work", "status": "To Do", "priority": "high"}[dimension]
    assert response.json()["rows"][0]["keys"] == (["accurate", expected] if bucket_first else [expected, "accurate"])
    assert response.json()["rows"][0]["value"] == 1
    assert save_reopen(client, query)["spec"]["query"]["group_by"] == query["group_by"]


@pytest.mark.parametrize("attribution, primary, baseline", [("fan_out", 1, 2), ("split_evenly", 0.5, 1)])
def test_tag_task_typed_filters_custom_baseline_returns_real_values(client, db, attribution, primary, baseline):
    task = Task(title="Original native alias reproduction")
    db.add(task)
    db.flush()
    for start, hours in [(datetime(2024, 2, 29, 12), 1), (datetime(2023, 2, 28, 12), 2)]:
        db.add(
            SessionModel(
                task_id=task.id,
                start_time=start,
                end_time=start + timedelta(hours=hours),
                duration_seconds=hours * 3600,
                tags="#one #two",
            )
        )
    db.commit()
    query = {
        "source": "sessions",
        "measure": "sum_duration",
        "group_by": ["tag", "task"],
        "chart": "stacked_bar",
        "filters": [
            {"field": "task", "op": "in", "values": [task.id, "00123"]},
            {"field": "duration_seconds", "op": "gte", "values": [60]},
        ],
        "date_range": {"preset": "custom", "start_date": "2024-02-28", "end_date": "2024-02-29"},
        "comparison": {"mode": "custom", "start_date": "2023-02-27", "end_date": "2023-02-28"},
        "sort": "dimension_desc",
        "tag_attribution": attribution,
    }
    response = client.post("/analytics/query", json={"query": query})
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert {tuple(row["keys"]) for row in rows} == {("#one", task.id), ("#two", task.id)}
    assert [(row["value"], row["comparison_value"], row["delta"]) for row in rows] == [
        (primary, baseline, primary - baseline)
    ] * 2
    assert save_reopen(client, query)["spec"]["query"]["filters"] == query["filters"]


@pytest.mark.parametrize("dimension", ["task", "day"])
@pytest.mark.parametrize("attribution, expected", [("fan_out", 1), ("split_evenly", 0.5)])
def test_tag_null_task_and_time_dimensions_keep_attribution(client, db, dimension, attribution, expected):
    start = datetime(2024, 2, 29, 12)
    db.add(SessionModel(start_time=start, end_time=start + timedelta(hours=1), duration_seconds=3600, tags="#one #two"))
    db.commit()
    query = {
        "source": "sessions",
        "measure": "sum_duration",
        "group_by": [dimension, "tag"],
        "tag_attribution": attribution,
    }
    response = client.post("/analytics/query", json={"query": query})
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert {tuple(row["keys"]) for row in rows} == {
        ("" if dimension == "task" else "2024-02-29", tag) for tag in ["#one", "#two"]
    }
    assert [row["value"] for row in rows] == [expected, expected]
