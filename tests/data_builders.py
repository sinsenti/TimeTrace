"""Build fresh interval rows; callers own writes and transactions."""

from datetime import datetime

from timetrace.db.models import Session


def legacy_session_row(
    *,
    task_id: str,
    start_time: datetime,
    end_time: datetime | None,
    duration_seconds: int | None,
    notes: str | None = None,
) -> Session:
    """Keep legacy endpoint/duration combinations exactly as supplied."""
    return Session(
        task_id=task_id, start_time=start_time, end_time=end_time, duration_seconds=duration_seconds, notes=notes
    )


def manual_work_row(
    *,
    start_time: datetime,
    end_time: datetime,
    task_id: str | None = None,
    duration_seconds: int | None = None,
    notes: str | None = None,
) -> Session:
    return Session(
        start_time=start_time,
        end_time=end_time,
        task_id=task_id,
        duration_seconds=duration_seconds,
        notes=notes,
        kind="recorded_work",
        provenance="manual",
    )
