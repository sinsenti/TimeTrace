"""Task work accounting with real SQLite, plus inspector and AI adapter contracts."""

from datetime import UTC, datetime, timedelta

import pytest
from data_builders import legacy_session_row

from timetrace.core import timer
from timetrace.core.exceptions import EntityNotFoundError
from timetrace.db.models import RatingDefinition, RatingEntry, Task, TaskReview
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import SessionCreate, SessionUpdate, TaskCreate
from timetrace.services import ai_insights_service, recurrence_service, session_service
from timetrace.services.ai_insights_service import AIInsightsService
from timetrace.services.task_service import TaskService

NOW = datetime(2026, 10, 30, 12, tzinfo=UTC)


@pytest.fixture(autouse=True)
def accounting_clock(monkeypatch):
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW.astimezone(tz) if tz is not None else NOW.replace(tzinfo=None)

    # Freeze the clock, not the accounting collaborators or SQL execution.
    monkeypatch.setattr(session_service, "datetime", FixedDatetime)
    monkeypatch.setattr(ai_insights_service, "datetime", FixedDatetime)
    monkeypatch.setattr(recurrence_service, "datetime", FixedDatetime)
    monkeypatch.setattr(timer, "datetime", FixedDatetime)


def assert_accounting(db, task, expected, session_count):
    ordinary = TaskService(db).get_task_statistics(task.id)
    progress = AIInsightsService(db).get_task_progress(task.id)
    assert {key: ordinary[key] for key in expected} == expected
    assert {key: progress[key] for key in expected} == expected
    assert ordinary["total_sessions"] == progress["session_count"] == session_count
    return ordinary, progress


@pytest.mark.parametrize(
    ("start_delta", "end_delta", "duration", "logged", "scheduled", "remaining", "unscheduled", "progress"),
    [
        pytest.param(-3600, -1, 1800, 0.5, 0.0, 0.5, 0.5, 50.0, id="past-uses-recorded-duration"),
        pytest.param(-1800, 0, 1800, 0.5, 0.0, 0.5, 0.5, 50.0, id="ends-exactly-now-is-logged"),
        pytest.param(-1800, 0.000001, 1800, 0.0, 0.0, 1.0, 1.0, 0.0, id="ends-just-after-now-is-not-logged"),
        pytest.param(0, 1800, 1800, 0.0, 0.0, 1.0, 1.0, 0.0, id="starts-exactly-now-is-not-scheduled"),
        pytest.param(0.000001, 1800, 1800, 0.0, 0.5, 1.0, 0.5, 0.0, id="starts-just-after-now-is-scheduled"),
        pytest.param(-900, 900, 1800, 0.0, 0.0, 1.0, 1.0, 0.0, id="straddling-is-neither"),
        pytest.param(-1800, None, None, 0.0, 0.0, 1.0, 1.0, 0.0, id="open-is-neither"),
        pytest.param(1800, None, None, 0.0, 0.0, 1.0, 1.0, 0.0, id="future-open-without-duration"),
        pytest.param(-1800, -1, None, 0.0, 0.0, 1.0, 1.0, 0.0, id="closed-without-duration"),
    ],
)
def test_recorded_session_cutoffs_match_for_ordinary_and_ai_progress(
    db, start_delta, end_delta, duration, logged, scheduled, remaining, unscheduled, progress
):
    task = Task(title="Accounting cutoffs", estimated_minutes=60)
    db.add(task)
    db.flush()
    db.add(
        SessionModel(
            task_id=task.id,
            start_time=(NOW + timedelta(seconds=start_delta)).replace(tzinfo=None),
            end_time=(NOW + timedelta(seconds=end_delta)).replace(tzinfo=None) if end_delta is not None else None,
            duration_seconds=duration,
        )
    )
    db.commit()

    ordinary, _ = assert_accounting(
        db,
        task,
        {
            "estimated_hours": 1.0,
            "logged_hours": logged,
            "scheduled_hours": scheduled,
            "remaining_hours": remaining,
            "unscheduled_hours": unscheduled,
            "progress_pct": progress,
            "is_unbounded": False,
        },
        session_count=1,
    )
    assert ordinary["sessions"][0]["duration_seconds"] == duration


def test_future_open_session_with_retained_duration_is_not_scheduled(db):
    task = Task(title="Future session with cleared end", estimated_minutes=60)
    db.add(task)
    db.commit()
    sessions = session_service.SessionService(db)
    recorded = sessions.create_session(
        SessionCreate(
            task_id=task.id,
            start_time=NOW + timedelta(hours=1),
            end_time=NOW + timedelta(hours=1, minutes=30),
        )
    )
    opened = sessions.update_session(recorded.id, SessionUpdate(end_time=None))
    assert opened.end_time is None
    assert opened.duration_seconds == 1800

    ordinary, _ = assert_accounting(
        db,
        task,
        {
            "estimated_hours": 1.0,
            "logged_hours": 0.0,
            "scheduled_hours": 0.0,
            "remaining_hours": 1.0,
            "unscheduled_hours": 1.0,
            "progress_pct": 0.0,
            "is_unbounded": False,
        },
        session_count=1,
    )
    assert ordinary["total_hours"] == 0.5
    assert ordinary["sessions"][0]["end_time"] is None
    assert ordinary["sessions"][0]["duration_seconds"] == 1800


@pytest.mark.parametrize("interface", ["ordinary", "ai"])
def test_accounting_uses_one_measurement_instant_even_if_the_clock_advances(db, monkeypatch, interface):
    class AdvancingDatetime(datetime):
        instant = NOW

        @classmethod
        def now(cls, tz=None):
            instant = cls.instant
            cls.instant += timedelta(hours=1)
            return instant.astimezone(tz) if tz is not None else instant.replace(tzinfo=None)

    monkeypatch.setattr(session_service, "datetime", AdvancingDatetime)
    monkeypatch.setattr(ai_insights_service, "datetime", AdvancingDatetime)
    task = Task(title="One measurement instant", estimated_minutes=120)
    db.add(task)
    db.flush()
    db.add_all(
        [
            SessionModel(
                task_id=task.id,
                start_time=(NOW - timedelta(hours=1)).replace(tzinfo=None),
                end_time=NOW.replace(tzinfo=None),
                duration_seconds=3600,
            ),
            SessionModel(
                task_id=task.id,
                start_time=(NOW + timedelta(seconds=1)).replace(tzinfo=None),
                end_time=(NOW + timedelta(minutes=30, seconds=1)).replace(tzinfo=None),
                duration_seconds=1800,
            ),
        ]
    )
    db.commit()

    if interface == "ordinary":
        result = TaskService(db).get_task_statistics(task.id)
    else:
        result = AIInsightsService(db).get_task_progress(task.id)
    assert result["logged_hours"] == 1.0
    assert result["scheduled_hours"] == 0.5
    assert result["remaining_hours"] == 1.0
    assert result["unscheduled_hours"] == 0.5


def test_task_without_sessions_has_its_entire_budget_remaining(db):
    task = Task(title="Not started", estimated_minutes=60)
    db.add(task)
    db.commit()

    ordinary, _ = assert_accounting(
        db,
        task,
        {
            "estimated_hours": 1.0,
            "logged_hours": 0.0,
            "scheduled_hours": 0.0,
            "remaining_hours": 1.0,
            "unscheduled_hours": 1.0,
            "progress_pct": 0.0,
            "is_unbounded": False,
        },
        session_count=0,
    )
    assert ordinary["total_hours"] == 0.0
    assert ordinary["sessions"] == []


@pytest.mark.parametrize(
    ("estimate", "recurring", "logged", "scheduled", "expected"),
    [
        pytest.param(
            60,
            False,
            3661,
            1829,
            (1.0, 1.02, 0.51, -0.02, -0.53, 101.7, False),
            id="overspend-keeps-negative-balances-and-progress-above-100",
        ),
        pytest.param(
            60,
            True,
            3661,
            1829,
            (1.0, 1.02, 0.51, None, None, 101.7, True),
            id="recurrence-estimate-is-per-occurrence-not-a-series-budget",
        ),
        pytest.param(
            0,
            False,
            3661,
            1829,
            (0.0, 1.02, 0.51, None, None, None, True),
            id="zero-estimate-is-unbounded",
        ),
        pytest.param(
            None,
            False,
            3661,
            1829,
            (0.0, 1.02, 0.51, None, None, None, True),
            id="missing-estimate-is-unbounded",
        ),
        pytest.param(
            -60,
            False,
            7200,
            1800,
            (-1.0, 2.0, 0.5, -3.0, -3.5, None, False),
            id="negative-estimate-has-balances-but-no-progress",
        ),
        pytest.param(
            60,
            False,
            19,
            19,
            (1.0, 0.01, 0.01, 0.99, 0.99, 0.5, False),
            id="balances-use-seconds-before-rounding-hours",
        ),
    ],
)
def test_work_accounting_budget_matrix(db, estimate, recurring, logged, scheduled, expected):
    task = Task(title="Work budget", estimated_minutes=estimate, is_recurring=recurring)
    db.add(task)
    db.flush()
    # SQLAlchemy applies the column's 15-minute default to None on INSERT; use
    # an UPDATE to represent an existing task with a genuinely missing estimate.
    task.estimated_minutes = estimate
    db.add(task)
    db.add_all(
        [
            SessionModel(
                task_id=task.id,
                start_time=(NOW - timedelta(seconds=logged)).replace(tzinfo=None),
                end_time=NOW.replace(tzinfo=None),
                duration_seconds=logged,
            ),
            SessionModel(
                task_id=task.id,
                start_time=(NOW + timedelta(hours=1)).replace(tzinfo=None),
                end_time=(NOW + timedelta(hours=1, seconds=scheduled)).replace(tzinfo=None),
                duration_seconds=scheduled,
            ),
        ]
    )
    db.commit()

    assert TaskService(db).get_work_accounting(task) == dict(
        zip(
            (
                "estimated_hours",
                "logged_hours",
                "scheduled_hours",
                "remaining_hours",
                "unscheduled_hours",
                "progress_pct",
                "is_unbounded",
            ),
            expected,
            strict=True,
        )
    )


def test_work_accounting_counts_only_own_eligible_intervals_in_mixed_history(db):
    task = Task(title="Mixed interval history", estimated_minutes=60)
    child = Task(title="Separate child budget", parent_id=task.id)
    db.add_all([task, child])
    db.flush()
    for start, end, seconds in [
        (-180, -120, 3600),  # closed past
        (-60, 0, 3600),  # inclusive end
        (1, 31, 1800),  # strictly future
        (0, 30, 1800),  # exclusive start
        (-30, 30, 3600),  # straddling
        (-10, None, 900),  # past open, duration retained
        (60, None, 900),  # future open, duration retained
    ]:
        db.add(
            legacy_session_row(
                task_id=task.id,
                start_time=(NOW + timedelta(minutes=start)).replace(tzinfo=None),
                end_time=(NOW + timedelta(minutes=end)).replace(tzinfo=None) if end is not None else None,
                duration_seconds=seconds,
            )
        )
    db.add(
        legacy_session_row(
            task_id=child.id,
            start_time=(NOW - timedelta(hours=10)).replace(tzinfo=None),
            end_time=NOW.replace(tzinfo=None),
            duration_seconds=36000,
        )
    )
    db.commit()

    assert TaskService(db).get_work_accounting(task) == {
        "estimated_hours": 1.0,
        "logged_hours": 2.0,
        "scheduled_hours": 0.5,
        "remaining_hours": -1.0,
        "unscheduled_hours": -1.5,
        "progress_pct": 200.0,
        "is_unbounded": False,
    }


@pytest.mark.parametrize("frozen", [False, True], ids=["running-timer", "frozen-idle-timer"])
def test_timer_and_virtual_projections_are_not_recorded_work(db, frozen):
    task = Task(
        title="Recurring work",
        estimated_minutes=30,
        is_recurring=True,
        recurrence_rrule="FREQ=DAILY;COUNT=3",
        recurrence_dtstart=(NOW + timedelta(hours=1)).replace(tzinfo=None),
        recurrence_duration_minutes=30,
        recurrence_timezone="UTC",
    )
    db.add(task)
    db.commit()
    projected = session_service.SessionService(db).list_sessions(NOW, NOW + timedelta(days=3))
    assert len(projected) == 3
    assert all(item["is_virtual"] for item in projected)

    timer.timer_manager.start(task_id=task.id, task_title=task.title)
    timer.timer_manager.start_time = NOW - timedelta(hours=1)
    if frozen:
        gap = timer.timer_manager.freeze_for_idle(1800)
        assert gap["saved_session"]["duration_seconds"] == 1800

    assert_accounting(
        db,
        task,
        {
            "estimated_hours": 0.5,
            "logged_hours": 0.0,
            "scheduled_hours": 0.0,
            "remaining_hours": None,
            "unscheduled_hours": None,
            "progress_pct": 0.0,
            "is_unbounded": True,
        },
        session_count=0,
    )


def test_inspector_keeps_history_reviews_and_ratings_out_of_ai_progress(db):
    task = Task(title="Inspector details", estimated_minutes=120, due_date=NOW.replace(tzinfo=None))
    child = Task(title="Separate child budget", parent_id=task.id)
    db.add_all([task, child])
    db.flush()
    past = SessionModel(
        task_id=task.id,
        start_time=(NOW - timedelta(hours=1)).replace(tzinfo=None),
        end_time=NOW.replace(tzinfo=None),
        duration_seconds=3600,
    )
    future = SessionModel(
        task_id=task.id,
        start_time=(NOW + timedelta(hours=1)).replace(tzinfo=None),
        end_time=(NOW + timedelta(hours=1, minutes=30)).replace(tzinfo=None),
        duration_seconds=1800,
    )
    straddling = SessionModel(
        task_id=task.id,
        start_time=(NOW - timedelta(minutes=30)).replace(tzinfo=None),
        end_time=(NOW + timedelta(minutes=30)).replace(tzinfo=None),
        duration_seconds=3600,
    )
    definition = RatingDefinition(name="Focus", target_type="task")
    review = TaskReview(task_id=task.id, what_went_well="Useful review")
    rating = RatingEntry(rating_definition_id=definition.id, target_type="task", target_id=task.id, score=8)
    db.add_all(
        [
            future,
            straddling,
            past,
            review,
            definition,
            rating,
            SessionModel(
                task_id=child.id,
                start_time=NOW.replace(tzinfo=None),
                end_time=NOW.replace(tzinfo=None),
                duration_seconds=9000,
            ),
            SessionModel(start_time=NOW.replace(tzinfo=None), end_time=NOW.replace(tzinfo=None), duration_seconds=9000),
        ]
    )
    db.commit()

    ordinary, progress = assert_accounting(
        db,
        task,
        {
            "estimated_hours": 2.0,
            "logged_hours": 1.0,
            "scheduled_hours": 0.5,
            "remaining_hours": 1.0,
            "unscheduled_hours": 0.5,
            "progress_pct": 50.0,
            "is_unbounded": False,
        },
        session_count=3,
    )
    assert ordinary["total_hours"] == 2.5  # Inspector history includes the straddling row.
    assert [item["id"] for item in ordinary["sessions"]] == [past.id, straddling.id, future.id]
    assert ordinary["sessions"][0]["end_time"] == NOW.isoformat()
    assert ordinary["task"]["due_date"] == NOW.isoformat()
    assert ordinary["task_review"] == review.model_dump()
    assert ordinary["custom_ratings"] == [{**rating.model_dump(), "definition": definition.model_dump()}]
    assert progress == {
        "task_id": task.id,
        "title": task.title,
        "status": task.status,
        "estimated_hours": 2.0,
        "logged_hours": 1.0,
        "scheduled_hours": 0.5,
        "remaining_hours": 1.0,
        "unscheduled_hours": 0.5,
        "progress_pct": 50.0,
        "is_unbounded": False,
        "session_count": 3,
        "is_recurring": False,
    }
    assert set(ordinary) == {
        "task",
        "total_hours",
        "total_sessions",
        "estimated_hours",
        "progress_pct",
        "sessions",
        "task_review",
        "custom_ratings",
        "logged_hours",
        "scheduled_hours",
        "remaining_hours",
        "unscheduled_hours",
        "is_unbounded",
    }


def test_negative_estimate_has_no_progress_in_either_interface_and_keeps_existing_balances(db):
    task = TaskService(db).create_task(TaskCreate(title="Negative estimate", estimated_minutes=-60))
    db.add(
        SessionModel(
            task_id=task.id,
            start_time=(NOW - timedelta(hours=1)).replace(tzinfo=None),
            end_time=NOW.replace(tzinfo=None),
            duration_seconds=3600,
        )
    )
    db.commit()

    ordinary = TaskService(db).get_task_statistics(task.id)
    progress = AIInsightsService(db).get_task_progress(task.id)
    assert ordinary["task"]["estimated_minutes"] == -60
    assert ordinary["progress_pct"] is None
    assert progress["progress_pct"] is None
    assert ordinary["is_unbounded"] is progress["is_unbounded"] is False
    assert ordinary["remaining_hours"] == progress["remaining_hours"] == -2.0


@pytest.mark.parametrize("service_method", [TaskService.get_task_statistics, AIInsightsService.get_task_progress])
def test_accounting_preserves_missing_task_errors(db, service_method):
    missing_id = "019a3199-ce00-7000-8000-000000000001"
    service = TaskService(db) if service_method is TaskService.get_task_statistics else AIInsightsService(db)
    with pytest.raises(EntityNotFoundError) as error:
        service_method(service, missing_id)
    assert error.value.entity_name == "Task"
    assert error.value.entity_id == missing_id
    assert str(error.value) == f"Task #{missing_id} not found."
