"""Focus policy through the public daemon HTTP interface."""

from datetime import UTC, datetime, timedelta


def test_due_events_and_paused_wall_warning_persist_once(client, db, monkeypatch):
    from timetrace.services import multiple_timer_service as module
    from timetrace.services.timer_focus_service import FocusEvaluator

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.at

    monkeypatch.setattr(module, "datetime", Clock)
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    path = "/timers/" + timer["id"]
    client.post(
        path + "/focus-settings",
        json={
            "operation_id": "enable",
            "expected_revision": 1,
            "enabled": True,
            "work_minutes": 1,
            "break_minutes": 1,
            "behavior": "notify_only",
        },
    )
    evaluator = FocusEvaluator(db, wall_clock=lambda: Clock.at, monotonic_clock=lambda: 0, suspend_clock=lambda: 0)
    Clock.at += timedelta(seconds=60)
    evaluator.evaluate()
    notices = client.get("/timer-notifications").json()["notices"]
    assert [n["kind"] for n in notices] == ["work_due"]
    identity = notices[0]["id"]
    assert client.get(path).json()["state"] == "running"
    evaluator.evaluate()
    assert [n["id"] for n in client.get("/timer-notifications").json()["notices"]] == [identity]
    client.post(path + "/pause", json={"operation_id": "pause"})
    Clock.at += timedelta(hours=2)
    FocusEvaluator(db, wall_clock=lambda: Clock.at).evaluate()
    notices = client.get("/timer-notifications").json()["notices"]
    assert sorted(n["kind"] for n in notices) == ["two_hour", "work_due"]
    evaluator.evaluate()
    assert len(client.get("/timer-notifications").json()["notices"]) == 2


def test_focus_pause_actions_and_next_period_settings(client, db, monkeypatch):
    from timetrace.services import multiple_timer_service as module

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)

        @classmethod
        def now(cls, tz=None):
            return cls.at

    monkeypatch.setattr(module, "datetime", Clock)
    monkeypatch.setattr(module.settings, "idle_detection_enabled", True)
    monkeypatch.setattr(module.settings, "idle_threshold_seconds", 300)
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    path = "/timers/" + timer["id"]
    configured = client.post(
        path + "/focus-settings",
        json={
            "operation_id": "enable",
            "expected_revision": timer["revision"],
            "enabled": True,
            "work_minutes": 1,
            "break_minutes": 2,
            "behavior": "notify_only",
        },
    )
    assert configured.status_code == 200, configured.text
    Clock.at += timedelta(seconds=20)
    paused = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]
    Clock.at += timedelta(minutes=10)
    assert client.get(path).json()["focus"]["remaining_seconds"] == 40
    client.post(path + "/resume", json={"operation_id": "resume"})
    Clock.at += timedelta(seconds=40)
    due = client.get(path).json()
    assert due["focus"]["remaining_seconds"] == 0
    assert due["state"] == "running"
    request = {
        "operation_id": "take",
        "expected_revision": due["revision"],
        "expected_generation": due["focus"]["generation"],
        "action": "take_break",
    }
    broken = client.post(path + "/focus-action", json=request)
    assert broken.status_code == 200, broken.text
    assert broken.json()["timer"]["state"] == "paused"
    assert broken.json()["timer"]["manual_pause_note_segment_id"] is None
    assert client.post(path + "/focus-action", json=request).json() == broken.json()
    Clock.at += timedelta(seconds=30)
    current = client.get(path).json()
    resumed = client.post(
        path + "/focus-action",
        json={
            "operation_id": "resume-work",
            "expected_revision": current["revision"],
            "expected_generation": current["focus"]["generation"],
            "action": "resume_work",
        },
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["timer"]["focus"]["phase"] == "work"
    assert client.get(path).json()["focus"]["remaining_seconds"] == 60
    assert paused["focus"]["active_seconds"] == 20
    # Ordinary Resume also ends an early break; idle freezes at observation onset.
    timer = resumed.json()["timer"]
    client.post(
        path + "/focus-action",
        json={
            "operation_id": "break-again",
            "expected_revision": timer["revision"],
            "expected_generation": timer["focus"]["generation"],
            "action": "take_break",
        },
    )
    ordinary = client.post(path + "/resume", json={"operation_id": "ordinary-resume"}).json()["timer"]
    assert ordinary["focus"]["phase"] == "work"
    Clock.at += timedelta(seconds=360)
    from timetrace.services.multiple_timer_service import MultipleTimerService

    # The service observation is the daemon's public idle ingress.
    service = MultipleTimerService(db)
    service.observe_activity(300)
    frozen = client.get(path).json()
    assert frozen["state"] == "frozen"
    Clock.at += timedelta(seconds=600)
    assert client.get(path).json()["focus"]["active_seconds"] == 60


def test_focus_defaults_are_durable_receipted_and_future_timer_only(client):
    initial = client.get("/timer-focus/defaults")
    assert initial.status_code == 200
    assert initial.json() == {
        "revision": 0,
        "enabled": False,
        "work_minutes": 25,
        "break_minutes": 5,
        "behavior": "notify_only",
        "sound_enabled": False,
    }
    old = client.post("/timers", json={"operation_id": "old"}).json()["timer"]
    policy = {
        "operation_id": "defaults",
        "expected_revision": 0,
        "enabled": True,
        "work_minutes": 10,
        "break_minutes": 2,
        "behavior": "notify_only",
        "sound_enabled": False,
    }
    saved = client.post("/timer-focus/defaults", json=policy)
    assert saved.status_code == 200, saved.text
    assert client.post("/timer-focus/defaults", json=policy).json() == saved.json()
    assert client.get("/timer-focus/defaults").json()["work_minutes"] == 10
    assert client.get("/timers/" + old["id"]).json()["focus"]["settings"]["enabled"] is False
    new = client.post("/timers", json={"operation_id": "new"}).json()["timer"]
    assert new["focus"]["settings"]["work_minutes"] == 10
    assert new["focus"]["phase"] == "work"
    assert (
        client.post(
            "/timer-focus/defaults",
            json={**policy, "operation_id": "bad", "expected_revision": 1, "work_minutes": True},
        ).status_code
        == 422
    )
