"""Public physical evidence and calendar-period regression examples."""

import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest


@pytest.fixture(autouse=True)
def utc_context(monkeypatch):
    from timetrace.core import timezones

    with monkeypatch.context() as local:
        local.setenv("TZ", "UTC")
        time.tzset()
        timezones._reset_caches()
        yield
    time.tzset()
    timezones._reset_caches()


@pytest.fixture
def clock(monkeypatch):
    import timetrace.services.goal_service as goals
    import timetrace.services.multiple_timer_service as timers

    class Clock(datetime):
        current = datetime(2000, 1, 4, 12, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current.astimezone(tz)

    monkeypatch.setattr(goals, "datetime", Clock)
    monkeypatch.setattr(timers, "datetime", Clock)
    return Clock


def save(client, start, end, task_id=None):
    response = client.post("/recorded-work", json={"start_time": start, "end_time": end, "task_id": task_id})
    assert response.status_code == 201, response.text
    return response.json()


def goal(client, owner="global", task_id=None, cadence="day", **settings):
    request = {
        "operation_id": str(uuid4()),
        "owner_kind": owner,
        "cadence": cadence,
        "target_seconds": 3600,
        **settings,
    }
    if task_id:
        request["task_id"] = task_id
    response = client.post("/goals", json=request)
    assert response.status_code == 201, response.text
    return response.json()


def test_same_task_overlap_all_three_goals_sum_full_rows_without_changing_unions_or_estimates(client, clock):
    task = client.post("/api/tasks", json={"title": "Overlap budget", "estimated_minutes": 60}).json()["id"]
    save(client, "2000-01-04T10:00:00Z", "2000-01-04T11:00:00Z", task)
    save(client, "2000-01-04T10:30:00Z", "2000-01-04T11:30:00Z", task)
    save(client, "2000-01-04T11:15:00Z", "2000-01-04T11:45:00Z")
    assert (
        client.post(
            "/sessions",
            json={"task_id": task, "start_time": "2000-01-04T08:00:00Z", "end_time": "2000-01-04T09:00:00Z"},
        ).status_code
        == 201
    )
    before = client.get(f"/api/tasks/{task}/stats").json()
    for cadence in ("day", "week", "total"):
        goal(client, "task", task, cadence)
    goal(client)
    progress = client.get("/goals").json()["goals"]
    assert [g["summed_recorded_work_seconds"] for g in progress] == [7200, 7200, 7200, 9000]
    assert [g["percentage"] for g in progress] == [200, 200, 200, 250]
    query = {
        "source": "recorded_work",
        "measure": "recorded_task_time",
        "date_range": {"preset": "custom", "start_date": "2000-01-04", "end_date": "2000-01-04"},
    }
    assert client.post("/analytics/query", json={"query": query}).json()["total"] == 1.5
    query["measure"] = "elapsed_recorded_time"
    assert client.post("/analytics/query", json={"query": query}).json()["total"] == 1.75
    after = client.get(f"/api/tasks/{task}/stats").json()
    assert (after["logged_hours"], after["estimated_hours"], after["progress_pct"]) == (3, 1, 300)
    assert after == before


@pytest.mark.parametrize(("first", "weekly_seconds"), [(0, 16200), (1, 21600), (3, 23400)])
def test_overnight_dst_and_supported_week_starts_select_whole_local_start_intervals(
    client, clock, monkeypatch, first, weekly_seconds
):
    from timetrace.core import timezones

    with monkeypatch.context() as local:
        local.setenv("TZ", "America/New_York")
        time.tzset()
        timezones._reset_caches()
        try:
            clock.current = datetime(2026, 3, 7, 12, tzinfo=UTC)
            goal(client, first_day_of_week=first)
            goal(client, cadence="week", first_day_of_week=first)
            for start, end in [
                ("2026-03-08T04:30:00Z", "2026-03-08T06:30:00Z"),
                ("2026-03-08T06:30:00Z", "2026-03-08T08:30:00Z"),
                ("2026-03-09T03:30:00Z", "2026-03-09T05:30:00Z"),
                ("2026-03-09T04:30:00Z", "2026-03-09T05:00:00Z"),
            ]:
                save(client, start, end)
            clock.current = datetime(2026, 3, 9, 12, tzinfo=UTC)
            prior = client.get("/goals?period_start=2026-03-07").json()["goals"]
            assert next(g for g in prior if g["cadence"] == "day")["summed_recorded_work_seconds"] == 7200
            selected = client.get("/goals?period_start=2026-03-08").json()["goals"]
            day = next(g for g in selected if g["cadence"] == "day")
            assert day["summed_recorded_work_seconds"] == 14400
            assert day["context"]["range_start_utc"] == "2026-03-08T05:00:00"
            assert day["context"]["range_end_utc"] == "2026-03-09T04:00:00"
            assert next(g for g in selected if g["cadence"] == "week")["summed_recorded_work_seconds"] == weekly_seconds
        finally:
            local.undo()
            time.tzset()
            timezones._reset_caches()


def test_repeated_fall_hour_is_two_real_hours_in_a_25_hour_local_day(client, clock, monkeypatch):
    from timetrace.core import timezones

    with monkeypatch.context() as local:
        local.setenv("TZ", "America/New_York")
        time.tzset()
        timezones._reset_caches()
        try:
            clock.current = datetime(2026, 11, 1, 12, tzinfo=UTC)
            goal(client)
            save(client, "2026-11-01T01:00:00-04:00", "2026-11-01T01:00:00-05:00")
            save(client, "2026-11-01T01:00:00-05:00", "2026-11-01T02:00:00-05:00")
            progress = client.get("/goals").json()["goals"][0]
            assert progress["summed_recorded_work_seconds"] == 7200
            assert progress["context"]["range_start_utc"] == "2026-11-01T04:00:00"
            assert progress["context"]["range_end_utc"] == "2026-11-02T05:00:00"
        finally:
            local.undo()
            time.tzset()
            timezones._reset_caches()


def test_disable_preserves_history_and_reenable_includes_current_period_work_saved_while_disabled(client, clock):
    created = goal(client)
    save(client, "2000-01-04T10:00:00Z", "2000-01-04T11:00:00Z")
    clock.current = datetime(2000, 1, 5, 12, tzinfo=UTC)
    disabled = client.put(
        "/goals/" + created["id"],
        json={"operation_id": str(uuid4()), "expected_revision": 1, "target_seconds": 3600, "enabled": False},
    )
    assert disabled.status_code == 200
    save(client, "2000-01-05T10:00:00Z", "2000-01-05T11:00:00Z")
    assert client.get("/goals").json() == {"goals": []}
    prior = client.get("/goals?period_start=2000-01-04").json()["goals"][0]
    assert prior["target_seconds"] == prior["summed_recorded_work_seconds"] == 3600
    enabled = client.put(
        "/goals/" + created["id"],
        json={"operation_id": str(uuid4()), "expected_revision": 2, "target_seconds": 1800, "enabled": True},
    )
    assert enabled.status_code == 200
    current = client.get("/goals").json()["goals"][0]
    assert current["summed_recorded_work_seconds"] == 3600 and current["percentage"] == 200
    assert client.get("/goals?period_start=2000-01-04").json()["goals"][0]["target_seconds"] == 3600
    backdate = client.put(
        "/goals/" + created["id"],
        json={
            "operation_id": str(uuid4()),
            "expected_revision": 3,
            "target_seconds": 7200,
            "effective_period_start": "2000-01-01",
        },
    )
    assert backdate.status_code == 422


def test_corrected_physical_fragments_change_historical_goal_totals_without_cloning_reviews_or_ratings(client, clock):
    task = client.post("/api/tasks", json={"title": "Corrected evidence"}).json()["id"]
    work = save(client, "2000-01-04T11:00:00Z", "2000-01-04T11:30:00Z", task)
    goal(client, "task", task, "total")
    goal(client)
    definition = client.post("/rating-definitions", json={"name": "Original subjective score"}).json()
    rating = client.post(
        "/rating-entries",
        json={"rating_definition_id": definition["id"], "target_type": "session", "target_id": work["id"], "score": 7},
    ).json()
    rating_read = client.get("/rating-entries", params={"target_type": "session", "target_id": work["id"]}).json()
    assert rating_read[0]["id"] == rating["id"]
    review = client.post(
        "/revision/day-review", json={"date_str": "2000-01-04", "notes": "Original day notes", "rating": 4}
    ).json()
    assert (
        client.post("/timers/correction-initialize", json={"operation_id": "goal-correction-init"}).status_code == 200
    )
    path = "/recorded-work/" + work["id"]
    preview = client.post(
        path + "/correction-preview",
        json={
            "target": {"kind": "saved", "work_id": work["id"], "expected_revision": work["revision"]},
            "change": {
                "kind": "exclude",
                "start_utc": "2000-01-04T11:10:00Z",
                "end_utc": "2000-01-04T11:15:00Z",
                "timezone": "UTC",
                "start_local_datetime": "2000-01-04T11:10:00",
                "end_local_datetime": "2000-01-04T11:15:00",
                "start_offset_seconds": 0,
                "end_offset_seconds": 0,
            },
        },
    )
    assert preview.status_code == 200, preview.text
    corrected = client.post(path + "/correction", json={"operation_id": "goal-correct", "preview": preview.json()})
    assert corrected.status_code == 200, corrected.text
    fragments = corrected.json()["correction"]["changed_work_ids"] + corrected.json()["correction"]["created_work_ids"]
    assert fragments[0] == work["id"] and len(fragments) == 2
    assert [
        g["summed_recorded_work_seconds"] for g in client.get("/goals?period_start=2000-01-04").json()["goals"]
    ] == [1500, 1500]
    assert (
        client.get("/rating-entries", params={"target_type": "session", "target_id": work["id"]}).json() == rating_read
    )
    assert client.get("/rating-entries", params={"target_type": "session", "target_id": fragments[1]}).json() == []
    assert client.get("/revision/day-summary?date_str=2000-01-04").json()["day_review"]["id"] == review["id"]
    assert (
        client.get("/recorded-work/" + fragments[1]).json()["correction_lineage"]["rating_source_work_id"] == work["id"]
    )


def test_corrected_split_stales_assignment_and_exact_refetch_never_assigns_new_fragments_implicitly(client, clock):
    task = client.post("/api/tasks", json={"title": "Explicit destination"}).json()["id"]
    work = save(client, "2000-01-04T11:00:00Z", "2000-01-04T11:30:00Z")
    goal(client, "task", task, "total")
    goal(client)
    original = {
        "operation_id": str(uuid4()),
        "works": [{"id": work["id"], "expected_revision": work["revision"]}],
        "destination": {"kind": "existing", "task_id": task},
    }
    assert (
        client.post("/timers/correction-initialize", json={"operation_id": "assignment-correction-init"}).status_code
        == 200
    )
    path = "/recorded-work/" + work["id"]
    preview = client.post(
        path + "/correction-preview",
        json={
            "target": {"kind": "saved", "work_id": work["id"], "expected_revision": work["revision"]},
            "change": {
                "kind": "exclude",
                "start_utc": "2000-01-04T11:10:00Z",
                "end_utc": "2000-01-04T11:15:00Z",
                "timezone": "UTC",
                "start_local_datetime": "2000-01-04T11:10:00",
                "end_local_datetime": "2000-01-04T11:15:00",
                "start_offset_seconds": 0,
                "end_offset_seconds": 0,
            },
        },
    )
    assert preview.status_code == 200, preview.text
    corrected = client.post(
        path + "/correction", json={"operation_id": "assignment-correct", "preview": preview.json()}
    )
    assert corrected.status_code == 200, corrected.text
    extra = corrected.json()["correction"]["created_work_ids"][0]
    assert client.post("/recorded-work/assignment", json=original).status_code == 409
    refreshed = client.get(path).json()
    explicit = {
        **original,
        "operation_id": str(uuid4()),
        "works": [{"id": work["id"], "expected_revision": refreshed["revision"]}],
    }
    assigned = client.post("/recorded-work/assignment", json=explicit)
    assert assigned.status_code == 200, assigned.text
    assert [row["id"] for row in assigned.json()["works"]] == [work["id"]]
    assert client.get("/recorded-work/" + extra).json()["task_id"] is None
    assert [g["summed_recorded_work_seconds"] for g in client.get("/goals").json()["goals"]] == [600, 1500]


def test_task_deletion_keeps_goal_audit_noncreditable_and_global_work_unchanged_without_fk_traps(client, clock):
    parent = client.post("/api/tasks", json={"title": "Deleted parent"}).json()["id"]
    child = client.post("/api/tasks", json={"title": "Deleted child", "parent_id": parent}).json()["id"]
    work = save(client, "2000-01-04T10:00:00Z", "2000-01-04T11:00:00Z", child)
    goal(client, "task", parent, "day", include_descendants=True)
    request = {
        "operation_id": str(uuid4()),
        "owner_kind": "task",
        "task_id": child,
        "cadence": "total",
        "target_seconds": 3600,
    }
    original = client.post("/goals", json=request)
    assert original.status_code == 201
    goal(client)
    assert client.delete("/api/tasks/" + parent).status_code == 204
    retained = client.get("/recorded-work/" + work["id"]).json()
    assert retained["id"] == work["id"] and retained["task_id"] is None
    assert retained["start_time"] == work["start_time"] and retained["end_time"] == work["end_time"]
    current = client.get("/goals?include_disabled=true").json()["goals"]
    assert len(current) == 1 and current[0]["owner_kind"] == "global"
    assert current[0]["summed_recorded_work_seconds"] == 3600
    assert client.post("/goals", json=request).json() == original.json()
    assert (
        client.put(
            "/goals/" + original.json()["id"],
            json={"operation_id": str(uuid4()), "expected_revision": 1, "target_seconds": 7200},
        ).status_code
        == 404
    )


def test_goal_descendant_sql_defends_against_a_legacy_corrupt_hierarchy_cycle(client, clock, db):
    from timetrace.db.models import Task

    parent = client.post("/api/tasks", json={"title": "Legacy cycle parent"}).json()["id"]
    child = client.post("/api/tasks", json={"title": "Legacy cycle child", "parent_id": parent}).json()["id"]
    save(client, "2000-01-04T10:00:00Z", "2000-01-04T11:00:00Z", child)
    goal(client, "task", parent, "total", include_descendants=True)
    goal(client)
    corrupt = db.get(Task, parent)
    corrupt.parent_id = child
    db.add(corrupt)
    db.commit()  # External legacy corruption fixture.
    assert [g["summed_recorded_work_seconds"] for g in client.get("/goals").json()["goals"]] == [3600, 3600]


def test_weekly_global_goal_is_not_derived_from_paginated_task_rows_or_goal_rollups(client, clock, db):
    from timetrace.db.models import Session as Work
    from timetrace.db.models import Task

    tasks = [Task(title=f"Bounded displayed task {i}") for i in range(201)]
    db.add_all(tasks)
    db.flush()
    db.add_all(
        [
            Work(
                task_id=t.id,
                kind="recorded_work",
                provenance="manual",
                start_time=datetime(2000, 1, 4, 10),
                end_time=datetime(2000, 1, 4, 11),
                duration_seconds=3600,
            )
            for t in tasks
        ]
    )
    db.commit()
    goal(client, cadence="week")
    goal(client, "task", tasks[-1].id, "total")
    report = client.get("/weekly-review?week_start=2000-01-03").json()
    assert len(report["tasks"]["rows"]) == 200 and report["tasks"]["meta"]["truncated"] is True
    assert report["summed_recorded_work"]["total"] == 201
    assert next(g for g in report["goals"] if g["owner_kind"] == "global")["summed_recorded_work_seconds"] == 723600
    assert next(g for g in report["goals"] if g["owner_kind"] == "task")["summed_recorded_work_seconds"] == 3600


def test_weekly_daily_breakdown_preserves_each_days_effective_target(client, clock):
    created = goal(client)
    save(client, "2000-01-04T10:00:00Z", "2000-01-04T11:00:00Z")
    clock.current = datetime(2000, 1, 5, 12, tzinfo=UTC)
    changed = client.put(
        "/goals/" + created["id"], json={"operation_id": str(uuid4()), "expected_revision": 1, "target_seconds": 7200}
    )
    assert changed.status_code == 200
    save(client, "2000-01-05T10:00:00Z", "2000-01-05T12:00:00Z")
    report = client.get("/weekly-review?week_start=2000-01-03").json()
    assert report["daily_goals"]["2000-01-03"] == []
    assert report["daily_goals"]["2000-01-04"][0]["target_seconds"] == 3600
    assert report["daily_goals"]["2000-01-05"][0]["target_seconds"] == 7200
    assert report["daily_goals"]["2000-01-04"][0]["percentage"] == 100
    assert report["daily_goals"]["2000-01-05"][0]["percentage"] == 100
    assert report["summed_recorded_work"]["total"] == 3


def test_weekly_keeps_original_plan_context_when_current_plan_moves_outside_selected_week(client, clock):
    task = client.post("/api/tasks", json={"title": "Moved plan"}).json()["id"]
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task, "start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"},
    ).json()
    moved = client.put(
        "/scheduled-sessions/" + plan["id"],
        json={
            "expected_revision": plan["revision"],
            "start_time": "2000-01-11T10:00:00Z",
            "end_time": "2000-01-11T12:00:00Z",
        },
    )
    assert moved.status_code == 200, moved.text
    report = client.get("/weekly-review?week_start=2000-01-03").json()
    assert len(report["plans"]) == 1
    saved = report["plans"][0]
    assert saved["id"] == plan["id"]
    assert saved["original_start"].startswith("2000-01-04T10:00:00")
    assert saved["start_time"].startswith("2000-01-11T10:00:00")
    assert saved["original_in_week"] is True and saved["current_in_week"] is False
    assert report["summed_recorded_work"]["total"] == 0


def test_live_paused_buffers_plans_and_uncertain_legacy_do_not_credit_until_exact_stop(client, clock):
    clock.current = datetime(2000, 1, 4, 3, tzinfo=UTC)
    save(client, "2000-01-04T01:00:00Z", "2000-01-04T02:00:00Z")
    assert (
        client.post(
            "/sessions", json={"start_time": "2000-01-04T02:00:00Z", "end_time": "2000-01-04T03:00:00Z"}
        ).status_code
        == 201
    )
    task = client.post("/api/tasks", json={"title": "Plan only #destination"}).json()["id"]
    assert (
        client.post(
            "/scheduled-sessions",
            json={"task_id": task, "start_time": "2000-01-04T03:00:00Z", "end_time": "2000-01-04T04:00:00Z"},
        ).status_code
        == 201
    )
    goal(client)
    report = client.get("/weekly-review?week_start=2000-01-03").json()
    assert len(report["uncertain_legacy"]["items"]) == 1
    assert report["uncertain_legacy"]["items"][0]["kind"] == "legacy_uncertain"
    assert report["summed_recorded_work"]["total"] == 1
    assert len(report["plans"]) == 1
    timer = client.post(
        "/timers", json={"operation_id": "start-unsaved", "notes": "Saved timer context", "tags": "#original"}
    ).json()["timer"]
    clock.current += timedelta(minutes=15)
    assert client.get("/goals").json()["goals"][0]["summed_recorded_work_seconds"] == 3600
    assert client.post(f"/timers/{timer['id']}/pause", json={"operation_id": "pause-unsaved"}).status_code == 200
    clock.current += timedelta(minutes=5)
    assert client.get("/goals").json()["goals"][0]["summed_recorded_work_seconds"] == 3600
    assert client.post(f"/timers/{timer['id']}/resume", json={"operation_id": "resume-unsaved"}).status_code == 200
    clock.current += timedelta(minutes=10)
    path = f"/timers/{timer['id']}/stop"
    stopped = client.post(path, json={"operation_id": "stop-exact"})
    assert stopped.status_code == 200, stopped.text
    assert len(stopped.json()["saved_taskless_work"]) == 2
    assert all(w["revision"] == 1 for w in stopped.json()["saved_taskless_work"])
    assert client.get("/goals").json()["goals"][0]["summed_recorded_work_seconds"] == 5100
    assert client.post(path, json={"operation_id": "stop-exact"}).json() == stopped.json()
    assert client.get("/goals").json()["goals"][0]["summed_recorded_work_seconds"] == 5100
    before = [client.get("/recorded-work/" + row["id"]).json() for row in stopped.json()["saved_taskless_work"]]
    assert all(row["provenance"] == "timer" and row["timer_id"] == timer["id"] for row in before)
    assert all(row["scheduled_session_id"] is None and row["tags"] == "#original" for row in before)
    other = client.post("/api/tasks", json={"title": "Unrelated focus owner"}).json()["id"]
    parallel = client.post("/timers", json={"operation_id": "parallel-start", "task_id": other}).json()["timer"]
    assert (
        client.post(
            "/timers/" + parallel["id"] + "/focus-settings",
            json={
                "operation_id": "parallel-focus",
                "expected_revision": parallel["revision"],
                "enabled": True,
                "work_minutes": 25,
                "break_minutes": 5,
                "behavior": "notify_only",
            },
        ).status_code
        == 200
    )
    unchanged = client.get("/timers").json()["timers"][0]
    goal(client, "task", task, "total")
    clock.current += timedelta(minutes=10)
    request = {
        "operation_id": "assign-two-stopped-rows",
        "works": [
            {"id": row["id"], "expected_revision": row["revision"]} for row in stopped.json()["saved_taskless_work"]
        ],
        "destination": {"kind": "existing", "task_id": task},
    }
    assigned = client.post("/recorded-work/assignment", json=request)
    assert assigned.status_code == 200, assigned.text
    for row in before:
        after = client.get("/recorded-work/" + row["id"]).json()
        assert after["task_id"] == task and after["revision"] == row["revision"] + 1
        for field, value in row.items():
            if field not in ("task_id", "revision"):
                assert after[field] == value
    after_timer = client.get("/timers").json()["timers"][0]
    for field in (
        "id",
        "task_id",
        "running_start",
        "running_segment_id",
        "segments",
        "revision",
        "state",
        "notes",
        "tags",
    ):
        assert after_timer[field] == unchanged[field]
    for field in ("recording_anchor", "generation", "settings", "period", "active_seconds", "phase"):
        assert after_timer["focus"][field] == unchanged["focus"][field]
    assert [g["summed_recorded_work_seconds"] for g in client.get("/goals").json()["goals"]] == [5100, 1500]
    assert client.post(path, json={"operation_id": "stop-exact"}).json() == stopped.json()
    assert (
        client.post("/recorded-work/assignment", json={**request, "operation_id": "do-not-assign-again"}).status_code
        == 409
    )
