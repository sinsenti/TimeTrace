"""Executes structured `AnalyticsQuery` objects: resolves request context (timezone,
first-day-of-week, date range), compiles to SQL via `core/query_compiler.py`, runs it, and
post-processes the raw rows into labelled, gap-filled, sorted, truncated API rows.

This is the only place the `core/query_compiler` output touches the database. Business logic
that belongs to "what does a widget mean", not "how do we turn one into SQL", lives here:
labels, gap-filling, sort tie-breaks (weekday reordering), truncation, and the timezone /
localtime-capability resolution described in the plan (section 6.8).
"""

import os
import time as time_module
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlmodel import Session, select, text

from timetrace.core.exceptions import ValidationError
from timetrace.core.query_compiler import CompiledQuery, QueryContext, compile_query
from timetrace.core.query_registry import SOURCES
from timetrace.core.query_spec import AnalyticsQuery, Dimension, RangePreset
from timetrace.db.models import Habit, Task
from timetrace.interfaces.api.schemas import (
    AnalyticsQueryBatchRequest,
    AnalyticsQueryBatchResponse,
    AnalyticsQueryResponse,
    CapabilityDimension,
    CapabilityFilterField,
    CapabilityMeasure,
    ColumnSpec,
    QueryCapabilitiesResponse,
    QueryContextRequest,
    QueryMeta,
    QueryRow,
    SourceCapabilities,
)

_WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

# Measures where "no data in this bucket" is naturally zero (a count/sum with nothing to count
# is 0). Rate/average measures are left as None on gap-fill instead -- "0% complete" and "no
# tasks were due" are different facts and conflating them would mislead a filled-in chart.
_ZERO_FILLABLE_MEASURES = {"sum_duration", "session_count", "task_count", "sum_estimated_duration"}

# Cached at module scope: neither the daemon's own timezone nor its SQLite build's 'localtime'
# support can change while the process is running.
_daemon_tz_name_cache: str | None = None
_localtime_supported_cache: bool | None = None


def _daemon_timezone_name() -> str:
    global _daemon_tz_name_cache
    if _daemon_tz_name_cache is not None:
        return _daemon_tz_name_cache

    tz = os.environ.get("TZ")
    if not tz:
        try:
            resolved = Path("/etc/localtime").resolve()
            parts = resolved.parts
            if "zoneinfo" in parts:
                idx = parts.index("zoneinfo")
                tz = "/".join(parts[idx + 1 :])
        except OSError:
            tz = None

    _daemon_tz_name_cache = tz or "UTC"
    return _daemon_tz_name_cache


def _check_localtime_support(db: Session) -> bool:
    global _localtime_supported_cache
    if _localtime_supported_cache is not None:
        return _localtime_supported_cache
    try:
        row = db.exec(text("SELECT datetime('2026-01-01 00:00:00', 'localtime')")).first()
        _localtime_supported_cache = row is not None and row[0] is not None
    except Exception:
        _localtime_supported_cache = False
    return _localtime_supported_cache


def _resolve_timezone(requested: str | None, warnings: list[str]) -> tuple[ZoneInfo, str]:
    """SQLite's `localtime` modifier follows the *server process's* zone (via the OS tzdata /
    `TZ` env var), not an arbitrary client-supplied one -- there is no per-request way to make
    SQLite compute "local" for a zone other than the process's own without mutating global
    process state, which isn't safe across concurrent requests. So: use the request's timezone
    only when it already matches the daemon's; otherwise fall back to the daemon's zone and
    say so.
    """
    daemon_tz_name = _daemon_timezone_name()

    if requested and requested == daemon_tz_name:
        try:
            return ZoneInfo(requested), requested
        except Exception:
            pass
    elif requested:
        warnings.append(
            f"Requested timezone '{requested}' does not match the daemon's timezone "
            f"'{daemon_tz_name}'; results use '{daemon_tz_name}' (SQLite's 'localtime' modifier "
            "follows the server process's zone)."
        )

    try:
        return ZoneInfo(daemon_tz_name), daemon_tz_name
    except Exception:
        warnings.append(f"Could not resolve daemon timezone '{daemon_tz_name}'; falling back to UTC.")
        return ZoneInfo("UTC"), "UTC"


@dataclass
class _ResolvedRange:
    start_date: date | None
    end_date: date | None  # inclusive
    start_utc: datetime | None
    end_utc: datetime | None  # exclusive


def _week_start(d: date, first_day_of_week: int) -> date:
    sqlite_weekday = (d.weekday() + 1) % 7  # 0=Sun..6=Sat, matches SQLite's %w / 'weekday N'
    return d - timedelta(days=(sqlite_weekday - first_day_of_week) % 7)


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _add_month(d: date) -> date:
    if d.month == 12:
        return d.replace(year=d.year + 1, month=1)
    return d.replace(month=d.month + 1)


def _resolve_date_range(query: AnalyticsQuery, tz: ZoneInfo, first_day_of_week: int) -> _ResolvedRange:
    today_local = datetime.now(tz).date()
    dr = query.date_range
    preset = dr.preset

    if preset == RangePreset.ALL_TIME:
        start_date, end_date = None, None
    elif preset == RangePreset.TODAY:
        start_date = end_date = today_local
    elif preset == RangePreset.YESTERDAY:
        start_date = end_date = today_local - timedelta(days=1)
    elif preset == RangePreset.LAST_7_DAYS:
        start_date, end_date = today_local - timedelta(days=6), today_local
    elif preset == RangePreset.LAST_14_DAYS:
        start_date, end_date = today_local - timedelta(days=13), today_local
    elif preset == RangePreset.LAST_30_DAYS:
        start_date, end_date = today_local - timedelta(days=29), today_local
    elif preset == RangePreset.THIS_WEEK:
        start_date = _week_start(today_local, first_day_of_week)
        end_date = start_date + timedelta(days=6)
    elif preset == RangePreset.THIS_MONTH:
        start_date = _month_start(today_local)
        end_date = _add_month(start_date) - timedelta(days=1)
    elif preset == RangePreset.CUSTOM:
        if not dr.start_date or not dr.end_date:
            raise ValidationError("date_range.preset=custom requires both start_date and end_date")
        start_date = date.fromisoformat(dr.start_date)
        end_date = date.fromisoformat(dr.end_date)
        if end_date < start_date:
            raise ValidationError("date_range.end_date must not be before start_date")
    else:
        raise ValidationError(f"Unknown range preset: {preset}")

    if start_date is None:
        return _ResolvedRange(None, None, None, None)

    start_utc = datetime.combine(start_date, time.min, tz).astimezone(UTC).replace(tzinfo=None)
    end_utc = datetime.combine(end_date + timedelta(days=1), time.min, tz).astimezone(UTC).replace(tzinfo=None)
    return _ResolvedRange(start_date, end_date, start_utc, end_utc)


def _label_for(dim: Dimension, key: str) -> str:
    try:
        if dim == Dimension.DAY:
            return date.fromisoformat(key).strftime("%b %-d")
        if dim == Dimension.WEEK:
            start = date.fromisoformat(key)
            end = start + timedelta(days=6)
            return f"{start.strftime('%b %-d')} - {end.strftime('%b %-d')}"
        if dim == Dimension.MONTH:
            return date.fromisoformat(key).strftime("%b %Y")
        if dim == Dimension.HOUR_OF_DAY:
            return f"{int(key):02d}:00"
        if dim == Dimension.WEEKDAY:
            return _WEEKDAY_LABELS[int(key)]
    except (ValueError, IndexError):
        return key
    return key


def _gap_fill_day_keys(rr: _ResolvedRange) -> list[str]:
    keys = []
    d = rr.start_date
    while d <= rr.end_date:
        keys.append(d.isoformat())
        d += timedelta(days=1)
    return keys


def _gap_fill_week_keys(rr: _ResolvedRange, first_day_of_week: int) -> list[str]:
    keys = []
    d = _week_start(rr.start_date, first_day_of_week)
    last = _week_start(rr.end_date, first_day_of_week)
    while d <= last:
        keys.append(d.isoformat())
        d += timedelta(days=7)
    return keys


def _gap_fill_month_keys(rr: _ResolvedRange) -> list[str]:
    keys = []
    d = _month_start(rr.start_date)
    last = _month_start(rr.end_date)
    while d <= last:
        keys.append(d.isoformat())
        d = _add_month(d)
    return keys


class QueryService:
    def __init__(self, db: Session):
        self.db = db

    def capabilities(self) -> QueryCapabilitiesResponse:
        sources = []
        for source_spec in SOURCES.values():
            sources.append(
                SourceCapabilities(
                    source=source_spec.source,
                    measures=[
                        CapabilityMeasure(value=m.measure, label=m.label, unit=m.unit)
                        for m in source_spec.measures.values()
                    ],
                    dimensions=[
                        CapabilityDimension(value=d.dimension, label=d.label) for d in source_spec.dimensions.values()
                    ],
                    filter_fields=[
                        CapabilityFilterField(value=f.field.value, label=f.label)
                        for f in source_spec.filter_fields.values()
                    ],
                )
            )
        return QueryCapabilitiesResponse(sources=sources)

    def run(self, query: AnalyticsQuery, context: QueryContextRequest) -> AnalyticsQueryResponse:
        start = time_module.monotonic()
        warnings: list[str] = []

        tz, tz_name = _resolve_timezone(context.timezone, warnings)
        first_day_of_week = context.first_day_of_week if context.first_day_of_week is not None else 1

        if not _check_localtime_support(self.db):
            warnings.append(
                "This SQLite build does not support the 'localtime' modifier; time-bucketed "
                "results may be reported in UTC rather than local time."
            )

        # hour_of_day/weekday have a fixed, always-enumerable domain (24 hours, 7 weekdays) and
        # don't need a bounded range; day/week/month gap-filling has to fill in every bucket
        # *between* two concrete dates, which "all_time" doesn't provide.
        fills_calendar_dim = query.group_by and query.group_by[0] in (Dimension.DAY, Dimension.WEEK, Dimension.MONTH)
        if query.fill_gaps and fills_calendar_dim and query.date_range.preset == RangePreset.ALL_TIME:
            raise ValidationError("fill_gaps on day/week/month requires a bounded date_range (not all_time)")

        resolved_range = _resolve_date_range(query, tz, first_day_of_week)

        ctx = QueryContext(
            timezone=tz_name,
            first_day_of_week=first_day_of_week,
            range_start_utc=resolved_range.start_utc,
            range_end_utc=resolved_range.end_utc,
            range_start_local=resolved_range.start_date.isoformat() if resolved_range.start_date else None,
            range_end_local=resolved_range.end_date.isoformat() if resolved_range.end_date else None,
        )

        compiled = compile_query(query, ctx)
        raw_rows = self.db.exec(text(compiled.sql), params=compiled.params).all()

        truncated = False
        if compiled.has_rows_limit and len(raw_rows) > query.limit:
            raw_rows = raw_rows[: query.limit]
            truncated = True

        rows = self._build_rows(query, compiled, raw_rows, resolved_range, first_day_of_week)

        if query.fill_gaps:
            rows = self._fill_gaps(query, rows, resolved_range, first_day_of_week)
        elif query.group_by and query.group_by[0] == Dimension.WEEKDAY and query.sort.value.startswith("dimension"):
            rows = self._reorder_weekday(rows, first_day_of_week, query.sort.value.endswith("desc"))

        columns = self._build_columns(query)
        total = rows[0].value if not query.group_by and rows else None

        elapsed_ms = int((time_module.monotonic() - start) * 1000)

        meta = QueryMeta(
            timezone=tz_name,
            first_day_of_week=first_day_of_week,
            range_start_utc=resolved_range.start_utc,
            range_end_utc=resolved_range.end_utc,
            tag_attribution=query.tag_attribution,
            totals_overlap=compiled.totals_overlap,
            truncated=truncated,
            elapsed_ms=elapsed_ms,
            warnings=warnings,
        )

        return AnalyticsQueryResponse(columns=columns, rows=rows, total=total, row_count=len(rows), meta=meta)

    def run_batch(self, batch: AnalyticsQueryBatchRequest) -> AnalyticsQueryBatchResponse:
        results: dict[str, AnalyticsQueryResponse] = {}
        errors: dict[str, str] = {}
        for key, query in batch.queries.items():
            try:
                results[key] = self.run(query, batch)
            except ValidationError as e:
                errors[key] = str(e)
            except Exception as e:  # noqa: BLE001 -- one bad widget must not fail the whole batch
                errors[key] = f"Unexpected error: {e}"
        return AnalyticsQueryBatchResponse(results=results, errors=errors)

    def _build_columns(self, query: AnalyticsQuery) -> list[ColumnSpec]:
        source_spec = SOURCES[query.source]
        columns = []
        for i, dim in enumerate(query.group_by):
            dim_spec = source_spec.dimensions.get(dim)
            columns.append(
                ColumnSpec(
                    key=f"k{i}", label=dim_spec.label if dim_spec else dim.value, kind="dimension", dimension=dim
                )
            )
        measure_spec = source_spec.measures.get(query.measure)
        columns.append(
            ColumnSpec(
                key="value",
                label=measure_spec.label if measure_spec else query.measure.value,
                kind="measure",
                measure=query.measure,
                unit=measure_spec.unit if measure_spec else None,
            )
        )
        return columns

    def _build_rows(
        self,
        query: AnalyticsQuery,
        compiled: CompiledQuery,
        raw_rows: list,
        resolved_range: _ResolvedRange,
        first_day_of_week: int,
    ) -> list[QueryRow]:
        n_dims = len(query.group_by)

        # Resolve id -> title/name for dimensions whose raw key is an opaque foreign key.
        task_titles: dict[str, str] = {}
        habit_names: dict[str, str] = {}
        if Dimension.TASK in query.group_by:
            idx = query.group_by.index(Dimension.TASK)
            ids = {str(r[idx]) for r in raw_rows if r[idx] is not None}
            if ids:
                task_titles = {t.id: t.title for t in self.db.exec(select(Task).where(Task.id.in_(ids))).all()}
        if Dimension.HABIT in query.group_by:
            idx = query.group_by.index(Dimension.HABIT)
            ids = {str(r[idx]) for r in raw_rows if r[idx] is not None}
            if ids:
                habit_names = {h.id: h.name for h in self.db.exec(select(Habit).where(Habit.id.in_(ids))).all()}

        rows: list[QueryRow] = []
        for r in raw_rows:
            keys = [str(r[i]) if r[i] is not None else "" for i in range(n_dims)]
            value = r[n_dims]
            count = r[n_dims + 1]

            labels = []
            for i, dim in enumerate(query.group_by):
                if dim == Dimension.TASK:
                    labels.append(task_titles.get(keys[i], keys[i]))
                elif dim == Dimension.HABIT:
                    labels.append(habit_names.get(keys[i], keys[i]))
                else:
                    labels.append(_label_for(dim, keys[i]))

            rows.append(
                QueryRow(keys=keys, labels=labels, value=float(value) if value is not None else None, count=count)
            )
        return rows

    def _fill_gaps(
        self, query: AnalyticsQuery, rows: list[QueryRow], resolved_range: _ResolvedRange, first_day_of_week: int
    ) -> list[QueryRow]:
        dim = query.group_by[0]
        by_key = {r.keys[0]: r for r in rows}

        if dim in (Dimension.DAY, Dimension.WEEK, Dimension.MONTH):
            if resolved_range.start_date is None:
                raise ValidationError("fill_gaps requires a bounded date_range")
            if dim == Dimension.DAY:
                keys = _gap_fill_day_keys(resolved_range)
            elif dim == Dimension.WEEK:
                keys = _gap_fill_week_keys(resolved_range, first_day_of_week)
            else:
                keys = _gap_fill_month_keys(resolved_range)
        elif dim == Dimension.HOUR_OF_DAY:
            keys = [str(h) for h in range(24)]
        elif dim == Dimension.WEEKDAY:
            keys = [str((first_day_of_week + i) % 7) for i in range(7)]
        else:
            return rows

        default_value = 0.0 if query.measure.value in _ZERO_FILLABLE_MEASURES else None
        filled = []
        for key in keys:
            existing = by_key.get(key)
            if existing:
                filled.append(existing)
            else:
                extra_keys = rows[0].keys[1:] if rows and len(rows[0].keys) > 1 else []
                filled.append(
                    QueryRow(
                        keys=[key] + extra_keys,
                        labels=[_label_for(dim, key)] + (rows[0].labels[1:] if rows else []),
                        value=default_value,
                        count=0,
                    )
                )
        return filled

    def _reorder_weekday(self, rows: list[QueryRow], first_day_of_week: int, descending: bool) -> list[QueryRow]:
        by_key = {r.keys[0]: r for r in rows}
        order = [(first_day_of_week + i) % 7 for i in range(7)]
        if descending:
            order = list(reversed(order))
        return [by_key[str(k)] for k in order if str(k) in by_key]
