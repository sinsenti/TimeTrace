"""Agenda #9 public editable-query behavior, using synthetic records only."""

import pytest


@pytest.fixture(autouse=True)
def restore_daemon_zone(monkeypatch):
    yield
    import time

    import timetrace.core.timezones as zones

    monkeypatch.undo()
    time.tzset()
    zones._reset_caches()


def test_recorded_week_start_and_daemon_timezone_fallback_are_explicit(client, monkeypatch):
    import time

    import timetrace.core.timezones as zones

    with monkeypatch.context() as patch:
        patch.setenv("TZ", "UTC")
        time.tzset()
        zones._reset_caches()
        try:
            assert (
                client.post(
                    "/recorded-work",
                    json={
                        "start_time": "2000-01-04T23:30:00Z",
                        "end_time": "2000-01-05T00:30:00Z",
                    },
                ).status_code
                == 201
            )
            for week_start, expected in [(1, "2000-01-03"), (0, "2000-01-02")]:
                response = client.post(
                    "/analytics/query",
                    json={
                        "timezone": "America/New_York",
                        "first_day_of_week": week_start,
                        "query": {
                            "source": "recorded_work",
                            "measure": "elapsed_recorded_time",
                            "group_by": ["week"],
                            "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
                        },
                    },
                )
                assert response.status_code == 200, response.text
                result = response.json()
                assert result["total"] == 1
                assert result["rows"][0]["keys"] == [expected]
                assert result["meta"]["timezone"] == "UTC"
                assert result["meta"]["first_day_of_week"] == week_start
                assert result["meta"]["warnings"]
        finally:
            patch.undo()
            time.tzset()
            zones._reset_caches()


def test_advertised_measure_dimension_matrix_executes_through_public_query(client):
    from itertools import combinations

    task = client.post("/api/tasks", json={"title": "Matrix", "category": "Focus"}).json()["id"]
    interval = {"start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"}
    plan = client.post("/scheduled-sessions", json={**interval, "task_id": task}).json()["id"]
    for task_id in (task, None):
        assert client.post("/recorded-work", json={**interval, "task_id": task_id, "tags": "#a #b"}).status_code == 201
    source = next(s for s in client.get("/analytics/capabilities").json()["sources"] if s["source"] == "recorded_work")
    for measure in source["measures"]:
        caps = measure["capabilities"]
        dims = caps["dimensions"]
        groups = [[]] + [[d] for d in dims] + [list(pair) for pair in combinations(dims, 2)]
        if measure["value"] == "plan_fill":
            groups = [["plan_id"]]
        for group in groups:
            query = {
                "source": "recorded_work",
                "measure": measure["value"],
                "group_by": group,
                "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
            }
            if caps["plan_selection"]:
                query.update(plan_basis="original", plan_ids=[plan])
            response = client.post("/analytics/query", json={"query": query})
            assert response.status_code == 200, (query, response.text)
            result = response.json()
            expected = 0 if measure["value"] == "outside_scheduled_task_time" else 1
            if measure["value"] == "summed_recorded_work":
                assert result["total"] == 2, query
                assert sum(row["value"] for row in result["rows"]) == 2, query
            else:
                if measure["value"] != "plan_fill":
                    assert result["total"] == expected, query
                assert all(row["value"] == expected for row in result["rows"]), query


def test_comparison_plan_selection_is_independent_of_work_start_range(client):
    task = client.post("/api/tasks", json={"title": "Night"}).json()["id"]
    plans = [
        client.post(
            "/scheduled-sessions",
            json={
                "task_id": task,
                "start_time": "2000-01-03T23:00:00Z",
                "end_time": "2000-01-04T10:00:00Z",
            },
        ).json()["id"]
        for _ in range(2)
    ]
    work = client.post(
        "/recorded-work",
        json={
            "task_id": task,
            "start_time": "2000-01-04T09:00:00Z",
            "end_time": "2000-01-04T11:00:00Z",
        },
    ).json()
    base = {
        "source": "recorded_work",
        "plan_basis": "original",
        "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
    }
    for measure, expected in [("inside_scheduled_task_time", 1), ("outside_scheduled_task_time", 1)]:
        response = client.post("/analytics/query", json={"query": {**base, "measure": measure}})
        assert response.status_code == 200, response.text
        assert response.json()["total"] == expected
    response = client.post(
        "/analytics/query",
        json={
            "query": {
                **base,
                "measure": "plan_fill",
                "group_by": ["plan_id"],
                "plan_ids": plans,
            }
        },
    )
    assert response.status_code == 200, response.text
    assert [row["value"] for row in response.json()["rows"]] == [1, 1]
    assert response.json()["total"] is None
    assert client.get("/recorded-work/" + work["id"]).json()["scheduled_session_id"] is None


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
    assert filtered.json()["rows"][0]["physical_cohort_seconds"] == 3600
    assert filtered.json()["rows"][0]["value_seconds"] == expected * 3600


def test_nested_atomic_tags_do_not_redistribute_hidden_tag_shares(client):
    task = client.post("/api/tasks", json={"title": "Nested"}).json()["id"]
    for start, end, tag in [("09:00", "11:00", "#a"), ("09:30", "10:00", "#b")]:
        assert (
            client.post(
                "/recorded-work",
                json={
                    "task_id": task,
                    "tags": tag,
                    "start_time": f"2000-01-04T{start}:00Z",
                    "end_time": f"2000-01-04T{end}:00Z",
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
                "group_by": ["day", "tag"],
                "filters": [{"field": "tag", "op": "eq", "values": ["#a"]}],
                "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
            }
        },
    )
    assert response.status_code == 200, response.text
    # 90 minutes exclusively #a, plus half the 30-minute nested overlap.
    assert response.json()["total"] == 1.75
    assert response.json()["rows"][0]["value_seconds"] == 6300
    assert response.json()["rows"][0]["physical_cohort_seconds"] == 7200
    assert response.json()["rows"][0]["count"] == 1
