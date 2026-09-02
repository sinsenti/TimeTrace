"""Series projection, exceptions and materialization for recurring tasks.

The DB no longer holds pre-generated session rows for a recurring task. It holds one master
RRULE per task (`Task.recurrence_rrule` + `recurrence_dtstart`/`recurrence_duration_minutes`/
`recurrence_timezone`) and a `recurrenceexception` row for every occurrence that deviates from
it (`kind="skip"` = cancelled, `kind="override"` = materialized into a real session row).

This service is the only place that turns a rule into occurrences. `core/recurrence.py` stays
pure; everything DB-shaped lives here. Projection is deliberately **future-only**: a past
occurrence with no session row means it did not happen, and emitting it would double-render
every past day that already has a real logged row.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.core.recurrence import (
    MAX_OCCURRENCES_PER_SERIES,
    MAX_WINDOW_DAYS,
    RecurrenceSpec,
    expand,
    format_occurrence_id,
    next_occurrence,
    parse_occurrence_id,
    preset_to_rrule,
    rrule_to_preset,
    set_until,
    validate_rrule,
)
from timetrace.core.timezones import (
    daemon_timezone_name,
    from_local_naive,
    resolve_timezone,
    to_local_naive,
)
from timetrace.db.models import RecurrenceException, Task, TaskStatus
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.utils import ensure_utc

# Fingerprint written only by the removed pre-generator (see migration `0006` and the
# `tt recurrence-audit` CLI, `interfaces/cli/commands.py:LEGACY_PLACEHOLDER_PREFIX`). Adoption in
# `reconcile_series` must only ever claim rows carrying this marker -- never an arbitrary real
# session that happens to sit on a projected occurrence's instant, which could just as easily be
# the user's own unrelated work coinciding with the series' usual time.
_LEGACY_PLACEHOLDER_PREFIX = "Recurring: "

_RECURRENCE_REQUEST_FIELDS = (
    "is_recurring",
    "recurrence_rule",
    "recurrence_rrule",
    "recurrence_dtstart",
    "recurrence_duration_minutes",
    "recurrence_timezone",
)


def _now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None, microsecond=0)


def _naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return ensure_utc(value).replace(tzinfo=None)


@dataclass(frozen=True)
class ProjectedOccurrence:
    """One virtual (not-yet-real) occurrence of a series, shaped like a session row."""

    occurrence_id: str
    task_id: str
    task_title: str
    start_utc: datetime  # naive UTC == the RECURRENCE-ID
    end_utc: datetime
    duration_seconds: int
    tags: str

    def to_dict(self) -> dict[str, Any]:
        """The same keys a real row gets from `SessionService.list_sessions`, plus the virtual
        markers. Keeping the shape identical is what lets the calendar render both with one
        code path."""
        return {
            "id": self.occurrence_id,
            "task_id": self.task_id,
            "start_time": ensure_utc(self.start_utc).isoformat(),
            "end_time": ensure_utc(self.end_utc).isoformat(),
            "duration_seconds": self.duration_seconds,
            "tags": self.tags,
            "notes": "",
            "review_skipped": False,
            "timezone": None,
            "external_sync_id": None,
            "external_provider": None,
            "extended_properties_json": None,
            "is_virtual": True,
            "series_task_id": self.task_id,
            "occurrence_start": ensure_utc(self.start_utc).isoformat(),
            "task_title": self.task_title,
        }


class RecurrenceService:
    def __init__(self, db: Session):
        self.db = db
        # Per-instance memo so one calendar refetch does not re-run adoption once per series
        # per projected window.
        self._reconciled: set[str] = set()

    # --- spec plumbing ---------------------------------------------------------------

    def spec_for_task(self, task: Task) -> RecurrenceSpec | None:
        """The series spec, or `None` if this task does not project.

        Fails closed: no fallback to `recurrence_rule`, `created_at` or `assigned_date`. Those
        implicit anchors are exactly what produced the old generator's 12:29:01.544567 schedule.
        """
        if not task or not task.is_recurring:
            return None
        if not task.recurrence_rrule or not task.recurrence_dtstart:
            return None
        duration = task.recurrence_duration_minutes or 0
        if duration <= 0:
            return None
        return RecurrenceSpec(
            rrule=task.recurrence_rrule,
            dtstart_utc=_naive_utc(task.recurrence_dtstart).replace(microsecond=0),
            duration_minutes=duration,
            timezone_name=task.recurrence_timezone or daemon_timezone_name(),
        )

    @staticmethod
    def touches_recurrence(incoming: dict[str, Any] | None) -> bool:
        """True when a task create/update payload carries any recurrence field."""
        if not incoming:
            return False
        return any(field in incoming for field in _RECURRENCE_REQUEST_FIELDS)

    def apply_recurrence_fields(self, task: Task, incoming: dict[str, Any] | None) -> None:
        """Single write-side normalizer for the recurrence columns.

        Called from `TaskService.create_task` and `update_task` after the incoming values have
        been assigned to `task`. `incoming` is only consulted to know what the caller *asked*
        for; the authoritative values are read back off `task`.

        `recurrence_dtstart` is derived exactly once, at first activation, and never recomputed
        by a later update -- two competing anchors are what doubled the live series.
        """
        incoming = incoming or {}

        if incoming.get("recurrence_rrule"):
            task.recurrence_rrule = str(incoming["recurrence_rrule"]).strip()
        elif incoming.get("recurrence_rule") and "recurrence_rrule" not in incoming:
            task.recurrence_rrule = preset_to_rrule(incoming["recurrence_rule"])

        if task.recurrence_dtstart is not None:
            task.recurrence_dtstart = _naive_utc(task.recurrence_dtstart).replace(microsecond=0)

        if not task.is_recurring:
            # Leave the recurrence columns intact so re-enabling restores the same series;
            # `project_range` filters on `is_recurring`, so nothing projects meanwhile.
            if task.recurrence_rrule:
                task.recurrence_rule = rrule_to_preset(task.recurrence_rrule)
            return

        if not task.recurrence_rrule:
            task.recurrence_rrule = preset_to_rrule(task.recurrence_rule)
        task.recurrence_rule = rrule_to_preset(task.recurrence_rrule)

        if not task.recurrence_timezone:
            task.recurrence_timezone = daemon_timezone_name()

        if not task.recurrence_duration_minutes or task.recurrence_duration_minutes <= 0:
            est = task.estimated_minutes or 15
            task.recurrence_duration_minutes = 30 if est > 120 else est

        if task.recurrence_dtstart is None:
            task.recurrence_dtstart = self._derive_dtstart(task)

        validate_rrule(task.recurrence_rrule, task.recurrence_dtstart, task.recurrence_timezone)

    def _derive_dtstart(self, task: Task) -> datetime:
        """First-activation anchor: `assigned_date` at 09:00 **local** if it parses, else
        `created_at`, else now. Second precision."""
        tz = resolve_timezone(task.recurrence_timezone)
        if task.assigned_date:
            raw = str(task.assigned_date).strip().replace(" ", "T")
            try:
                if "T" not in raw:
                    raw = f"{raw}T09:00:00"
                local_naive = datetime.fromisoformat(raw).replace(tzinfo=None)
                return from_local_naive(local_naive, tz).replace(second=0, microsecond=0)
            except ValueError:
                pass
        base = _naive_utc(task.created_at) or _now_naive()
        return base.replace(second=0, microsecond=0)

    def list_recurring_tasks(self) -> list[Task]:
        """Active recurring tasks: `is_recurring`, a rule, and not on a completed status."""
        tasks = list(
            self.db.exec(
                select(Task).where(
                    Task.is_recurring == True,  # noqa: E712 -- SQL boolean, not Python truthiness
                    Task.recurrence_rrule.is_not(None),
                )
            ).all()
        )
        if not tasks:
            return []
        completed = self._completed_status_names()
        return [t for t in tasks if (t.status or "").strip().lower() not in completed]

    def _completed_status_names(self) -> set[str]:
        names = {"done", "completed"}
        for st in self.db.exec(select(TaskStatus).where(TaskStatus.is_completed == True)).all():  # noqa: E712
            if st.name:
                names.add(st.name.strip().lower())
        return names

    # --- projection ------------------------------------------------------------------

    def project_range(
        self, start: datetime, end: datetime, reconcile: bool = True
    ) -> list[ProjectedOccurrence]:
        """Virtual occurrences of every active series whose start falls in `[start, end)`.

        Future-only, with one exception: an occurrence that has started but not yet ended
        (`start <= now < end`) is neither a real row nor a "did not happen" gap, so it still
        projects. The lower bound used for `expand()` is therefore only clamped to `now` minus
        that series' own duration -- never further back -- and anything whose `end_utc` has
        already elapsed is filtered back out below.
        """
        lower_req = _naive_utc(start)
        upper = _naive_utc(end)
        if lower_req is None or upper is None:
            return []
        if (upper - lower_req) > timedelta(days=MAX_WINDOW_DAYS):
            raise ValidationError(f"Requested range exceeds the maximum of {MAX_WINDOW_DAYS} days.")

        now = _now_naive()
        if upper <= now:
            # Entirely in the past: no in-progress occurrence can live in a window that ends
            # before now, and a fully past occurrence with no row simply did not happen.
            return []

        tasks = self.list_recurring_tasks()
        if not tasks:
            return []

        if reconcile:
            for task in tasks:
                self.reconcile_series(task.id)

        specs: dict[str, RecurrenceSpec] = {}
        task_lowers: dict[str, datetime] = {}
        window_floor = max(lower_req, now)
        for task in tasks:
            spec = self.spec_for_task(task)
            if not spec:
                continue
            specs[task.id] = spec
            task_lower = max(lower_req, now - timedelta(minutes=spec.duration_minutes))
            task_lowers[task.id] = task_lower
            window_floor = min(window_floor, task_lower)

        if not specs or window_floor >= upper:
            return []

        exceptions = self._exceptions_in_window(list(specs.keys()), window_floor, upper)
        session_intervals = self._real_session_intervals(list(specs.keys()), window_floor, upper)

        result: list[ProjectedOccurrence] = []
        for task_id, spec in specs.items():
            task_lower = task_lowers[task_id]
            if task_lower >= upper:
                continue
            task = next(t for t in tasks if t.id == task_id)
            intervals = session_intervals.get(task_id, ())
            for occ in expand(spec, task_lower, upper, task_id):
                if occ.end_utc <= now:
                    continue  # fully elapsed -- a past occurrence with no row did not happen
                if (task_id, occ.start_utc) in exceptions:
                    continue
                if self._occurrence_covered(intervals, occ.start_utc, occ.end_utc):
                    # A real session of this task already occupies this slot. Suppress the
                    # ghost at display time only -- no exception is written, so this claims
                    # nothing and a later scope delete still cannot touch the real row. See
                    # module docstring / `reconcile_series` for why adoption itself must not
                    # do this.
                    continue
                result.append(self._to_projected(task, occ.start_utc, occ.end_utc))
        result.sort(key=lambda o: o.start_utc)
        return result

    def project_task(self, task: Task, start: datetime, end: datetime) -> list[ProjectedOccurrence]:
        """Virtual occurrences of one series (still future-only)."""
        spec = self.spec_for_task(task)
        if not spec:
            return []
        lower = max(_naive_utc(start), _now_naive())
        upper = _naive_utc(end)
        if lower >= upper:
            return []
        exceptions = self._exceptions_in_window([task.id], lower, upper)
        intervals = self._real_session_intervals([task.id], lower, upper).get(task.id, ())
        return [
            self._to_projected(task, occ.start_utc, occ.end_utc)
            for occ in expand(spec, lower, upper, task.id)
            if (task.id, occ.start_utc) not in exceptions
            and not self._occurrence_covered(intervals, occ.start_utc, occ.end_utc)
        ]

    def next_upcoming(self, within_days: int = 30) -> ProjectedOccurrence | None:
        """The soonest future occurrence across every active series, skipping exceptions."""
        now = _now_naive()
        horizon = now + timedelta(days=min(within_days, MAX_WINDOW_DAYS))
        # No adoption pass here: `/timer/status` is polled every few seconds and this is a
        # display-only lookup, so it must stay read-only and cheap.
        occurrences = self.project_range(now, horizon, reconcile=False)
        return occurrences[0] if occurrences else None

    def next_occurrence_for_task(self, task: Task, after: datetime | None = None) -> ProjectedOccurrence | None:
        """The next occurrence of one series, skipping `skip` exceptions.

        Used for the Target Day badge (settled owner decision Q1: the badge shows the next
        occurrence rather than a stored, mutated `assigned_date`). Pure rule arithmetic plus at
        most a handful of exception lookups -- no expansion over a wide window.
        """
        spec = self.spec_for_task(task)
        if not spec:
            return None
        cursor = _naive_utc(after) if after else _now_naive()
        for _ in range(32):
            occ = next_occurrence(spec, cursor, task.id)
            if occ is None:
                return None
            exc = self.get_exception(task.id, occ.start_utc)
            if exc is None:
                intervals = self._real_session_intervals([task.id], occ.start_utc, occ.end_utc).get(
                    task.id, ()
                )
                if not self._occurrence_covered(intervals, occ.start_utc, occ.end_utc):
                    return self._to_projected(task, occ.start_utc, occ.end_utc)
            cursor = occ.start_utc
        return None

    def _to_projected(self, task: Task, start_utc: datetime, end_utc: datetime) -> ProjectedOccurrence:
        return ProjectedOccurrence(
            occurrence_id=format_occurrence_id(task.id, start_utc),
            task_id=task.id,
            task_title=task.title,
            start_utc=start_utc,
            end_utc=end_utc,
            duration_seconds=int((end_utc - start_utc).total_seconds()),
            tags=task.tags or "",
        )

    def _exceptions_in_window(
        self, task_ids: list[str], lower: datetime, upper: datetime
    ) -> dict[tuple[str, datetime], RecurrenceException]:
        if not task_ids:
            return {}
        rows = self.db.exec(
            select(RecurrenceException).where(
                RecurrenceException.task_id.in_(task_ids),
                RecurrenceException.occurrence_start >= lower,
                RecurrenceException.occurrence_start < upper,
            )
        ).all()
        return {(r.task_id, _naive_utc(r.occurrence_start)): r for r in rows}

    def _real_session_intervals(
        self, task_ids: list[str], lower: datetime, upper: datetime
    ) -> dict[str, list[tuple[datetime, datetime]]]:
        """Real (non-virtual) session rows of `task_ids` whose interval can overlap `[lower,
        upper)`, keyed by task id. Used only to *suppress* a projected occurrence at display
        time -- never to adopt/claim the row -- so `reconcile_series`'s narrowed adoption stays
        the only path that can make a session deletable via the series.
        """
        if not task_ids:
            return {}
        rows = self.db.exec(
            select(SessionModel).where(
                SessionModel.task_id.in_(task_ids),
                SessionModel.start_time < upper,
            )
        ).all()
        intervals: dict[str, list[tuple[datetime, datetime]]] = {}
        for row in rows:
            if not row.start_time or not row.task_id:
                continue
            row_start = _naive_utc(row.start_time)
            row_end = _naive_utc(row.end_time) if row.end_time else row_start
            if row_end <= row_start:
                # Zero-duration / still-open row: treat as covering at least an instant so an
                # occurrence starting exactly there is still suppressed.
                row_end = row_start + timedelta(seconds=1)
            if row_end <= lower:
                continue
            intervals.setdefault(row.task_id, []).append((row_start, row_end))
        return intervals

    @staticmethod
    def _occurrence_covered(
        intervals: list[tuple[datetime, datetime]] | tuple[()], occ_start: datetime, occ_end: datetime
    ) -> bool:
        """True if a real session interval overlaps the occurrence's `[occ_start, occ_end)`.

        Overlap, not exact-start equality: a user's 09:00-11:00 block plainly covers a
        09:00-09:30 occurrence and would otherwise still render a duplicate ghost inside it.
        """
        return any(s < occ_end and occ_start < e for s, e in intervals)

    def get_exception(self, task_id: str, occurrence_start: datetime) -> RecurrenceException | None:
        return self.db.exec(
            select(RecurrenceException).where(
                RecurrenceException.task_id == task_id,
                RecurrenceException.occurrence_start == _naive_utc(occurrence_start),
            )
        ).first()

    def exception_for_session(self, session_id: str) -> RecurrenceException | None:
        return self.db.exec(
            select(RecurrenceException).where(RecurrenceException.session_id == session_id)
        ).first()

    # --- exceptions / materialization ------------------------------------------------

    def resolve_occurrence(self, occurrence_id: str) -> tuple[Task, datetime]:
        parsed = parse_occurrence_id(occurrence_id)
        if not parsed:
            raise ValidationError(f"'{occurrence_id}' is not a recurrence occurrence id.")
        task_id, occurrence_start = parsed
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)
        if not self.spec_for_task(task):
            raise ValidationError(f"Task '{task_id}' has no active recurrence to project.")
        return task, occurrence_start

    def occurrence_exists(self, task: Task, occurrence_start: datetime) -> bool:
        spec = self.spec_for_task(task)
        if not spec:
            return False
        return bool(expand(spec, occurrence_start, occurrence_start + timedelta(seconds=1), task.id))

    def projected_occurrence(self, occurrence_id: str) -> ProjectedOccurrence:
        """Read one virtual occurrence without materializing it (GET must not write)."""
        task, occurrence_start = self.resolve_occurrence(occurrence_id)
        existing = self.get_exception(task.id, occurrence_start)
        if existing:
            raise EntityNotFoundError("Occurrence", occurrence_id)
        if not self.occurrence_exists(task, occurrence_start):
            raise EntityNotFoundError("Occurrence", occurrence_id)
        duration = timedelta(minutes=task.recurrence_duration_minutes or 15)
        return self._to_projected(task, occurrence_start, occurrence_start + duration)

    def materialize(self, occurrence_id: str) -> SessionModel:
        """Turn a virtual occurrence into a real session row + an `override` exception.

        Idempotent: a second call returns the session row the first call created.
        """
        task, occurrence_start = self.resolve_occurrence(occurrence_id)

        existing = self.get_exception(task.id, occurrence_start)
        if existing:
            if existing.kind == "override" and existing.session_id:
                session = self.db.get(SessionModel, existing.session_id)
                if session:
                    return session
                # The row was deleted out from under the exception; treat as cancelled.
                raise ValidationError("This occurrence was already removed.")
            raise ValidationError("This occurrence was cancelled.")

        if not self.occurrence_exists(task, occurrence_start):
            raise EntityNotFoundError("Occurrence", occurrence_id)

        duration_minutes = task.recurrence_duration_minutes or 15
        if occurrence_start + timedelta(minutes=duration_minutes) <= _now_naive():
            # An in-progress occurrence (start <= now < end) is exactly the "I'm working it
            # now" case and stays materializable; one that has fully elapsed with no row simply
            # did not happen, and writing a session for it now would fabricate work never logged.
            raise ValidationError("This occurrence has already elapsed and cannot be logged retroactively.")

        session = SessionModel(
            task_id=task.id,
            start_time=occurrence_start,
            end_time=occurrence_start + timedelta(minutes=duration_minutes),
            duration_seconds=duration_minutes * 60,
            tags=task.tags or "",
            notes="",
        )
        self.db.add(session)
        self.db.flush()
        self.db.add(
            RecurrenceException(
                task_id=task.id,
                occurrence_start=occurrence_start,
                kind="override",
                session_id=session.id,
            )
        )
        try:
            self.db.commit()
        except IntegrityError:
            # The unique constraint on (task_id, occurrence_start) is the concurrency backstop.
            self.db.rollback()
            existing = self.get_exception(task.id, occurrence_start)
            if existing and existing.kind == "override" and existing.session_id:
                found = self.db.get(SessionModel, existing.session_id)
                if found:
                    return found
            raise ValidationError("This occurrence was modified concurrently; reload and retry.") from None
        self.db.refresh(session)
        return session

    def skip(self, task_id: str, occurrence_start: datetime) -> None:
        """Cancel one occurrence. Converts an existing `override` into a `skip`."""
        occurrence_start = _naive_utc(occurrence_start)
        existing = self.get_exception(task_id, occurrence_start)
        if existing:
            existing.kind = "skip"
            existing.session_id = None
            self.db.add(existing)
        else:
            self.db.add(
                RecurrenceException(task_id=task_id, occurrence_start=occurrence_start, kind="skip")
            )
        self.db.commit()

    def truncate_series(self, task_id: str, from_occurrence_start: datetime) -> int:
        """End the series just before `from_occurrence_start` ("this and following").

        Deletes the exceptions at or after that instant and the materialized session rows of
        the `override` ones -- but **only** rows whose `start_time` is in the future. Logged
        past work is never deleted by a scope operation.

        Truncating at or before the series' first occurrence would write a rule with `UNTIL`
        before `DTSTART` -- zero occurrences, forever -- which `validate_rrule` would reject on
        every future save. That case (and any other anchor that happens to zero out the rule)
        means "the series should not exist" and is routed to the same outcome as `end_series`
        instead of ever being persisted.
        """
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)

        anchor = _naive_utc(from_occurrence_start)
        if task.recurrence_rrule:
            tz = resolve_timezone(task.recurrence_timezone)
            until_local = to_local_naive(anchor - timedelta(seconds=1), tz)
            candidate_rrule = set_until(task.recurrence_rrule, until_local)
            try:
                validate_rrule(candidate_rrule, task.recurrence_dtstart, task.recurrence_timezone)
            except ValidationError:
                return self.end_series(task_id)
            task.recurrence_rrule = candidate_rrule
            task.recurrence_rule = rrule_to_preset(candidate_rrule)
            self.db.add(task)

        deleted = self._drop_exceptions(task_id, at_or_after=anchor)
        self.db.commit()
        return deleted

    def end_series(self, task_id: str) -> int:
        """Stop the series entirely ("all"). Past logged rows are never touched."""
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)

        task.is_recurring = False
        task.recurrence_rrule = None
        task.recurrence_rule = None
        self.db.add(task)

        deleted = self._drop_exceptions(task_id, at_or_after=None)
        self.db.commit()
        return deleted

    def _drop_exceptions(self, task_id: str, at_or_after: datetime | None) -> int:
        """Delete exception rows (optionally only from an instant onwards) plus the session rows
        of `override` ones that are still in the future. Returns the session-row delete count."""
        now = _now_naive()
        query = select(RecurrenceException).where(RecurrenceException.task_id == task_id)
        if at_or_after is not None:
            query = query.where(RecurrenceException.occurrence_start >= at_or_after)
        deleted_sessions = 0
        for exc in self.db.exec(query).all():
            if exc.kind == "override" and exc.session_id:
                session = self.db.get(SessionModel, exc.session_id)
                if session and session.start_time and _naive_utc(session.start_time) > now:
                    self.db.delete(session)
                    deleted_sessions += 1
            self.db.delete(exc)
        return deleted_sessions

    def set_series_duration(self, task_id: str, duration_minutes: int) -> Task:
        """"All future occurrences" resize: write the per-occurrence duration on the task."""
        if duration_minutes <= 0:
            raise ValidationError("Recurrence duration must be a positive number of minutes.")
        task = self.db.get(Task, task_id)
        if not task:
            raise EntityNotFoundError("Task", task_id)
        if not task.is_recurring or not task.recurrence_rrule:
            raise ValidationError("Task is not recurring, so it has no series duration.")
        task.recurrence_duration_minutes = int(duration_minutes)
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)
        return task

    def reconcile_series(self, task_id: str) -> int:
        """Idempotent adoption/cleanup after a rule change or on first projection.

        Two directions, both exact-match only and both future-only:

        * a real future session row of the task sitting **exactly** on a projected occurrence
          with no exception is adopted as `kind="override"` (this is what stops a legacy DB
          double-rendering rows the old generator left at occurrence instants);
        * an exception whose `occurrence_start` is no longer an occurrence of the current rule
          is dropped -- a `skip` outright (the anchor it cancelled is gone), an `override` by
          deleting the exception and **keeping** the session row (real user work, just no
          longer part of the series).

        Past exceptions are never touched. Nor is an exception whose `occurrence_start` sits
        beyond the horizon this method actually expanded: `expand()` is bounded by both
        `MAX_WINDOW_DAYS` and `MAX_OCCURRENCES_PER_SERIES`, and a high-frequency rule can hit
        the occurrence cap well inside the day window. An exception past whichever boundary was
        actually hit is not "no longer an occurrence" -- it is simply outside what this call
        looked at -- and must be left alone rather than judged stale and deleted. Returns the
        number of rows changed.
        """
        if task_id in self._reconciled:
            return 0
        self._reconciled.add(task_id)

        task = self.db.get(Task, task_id)
        if not task:
            return 0
        spec = self.spec_for_task(task)
        now = _now_naive()
        horizon = now + timedelta(days=MAX_WINDOW_DAYS)

        exceptions = list(
            self.db.exec(
                select(RecurrenceException).where(RecurrenceException.task_id == task_id)
            ).all()
        )
        changes = 0

        occurrence_starts: set[datetime] = set()
        expanded_horizon = horizon
        if spec:
            expanded = expand(spec, now, horizon, task_id)
            occurrence_starts = {occ.start_utc for occ in expanded}
            if len(expanded) >= MAX_OCCURRENCES_PER_SERIES:
                # Truncated by the occurrence cap, not the day window -- only judge staleness
                # up to the last occurrence actually expanded.
                expanded_horizon = expanded[-1].start_utc

        for exc in exceptions:
            occ_start = _naive_utc(exc.occurrence_start)
            if occ_start <= now:
                continue
            if occ_start > expanded_horizon:
                # Outside the horizon this call actually expanded -- unknown, not stale.
                continue
            if occ_start in occurrence_starts:
                continue
            # No longer an occurrence of the current rule.
            self.db.delete(exc)
            changes += 1

        if not spec:
            if changes:
                self.db.commit()
            return changes

        linked_session_ids = {e.session_id for e in exceptions if e.session_id}
        claimed = {_naive_utc(e.occurrence_start) for e in exceptions if _naive_utc(e.occurrence_start) > now}
        future_rows = self.db.exec(
            select(SessionModel).where(
                SessionModel.task_id == task_id,
                SessionModel.start_time > now,
            )
        ).all()
        for row in future_rows:
            if row.id in linked_session_ids:
                continue
            if not (row.notes or "").startswith(_LEGACY_PLACEHOLDER_PREFIX):
                # Not a row the old pre-generator wrote -- e.g. the user's own session that
                # happens to coincide with a projected occurrence's instant. Adoption must never
                # claim it: a later scope=all/following delete would destroy real user work.
                continue
            start = _naive_utc(row.start_time)
            if start not in occurrence_starts or start in claimed:
                continue
            self.db.add(
                RecurrenceException(
                    task_id=task_id,
                    occurrence_start=start,
                    kind="override",
                    session_id=row.id,
                )
            )
            claimed.add(start)
            changes += 1

        if changes:
            try:
                self.db.commit()
            except IntegrityError:
                self.db.rollback()
                return 0
        return changes

    def detach_sessions(self, session_ids: list[str]) -> None:
        """Called before real session rows are deleted elsewhere (completion policy clearing).

        An `override` exception whose row disappears would otherwise dangle *and* let the
        occurrence re-project, resurrecting work the user just cleared. Convert it to a `skip`.
        """
        if not session_ids:
            return
        rows = self.db.exec(
            select(RecurrenceException).where(RecurrenceException.session_id.in_(session_ids))
        ).all()
        for exc in rows:
            exc.kind = "skip"
            exc.session_id = None
            self.db.add(exc)

    def delete_for_task(self, task_ids: list[str]) -> None:
        """Drop exception rows for tasks about to be deleted (no cascade exists for them)."""
        if not task_ids:
            return
        rows = self.db.exec(
            select(RecurrenceException).where(RecurrenceException.task_id.in_(task_ids))
        ).all()
        for exc in rows:
            self.db.delete(exc)


__all__ = ["ProjectedOccurrence", "RecurrenceService"]
