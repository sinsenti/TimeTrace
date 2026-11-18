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
from timetrace.core.recurrence import format_occurrence_id
from timetrace.db.models import RecurrenceException, Task
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import SessionCreate, SessionUpdate, TaskCreate, TaskUpdate
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services import SessionService, TaskService
from timetrace.services.recurrence_service import RecurrenceService


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
        materialized = session_service.update_session(occurrence_id, SessionUpdate(notes="Materialized"))

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
            r for r in result if skipped_day_start <= datetime.fromisoformat(r["start_time"]) < skipped_day_end
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

        # Keep this relative to the clock so the projection remains future-visible.
        dtstart = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
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

        dtstart = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
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
            r for r in result if second_day_start <= datetime.fromisoformat(r["start_time"]) < second_day_end
        ]
        assert len(second_occurrences) > 0
        second_occ = second_occurrences[0]
        # Duration should be 90 * 60 = 5400 seconds
        assert second_occ["duration_seconds"] == 5400


def _row_start(row) -> datetime:
    """Naive-UTC start of a merged row, whether it came back as a model or a dict."""
    value = row["start_time"] if isinstance(row, dict) else row.start_time
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.replace(tzinfo=None) if value.tzinfo else value


def _mk_task(db: DBSession, dtstart, dur=30, rrule="FREQ=DAILY", tz="UTC", **kw) -> Task:
    task = Task(
        title=kw.pop("title", "Standup"),
        is_recurring=True,
        recurrence_rrule=rrule,
        recurrence_dtstart=dtstart,
        recurrence_duration_minutes=dur,
        recurrence_timezone=tz,
        status="To Do",
        **kw,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


class TestReconcileHorizon:
    """Regression for review defect 1: reconcile_series must never judge an exception stale
    just because it sits beyond the horizon it actually expanded (day-400 cutoff or the
    occurrence cap, whichever the rule hits first)."""

    def test_skip_beyond_occurrence_cap_survives_reconcile(self, db: DBSession):
        """A high-frequency rule can hit MAX_OCCURRENCES_PER_SERIES well inside the 400-day
        window; a skip past that point must not be treated as stale and undone."""
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        task = _mk_task(
            db,
            dtstart=now + timedelta(minutes=5),
            dur=15,
            rrule="FREQ=DAILY;BYHOUR=8,10,12,14,16",
            title="Micro",
        )
        svc = RecurrenceService(db)
        far_start = datetime.now(UTC) + timedelta(days=300)
        occ = svc.project_task(task, far_start, far_start + timedelta(days=30))
        assert occ, "expected occurrences deep into the window"
        svc.skip(task.id, occ[0].start_utc)
        assert len(db.exec(select(RecurrenceException)).all()) == 1

        RecurrenceService(db).reconcile_series(task.id)

        remaining = db.exec(select(RecurrenceException)).all()
        assert len(remaining) == 1, "far-future skip was silently deleted by reconcile"

    def test_skip_beyond_400_day_window_survives_reconcile(self, db: DBSession):
        """A skip beyond the 400-day expansion window must not be undone by a later reconcile,
        and the occurrence it cancelled must stay hidden."""
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        _mk_task(db, dtstart=(now + timedelta(days=1)).replace(hour=9, minute=0))
        far = datetime.now(UTC) + timedelta(days=500)
        rows = SessionService(db).list_sessions(far, far + timedelta(days=30))
        virts = [r for r in rows if r["is_virtual"]]
        assert virts
        SessionService(db).delete_session(virts[0]["id"], scope="only_this")

        rows2 = SessionService(db).list_sessions(far, far + timedelta(days=30))
        assert virts[0]["id"] not in [r["id"] for r in rows2], "skip undone; occurrence reappeared"

    def test_override_beyond_400_days_does_not_double_render(self, db: DBSession):
        """Materializing an occurrence beyond the 400-day window must not leave both the real
        row and a ghost virtual rendering at the same instant after reconcile runs again."""
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        _mk_task(db, dtstart=(now + timedelta(days=1)).replace(hour=9, minute=0))
        far = datetime.now(UTC) + timedelta(days=500)
        rows = SessionService(db).list_sessions(far, far + timedelta(days=30))
        vid = [r for r in rows if r["is_virtual"]][0]["id"]
        SessionService(db).update_session(vid, SessionUpdate(notes="planned ahead"))

        rows2 = SessionService(db).list_sessions(far, far + timedelta(days=30))
        at_same_instant = [r for r in rows2 if r["start_time"] == rows[0]["start_time"]]
        assert len(at_same_instant) == 1, "occurrence rendered twice (real row + ghost virtual)"


class TestTruncateAtFirstOccurrence:
    """Regression for review defect 2: truncating a series at or before its first occurrence
    must not persist an UNTIL-before-DTSTART rule that bricks every later task update."""

    def test_truncate_at_first_occurrence_ends_series_instead_of_bricking_it(self, db: DBSession):
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        task = _mk_task(db, dtstart=(now + timedelta(days=1)).replace(hour=9, minute=0))

        rows = SessionService(db).list_sessions(datetime.now(UTC), datetime.now(UTC) + timedelta(days=5))
        first = [r for r in rows if r["is_virtual"]][0]

        SessionService(db).delete_session(first["id"], scope="following")

        db.refresh(task)
        assert task.is_recurring is False
        assert task.recurrence_rrule is None

        # A later, unrelated edit must not 400.
        updated = TaskService(db).update_task(task.id, TaskUpdate(title="Standup renamed"))
        assert updated.title == "Standup renamed"


class TestAdoptionOwnership:
    """Regression for review defect 3: adoption in reconcile_series must only ever claim rows
    carrying the old pre-generator's fingerprint, never a user's own session that happens to
    coincide with a projected occurrence's instant."""

    def test_user_created_row_is_never_adopted_or_destroyed(self, db: DBSession):
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        anchor = (now + timedelta(days=1)).replace(hour=9, minute=0)
        task = _mk_task(db, dtstart=anchor)

        own = SessionModel(
            task_id=task.id,
            start_time=anchor,
            end_time=anchor + timedelta(hours=2),
            duration_seconds=7200,
            tags="",
            notes="my own deep-work block",
        )
        db.add(own)
        db.commit()
        db.refresh(own)

        svc = SessionService(db)
        rows = svc.list_sessions(datetime.now(UTC), datetime.now(UTC) + timedelta(days=3))

        # The user's row must not have been converted into an `override` exception.
        adopted = db.exec(select(RecurrenceException).where(RecurrenceException.session_id == own.id)).first()
        assert adopted is None, "user's own session was adopted into the series"

        # Deleting a *different* occurrence with scope='all' must not destroy the user's row.
        virt = [r for r in rows if r["is_virtual"] and r["id"] != own.id]
        assert virt
        SessionService(db).delete_session(virt[0]["id"], scope="all")

        assert db.get(SessionModel, own.id) is not None, "user's own session was destroyed"


class TestInProgressOccurrence:
    """Regression for review defect 4: an occurrence that has started but not yet ended must
    still project -- it is neither a real row nor a past gap that "did not happen"."""

    def test_in_progress_occurrence_still_projects(self, db: DBSession):
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        started = now - timedelta(minutes=10)
        _mk_task(db, dtstart=started, dur=60)

        # Anchor the window on the occurrence itself, not on the calendar day: at 00:07 UTC an
        # occurrence starting 10 minutes ago began *yesterday*, so a today-shaped window would
        # exclude it by construction and the test would pass or fail depending on the hour.
        rows = SessionService(db).list_sessions(
            (started - timedelta(hours=1)).replace(tzinfo=UTC),
            (started + timedelta(hours=3)).replace(tzinfo=UTC),
        )
        # Assert the *in-progress* occurrence specifically. A bare `any(is_virtual)` would also
        # be satisfied by a later occurrence of the same daily rule, and would still pass with
        # the carve-out removed entirely.
        assert any(r["is_virtual"] and _row_start(r) == started for r in rows), (
            "in-progress occurrence dropped from the calendar"
        )

    def test_fully_elapsed_occurrence_still_does_not_project(self, db: DBSession):
        """The future-only contract otherwise stays intact: an occurrence that has fully ended
        must not appear just because the in-progress carve-out exists."""
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        started = now - timedelta(hours=2)
        _mk_task(db, dtstart=started, dur=30)

        rows = SessionService(db).list_sessions(
            (started - timedelta(hours=1)).replace(tzinfo=UTC),
            (started + timedelta(hours=3)).replace(tzinfo=UTC),
        )
        # Only the elapsed instant must be absent. Asserting "no virtual rows at all" is
        # clock-dependent: a daily rule anchored 2h ago also has an occurrence later in this
        # same UTC-day window whenever `now` is before 02:00 UTC, and that one is legitimately
        # in the future.
        assert not any(r["is_virtual"] and _row_start(r) == started for r in rows), (
            "fully elapsed occurrence still projected"
        )


class TestMaterializePastOccurrence:
    """Regression for review defect 5: materializing an already-elapsed occurrence via a
    crafted `virt:` id must be refused, not silently fabricate a completed session."""

    def test_materialize_past_occurrence_raises(self, db: DBSession):
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        anchor = (now - timedelta(days=10)).replace(hour=9, minute=0)
        task = _mk_task(db, dtstart=anchor)
        past_id = format_occurrence_id(task.id, (now - timedelta(days=5)).replace(hour=9, minute=0))

        with pytest.raises(ValidationError):
            SessionService(db).update_session(past_id, SessionUpdate(notes="x"))

    def test_materialize_in_progress_occurrence_still_works(self, db: DBSession):
        """The in-progress case must remain materializable -- this is exactly the "I'm working
        it now" scenario defect 4 protects on the read side."""
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        started = now - timedelta(minutes=10)
        task = _mk_task(db, dtstart=started, dur=60)
        in_progress_id = format_occurrence_id(task.id, started)

        materialized = SessionService(db).update_session(in_progress_id, SessionUpdate(notes="working on it"))
        assert materialized.task_id == task.id
        assert materialized.notes == "working on it"


class TestGhostSuppressionOnCoveredOccurrence:
    """Regression: a real session that coincides with (or overlaps) a projected occurrence of
    the same task must suppress that occurrence's `virt:` ghost at display time -- without
    writing a `RecurrenceException`, so the real row stays fully deletable and unrelated
    scope='all' deletes cannot touch it (adoption was narrowed on purpose; see
    `TestAdoptionOwnership` and the `_LEGACY_PLACEHOLDER_PREFIX` comment in
    `recurrence_service.py`)."""

    def test_exact_start_match_suppresses_the_ghost(self, db: DBSession):
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        anchor = (now + timedelta(days=1)).replace(hour=9, minute=0)
        task = _mk_task(db, dtstart=anchor, dur=30)

        own = SessionModel(
            task_id=task.id,
            start_time=anchor,
            end_time=anchor + timedelta(minutes=30),
            duration_seconds=1800,
            tags="",
            notes="my own session at the usual time",
        )
        db.add(own)
        db.commit()
        db.refresh(own)

        rows = SessionService(db).list_sessions(
            (anchor - timedelta(hours=1)).replace(tzinfo=UTC), (anchor + timedelta(hours=3)).replace(tzinfo=UTC)
        )
        at_anchor = [r for r in rows if r["start_time"] == ensure_utc(anchor).isoformat()]
        assert len(at_anchor) == 1, "expected exactly one row (the real session) at the occurrence instant"
        assert at_anchor[0]["is_virtual"] is False
        assert at_anchor[0]["id"] == own.id

        # No exception/ownership claim was created by the suppression.
        assert db.exec(select(RecurrenceException).where(RecurrenceException.session_id == own.id)).first() is None

    def test_overlapping_block_suppresses_the_ghost_it_covers(self, db: DBSession):
        """A 09:00-11:00 block plainly covers a 09:00-09:30 occurrence; the ghost must not
        render inside it even though the real session's start_time is what changed, not an
        exact instant match against the projected slot."""
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        anchor = (now + timedelta(days=1)).replace(hour=9, minute=0)
        task = _mk_task(db, dtstart=anchor, dur=30)

        own = SessionModel(
            task_id=task.id,
            start_time=anchor,
            end_time=anchor + timedelta(hours=2),
            duration_seconds=7200,
            tags="",
            notes="deep work block covering the usual slot",
        )
        db.add(own)
        db.commit()

        rows = SessionService(db).list_sessions(
            (anchor - timedelta(hours=1)).replace(tzinfo=UTC), (anchor + timedelta(hours=3)).replace(tzinfo=UTC)
        )
        virtual_at_anchor = [r for r in rows if r["is_virtual"] and r["start_time"] == ensure_utc(anchor).isoformat()]
        assert virtual_at_anchor == [], "ghost still rendered inside the user's covering block"

    def test_different_task_at_same_instant_does_not_suppress(self, db: DBSession):
        """A real session belonging to a *different* task at the same instant must not hide the
        series' own ghost -- suppression is scoped per task_id."""
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        anchor = (now + timedelta(days=1)).replace(hour=9, minute=0)
        task = _mk_task(db, dtstart=anchor, dur=30)
        other_task = _mk_task(db, dtstart=anchor + timedelta(days=100), dur=30, title="Unrelated")

        other = SessionModel(
            task_id=other_task.id,
            start_time=anchor,
            end_time=anchor + timedelta(minutes=30),
            duration_seconds=1800,
            tags="",
            notes="unrelated work",
        )
        db.add(other)
        db.commit()

        rows = SessionService(db).list_sessions(
            (anchor - timedelta(hours=1)).replace(tzinfo=UTC), (anchor + timedelta(hours=3)).replace(tzinfo=UTC)
        )
        anchor_iso = ensure_utc(anchor).isoformat()
        virtual_at_anchor = [
            r for r in rows if r["is_virtual"] and r["task_id"] == task.id and r["start_time"] == anchor_iso
        ]
        assert len(virtual_at_anchor) == 1, "unrelated task's session incorrectly suppressed this series' ghost"

    def test_own_row_survives_scope_all_delete_of_a_different_occurrence(self, db: DBSession):
        """Critical: suppression must not sneak ownership back in. Deleting an unrelated future
        occurrence with scope='all' must never destroy the user's own covering session."""
        now = datetime.now(UTC).replace(tzinfo=None, microsecond=0, second=0)
        anchor = (now + timedelta(days=1)).replace(hour=9, minute=0)
        task = _mk_task(db, dtstart=anchor, dur=30)

        own = SessionModel(
            task_id=task.id,
            start_time=anchor,
            end_time=anchor + timedelta(minutes=30),
            duration_seconds=1800,
            tags="",
            notes="my own session",
        )
        db.add(own)
        db.commit()
        db.refresh(own)

        svc = SessionService(db)
        rows = svc.list_sessions(datetime.now(UTC), datetime.now(UTC) + timedelta(days=3))
        other_ghosts = [r for r in rows if r["is_virtual"] and r["id"] != own.id]
        assert other_ghosts, "expected other days' occurrences to still project"

        svc.delete_session(other_ghosts[0]["id"], scope="all")

        assert db.get(SessionModel, own.id) is not None, "user's own covering session was destroyed"
        assert db.exec(select(RecurrenceException).where(RecurrenceException.session_id == own.id)).first() is None


def test_typed_occurrence_edit_captures_projected_interval_and_returns_real_plan(client, db):
    anchor = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    task = _mk_task(db, dtstart=anchor, dur=30)
    virtual_id = format_occurrence_id(task.id, anchor.replace(tzinfo=None))
    path = f"/scheduled-sessions/{virtual_id}"
    read = client.get(path)
    assert read.status_code == 200, read.text
    projected = read.json()
    assert projected["is_virtual"]
    moved_start = anchor + timedelta(hours=2)
    moved_end = moved_start + timedelta(hours=1)
    saved = client.put(
        path,
        json={
            "start_time": moved_start.isoformat(),
            "end_time": moved_end.isoformat(),
            "expected_projection_revision": projected["projection_revision"],
        },
    )
    assert saved.status_code == 200, saved.text
    plan = saved.json()
    assert plan["id"] != virtual_id
    assert not plan["is_virtual"]
    assert plan["kind"] == "scheduled_session"
    assert datetime.fromisoformat(plan["original_start"]) == anchor
    assert datetime.fromisoformat(plan["original_end"]) == anchor + timedelta(minutes=30)
    assert datetime.fromisoformat(plan["start_time"]) == moved_start
    assert datetime.fromisoformat(plan["end_time"]) == moved_end
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan
    agenda = client.get("/agenda", params={"start": anchor.isoformat(), "end": moved_end.isoformat()})
    assert agenda.json()["items"] == [plan]
    assert client.get("/sessions").json() == []


def test_typed_all_future_resize_captures_before_changing_series_duration(client, db):
    anchor = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    task = _mk_task(db, dtstart=anchor, dur=30)
    path = "/scheduled-sessions/" + format_occurrence_id(task.id, anchor.replace(tzinfo=None))
    following = anchor + timedelta(days=1)
    next_path = "/scheduled-sessions/" + format_occurrence_id(task.id, following.replace(tzinfo=None))
    old = client.get(path).json()
    next_old = client.get(next_path).json()
    resize = {"start_time": anchor.isoformat(), "end_time": (anchor + timedelta(hours=1)).isoformat()}
    response = client.put(
        path + "?scope=all_future",
        json={
            **resize,
            "expected_projection_revision": old["projection_revision"],
        },
    )
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan["original_end"] == old["end_time"]
    assert plan["duration_seconds"] == 3600
    assert client.get(next_path).json()["duration_seconds"] == 3600
    stale = client.put(
        next_path,
        json={
            "start_time": next_old["start_time"],
            "end_time": next_old["end_time"],
            "expected_projection_revision": next_old["projection_revision"],
        },
    )
    assert stale.status_code == 409, stale.text
    path = f"/scheduled-sessions/{plan['id']}"
    response = client.put(
        path + "?scope=all_future",
        json={
            **resize,
            "end_time": (anchor + timedelta(minutes=90)).isoformat(),
            "expected_revision": plan["revision"],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["original_end"] == old["end_time"]
    assert client.get(next_path).json()["duration_seconds"] == 5400


def _save_typed_occurrence(client, task_id, anchor, *, move=timedelta(0)):
    virtual_id = format_occurrence_id(task_id, anchor.replace(tzinfo=None))
    path = f"/scheduled-sessions/{virtual_id}"
    current = client.get(path).json()
    response = client.put(
        path,
        json={
            "start_time": (datetime.fromisoformat(current["start_time"]) + move).isoformat(),
            "end_time": (datetime.fromisoformat(current["end_time"]) + move).isoformat(),
            "expected_projection_revision": current["projection_revision"],
        },
    )
    assert response.status_code == 200, response.text
    return virtual_id, response.json()


def test_legacy_mutation_scopes_refuse_protected_occurrence_without_partial_series_change(client, db):
    anchor = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    task = _mk_task(db, dtstart=anchor, dur=30)
    earlier_id = format_occurrence_id(task.id, anchor.replace(tzinfo=None))
    virtual_id, plan = _save_typed_occurrence(client, task.id, anchor + timedelta(days=1), move=timedelta(hours=1))
    protected = f"/sessions/{virtual_id}"
    attempts = [
        client.put(
            protected + "?scope=all_future", json={"end_time": (anchor + timedelta(days=1, hours=2)).isoformat()}
        ),
        client.delete(protected),
        client.delete(f"/sessions/{earlier_id}?scope=following"),
        client.delete(f"/sessions/{earlier_id}?scope=all"),
    ]
    assert [r.status_code for r in attempts] == [409, 409, 409, 409], [r.text for r in attempts]
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan
    assert client.get(f"/scheduled-sessions/{earlier_id}").json()["duration_seconds"] == 1800
    assert client.get(f"/scheduled-sessions/{virtual_id}").status_code == 404
    assert client.get("/sessions").json() == []


def test_task_rule_edits_keep_captured_plan_and_skipped_anchor(client, db):
    anchor = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    task_id = _mk_task(db, dtstart=anchor, dur=30).id
    skipped = format_occurrence_id(task_id, (anchor + timedelta(days=1)).replace(tzinfo=None))
    assert client.delete(f"/sessions/{skipped}").status_code == 204
    virtual_id, captured = _save_typed_occurrence(client, task_id, anchor, move=timedelta(hours=2))
    task_path = f"/api/tasks/{task_id}"
    for edit in (
        {"is_recurring": False},
        {"is_recurring": True, "recurrence_duration_minutes": 75},
    ):
        assert client.put(task_path, json=edit).status_code == 200
    agenda = client.get(
        "/agenda", params={"start": anchor.isoformat(), "end": (anchor + timedelta(days=2)).isoformat()}
    )
    (plan,) = agenda.json()["items"]  # neither the moved anchor nor the skipped anchor came back
    assert plan["id"] == captured["id"]
    for field in ("start_time", "end_time", "original_start", "original_end"):
        assert plan[field] == captured[field]
    assert plan["revision"] > captured["revision"]
    stale = client.put(
        f"/scheduled-sessions/{plan['id']}?scope=all_future",
        json={
            "start_time": plan["start_time"],
            "end_time": plan["end_time"],
            "expected_revision": captured["revision"],
        },
    )
    assert stale.status_code == 409, stale.text
    assert client.get(f"/sessions/{virtual_id}").status_code == 404


def test_recorded_work_does_not_claim_or_hide_live_projection(client, db):
    anchor = (datetime.now(UTC) - timedelta(minutes=5)).replace(microsecond=0)
    task_id = _mk_task(db, dtstart=anchor, dur=60).id
    work = SessionModel(
        task_id=task_id,
        start_time=anchor.replace(tzinfo=None),
        end_time=(anchor + timedelta(minutes=3)).replace(tzinfo=None),
        duration_seconds=180,
        kind="recorded_work",
        provenance="manual",
        notes="Recurring: looks like legacy but is explicitly work",
    )
    db.add(work)
    db.commit()
    log_id = work.id
    params = {"start": (anchor + timedelta(minutes=1)).isoformat(), "end": (anchor + timedelta(minutes=4)).isoformat()}
    agenda = client.get("/agenda", params=params).json()["items"]
    assert {item["kind"] for item in agenda} == {"scheduled_session", "recorded_work"}
    assert next(item for item in agenda if item.get("provenance"))["scheduled_session_id"] is None
    _, plan = _save_typed_occurrence(client, task_id, anchor)
    agenda = client.get("/agenda", params=params).json()["items"]
    assert {item["id"] for item in agenda} == {plan["id"], log_id}
    assert not any(item["is_virtual"] for item in agenda)
    assert [row["id"] for row in client.get("/sessions").json()] == [log_id]


def test_typed_occurrence_writes_refuse_legacy_override_and_elapsed_anchor(client, db):
    anchor = (datetime.now(UTC) - timedelta(days=1)).replace(microsecond=0)
    task_id = _mk_task(db, dtstart=anchor, dur=30).id
    elapsed = f"/scheduled-sessions/{format_occurrence_id(task_id, anchor.replace(tzinfo=None))}"
    assert client.get(elapsed).status_code == 404
    body = {"start_time": anchor.isoformat(), "end_time": (anchor + timedelta(hours=1)).isoformat()}
    assert client.put(elapsed, json={**body, "expected_projection_revision": "0" * 64}).status_code == 409

    upcoming = anchor + timedelta(days=2)
    virtual_id = format_occurrence_id(task_id, upcoming.replace(tzinfo=None))
    path = f"/scheduled-sessions/{virtual_id}"
    revision = client.get(path).json()["projection_revision"]
    legacy = client.put(f"/sessions/{virtual_id}", json={"notes": "Old adapter works"})
    assert legacy.status_code == 200 and "kind" not in legacy.json()
    assert client.get(path).status_code == 404
    stale = client.put(path, json={**body, "expected_projection_revision": revision})
    assert stale.status_code == 409 and stale.json()["code"] == "projection_stale"
    assert client.get("/sessions").json()[0]["id"] == legacy.json()["id"]


def test_concurrent_occurrence_edits_save_exactly_one_plan(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from fastapi.testclient import TestClient
    from sqlmodel import SQLModel, create_engine

    from timetrace.db.session import get_session
    from timetrace.main import create_daemon_app

    engine = create_engine(f"sqlite:///{tmp_path / 'occurrence-race.db'}")
    SQLModel.metadata.create_all(engine)

    def request_db():
        with DBSession(engine) as db:
            yield db

    app = create_daemon_app()
    app.dependency_overrides[get_session] = request_db
    client = TestClient(app)
    anchor = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    try:
        with DBSession(engine) as db:
            task_id = _mk_task(db, dtstart=anchor, dur=25).id
        path = "/scheduled-sessions/" + format_occurrence_id(task_id, anchor.replace(tzinfo=None))
        revision = client.get(path).json()["projection_revision"]
        ready = Barrier(2, timeout=10)

        def edit_at(minutes):
            start = anchor + timedelta(minutes=minutes)
            ready.wait()
            return client.put(
                path,
                json={
                    "start_time": start.isoformat(),
                    "end_time": (start + timedelta(hours=1)).isoformat(),
                    "expected_projection_revision": revision,
                },
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            success, stale = sorted(pool.map(edit_at, (15, 30)), key=lambda response: response.status_code)
        assert (success.status_code, stale.status_code) == (200, 409)
        assert stale.json()["code"] == "projection_stale"
        plan = success.json()
        params = {"start": anchor.isoformat(), "end": (anchor + timedelta(hours=2)).isoformat()}
        assert client.get("/agenda", params=params).json()["items"] == [plan]
        assert client.get("/sessions").json() == []
    finally:
        client.close()
        engine.dispose()
