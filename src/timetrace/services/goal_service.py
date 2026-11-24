"""Personal targets over the shared structured summed-recorded-work evidence."""

import json
import math
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

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
from timetrace.db.models import GoalDefinition, GoalReportingContext, GoalSettingsReceipt, GoalSettingsVersion, Task
from timetrace.db.session import lock_sqlite_writer, sqlite_read_snapshot
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.services.query_service import QueryService, _resolve_timezone, _week_start


class GoalService:
    def __init__(self, db: Session):
        self.db = db

    def reporting_context(self, revision=None, selected_date=None, cadence="day"):
        epochs = self.db.exec(select(GoalReportingContext).order_by(GoalReportingContext.revision)).all()
        if revision is not None:
            epoch = next((e for e in epochs if e.revision == revision), None)
            if epoch is None:
                raise EntityNotFoundError("Reporting context", revision)
        elif epochs:
            field = "effective_week_start" if cadence == "week" else "effective_day_start"
            eligible = [e for e in epochs if selected_date is None or getattr(e, field) <= selected_date.isoformat()]
            epoch = eligible[-1] if eligible else epochs[0]
        else:
            _, timezone = _resolve_timezone(None, [])
            return {"revision": 0, "timezone": timezone, "first_day_of_week": 1}
        result = epoch.model_dump(mode="json")
        following = next((e for e in epochs if e.revision > epoch.revision), None)
        result["closed_at"] = following.effective_at if following else None
        result["daemon_timezone"] = _resolve_timezone(None, [])[1]
        result["epochs"] = [e.model_dump(mode="json") for e in epochs]
        result["warnings"] = (
            ["Context epochs are incomparable; never add totals across epochs."] if len(epochs) > 1 else []
        )
        return result

    @staticmethod
    def _period_context_warning(epoch, start, cadence, tz):
        field = "effective_week_start" if cadence == "week" else "effective_day_start"
        # The baseline context can describe periods before any goal was configured.
        if epoch["revision"] > 1 and start.isoformat() < epoch[field]:
            return "This reporting epoch was not yet effective for the selected period; select its historical epoch."
        if epoch.get("closed_at"):
            closed_day = datetime.fromisoformat(epoch["closed_at"]).astimezone(tz).date()
            boundary = _week_start(closed_day, epoch["first_day_of_week"]) if cadence == "week" else closed_day
            if start >= boundary:
                return "This reporting epoch is closed for the selected period; select the current epoch."
        return None

    def change_context(self, request):
        lock_sqlite_writer(self.db)
        payload = json.dumps({"resource": "goal-reporting-context", **request.model_dump(mode="json")}, sort_keys=True)
        receipt = self.db.get(GoalSettingsReceipt, request.operation_id)
        if receipt:
            if receipt.payload != payload:
                raise ConflictError("Reporting-context operation payload differs")
            return json.loads(receipt.response)
        previous = self.reporting_context()
        if previous["revision"] != request.expected_revision:
            raise ConflictError("Reporting context changed; refresh before saving")
        tz, timezone = _resolve_timezone(None, [])
        now = datetime.now(UTC)
        today = now.astimezone(tz).date()
        epoch = GoalReportingContext(
            revision=previous["revision"] + 1,
            timezone=timezone,
            first_day_of_week=request.first_day_of_week,
            effective_at=now.isoformat(),
            effective_day_start=today.isoformat(),
            effective_week_start=_week_start(today, request.first_day_of_week).isoformat(),
        )
        self.db.add(epoch)
        for goal in self.db.exec(select(GoalDefinition)).all():
            if goal.owner_key != "global" and self.db.get(Task, goal.owner_key) is None:
                continue
            settings = self.db.exec(
                select(GoalSettingsVersion)
                .where(GoalSettingsVersion.goal_id == goal.id)
                .order_by(GoalSettingsVersion.revision.desc())
            ).first()
            goal.revision += 1
            start = _week_start(today, request.first_day_of_week) if goal.cadence == "week" else today
            self.db.add(
                GoalSettingsVersion(
                    **{
                        **settings.model_dump(exclude={"id"}),
                        "revision": goal.revision,
                        "context_revision": epoch.revision,
                        "timezone": timezone,
                        "first_day_of_week": request.first_day_of_week,
                        "effective_period_start": start.isoformat(),
                    }
                )
            )
            self.db.add(goal)
        response = {
            **epoch.model_dump(mode="json"),
            "warnings": ["Prior periods retain their original context; epochs must not be merged."],
        }
        self.db.add(
            GoalSettingsReceipt(operation_id=request.operation_id, payload=payload, response=json.dumps(response))
        )
        self.db.commit()
        return response

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
        current_context = self.reporting_context()
        first = (
            request.first_day_of_week if request.first_day_of_week is not None else current_context["first_day_of_week"]
        )
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
        period = _week_start(today, first) if request.cadence == "week" else today
        owner_key = request.task_id or "global"
        if self.db.exec(
            select(GoalDefinition).where(
                GoalDefinition.owner_key == owner_key, GoalDefinition.cadence == request.cadence
            )
        ).first():
            raise ConflictError("This goal is already configured; edit its settings")
        context = self.reporting_context()
        if context["revision"] == 0:
            epoch = GoalReportingContext(
                revision=1,
                timezone=timezone,
                first_day_of_week=first,
                effective_at=datetime.now(UTC).isoformat(),
                effective_day_start=today.isoformat(),
                effective_week_start=_week_start(today, first).isoformat(),
            )
            self.db.add(epoch)
            context = epoch.model_dump(mode="json")
        elif context["timezone"] != timezone or context["first_day_of_week"] != first:
            raise ConflictError(
                "Reporting context changed; use the explicit reporting-context settings before creating this goal"
            )
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
            first_day_of_week=first,
            context_revision=context["revision"],
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
        payload = json.dumps(
            {"goal_id": goal_id, **request.model_dump(mode="json", exclude_unset=True)}, sort_keys=True
        )
        receipt = self.db.get(GoalSettingsReceipt, request.operation_id)
        if receipt:
            if receipt.payload != payload:
                raise ConflictError("Goal operation ID already used with another payload")
            return json.loads(receipt.response)
        goal = self.db.get(GoalDefinition, goal_id)
        if not goal:
            raise EntityNotFoundError("Goal", goal_id)
        if goal.owner_key != "global" and self.db.get(Task, goal.owner_key) is None:
            raise EntityNotFoundError("Task", goal.owner_key)
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
        tz, effective_timezone = _resolve_timezone(previous.timezone, [])
        if effective_timezone != previous.timezone:
            raise ConflictError(
                "Daemon timezone changed; explicitly start a new reporting epoch before editing targets"
            )
        today = datetime.now(tz).date()
        start = _week_start(today, previous.first_day_of_week) if goal.cadence == "week" else today
        goal.revision += 1
        version = GoalSettingsVersion(
            **{
                **previous.model_dump(exclude={"id"}),
                "revision": goal.revision,
                "effective_period_start": start.isoformat(),
                "target_seconds": request.target_seconds,
                "enabled": request.enabled if "enabled" in request.model_fields_set else previous.enabled,
                "include_descendants": request.include_descendants
                if "include_descendants" in request.model_fields_set
                else previous.include_descendants,
                "start_date": (request.start_date.isoformat() if request.start_date else None)
                if "start_date" in request.model_fields_set
                else previous.start_date,
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

    def weekly_review(self, selected_date, context, *, context_revision=None):
        with sqlite_read_snapshot(self.db) as reader:
            return GoalService(reader)._weekly_review(selected_date, context, context_revision=context_revision)

    def _weekly_review(self, selected_date, context, *, context_revision=None):
        """Compose existing structured evidence and accounting in the caller's snapshot."""
        from datetime import UTC, time

        from timetrace.core.query_spec import Dimension, FilterOp
        from timetrace.services.session_service import SessionService
        from timetrace.services.task_service import TaskService

        warnings = []
        epoch = self.reporting_context(context_revision, selected_date, "week")
        requested = epoch["timezone"] if epoch["revision"] else context.timezone
        effective_tz, name = _resolve_timezone(requested, warnings)
        tz = ZoneInfo(epoch["timezone"]) if epoch["revision"] else effective_tz
        first = (
            epoch["first_day_of_week"]
            if epoch["revision"]
            else (context.first_day_of_week if context.first_day_of_week is not None else 1)
        )
        if epoch["revision"] and context.first_day_of_week not in (None, first):
            warnings.append(
                "Requested week start differs from this persisted epoch; its frozen week start is retained."
            )
        if context.timezone and context.timezone != requested:
            warnings.append("Requested timezone differs from the persisted epoch; its frozen timezone is retained.")
        context = QueryContextRequest(timezone=requested, first_day_of_week=first)
        warnings.extend(epoch.get("warnings", []))
        start = _week_start(selected_date or datetime.now(tz).date(), first)
        end = start + timedelta(days=6)
        period_warning = self._period_context_warning(epoch, start, "week", tz)
        available = name == tz.key and period_warning is None
        if period_warning:
            warnings.append(period_warning)
        cutoff = datetime.now(UTC).replace(tzinfo=None)
        with sqlite_read_snapshot(self.db) as reader:
            service = QueryService(reader)

            def query(measure, groups=None, filters=None):
                response = service.run(
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
                    measurement_at=cutoff,
                )
                if any("does not support" in warning for warning in response.meta.warnings):
                    result["available"] = False
                if not result["available"]:
                    response.total = None
                    response.rows = []
                    response.row_count = 0
                    response.meta.physical_cohort_seconds = None
                    response.meta.attributed_total_seconds = None
                    response.meta.cohort_count = None
                    response.meta.warnings.append(
                        "Selected frozen context is unavailable; no fallback totals are credited."
                    )
                return response

            result = {
                "week_start": start.isoformat(),
                "week_end": end.isoformat(),
                "warnings": warnings,
                "measurement_at": cutoff.isoformat(),
                "basis": "summed_recorded_work",
                "context_revision": epoch["revision"],
                "reporting_context": epoch,
                "available": available,
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
            result["goals"] = GoalService(reader).read(
                start,
                measurement_at=cutoff,
                context_revision=epoch["revision"] or None,
                cadences=("week", "total"),
            )["goals"]
            result["daily_goals"] = {}
            for offset in range(7):
                day = start + timedelta(days=offset)
                result["daily_goals"][day.isoformat()] = GoalService(reader).read(
                    day, measurement_at=cutoff, context_revision=epoch["revision"] or None, cadences=("day",)
                )["goals"]
            configured = result["goals"] + [g for day_goals in result["daily_goals"].values() for g in day_goals]
            ids = sorted(
                {row.keys[0] for row in result["tasks"].rows} | {g["task_id"] for g in configured if g["task_id"]}
            )
            result["estimate_accounting"] = (
                {
                    task.id: TaskService(reader).get_work_accounting(task)
                    for task in reader.exec(select(Task).where(Task.id.in_(ids))).all()
                }
                if ids
                else {}
            )
            from timetrace.interfaces.api.utils import ensure_utc

            lower = datetime.combine(start, time.min, tz).astimezone(UTC)
            upper = datetime.combine(end + timedelta(days=1), time.min, tz).astimezone(UTC)
            sessions = SessionService(reader)
            plans = (
                []
                if period_warning
                else sessions.list_review_plans(lower.replace(tzinfo=None), upper.replace(tzinfo=None))
            )
            result["uncertain_legacy"] = (
                {"items": [], "truncated": False, "basis": period_warning}
                if period_warning
                else sessions.list_uncertain_history(lower, upper)
            )
            result["plans"] = []
            for plan in plans[:200]:
                original_start = getattr(plan, "original_start", None)
                original_end = getattr(plan, "original_end", None)
                result["plans"].append(
                    {
                        **plan.model_dump(mode="json"),
                        "original_in_week": bool(
                            original_start
                            and original_end
                            and ensure_utc(original_start) < upper
                            and ensure_utc(original_end) > lower
                        ),
                        "current_in_week": ensure_utc(plan.start_time) < upper and ensure_utc(plan.end_time) > lower,
                    }
                )
            result["plan_cohort"] = (
                "Original or current plan overlaps selected week; projections have no archived original. "
                "Plans never credit goals."
            )
            if len(plans) > 200:
                warnings.append(
                    "Plan display truncated at 200; recorded global totals are independent of displayed rows."
                )
            return result

    def read(
        self, period_start=None, include_disabled=False, *, measurement_at=None, context_revision=None, cadences=None
    ):
        cutoff = measurement_at or datetime.now(UTC).replace(tzinfo=None)
        with sqlite_read_snapshot(self.db) as reader:
            goals = []
            definitions = select(GoalDefinition)
            if cadences is not None:
                definitions = definitions.where(GoalDefinition.cadence.in_(cadences))
            for goal in reader.exec(definitions).all():
                owner_task = reader.get(Task, goal.owner_key) if goal.owner_key != "global" else None
                if goal.owner_key != "global" and owner_task is None:
                    continue
                version = reader.exec(
                    select(GoalSettingsVersion)
                    .where(GoalSettingsVersion.goal_id == goal.id)
                    .order_by(GoalSettingsVersion.revision.desc())
                ).first()
                epoch = GoalService(reader).reporting_context(
                    None if goal.cadence == "total" else context_revision,
                    None if goal.cadence == "total" else period_start,
                    goal.cadence,
                )
                tz = ZoneInfo(epoch["timezone"])
                today = period_start or datetime.now(tz).date()
                start = _week_start(today, epoch["first_day_of_week"]) if goal.cadence == "week" else today
                if goal.cadence != "total":
                    if self._period_context_warning(epoch, start, goal.cadence, tz):
                        continue
                    version = reader.exec(
                        select(GoalSettingsVersion)
                        .where(
                            GoalSettingsVersion.goal_id == goal.id,
                            GoalSettingsVersion.context_revision == epoch["revision"],
                            GoalSettingsVersion.effective_period_start <= start.isoformat(),
                        )
                        .order_by(GoalSettingsVersion.revision.desc())
                    ).first()
                if not version or (not version.enabled and not include_disabled):
                    continue
                end = start + timedelta(days=6) if goal.cadence == "week" else start
                lower = (
                    (date.fromisoformat(version.start_date) if version.start_date else None)
                    if goal.cadence == "total"
                    else start
                )
                context = QueryService(reader).summed_work_total(
                    None if goal.owner_key == "global" else goal.owner_key,
                    lower,
                    None if goal.cadence == "total" else end,
                    version.include_descendants,
                    measurement_at=cutoff,
                    timezone=version.timezone,
                    first_day_of_week=version.first_day_of_week,
                )
                seconds = context.pop("seconds")
                context["requested_timezone"] = version.timezone
                context["reliable"] = context["timezone"] == version.timezone and not any(
                    "does not support" in w for w in context.get("warnings", [])
                )
                context["first_day_of_week"] = version.first_day_of_week
                if not context["reliable"]:
                    context.setdefault("warnings", []).append(
                        "Frozen goal context cannot be reliably queried by this daemon; progress is unavailable, "
                        "not rebucketed. Explicitly start a new reporting epoch for current/future periods."
                    )
                ratio = Decimal(str(seconds)) / Decimal(str(version.target_seconds)) * 100
                percentage = float(ratio)
                display_percentage = f"{percentage:.1f}%" if math.isfinite(percentage) else f"{ratio}%"
                if not math.isfinite(percentage):
                    percentage = None
                goals.append(
                    {
                        "id": goal.id,
                        "revision": goal.revision,
                        "target_seconds": version.target_seconds,
                        "owner_kind": "global" if goal.owner_key == "global" else "task",
                        "task_id": None if goal.owner_key == "global" else goal.owner_key,
                        "task_title": owner_task.title if owner_task else None,
                        "cadence": goal.cadence,
                        "enabled": version.enabled,
                        "include_descendants": version.include_descendants,
                        "start_date": version.start_date,
                        "settings_revision": version.revision,
                        "context_revision": version.context_revision,
                        "period_start": version.start_date if goal.cadence == "total" else start.isoformat(),
                        "period_end": None if goal.cadence == "total" else end.isoformat(),
                        "summed_recorded_work_seconds": seconds if version.enabled and context["reliable"] else None,
                        "percentage": percentage if version.enabled and context["reliable"] else None,
                        "percentage_display": display_percentage
                        if version.enabled and context["reliable"]
                        else "unavailable",
                        "basis": "summed_recorded_work",
                        "context": context,
                    }
                )
            return {"goals": goals}
