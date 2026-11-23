import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import case, insert, literal, or_, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, select

from timetrace.core.exceptions import ConflictError, EntityNotFoundError, ValidationError
from timetrace.core.recurrence import MAX_WINDOW_DAYS, is_occurrence_id, parse_occurrence_id
from timetrace.db.models import (
    MutationOperation,
    RecurrenceException,
    ScheduledSession,
    Task,
    WorkCorrection,
    generate_uuid7,
)
from timetrace.db.models import Session as SessionModel
from timetrace.db.session import lock_sqlite_writer, sqlite_read_snapshot
from timetrace.interfaces.api.schemas import (
    AgendaLegacyRead,
    AgendaProjectedPlanRead,
    AgendaRead,
    AgendaRecordedWorkRead,
    LegacySessionRead,
    RecordedWorkCreate,
    RecordedWorkCreated,
    ReflectionCreate,
    RetroSessionCreate,
    ScheduledOccurrenceUpdate,
    ScheduledSessionCreate,
    ScheduledSessionExtension,
    ScheduledSessionInfo,
    ScheduledSessionRead,
    ScheduledSessionUpdate,
    SessionCreate,
    SessionUpdate,
)
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.recurrence_service import ProjectedOccurrence, RecurrenceService

EDIT_SCOPES = ("only_this", "all_future")
DELETE_SCOPES = ("only_this", "following", "all")


class SessionService:
    """The single merge funnel for sessions.

    Real `session` rows, projected (virtual) occurrences of recurring tasks and the exception
    table are merged here and nowhere else, so no caller can see half the picture. Synthetic
    occurrence ids (`virt:<task_id>:<stamp>`) are accepted by the GET/PUT/DELETE paths and
    materialized into real rows on write.
    """

    def __init__(self, db: Session):
        self.db = db
        self._recurrence: RecurrenceService | None = None

    @property
    def recurrence(self) -> RecurrenceService:
        if self._recurrence is None:
            self._recurrence = RecurrenceService(self.db)
        return self._recurrence

    def create_recorded_work(self, req: RecordedWorkCreate) -> RecordedWorkCreated:
        try:
            result = self.stage_recorded_work(req, provenance="manual")
            self.db.commit()
            return result
        except Exception:
            self.db.rollback()
            raise

    def stage_recorded_work(
        self,
        req: RecordedWorkCreate,
        *,
        provenance: Literal["manual", "timer"],
        timer_identity: dict[str, str] | None = None,
    ) -> RecordedWorkCreated:
        """Stage validated work under the SQLite writer lock; never commit or roll back.

        The returned UUID is stable for this staged row. The caller owns durability and must
        roll back the entire transaction on failure, including captured projection/plan revisions.
        Provenance is server-internal: the HTTP manual adapter always supplies ``manual``.
        """
        measurement_at = datetime.now(UTC).replace(tzinfo=None)
        start, end = self._scheduled_interval(req.start_time, req.end_time)
        if provenance not in ("manual", "timer"):
            raise ValidationError("Unsupported recording provenance.")
        if end > measurement_at:
            raise ValidationError("Recorded work cannot end in the future.", code="future_recorded_end")
        lock_sqlite_writer(self.db)
        if req.task_id is not None and self.db.get(Task, req.task_id) is None:
            raise EntityNotFoundError("Task", req.task_id)
        plan = None
        if req.scheduled_session_id is not None:
            if is_occurrence_id(req.scheduled_session_id):
                if req.expected_plan_revision is not None:
                    raise ValidationError("A projection requires only its projection revision.")
                try:
                    occurrence = self.recurrence.projected_occurrence(req.scheduled_session_id, planning=True)
                except EntityNotFoundError, ValidationError:
                    raise self._stale_projection() from None
                if occurrence.projection_revision != req.expected_projection_revision:
                    raise self._stale_projection()
                if req.task_id is None or req.task_id != occurrence.task_id:
                    raise ConflictError(
                        "Association requires the same non-null task.", code="association_task_conflict"
                    )
                plan = ScheduledSession(
                    task_id=occurrence.task_id,
                    original_start=occurrence.start_utc,
                    original_end=occurrence.end_utc,
                    start_time=occurrence.start_utc,
                    end_time=occurrence.end_utc,
                    tags=occurrence.tags,
                )
                self.db.add(plan)
                self.db.flush()
                self.db.add(
                    RecurrenceException(
                        task_id=occurrence.task_id,
                        occurrence_start=occurrence.start_utc,
                        kind="override",
                        scheduled_session_id=plan.id,
                    )
                )
            else:
                if req.expected_projection_revision is not None:
                    raise ValidationError("A persisted plan requires only its plan revision.")
                plan = self.db.get(ScheduledSession, req.scheduled_session_id)
                if plan is None:
                    raise EntityNotFoundError("Scheduled session", req.scheduled_session_id)
                if req.task_id is None or req.task_id != plan.task_id:
                    raise ConflictError(
                        "Association requires the same non-null task.", code="association_task_conflict"
                    )
                if plan.revision != req.expected_plan_revision:
                    raise self._stale_plan()
            from timetrace.services.correction_guards import check_correction_guard

            check_correction_guard(self.db, plan_ids=[plan.id])
            plan.revision += 1
            self.db.add(plan)
        elif req.expected_plan_revision is not None or req.expected_projection_revision is not None:
            raise ValidationError("A plan revision requires an explicit association.")
        if timer_identity is not None and provenance != "timer":
            raise ValidationError("Timer identity requires internal timer provenance.")
        row = SessionModel(
            **(timer_identity or {}),
            task_id=req.task_id,
            start_time=start,
            end_time=end,
            scheduled_session_id=plan.id if plan else None,
            duration_seconds=int((end - start).total_seconds()),
            tags=req.tags,
            notes=req.notes,
            kind="recorded_work",
            provenance=provenance,
        )
        warnings = []
        if req.task_id is not None:
            overlaps = self.db.exec(
                select(SessionModel)
                .where(
                    SessionModel.kind == "recorded_work",
                    SessionModel.task_id == req.task_id,
                    SessionModel.start_time < end,
                    SessionModel.end_time > start,
                    SessionModel.end_time <= measurement_at,
                )
                .order_by(SessionModel.start_time, SessionModel.id)
            ).all()
            warnings = [
                {
                    "record_ids": [other.id],
                    "overlap_seconds": (min(end, other.end_time) - max(start, other.start_time)).total_seconds(),
                }
                for other in overlaps
            ]
        self.db.add(row)
        self.db.flush()
        result = RecordedWorkCreated.model_validate(
            {
                **self._read_agenda_session(row).model_dump(),
                "warnings": warnings,
            }
        )
        return result

    def correction_lineage(self, work_id):
        row = self.db.get(SessionModel, work_id)
        identities = set()
        if row and row.provenance == "timer" and row.timer_id and row.timer_segment_id:
            identities.add((row.timer_id, row.timer_segment_id))
        elif row is None:
            # A deleted row still has an exact immutable receipt mapping. Never
            # infer segment ownership from task, timestamps or array position.
            receipts = self.db.exec(
                select(MutationOperation).where(MutationOperation.after_state_json.contains(work_id))
            ).all()
            for receipt in receipts:
                try:
                    state = json.loads(receipt.after_state_json)
                    for timer in state.get("timers", {}).values():
                        for segment in timer.get("segments", []):
                            if segment.get("recorded_work_id") == work_id:
                                identities.add((timer["id"], segment["id"]))
                except (ValueError, TypeError, KeyError, AttributeError) as exc:
                    raise ConflictError(
                        "Historical receipt mapping requires recovery.", code="reconciliation_required"
                    ) from exc
        conditions = [WorkCorrection.source_work_id == work_id, WorkCorrection.results_json.contains(work_id)]
        for timer_id, segment_id in identities:
            conditions.extend(
                [
                    WorkCorrection.source_identity == f"/timers/{timer_id}/segments/{segment_id}",
                    WorkCorrection.results_json.contains(segment_id),
                ]
            )
        events = self.db.exec(select(WorkCorrection).where(or_(*conditions)).order_by(WorkCorrection.id)).all()
        if not events:
            return None
        root = work_id
        for event in events:
            for item in json.loads(event.results_json):
                if item.get("work_id") == work_id:
                    root = item.get("rating_source_work_id", root)
        return {
            "original_work_id": root,
            "rating_source_work_id": root,
            "operation_ids": [e.operation_id for e in events],
        }

    def stage_work_corrections(self, changes):
        """Apply fixed full-row CAS predicates/fragments; receipt owner commits history atomically."""
        lock_sqlite_writer(self.db)
        for change in changes:
            row = self.db.get(SessionModel, change["before"]["id"])
            if row is None or row.model_dump(mode="json") != change["before"]:
                raise ConflictError("Pending correction work changed.", code="reconciliation_required")
            for index, values in enumerate(change["rows"]):
                restored = SessionModel.model_validate(values)
                if index == 0:
                    for field in SessionModel.model_fields:
                        setattr(row, field, getattr(restored, field))
                    self.db.add(row)
                else:
                    self.db.add(restored)
        self.db.flush()

    def update_recorded_work_note(self, work_id: str, notes: str, expected_revision: int) -> AgendaRecordedWorkRead:
        """Edit only the work description; retain timestamps, association and review identity."""
        lock_sqlite_writer(self.db)
        from timetrace.services.correction_guards import check_correction_guard

        check_correction_guard(self.db, work_ids=[work_id])
        row = self.db.get(SessionModel, work_id)
        if row is None or row.kind != "recorded_work":
            raise EntityNotFoundError("Recorded work not found.")
        result = self.db.execute(
            update(SessionModel)
            .where(
                SessionModel.id == work_id,
                SessionModel.kind == "recorded_work",
                SessionModel.revision == expected_revision,
            )
            .values(notes=notes, revision=expected_revision + 1)
        )
        if result.rowcount != 1:
            self.db.rollback()
            raise ConflictError("Recorded work changed; read the saved note before editing again.")
        self.db.commit()
        self.db.expire_all()
        return self.get_recorded_work(work_id)

    def get_recorded_work(self, work_id: str) -> AgendaRecordedWorkRead:
        row = self.db.get(SessionModel, work_id)
        if row is None or row.kind != "recorded_work":
            raise EntityNotFoundError("Recorded work", work_id)
        return self._read_agenda_session(row)

    def create_scheduled_session(self, req: ScheduledSessionCreate) -> ScheduledSessionRead:
        response = self.stage_scheduled_session(req)
        self.db.commit()
        return response

    def stage_scheduled_session(self, req: ScheduledSessionCreate) -> ScheduledSessionRead:
        """Insert in the caller's transaction; an attached new task must already be flushed."""
        start, end = self._scheduled_interval(req.start_time, req.end_time)
        columns = ("id", "task_id", "start_time", "end_time", "original_start", "original_end", "tags", "notes")
        values = (generate_uuid7(), req.task_id, start, end, start, end, req.tags, req.notes)
        row = select(*(literal(value) for value in values))
        if req.task_id is not None:
            # Validate the FK in the INSERT, not in a separate read which could race task deletion.
            row = row.where(select(Task.id).where(Task.id == req.task_id).exists())
        statement = insert(ScheduledSession).from_select(columns, row).returning(ScheduledSession)
        plan = self.db.scalars(statement).one_or_none()
        if plan is None:
            raise EntityNotFoundError("Task", req.task_id)
        return self._read_scheduled_session(plan)

    def get_scheduled_session(self, plan_id: str) -> ScheduledSessionRead | AgendaProjectedPlanRead:
        if is_occurrence_id(plan_id):
            return self._read_projected_plan(self.recurrence.projected_occurrence(plan_id, planning=True))
        result = self.db.exec(self._plans_with_series().where(ScheduledSession.id == plan_id)).one_or_none()
        if result is None:
            raise EntityNotFoundError("Scheduled session", plan_id)
        plan, exception = result
        return self._read_scheduled_session(plan, exception)

    def extend_scheduled_session(self, plan_id: str, req: ScheduledSessionExtension) -> ScheduledSessionRead:
        """Only the selected current end changes; the finalized DB receipt is atomic with it."""
        payload = {"action": "extend", "plan_id": plan_id, **req.model_dump(mode="json")}
        payload["end_time"] = ensure_utc(req.end_time).isoformat()
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        try:
            lock_sqlite_writer(self.db)
            receipt = self.db.get(MutationOperation, req.operation_id)
            if receipt:
                if receipt.payload_hash != digest:
                    raise ConflictError("Operation payload differs.", code="operation_payload_mismatch")
                return ScheduledSessionRead.model_validate_json(receipt.result_json)
            try:
                plan = self.get_scheduled_session(plan_id)
            except EntityNotFoundError, ValidationError:
                if is_occurrence_id(plan_id):
                    raise self._stale_projection() from None
                raise
            virtual = plan.is_virtual
            if virtual:
                if req.expected_revision is not None or req.expected_projection_revision != plan.projection_revision:
                    raise self._stale_projection()
            elif req.expected_projection_revision is not None or req.expected_revision != plan.revision:
                raise self._stale_plan()
            if ensure_utc(req.end_time) <= ensure_utc(plan.end_time):
                raise ValidationError("Extension end must be after the current scheduled end.", code="invalid_interval")
            data = {"start_time": plan.start_time, "end_time": req.end_time}
            if virtual:
                update_req = ScheduledOccurrenceUpdate(
                    **data, expected_projection_revision=req.expected_projection_revision
                )
                saved = self._materialize_scheduled_occurrence(plan_id, update_req, resize_series=False, commit=False)
            else:
                start, end = self._scheduled_interval(plan.start_time, req.end_time)
                saved = self._update_plan_interval(plan_id, req.expected_revision, start, end, commit=False)
            self.db.add(
                MutationOperation(
                    id=req.operation_id,
                    payload_hash=digest,
                    before_revision=0 if virtual else plan.revision,
                    after_revision=saved.revision,
                    cutoff=datetime.now(UTC).isoformat(),
                    after_state_json="{}",
                    result_json=saved.model_dump_json(),
                    file_finalized=True,
                )
            )
            self.db.commit()
            return saved
        except Exception:
            self.db.rollback()
            raise

    def update_scheduled_session(
        self, plan_id: str, req: ScheduledSessionUpdate | ScheduledOccurrenceUpdate, scope: str = "only_this"
    ) -> ScheduledSessionRead:
        if scope not in EDIT_SCOPES:
            raise ValidationError(f"scope '{scope}' is not supported for edits.")
        if is_occurrence_id(plan_id):
            if not isinstance(req, ScheduledOccurrenceUpdate):
                raise ValidationError("A virtual occurrence requires expected_projection_revision.")
            return self._materialize_scheduled_occurrence(plan_id, req, resize_series=scope == "all_future")
        if not isinstance(req, ScheduledSessionUpdate):
            raise ValidationError("A persisted plan requires expected_revision.")
        start, end = self._scheduled_interval(req.start_time, req.end_time)
        if scope == "all_future":
            try:
                lock_sqlite_writer(self.db)
                plan = self.db.get(ScheduledSession, plan_id)
                if plan is None:
                    raise EntityNotFoundError("Scheduled session", plan_id)
                if plan.revision != req.expected_revision:
                    raise self._stale_plan()
                exception = self.recurrence.exception_for_plan(plan_id)
                if exception is None or plan.task_id != exception.task_id:
                    raise ValidationError("scope 'all_future' requires a scheduled occurrence in an active series.")
                task = self.db.get(Task, exception.task_id)
                if not self.recurrence.occurrence_exists(task, exception.occurrence_start):
                    raise ValidationError("This scheduled session is no longer an occurrence of the series.")
                # A series resize must not move the selected plan, including moving a previously
                # moved plan back onto its original anchor.
                if start != plan.start_time:
                    raise ValidationError("scope 'all_future' only changes the occurrence length.")
                self.recurrence.set_series_duration(task.id, self._series_minutes(start, end), exclude_plan_id=plan_id)
                return self._update_plan_interval(plan_id, req.expected_revision, start, end)
            except Exception:
                self.db.rollback()
                raise
        return self._update_plan_interval(plan_id, req.expected_revision, start, end)

    def _update_plan_interval(
        self, plan_id: str, revision: int, start: datetime, end: datetime, *, commit: bool = True
    ) -> ScheduledSessionRead:
        from timetrace.services.correction_guards import check_correction_guard

        lock_sqlite_writer(self.db)
        check_correction_guard(self.db, plan_ids=[plan_id])
        # Compare-and-set in one statement: two concurrent editors cannot both overwrite revision N.
        plan = self.db.scalars(
            update(ScheduledSession)
            .where(ScheduledSession.id == plan_id, ScheduledSession.revision == revision)
            .values(start_time=start, end_time=end, revision=ScheduledSession.revision + 1)
            .returning(ScheduledSession)
            .execution_options(populate_existing=True)
        ).one_or_none()
        if plan is None:
            if self.db.get(ScheduledSession, plan_id) is None:
                raise EntityNotFoundError("Scheduled session", plan_id)
            raise self._stale_plan()
        response = self._read_scheduled_session(plan, self.recurrence.exception_for_plan(plan_id))
        if commit:
            self.db.commit()
        return response

    def _materialize_scheduled_occurrence(
        self, occurrence_id: str, req: ScheduledOccurrenceUpdate, *, resize_series: bool, commit: bool = True
    ) -> ScheduledSessionRead:
        start, end = self._scheduled_interval(req.start_time, req.end_time)
        try:
            lock_sqlite_writer(self.db)
            try:
                occurrence = self.recurrence.projected_occurrence(occurrence_id, planning=True)
            except EntityNotFoundError, ValidationError:
                raise self._stale_projection() from None
            if occurrence.projection_revision != req.expected_projection_revision:
                raise self._stale_projection()
            plan = ScheduledSession(
                task_id=occurrence.task_id,
                original_start=occurrence.start_utc,
                original_end=occurrence.end_utc,
                start_time=start,
                end_time=end,
                tags=occurrence.tags,
            )
            self.db.add(plan)
            self.db.flush()
            exception = RecurrenceException(
                task_id=occurrence.task_id,
                occurrence_start=occurrence.start_utc,
                kind="override",
                scheduled_session_id=plan.id,
            )
            self.db.add(exception)
            if resize_series:
                if start != occurrence.start_utc:
                    raise ValidationError("scope 'all_future' only changes the occurrence length.")
                self.recurrence.set_series_duration(
                    occurrence.task_id, self._series_minutes(start, end), exclude_plan_id=plan.id
                )
            response = self._read_scheduled_session(plan, exception)
            if commit:
                self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise self._stale_projection() from None
        except Exception:
            self.db.rollback()
            raise
        return response

    @staticmethod
    def _series_minutes(start: datetime, end: datetime) -> int:
        return max(1, int(round((end - start).total_seconds() / 60)))

    @staticmethod
    def _stale_plan() -> ConflictError:
        return ConflictError("The schedule changed. Reload it before editing again.", code="revision_stale")

    @staticmethod
    def _stale_projection() -> ConflictError:
        return ConflictError(
            "The occurrence is no longer available as read. Reload the schedule.", code="projection_stale"
        )

    @staticmethod
    def _read_projected_plan(occurrence: ProjectedOccurrence) -> AgendaProjectedPlanRead:
        row = occurrence.to_dict()
        return AgendaProjectedPlanRead.model_validate(
            {
                **row,
                "original_start": row["start_time"],
                "original_end": row["end_time"],
                "projection_revision": occurrence.projection_revision,
            }
        )

    @staticmethod
    def _scheduled_interval(start: datetime, end: datetime) -> tuple[datetime, datetime]:
        start = ensure_utc(start).replace(tzinfo=None)
        end = ensure_utc(end).replace(tzinfo=None)
        if end <= start:
            raise ValidationError("end_time must be strictly after start_time", code="invalid_interval")
        return start, end

    @staticmethod
    def _read_scheduled_session(
        plan: ScheduledSession, exception: RecurrenceException | None = None
    ) -> ScheduledSessionRead:
        return ScheduledSessionRead(
            id=plan.id,
            task_id=plan.task_id,
            start_time=ensure_utc(plan.start_time),
            end_time=ensure_utc(plan.end_time),
            original_start=ensure_utc(plan.original_start),
            original_end=ensure_utc(plan.original_end),
            duration_seconds=int((plan.end_time - plan.start_time).total_seconds()),
            tags=plan.tags,
            notes=plan.notes,
            revision=plan.revision,
            series_task_id=exception.task_id if exception else None,
            occurrence_start=ensure_utc(exception.occurrence_start) if exception else None,
        )

    @staticmethod
    def _planning_bounds(start: datetime, end: datetime) -> tuple[datetime, datetime]:
        start, end = (ensure_utc(value).replace(tzinfo=None) for value in (start, end))
        if end <= start:
            raise ValidationError("end must be strictly after start", code="invalid_interval")
        if end - start > timedelta(days=MAX_WINDOW_DAYS):
            raise ValidationError(f"Requested range exceeds the maximum of {MAX_WINDOW_DAYS} days.")
        return start, end

    def list_planning_plans(
        self, start: datetime, end: datetime
    ) -> list[ScheduledSessionRead | AgendaProjectedPlanRead]:
        """Explicit plans and live projections overlapping [start, end), never work or legacy rows."""
        start, end = self._planning_bounds(start, end)
        with sqlite_read_snapshot(self.db) as reader:
            return SessionService(reader)._planning_plans(start, end)

    @staticmethod
    def _plans_with_series():
        return select(ScheduledSession, RecurrenceException).outerjoin(
            RecurrenceException, RecurrenceException.scheduled_session_id == ScheduledSession.id
        )

    def _planning_plans(self, start: datetime, end: datetime) -> list[ScheduledSessionRead | AgendaProjectedPlanRead]:
        items = [
            self._read_scheduled_session(plan, exception)
            for plan, exception in self.db.exec(
                self._plans_with_series().where(ScheduledSession.start_time < end, ScheduledSession.end_time > start)
            )
        ]
        items.extend(
            self._read_projected_plan(occurrence)
            for occurrence in self.recurrence.project_range(start, end, overlap=True)
        )
        return items

    def list_agenda(self, start: datetime, end: datetime, *, legacy_start_cohort: bool = False) -> AgendaRead:
        start, end = self._planning_bounds(start, end)
        measurement_at = datetime.now(UTC)
        with sqlite_read_snapshot(self.db) as reader:
            agenda = SessionService(reader)
            items = agenda._planning_plans(start, end)
            if legacy_start_cohort:
                # Calendar uses the legacy start-window predicate, including zero-length imports.
                rows = reader.exec(
                    select(SessionModel, RecurrenceException)
                    .outerjoin(RecurrenceException, RecurrenceException.session_id == SessionModel.id)
                    .where(SessionModel.start_time >= start, SessionModel.start_time < end)
                    .order_by(RecurrenceException.id)
                )
                seen: set[str] = set()
                for row, exception in rows:
                    if row.id not in seen:
                        items.append(agenda._read_agenda_session(row, exception))
                        seen.add(row.id)
            else:
                items.extend(agenda._read_agenda_session(row) for row in agenda._overlapping_session_rows(start, end))
        items.sort(key=lambda item: (item.start_time, item.id))
        return AgendaRead(items=items, measurement_at=measurement_at)

    def get_agenda_occurrence(
        self, occurrence_id: str
    ) -> ScheduledSessionRead | AgendaProjectedPlanRead | AgendaLegacyRead:
        """Find the exact current occupant of a recurrence identity, not a same-time match."""
        anchor = parse_occurrence_id(occurrence_id)
        if anchor is None:
            raise EntityNotFoundError("Occurrence", occurrence_id)
        with sqlite_read_snapshot(self.db) as reader:
            agenda = SessionService(reader)
            exception = agenda.recurrence.get_exception(*anchor)
            if exception is None:
                return agenda.get_scheduled_session(occurrence_id)
            if exception.scheduled_session_id:
                plan = reader.get(ScheduledSession, exception.scheduled_session_id)
                if plan is not None:
                    return agenda._read_scheduled_session(plan, exception)
            if exception.session_id:
                row = reader.get(SessionModel, exception.session_id)
                if row is not None and row.kind == "legacy_uncertain":
                    return agenda._read_agenda_session(row, exception)
            raise EntityNotFoundError("Occurrence", occurrence_id)

    def _read_agenda_session(self, row: SessionModel, exception: RecurrenceException | None = None) -> AgendaLegacyRead:
        read_type = AgendaRecordedWorkRead if row.kind == "recorded_work" else AgendaLegacyRead
        update = self._utc_session_times(row)
        if row.kind == "recorded_work":
            update["correction_lineage"] = self.correction_lineage(row.id)
        if exception and row.kind == "legacy_uncertain":
            return read_type.model_validate(row).model_copy(
                update={
                    **update,
                    "series_task_id": exception.task_id,
                    "occurrence_start": ensure_utc(exception.occurrence_start),
                }
            )
        return read_type.model_validate(row).model_copy(update=update)

    @staticmethod
    def _utc_session_times(row: SessionModel) -> dict[str, datetime | None]:
        return {"start_time": ensure_utc(row.start_time), "end_time": ensure_utc(row.end_time)}

    @classmethod
    def _read_legacy_session(cls, row: SessionModel) -> LegacySessionRead:
        return LegacySessionRead.model_validate(row).model_copy(update=cls._utc_session_times(row))

    @classmethod
    def _legacy_session_dict(cls, row: SessionModel, *, list_item: bool = False) -> dict[str, Any]:
        read = cls._read_legacy_session(row)
        item = read.model_dump()
        item["start_time"] = read.start_time.isoformat()
        item["end_time"] = read.end_time.isoformat() if read.end_time is not None else None
        if list_item:
            item["is_virtual"] = False
        return item

    def legacy_create_candidate(self, req: SessionCreate) -> SessionModel:
        """Normalize a legacy create without staging any database changes."""
        start_utc = ensure_utc(req.start_time)
        end_utc = ensure_utc(req.end_time)

        if end_utc <= start_utc:
            raise ValidationError("end_time must be strictly after start_time")

        valid_task_id = req.task_id
        if valid_task_id:
            task_obj = self.db.get(Task, valid_task_id)
            if not task_obj:
                valid_task_id = None

        duration = int((end_utc - start_utc).total_seconds())
        return SessionModel(
            task_id=valid_task_id,
            start_time=start_utc.replace(tzinfo=None),
            end_time=end_utc.replace(tzinfo=None),
            duration_seconds=duration,
            tags=req.tags or "",
            notes=req.notes or "",
            review_skipped=req.review_skipped,
        )

    def create_session(self, req: SessionCreate) -> LegacySessionRead:
        db_session = self.legacy_create_candidate(req)
        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        return self._read_legacy_session(db_session)

    def list_sessions(
        self,
        start: datetime | None = None,
        end: datetime | None = None,
        include_virtual: bool = True,
    ) -> list[dict[str, Any]]:
        """Real rows merged with projected occurrences.

        Virtuals are only appended when **both** bounds are given: an unbounded projection is
        meaningless, and the unbounded callers (`session_review.js`, `stats.js`,
        `timer_control.js`) are logged-work surfaces.
        """
        query = select(SessionModel)
        if start:
            naive_start = ensure_utc(start).replace(tzinfo=None)
            query = query.where(SessionModel.start_time >= naive_start)
        if end:
            naive_end = ensure_utc(end).replace(tzinfo=None)
            query = query.where(SessionModel.start_time < naive_end)

        result = [self._legacy_session_dict(row, list_item=True) for row in self.db.exec(query)]

        if start and end and include_virtual:
            if (ensure_utc(end) - ensure_utc(start)) > timedelta(days=MAX_WINDOW_DAYS):
                raise ValidationError(f"Requested range exceeds the maximum of {MAX_WINDOW_DAYS} days.")
            result.extend(occ.to_dict() for occ in self.recurrence.project_range(start, end))
            result.sort(key=lambda item: item.get("start_time") or "")

        return result

    def list_overlapping_sessions(
        self,
        start: datetime,
        end: datetime,
        include_virtual: bool = True,
    ) -> list[dict[str, Any]]:
        """Compatibility read: overlapping session rows plus optional start-in-window projections.

        This preserves the legacy DTO and shares the overlap query with ``list_agenda``. New
        planning consumers should use ``list_agenda`` for typed plans and projection carry-ins.
        """
        start_utc = ensure_utc(start)
        end_utc = ensure_utc(end)
        if end_utc <= start_utc:
            raise ValidationError("end must be strictly after start")

        result = [
            self._legacy_session_dict(row, list_item=True)
            for row in self._overlapping_session_rows(start_utc.replace(tzinfo=None), end_utc.replace(tzinfo=None))
        ]

        if include_virtual:
            if (end_utc - start_utc) > timedelta(days=MAX_WINDOW_DAYS):
                raise ValidationError(f"Requested range exceeds the maximum of {MAX_WINDOW_DAYS} days.")
            result.extend(occ.to_dict() for occ in self.recurrence.project_range(start_utc, end_utc))

        result.sort(key=lambda item: item.get("start_time") or "")
        return result

    def _overlapping_session_rows(self, naive_start: datetime, naive_end: datetime) -> list[SessionModel]:
        query = select(SessionModel).where(
            SessionModel.start_time < naive_end,
            or_(SessionModel.end_time.is_(None), SessionModel.end_time > naive_start),
        )
        return list(self.db.exec(query))

    def next_upcoming_occurrence(self, within_days: int = 30) -> dict[str, Any] | None:
        """Earliest future plan, legacy commitment or live recurrence projection."""
        with sqlite_read_snapshot(self.db) as reader:
            return SessionService(reader)._next_upcoming_occurrence(within_days)

    def _next_upcoming_occurrence(self, within_days: int) -> dict[str, Any] | None:
        now = datetime.now(UTC)
        now_naive = now.replace(tzinfo=None)
        legacy = self.db.exec(
            select(SessionModel)
            .where(SessionModel.start_time > now_naive, SessionModel.kind == "legacy_uncertain")
            .order_by(SessionModel.start_time, SessionModel.id)
        ).first()
        plan = self.db.exec(
            select(ScheduledSession)
            .where(ScheduledSession.start_time > now_naive)
            .order_by(ScheduledSession.start_time, ScheduledSession.id)
        ).first()
        upcoming = min((row for row in (legacy, plan) if row is not None), key=lambda row: row.start_time, default=None)
        projected = self.recurrence.next_upcoming(within_days=within_days)
        if upcoming is not None and (projected is None or upcoming.start_time <= projected.start_utc):
            task = self.db.get(Task, upcoming.task_id) if upcoming.task_id else None
            return {
                "title": task.title if task else upcoming.notes or upcoming.tags or "Scheduled Session",
                "start_time": ensure_utc(upcoming.start_time),
                "id": upcoming.id,
            }
        if projected:
            return {
                "title": projected.task_title or "Scheduled Session",
                "start_time": ensure_utc(projected.start_utc),
                "id": projected.occurrence_id,
            }
        return None

    def get_session_by_id(self, session_id: str) -> dict[str, Any]:
        if is_occurrence_id(session_id):
            occurrence = self.recurrence.projected_occurrence(session_id)
            s_dict = occurrence.to_dict()
            task = self.db.get(Task, occurrence.task_id)
            if task:
                s_dict["task"] = task.model_dump()
            return s_dict

        s = self.db.get(SessionModel, session_id)
        if not s:
            raise EntityNotFoundError("Session", session_id)

        s_dict = self._legacy_session_dict(s)
        if s.task:
            s_dict["task"] = s.task.model_dump()

        return s_dict

    def update_session(self, session_id: str, req: SessionUpdate, scope: str = "only_this") -> LegacySessionRead:
        """Apply an edit, materializing a virtual occurrence first if needed.

        `scope="only_this"` touches this occurrence alone. `scope="all_future"` additionally
        writes the new per-occurrence length to the task's `recurrence_duration_minutes`, so
        every later occurrence inherits it (settled owner decision Q2). A move (changed start)
        is not expressible for a whole series and is rejected for `all_future`.
        """
        if scope not in EDIT_SCOPES:
            raise ValidationError(
                f"scope '{scope}' is not supported for edits -- "
                "use 'only_this' or 'all_future', or edit the recurrence on the task."
            )

        lock_sqlite_writer(self.db)
        try:
            return self._update_legacy_session(session_id, req, scope)
        except Exception:
            self.db.rollback()
            raise

    def _update_legacy_session(self, session_id: str, req: SessionUpdate, scope: str) -> LegacySessionRead:
        self.require_legacy_mutation_target(session_id)
        db_session = None
        if not is_occurrence_id(session_id):
            db_session = self.db.get(SessionModel, session_id)
            if not db_session:
                raise EntityNotFoundError("Session", session_id)
            self.recurrence.reconcile_legacy_occurrence(db_session)

        if scope == "all_future":
            self._apply_series_duration(session_id, req)

        if db_session is None:
            db_session = self.recurrence.materialize(session_id)

        candidate = self.legacy_update_candidate(db_session, req)
        for field in (*req.model_fields_set, "duration_seconds"):
            setattr(db_session, field, getattr(candidate, field))

        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        return self._read_legacy_session(db_session)

    def legacy_update_candidate(self, row: SessionModel, req: SessionUpdate) -> SessionModel:
        """Normalize an edit on a transient copy; leave the existing row and exception untouched."""
        candidate = SessionModel(**row.model_dump())
        update_dict = req.model_dump(exclude_unset=True)
        for key, val in update_dict.items():
            if key in ("start_time", "end_time") and val is not None:
                setattr(candidate, key, ensure_utc(val).replace(tzinfo=None))
            elif key == "task_id" and val is not None:
                if self.db.get(Task, val):
                    candidate.task_id = val
                else:
                    candidate.task_id = None
            else:
                setattr(candidate, key, val)

        if candidate.start_time and candidate.end_time:
            st = ensure_utc(candidate.start_time)
            et = ensure_utc(candidate.end_time)
            if et <= st:
                raise ValidationError("end_time must be strictly after start_time")
            candidate.duration_seconds = max(0, int((et - st).total_seconds()))

        if candidate.start_time is None:
            raise ValidationError("start_time must not be null")
        return candidate

    def _apply_series_duration(self, session_id: str, req: SessionUpdate) -> None:
        """Write the requested length to the series' `recurrence_duration_minutes`."""
        if is_occurrence_id(session_id):
            task, occurrence_start = self.recurrence.resolve_occurrence(session_id)
            current_start = occurrence_start
            current_end = occurrence_start + timedelta(minutes=task.recurrence_duration_minutes or 15)
        else:
            row = self.db.get(SessionModel, session_id)
            if not row:
                raise EntityNotFoundError("Session", session_id)
            if not row.task_id:
                raise ValidationError("scope 'all_future' requires a session on a recurring task.")
            task = self.db.get(Task, row.task_id)
            if not task or not task.is_recurring or not task.recurrence_rrule:
                raise ValidationError("scope 'all_future' requires a session on a recurring task.")
            exception = self.recurrence.exception_for_session(row.id)
            current_start = (
                ensure_utc(exception.occurrence_start).replace(tzinfo=None)
                if exception
                else ensure_utc(row.start_time).replace(tzinfo=None)
            )
            current_end = (
                ensure_utc(row.end_time).replace(tzinfo=None)
                if row.end_time
                else current_start + timedelta(minutes=task.recurrence_duration_minutes or 15)
            )

        update_dict = req.model_dump(exclude_unset=True)
        new_start = (
            ensure_utc(update_dict["start_time"]).replace(tzinfo=None)
            if update_dict.get("start_time")
            else current_start
        )
        new_end = (
            ensure_utc(update_dict["end_time"]).replace(tzinfo=None) if update_dict.get("end_time") else current_end
        )
        if new_end <= new_start:
            raise ValidationError("end_time must be strictly after start_time")
        if new_start != current_start:
            raise ValidationError(
                "scope 'all_future' only changes the occurrence length; "
                "move a single occurrence with scope 'only_this'."
            )

        self.recurrence.set_series_duration(task.id, self._series_minutes(new_start, new_end))

    def delete_session(self, session_id: str, scope: str = "only_this") -> None:
        """Delete one occurrence, or truncate/end a series.

        `following` and `all` never delete a session row whose `start_time` is in the past --
        that was a live data-loss bug (`scope="all"` used to delete *every* session of the task,
        logged history included) reachable from the delete modal.
        """
        if scope not in DELETE_SCOPES:
            raise ValidationError(f"scope '{scope}' is not a valid deletion scope.")

        lock_sqlite_writer(self.db)
        try:
            self._delete_legacy_session(session_id, scope)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

    def _delete_legacy_session(self, session_id: str, scope: str) -> None:
        self.require_legacy_mutation_target(session_id, deleting=True)
        if is_occurrence_id(session_id):
            task, occurrence_start = self.recurrence.resolve_occurrence(session_id)
            if scope == "only_this":
                self.recurrence.skip(task.id, occurrence_start, commit=False)
            elif scope == "following":
                if not self.recurrence.occurrence_exists(task, occurrence_start):
                    raise EntityNotFoundError("Occurrence", session_id)
                self.recurrence.truncate_series(task.id, occurrence_start, commit=False)
            else:
                self.recurrence.end_series(task.id, commit=False)
            return

        db_session = self.db.get(SessionModel, session_id)
        if not db_session:
            raise EntityNotFoundError("Session", session_id)

        exception = (
            self.recurrence.reconcile_legacy_occurrence(db_session)
            if scope == "only_this"
            else self.recurrence.exception_for_session(db_session.id)
        )
        task = self.db.get(Task, db_session.task_id) if db_session.task_id else None
        now_naive = datetime.now(UTC).replace(tzinfo=None)
        row_start = ensure_utc(db_session.start_time).replace(tzinfo=None) if db_session.start_time else None

        if scope == "only_this":
            if exception:
                # Keep the RECURRENCE-ID so the occurrence does not re-project.
                exception.kind = "skip"
                exception.session_id = None
                self.db.add(exception)
            self.db.delete(db_session)
            return

        if not task or not task.is_recurring or not task.recurrence_rrule:
            raise ValidationError(f"scope '{scope}' requires a session on a recurring task.")

        anchor = ensure_utc(exception.occurrence_start).replace(tzinfo=None) if exception else row_start
        if anchor is None:
            raise ValidationError(f"scope '{scope}' requires a session with a start time.")

        if scope == "following":
            self.recurrence.truncate_series(task.id, anchor, commit=False)
        else:
            self.recurrence.end_series(task.id, commit=False)

        # The picked row itself: only ever deleted when it is still in the future.
        row = self.db.get(SessionModel, session_id)
        if row and row_start and row_start > now_naive:
            self.db.delete(row)

    def create_retro_session(self, req: RetroSessionCreate) -> LegacySessionRead:
        start_utc = ensure_utc(req.start_time)
        end_utc = ensure_utc(req.end_time)

        if end_utc <= start_utc:
            raise ValidationError("end_time must be strictly after start_time")

        valid_task_id = req.task_id
        if valid_task_id and not self.db.get(Task, valid_task_id):
            valid_task_id = None

        duration = int((end_utc - start_utc).total_seconds())
        db_session = SessionModel(
            task_id=valid_task_id,
            start_time=start_utc.replace(tzinfo=None),
            end_time=end_utc.replace(tzinfo=None),
            duration_seconds=duration,
            tags=req.tags or "",
            notes=req.notes or "",
        )
        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        return self._read_legacy_session(db_session)

    def _future_legacy_sessions(self, task_ids: list[str], now_naive: datetime) -> list[SessionModel]:
        if not task_ids:
            return []
        return list(
            self.db.exec(
                select(SessionModel).where(
                    SessionModel.task_id.in_(task_ids),
                    SessionModel.kind == "legacy_uncertain",
                    SessionModel.start_time > now_naive,
                )
            ).all()
        )

    @staticmethod
    def _future_plan_scope(task_ids: list[str], now: datetime):
        return ScheduledSession.task_id.in_(task_ids), ScheduledSession.start_time > now

    def list_completion_schedules(self, task_ids: list[str]) -> list[ScheduledSessionInfo]:
        if not task_ids:
            return []
        now = datetime.now(UTC).replace(tzinfo=None)
        sessions = [
            ScheduledSessionInfo.model_validate(row, from_attributes=True).model_copy(
                update=self._utc_session_times(row)
            )
            for row in self._future_legacy_sessions(task_ids, now)
        ]
        for plan in self.db.exec(select(ScheduledSession).where(*self._future_plan_scope(task_ids, now))):
            sessions.append(
                ScheduledSessionInfo.model_validate(self._read_scheduled_session(plan), from_attributes=True)
            )
        return sessions

    def require_legacy_clear_scope(
        self, own_task_id: str, selected_ids: list[str] | None, subtree_ids: list[str]
    ) -> None:
        if selected_ids:
            for plan_id in selected_ids:
                self.require_legacy_mutation_target(plan_id, deleting=True)
        all_scope_ids = subtree_ids + ([own_task_id] if selected_ids is None else [])
        now = datetime.now(UTC).replace(tzinfo=None)
        plan_exists = select(ScheduledSession.id).where(*self._future_plan_scope(all_scope_ids, now)).exists()
        if all_scope_ids and self.db.exec(select(plan_exists)).one():
            raise ConflictError(
                "Clearing explicit scheduled sessions is not supported yet.", code="plan_delete_unsupported"
            )

    def sum_durations_for_tasks(self, task_ids: list[str]) -> tuple[int, int]:
        if not task_ids:
            return (0, 0)

        now_naive = datetime.now(UTC).replace(tzinfo=None)

        logged_seconds = self.db.exec(
            select(func.coalesce(func.sum(SessionModel.duration_seconds), 0)).where(
                SessionModel.task_id.in_(task_ids),
                SessionModel.end_time.is_not(None),
                SessionModel.end_time <= now_naive,
            )
        ).one()

        scheduled_seconds = self.db.exec(
            select(func.coalesce(func.sum(SessionModel.duration_seconds), 0)).where(
                SessionModel.task_id.in_(task_ids),
                SessionModel.end_time.is_not(None),
                SessionModel.start_time > now_naive,
            )
        ).one()

        # SQLite stores naive UTC datetimes as text. Use integer seconds and adjust for
        # fractional endpoints to match the per-row truncated duration returned by the API.
        start, end = ScheduledSession.start_time, ScheduledSession.end_time
        duration = (
            func.unixepoch(func.substr(end, 1, 19))
            - func.unixepoch(func.substr(start, 1, 19))
            - case((func.substr(end, 20) < func.substr(start, 20), 1), else_=0)
        )
        plan_seconds = self.db.exec(
            select(func.coalesce(func.sum(duration), 0)).where(
                ScheduledSession.task_id.in_(task_ids), ScheduledSession.start_time > now_naive
            )
        ).one()
        return (int(logged_seconds), int(scheduled_seconds) + int(plan_seconds))

    def detach_plans_for_deleted_tasks(self, task_ids: set[str], *, allow: bool = True) -> None:
        """Stage detachment in the caller's already locked task-delete transaction."""
        from timetrace.services.correction_guards import check_correction_guard

        check_correction_guard(self.db, task_ids=task_ids)
        plans = select(ScheduledSession.id).where(ScheduledSession.task_id.in_(task_ids))
        if not allow:
            if self.db.exec(plans.limit(1)).first() is not None:
                raise ConflictError("AI cannot delete a task with scheduled sessions; use task management.")
            return
        self.db.execute(
            update(SessionModel)
            .where(SessionModel.scheduled_session_id.in_(plans))
            .values(scheduled_session_id=None, revision=SessionModel.revision + 1)
        )
        self.db.execute(
            update(ScheduledSession)
            .where(ScheduledSession.task_id.in_(task_ids))
            .values(task_id=None, revision=ScheduledSession.revision + 1)
        )

    def clear_future_sessions(
        self, task_ids: list[str], session_ids: list[str] | None = None, *, commit: bool = True
    ) -> list[str]:
        future_sessions = self._future_legacy_sessions(task_ids, datetime.now(UTC).replace(tzinfo=None))

        if session_ids is not None:
            requested_ids = set(session_ids)
            owned_ids = {
                s.id for s in self.db.exec(select(SessionModel).where(SessionModel.task_id.in_(task_ids))).all()
            }
            if not requested_ids.issubset(owned_ids):
                raise ValidationError("session_ids must belong to the task's scheduled sessions")
            to_delete = [s for s in future_sessions if s.id in requested_ids]
        else:
            to_delete = future_sessions

        deleted_ids = [s.id for s in to_delete]
        # Any occurrence materialized into one of these rows becomes a skip, so clearing the
        # schedule does not let the series re-project the work the user just cleared.
        for row in to_delete:
            self.recurrence.reconcile_legacy_occurrence(row)
        self.recurrence.detach_sessions(deleted_ids)
        for s in to_delete:
            self.db.delete(s)
        if commit:
            self.db.commit()
        return deleted_ids

    def require_legacy_mutation_target(self, session_id: str, *, deleting: bool = False) -> None:
        occurrence = parse_occurrence_id(session_id)
        if occurrence is not None:
            exception = self.recurrence.get_exception(*occurrence)
            if exception is None:
                return
            is_plan = exception.scheduled_session_id is not None
            legacy_id = exception.session_id
        else:
            is_plan = self.db.get(ScheduledSession, session_id) is not None
            legacy_id = session_id
        if is_plan:
            if deleting:
                raise ConflictError("Deleting scheduled sessions is not supported yet.", code="plan_delete_unsupported")
            raise ConflictError("Use the scheduled-session interface for this plan.", code="typed_session_unsupported")
        row = self.db.get(SessionModel, legacy_id) if legacy_id is not None else None
        if row is not None and row.kind != "legacy_uncertain":
            raise ConflictError("This route cannot change explicit recorded work.", code="typed_session_unsupported")

    def record_reflection(self, req: ReflectionCreate) -> dict[str, Any]:
        self.require_legacy_mutation_target(req.session_id)
        db_session = self.db.get(SessionModel, req.session_id)
        if not db_session:
            raise EntityNotFoundError("Session", req.session_id)

        reflection_notes = [f"Energy: {req.energy_level}/5"]
        if req.habits_completed:
            reflection_notes.append(f"Habits: {', '.join(req.habits_completed)}")
        if req.obstacles:
            reflection_notes.append(f"Obstacles: {req.obstacles}")

        additional_note = " | ".join(reflection_notes)
        if db_session.notes:
            db_session.notes = f"{db_session.notes}\n{additional_note}"
        else:
            db_session.notes = additional_note

        self.db.add(db_session)
        self.db.commit()
        self.db.refresh(db_session)
        return {"status": "success", "session_id": db_session.id, "reflection": additional_note}
