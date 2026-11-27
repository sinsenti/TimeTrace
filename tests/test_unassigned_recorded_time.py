"""Unassigned interval sums through the root analytics and progress interfaces (#68)."""

import pytest

DAY_RANGE = {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"}


def test_overlapping_unassigned_records_count_in_full_without_changing_elapsed_or_task_credit(client):
    interval = {"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T10:20:00Z"}
    saved = []
    for _ in range(2):
        response = client.post("/recorded-work", json=interval)
        assert response.status_code == 201, response.text
        saved.append(client.get("/recorded-work/" + response.json()["id"]).json())
    for measure, minutes in [
        ("unassigned_recorded_time", 40),
        ("elapsed_recorded_time", 20),
        ("recorded_task_time", 0),
    ]:
        response = client.post(
            "/analytics/query",
            json={"query": {"source": "recorded_work", "measure": measure, "date_range": DAY_RANGE}},
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == pytest.approx(minutes / 60)
    progress = client.get("/recorded-work-progress", params={"start_date": "2000-01-04", "end_date": "2000-01-04"})
    assert progress.status_code == 200, progress.text
    assert progress.json()["unassigned_recorded_time"]["total"] == pytest.approx(40 / 60)
    assert progress.json()["elapsed_recorded_time"]["total"] == pytest.approx(20 / 60)
    assert [client.get("/recorded-work/" + row["id"]).json() for row in saved] == saved
    assert len(client.get("/sessions").json()) == 2
    general = client.post(
        "/analytics/query",
        json={
            "query": {
                "source": "recorded_work",
                "measure": "unassigned_recorded_time",
                "date_range": DAY_RANGE,
                "group_by": ["tag"],
                "tag_attribution": "split_evenly",
            }
        },
    )
    assert general.status_code == 200, general.text
    assert general.json()["rows"][0]["keys"] == ["#general"]
    assert general.json()["total"] == pytest.approx(40 / 60)


@pytest.mark.parametrize("attribution", ["fan_out", "split_evenly"])
def test_unassigned_tag_attribution_uses_each_record_once_and_preserves_hidden_shares(client, attribution):
    for tags in ("#a #b #a", "#b #c"):
        response = client.post(
            "/recorded-work",
            json={"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T10:20:00Z", "tags": tags},
        )
        assert response.status_code == 201, response.text
    query = {
        "source": "recorded_work",
        "measure": "unassigned_recorded_time",
        "tag_attribution": attribution,
        "group_by": ["tag"],
        "date_range": DAY_RANGE,
    }
    response = client.post("/analytics/query", json={"query": query})
    assert response.status_code == 200, response.text
    result = response.json()
    expected = [20, 40, 20] if attribution == "fan_out" else [10, 20, 10]
    assert {row["keys"][0]: row["value"] * 60 for row in result["rows"]} == pytest.approx(
        dict(zip(["#a", "#b", "#c"], expected, strict=True))
    )
    assert result["total"] == pytest.approx(40 / 60)
    assert result["meta"]["physical_cohort_seconds"] == pytest.approx(2400)
    assert result["meta"]["cohort_count"] == 2
    assert result["meta"]["basis"] == "unassigned_recorded_sum"
    assert result["meta"]["totals_overlap"] == (attribution == "fan_out")
    assert result["meta"]["non_additive"] == (attribution == "fan_out")
    multi_match = client.post(
        "/analytics/query",
        json={"query": {**query, "group_by": [], "filters": [{"field": "tag", "op": "in", "values": ["#a", "#b"]}]}},
    )
    assert multi_match.status_code == 200, multi_match.text
    assert multi_match.json()["total"] * 60 == pytest.approx(40 if attribution == "fan_out" else 30)
    assert multi_match.json()["meta"]["cohort_count"] == 2
    assert multi_match.json()["meta"]["physical_cohort_seconds"] == pytest.approx(2400)
    for tag, physical, attributed in [("#a", 1200, 600), ("#b", 2400, 1200)]:
        filtered = client.post(
            "/analytics/query",
            json={"query": {**query, "filters": [{"field": "tag", "op": "eq", "values": [tag]}]}},
        )
        assert filtered.status_code == 200, filtered.text
        result = filtered.json()
        assert result["total"] * 3600 == pytest.approx(physical if attribution == "fan_out" else attributed)
        assert result["meta"]["physical_cohort_seconds"] == pytest.approx(physical)
        assert result["rows"][0]["physical_cohort_seconds"] == pytest.approx(physical)
    for groups in (["day", "tag"], ["tag", "day"]):
        limited = client.post("/analytics/query", json={"query": {**query, "group_by": groups, "limit": 1}})
        assert limited.status_code == 200, limited.text
        result = limited.json()
        assert result["total"] * 60 == pytest.approx(40)
        assert result["meta"]["truncated"] and len(result["rows"]) == 1
        assert result["rows"][0]["value"] * 60 == pytest.approx(40 if attribution == "fan_out" else 20)
        assert result["rows"][0]["keys"][groups.index("tag")] == "#b"
    empty = client.post(
        "/analytics/query",
        json={"query": {**query, "group_by": [], "filters": [{"field": "tag", "op": "eq", "values": ["#missing"]}]}},
    )
    assert empty.status_code == 200, empty.text
    assert empty.json()["total"] == 0 and empty.json()["meta"]["cohort_count"] == 0
    # The separate elapsed metric still divides union coverage among DISTINCT active tags.
    elapsed = client.post("/analytics/query", json={"query": {**query, "measure": "elapsed_recorded_time"}})
    assert elapsed.status_code == 200, elapsed.text
    assert elapsed.json()["total"] == pytest.approx(20 / 60)
    if attribution == "split_evenly":
        assert [row["value"] * 60 for row in elapsed.json()["rows"]] == pytest.approx([20 / 3] * 3)


def test_unassigned_service_and_compiler_report_summed_basis_and_independent_scalar(db, client):
    from datetime import datetime

    from sqlalchemy import text

    from timetrace.core.query_compiler import QueryContext, compile_query
    from timetrace.core.query_spec import AnalyticsQuery
    from timetrace.interfaces.api.schemas import QueryContextRequest
    from timetrace.services import QueryService

    for day, start, end in [("04", "10:00", "10:20"), ("04", "10:00", "10:20"), ("05", "11:00", "11:10")]:
        response = client.post(
            "/recorded-work",
            json={"start_time": f"2000-01-{day}T{start}:00Z", "end_time": f"2000-01-{day}T{end}:00Z"},
        )
        assert response.status_code == 201, response.text
    query = AnalyticsQuery.model_validate(
        {
            "source": "recorded_work",
            "measure": "unassigned_recorded_time",
            "group_by": ["day"],
            "date_range": {**DAY_RANGE, "end_date": "2000-01-05"},
            "limit": 1,
        }
    )
    response = QueryService(db).run(query, QueryContextRequest()).model_dump(mode="json")
    assert response["total"] == pytest.approx(50 / 60)
    assert len(response["rows"]) == 1 and response["meta"]["truncated"]
    assert response["meta"]["basis"] == "unassigned_recorded_sum"
    assert not response["meta"]["totals_overlap"]
    assert not response["meta"]["non_additive"]
    assert response["meta"]["physical_cohort_seconds"] == pytest.approx(3000)
    assert "overlaps count in full" in response["columns"][-1]["label"]
    compiled = compile_query(
        query.model_copy(update={"group_by": []}),
        QueryContext(
            timezone="UTC",
            first_day_of_week=1,
            range_start_utc=datetime(2000, 1, 4),
            range_end_utc=datetime(2000, 1, 6),
            now_utc=datetime(2000, 1, 7),
        ),
    )
    row = db.exec(text(compiled.sql), params=compiled.params).first()
    assert row[0] == pytest.approx(50 / 60)
    assert row[1] == 3


def test_unassigned_local_start_range_keeps_whole_intervals_and_filters_raw_records(client, monkeypatch):
    import time

    import timetrace.core.timezones as zones

    with monkeypatch.context() as patch:
        patch.setenv("TZ", "America/New_York")
        time.tzset()
        zones._reset_caches()
        try:
            task = client.post("/api/tasks", json={"title": "Assigned", "estimated_minutes": 120}).json()["id"]
            # The first two intervals cross local midnight; the third spans the fall DST fold.
            for start, end, task_id, note in [
                ("2000-10-28T23:30:00-04:00", "2000-10-29T00:30:00-04:00", None, "keep"),
                ("2000-10-28T23:30:00-04:00", "2000-10-29T00:30:00-04:00", None, "keep"),
                ("2000-10-29T00:30:00-04:00", "2000-10-29T02:30:00-05:00", None, "other"),
                ("2000-10-28T23:30:00-04:00", "2000-10-29T00:30:00-04:00", task, "keep"),
                ("2000-10-28T23:30:00-04:00", "2000-10-29T00:30:00-04:00", task, "keep"),
            ]:
                response = client.post(
                    "/recorded-work", json={"start_time": start, "end_time": end, "task_id": task_id, "notes": note}
                )
                assert response.status_code == 201, response.text
            legacy = client.post(
                "/sessions", json={"start_time": "2000-10-29T04:00:00Z", "end_time": "2000-10-29T09:00:00Z"}
            )
            assert legacy.status_code == 201
            query = {
                "source": "recorded_work",
                "measure": "unassigned_recorded_time",
                "group_by": ["day"],
                "date_range": {"preset": "custom", "start_date": "2000-10-28", "end_date": "2000-10-29"},
            }
            response = client.post("/analytics/query", json={"query": query, "timezone": "UTC"})
            assert response.status_code == 200, response.text
            data = response.json()
            assert data["total"] == 5
            assert {row["keys"][0]: row["value"] for row in data["rows"]} == {"2000-10-28": 2, "2000-10-29": 3}
            assert data["meta"]["timezone"] == "America/New_York" and data["meta"]["warnings"]
            for field, op, values, expected in [
                ("notes", "contains", ["keep"], 2),
                ("duration_seconds", "eq", [3600], 2),
                ("provenance", "in", ["manual"], 5),
                ("provenance", "eq", ["timer"], 0),
                ("has_task", "eq", [False], 5),
                ("day", "eq", ["2000-10-28"], 2),
            ]:
                filtered = client.post(
                    "/analytics/query",
                    json={"query": {**query, "filters": [{"field": field, "op": op, "values": values}]}},
                )
                assert filtered.status_code == 200, filtered.text
                assert filtered.json()["total"] == expected
            progress = client.get(
                "/recorded-work-progress", params={"start_date": "2000-10-28", "end_date": "2000-10-28"}
            ).json()
            assert progress["unassigned_recorded_time"]["total"] == 2
            assert progress["elapsed_recorded_time"]["total"] == 1
            assert progress["recorded_task_time"]["total"] == 1
            assert progress["tasks"]["rows"][0]["value"] == 1
            for field, values in [("has_task", [True]), ("task", [task]), ("category", ["Focus"])]:
                refused = client.post(
                    "/analytics/query",
                    json={"query": {**query, "filters": [{"field": field, "op": "eq", "values": values}]}},
                )
                assert refused.status_code == 400, refused.text
        finally:
            patch.undo()
            time.tzset()
            zones._reset_caches()
