"""Delivery transport is fake: no OS notifications or sound."""

import asyncio
import os
from datetime import datetime, timedelta
from pathlib import Path

import pytest


@pytest.mark.parametrize("outcome", ["accepted", "failed", "unknown"])
def test_daemon_runtime_claims_once_and_never_mutates_work_for_send(client, db, outcome):
    from timetrace.services.focus_runtime import FocusRuntime
    from timetrace.services.timer_focus_service import FocusEvaluator

    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    path = "/timers/" + timer["id"]
    client.post(
        path + "/focus-settings",
        json={
            "operation_id": "focus",
            "expected_revision": 1,
            "enabled": True,
            "work_minutes": 1,
            "break_minutes": 1,
            "behavior": "notify_only",
        },
    )
    at = datetime.fromisoformat(timer["identity_started_at"]) + timedelta(seconds=61)

    class Fake:
        sends = []

        def capability(self):
            return {"available": True}

        def send(self, event, *, sound):
            self.sends.append((event["id"], sound))
            return outcome

    adapter = Fake()
    runtime = FocusRuntime(
        db.get_bind(), adapter, evaluator_factory=lambda session: FocusEvaluator(session, wall_clock=lambda: at)
    )
    runtime.tick()
    current = client.get(path).json()
    revision = current["revision"]
    persisted = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"]).read_bytes()
    runtime.tick()
    assert Path(os.environ["TIMETRACE_TIMER_STATE_FILE"]).read_bytes() == persisted
    assert len(adapter.sends) == 1
    assert adapter.sends[0][1] is False
    assert current["state"] == "running"
    assert client.get(path).json()["revision"] == revision
    assert client.get("/timer-notifications").json()["notices"][0]["status"] == outcome


def test_runtime_cancellation_waits_for_inflight_tick():
    from threading import Event

    from timetrace.services.focus_runtime import FocusRuntime

    started, release, finished = Event(), Event(), Event()
    runtime = FocusRuntime(None, None)

    def tick():
        started.set()
        release.wait(2)
        finished.set()

    runtime.tick = tick

    async def scenario():
        task = asyncio.create_task(runtime.run(interval=0.001))
        await asyncio.to_thread(started.wait, 2)
        task.cancel()
        await asyncio.sleep(0.01)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert finished.is_set()

    asyncio.run(scenario())


def test_actual_lifespan_starts_and_awaits_focus_independent_of_idle(monkeypatch):
    from threading import Event

    from fastapi.testclient import TestClient

    from timetrace.config import settings
    from timetrace.main import create_daemon_app

    started, finished = Event(), Event()

    class Runtime:
        def __init__(self, *args):
            pass

        async def run(self):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                finished.set()

    monkeypatch.setattr(settings, "idle_detection_enabled", False)
    with TestClient(create_daemon_app(notification_adapter=object(), focus_runtime_factory=Runtime)) as client:
        assert client.get("/health").status_code == 200
        assert started.wait(2)
    assert finished.is_set()


@pytest.mark.parametrize(
    "environment,platform",
    [({}, "linux"), ({"SSH_CONNECTION": "yes"}, "linux"), ({}, "win32"), ({"WSL_DISTRO_NAME": "fake"}, "linux")],
)
def test_unavailable_platforms_never_invoke_transport(environment, platform):
    from timetrace.services.notification_delivery import LinuxNotifications

    def forbidden(*args, **kwargs):
        raise AssertionError("No external IO authorized")

    adapter = LinuxNotifications(transport=forbidden, environment=environment, platform=platform, executable="/fake")
    assert adapter.capability()["available"] is False
    assert adapter.send({"kind": "work_due", "timer_id": "timer"}, sound=True) == "failed"


def test_linux_timeout_after_submission_is_unknown_not_retryable():
    import subprocess

    from timetrace.services.notification_delivery import LinuxNotifications

    def transport(args, **kwargs):
        if args[-1].endswith("GetCapabilities"):
            return subprocess.CompletedProcess(args, 0, "(['sound'],)", "")
        assert "{'suppress-sound': <false>}" in args
        raise subprocess.TimeoutExpired(args, 2)

    adapter = LinuxNotifications(
        transport=transport,
        environment={"DBUS_SESSION_BUS_ADDRESS": "fake", "DISPLAY": ":fake"},
        platform="linux",
        executable="/fake",
    )
    assert adapter.send({"kind": "work_due", "timer_id": "timer"}, sound=True) == "unknown"


def test_linux_adapter_is_bounded_argument_safe_and_sound_off():
    from timetrace.services.notification_delivery import LinuxNotifications

    calls = []

    def transport(args, **kwargs):
        from subprocess import CompletedProcess

        calls.append((args, kwargs))
        return CompletedProcess(
            args, 0, "(['body', 'sound'],)" if args[-1].endswith("GetCapabilities") else "(uint32 7,)", ""
        )

    adapter = LinuxNotifications(
        transport=transport,
        environment={"DBUS_SESSION_BUS_ADDRESS": "unix:path=/synthetic", "DISPLAY": ":fake"},
        platform="linux",
        executable="/fake/gdbus",
    )
    assert adapter.capability()["available"] is True
    assert adapter.send({"kind": "work_due", "timer_id": "quoted; no shell"}, sound=False) == "accepted"
    command, options = calls[-1]
    assert options["timeout"] == 2
    assert options.get("shell", False) is False
    assert "{'suppress-sound': <true>}" in command
    assert len(calls) == 2
