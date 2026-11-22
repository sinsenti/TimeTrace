"""Agenda #9 public editable-query behavior, using synthetic records only."""

import pytest


def test_recorded_widget_groups_by_start_day_and_category_without_summing_groups(client, monkeypatch):
    import timetrace.core.timezones as zones

    monkeypatch.setenv("TZ", "UTC")
    zones._reset_caches()
    task = client.post("/api/tasks", json={"title": "Writing", "category": "Focus"}).json()["id"]
    for start, end in [
        ("2000-01-04T23:30:00Z", "2000-01-05T00:30:00Z"),
        ("2000-01-05T00:00:00Z", "2000-01-05T01:00:00Z"),
    ]:
        response = client.post("/recorded-work", json={"task_id": task, "start_time": start, "end_time": end})
        assert response.status_code == 201, response.text
    response = client.post(
        "/analytics/query",
        json={
            "query": {
                "source": "recorded_work",
                "measure": "recorded_task_time",
                "group_by": ["day", "category"],
                "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-05"},
                "sort": "dimension_asc",
            },
            "timezone": "UTC",
            "first_day_of_week": 1,
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert [row["value"] for row in result["rows"]] == [1, 1]
    assert result["total"] == 1.5
    assert result["meta"]["totals_overlap"] is True


def test_recorded_filters_inspect_raw_records_not_derived_unions(client):
    task = client.post("/api/tasks", json={"title": "Filter", "category": "Focus"}).json()["id"]
    for start, end, notes in [("09:00", "10:00", "keep"), ("09:30", "10:30", "other")]:
        assert (
            client.post(
                "/recorded-work",
                json={
                    "task_id": task,
                    "start_time": f"2000-01-04T{start}:00Z",
                    "end_time": f"2000-01-04T{end}:00Z",
                    "notes": notes,
                },
            ).status_code
            == 201
        )
    response = client.post(
        "/analytics/query",
        json={
            "query": {
                "source": "recorded_work",
                "measure": "recorded_task_time",
                "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
                "filters": [
                    {"field": "notes", "op": "contains", "values": ["keep"]},
                    {"field": "category", "op": "eq", "values": ["Focus"]},
                    {"field": "provenance", "op": "eq", "values": ["manual"]},
                ],
            }
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1


def test_split_tags_allocate_before_filter_and_keep_physical_cohort(client):
    task = client.post("/api/tasks", json={"title": "Tags"}).json()["id"]
    assert (
        client.post(
            "/recorded-work",
            json={
                "task_id": task,
                "start_time": "2000-01-04T09:00:00Z",
                "end_time": "2000-01-04T10:00:00Z",
                "tags": "#a #b #a",
            },
        ).status_code
        == 201
    )
    response = client.post(
        "/analytics/query",
        json={
            "query": {
                "source": "recorded_work",
                "measure": "recorded_task_time",
                "tag_attribution": "split_evenly",
                "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
                "filters": [{"field": "tag", "op": "eq", "values": ["#a"]}],
            }
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["total"] == 0.5
    assert result["meta"]["attributed_total_seconds"] == 1800
    assert result["meta"]["physical_cohort_seconds"] == 3600
    assert result["meta"]["cohort_count"] == 1


@pytest.mark.parametrize(
    "same_task,measure,expected",
    [
        (True, "recorded_task_time", 0.5),
        (False, "recorded_task_time", 1),
        (True, "elapsed_recorded_time", 0.5),
        (False, "elapsed_recorded_time", 0.5),
    ],
)
def test_atomic_tag_domains_preserve_task_credit_and_elapsed_union(client, same_task, measure, expected):
    a, b = [client.post("/api/tasks", json={"title": title}).json()["id"] for title in ("A", "B")]
    for task, tag in [(a, "#a"), (a if same_task else b, "#b")]:
        assert (
            client.post(
                "/recorded-work",
                json={
                    "task_id": task,
                    "tags": tag,
                    "start_time": "2000-01-04T09:00:00Z",
                    "end_time": "2000-01-04T10:00:00Z",
                },
            ).status_code
            == 201
        )
    query = {
        "source": "recorded_work",
        "measure": measure,
        "tag_attribution": "split_evenly",
        "group_by": ["tag"],
        "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
    }
    response = client.post("/analytics/query", json={"query": query})
    assert response.status_code == 200, response.text
    assert sorted(row["value"] for row in response.json()["rows"]) == [expected, expected]
    assert response.json()["total"] == expected * 2
    query["filters"] = [{"field": "tag", "op": "eq", "values": ["#a"]}]
    filtered = client.post("/analytics/query", json={"query": query})
    assert filtered.status_code == 200, filtered.text
    assert filtered.json()["total"] == expected
    assert filtered.json()["meta"]["physical_cohort_seconds"] == 3600
