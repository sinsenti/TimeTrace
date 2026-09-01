"""Integration tests for recurring tasks: projection, materialization, and exception handling.

These tests cover the recurrence engine's behavior through the service layer + HTTP API.
Pure `core/recurrence.py` logic (RFC 5545 parsing, DST handling, etc.) is tested in
`test_recurrence.py` and kept separate.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import Session as DBSession
from sqlmodel import select

from timetrace.core.exceptions import ValidationError
from timetrace.db.models import RecurrenceException, Task
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import SessionCreate, SessionUpdate, TaskCreate
from timetrace.services import SessionService, TaskService


class TestRecurringTaskCreation:
    """No pre-generation: creating a task with is_recurring=true yields 0 Session rows."""

    def test_recurring_task_creates_zero_sessions(self, db: DBSession):
        """Creating a recurring task must not pre-generate Session rows."""
        task_service = TaskService(db)
        now = datetime.now(UTC)

        task = task_service.create_task(
            TaskCreate(
                title="Daily standup",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=now,
            )
        )

        assert task.is_recurring
        assert task.recurrence_rrule == "FREQ=DAILY"
        assert task.recurrence_dtstart is not None
        assert task.recurrence_duration_minutes in (15, None)  # default or explicit

        session_count = len(db.exec(select(SessionModel)).all())
        assert session_count == 0, "Creating a recurring task must not pre-generate sessions"

    def test_recurring_task_with_preset_weekdays_creates_rrule(self, db: DBSession):
        """When a preset like 'weekdays' is given, recurrence_rrule is populated."""
        task_service = TaskService(db)
        now = datetime.now(UTC)

        task = task_service.create_task(
            TaskCreate(
                title="Team meeting",
                is_recurring=True,
                recurrence_rule="weekdays",
                recurrence_dtstart=now,
            )
        )

        assert task.recurrence_rrule == "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
        assert task.recurrence_timezone is not None
        assert task.recurrence_duration_minutes is not None

    def test_updating_recurring_task_creates_no_sessions(self, db: DBSession):
        """Updating a recurring task must not create Session rows."""
        from timetrace.interfaces.api.schemas import TaskUpdate

        task_service = TaskService(db)
        now = datetime.now(UTC)

        task = task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=now,
            )
        )

        task_service.update_task(task.id, TaskUpdate(description="Updated description"))

        session_count = len(db.exec(select(SessionModel)).all())
        assert session_count == 0, "Updating a recurring task must not create sessions"


class TestMergeFunnel:
    """Merge funnel: list_sessions returns both real and virtual occurrences."""

    def test_list_sessions_without_bounds_returns_only_real_rows(self, db: DBSession):
        """Without start/end bounds, virtual occurrences are not projected."""
        session_service = SessionService(db)
        task_service = TaskService(db)
        now = datetime.now(UTC)

        # Create a recurring task
        task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=now,
            )
        )

        result = session_service.list_sessions()
        assert len(result) == 0

    def test_list_sessions_with_bounds_includes_virtual_occurrences(self, db: DBSession):
        """With start/end bounds and include_virtual=True, returns virtual occurrences."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        # Create a recurring task starting tomorrow
        tomorrow = datetime.now(UTC) + timedelta(days=1)
        task = task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=tomorrow,
                recurrence_duration_minutes=30,
            )
        )

        # Query for a 7-day window starting from tomorrow
        start = tomorrow
        end = tomorrow + timedelta(days=7)
        result = session_service.list_sessions(start=start, end=end, include_virtual=True)

        # Should have ~7 virtual occurrences
        assert len(result) >= 6, f"Expected at least 6 virtual occurrences, got {len(result)}"
        for occ in result:
            assert occ["is_virtual"] is True
            assert occ["id"].startswith("virt:")
            assert occ["task_id"] == task.id

    def test_list_sessions_with_include_virtual_false_excludes_virtual(self, db: DBSession):
        """With include_virtual=False, returns only real rows."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        # Create a recurring task
        tomorrow = datetime.now(UTC) + timedelta(days=1)
        task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=tomorrow,
            )
        )

        # Query with include_virtual=False
        start = tomorrow
        end = tomorrow + timedelta(days=7)
        result = session_service.list_sessions(start=start, end=end, include_virtual=False)

        # Should return only real rows (none in this case)
        assert len(result) == 0
        for item in result:
            assert item["is_virtual"] is False


class TestMaterialization:
    """Materialization: PUT /sessions/virt:... creates a real row + exception."""

    def test_materialize_virtual_occurrence_creates_session_and_exception(self, db: DBSession):
        """Materializing a virtual occurrence creates a real Session row + override exception."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        # Create a recurring task
        tomorrow = datetime.now(UTC) + timedelta(days=1)
        task = task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=tomorrow,
                recurrence_duration_minutes=30,
            )
        )

        # Get the first virtual occurrence
        start = tomorrow
        end = tomorrow + timedelta(days=7)
        virtuals = session_service.list_sessions(start=start, end=end, include_virtual=True)
        assert len(virtuals) > 0
        first_virt = virtuals[0]
        occurrence_id = first_virt["id"]

        # Materialize it by updating
        materialized = session_service.update_session(
            occurrence_id, SessionUpdate(notes="Materialized")
        )

        # Check it's a real Session row now
        assert not materialized.id.startswith("virt:")
        assert len(materialized.id) == 36  # UUID string
        assert materialized.task_id == task.id
        assert materialized.notes == "Materialized"

        # Check a RecurrenceException was created with kind="override"
        exception = db.exec(
            select(RecurrenceException).where(
                RecurrenceException.task_id == task.id,
                RecurrenceException.kind == "override",
                RecurrenceException.session_id == materialized.id,
            )
        ).first()
        assert exception is not None

        # Verify Session row exists
        session_count = len(db.exec(select(SessionModel)).all())
        assert session_count == 1

    def test_materialized_occurrence_does_not_reappear_as_virtual(self, db: DBSession):
        """After materialization, the same slot does not show a ghost virtual in re-queries."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        tomorrow = datetime.now(UTC) + timedelta(days=1)
        task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=tomorrow,
                recurrence_duration_minutes=30,
            )
        )

        # Get and materialize the first occurrence
        start = tomorrow
        end = tomorrow + timedelta(days=7)
        virtuals = session_service.list_sessions(start=start, end=end, include_virtual=True)
        first_virt_id = virtuals[0]["id"]

        session_service.update_session(first_virt_id, SessionUpdate(notes="Done"))

        # Re-query the same window
        result = session_service.list_sessions(start=start, end=end, include_virtual=True)

        # Should still have ~7 items: 1 real + 6 virtual (not a ghost)
        real_count = sum(1 for r in result if not r["is_virtual"])
        virtual_count = sum(1 for r in result if r["is_virtual"])
        assert real_count == 1, f"Expected 1 real, got {real_count}"
        assert virtual_count >= 6, f"Expected >= 6 virtual, got {virtual_count}"


class TestPastLoggedWorkProtection:
    """Past logged work is protected: delete with scope=all never removes logged sessions."""

    def test_delete_scope_all_keeps_past_logged_row(self, db: DBSession):
        """DELETE with scope='all' must not delete a session with end_time in the past."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        # Create a recurring task
        task = task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=datetime(2026, 1, 1, 8, 0, 0, tzinfo=UTC),
            )
        )

        # Create a past session (logged work)
        past_time = datetime.now(UTC) - timedelta(days=30)
        past_session = session_service.create_session(
            SessionCreate(
                task_id=task.id,
                start_time=past_time,
                end_time=past_time + timedelta(hours=1),
                notes="Past work",
            )
        )

        # Delete with scope='all' - should not touch the past row
        session_service.delete_session(past_session.id, scope="all")

        # Verify the past row still exists
        still_exists = db.get(SessionModel, past_session.id)
        assert still_exists is not None
        assert still_exists.notes == "Past work"

    def test_delete_scope_following_keeps_past_logged_row(self, db: DBSession):
        """DELETE with scope='following' must not delete a session with end_time in the past."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        # Create a recurring task
        task = task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=datetime(2026, 1, 1, 8, 0, 0, tzinfo=UTC),
            )
        )

        # Create a past session
        past_time = datetime.now(UTC) - timedelta(days=30)
        past_session = session_service.create_session(
            SessionCreate(
                task_id=task.id,
                start_time=past_time,
                end_time=past_time + timedelta(hours=1),
                notes="Past work",
            )
        )

        # Delete with scope='following' - should not touch the past row
        session_service.delete_session(past_session.id, scope="following")

        # Verify the past row still exists
        still_exists = db.get(SessionModel, past_session.id)
        assert still_exists is not None


class TestSkip:
    """Skip: DELETE /sessions/virt:... creates a skip exception and hides the ghost."""

    def test_skip_virtual_occurrence_creates_skip_exception(self, db: DBSession):
        """Deleting a virtual occurrence with scope='only_this' creates a skip exception."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        # Create a recurring task
        tomorrow = datetime.now(UTC) + timedelta(days=1)
        created_task = task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=tomorrow,
            )
        )

        # Get a virtual occurrence
        start = tomorrow
        end = tomorrow + timedelta(days=7)
        virtuals = session_service.list_sessions(start=start, end=end, include_virtual=True)
        first_virt_id = virtuals[0]["id"]

        # Delete it with scope='only_this'
        session_service.delete_session(first_virt_id, scope="only_this")

        # Verify a skip exception was created
        exception = db.exec(
            select(RecurrenceException).where(
                RecurrenceException.task_id == created_task.id,
                RecurrenceException.kind == "skip",
                RecurrenceException.session_id.is_(None),
            )
        ).first()
        assert exception is not None

    def test_skipped_occurrence_does_not_reappear(self, db: DBSession):
        """After skipping a virtual occurrence, it does not reappear in re-queries."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        tomorrow = datetime.now(UTC) + timedelta(days=1)
        task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=tomorrow,
            )
        )

        # Get virtuals and skip the first one
        start = tomorrow
        end = tomorrow + timedelta(days=7)
        virtuals = session_service.list_sessions(start=start, end=end, include_virtual=True)
        first_start = datetime.fromisoformat(virtuals[0]["start_time"])
        first_virt_id = virtuals[0]["id"]

        session_service.delete_session(first_virt_id, scope="only_this")

        # Re-query and verify the first day is gone
        result = session_service.list_sessions(start=start, end=end, include_virtual=True)

        # Count occurrences on that day
        skipped_day_start = first_start.replace(hour=0, minute=0, second=0)
        skipped_day_end = skipped_day_start + timedelta(days=1)
        on_skipped_day = [
            r
            for r in result
            if skipped_day_start <= datetime.fromisoformat(r["start_time"]) < skipped_day_end
        ]
        assert len(on_skipped_day) == 0, "Skipped occurrence must not reappear"


class TestScopeValidation:
    """Scope validation: unknown/invalid scopes are rejected."""

    def test_update_scope_unknown_returns_400(self, db: DBSession):
        """Updating with an unknown scope returns ValidationError."""
        session_service = SessionService(db)

        tomorrow = datetime.now(UTC) + timedelta(days=1)
        session = session_service.create_session(
            SessionCreate(
                task_id=None,
                start_time=tomorrow,
                end_time=tomorrow + timedelta(hours=1),
            )
        )

        with pytest.raises(ValidationError):
            session_service.update_session(session.id, SessionUpdate(notes="test"), scope="invalid")

    def test_delete_scope_unknown_returns_400(self, db: DBSession):
        """Deleting with an unknown scope returns ValidationError."""
        session_service = SessionService(db)

        tomorrow = datetime.now(UTC) + timedelta(days=1)
        session = session_service.create_session(
            SessionCreate(
                task_id=None,
                start_time=tomorrow,
                end_time=tomorrow + timedelta(hours=1),
            )
        )

        with pytest.raises(ValidationError):
            session_service.delete_session(session.id, scope="invalid")

    def test_scope_all_future_on_non_recurring_returns_400(self, db: DBSession):
        """Using scope='all_future' on a non-recurring task returns ValidationError."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        # Create a non-recurring task
        task = task_service.create_task(TaskCreate(title="One-off task"))

        tomorrow = datetime.now(UTC) + timedelta(days=1)
        session = session_service.create_session(
            SessionCreate(
                task_id=task.id,
                start_time=tomorrow,
                end_time=tomorrow + timedelta(hours=1),
            )
        )

        with pytest.raises(ValidationError, match="recurring task"):
            session_service.update_session(
                session.id, SessionUpdate(end_time=tomorrow + timedelta(hours=2)), scope="all_future"
            )

    def test_scope_following_on_non_recurring_returns_400(self, db: DBSession):
        """Using scope='following' on a non-recurring task returns ValidationError."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        task = task_service.create_task(TaskCreate(title="One-off task"))
        tomorrow = datetime.now(UTC) + timedelta(days=1)
        session = session_service.create_session(
            SessionCreate(
                task_id=task.id,
                start_time=tomorrow,
                end_time=tomorrow + timedelta(hours=1),
            )
        )

        with pytest.raises(ValidationError, match="recurring task"):
            session_service.delete_session(session.id, scope="following")


class TestSeriesDuration:
    """Series duration: resize with scope='all_future' updates the task."""

    def test_resize_with_scope_all_future_updates_series_duration(self, db: DBSession):
        """Resizing a session with scope='all_future' sets task.recurrence_duration_minutes."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        # Create a recurring task with 30-minute duration at a fixed future time
        dtstart = datetime(2026, 9, 10, 8, 0, 0, tzinfo=UTC)
        task = task_service.create_task(
            TaskCreate(
                title="Daily standup",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=dtstart,
                recurrence_duration_minutes=30,
            )
        )

        # Query for virtuals in a window starting from dtstart
        start = dtstart
        end = dtstart + timedelta(days=7)
        virtuals = session_service.list_sessions(start=start, end=end, include_virtual=True)
        assert len(virtuals) > 0, "Expected virtual occurrences"
        first_virt = virtuals[0]
        first_virt_id = first_virt["id"]

        # Materialize and resize to 60 minutes using scope='all_future'
        new_end = dtstart + timedelta(minutes=60)
        session_service.update_session(
            first_virt_id,
            SessionUpdate(end_time=new_end),
            scope="all_future",
        )

        # Reload the task and check its duration was updated
        updated_task = db.get(Task, task.id)
        assert updated_task.recurrence_duration_minutes == 60

    def test_later_occurrences_reflect_new_duration(self, db: DBSession):
        """After resizing with scope='all_future', later projected occurrences use the new length."""
        session_service = SessionService(db)
        task_service = TaskService(db)

        dtstart = datetime(2026, 9, 10, 8, 0, 0, tzinfo=UTC)
        task = task_service.create_task(
            TaskCreate(
                title="Daily task",
                is_recurring=True,
                recurrence_rule="daily",
                recurrence_dtstart=dtstart,
                recurrence_duration_minutes=30,
            )
        )

        # Query for virtuals and materialize the first with a resize
        start = dtstart
        end = dtstart + timedelta(days=7)
        virtuals = session_service.list_sessions(start=start, end=end, include_virtual=True)
        first_virt_id = virtuals[0]["id"]

        # Resize to 90 minutes with scope='all_future'
        new_end = dtstart + timedelta(minutes=90)
        session_service.update_session(
            first_virt_id,
            SessionUpdate(end_time=new_end),
            scope="all_future",
        )

        # Verify the task duration was updated
        updated_task = db.get(Task, task.id)
        assert updated_task.recurrence_duration_minutes == 90

        # Re-query and verify the second day's occurrence has the new duration
        result = session_service.list_sessions(start=start, end=end, include_virtual=True)
        second_day_start = dtstart + timedelta(days=1)
        second_day_end = second_day_start + timedelta(days=1)
        second_occurrences = [
            r
            for r in result
            if second_day_start <= datetime.fromisoformat(r["start_time"]) < second_day_end
        ]
        assert len(second_occurrences) > 0
        second_occ = second_occurrences[0]
        # Duration should be 90 * 60 = 5400 seconds
        assert second_occ["duration_seconds"] == 5400
