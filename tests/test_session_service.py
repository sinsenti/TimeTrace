"""Tests for services/session_service.py's SessionService.create_session."""

from datetime import UTC, datetime, timedelta

import pytest

from timetrace.core.exceptions import ValidationError
from timetrace.interfaces.api.schemas import SessionCreate, TaskCreate
from timetrace.services import SessionService, TaskService


def test_create_session_rejects_end_equal_to_start(db):
    start = datetime.now(UTC)

    with pytest.raises(ValidationError):
        SessionService(db).create_session(
            SessionCreate(task_id=None, start_time=start, end_time=start)
        )


def test_create_session_rejects_end_before_start(db):
    start = datetime.now(UTC)
    end = start - timedelta(minutes=5)

    with pytest.raises(ValidationError):
        SessionService(db).create_session(
            SessionCreate(task_id=None, start_time=start, end_time=end)
        )


def test_create_session_computes_duration_seconds(db):
    start = datetime(2026, 8, 21, 9, 0, 0, tzinfo=UTC)
    end = start + timedelta(minutes=45)

    session = SessionService(db).create_session(
        SessionCreate(task_id=None, start_time=start, end_time=end, tags="#focus")
    )

    assert session.duration_seconds == 45 * 60


def test_create_session_drops_nonexistent_task_id_instead_of_failing(db):
    start = datetime.now(UTC)
    end = start + timedelta(minutes=30)

    session = SessionService(db).create_session(
        SessionCreate(task_id="does-not-exist", start_time=start, end_time=end)
    )

    assert session.task_id is None


def test_create_session_keeps_valid_task_id(db):
    task = TaskService(db).create_task(TaskCreate(title="Real task"))
    start = datetime.now(UTC)
    end = start + timedelta(minutes=15)

    session = SessionService(db).create_session(
        SessionCreate(task_id=task.id, start_time=start, end_time=end)
    )

    assert session.task_id == task.id
