"""Manual recorded work through the real daemon's public HTTP seam."""


def test_manual_work_persists_provenance_and_raw_interval(client):
    payload = {"start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z", "notes": "Actual work"}
    response = client.post("/recorded-work", json=payload)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["kind"] == "recorded_work"
    assert saved["provenance"] == "manual"
    assert saved["warnings"] == []
    read = client.get(f"/recorded-work/{saved['id']}")
    assert read.status_code == 200, read.text
    assert read.json() == {key: value for key, value in saved.items() if key != "warnings"}
    assert read.json()["start_time"] == payload["start_time"]
    assert read.json()["end_time"] == payload["end_time"]
    assert read.json()["scheduled_session_id"] is None


def test_manual_validation_is_strict_and_legacy_stays_uncertain(client):
    for end in ("2000-01-04T09:00:00Z", "1999-01-04T10:00:00Z", "2099-01-04T10:00:00Z"):
        response = client.post("/recorded-work", json={"start_time": "2000-01-04T09:00:00Z", "end_time": end})
        assert response.status_code == 400, response.text
    assert client.get("/sessions").json() == []
    legacy = client.post("/sessions", json={"start_time": "2099-01-04T09:00:00Z", "end_time": "2099-01-04T10:00:00Z"})
    assert legacy.status_code == 201
    assert client.get(f"/recorded-work/{legacy.json()['id']}").status_code == 404


def test_same_task_overlap_warns_without_merging_other_tasks_and_touching_are_silent(client):
    a, b = [client.post("/api/tasks", json={"title": title}).json()["id"] for title in ("A", "B")]

    def record(task, start, end):
        response = client.post(
            "/recorded-work",
            json={"task_id": task, "start_time": f"2000-01-04T{start}:00Z", "end_time": f"2000-01-04T{end}:00Z"},
        )
        assert response.status_code == 201, response.text
        return response.json()

    first = record(a, "09:00", "10:00")
    second = record(a, "09:30", "10:30")
    assert second["warnings"] == [{"code": "same_task_overlap", "record_ids": [first["id"]], "overlap_seconds": 1800}]
    assert record(b, "09:30", "10:30")["warnings"] == []
    assert record(a, "10:30", "11:00")["warnings"] == []
    assert record(None, "09:30", "10:30")["warnings"] == []
    assert record(None, "09:30", "10:30")["warnings"] == []
    assert len(client.get("/sessions").json()) == 6
    assert client.get(f"/recorded-work/{first['id']}").json()["end_time"] == "2000-01-04T10:00:00Z"


def test_explicit_association_validates_task_revision_and_preserves_plan(client):
    a, b = [client.post("/api/tasks", json={"title": title}).json()["id"] for title in ("A", "B")]
    interval = {"start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"}
    plan = client.post("/scheduled-sessions", json={**interval, "task_id": a}).json()
    work = {
        "start_time": "2000-01-05T09:00:00Z",
        "end_time": "2000-01-05T10:00:00Z",
        "scheduled_session_id": plan["id"],
        "expected_plan_revision": 1,
    }
    for task in (None, b):
        response = client.post("/recorded-work", json={**work, "task_id": task})
        assert response.status_code == 409, response.text
        assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan
    assert client.get("/sessions").json() == []
    response = client.post("/recorded-work", json={**work, "task_id": a})
    assert response.status_code == 201, response.text
    assert response.json()["scheduled_session_id"] == plan["id"]
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == {**plan, "revision": 2}
    assert client.post("/recorded-work", json={**work, "task_id": a}).status_code == 409
    assert len(client.get("/sessions").json()) == 1


def test_virtual_attachment_captures_originals_only_on_explicit_action(client):
    from datetime import UTC, datetime, timedelta

    start = (datetime.now(UTC) + timedelta(days=7)).replace(microsecond=0)
    task = client.post(
        "/api/tasks",
        json={
            "title": "Recurring",
            "is_recurring": True,
            "recurrence_rule": "daily",
            "recurrence_dtstart": start.isoformat(),
            "recurrence_duration_minutes": 60,
            "recurrence_timezone": "UTC",
        },
    ).json()
    params = {"start": start.isoformat(), "end": (start + timedelta(days=1)).isoformat()}
    projected = client.get("/agenda", params=params).json()["items"][0]
    interval = {"task_id": task["id"], "start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"}
    assert client.post("/recorded-work", json=interval).status_code == 201
    assert client.get("/agenda", params=params).json()["items"] == [projected]
    payload = {
        **interval,
        "scheduled_session_id": projected["id"],
        "expected_projection_revision": projected["projection_revision"],
    }
    saved = client.post("/recorded-work", json=payload)
    assert saved.status_code == 201, saved.text
    captured = client.get("/scheduled-sessions/" + saved.json()["scheduled_session_id"]).json()
    assert captured["original_start"] == projected["start_time"]
    assert captured["original_end"] == projected["end_time"]
    assert captured["start_time"] == projected["start_time"]
    assert client.post("/recorded-work", json=payload).status_code == 409
    assert len(client.get("/sessions").json()) == 2


def test_query_union_same_task_different_task_taskless_and_legacy_exclusion(client):
    a, b = [client.post("/api/tasks", json={"title": title}).json()["id"] for title in ("A", "B")]
    for task, start, end in [
        (a, "09:00", "10:00"),
        (a, "09:30", "10:30"),
        (b, "09:00", "10:00"),
        (None, "09:00", "10:00"),
    ]:
        assert (
            client.post(
                "/recorded-work",
                json={"task_id": task, "start_time": f"2000-01-04T{start}:00Z", "end_time": f"2000-01-04T{end}:00Z"},
            ).status_code
            == 201
        )
    client.post(
        "/sessions", json={"task_id": a, "start_time": "2000-01-04T01:00:00Z", "end_time": "2000-01-04T08:00:00Z"}
    )
    for measure, hours in [
        ("recorded_task_time", 2.5),
        ("elapsed_recorded_time", 1.5),
        ("unassigned_recorded_time", 1),
    ]:
        response = client.post(
            "/analytics/query",
            json={
                "query": {
                    "source": "recorded_work",
                    "measure": measure,
                    "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
                }
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == hours


def test_original_current_fill_uses_unowned_work_and_union_of_plan_windows(client):
    task = client.post("/api/tasks", json={"title": "A"}).json()["id"]

    def at(time):
        return f"2000-01-04T{time}:00Z"

    plans = [
        client.post("/scheduled-sessions", json={"task_id": task, "start_time": at(a), "end_time": at(b)}).json()
        for a, b in [("09:00", "10:00"), ("09:30", "10:30")]
    ]
    client.put(
        "/scheduled-sessions/" + plans[0]["id"],
        json={"start_time": at("09:15"), "end_time": at("09:45"), "expected_revision": 1},
    )
    for a, b in [("08:30", "10:00"), ("09:00", "09:15"), ("09:45", "11:00")]:
        client.post("/recorded-work", json={"task_id": task, "start_time": at(a), "end_time": at(b)})
    query = {
        "source": "recorded_work",
        "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
        "plan_ids": [p["id"] for p in plans],
    }
    for basis, inside, outside in [("original", 1.5, 1), ("current", 1.25, 1.25)]:
        for measure, expected in [("inside_scheduled_task_time", inside), ("outside_scheduled_task_time", outside)]:
            response = client.post(
                "/analytics/query", json={"query": {**query, "measure": measure, "plan_basis": basis}}
            )
            assert response.status_code == 200, response.text
            assert response.json()["total"] == expected
    fill = client.post(
        "/analytics/query",
        json={"query": {**query, "measure": "plan_fill", "plan_basis": "current", "group_by": ["plan_id"]}},
    )
    assert fill.status_code == 200, fill.text
    assert sorted(row["value"] for row in fill.json()["rows"]) == [0.5, 1]


def test_outside_task_groups_include_work_without_plan_intersection(client):
    task = client.post("/api/tasks", json={"title": "Outside"}).json()["id"]
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task, "start_time": "2000-01-04T12:00:00Z", "end_time": "2000-01-04T13:00:00Z"},
    ).json()
    client.post(
        "/recorded-work",
        json={"task_id": task, "start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"},
    )
    response = client.post(
        "/analytics/query",
        json={
            "query": {
                "source": "recorded_work",
                "measure": "outside_scheduled_task_time",
                "group_by": ["task"],
                "plan_ids": [plan["id"]],
                "plan_basis": "original",
                "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
            }
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["rows"][0]["value"] == 1
    assert response.json()["total"] == 1


def test_folio_progress_read_labels_local_start_cohort_and_union_bases(client):
    task = client.post("/api/tasks", json={"title": "A"}).json()["id"]
    for a, b in [("09:00", "10:00"), ("09:30", "10:30")]:
        client.post(
            "/recorded-work",
            json={"task_id": task, "start_time": f"2000-01-04T{a}:00Z", "end_time": f"2000-01-04T{b}:00Z"},
        )
    response = client.get("/recorded-work-progress", params={"start_date": "2000-01-04", "end_date": "2000-01-04"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["recorded_task_time"]["total"] == 1.5
    assert data["tasks"]["rows"][0]["value"] == 1.5
    assert data["measurement_at"]
    assert "local record-start" in data["cohort"]


def test_new_work_identity_survives_task_deletion_and_legacy_mutations_refuse(client):
    task = client.post("/api/tasks", json={"title": "History"}).json()["id"]
    interval = {"task_id": task, "start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"}
    plan = client.post("/scheduled-sessions", json=interval).json()
    work = client.post(
        "/recorded-work", json={**interval, "scheduled_session_id": plan["id"], "expected_plan_revision": 1}
    ).json()
    assert client.put("/sessions/" + work["id"], json={**interval, "notes": "unsupported"}).status_code == 409
    assert client.delete("/sessions/" + work["id"]).status_code == 409
    assert client.delete("/api/tasks/" + task).status_code == 204
    read = client.get("/recorded-work/" + work["id"]).json()
    assert read["task_id"] is None and read["scheduled_session_id"] is None
    assert read["kind"] == "recorded_work" and read["provenance"] == "manual"


def test_query_rejects_unsupported_capabilities_instead_of_approximating_tags(client):
    base = {
        "source": "recorded_work",
        "measure": "recorded_task_time",
        "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
    }
    for extra in (
        {"filters": [{"field": "tag", "op": "neq", "values": ["#a"]}]},
        {"filters": [{"field": "provenance", "op": "contains", "values": ["manual"]}]},
        {"date_range": {"preset": "all_time"}},
        {"plan_basis": "original"},
        {"group_by": ["plan_id"]},
    ):
        response = client.post("/analytics/query", json={"query": {**base, **extra}})
        assert response.status_code == 400, response.text


def test_empty_plan_fill_is_zero_not_missing(client):
    plan = client.post(
        "/scheduled-sessions", json={"start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"}
    ).json()
    data = client.get(
        "/recorded-work-progress", params={"start_date": "2000-01-04", "end_date": "2000-01-04", "plan_ids": plan["id"]}
    ).json()
    assert data["original"]["fill"]["rows"][0]["value"] == 0
    assert data["current"]["fill"]["rows"][0]["keys"] == [plan["id"]]


def test_sql_nested_intervals_matches_pure_oracle_and_scalar_precedes_limit(client):
    from datetime import datetime

    from timetrace.core.intervals import union

    task = client.post("/api/tasks", json={"title": "Nested"}).json()["id"]
    intervals = []
    for a, b in [("09:00", "11:00"), ("09:15", "09:30"), ("10:30", "11:30")]:
        saved = client.post(
            "/recorded-work",
            json={"task_id": task, "start_time": f"2000-01-04T{a}:00Z", "end_time": f"2000-01-04T{b}:00Z"},
        ).json()
        read = client.get("/recorded-work/" + saved["id"]).json()
        intervals.append((datetime.fromisoformat(read["start_time"]), datetime.fromisoformat(read["end_time"])))
    assert sum((end - start).total_seconds() for start, end in union(intervals)) == 9000
    query = {
        "source": "recorded_work",
        "measure": "recorded_task_time",
        "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
    }
    assert client.post("/analytics/query", json={"query": query}).json()["total"] == 2.5
    other = client.post("/api/tasks", json={"title": "Other"}).json()["id"]
    client.post(
        "/recorded-work",
        json={"task_id": other, "start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"},
    )
    result = client.post("/analytics/query", json={"query": {**query, "group_by": ["task"], "limit": 1}}).json()
    assert result["total"] == 3.5 and len(result["rows"]) == 1 and result["meta"]["truncated"]
    assert result["meta"]["basis"] == "recorded_work_union"


def test_local_start_cohort_keeps_whole_midnight_and_dst_intervals(client, monkeypatch):
    import timetrace.core.timezones as zones

    monkeypatch.setenv("TZ", "America/New_York")
    zones._reset_caches()
    try:
        for start, end in [
            ("2000-10-28T23:30:00-04:00", "2000-10-29T00:30:00-04:00"),
            ("2000-10-29T00:30:00-04:00", "2000-10-29T02:30:00-05:00"),
        ]:
            assert client.post("/recorded-work", json={"start_time": start, "end_time": end}).status_code == 201
        for day, expected in [("2000-10-28", 1), ("2000-10-29", 3)]:
            result = client.get("/recorded-work-progress", params={"start_date": day, "end_date": day}).json()
            assert result["elapsed_recorded_time"]["total"] == expected
            assert result["recorded_task_time"]["total"] == 0
            assert result["unassigned_recorded_time"]["total"] == expected
    finally:
        zones._reset_caches()


def test_shared_recording_stage_leaves_commit_and_rollback_with_caller(db):
    import pytest

    from timetrace.core.exceptions import EntityNotFoundError
    from timetrace.interfaces.api.schemas import RecordedWorkCreate
    from timetrace.services import SessionService

    service = SessionService(db)
    req = RecordedWorkCreate(start_time="2000-01-04T09:00:00Z", end_time="2000-01-04T10:00:00Z")
    staged = service.stage_recorded_work(req, provenance="timer")
    assert staged.kind == "recorded_work" and staged.provenance == "timer"
    assert service.get_recorded_work(staged.id).id == staged.id
    db.rollback()
    with pytest.raises(EntityNotFoundError):
        service.get_recorded_work(staged.id)
    committed = service.stage_recorded_work(req, provenance="timer")
    db.commit()
    assert service.get_recorded_work(committed.id).provenance == "timer"


def test_manual_http_provenance_is_not_overridable(client):
    response = client.post(
        "/recorded-work",
        json={"start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z", "provenance": "timer"},
    )
    assert response.status_code == 422
    assert client.get("/sessions").json() == []


def test_union_uses_submillisecond_endpoints_without_rounding_work_away(client):
    import pytest

    response = client.post(
        "/recorded-work", json={"start_time": "2000-01-04T09:00:00.000001Z", "end_time": "2000-01-04T09:00:00.000003Z"}
    )
    assert response.status_code == 201
    result = client.get("/recorded-work-progress", params={"start_date": "2000-01-04", "end_date": "2000-01-04"}).json()
    assert result["elapsed_recorded_time"]["total"] == pytest.approx(2e-6 / 3600, abs=1e-15)
