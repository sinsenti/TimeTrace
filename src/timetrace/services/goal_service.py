"""Personal targets over the shared structured summed-recorded-work evidence."""

import json
from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from timetrace.core.exceptions import ConflictError, EntityNotFoundError, ValidationError
from timetrace.core.query_spec import (
    AnalyticsQuery,
    DateRange,
    FilterField,
    Measure,
    QueryFilter,
    QuerySource,
    RangePreset,
)
from timetrace.db.models import GoalDefinition, GoalSettingsReceipt, GoalSettingsVersion, Task
from timetrace.db.session import lock_sqlite_writer, sqlite_read_snapshot
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.services.query_service import QueryService, _resolve_timezone, _week_start


class GoalService:
    def __init__(self, db: Session):
        self.db = db

    def create(self, request):
        lock_sqlite_writer(self.db)
        payload = request.model_dump_json()
        receipt = self.db.get(GoalSettingsReceipt, request.operation_id)
        if receipt:
            if receipt.payload != payload:
                raise ConflictError("Goal operation ID already used with another payload")
            return json.loads(receipt.response)
        warnings = []
        tz, timezone = _resolve_timezone(request.timezone, warnings)
        today = datetime.now(tz).date()
        if request.owner_kind == "global" and request.cadence == "total":
            raise ValidationError("Global total goals are not supported")
        if (request.owner_kind == "task") != bool(request.task_id):
            raise ValidationError("Task goals require a task ID; global goals cannot have one")
        if request.task_id and not self.db.get(Task, request.task_id):
            raise EntityNotFoundError("Task", request.task_id)
        if request.start_date and request.cadence != "total":
            raise ValidationError("Only total goals support a start date")
        period = _week_start(today, request.first_day_of_week) if request.cadence == "week" else today
        owner_key = request.task_id or "global"
        if self.db.exec(
            select(GoalDefinition).where(
                GoalDefinition.owner_key == owner_key, GoalDefinition.cadence == request.cadence
            )
        ).first():
            raise ConflictError("This goal is already configured; edit its settings")
        goal = GoalDefinition(owner_key=owner_key, cadence=request.cadence)
        version = GoalSettingsVersion(
            goal_id=goal.id,
            revision=1,
            effective_period_start=period.isoformat(),
            target_seconds=request.target_seconds,
            timezone=timezone,
            start_date=request.start_date.isoformat() if request.start_date else None,
            include_descendants=request.include_descendants,
            first_day_of_week=request.first_day_of_week,
        )
        response = {"id": goal.id, "revision": 1, "warnings": warnings}
        self.db.add(goal)
        self.db.add(version)
        self.db.add(
            GoalSettingsReceipt(operation_id=request.operation_id, payload=payload, response=json.dumps(response))
        )
        self.db.commit()
        return response

    def edit(self, goal_id, request):
        lock_sqlite_writer(self.db)
        payload = json.dumps({"goal_id": goal_id, **request.model_dump()}, sort_keys=True)
        receipt = self.db.get(GoalSettingsReceipt, request.operation_id)
        if receipt:
            if receipt.payload != payload:
                raise ConflictError("Goal operation ID already used with another payload")
            return json.loads(receipt.response)
        goal = self.db.get(GoalDefinition, goal_id)
        if not goal:
            raise EntityNotFoundError("Goal", goal_id)
        if goal.revision != request.expected_revision:
            raise ConflictError("Goal settings changed; refresh before saving")
        previous = self.db.exec(
            select(GoalSettingsVersion)
            .where(GoalSettingsVersion.goal_id == goal_id)
            .order_by(GoalSettingsVersion.revision.desc())
        ).first()
        tz, _ = _resolve_timezone(previous.timezone, [])
        today = datetime.now(tz).date()
        start = _week_start(today, previous.first_day_of_week) if goal.cadence == "week" else today
        goal.revision += 1
        version = GoalSettingsVersion(
            **{
                **previous.model_dump(exclude={"id"}),
                "revision": goal.revision,
                "effective_period_start": start.isoformat(),
                "target_seconds": request.target_seconds,
                "enabled": request.enabled,
                "include_descendants": request.include_descendants,
            }
        )
        response = {"id": goal.id, "revision": goal.revision}
        self.db.add(goal)
        self.db.add(version)
        self.db.add(
            GoalSettingsReceipt(operation_id=request.operation_id, payload=payload, response=json.dumps(response))
        )
        self.db.commit()
        return response

    def read(self, period_start=None):
        with sqlite_read_snapshot(self.db) as reader:
            goals = []
            for goal in reader.exec(select(GoalDefinition)).all():
                version = reader.exec(
                    select(GoalSettingsVersion)
                    .where(GoalSettingsVersion.goal_id == goal.id)
                    .order_by(GoalSettingsVersion.revision.desc())
                ).first()
                warnings = []
                tz, _ = _resolve_timezone(version.timezone, warnings)
                today = period_start or datetime.now(tz).date()
                start = _week_start(today, version.first_day_of_week) if goal.cadence == "week" else today
                version = reader.exec(
                    select(GoalSettingsVersion)
                    .where(
                        GoalSettingsVersion.goal_id == goal.id,
                        GoalSettingsVersion.effective_period_start <= start.isoformat(),
                    )
                    .order_by(GoalSettingsVersion.revision.desc())
                ).first()
                if not version or not version.enabled:
                    continue
                end = start + timedelta(days=6) if goal.cadence == "week" else start
                filters = (
                    [] if goal.owner_key == "global" else [QueryFilter(field=FilterField.TASK, values=[goal.owner_key])]
                )
                evidence = QueryService(reader).run(
                    AnalyticsQuery(
                        source=QuerySource.RECORDED_WORK,
                        measure=Measure.SUMMED_RECORDED_WORK,
                        filters=filters,
                        date_range=DateRange(
                            preset=RangePreset.CUSTOM, start_date=start.isoformat(), end_date=end.isoformat()
                        ),
                    ),
                    QueryContextRequest(timezone=version.timezone, first_day_of_week=version.first_day_of_week),
                )
                seconds = evidence.meta.physical_cohort_seconds
                context = evidence.meta.model_dump(mode="json")
                if goal.cadence == "total" or version.include_descendants:
                    lower = (
                        (date.fromisoformat(version.start_date) if version.start_date else None)
                        if goal.cadence == "total"
                        else start
                    )
                    total = QueryService(reader).summed_work_total(
                        goal.owner_key, lower, None if goal.cadence == "total" else end, version.include_descendants
                    )
                    seconds = total.pop("seconds")
                    context = total
                goals.append(
                    {
                        "id": goal.id,
                        "revision": goal.revision,
                        "target_seconds": version.target_seconds,
                        "owner_kind": "global" if goal.owner_key == "global" else "task",
                        "cadence": goal.cadence,
                        "summed_recorded_work_seconds": seconds,
                        "percentage": seconds / version.target_seconds * 100,
                        "basis": "summed_recorded_work",
                        "context": context,
                    }
                )
            return {"goals": goals}
