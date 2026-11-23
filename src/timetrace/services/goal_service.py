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
        if request.owner_kind == "global" and request.include_descendants:
            raise ValidationError("Global goals do not have a descendant scope")
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
            enabled=request.enabled,
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
        payload = json.dumps({"goal_id": goal_id, **request.model_dump(mode="json")}, sort_keys=True)
        receipt = self.db.get(GoalSettingsReceipt, request.operation_id)
        if receipt:
            if receipt.payload != payload:
                raise ConflictError("Goal operation ID already used with another payload")
            return json.loads(receipt.response)
        goal = self.db.get(GoalDefinition, goal_id)
        if not goal:
            raise EntityNotFoundError("Goal", goal_id)
        if goal.owner_key == "global" and request.include_descendants:
            raise ValidationError("Global goals do not have a descendant scope")
        if goal.cadence != "total" and request.start_date:
            raise ValidationError("Only total goals support a start date")
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
                "start_date": request.start_date.isoformat() if request.start_date else None,
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

    def weekly_review(self, selected_date, context):
        """Compose existing structured evidence and accounting, not a second statistics engine."""
        from datetime import UTC, time

        from timetrace.core.query_spec import Dimension, FilterOp
        from timetrace.services.session_service import SessionService
        from timetrace.services.task_service import TaskService

        warnings = []
        tz, name = _resolve_timezone(context.timezone, warnings)
        first = context.first_day_of_week if context.first_day_of_week is not None else 1
        start = _week_start(selected_date or datetime.now(tz).date(), first)
        end = start + timedelta(days=6)
        cutoff = datetime.now(UTC).replace(tzinfo=None)
        with sqlite_read_snapshot(self.db) as reader:
            service = QueryService(reader)

            def query(measure, groups=None, filters=None):
                return service._run(
                    AnalyticsQuery(
                        source=QuerySource.RECORDED_WORK,
                        measure=measure,
                        group_by=groups or [],
                        filters=filters or [],
                        date_range=DateRange(
                            preset=RangePreset.CUSTOM, start_date=start.isoformat(), end_date=end.isoformat()
                        ),
                    ),
                    context,
                    cutoff,
                )

            result = {
                "week_start": start.isoformat(),
                "week_end": end.isoformat(),
                "warnings": warnings,
                "measurement_at": cutoff.isoformat(),
                "basis": "summed_recorded_work",
            }
            for measure in [
                Measure.SUMMED_RECORDED_WORK,
                Measure.RECORDED_TASK_TIME,
                Measure.ELAPSED_RECORDED_TIME,
                Measure.UNASSIGNED_RECORDED_TIME,
            ]:
                result[measure.value] = query(measure)
            result["taskless_summed_recorded_work"] = query(
                Measure.SUMMED_RECORDED_WORK,
                filters=[QueryFilter(field=FilterField.HAS_TASK, op=FilterOp.EQ, values=[False])],
            )
            result["daily"] = query(Measure.SUMMED_RECORDED_WORK, [Dimension.DAY])
            result["tasks"] = query(
                Measure.SUMMED_RECORDED_WORK, [Dimension.TASK], [QueryFilter(field=FilterField.HAS_TASK, values=[True])]
            )
            result["goals"] = GoalService(reader).read(start)["goals"]
            ids = [row.keys[0] for row in result["tasks"].rows]
            result["estimate_accounting"] = (
                {
                    task.id: TaskService(reader).get_work_accounting(task)
                    for task in reader.exec(select(Task).where(Task.id.in_(ids))).all()
                }
                if ids
                else {}
            )
            plans = SessionService(reader).list_planning_plans(
                datetime.combine(start, time.min, tz).astimezone(UTC).replace(tzinfo=None),
                datetime.combine(end + timedelta(days=1), time.min, tz).astimezone(UTC).replace(tzinfo=None),
            )
            result["plans"] = [plan.model_dump(mode="json") for plan in plans[:200]]
            if len(plans) > 200:
                warnings.append(
                    "Plan display truncated at 200; recorded global totals are independent of displayed rows."
                )
            return result

    def read(self, period_start=None, include_disabled=False):
        with sqlite_read_snapshot(self.db) as reader:
            goals = []
            for goal in reader.exec(select(GoalDefinition)).all():
                if goal.owner_key != "global" and reader.get(Task, goal.owner_key) is None:
                    continue
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
                if not version or (not version.enabled and not include_disabled):
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
                        "task_id": None if goal.owner_key == "global" else goal.owner_key,
                        "cadence": goal.cadence,
                        "enabled": version.enabled,
                        "include_descendants": version.include_descendants,
                        "start_date": version.start_date,
                        "settings_revision": version.revision,
                        "period_start": start.isoformat(),
                        "period_end": end.isoformat(),
                        "summed_recorded_work_seconds": seconds if version.enabled else None,
                        "percentage": seconds / version.target_seconds * 100 if version.enabled else None,
                        "basis": "summed_recorded_work",
                        "context": context,
                    }
                )
            return {"goals": goals}
