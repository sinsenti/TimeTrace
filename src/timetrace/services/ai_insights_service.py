"""Read-only AI insights and scheduling helpers.

This service is intentionally separate from the agent and draft lifecycle. It provides exact,
database-backed facts for daily briefings, conflict detection, task search/progress, schedule
validation, and weekly reviews. It never writes Task or Session rows.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import or_, text
from sqlmodel import Session, func, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.core.query_spec import (
    AnalyticsQuery,
    ChartType,
    DateRange,
    Dimension,
    FilterField,
    FilterOp,
    Measure,
    QueryFilter,
    QuerySource,
    RangePreset,
    SortKey,
)
from timetrace.core.recurrence import MAX_WINDOW_DAYS
from timetrace.core.timezones import daemon_timezone_name, daemon_tzinfo, from_local_naive, to_local_naive
from timetrace.db.models import AIDraftItem, AISettings, Task, TaskStatus
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.query_service import QueryService
from timetrace.services.session_service import SessionService

_DONE_STATUSES = ("Done", "completed", "done")
_DAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_DAY_NAME_TO_INDEX = {name: index for index, name in enumerate(_DAY_NAMES)}
_DEFAULT_PREFERENCES = {
    "scheduling_day_start": "09:00",
    "scheduling_day_end": "17:00",
    "minimum_break_minutes": 0,
    "maximum_daily_minutes": None,
    "scheduling_window_days": 14,
    "scheduling_days": [],
    "preferred_tags": [],
}


class AIInsightsService:
    """Exact read-only data access used by AI tools and optional API consumers."""

    def __init__(self, db: Session):
        self.db = db

    # -----------------------------------------------------------------------------------------
    # Settings and local search
    # -----------------------------------------------------------------------------------------

    def scheduling_preferences(self) -> dict[str, Any]:
        row = self.db.exec(select(AISettings)).first()
        if row is None:
            return dict(_DEFAULT_PREFERENCES)

        return {
            "scheduling_day_start": row.scheduling_day_start or _DEFAULT_PREFERENCES["scheduling_day_start"],
            "scheduling_day_end": row.scheduling_day_end or _DEFAULT_PREFERENCES["scheduling_day_end"],
            "minimum_break_minutes": max(0, row.minimum_break_minutes or 0),
            "maximum_daily_minutes": row.maximum_daily_minutes,
            "scheduling_window_days": max(1, row.scheduling_window_days or 14),
            "scheduling_days": self._json_list(row.scheduling_days_json),
            "preferred_tags": self._json_list(row.preferred_tags_json),
        }

    @staticmethod
    def _json_list(value: str | None) -> list[str]:
        try:
            parsed = json.loads(value or "[]")
        except TypeError, ValueError:
            return []
        if not isinstance(parsed, list):
            return []
        return [str(item).strip().lower() for item in parsed if str(item).strip()]

    def _done_statuses(self) -> tuple[str, ...]:
        names = set(_DONE_STATUSES)
        names.update(
            row.name.strip()
            for row in self.db.exec(select(TaskStatus).where(TaskStatus.is_completed)).all()
            if row.name and row.name.strip()
        )
        return tuple(sorted(names))

    @staticmethod
    def _fts_query(query: str) -> str:
        """Turns user text into quoted FTS prefix terms, never executable MATCH syntax."""
        tokens = re.findall(r"[^\W_]+", query, flags=re.UNICODE)
        parts = []
        for token in tokens:
            escaped = token.replace('"', '""')
            parts.append('"' + escaped + '"*')
        return " AND ".join(parts)

    def _ensure_task_search_index(self) -> bool:
        """Creates the local FTS5 index when tests use ``metadata.create_all`` instead of Alembic.

        Production databases receive the same objects from migration 0010. The task table stays
        authoritative; the external-content index and triggers only maintain its search terms.
        """
        try:
            bind = self.db.get_bind()
            if bind.dialect.name != "sqlite":
                return False
            existed = (
                self.db.exec(text("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_search'")).first()
                is not None
            )
            self.db.exec(
                text(
                    """
                    CREATE VIRTUAL TABLE IF NOT EXISTS task_search USING fts5(
                        title,
                        description,
                        tags,
                        category,
                        content='task',
                        content_rowid='rowid'
                    )
                    """
                )
            )
            self.db.exec(
                text(
                    """
                    CREATE TRIGGER IF NOT EXISTS task_search_ai AFTER INSERT ON task BEGIN
                        INSERT INTO task_search(rowid, title, description, tags, category)
                        VALUES (new.rowid, new.title, COALESCE(new.description, ''),
                                COALESCE(new.tags, ''), COALESCE(new.category, ''));
                    END
                    """
                )
            )
            self.db.exec(
                text(
                    """
                    CREATE TRIGGER IF NOT EXISTS task_search_ad AFTER DELETE ON task BEGIN
                        INSERT INTO task_search(task_search, rowid, title, description, tags, category)
                        VALUES ('delete', old.rowid, old.title, COALESCE(old.description, ''),
                                COALESCE(old.tags, ''), COALESCE(old.category, ''));
                    END
                    """
                )
            )
            self.db.exec(
                text(
                    """
                    CREATE TRIGGER IF NOT EXISTS task_search_au
                    AFTER UPDATE OF title, description, tags, category ON task BEGIN
                        INSERT INTO task_search(task_search, rowid, title, description, tags, category)
                        VALUES ('delete', old.rowid, old.title, COALESCE(old.description, ''),
                                COALESCE(old.tags, ''), COALESCE(old.category, ''));
                        INSERT INTO task_search(rowid, title, description, tags, category)
                        VALUES (new.rowid, new.title, COALESCE(new.description, ''),
                                COALESCE(new.tags, ''), COALESCE(new.category, ''));
                    END
                    """
                )
            )
            if not existed:
                self.db.exec(text("INSERT INTO task_search(task_search) VALUES ('rebuild')"))
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            return False

    @staticmethod
    def _task_result(task: Task, rank: float | None = None) -> dict[str, Any]:
        result = {
            "id": task.id,
            "title": task.title,
            "description": task.description or "",
            "priority": task.priority,
            "status": task.status,
            "category": task.category,
            "tags": task.tags,
            "estimated_minutes": task.estimated_minutes,
            "due_date": ensure_utc(task.due_date).isoformat() if task.due_date else None,
            "assigned_date": task.assigned_date,
            "parent_id": task.parent_id,
            "is_recurring": task.is_recurring,
        }
        if rank is not None:
            result["rank"] = rank
        return result

    def search_tasks(
        self,
        query: str,
        *,
        status: str | None = None,
        tag: str | None = None,
        priority: str | None = None,
        include_done: bool = False,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Hybrid exact/filter search over task text and structured fields."""
        query_text = (query or "").strip()
        if not query_text:
            return []
        limit = max(1, min(int(limit), 50))

        exact = self.db.get(Task, query_text)
        if exact is not None:
            done = {value.lower() for value in self._done_statuses()}
            if status and exact.status != status:
                return []
            if priority and exact.priority != priority:
                return []
            if tag and tag.lower() not in (exact.tags or "").lower():
                return []
            if not include_done and exact.status.lower() in done:
                return []
            return [self._task_result(exact, rank=0.0)]

        match_query = self._fts_query(query_text)
        if not match_query:
            return []

        if self._ensure_task_search_index():
            conditions = ["task_search MATCH :match_query"]
            params: dict[str, Any] = {"match_query": match_query, "limit": limit}
            if status:
                conditions.append("t.status = :status")
                params["status"] = status
            elif not include_done:
                done_statuses = self._done_statuses()
                names = []
                for index, done_status in enumerate(done_statuses):
                    name = f"done_status_{index}"
                    names.append(f":{name}")
                    params[name] = done_status.lower()
                conditions.append(f"LOWER(COALESCE(t.status, '')) NOT IN ({', '.join(names)})")
            if priority:
                conditions.append("t.priority = :priority")
                params["priority"] = priority
            if tag:
                conditions.append("LOWER(COALESCE(t.tags, '')) LIKE :tag")
                params["tag"] = f"%{tag.lower()}%"

            statement = text(
                "SELECT t.id, bm25(task_search) AS rank "
                "FROM task_search JOIN task t ON t.rowid = task_search.rowid "
                f"WHERE {' AND '.join(conditions)} "
                "ORDER BY bm25(task_search), t.created_at DESC LIMIT :limit"
            )
            rows = self.db.exec(statement, params=params).all()
            results = []
            for row in rows:
                task = self.db.get(Task, row[0])
                if task is not None:
                    results.append(self._task_result(task, rank=float(row[1])))
            return results

        # SQLite builds without FTS5 still get a useful, safe fallback.
        pattern = f"%{query_text}%"
        statement = select(Task).where(
            or_(
                Task.title.ilike(pattern),
                Task.description.ilike(pattern),
                Task.tags.ilike(pattern),
                Task.category.ilike(pattern),
            )
        )
        if status:
            statement = statement.where(Task.status == status)
        elif not include_done:
            done_statuses = [status.lower() for status in self._done_statuses()]
            statement = statement.where(func.lower(Task.status).notin_(done_statuses))
        if priority:
            statement = statement.where(Task.priority == priority)
        if tag:
            statement = statement.where(Task.tags.ilike(f"%{tag}%"))
        tasks = self.db.exec(statement.order_by(Task.created_at.desc()).limit(limit)).all()
        return [self._task_result(task, rank=0.0) for task in tasks]

    # -----------------------------------------------------------------------------------------
    # Session records, conflicts, slots, and validation
    # -----------------------------------------------------------------------------------------

    def _session_records(
        self,
        start: datetime,
        end: datetime,
        *,
        batch_id: str | None = None,
        include_pending: bool = True,
    ) -> list[dict[str, Any]]:
        rows = SessionService(self.db).list_overlapping_sessions(start, end, include_virtual=True)
        records: dict[str, dict[str, Any]] = {}
        for row in rows:
            record = self._session_record(row, end)
            if record is not None:
                records[str(record["id"])] = record

        if not batch_id or not include_pending:
            return list(records.values())

        items = self.db.exec(
            select(AIDraftItem)
            .where(
                AIDraftItem.batch_id == batch_id,
                AIDraftItem.entity_type == "session",
                AIDraftItem.status == "pending",
            )
            .order_by(AIDraftItem.position)
        ).all()
        for item in items:
            proposed = self._load_json(item.proposed_json)
            baseline = self._load_json(item.baseline_json)
            target_id = str(item.target_id) if item.target_id else None
            if item.op in ("update", "delete") and target_id:
                records.pop(target_id, None)
            if item.op not in ("create", "update"):
                continue

            merged = dict(baseline or {})
            merged.update(proposed)
            record = self._session_record(
                {
                    "id": f"draft:{item.id}" if item.op == "create" else target_id,
                    "task_id": merged.get("task_id"),
                    "start_time": merged.get("start_time"),
                    "end_time": merged.get("end_time"),
                    "tags": merged.get("tags") or "",
                    "notes": merged.get("notes") or "",
                    "is_virtual": False,
                },
                end,
            )
            if record is not None:
                record["is_pending"] = True
                record["draft_item_id"] = item.id
                record["pending_op"] = item.op
                records[str(record["id"])] = record

        return list(records.values())

    def _session_record(self, row: dict[str, Any], open_end: datetime) -> dict[str, Any] | None:
        start = self._parse_datetime(row.get("start_time"))
        if start is None:
            return None
        end = self._parse_datetime(row.get("end_time")) or ensure_utc(open_end)
        if end <= start:
            return None

        task_id = row.get("task_id")
        task = self.db.get(Task, task_id) if task_id else None
        title = task.title if task else (row.get("tags") or row.get("notes") or "Session")
        return {
            "id": row.get("id"),
            "title": title,
            "task_id": task_id,
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "duration_minutes": int((end - start).total_seconds() // 60),
            "tags": row.get("tags") or "",
            "notes": row.get("notes") or "",
            "is_virtual": bool(row.get("is_virtual")),
            "is_pending": bool(row.get("is_pending")),
            "draft_item_id": row.get("draft_item_id"),
            "pending_op": row.get("pending_op"),
            "_start": start,
            "_end": end,
        }

    @staticmethod
    def _load_json(value: str | None) -> dict[str, Any]:
        if not value:
            return {}
        try:
            parsed = json.loads(value)
        except TypeError, ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}

    @staticmethod
    def _parse_datetime(value: Any) -> datetime | None:
        if value is None or value == "":
            return None
        if isinstance(value, datetime):
            return ensure_utc(value)
        try:
            return ensure_utc(datetime.fromisoformat(str(value)))
        except TypeError, ValueError:
            return None

    @staticmethod
    def _public_session(record: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in record.items() if not key.startswith("_")}

    def find_conflicts(
        self,
        start: datetime,
        end: datetime,
        *,
        batch_id: str | None = None,
        include_pending: bool = True,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        start_utc = ensure_utc(start)
        end_utc = ensure_utc(end)
        if end_utc <= start_utc:
            raise ValidationError("end must be strictly after start")
        limit = max(1, min(int(limit), 200))

        records = sorted(
            self._session_records(start_utc, end_utc, batch_id=batch_id, include_pending=include_pending),
            key=lambda item: item["_start"],
        )
        conflicts: list[dict[str, Any]] = []
        for index, first in enumerate(records):
            for second in records[index + 1 :]:
                if second["_start"] >= first["_end"]:
                    break
                overlap_start = max(first["_start"], second["_start"])
                overlap_end = min(first["_end"], second["_end"])
                if overlap_end <= overlap_start:
                    continue
                conflicts.append(
                    {
                        "session_a_id": first["id"],
                        "session_b_id": second["id"],
                        "session_a_title": first["title"],
                        "session_b_title": second["title"],
                        "overlap_start": overlap_start.isoformat(),
                        "overlap_end": overlap_end.isoformat(),
                        "overlap_minutes": int((overlap_end - overlap_start).total_seconds() // 60),
                        "includes_pending": bool(first.get("is_pending") or second.get("is_pending")),
                    }
                )
                if len(conflicts) >= limit:
                    return conflicts
        return conflicts

    def find_free_slots(
        self,
        start: datetime,
        end: datetime,
        *,
        min_duration_minutes: int,
        working_hours_only: bool = True,
        batch_id: str | None = None,
        extra_busy_windows: list[tuple[datetime, datetime]] | None = None,
    ) -> list[dict[str, Any]]:
        if min_duration_minutes <= 0:
            raise ValidationError("min_duration_minutes must be positive")
        start_utc = ensure_utc(start)
        end_utc = ensure_utc(end)
        if end_utc <= start_utc:
            raise ValidationError("end must be strictly after start")

        preferences = self.scheduling_preferences()
        now = datetime.now(UTC)
        start_utc = max(start_utc, now)
        end_utc = min(end_utc, now + timedelta(days=preferences["scheduling_window_days"]))
        if end_utc <= start_utc:
            return []
        records = self._session_records(start_utc, end_utc, batch_id=batch_id)
        capacity_start, capacity_end = self._local_calendar_bounds(start_utc, end_utc)
        capacity_records = records
        if (capacity_start, capacity_end) != (start_utc, end_utc) and capacity_end - capacity_start <= timedelta(
            days=MAX_WINDOW_DAYS
        ):
            capacity_records = self._session_records(capacity_start, capacity_end, batch_id=batch_id)
        buffer = timedelta(minutes=preferences["minimum_break_minutes"])
        busy = [(record["_start"] - buffer, record["_end"] + buffer) for record in records]
        if extra_busy_windows:
            extra_records = []
            for pair in extra_busy_windows:
                extra_start = ensure_utc(pair[0])
                extra_end = ensure_utc(pair[1])
                if extra_start < extra_end:
                    busy.append((extra_start - buffer, extra_end + buffer))
                    extra_records.append({"_start": extra_start, "_end": extra_end})
            capacity_records = capacity_records + extra_records

        clipped = [(max(st, start_utc), min(et, end_utc)) for st, et in busy]
        clipped = [(st, et) for st, et in clipped if st < et]
        clipped.sort(key=lambda pair: pair[0])
        merged: list[list[datetime]] = []
        for st, et in clipped:
            if merged and st <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], et)
            else:
                merged.append([st, et])

        gaps: list[tuple[datetime, datetime]] = []
        cursor = start_utc
        for st, et in merged:
            if st > cursor:
                gaps.append((cursor, st))
            cursor = max(cursor, et)
        if cursor < end_utc:
            gaps.append((cursor, end_utc))

        preference_gaps = self._apply_schedule_preferences(
            gaps,
            capacity_records,
            preferences,
            working_hours_only=working_hours_only,
        )
        minimum = timedelta(minutes=min_duration_minutes)
        return [
            {
                "start": gap_start.isoformat(),
                "end": gap_end.isoformat(),
                "duration_minutes": int((gap_end - gap_start).total_seconds() // 60),
            }
            for gap_start, gap_end in preference_gaps
            if gap_end - gap_start >= minimum
        ][:100]

    def _apply_schedule_preferences(
        self,
        gaps: list[tuple[datetime, datetime]],
        records: list[dict[str, Any]],
        preferences: dict[str, Any],
        *,
        working_hours_only: bool,
    ) -> list[tuple[datetime, datetime]]:
        tz = daemon_tzinfo()
        allowed_days = self._allowed_day_indexes(preferences["scheduling_days"])
        day_start = self._parse_clock(preferences["scheduling_day_start"])
        day_end = self._parse_clock(preferences["scheduling_day_end"])
        occupied = self._daily_minutes(records, tz)
        maximum = preferences["maximum_daily_minutes"]
        result: list[tuple[datetime, datetime]] = []
        for gap_start, gap_end in gaps:
            local_start = to_local_naive(gap_start, tz)
            local_end = to_local_naive(gap_end, tz)
            day = local_start.date()
            last_day = to_local_naive(gap_end - timedelta(microseconds=1), tz).date()
            while day <= last_day:
                if not allowed_days or day.weekday() in allowed_days:
                    segment_local_start = max(
                        local_start if day == local_start.date() else datetime.combine(day, time.min),
                        datetime.combine(day, time.min),
                    )
                    segment_local_end = min(
                        local_end if day == local_end.date() else datetime.combine(day + timedelta(days=1), time.min),
                        datetime.combine(day + timedelta(days=1), time.min),
                    )
                    if working_hours_only:
                        segment_local_start = max(segment_local_start, datetime.combine(day, day_start))
                        segment_local_end = min(segment_local_end, datetime.combine(day, day_end))
                    if segment_local_start < segment_local_end:
                        segment_start = ensure_utc(from_local_naive(segment_local_start, tz))
                        segment_end = ensure_utc(from_local_naive(segment_local_end, tz))
                        day_key = day.isoformat()
                        if maximum is not None:
                            available = int(maximum) - occupied.get(day_key, 0)
                            if available <= 0:
                                day += timedelta(days=1)
                                continue
                            segment_end = min(segment_end, segment_start + timedelta(minutes=available))
                        if segment_start < segment_end:
                            result.append((segment_start, segment_end))
                day += timedelta(days=1)
        return result

    @staticmethod
    def _parse_clock(value: str) -> time:
        try:
            return datetime.strptime(value, "%H:%M").time()
        except (TypeError, ValueError) as exc:
            raise ValidationError("scheduling hours must use HH:MM") from exc

    @staticmethod
    def _allowed_day_indexes(days: list[str]) -> set[int]:
        unknown = [day for day in days if day not in _DAY_NAME_TO_INDEX]
        if unknown:
            raise ValidationError(f"unknown scheduling day(s): {', '.join(unknown)}")
        return {_DAY_NAME_TO_INDEX[day] for day in days}

    @classmethod
    def _daily_minutes(cls, records: list[dict[str, Any]], tz) -> dict[str, int]:
        totals: dict[str, int] = {}
        for record in records:
            for day_key, minutes in cls._interval_minutes_by_day(record["_start"], record["_end"], tz).items():
                totals[day_key] = totals.get(day_key, 0) + minutes
        return totals

    @staticmethod
    def _interval_minutes_by_day(start: datetime, end: datetime, tz) -> dict[str, int]:
        result: dict[str, int] = {}
        cursor = start
        while cursor < end:
            local_day = to_local_naive(cursor, tz).date()
            next_local = datetime.combine(local_day + timedelta(days=1), time.min)
            next_utc = ensure_utc(from_local_naive(next_local, tz))
            segment_end = min(end, next_utc)
            minutes = int((segment_end - cursor).total_seconds() // 60)
            if minutes > 0:
                key = local_day.isoformat()
                result[key] = result.get(key, 0) + minutes
            if segment_end <= cursor:
                break
            cursor = segment_end
        return result

    def validate_schedule(
        self,
        proposed_sessions: list[dict[str, Any]],
        *,
        batch_id: str | None = None,
    ) -> dict[str, Any]:
        """Validates hypothetical placements without persisting them."""
        preferences = self.scheduling_preferences()
        tz = daemon_tzinfo()
        errors: list[str] = []
        warnings: list[str] = []
        candidates: list[dict[str, Any]] = []
        target_ids: set[str] = set()

        if not proposed_sessions:
            return {
                "valid": False,
                "errors": ["proposed_sessions must not be empty"],
                "warnings": [],
                "candidate_count": 0,
                "daily_minutes": {},
                "preferences": preferences,
            }

        for index, payload in enumerate(proposed_sessions):
            if not isinstance(payload, dict):
                errors.append(f"proposal {index + 1}: must be an object")
                continue
            start = self._parse_datetime(payload.get("start_time"))
            end = self._parse_datetime(payload.get("end_time"))
            if start is None or end is None:
                errors.append(f"proposal {index + 1}: start_time and end_time are required ISO datetimes")
                continue
            if end <= start:
                errors.append(f"proposal {index + 1}: end_time must be after start_time")
                continue
            session_id = payload.get("session_id") or payload.get("id")
            if session_id and not str(session_id).startswith("candidate:"):
                target_ids.add(str(session_id))
            task_id = payload.get("task_id")
            if task_id and self.db.get(Task, task_id) is None:
                errors.append(f"proposal {index + 1}: task_id '{task_id}' does not exist")
            candidates.append(
                {
                    "id": f"candidate:{index}",
                    "title": payload.get("title") or payload.get("task_title") or "Proposed session",
                    "task_id": task_id,
                    "start_time": start.isoformat(),
                    "end_time": end.isoformat(),
                    "duration_minutes": int((end - start).total_seconds() // 60),
                    "is_candidate": True,
                    "is_pending": False,
                    "_start": start,
                    "_end": end,
                }
            )

        if not candidates:
            return {
                "valid": False,
                "errors": errors or ["No valid session proposals were supplied"],
                "warnings": warnings,
                "candidate_count": 0,
                "daily_minutes": {},
                "preferences": preferences,
            }

        range_start = min(record["_start"] for record in candidates)
        range_end = max(record["_end"] for record in candidates)
        if range_end - range_start > timedelta(days=MAX_WINDOW_DAYS):
            errors.append(f"proposals must fit within a {MAX_WINDOW_DAYS}-day validation range")
            existing = []
            capacity_records = []
        else:
            existing = [
                record
                for record in self._session_records(range_start, range_end, batch_id=batch_id)
                if str(record["id"]) not in target_ids
            ]
            capacity_start, capacity_end = self._local_calendar_bounds(range_start, range_end)
            capacity_source = (
                self._session_records(capacity_start, capacity_end, batch_id=batch_id)
                if capacity_end - capacity_start <= timedelta(days=MAX_WINDOW_DAYS)
                else existing
            )
            capacity_records = [record for record in capacity_source if str(record["id"]) not in target_ids]
        all_records = existing + candidates
        buffer = timedelta(minutes=preferences["minimum_break_minutes"])

        for index, first in enumerate(all_records):
            for second in all_records[index + 1 :]:
                actual_start = max(first["_start"], second["_start"])
                actual_end = min(first["_end"], second["_end"])
                expanded_start = max(first["_start"] - buffer, second["_start"] - buffer)
                expanded_end = min(first["_end"] + buffer, second["_end"] + buffer)
                involves_candidate = bool(first.get("is_candidate") or second.get("is_candidate"))
                if actual_end > actual_start:
                    message = (
                        f"{first['title']} overlaps {second['title']} "
                        f"({actual_start.isoformat()} to {actual_end.isoformat()})"
                    )
                    (errors if involves_candidate else warnings).append(message)
                elif buffer and expanded_end > expanded_start:
                    gap = min(
                        abs((second["_start"] - first["_end"]).total_seconds()),
                        abs((first["_start"] - second["_end"]).total_seconds()),
                    )
                    if gap < buffer.total_seconds() and involves_candidate:
                        errors.append(
                            f"{first['title']} and {second['title']} have less than "
                            f"{preferences['minimum_break_minutes']} minutes between them"
                        )

        now = datetime.now(UTC)
        allowed_until = now + timedelta(days=preferences["scheduling_window_days"])
        for index, candidate in enumerate(candidates):
            local_start = to_local_naive(candidate["_start"], tz)
            local_end = to_local_naive(candidate["_end"], tz)
            if candidate["_start"] > allowed_until:
                errors.append(f"proposal {index + 1}: starts outside the scheduling window")
            if local_start.date() != local_end.date():
                errors.append(f"proposal {index + 1}: crosses a local calendar day")
                continue
            allowed_days = self._allowed_day_indexes(preferences["scheduling_days"])
            if allowed_days and local_start.weekday() not in allowed_days:
                errors.append(f"proposal {index + 1}: falls on a disabled scheduling day")
            day_start = self._parse_clock(preferences["scheduling_day_start"])
            day_end = self._parse_clock(preferences["scheduling_day_end"])
            if local_start.time() < day_start or local_end.time() > day_end:
                errors.append(
                    f"proposal {index + 1}: outside preferred hours "
                    f"{preferences['scheduling_day_start']}-{preferences['scheduling_day_end']}"
                )

        daily_minutes = self._daily_minutes(capacity_records + candidates, tz)
        maximum = preferences["maximum_daily_minutes"]
        if maximum is not None:
            for day_key, minutes in sorted(daily_minutes.items()):
                if minutes > maximum:
                    errors.append(f"{day_key}: {minutes} planned minutes exceeds daily limit {maximum}")

        return {
            "valid": not errors,
            "errors": errors,
            "warnings": warnings,
            "candidate_count": len(candidates),
            "total_candidate_minutes": sum(item["duration_minutes"] for item in candidates),
            "daily_minutes": dict(sorted(daily_minutes.items())),
            "preferences": preferences,
        }

    # -----------------------------------------------------------------------------------------
    # Progress and summaries
    # -----------------------------------------------------------------------------------------

    def get_task_progress(self, task_id: str) -> dict[str, Any]:
        task = self.db.get(Task, task_id)
        if task is None:
            raise EntityNotFoundError("Task", task_id)

        now_naive = datetime.now(UTC).replace(tzinfo=None)
        logged_seconds = self.db.exec(
            select(func.coalesce(func.sum(SessionModel.duration_seconds), 0)).where(
                SessionModel.task_id == task_id,
                SessionModel.end_time.is_not(None),
                SessionModel.end_time <= now_naive,
            )
        ).one()
        scheduled_seconds = self.db.exec(
            select(func.coalesce(func.sum(SessionModel.duration_seconds), 0)).where(
                SessionModel.task_id == task_id,
                SessionModel.start_time > now_naive,
            )
        ).one()
        session_count = self.db.exec(
            select(func.count()).select_from(SessionModel).where(SessionModel.task_id == task_id)
        ).one()

        logged_seconds = int(logged_seconds or 0)
        scheduled_seconds = int(scheduled_seconds or 0)
        is_unbounded = not (task.estimated_minutes or 0) or task.is_recurring
        estimated_seconds = (task.estimated_minutes or 0) * 60
        progress_pct = round((logged_seconds / estimated_seconds) * 100, 1) if estimated_seconds else None
        remaining_seconds = estimated_seconds - logged_seconds
        unscheduled_seconds = estimated_seconds - logged_seconds - scheduled_seconds

        return {
            "task_id": task.id,
            "title": task.title,
            "status": task.status,
            "estimated_hours": round((task.estimated_minutes or 0) / 60, 2),
            "logged_hours": round(logged_seconds / 3600, 2),
            "scheduled_hours": round(scheduled_seconds / 3600, 2),
            "remaining_hours": None if is_unbounded else round(remaining_seconds / 3600, 2),
            "unscheduled_hours": None if is_unbounded else round(unscheduled_seconds / 3600, 2),
            "progress_pct": progress_pct,
            "is_unbounded": is_unbounded,
            "session_count": int(session_count or 0),
            "is_recurring": task.is_recurring,
        }

    def get_daily_briefing(self, date_value: str | None = None, *, batch_id: str | None = None) -> dict[str, Any]:
        local_date, start_utc, end_utc = self._local_day_bounds(date_value)
        sessions = self._session_records(start_utc, end_utc, batch_id=batch_id)
        sessions.sort(key=lambda item: item["_start"])
        tz = daemon_tzinfo()

        done_statuses = [status.lower() for status in self._done_statuses()]
        tasks = self.db.exec(select(Task).where(func.lower(Task.status).notin_(done_statuses))).all()
        overdue: list[dict[str, Any]] = []
        due_today: list[dict[str, Any]] = []
        for task in tasks:
            if task.due_date is None:
                continue
            due_local_date = to_local_naive(ensure_utc(task.due_date), tz).date()
            result = self._task_result(task)
            if due_local_date < local_date:
                overdue.append(result)
            elif due_local_date == local_date:
                due_today.append(result)
        overdue.sort(key=lambda item: (item["due_date"] or "", item["title"].lower()))
        due_today.sort(key=lambda item: (item["due_date"] or "", item["title"].lower()))

        day_key = local_date.isoformat()
        return {
            "date": day_key,
            "timezone": daemon_timezone_name(),
            "sessions": [self._public_session(item) for item in sessions],
            "overdue_tasks": overdue,
            "due_today_tasks": due_today,
            "logged": self._run_session_stat(day_key, day_key, Measure.SUM_DURATION, relative="past"),
            "scheduled": self._run_session_stat(day_key, day_key, Measure.SUM_DURATION, relative="future"),
            "free_slots": self.find_free_slots(
                start_utc,
                end_utc,
                min_duration_minutes=15,
                working_hours_only=True,
                batch_id=batch_id,
            ),
            "conflicts": self.find_conflicts(start_utc, end_utc, batch_id=batch_id),
            "preferences": self.scheduling_preferences(),
        }

    def get_reflection_context(
        self,
        *,
        start_date: str,
        end_date: str,
        include_timer: bool = False,
        batch_id: str | None = None,
    ) -> dict[str, Any]:
        """Build compact, deterministic cross-domain facts for one local-date range.

        The gateway applies privacy-scope checks before calling this method. This service owns
        only the facts and never writes domain rows. The time statistics describe persisted
        sessions; pending draft proposals are not counted as performed or scheduled work.
        """
        try:
            start_local = date.fromisoformat(start_date)
            end_local = date.fromisoformat(end_date)
        except (TypeError, ValueError) as exc:
            raise ValidationError("start_date and end_date must use YYYY-MM-DD") from exc
        if start_local.isoformat() != start_date or end_local.isoformat() != end_date:
            raise ValidationError("start_date and end_date must use YYYY-MM-DD")
        if end_local < start_local:
            raise ValidationError("end_date must not be before start_date")
        period_days = (end_local - start_local).days + 1
        if period_days > 366:
            raise ValidationError("reflection date range cannot exceed 366 days")

        start_value = start_local.isoformat()
        end_value = end_local.isoformat()
        logged_by_day = self._run_session_stat(
            start_value, end_value, Measure.SUM_DURATION, group_by=[Dimension.DAY], relative="past", fill_gaps=True
        )
        scheduled_by_day = self._run_session_stat(
            start_value, end_value, Measure.SUM_DURATION, group_by=[Dimension.DAY], relative="future", fill_gaps=True
        )
        logged_by_task = self._run_session_stat(
            start_value, end_value, Measure.SUM_DURATION, group_by=[Dimension.TASK], relative="past"
        )
        logged_by_tag = self._run_session_stat(
            start_value, end_value, Measure.SUM_DURATION, group_by=[Dimension.TAG], relative="past"
        )

        from timetrace.services.habit_service import HabitService
        from timetrace.services.rating_service import RatingService
        from timetrace.services.revision_service import RevisionService
        from timetrace.services.task_service import TaskService

        habits = HabitService(self.db).list_habits_for_ai(
            start_date=start_value, end_date=end_value, include_logs=True, limit=100
        )
        day_reviews = RevisionService(self.db).list_day_reviews(
            start_date=start_value, end_date=end_value, include_skipped=True, limit=200
        )
        task_reviews = TaskService(self.db).list_task_reviews_for_ai(
            start_date=start_value, end_date=end_value, limit=100
        )
        ratings = RatingService(self.db).list_entries_for_ai(
            start_date=start_value,
            end_date=end_value,
            include_dismissed=True,
            limit=200,
        )

        review_rows = day_reviews["reviews"]
        skipped_review_rows = [row for row in review_rows if row["review_skipped"]]
        completed_review_rows = [row for row in review_rows if not row["review_skipped"]]
        rating_values = [row["rating"] for row in completed_review_rows if row.get("rating") is not None]
        day_rating_summary = {
            "count": len(completed_review_rows),
            "average": round(sum(rating_values) / len(rating_values), 2) if rating_values else None,
            "trend": (
                round(
                    sum(row["rating"] for row in completed_review_rows[-3:] if row.get("rating") is not None)
                    / max(1, len([row for row in completed_review_rows[-3:] if row.get("rating") is not None]))
                    - sum(row["rating"] for row in completed_review_rows[:3] if row.get("rating") is not None)
                    / max(1, len([row for row in completed_review_rows[:3] if row.get("rating") is not None])),
                    2,
                )
                if len(completed_review_rows) >= 2
                else None
            ),
        }
        review_dates = {row["date"] for row in completed_review_rows}
        missing_review_dates = [
            (start_local + timedelta(days=offset)).isoformat()
            for offset in range(period_days)
            if (start_local + timedelta(days=offset)).isoformat() not in review_dates
        ]
        custom_rating_values: dict[str, list[float]] = {}
        for entry in ratings["entries"]:
            if entry.get("dismissed") or entry.get("score") is None:
                continue
            definition = entry.get("definition") or {}
            key = definition.get("name") or entry.get("target_type") or "rating"
            custom_rating_values.setdefault(str(key), []).append(float(entry["score"]))
        custom_rating_averages = {
            key: round(sum(values) / len(values), 2) for key, values in custom_rating_values.items() if values
        }
        day_rating_entries = [row for row in ratings["entries"] if row.get("target_type") == "day"]
        rated_days = {row.get("target_id") for row in day_rating_entries if row.get("target_id")}
        missing_rating_dates = [
            (start_local + timedelta(days=offset)).isoformat()
            for offset in range(period_days)
            if (start_local + timedelta(days=offset)).isoformat() not in rated_days
        ]

        logged_total = self._run_session_stat(start_value, end_value, Measure.SUM_DURATION, relative="past")
        scheduled_total = self._run_session_stat(start_value, end_value, Measure.SUM_DURATION, relative="future")

        day_review_output_truncated = len(review_rows) > 50 or len(skipped_review_rows) > 50
        rating_output_truncated = len(ratings["entries"]) > 100
        warnings: list[str] = []
        if logged_total.get("total") is None:
            warnings.append("No logged session data was recorded in this range.")
        if scheduled_total.get("total") is None:
            warnings.append("No future scheduled session data was recorded in this range.")
        truncated = (
            day_review_output_truncated
            or rating_output_truncated
            or any(
                section.get("truncated", False)
                for section in (habits, day_reviews, task_reviews, ratings)
                if isinstance(section, dict)
            )
        )
        if missing_review_dates:
            warnings.append(f"No completed day review was recorded for {len(missing_review_dates)} day(s).")
        if missing_rating_dates:
            warnings.append(f"No day custom rating was recorded for {len(missing_rating_dates)} day(s).")
        if day_review_output_truncated or rating_output_truncated:
            warnings.append("Some reflection lists were shortened; use specialized tools for detail.")
        if truncated and not (day_review_output_truncated or rating_output_truncated):
            warnings.append("Some context lists were truncated; use specialized tools for detail.")

        timer = None
        if include_timer:
            from timetrace.services.timer_service import TimerService

            timer = TimerService(self.db).get_status()

        return {
            "range": {
                "start_date": start_value,
                "end_date": end_value,
                "timezone": daemon_timezone_name(),
            },
            "time": {
                "logged_total": logged_total,
                "scheduled_total": scheduled_total,
                "logged_by_day": logged_by_day,
                "scheduled_by_day": scheduled_by_day,
                "logged_by_task": logged_by_task,
                "logged_by_tag": logged_by_tag,
            },
            "habits": habits,
            "day_reviews": {
                "reviews": completed_review_rows[:50],
                "skipped": skipped_review_rows[:50],
                "summary": day_rating_summary,
                "missing_dates": missing_review_dates,
                "truncated": day_review_output_truncated,
            },
            "task_reviews": {
                "count": len(task_reviews["reviews"]),
                "reviews": task_reviews["reviews"][:50],
                "truncated": task_reviews.get("truncated", False) or len(task_reviews["reviews"]) > 50,
            },
            "ratings": {
                "entries": ratings["entries"][:100],
                "average_by_definition": custom_rating_averages,
                "truncated": ratings.get("truncated", False) or rating_output_truncated,
                "missing_day_rating_dates": missing_rating_dates,
            },
            "timer": timer,
            "warnings": warnings,
            "truncated": truncated,
        }

    def get_current_weekly_review(self, first_day_of_week: int = 1) -> dict[str, Any]:
        """Return the review for the current local calendar week.

        Week boundaries are resolved by the daemon, rather than by a browser clock.  The
        ``first_day_of_week`` value follows FullCalendar's convention (0=Sunday through
        6=Saturday) and is used only to choose the local boundary; ``get_weekly_review`` keeps
        ownership of the report shape and all of its statistics.
        """
        if not isinstance(first_day_of_week, int) or not 0 <= first_day_of_week <= 6:
            raise ValidationError("first_day_of_week must be between 0 and 6")

        tz = daemon_tzinfo()
        local_today = to_local_naive(datetime.now(UTC), tz).date()
        local_weekday = (local_today.weekday() + 1) % 7
        local_start_date = local_today - timedelta(days=(local_weekday - first_day_of_week) % 7)
        local_start = datetime.combine(local_start_date, time.min)
        local_end = datetime.combine(local_start_date + timedelta(days=7), time.min)
        return self.get_weekly_review(
            from_local_naive(local_start, tz),
            from_local_naive(local_end, tz),
        )

    def get_weekly_review(self, start: datetime, end: datetime) -> dict[str, Any]:
        start_utc = ensure_utc(start)
        end_utc = ensure_utc(end)
        if end_utc <= start_utc:
            raise ValidationError("end must be strictly after start")
        if end_utc - start_utc > timedelta(days=93):
            raise ValidationError("weekly review range cannot exceed 93 days")

        tz = daemon_tzinfo()
        local_start = to_local_naive(start_utc, tz).date().isoformat()
        local_end = to_local_naive(end_utc - timedelta(microseconds=1), tz).date().isoformat()
        return {
            "start_date": local_start,
            "end_date": local_end,
            "timezone": daemon_timezone_name(),
            "logged_total": self._run_session_stat(
                local_start,
                local_end,
                Measure.SUM_DURATION,
                relative="past",
            ),
            "scheduled_total": self._run_session_stat(
                local_start,
                local_end,
                Measure.SUM_DURATION,
                relative="future",
            ),
            "average_session_length": self._run_session_stat(
                local_start,
                local_end,
                Measure.AVG_SESSION_LENGTH,
                relative="past",
            ),
            "logged_by_day": self._run_session_stat(
                local_start,
                local_end,
                Measure.SUM_DURATION,
                group_by=[Dimension.DAY],
                relative="past",
                fill_gaps=True,
            ),
            "logged_by_tag": self._run_session_stat(
                local_start,
                local_end,
                Measure.SUM_DURATION,
                group_by=[Dimension.TAG],
                relative="past",
            ),
            "logged_by_task": self._run_session_stat(
                local_start,
                local_end,
                Measure.SUM_DURATION,
                group_by=[Dimension.TASK],
                relative="past",
            ),
            "scheduled_by_day": self._run_session_stat(
                local_start,
                local_end,
                Measure.SUM_DURATION,
                group_by=[Dimension.DAY],
                relative="future",
                fill_gaps=True,
            ),
            "session_count": self._run_session_stat(
                local_start,
                local_end,
                Measure.SESSION_COUNT,
                relative="past",
            ),
            "tasks_created_by_status": self._run_task_status_stat(local_start, local_end),
            "preferences": self.scheduling_preferences(),
        }

    def _run_session_stat(
        self,
        start_date: str,
        end_date: str,
        measure: Measure,
        *,
        group_by: list[Dimension] | None = None,
        relative: str | None = None,
        fill_gaps: bool = False,
    ) -> dict[str, Any]:
        filters = []
        if relative:
            filters.append(
                QueryFilter(
                    field=FilterField.SESSION_TIME_RELATIVE,
                    op=FilterOp.EQ,
                    values=[relative],
                )
            )
        query = AnalyticsQuery(
            source=QuerySource.SESSIONS,
            measure=measure,
            group_by=group_by or [],
            filters=filters,
            date_range=DateRange(
                preset=RangePreset.CUSTOM,
                start_date=start_date,
                end_date=end_date,
            ),
            chart=ChartType.TABLE,
            sort=SortKey.DIMENSION_ASC if group_by else SortKey.VALUE_DESC,
            limit=100,
            fill_gaps=fill_gaps,
        )
        response = QueryService(self.db).run(
            query,
            QueryContextRequest(timezone=daemon_timezone_name(), first_day_of_week=1),
        )
        return response.model_dump(mode="json")

    def _run_task_status_stat(self, start_date: str, end_date: str) -> dict[str, Any]:
        query = AnalyticsQuery(
            source=QuerySource.TASKS,
            measure=Measure.TASK_COUNT,
            group_by=[Dimension.STATUS],
            date_range=DateRange(
                preset=RangePreset.CUSTOM,
                start_date=start_date,
                end_date=end_date,
            ),
            chart=ChartType.TABLE,
            sort=SortKey.VALUE_DESC,
            limit=100,
        )
        return (
            QueryService(self.db)
            .run(
                query,
                QueryContextRequest(timezone=daemon_timezone_name(), first_day_of_week=1),
            )
            .model_dump(mode="json")
        )

    def _local_calendar_bounds(self, start: datetime, end: datetime) -> tuple[datetime, datetime]:
        tz = daemon_tzinfo()
        local_start = to_local_naive(start, tz).date()
        local_end = to_local_naive(end - timedelta(microseconds=1), tz).date()
        first_local = datetime.combine(local_start, time.min)
        last_local = datetime.combine(local_end + timedelta(days=1), time.min)
        return (
            ensure_utc(from_local_naive(first_local, tz)),
            ensure_utc(from_local_naive(last_local, tz)),
        )

    def _local_day_bounds(self, date_value: str | None) -> tuple[date, datetime, datetime]:
        tz = daemon_tzinfo()
        if date_value in (None, "", "today"):
            local_date = to_local_naive(datetime.now(UTC), tz).date()
        else:
            try:
                local_date = date.fromisoformat(date_value)
            except (TypeError, ValueError) as exc:
                raise ValidationError("date must be YYYY-MM-DD") from exc
        local_start = datetime.combine(local_date, time.min)
        local_end = local_start + timedelta(days=1)
        return (
            local_date,
            ensure_utc(from_local_naive(local_start, tz)),
            ensure_utc(from_local_naive(local_end, tz)),
        )


__all__ = ["AIInsightsService"]
