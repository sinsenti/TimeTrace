"""Assembled release tracer at the real root HTTP seam, with one shared dataset.

Only the external clock/activity observation is controlled; no router or service is
replaced. Companion migration/recovery suites cover durable process/file failures.
"""

from datetime import UTC, datetime
from uuid import uuid4


def test_calendar_agenda_idle_extension_removal_and_statistics(client, db, tmp_path, monkeypatch):
    import timetrace.services.multiple_timer_service as timers

    class Clock(datetime):
        instant = datetime(2025, 1, 1, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.instant

    monkeypatch.setattr(timers, "datetime", Clock)
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))

    def post(url, body, status=200):
        response = client.post(url, json=body)
        assert response.status_code == status, response.text
        return response.json()

    tasks = [post("/api/tasks", {"title": title}, 201)["id"] for title in ("Writing", "Phone", "Background")]
    plan = post(
        "/scheduled-sessions",
        {"task_id": tasks[0], "start_time": "2025-01-01T10:00:00Z", "end_time": "2025-01-01T10:20:00Z"},
        201,
    )
    assert client.get("/sessions").json() == []  # even elapsed plans never imply work
    started = []
    for index, task in enumerate(tasks):
        body = {"operation_id": str(uuid4()), "task_id": task, "pause_when_idle": index != 2}
        if index == 0:
            body.update(scheduled_session_id=plan["id"], expected_plan_revision=plan["revision"])
        started.append(post("/timers", body)["timer"])
    Clock.instant = datetime(2025, 1, 1, 10, 20, tzinfo=UTC)
    timers.MultipleTimerService(db).observe_activity(600)
    selected = post("/timers", {"task_id": tasks[0], "operation_id": str(uuid4())})
    assert selected["selected_existing"] is True
    assert selected["timer"]["id"] == started[0]["id"]
    assert selected["timer"]["state"] == "frozen"
    Clock.instant = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    timers.MultipleTimerService(db).observe_activity(0)  # actual return, before late review
    post(f"/timers/{started[2]['id']}/pause", {"operation_id": str(uuid4())})
    Clock.instant = datetime(2025, 1, 1, 11, tzinfo=UTC)
    for timer, decision in zip(started, ("discard", "claim"), strict=False):
        current = client.get(f"/timers/{timer['id']}").json()
        resolved = post(
            f"/timers/{timer['id']}/resolve",
            {"operation_id": str(uuid4()), "gap_id": current["idle_gaps"][0]["id"], "decision": decision},
        )
        assert resolved["timer"]["state"] == "paused"
        assert resolved["timer"]["pause_when_idle"] is True
    work_ids = []
    for timer, seconds in zip(started, (600, 1800, 1800), strict=True):
        body = {"operation_id": str(uuid4())}
        result = post(f"/timers/{timer['id']}/stop", body)
        assert post(f"/timers/{timer['id']}/stop", body) == result
        rows = [client.get(f"/recorded-work/{wid}").json() for wid in result["recorded_work_ids"]]
        assert sum(row["duration_seconds"] for row in rows) == seconds
        work_ids.extend(result["recorded_work_ids"])

    unowned = post(
        "/recorded-work",
        {"task_id": tasks[0], "start_time": "2025-01-01T10:20:00Z", "end_time": "2025-01-01T10:40:00Z"},
        201,
    )
    assert unowned["scheduled_session_id"] is None
    assert client.get("/dashboard").status_code == client.get("/agenda-view").status_code == 200
    rows = client.get("/agenda", params={"start": "2025-01-01T00:00:00Z", "end": "2025-01-02T00:00:00Z"}).json()[
        "items"
    ]
    assert {row["id"] for row in rows} == {plan["id"], unowned["id"], *work_ids}

    def total(measure, basis="original"):
        return post(
            "/analytics/query",
            {
                "query": {
                    "source": "recorded_work",
                    "measure": measure,
                    **({"plan_basis": basis} if measure.startswith("inside_") else {}),
                    "date_range": {"preset": "custom", "start_date": "2025-01-01", "end_date": "2025-01-01"},
                }
            },
        )["total"]

    assert total("recorded_task_time") == 1.5  # 30 Writing + 30 Phone + 30 Background
    assert total("elapsed_recorded_time") == 2 / 3  # physical union 10:00–10:40
    plan = client.get(f"/scheduled-sessions/{plan['id']}").json()  # adopt revision after associated writes
    extended = post(
        f"/scheduled-sessions/{plan['id']}/extend",
        {"operation_id": str(uuid4()), "expected_revision": plan["revision"], "end_time": "2025-01-01T10:40:00Z"},
    )
    assert extended["original_end"] == "2025-01-01T10:20:00Z"
    assert total("inside_scheduled_task_time") == 1 / 6
    assert total("inside_scheduled_task_time", "current") == 0.5
    preview = client.get(f"/scheduled-sessions/{plan['id']}/removal-preview").json()
    squeezed = post(
        f"/scheduled-sessions/{plan['id']}/removal",
        {"action": "squeeze", "consent_token": preview["consent_token"], "operation_id": str(uuid4())},
    )
    assert squeezed
    current = client.get(f"/scheduled-sessions/{plan['id']}").json()
    assert current["end_time"] == "2025-01-01T10:10:00Z"  # unowned matching work is NOT ownership
    assert current["original_end"] == "2025-01-01T10:20:00Z"
    preview = client.get(f"/scheduled-sessions/{plan['id']}/removal-preview").json()
    post(
        f"/scheduled-sessions/{plan['id']}/removal",
        {"action": "delete_everything", "consent_token": preview["consent_token"], "operation_id": str(uuid4())},
    )
    assert client.get(f"/scheduled-sessions/{plan['id']}").status_code == 404
    assert client.get(f"/recorded-work/{unowned['id']}").status_code == 200
    assert total("recorded_task_time") == 4 / 3
    assert client.get("/timers").json()["timers"] == []
