"""Tests for core/timer.py's ActiveTimerState (file-backed singleton).

reset_timer (autouse, in conftest.py) resets timer_manager before every test,
so these don't leak state into each other.
"""

from datetime import UTC, datetime, timedelta

import pytest

from timetrace.core.timer import timer_manager


def test_start_sets_running_state():
    status = timer_manager.start(task_id="t1", task_title="Write tests", tags="#work")

    assert timer_manager.is_running is True
    assert timer_manager.task_id == "t1"
    assert status["is_running"] is True
    assert status["task_id"] == "t1"


def test_start_while_running_raises():
    timer_manager.start(task_id="t1")

    with pytest.raises(ValueError):
        timer_manager.start(task_id="t2")


def test_stop_computes_duration_and_clears_state():
    timer_manager.start(task_id="t1", task_title="Focus block", tags="#deep")
    timer_manager.start_time = datetime.now(UTC) - timedelta(seconds=100)

    summary = timer_manager.stop()

    assert summary["duration_seconds"] == pytest.approx(100, abs=2)
    assert summary["task_id"] == "t1"
    assert summary["task_title"] == "Focus block"
    assert timer_manager.is_running is False
    assert timer_manager.task_id is None
    assert timer_manager.start_time is None


def test_stop_with_no_active_timer_raises():
    with pytest.raises(ValueError):
        timer_manager.stop()


def test_split_stops_current_segment_and_starts_a_new_one_for_same_task():
    timer_manager.start(task_id="t1", task_title="Big task", tags="#a", notes="first half")
    timer_manager.start_time = datetime.now(UTC) - timedelta(seconds=60)

    stopped_summary = timer_manager.split(new_tags="#b", new_notes="second half")

    # The old segment was closed out with the OLD tags/notes and ~60s duration.
    assert stopped_summary["duration_seconds"] == pytest.approx(60, abs=2)
    assert stopped_summary["tags"] == "#a"
    assert stopped_summary["notes"] == "first half"

    # A brand new segment is running immediately, same task, new tags/notes.
    assert timer_manager.is_running is True
    assert timer_manager.task_id == "t1"
    assert timer_manager.task_title == "Big task"
    assert timer_manager.tags == "#b"
    assert timer_manager.notes == "second half"


def test_freeze_for_idle_cuts_session_at_idle_start_and_builds_pending_gap():
    timer_manager.start(task_id="t1", task_title="Deep work", tags="#focus", notes="")
    # Pretend the timer has been running for 10 minutes, and the user has been
    # idle for the last 4 of those minutes.
    timer_manager.start_time = datetime.now(UTC) - timedelta(minutes=10)
    idle_seconds = 4 * 60

    gap = timer_manager.freeze_for_idle(idle_seconds)

    # duration_before_idle should be ~6 minutes (360s), i.e. the timer was cut
    # retroactively at the moment idleness began, not at "now".
    saved = gap["saved_session"]
    assert saved["duration_seconds"] == pytest.approx(360, abs=2)
    assert saved["task_id"] == "t1"
    assert saved["task_title"] == "Deep work"

    assert gap["idle_seconds"] == idle_seconds
    assert gap["task_id"] == "t1"

    # The running timer itself is now frozen, not stopped/cleared.
    assert timer_manager.is_running is False
    assert timer_manager.is_frozen_idle is True
    assert timer_manager.pending_idle_gap is not None
    assert timer_manager.task_id == "t1"  # task context preserved for resolution


def test_freeze_for_idle_clamps_when_idle_duration_exceeds_elapsed_time():
    timer_manager.start(task_id="t1", tags="#x")
    timer_manager.start_time = datetime.now(UTC) - timedelta(seconds=30)

    # Report far more idle time than the timer has even been running.
    gap = timer_manager.freeze_for_idle(idle_seconds=9999)

    # idle_start_time is clamped to start_time, so duration_before_idle is 0,
    # never negative.
    assert gap["saved_session"]["duration_seconds"] == 0


def test_freeze_for_idle_when_not_running_returns_empty_dict():
    assert timer_manager.is_running is False

    assert timer_manager.freeze_for_idle(60) == {}


def test_resolve_idle_gap_clears_state_and_returns_the_gap():
    timer_manager.start(task_id="t1", task_title="Deep work", tags="#focus")
    timer_manager.start_time = datetime.now(UTC) - timedelta(minutes=5)
    gap = timer_manager.freeze_for_idle(60)

    resolved = timer_manager.resolve_idle_gap()

    assert resolved == gap
    assert timer_manager.is_frozen_idle is False
    assert timer_manager.pending_idle_gap is None
    assert timer_manager.task_id is None
    assert timer_manager.task_title is None
    assert timer_manager.start_time is None
    assert timer_manager.tags == ""
    assert timer_manager.notes == ""


def test_resolve_idle_gap_with_nothing_pending_returns_none():
    assert timer_manager.resolve_idle_gap() is None
