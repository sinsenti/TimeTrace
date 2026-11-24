"""Public goal behavior, independent of the existing union/estimate accounting."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest

FIXED_GOAL_DAY = "2002-01-04"


@pytest.fixture(autouse=True)
def deterministic_goal_period(monkeypatch):
    import time

    import timetrace.services.goal_service as goals
    from timetrace.core import timezones

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2002, 1, 4, 12, tzinfo=UTC).astimezone(tz)

    monkeypatch.setenv("TZ", "UTC")
    monkeypatch.setattr(goals, "datetime", Clock)
    time.tzset()
    timezones._reset_caches()
    yield
    # Unwind caller clock/zone patches before restoring process-local TZ caches.
    monkeypatch.undo()
    time.tzset()
    timezones._reset_caches()


def test_goal_settings_retry_stale_and_disable_reenable(client):
    request = {"operation_id": str(uuid4()), "owner_kind": "global", "cadence": "day", "target_seconds": 3600}
    first = client.post("/goals", json=request)
    assert first.status_code == 201
    assert client.post("/goals", json=request).json() == first.json()
    changed = {**request, "target_seconds": 7200}
    assert client.post("/goals", json=changed).status_code == 409
    goal = first.json()
    edit = {"operation_id": str(uuid4()), "expected_revision": 1, "target_seconds": 1800, "enabled": False}
    disabled = client.put(f"/goals/{goal['id']}", json=edit)
    assert disabled.status_code == 200, disabled.text
    assert client.get("/goals").json() == {"goals": []}
    assert client.put(f"/goals/{goal['id']}", json=edit).json() == disabled.json()
    assert client.put(f"/goals/{goal['id']}", json={**edit, "operation_id": str(uuid4())}).status_code == 409
    enabled = client.put(
        f"/goals/{goal['id']}", json={**edit, "operation_id": str(uuid4()), "expected_revision": 2, "enabled": True}
    )
    assert enabled.status_code == 200
    assert client.get("/goals").json()["goals"][0]["target_seconds"] == 1800


def test_task_total_includes_old_work_without_a_400_day_window(client):
    task = client.post("/api/tasks", json={"title": "Long project"}).json()["id"]
    assert (
        client.post(
            "/recorded-work",
            json={"task_id": task, "start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"},
        ).status_code
        == 201
    )
    response = client.post(
        "/goals",
        json={
            "operation_id": str(uuid4()),
            "owner_kind": "task",
            "task_id": task,
            "cadence": "total",
            "target_seconds": 3600,
        },
    )
    assert response.status_code == 201, response.text
    goal = client.get("/goals").json()["goals"][0]
    assert goal["summed_recorded_work_seconds"] == 3600


def test_total_optional_start_date_excludes_older_start_days(client):
    task = client.post("/api/tasks", json={"title": "Since date"}).json()["id"]
    for day in ["2000-01-04", "2000-01-05"]:
        assert (
            client.post(
                "/recorded-work",
                json={"task_id": task, "start_time": f"{day}T10:00:00Z", "end_time": f"{day}T11:00:00Z"},
            ).status_code
            == 201
        )
    response = client.post(
        "/goals",
        json={
            "operation_id": str(uuid4()),
            "owner_kind": "task",
            "task_id": task,
            "cadence": "total",
            "target_seconds": 3600,
            "start_date": "2000-01-05",
        },
    )
    assert response.status_code == 201, response.text
    assert client.get("/goals").json()["goals"][0]["summed_recorded_work_seconds"] == 3600


def test_nested_descendants_credit_each_goal_once_not_global_rollups(client):
    parent = client.post("/api/tasks", json={"title": "Parent"}).json()["id"]
    child = client.post("/api/tasks", json={"title": "Child", "parent_id": parent}).json()["id"]
    leaf = client.post("/api/tasks", json={"title": "Leaf", "parent_id": child}).json()["id"]
    today = FIXED_GOAL_DAY
    assert (
        client.post(
            "/recorded-work",
            json={"task_id": leaf, "start_time": f"{today}T01:00:00Z", "end_time": f"{today}T02:00:00Z"},
        ).status_code
        == 201
    )
    for owner, task_id in [("global", None), ("task", parent), ("task", child), ("task", leaf)]:
        request = {
            "operation_id": str(uuid4()),
            "owner_kind": owner,
            "cadence": "day",
            "target_seconds": 3600,
            "include_descendants": owner == "task",
        }
        if task_id:
            request["task_id"] = task_id
        response = client.post("/goals", json=request)
        assert response.status_code == 201, response.text
    assert [g["summed_recorded_work_seconds"] for g in client.get("/goals").json()["goals"]] == [3600, 3600, 3600, 3600]


def test_settings_history_and_current_hierarchy_are_independent(client, monkeypatch):
    import timetrace.services.goal_service as clock

    class HistoricalClock(datetime):
        current = datetime(2000, 1, 4, 12, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current.astimezone(tz)

    monkeypatch.setattr(clock, "datetime", HistoricalClock)
    parent = client.post("/api/tasks", json={"title": "Historical parent"}).json()["id"]
    child = client.post("/api/tasks", json={"title": "Historical child", "parent_id": parent}).json()["id"]
    assert (
        client.post(
            "/recorded-work",
            json={"task_id": child, "start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"},
        ).status_code
        == 201
    )
    response = client.post(
        "/goals",
        json={
            "operation_id": str(uuid4()),
            "owner_kind": "task",
            "task_id": parent,
            "cadence": "day",
            "target_seconds": 3600,
            "include_descendants": True,
        },
    )
    assert response.status_code == 201
    goal = response.json()
    HistoricalClock.current = datetime(2000, 1, 5, 12, tzinfo=UTC)
    edit = client.put(
        f"/goals/{goal['id']}",
        json={
            "operation_id": str(uuid4()),
            "expected_revision": 1,
            "target_seconds": 7200,
            "include_descendants": False,
        },
    )
    assert edit.status_code == 200, edit.text
    historical = client.get("/goals?period_start=2000-01-04").json()["goals"][0]
    assert historical["target_seconds"] == 3600
    assert historical["summed_recorded_work_seconds"] == 3600
    assert client.get("/goals").json()["goals"][0]["target_seconds"] == 7200
    assert client.put(f"/api/tasks/{child}", json={"parent_id": None}).status_code == 200
    assert client.get("/goals?period_start=2000-01-04").json()["goals"][0]["summed_recorded_work_seconds"] == 0


def test_prior_period_is_not_given_a_retroactive_target(client):
    response = client.post(
        "/goals", json={"operation_id": str(uuid4()), "owner_kind": "global", "cadence": "day", "target_seconds": 3600}
    )
    assert response.status_code == 201
    assert client.get("/goals?period_start=2000-01-04").json() == {"goals": []}


def test_taskless_assignment_preserves_saved_identity_and_global_credit(client):
    task = client.post("/api/tasks", json={"title": "Assignment destination"}).json()["id"]
    saved = client.post(
        "/recorded-work",
        json={
            "start_time": "2000-01-04T10:00:00Z",
            "end_time": "2000-01-04T11:00:00Z",
            "notes": "keep me",
            "tags": "original",
        },
    ).json()
    request = {
        "operation_id": str(uuid4()),
        "works": [{"id": saved["id"], "expected_revision": saved["revision"]}],
        "destination": {"kind": "existing", "task_id": task},
    }
    response = client.post("/recorded-work/assignment", json=request)
    assert response.status_code == 200, response.text
    assigned = client.get(f"/recorded-work/{saved['id']}").json()
    assert assigned["task_id"] == task
    assert assigned["revision"] == saved["revision"] + 1
    for field in ["id", "start_time", "end_time", "notes", "tags", "scheduled_session_id"]:
        assert assigned[field] == saved[field]
    assert client.post("/recorded-work/assignment", json=request).json() == response.json()
    assert client.post("/recorded-work/assignment", json={**request, "works": []}).status_code in (409, 422)


def test_assignment_can_create_one_normal_task_and_retry_without_duplicates(client):
    saved = client.post(
        "/recorded-work", json={"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"}
    ).json()
    request = {
        "operation_id": str(uuid4()),
        "works": [{"id": saved["id"], "expected_revision": saved["revision"]}],
        "destination": {"kind": "new", "task_draft": {"title": "New assignment #project [2h]"}},
    }
    response = client.post("/recorded-work/assignment", json=request)
    assert response.status_code == 200, response.text
    assert client.post("/recorded-work/assignment", json=request).json() == response.json()
    tasks = client.get("/api/tasks").json()
    assert len(tasks) == 1
    assert tasks[0]["title"] == "New assignment"
    assert tasks[0]["estimated_minutes"] == 120
    assert "project" in tasks[0]["tags"]
    assert client.get(f"/recorded-work/{saved['id']}").json()["task_id"] == tasks[0]["id"]


def test_assignment_multi_record_stale_refuses_and_rolls_back_new_task(client):
    records = [
        client.post(
            "/recorded-work", json={"start_time": f"2000-01-04T{hour}:00:00Z", "end_time": f"2000-01-04T{hour}:30:00Z"}
        ).json()
        for hour in ["10", "11"]
    ]
    request = {
        "operation_id": str(uuid4()),
        "works": [{"id": r["id"], "expected_revision": r["revision"]} for r in records],
        "destination": {"kind": "new", "task_draft": {"title": "Must roll back"}},
    }
    changed = client.patch(
        f"/recorded-work/{records[1]['id']}/note",
        json={"notes": "new note", "expected_revision": records[1]["revision"]},
    )
    assert changed.status_code == 200
    response = client.post("/recorded-work/assignment", json=request)
    assert response.status_code == 409, response.text
    assert client.get("/api/tasks").json() == []
    assert [client.get(f"/recorded-work/{r['id']}").json()["task_id"] for r in records] == [None, None]
    request["works"][1]["expected_revision"] += 1
    request["operation_id"] = str(uuid4())
    assigned = client.post("/recorded-work/assignment", json=request)
    assert assigned.status_code == 200, assigned.text
    assert len(assigned.json()["works"]) == 2
    assert client.get(f"/recorded-work/{records[1]['id']}").json()["notes"] == "new note"


@pytest.mark.parametrize("phase", ["pre_db", "post_db"])
def test_assignment_recovers_lost_ack_and_protects_only_precommit_targets(client, monkeypatch, phase):
    from timetrace.core.timer_store import TimerStore

    saved = client.post(
        "/recorded-work", json={"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"}
    ).json()
    operation_id = str(uuid4())
    request = {
        "operation_id": operation_id,
        "works": [{"id": saved["id"], "expected_revision": saved["revision"]}],
        "destination": {"kind": "new", "task_draft": {"title": "Crash-safe destination"}},
    }
    write = TimerStore.write

    def fail_file(store, state):
        if phase == "pre_db":
            write(store, state)
            if (state.get("pending_operation") or {}).get("id") == operation_id:
                raise OSError("synthetic failure after accepted intent")
        elif not state.get("pending_operation"):
            raise OSError("synthetic file finalization failure")
        else:
            write(store, state)

    monkeypatch.setattr(TimerStore, "write", fail_file)
    assert client.post("/recorded-work/assignment", json=request).status_code == 409
    note = client.patch(
        f"/recorded-work/{saved['id']}/note",
        json={
            "notes": "independent after DB" if phase == "post_db" else "must refuse",
            "expected_revision": saved["revision"] + (phase == "post_db"),
        },
    )
    assert note.status_code == (200 if phase == "post_db" else 409), note.text
    monkeypatch.setattr(TimerStore, "write", write)
    recovered = client.post("/recorded-work/assignment", json=request)
    assert recovered.status_code == 200, recovered.text
    assert len(client.get("/api/tasks").json()) == 1
    row = client.get(f"/recorded-work/{saved['id']}").json()
    assert row["task_id"] == recovered.json()["task_id"]
    if phase == "post_db":
        assert row["notes"] == "independent after DB"
    assert client.get(f"/operations/{operation_id}").json()["status"] == "finalized"


def test_weekly_overview_uses_whole_start_day_sum_and_separate_unions(client):
    task = client.post("/api/tasks", json={"title": "Weekly task"}).json()["id"]
    for start, end, owner in [("10:00", "11:00", task), ("10:30", "11:30", task), ("11:00", "12:00", None)]:
        assert (
            client.post(
                "/recorded-work",
                json={"task_id": owner, "start_time": f"2000-01-04T{start}:00Z", "end_time": f"2000-01-04T{end}:00Z"},
            ).status_code
            == 201
        )
    result = client.get("/weekly-review?week_start=2000-01-03&timezone=UTC&first_day_of_week=1")
    assert result.status_code == 200, result.text
    report = result.json()
    assert report["week_start"] == "2000-01-03"
    assert report["summed_recorded_work"]["total"] == 3
    assert report["elapsed_recorded_time"]["total"] == 2
    assert report["recorded_task_time"]["total"] == 1.5
    assert report["taskless_summed_recorded_work"]["total"] == 1
    assert report["daily"]["rows"][0]["keys"] == ["2000-01-04"]
    assert report["tasks"]["rows"][0]["value"] == 2
    assert client.get("/weekly-review?week_start=2000-01-10").json()["summed_recorded_work"]["total"] == 0


def test_weekly_goal_and_query_evidence_share_one_measurement_cutoff(client):
    task = client.post("/api/tasks", json={"title": "Coherent task"}).json()["id"]
    for owner, cadence in [("global", "week"), ("task", "total")]:
        request = {"operation_id": str(uuid4()), "owner_kind": owner, "cadence": cadence, "target_seconds": 3600}
        if owner == "task":
            request["task_id"] = task
        assert client.post("/goals", json=request).status_code == 201
    response = client.get("/weekly-review").json()
    cutoff = datetime.fromisoformat(response["measurement_at"]).replace(tzinfo=UTC)
    assert datetime.fromisoformat(response["daily"]["meta"]["measurement_at"]) == cutoff
    assert response["goals"]
    for goal in response["goals"]:
        assert datetime.fromisoformat(goal["context"]["measurement_at"]).replace(tzinfo=UTC) == cutoff


def test_total_settings_apply_immediately_even_while_browsing_an_old_week(client):
    task = client.post("/api/tasks", json={"title": "Immediate total"}).json()["id"]
    goal = client.post(
        "/goals",
        json={
            "operation_id": str(uuid4()),
            "owner_kind": "task",
            "task_id": task,
            "cadence": "total",
            "target_seconds": 3600,
        },
    ).json()
    changed = client.put(
        "/goals/" + goal["id"],
        json={"operation_id": str(uuid4()), "expected_revision": 1, "target_seconds": 7200, "start_date": "2000-01-05"},
    )
    assert changed.status_code == 200, changed.text
    result = client.get("/goals?period_start=2000-01-03").json()["goals"]
    assert len(result) == 1
    assert result[0]["target_seconds"] == 7200
    assert result[0]["start_date"] == "2000-01-05"


def test_reporting_context_is_persisted_without_inventing_targets(client):
    initial = client.get("/goal-reporting-context")
    assert initial.status_code == 200, initial.text
    assert initial.json()["revision"] == 0
    assert (
        client.post(
            "/goals",
            json={
                "operation_id": str(uuid4()),
                "owner_kind": "global",
                "cadence": "week",
                "target_seconds": 3600,
                "first_day_of_week": 0,
            },
        ).status_code
        == 201
    )
    context = client.get("/goal-reporting-context").json()
    assert context["revision"] == 1
    assert context["first_day_of_week"] == 0
    goal = client.get("/goals").json()["goals"][0]
    assert goal["context_revision"] == 1


def test_reporting_context_changes_start_a_new_epoch_without_rebucketing_old_weeks(client, monkeypatch):
    import timetrace.services.goal_service as clock

    class Clock(datetime):
        current = datetime(2000, 1, 4, 12, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.current.astimezone(tz)

    monkeypatch.setattr(clock, "datetime", Clock)
    goal = client.post(
        "/goals",
        json={
            "operation_id": str(uuid4()),
            "owner_kind": "global",
            "cadence": "week",
            "target_seconds": 3600,
            "first_day_of_week": 1,
        },
    ).json()
    Clock.current = datetime(2000, 1, 12, 12, tzinfo=UTC)
    change = {"operation_id": str(uuid4()), "expected_revision": 1, "first_day_of_week": 0}
    changed = client.put("/goal-reporting-context", json=change)
    assert changed.status_code == 200, changed.text
    assert client.put("/goal-reporting-context", json=change).json() == changed.json()
    assert client.put("/goal-reporting-context", json={**change, "operation_id": str(uuid4())}).status_code == 409
    current = client.get("/goals").json()["goals"][0]
    assert (current["context_revision"], current["revision"], current["period_start"]) == (2, 2, "2000-01-09")
    prior = client.get("/goals?period_start=2000-01-03&context_revision=1").json()["goals"][0]
    assert (prior["context_revision"], prior["period_start"], prior["period_end"], prior["target_seconds"]) == (
        1,
        "2000-01-03",
        "2000-01-09",
        3600,
    )
    assert client.get("/goals?period_start=2000-01-03").json()["goals"][0]["context_revision"] == 1
    assert client.get("/goals?period_start=2000-01-10&context_revision=1").json()["goals"] == []
    overview = client.get("/weekly-review?week_start=2000-01-12").json()
    assert overview["context_revision"] == 2
    assert overview["summed_recorded_work"]["meta"]["first_day_of_week"] == 0
    assert overview["week_start"] == "2000-01-09"
    assert (
        client.put(
            "/goals/" + goal["id"], json={"operation_id": str(uuid4()), "expected_revision": 1, "target_seconds": 7200}
        ).status_code
        == 409
    )


def test_changed_daemon_timezone_does_not_silently_rebucket_frozen_goal_context(client, monkeypatch):
    import time

    from timetrace.core import timezones

    try:
        monkeypatch.setenv("TZ", "UTC")
        time.tzset()
        timezones._reset_caches()
        assert (
            client.post(
                "/goals",
                json={"operation_id": str(uuid4()), "owner_kind": "global", "cadence": "day", "target_seconds": 3600},
            ).status_code
            == 201
        )
        monkeypatch.setenv("TZ", "America/New_York")
        time.tzset()
        timezones._reset_caches()
        goal = client.get("/goals").json()["goals"][0]
        assert goal["summed_recorded_work_seconds"] is None
        assert goal["percentage"] is None
        assert goal["context"]["requested_timezone"] == "UTC"
        assert goal["context"]["reliable"] is False
        assert goal["context"]["warnings"]
        weekly = client.get("/weekly-review?context_revision=1").json()
        assert weekly["available"] is False
        assert weekly["summed_recorded_work"]["total"] is None
        edit = client.put(
            "/goals/" + goal["id"], json={"operation_id": str(uuid4()), "expected_revision": 1, "target_seconds": 7200}
        )
        assert edit.status_code == 409
        epoch = client.put(
            "/goal-reporting-context",
            json={"operation_id": str(uuid4()), "expected_revision": 1, "first_day_of_week": 1},
        )
        assert epoch.status_code == 200, epoch.text
        assert epoch.json()["timezone"] == "America/New_York"
        assert client.get("/goals").json()["goals"][0]["context"]["reliable"] is True
    finally:
        monkeypatch.undo()
        time.tzset()
        timezones._reset_caches()


@pytest.mark.parametrize("target", [0, -1, True, "Infinity", "NaN", None])
def test_invalid_goal_targets_never_create_settings(client, target):
    response = client.post(
        "/goals",
        json={"operation_id": str(uuid4()), "owner_kind": "global", "cadence": "day", "target_seconds": target},
    )
    assert response.status_code == 422, response.text
    assert client.get("/goals").json() == {"goals": []}


def test_goal_evidence_keeps_physical_microseconds_instead_of_legacy_integer_duration(client):
    task = client.post("/api/tasks", json={"title": "Precise physical work"}).json()["id"]
    saved = client.post(
        "/recorded-work",
        json={
            "task_id": task,
            "start_time": FIXED_GOAL_DAY + "T10:00:00.000000Z",
            "end_time": FIXED_GOAL_DAY + "T10:00:00.000007Z",
        },
    )
    assert saved.status_code == 201
    assert (
        client.post(
            "/goals",
            json={
                "operation_id": str(uuid4()),
                "owner_kind": "task",
                "task_id": task,
                "cadence": "day",
                "target_seconds": 0.000001,
            },
        ).status_code
        == 201
    )
    goal = client.get("/goals").json()["goals"][0]
    assert goal["summed_recorded_work_seconds"] == 0.000007
    assert goal["percentage"] == pytest.approx(700)


def test_goal_hierarchy_rejects_new_cycles_through_normal_task_writes(client):
    parent = client.post("/api/tasks", json={"title": "No cycle parent"}).json()["id"]
    child = client.post("/api/tasks", json={"title": "No cycle child", "parent_id": parent}).json()["id"]
    response = client.put("/api/tasks/" + parent, json={"parent_id": child})
    assert response.status_code == 400, response.text
    assert client.put("/api/tasks/" + parent, json={"parent_id": parent}).status_code == 400


@pytest.mark.parametrize("invalid", ["boolean_revision", "unknown_draft_field", "blank_title", "null_created_at"])
def test_assignment_request_is_strict_and_invalid_creation_never_loses_saved_work(client, invalid):
    work = client.post(
        "/recorded-work", json={"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"}
    ).json()
    work = client.get("/recorded-work/" + work["id"]).json()
    request = {
        "operation_id": str(uuid4()),
        "works": [{"id": work["id"], "expected_revision": work["revision"]}],
        "destination": {"kind": "new", "task_draft": {"title": "Valid"}},
    }
    if invalid == "boolean_revision":
        request["works"][0]["expected_revision"] = True
    if invalid == "unknown_draft_field":
        request["destination"]["task_draft"]["unknown"] = "refuse"
    if invalid == "blank_title":
        request["destination"]["task_draft"]["title"] = "   "
    if invalid == "null_created_at":
        request["destination"]["task_draft"]["created_at"] = None
    response = client.post("/recorded-work/assignment", json=request)
    assert response.status_code == 422, response.text
    assert client.get("/api/tasks").json() == []
    assert client.get("/recorded-work/" + work["id"]).json() == work


def test_pending_new_assignment_protects_status_foreign_key_until_recovery(client, monkeypatch):
    from timetrace.core.timer_store import TimerStore

    status = client.post("/api/tasks/statuses", json={"name": "Assignment status"}).json()
    work = client.post(
        "/recorded-work", json={"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"}
    ).json()
    request = {
        "operation_id": "status-guard-assignment",
        "works": [{"id": work["id"], "expected_revision": work["revision"]}],
        "destination": {"kind": "new", "task_draft": {"title": "Status preserved", "status_id": status["id"]}},
    }
    write = TimerStore.write

    def fail(store, state):
        write(store, state)
        if (state.get("pending_operation") or {}).get("id") == request["operation_id"]:
            raise OSError("synthetic accepted intent before DB commit")

    monkeypatch.setattr(TimerStore, "write", fail)
    assert client.post("/recorded-work/assignment", json=request).status_code == 409
    monkeypatch.setattr(TimerStore, "write", write)
    refused = client.delete("/api/tasks/statuses/" + status["id"])
    assert refused.status_code == 409, refused.text
    result = client.post("/recorded-work/assignment", json=request)
    assert result.status_code == 200, result.text
    task = client.get("/api/tasks/" + result.json()["task_id"]).json()
    assert task["status_id"] == status["id"]


def test_finite_positive_tiny_target_does_not_overflow_public_progress_json(client):
    task = client.post("/api/tasks", json={"title": "Tiny target"}).json()["id"]
    assert (
        client.post(
            "/recorded-work",
            json={"task_id": task, "start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/goals",
            json={
                "operation_id": str(uuid4()),
                "owner_kind": "task",
                "task_id": task,
                "cadence": "total",
                "target_seconds": 5e-324,
            },
        ).status_code
        == 201
    )
    response = client.get("/goals")
    assert response.status_code == 200, response.text
    goal = response.json()["goals"][0]
    assert goal["summed_recorded_work_seconds"] == 3600
    assert goal["percentage"] is None
    assert "E+" in goal["percentage_display"] and goal["percentage_display"].endswith("%")


def test_assignment_invalid_status_reference_refuses_before_accepting_an_intent(client):
    work = client.post(
        "/recorded-work", json={"start_time": "2000-01-04T10:00:00Z", "end_time": "2000-01-04T11:00:00Z"}
    ).json()
    request = {
        "operation_id": "invalid-status-assignment",
        "works": [{"id": work["id"], "expected_revision": work["revision"]}],
        "destination": {"kind": "new", "task_draft": {"title": "No orphan", "status_id": "missing-status"}},
    }
    response = client.post("/recorded-work/assignment", json=request)
    assert response.status_code == 404, response.text
    assert client.get("/operations/invalid-status-assignment").status_code == 404
    assert client.get("/api/tasks").json() == []
    assert client.get("/recorded-work/" + work["id"]).json()["task_id"] is None


def test_target_only_edit_preserves_independent_enabled_scope_and_total_start_settings(client):
    parent = client.post("/api/tasks", json={"title": "Preserved settings"}).json()["id"]
    child = client.post("/api/tasks", json={"title": "Child evidence", "parent_id": parent}).json()["id"]
    for date in ["2000-01-04", "2000-01-05"]:
        assert (
            client.post(
                "/recorded-work",
                json={"task_id": child, "start_time": date + "T10:00:00Z", "end_time": date + "T11:00:00Z"},
            ).status_code
            == 201
        )
    created = client.post(
        "/goals",
        json={
            "operation_id": str(uuid4()),
            "owner_kind": "task",
            "task_id": parent,
            "cadence": "total",
            "target_seconds": 3600,
            "enabled": False,
            "include_descendants": True,
            "start_date": "2000-01-05",
        },
    ).json()
    target = {"operation_id": str(uuid4()), "expected_revision": 1, "target_seconds": 7200}
    changed = client.put("/goals/" + created["id"], json=target)
    assert changed.status_code == 200, changed.text
    settings = client.get("/goals?include_disabled=true").json()["goals"][0]
    assert (
        settings["enabled"] is False
        and settings["include_descendants"] is True
        and settings["start_date"] == "2000-01-05"
    )
    assert client.get("/goals").json() == {"goals": []}
    enabled = client.put(
        "/goals/" + created["id"],
        json={"operation_id": str(uuid4()), "expected_revision": 2, "target_seconds": 7200, "enabled": True},
    )
    assert enabled.status_code == 200
    progress = client.get("/goals").json()["goals"][0]
    assert progress["summed_recorded_work_seconds"] == 3600 and progress["percentage"] == 50
    assert client.put("/goals/" + created["id"], json=target).json() == changed.json()
    assert client.put("/goals/" + created["id"], json={**target, "include_descendants": False}).status_code == 409


def test_goals_are_absent_until_configured(client):
    assert client.get("/goals").json() == {"goals": []}


def test_global_week_and_task_day_goals_coexist(client):
    task = client.post("/api/tasks", json={"title": "Goal task"}).json()["id"]
    today = FIXED_GOAL_DAY
    for task_id in [task, None]:
        assert (
            client.post(
                "/recorded-work",
                json={
                    "start_time": f"{today}T01:00:00Z",
                    "end_time": f"{today}T02:00:00Z",
                    "task_id": task_id,
                },
            ).status_code
            == 201
        )
    for owner, cadence in [("global", "day"), ("global", "week"), ("task", "day")]:
        request = {
            "operation_id": str(uuid4()),
            "owner_kind": owner,
            "cadence": cadence,
            "target_seconds": 3600,
            "timezone": "UTC",
        }
        if owner == "task":
            request["task_id"] = task
        response = client.post("/goals", json=request)
        assert response.status_code == 201, response.text
    goals = client.get("/goals").json()["goals"]
    assert [(g["owner_kind"], g["cadence"], g["summed_recorded_work_seconds"]) for g in goals] == [
        ("global", "day", 7200),
        ("global", "week", 7200),
        ("task", "day", 3600),
    ]


def test_create_global_day_goal_reads_saved_overlap_progress(client):
    today = FIXED_GOAL_DAY
    for start, end in [("01:00", "02:00"), ("01:30", "02:30")]:
        response = client.post(
            "/recorded-work", json={"start_time": f"{today}T{start}:00Z", "end_time": f"{today}T{end}:00Z"}
        )
        assert response.status_code == 201, response.text
    response = client.post(
        "/goals",
        json={
            "operation_id": str(uuid4()),
            "owner_kind": "global",
            "cadence": "day",
            "target_seconds": 3600,
            "timezone": "UTC",
            "first_day_of_week": 1,
        },
    )
    assert response.status_code == 201, response.text
    goal = response.json()
    result = client.get("/goals").json()
    assert len(result["goals"]) == 1
    progress = result["goals"][0]
    assert progress["id"] == goal["id"]
    assert progress["summed_recorded_work_seconds"] == 7200
    assert progress["percentage"] == 200
    assert progress["basis"] == "summed_recorded_work"
