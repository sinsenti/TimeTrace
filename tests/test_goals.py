"""Public goal behavior, independent of the existing union/estimate accounting."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest


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
    today = datetime.now(UTC).date().isoformat()
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


def test_goals_are_absent_until_configured(client):
    assert client.get("/goals").json() == {"goals": []}


def test_global_week_and_task_day_goals_coexist(client):
    task = client.post("/api/tasks", json={"title": "Goal task"}).json()["id"]
    today = datetime.now(UTC).date().isoformat()
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
    today = datetime.now(UTC).date().isoformat()
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
