"""Saved-work adapter to the existing signed interval planner and receipt funnel.

The view is transient interval algebra input, never a second persistent timer.
All actual row writes are staged by SessionService in the funnel's transaction.
"""

import json
from copy import deepcopy
from datetime import datetime
from uuid import uuid7

from sqlmodel import or_, select

from timetrace.config import settings
from timetrace.core.correction_identity import evidence, signing_key
from timetrace.core.correction_step import fingerprint, signature
from timetrace.core.exceptions import ConflictError, EntityNotFoundError
from timetrace.core.timezones import daemon_tzinfo, resolve_timezone
from timetrace.db.models import (
    AIDraftItem,
    DayReview,
    RatingDefinition,
    RatingEntry,
    RecurrenceException,
    ScheduledSession,
    Task,
    TaskReview,
    WorkCorrection,
)
from timetrace.db.models import Session as Work
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.session_service import SessionService


class SavedCorrectionService:
    def __init__(self, timers):
        self.timers, self.db = timers, timers.db

    def _view(self, state, resource, request):
        direct = resource.startswith("/recorded-work/")
        explicit = resource.removeprefix("/recorded-work/") if direct else None
        selected = request["target"]
        targets = selected["targets"] if selected["kind"] == "selection" else [selected]
        targets = sorted(targets, key=lambda target: (target["kind"], target.get("work_id", target.get("segment_id"))))
        if direct and (len(targets) != 1 or targets[0]["kind"] != "saved" or targets[0]["work_id"] != explicit):
            raise ConflictError("Saved route requires its own explicit saved target.", code="correction_target_stale")
        rows = {}
        for target in targets:
            if target["kind"] != "saved":
                continue
            row = self.db.get(Work, target["work_id"])
            if row is None:
                if not direct:
                    raise ConflictError("Saved target is not owned by selected timer.", code="correction_target_stale")
                raise EntityNotFoundError("Recorded work", target["work_id"])
            if (
                row.kind != "recorded_work"
                or row.provenance not in ("manual", "timer")
                or self.db.exec(select(RecurrenceException.id).where(RecurrenceException.session_id == row.id)).first()
            ):
                raise ConflictError("Unsupported legacy/recurrence work kind.", code="unsupported_work_kind")
            if row.provenance == "manual" and any(
                value is not None for value in (row.timer_id, row.timer_operation_id, row.timer_segment_id)
            ):
                raise ConflictError("Manual work has inconsistent timer provenance.", code="unsupported_work_kind")
            if row.provenance == "timer" and any(
                value is not None for value in (row.timer_id, row.timer_operation_id, row.timer_segment_id)
            ):
                if not row.timer_operation_id or not row.timer_segment_id or row.timer_id == "":
                    raise ConflictError("Timer provenance is incomplete.", code="unsupported_work_kind")
            if row.task_id is not None and self.db.get(Task, row.task_id) is None:
                raise ConflictError("Saved task context is missing.", code="correction_context_invalid")
            if row.scheduled_session_id is not None:
                plan = self.db.get(ScheduledSession, row.scheduled_session_id)
                if plan is None or plan.task_id != row.task_id:
                    raise ConflictError("Saved association context is inconsistent.", code="correction_context_invalid")
            if row.revision != target["expected_revision"]:
                raise ConflictError("Saved work revision changed.", code="correction_preview_stale")
            if row.id in rows:
                raise ConflictError("Duplicate saved targets.", code="correction_target_stale")
            rows[row.id] = row
        if not rows:
            raise ConflictError("Explicit saved work required.", code="correction_target_stale")
        timer_id = next(iter(rows.values())).timer_id if direct else resource.removeprefix("/timers/")
        actual = state["timers"].get(timer_id)
        if not direct:
            if actual is None or any(r.timer_id != timer_id for r in rows.values()):
                raise ConflictError("Saved work is not owned by selected timer.", code="correction_target_stale")
            for row in rows.values():
                if not any(s.get("recorded_work_id") == row.id for s in actual["segments"]):
                    raise ConflictError("Saved membership changed.", code="correction_target_stale")
        if actual and (actual["state"] == "frozen" or any(g.get("decision") is None for g in actual["idle_gaps"])):
            raise ConflictError("Resolve idle first.", code="idle_gap_unresolved")
        view = (
            deepcopy(actual)
            if actual
            else {
                "id": resource,
                "revision": 1,
                "state": "paused",
                "segments": [],
                "running_start": None,
                "idle_gaps": [],
                "task_id": None,
                "scheduled_session_id": None,
                "notes": "",
                "tags": "",
            }
        )
        if view["state"] == "stopped":
            view["state"] = "paused"  # Planner eligibility only; actual stopped state is restored before persistence.
        for row in rows.values():
            previous = next((s for s in view["segments"] if s.get("recorded_work_id") == row.id), None)
            boundary = previous.get("correction_evidence") if previous else None
            history_match = [WorkCorrection.results_json.contains(row.id)]
            if row.provenance == "timer" and row.timer_segment_id:
                history_match.append(WorkCorrection.results_json.contains(row.timer_segment_id))
            events = self.db.exec(select(WorkCorrection).where(or_(*history_match)).order_by(WorkCorrection.id)).all()
            for event in events:
                for result in json.loads(event.results_json):
                    if result.get("work_id") == row.id or (
                        row.provenance == "timer"
                        and row.timer_segment_id
                        and result.get("segment_id") == row.timer_segment_id
                    ):
                        boundary = result.get("correction_evidence") or boundary
            boundary = boundary or evidence(
                None if row.provenance == "manual" else ensure_utc(row.start_time).isoformat(),
                "uninterrupted" if row.provenance == "manual" else "legacy_unknown",
            )
            view["segments"] = [s for s in view["segments"] if s.get("recorded_work_id") != row.id]
            view["segments"].append(
                {
                    "id": "saved:" + row.id,
                    "start_time": ensure_utc(row.start_time).isoformat(),
                    "end_time": ensure_utc(row.end_time).isoformat(),
                    "task_id": row.task_id,
                    "scheduled_session_id": row.scheduled_session_id,
                    "tags": row.tags,
                    "notes": row.notes,
                    "correction_evidence": deepcopy(boundary),
                }
            )
        inner_request = deepcopy(request)
        translated = []
        for target in targets:
            translated.append(
                {"kind": "buffered", "segment_id": "saved:" + target["work_id"]}
                if target["kind"] == "saved"
                else target
            )
        inner_request["target"] = (
            {"kind": "selection", "targets": translated} if selected["kind"] == "selection" else translated[0]
        )
        return view, actual, rows, inner_request

    def preview(self, state, resource, request, cutoff, allocated=None):
        view, actual, rows, inner_request = self._view(state, resource, request)
        plan = self.timers._step_preview(
            {"timers": {**state["timers"], view["id"]: view}},
            view["id"],
            inner_request,
            cutoff,
            allocated,
            excluded_work_ids=tuple(rows),
        )
        key = signing_key(settings.db_file.parent / "correction-signing.key")
        plan["resource"] = resource
        plan["signature"] = signature(plan, key)
        if plan["action"] == "exclude":
            for fragment in plan["after"]:
                if (
                    fragment["source_segment_id"].startswith("saved:")
                    and fragment["segment_id"] != fragment["source_segment_id"]
                    and self.db.get(Work, fragment["segment_id"]) is not None
                ):
                    raise ConflictError("Allocated fragment already exists.", code="correction_preview_invalid")
        dependencies = []
        ids = set(rows)
        for identity in rows:
            lineage = SessionService(self.db).correction_lineage(identity)
            if lineage:
                ids.add(lineage["rating_source_work_id"])
        ids = sorted(ids)
        ratings = self.db.exec(select(RatingEntry).where(RatingEntry.target_id.in_(ids)).order_by(RatingEntry.id)).all()
        definitions = [
            definition.model_dump(mode="json")
            if (definition := self.db.get(RatingDefinition, r.rating_definition_id))
            else None
            for r in ratings
        ]
        drafts = self.db.exec(
            select(AIDraftItem)
            .where(or_(AIDraftItem.target_id.in_(ids), AIDraftItem.applied_entity_id.in_(ids)))
            .order_by(AIDraftItem.id)
        ).all()
        for _identity, row in sorted(rows.items()):
            history = self.db.exec(
                select(WorkCorrection)
                .where(
                    or_(
                        WorkCorrection.source_work_id.in_(ids),
                        *[WorkCorrection.results_json.contains(source) for source in ids],
                        *(
                            [WorkCorrection.results_json.contains(row.timer_segment_id)]
                            if row.provenance == "timer" and row.timer_segment_id
                            else []
                        ),
                    )
                )
                .order_by(WorkCorrection.id)
            ).all()
            dependencies.append(
                {"row": row.model_dump(mode="json"), "history": [e.model_dump(mode="json") for e in history]}
            )
        starts = [ensure_utc(row.start_time) for row in rows.values()]
        starts.extend(
            datetime.fromisoformat(fragment["start_utc"])
            for fragment in (plan["after"] if isinstance(plan["after"], list) else [plan["after"]])
        )
        review_dates = sorted({stamp.astimezone(daemon_tzinfo()).date().isoformat() for stamp in starts})
        task_ids = sorted({context["task_id"] for context in [view, *view["segments"]] if context.get("task_id")})
        task_reviews = self.db.exec(
            select(TaskReview).where(TaskReview.task_id.in_(task_ids)).order_by(TaskReview.id)
        ).all()
        day_reviews = self.db.exec(
            select(DayReview).where(DayReview.date_str.in_(review_dates)).order_by(DayReview.id)
        ).all()
        request = deepcopy(request)
        request["change"] = plan["request"]["change"]
        if request["target"]["kind"] == "selection":
            request["target"]["targets"].sort(key=lambda t: (t["kind"], t.get("work_id", t.get("segment_id"))))
        envelope = {
            "schema_version": 3,
            "resource": resource,
            "action": request["change"]["kind"],
            "request": request,
            "cutoff": cutoff,
            "plan": plan,
            "timer_state": actual["state"] if actual else None,
            "warnings": [
                "Fragment counts and local start-day buckets may change; ratings/reviews stay at original identities."
            ],
            "dependency_digest": fingerprint(
                {
                    "sources": dependencies,
                    "ratings": [r.model_dump(mode="json") for r in ratings],
                    "definitions": definitions,
                    "drafts": [d.model_dump(mode="json") for d in drafts],
                    "review_timezone": daemon_tzinfo().key,
                    "task_reviews": [r.model_dump(mode="json") for r in task_reviews],
                    "day_reviews": [r.model_dump(mode="json") for r in day_reviews],
                }
            ),
        }
        envelope["signature"] = signature(envelope, signing_key(settings.db_file.parent / "correction-signing.key"))
        return envelope

    def accept(self, state, resource, envelope, operation_id):
        allocated = envelope["plan"]["after"] if envelope["action"] == "exclude" else None
        rebuilt = self.preview(state, resource, envelope["request"], envelope["cutoff"], allocated)
        if rebuilt != envelope:
            raise ConflictError("Saved correction dependencies changed.", code="correction_preview_stale")
        view, actual, rows, inner_request = self._view(state, resource, envelope["request"])
        plan = envelope["plan"]
        if plan["action"] == "exclude":
            self.timers._install_exclusion(view, plan)
        else:
            identity = inner_request["target"]["segment_id"]
            next(s for s in view["segments"] if s["id"] == identity)["start_time"] = plan["after"]["start_utc"]
        staged, audits, changed, created = [], [], [], []
        for identity, row in rows.items():
            shadow = "saved:" + identity
            fragment_ids = (
                [f["segment_id"] for f in plan["after"] if f["source_segment_id"] == shadow]
                if plan["action"] == "exclude"
                else [shadow]
            )
            fragments = [next(s for s in view["segments"] if s["id"] == f) for f in fragment_ids]
            snapshots, results = [], []
            lineage = SessionService(self.db).correction_lineage(identity)
            root = lineage["rating_source_work_id"] if lineage else identity
            for index, fragment in enumerate(fragments):
                values = row.model_dump(mode="json")
                work_id = identity if index == 0 else fragment["id"]
                values.update(
                    id=work_id,
                    start_time=fragment["start_time"],
                    end_time=fragment["end_time"],
                    duration_seconds=int(
                        (
                            datetime.fromisoformat(fragment["end_time"])
                            - datetime.fromisoformat(fragment["start_time"])
                        ).total_seconds()
                    ),
                    revision=row.revision + 1 if index == 0 else 1,
                )
                if index and row.provenance == "timer":
                    values.update(timer_operation_id=operation_id, timer_segment_id=fragment["id"])
                snapshots.append(values)
                results.append(
                    {
                        "work_id": work_id,
                        "start_utc": fragment["start_time"],
                        "end_utc": fragment["end_time"],
                        "rating_source_work_id": root,
                        "correction_evidence": fragment["correction_evidence"],
                    }
                )
                if actual:
                    fragment["recorded_work_id"] = work_id
                    fragment["id"] = values["timer_segment_id"] or fragment["id"]
                (created if index else changed).append(work_id)
            staged.append({"before": row.model_dump(mode="json"), "rows": snapshots})
            audits.append(
                {
                    "id": str(uuid7()),
                    "operation_id": operation_id,
                    "source_identity": "saved:" + identity,
                    "source_work_id": identity,
                    "source_revision": row.revision,
                    "before_json": row.model_dump_json(),
                    "results_json": json.dumps(results),
                    "cutoff": envelope["cutoff"],
                    "action": envelope["action"],
                }
            )
        if actual:
            pointer = actual.get("manual_pause_note_segment_id")
            if pointer and any(s["id"] == pointer and s.get("recorded_work_id") in rows for s in actual["segments"]):
                view["manual_pause_note_segment_id"] = None
            audits.extend(self.timers.buffer_correction_audits(actual, view, plan, operation_id))
            view["state"] = actual["state"]
            view["revision"] = actual["revision"] + 1
            state["timers"][actual["id"]] = view
        tasks = sorted({r.task_id for r in rows.values() if r.task_id})
        plans = sorted({r.scheduled_session_id for r in rows.values() if r.scheduled_session_id})
        guard = {
            "work_ids": sorted(rows),
            "task_ids": tasks,
            "plan_ids": plans,
            "plans": [
                {"id": p.id, "revision": p.revision, "task_id": p.task_id}
                for identity in plans
                if (p := self.db.get(ScheduledSession, identity)) is not None
            ],
        }

        def geometry(row):
            return {
                "work_id": row["id"],
                "start_utc": ensure_utc(datetime.fromisoformat(row["start_time"])).isoformat(),
                "end_utc": ensure_utc(datetime.fromisoformat(row["end_time"])).isoformat(),
                "task_id": row["task_id"],
                "scheduled_session_id": row["scheduled_session_id"],
                "timezone": row["timezone"],
            }

        all_rows = [c["before"] for c in staged] + [r for c in staged for r in c["rows"]]
        dates = sorted(
            {
                ensure_utc(datetime.fromisoformat(r["start_time"]))
                .astimezone(resolve_timezone(r["timezone"]))
                .date()
                .isoformat()
                for r in all_rows
            }
        )
        buffer_before = (
            [f for f in plan["before"] if not f["source_segment_id"].startswith("saved:")]
            if plan["action"] == "exclude"
            else []
        )
        buffer_after = (
            [f for f in plan["after"] if not f["source_segment_id"].startswith("saved:")]
            if plan["action"] == "exclude"
            else []
        )
        dates = sorted(
            set(dates)
            | {
                datetime.fromisoformat(f["start_utc"]).astimezone(daemon_tzinfo()).date().isoformat()
                for f in buffer_before + buffer_after
            }
        )
        result = {
            "changed_work_ids": changed,
            "created_work_ids": created,
            "buffer_before": buffer_before,
            "buffer_after": buffer_after,
            "buffer_timezone": daemon_tzinfo().key,
            "before": [geometry(c["before"]) for c in staged],
            "after": [geometry(r) for c in staged for r in c["rows"]],
            "affected_local_dates": dates,
            "timer_revision": view["revision"] if actual else None,
        }
        return (view if actual else None), staged, audits, guard, result
