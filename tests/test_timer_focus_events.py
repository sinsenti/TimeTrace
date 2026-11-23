"""Public evaluator/HTTP proofs; clocks and storage failures are system seams."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import select


@pytest.fixture
def focus_world(client, db, monkeypatch):
    from timetrace.services import multiple_timer_service as module
    from timetrace.services.timer_focus_service import FocusEvaluator

    class Clock(datetime):
        at = datetime(2026, 11, 23, 10, tzinfo=UTC)
        tick = 0.0
        boot = 0.0

        @classmethod
        def now(cls, tz=None):
            return cls.at

        @classmethod
        def advance(cls, seconds, *, sleep=False):
            cls.at += timedelta(seconds=seconds)
            cls.boot += seconds
            if not sleep:
                cls.tick += seconds

    monkeypatch.setattr(module, "datetime", Clock)

    def evaluator():
        return FocusEvaluator(
            db, wall_clock=lambda: Clock.at, monotonic_clock=lambda: Clock.tick, suspend_clock=lambda: Clock.boot
        )

    def start(mode="notify_only"):
        timer = client.post("/timers", json={"operation_id": "start-" + str(Clock.tick)}).json()["timer"]
        path = "/timers/" + timer["id"]
        response = client.post(
            path + "/focus-settings",
            json={
                "operation_id": "enable-" + timer["id"],
                "expected_revision": timer["revision"],
                "enabled": True,
                "work_minutes": 1,
                "break_minutes": 1,
                "behavior": mode,
            },
        )
        assert response.status_code == 200, response.text
        return path

    return Clock, evaluator, start


@pytest.mark.parametrize("action", ["note", "pause", "stop"])
def test_intervening_writer_wins_before_live_boundary(client, focus_world, action):
    clock, factory, start = focus_world
    path = start("automatic_break")
    evaluator = factory()
    evaluator.evaluate()
    clock.advance(59)
    evaluator.evaluate()
    clock.advance(0.5)
    timer = client.get(path).json()
    payload = {"operation_id": "race-" + action, "expected_revision": timer["revision"]}
    if action == "note":
        payload.update(new_notes="Independent note", expected_note_segment_id=None)
    assert client.post(path + "/" + action, json=payload).status_code == 200
    clock.advance(0.5)
    evaluator.evaluate()
    if action == "stop":
        assert not client.get("/timers").json()["timers"]
    else:
        current = client.get(path).json()
        assert current["state"] == ("running" if action == "note" else "paused")
        assert current["focus"]["phase"] == ("work_due" if action == "note" else "work")
    assert not any(n["kind"] == "break_due" for n in client.get("/timer-notifications").json()["notices"])


@pytest.mark.parametrize("behavior", ["notify_only", "automatic_break"])
def test_forward_wall_adjustment_preserves_active_focus(client, focus_world, behavior):
    clock, factory, start = focus_world
    path = start(behavior)
    timer = client.get(path).json()
    assert (
        client.post(
            path + "/focus-settings",
            json={
                "operation_id": "25-minute",
                "expected_revision": timer["revision"],
                "enabled": False,
                "work_minutes": 25,
                "break_minutes": 5,
                "behavior": behavior,
            },
        ).status_code
        == 200
    )
    timer = client.get(path).json()
    assert (
        client.post(
            path + "/focus-settings",
            json={
                "operation_id": "enable-25",
                "expected_revision": timer["revision"],
                "enabled": True,
                "work_minutes": 25,
                "break_minutes": 5,
                "behavior": behavior,
            },
        ).status_code
        == 200
    )
    original = client.get(path).json()
    evaluator = factory()
    evaluator.evaluate()
    clock.at += timedelta(hours=1)
    clock.tick += 1
    clock.boot += 1
    evaluator.evaluate()
    timer = client.get(path).json()
    assert timer["focus"]["phase"] == "work"
    assert timer["focus"]["remaining_seconds"] == 1499
    assert timer["state"] == "running"
    assert timer["segments"] == original["segments"]
    assert timer["identity_started_at"] == original["identity_started_at"]
    assert client.get("/timer-notifications").json()["notices"] == []
    # Another known adjustment crosses the immutable wall warning, not work due.
    clock.at += timedelta(hours=1)
    clock.tick += 1
    clock.boot += 1
    evaluator.evaluate()
    assert client.get(path).json()["focus"]["remaining_seconds"] == 1498
    assert [n["kind"] for n in client.get("/timer-notifications").json()["notices"]] == ["two_hour"]
    clock.advance(1497)
    evaluator.evaluate()
    clock.advance(1)
    evaluator.evaluate()
    timer = client.get(path).json()
    assert timer["focus"]["phase"] == ("break" if behavior == "automatic_break" else "work_due")
    assert sorted(n["kind"] for n in client.get("/timer-notifications").json()["notices"]) == ["two_hour", "work_due"]


@pytest.mark.parametrize("evidence", ["suspend", "missing"])
def test_forward_lapse_without_runtime_proof_catches_up_once(client, focus_world, evidence):
    clock, factory, start = focus_world
    path = start("automatic_break")
    evaluator = factory()
    if evidence == "missing":
        evaluator.suspend_clock = lambda: None
    evaluator.evaluate()
    clock.at += timedelta(hours=1)
    clock.tick += 1
    clock.boot += 3600
    evaluator.evaluate()
    timer = client.get(path).json()
    assert timer["state"] == "running"
    assert timer["segments"] == []
    assert timer["focus"]["phase"] == "work_due"
    assert timer["focus"]["remaining_seconds"] == 0
    notices = client.get("/timer-notifications").json()
    clock.at -= timedelta(hours=1)
    clock.tick += 1
    clock.boot += 1
    evaluator.evaluate()
    assert client.get(path).json()["focus"]["remaining_seconds"] == 0
    assert client.get("/timer-notifications").json() == notices


def test_live_wall_rollback_does_not_rewind_active_focus(client, focus_world):
    clock, factory, start = focus_world
    path = start()
    evaluator = factory()
    evaluator.evaluate()
    clock.advance(30)
    evaluator.evaluate()
    assert client.get(path).json()["focus"]["remaining_seconds"] == 30
    anchor = client.get(path).json()["identity_started_at"]
    clock.at -= timedelta(seconds=20)
    clock.tick += 1
    clock.boot += 1
    evaluator.evaluate()
    assert client.get(path).json()["focus"]["remaining_seconds"] == 29
    assert client.get(path).json()["identity_started_at"] == anchor
    assert client.get(path).json()["segments"] == []


def test_settings_are_next_period_snapshots_not_silent_retiming(client, focus_world):
    clock, factory, start = focus_world
    path = start()
    clock.advance(30)
    current = client.get(path).json()
    updated = client.post(
        path + "/focus-settings",
        json={
            "operation_id": "next-period",
            "expected_revision": current["revision"],
            "enabled": True,
            "work_minutes": 2,
            "break_minutes": 3,
            "behavior": "automatic_break",
        },
    )
    assert updated.status_code == 200
    assert client.get(path).json()["focus"]["remaining_seconds"] == 30
    clock.advance(30)
    factory().evaluate()
    current = client.get(path).json()
    assert current["state"] == "running"
    assert current["focus"]["period"]["behavior"] == "notify_only"
    response = client.post(
        path + "/focus-action",
        json={
            "operation_id": "new-period",
            "expected_revision": current["revision"],
            "expected_generation": current["focus"]["generation"],
            "action": "keep_working",
        },
    )
    assert response.status_code == 200
    assert client.get(path).json()["focus"]["remaining_seconds"] == 120
    assert client.get(path).json()["focus"]["period"]["behavior"] == "automatic_break"


def test_idle_refuses_actions_and_claimed_credit_does_not_add_focus(client, db, focus_world, monkeypatch):
    from timetrace.services import multiple_timer_service as module

    clock, factory, start = focus_world
    monkeypatch.setattr(module.settings, "idle_detection_enabled", True)
    monkeypatch.setattr(module.settings, "idle_threshold_seconds", 60)
    path = start("automatic_break")
    clock.advance(90)
    module.MultipleTimerService(db).observe_activity(60)
    current = client.get(path).json()
    assert current["state"] == "frozen"
    assert current["focus"]["remaining_seconds"] == 30
    gaps = current["idle_gaps"]
    for action in ("take_break", "keep_working", "resume_work"):
        assert (
            client.post(
                path + "/focus-action",
                json={
                    "operation_id": action,
                    "expected_revision": current["revision"],
                    "expected_generation": current["focus"]["generation"],
                    "action": action,
                },
            ).status_code
            == 409
        )
    clock.advance(7200)
    factory().evaluate()
    current = client.get(path).json()
    assert current["idle_gaps"] == gaps
    assert [n["kind"] for n in client.get("/timer-notifications").json()["notices"]] == ["two_hour"]
    module.MultipleTimerService(db).observe_activity(0)
    current = client.get(path).json()
    result = client.post(
        path + "/resolve",
        json={"operation_id": "claim-idle", "gap_id": current["idle_gaps"][0]["id"], "decision": "claim"},
    )
    assert result.status_code == 200, result.text
    assert client.get(path).json()["state"] == "paused"
    assert client.get(path).json()["focus"]["remaining_seconds"] == 30


def test_unknown_old_anchor_is_initialized_prospectively_not_on_get(client, db, focus_world):
    import json
    import os
    from pathlib import Path

    from timetrace.db.models import MutationOperation

    clock, factory, start = focus_world
    path = start()
    file = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"])
    state = json.loads(file.read_text())
    timer = state["timers"][path.split("/")[-1]]
    timer.pop("identity_started_at")
    timer.pop("identity_started_at_provenance")
    timer.pop("focus")
    for row in db.exec(select(MutationOperation)).all():
        db.delete(row)
    db.commit()
    file.write_text(json.dumps(state))
    original = file.read_bytes()
    assert "identity_started_at" not in client.get(path).json()
    assert file.read_bytes() == original
    clock.advance(10000)
    factory().evaluate()
    current = client.get(path).json()
    assert current["identity_started_at"] == clock.at.isoformat()
    assert current["identity_started_at_provenance"] == "prospective_unknown_history"
    assert client.get("/timer-notifications").json()["notices"] == []
    clock.advance(7200)
    factory().evaluate()
    assert [n["kind"] for n in client.get("/timer-notifications").json()["notices"]] == ["two_hour"]
    assert client.post(path + "/focus_evaluate", json={"operation_id": "not-a-daemon"}).status_code == 400


def test_automatic_boundary_only_its_timer_break_waits_and_claims_once(client, focus_world):
    clock, factory, start = focus_world
    path = start("automatic_break")
    clock.advance(0.1)
    other = start()
    evaluator = factory()
    evaluator.evaluate()
    clock.advance(58.9)
    evaluator.evaluate()
    clock.advance(1)
    evaluator.evaluate()
    timer = client.get(path).json()
    assert timer["state"] == "paused"
    assert timer["focus"]["phase"] == "break"
    assert timer["manual_pause_note_segment_id"] is None
    assert timer["segments"][0]["end_time"] == "2026-11-23T10:01:00+00:00"
    assert client.get(other).json()["state"] == "running"
    clock.advance(60)
    evaluator.evaluate()
    current = client.get(path).json()
    assert current["state"] == "paused"
    assert current["focus"]["phase"] == "break_due"
    notice = next(n for n in client.get("/timer-notifications").json()["notices"] if n["kind"] == "break_due")
    route = "/timer-notifications/" + notice["id"]
    rev = current["revision"]
    claim = client.post(route + "/claim", json={"operation_id": "tab-one", "channel": "browser"})
    assert claim.status_code == 200, claim.text
    assert claim.json()["send_authorized"] is True
    replay = client.post(route + "/claim", json={"operation_id": "tab-one", "channel": "browser"})
    assert replay.json()["send_authorized"] is False
    assert client.post(route + "/claim", json={"operation_id": "tab-two", "channel": "native"}).status_code == 409
    token = claim.json()["claim_token"]
    assert "claim_token" not in client.get("/timer-notifications").text
    assert client.post(route + "/result", json={"claim_token": token, "outcome": "accepted"}).status_code == 200
    assert client.get(path).json()["revision"] == rev
    assert client.post(route + "/ack").json()["acknowledged"] is True
    assert client.post(route + "/ack").json()["status"] == "accepted"
    assert client.get(path).json()["revision"] == rev
    assert client.post(route + "/result", json={"claim_token": token, "outcome": "failed"}).status_code == 409


def test_corrections_do_not_shift_focus_and_claim_does_not_stale_signed_preview(
    client, focus_world, tmp_path, monkeypatch
):
    from timetrace.config import settings

    monkeypatch.setattr(settings, "db_file", tmp_path / "isolated.db")
    clock, factory, start = focus_world
    path = start()
    assert client.post("/timers/correction-initialize", json={"operation_id": "init"}).status_code == 200
    clock.advance(30)
    before = client.get(path).json()
    preview = client.post(
        path + "/correction-preview",
        json={
            "target": {"kind": "running", "segment_id": before["running_segment_id"]},
            "change": {"kind": "step_start", "credited_delta_seconds": 300},
        },
    )
    assert preview.status_code == 200, preview.text
    corrected = client.post(path + "/correction", json={"operation_id": "correct", "preview": preview.json()})
    assert corrected.status_code == 200, corrected.text
    assert client.get(path).json()["focus"]["remaining_seconds"] == 30
    clock.advance(30)
    factory().evaluate()
    current = client.get(path).json()
    approval = client.post(
        path + "/correction-preview",
        json={
            "target": {"kind": "running", "segment_id": current["running_segment_id"]},
            "change": {"kind": "step_start", "credited_delta_seconds": -300},
        },
    )
    assert approval.status_code == 200, approval.text
    event = client.get("/timer-notifications").json()["notices"][0]
    claim = client.post(
        "/timer-notifications/" + event["id"] + "/claim", json={"operation_id": "external-send", "channel": "native"}
    )
    assert claim.status_code == 200
    assert (
        client.post(
            path + "/correction", json={"operation_id": "correct-after-claim", "preview": approval.json()}
        ).status_code
        == 200
    )
    # Unknown external send cannot turn into another native attempt on restart/tab.
    assert (
        client.post(
            "/timer-notifications/" + event["id"] + "/claim", json={"operation_id": "new-attempt", "channel": "native"}
        ).status_code
        == 409
    )
    assert client.get(path).json()["identity_started_at"] == before["identity_started_at"]


@pytest.mark.parametrize("discontinuity", ["late", "sleep", "restart", "rollback"])
def test_lost_continuity_catches_up_without_inventing_break(client, focus_world, discontinuity):
    clock, factory, start = focus_world
    path = start("automatic_break")
    evaluator = factory()
    evaluator.evaluate()
    clock.advance(59)
    evaluator.evaluate()
    if discontinuity == "restart":
        evaluator = factory()
        clock.advance(1)
    elif discontinuity == "sleep":
        clock.advance(1, sleep=True)
    elif discontinuity == "rollback":
        clock.advance(-60)
        evaluator.evaluate()
        clock.advance(61)
    else:
        clock.advance(10)
    evaluator.evaluate()
    timer = client.get(path).json()
    assert timer["state"] == "running"
    assert timer["segments"] == []
    assert timer["focus"]["phase"] == "work_due"
    first = client.get("/timer-notifications").json()
    factory().evaluate()
    assert client.get("/timer-notifications").json() == first
    assert len(first["notices"]) == 1
    assert client.post(path + "/stop", json={"operation_id": "stop"}).status_code == 200
    clock.advance(7200)
    evaluator.evaluate()
    assert not any(n["kind"] == "two_hour" for n in client.get("/timer-notifications").json()["notices"])
    notice = client.get("/timer-notifications").json()["notices"][0]
    assert notice["status"] == "cancelled"
    assert (
        client.post(
            "/timer-notifications/" + notice["id"] + "/claim", json={"operation_id": "too-late", "channel": "in_app"}
        ).status_code
        == 409
    )
