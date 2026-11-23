"""Compiles a structured `AnalyticsQuery` into a single parameterised SQL statement.

Pure function, no FastAPI / no `sqlmodel.Session` import. This module owns the actual SQL
text construction (joins, CTEs); `core/query_registry.py` only says what combinations are
*allowed* per source.

Safety rule (see plan): no request-derived STRING ever reaches the SQL text. `QuerySource` /
`Measure` / `Dimension` / `FilterField` / `FilterOp` members are used only as dict keys that
select a hardcoded SQL fragment written in this file. Every request-derived VALUE (filter
values, date boundaries, the week-start modifier, the row limit) reaches SQLite only as a bind
parameter. A lookup miss (an enum member with no fragment for this source) raises
`ValidationError` rather than silently building a broken or unsafe query.
"""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from timetrace.core.exceptions import ValidationError
from timetrace.core.query_registry import SOURCES, TimeAnchorKind, recorded_measure_capability
from timetrace.core.query_spec import (
    AnalyticsQuery,
    Dimension,
    FilterField,
    FilterOp,
    Measure,
    QueryFilter,
    QuerySource,
    SortKey,
    TagAttribution,
)

_TIME_DIMENSIONS = {Dimension.DAY, Dimension.WEEK, Dimension.MONTH, Dimension.HOUR_OF_DAY, Dimension.WEEKDAY}


@dataclass
class QueryContext:
    """Request-scoped, already-resolved context needed to compile & bind a query.

    Built by `QueryService`, never constructed from raw request strings directly (the
    timezone has already been validated as a real `ZoneInfo`, the range already resolved to
    concrete boundaries).
    """

    timezone: str
    first_day_of_week: int  # 0=Sunday..6=Saturday -- matches SQLite's own 'weekday N' modifier
    range_start_utc: datetime | None = None  # naive UTC, inclusive
    range_end_utc: datetime | None = None  # naive UTC, exclusive
    range_start_local: str | None = None  # YYYY-MM-DD, inclusive (LOCAL_DATE_STRING sources)
    range_end_local: str | None = None  # YYYY-MM-DD, inclusive (LOCAL_DATE_STRING sources)
    plan_windows: list[tuple[str, str | None, datetime, datetime]] = field(default_factory=list)
    now_utc: datetime | None = None  # naive UTC, used by relative session-time filters
    recorded_work_ids: tuple[str, ...] | None = None  # internal exact cohort; () selects nothing
    recorded_work_descendant_root: str | None = None  # bound current-hierarchy cohort with cycle defense
    recorded_work_all_time_scalar: bool = False  # trusted internal scalar SUM only, never a public widget flag
    recorded_work_seconds: bool = False  # internal evidence only; public widgets stay hours


@dataclass
class CompiledQuery:
    sql: str
    params: dict[str, object] = field(default_factory=dict)
    group_by: list[Dimension] = field(default_factory=list)
    measure: Measure = Measure.SUM_DURATION
    source: QuerySource = QuerySource.SESSIONS
    has_rows_limit: bool = False  # False for a tile (no GROUP BY, exactly one row)
    totals_overlap: bool = False
    context: QueryContext | None = None


# ---------------------------------------------------------------------------
# Time dimension fragments
# ---------------------------------------------------------------------------


def _time_dimension_sql(dim: Dimension, anchor: str, anchor_kind: TimeAnchorKind) -> str:
    localtime = anchor_kind == TimeAnchorKind.UTC_DATETIME
    mod = ", 'localtime'" if localtime else ""

    if dim == Dimension.DAY:
        return f"DATE({anchor}{mod})"
    if dim == Dimension.WEEK:
        return f"DATE({anchor}{mod}, '-6 days', :__week_start)"
    if dim == Dimension.MONTH:
        return f"DATE({anchor}{mod}, 'start of month')"
    if dim == Dimension.HOUR_OF_DAY:
        if not localtime:
            raise ValidationError("hour_of_day is not available on a date-only source")
        return f"CAST(STRFTIME('%H', {anchor}, 'localtime') AS INTEGER)"
    if dim == Dimension.WEEKDAY:
        return f"CAST(STRFTIME('%w', {anchor}{mod}) AS INTEGER)"
    raise ValidationError(f"{dim} is not a time dimension")


def _range_where(anchor_kind: TimeAnchorKind, anchor: str, ctx: QueryContext) -> tuple[str | None, dict]:
    if anchor_kind == TimeAnchorKind.UTC_DATETIME:
        if ctx.range_start_utc is None:
            return None, {}
        return (
            f"{anchor} >= :__range_start AND {anchor} < :__range_end",
            {"__range_start": ctx.range_start_utc, "__range_end": ctx.range_end_utc},
        )
    else:
        if ctx.range_start_local is None:
            return None, {}
        return (
            f"{anchor} >= :__range_start AND {anchor} <= :__range_end",
            {"__range_start": ctx.range_start_local, "__range_end": ctx.range_end_local},
        )


# ---------------------------------------------------------------------------
# Non-time dimension / filter columns, per source.
# ---------------------------------------------------------------------------

_NON_TIME_DIMENSION_SQL: dict[QuerySource, dict[Dimension, str | None]] = {
    QuerySource.SESSIONS: {
        Dimension.TAG: None,
        Dimension.CATEGORY: "t.category",
        Dimension.TASK: "s.task_id",
        Dimension.STATUS: "t.status",
        Dimension.PRIORITY: "t.priority",
    },
    QuerySource.TASKS: {
        Dimension.CATEGORY: "t.category",
        Dimension.STATUS: "t.status",
        Dimension.PRIORITY: "t.priority",
        Dimension.ESTIMATION_BUCKET: None,
    },
    QuerySource.HABIT_LOGS: {
        Dimension.HABIT: "hl.habit_id",
    },
    QuerySource.DAY_REVIEWS: {},
    QuerySource.RATING_ENTRIES: {
        Dimension.RATING_TYPE: "rd.name",
    },
}

_NON_TIME_FILTER_SQL: dict[QuerySource, dict[FilterField, str]] = {
    QuerySource.SESSIONS: {
        FilterField.CATEGORY: "t.category",
        FilterField.TASK: "s.task_id",
        FilterField.STATUS: "t.status",
        FilterField.PRIORITY: "t.priority",
        FilterField.TASK_PARENT: "t.parent_id",
        FilterField.HAS_TASK: "(CASE WHEN s.task_id IS NOT NULL THEN 1 ELSE 0 END)",
        FilterField.NOTES: "COALESCE(s.notes, '')",
        FilterField.DURATION_SECONDS: "COALESCE(s.duration_seconds, 0)",
    },
    QuerySource.TASKS: {
        FilterField.CATEGORY: "t.category",
        FilterField.STATUS: "t.status",
        FilterField.PRIORITY: "t.priority",
        FilterField.TASK_PARENT: "t.parent_id",
    },
    QuerySource.HABIT_LOGS: {
        FilterField.HABIT: "hl.habit_id",
    },
    QuerySource.DAY_REVIEWS: {},
    QuerySource.RATING_ENTRIES: {
        FilterField.RATING_TYPE: "rd.name",
        FilterField.RATING_SCORE: "re.score",
    },
}


def _dimension_sql(source: QuerySource, dim: Dimension, anchor: str, anchor_kind: TimeAnchorKind) -> str:
    if dim in _TIME_DIMENSIONS:
        return _time_dimension_sql(dim, anchor, anchor_kind)
    expr = _NON_TIME_DIMENSION_SQL.get(source, {}).get(dim)
    if expr is None:
        raise ValidationError(f"Dimension {dim} is not directly selectable for source {source}")
    return expr


def _build_filter_clause(
    source: QuerySource,
    filters: list[QueryFilter],
    anchor: str,
    anchor_kind: TimeAnchorKind,
    param_prefix: str,
    ctx: QueryContext,
) -> tuple[list[str], dict[str, object]]:
    conditions: list[str] = []
    params: dict[str, object] = {}

    for i, f in enumerate(filters):
        if f.field == FilterField.TAG:
            continue

        if f.field == FilterField.SESSION_TIME_RELATIVE:
            if source != QuerySource.SESSIONS:
                raise ValidationError("session_time_relative is only supported for source sessions")
            if f.op not in (FilterOp.EQ, FilterOp.IN):
                raise ValidationError("session_time_relative supports only eq and in")
            if not f.values:
                raise ValidationError("Filter on session_time_relative requires at least one value")
            if ctx.now_utc is None:
                raise ValidationError("session_time_relative requires a query timestamp")
            relative_sql = {
                "past": "s.end_time IS NOT NULL AND s.end_time <= :__now_utc",
                "future": "s.start_time > :__now_utc",
                "ongoing": "s.start_time <= :__now_utc AND (s.end_time IS NULL OR s.end_time > :__now_utc)",
            }
            predicates = []
            for value in f.values:
                predicate = relative_sql.get(str(value).lower())
                if predicate is None:
                    raise ValidationError("session_time_relative must be one of 'past', 'future', or 'ongoing'")
                predicates.append(f"({predicate})")
            # Match SQLModel's fixed-width SQLite timestamps, including whole-second instants.
            params["__now_utc"] = ctx.now_utc.isoformat(sep=" ", timespec="microseconds")
            conditions.append(" OR ".join(predicates) if len(predicates) == 1 else f"({' OR '.join(predicates)})")
            continue

        if f.field in (
            FilterField.DAY,
            FilterField.WEEK,
            FilterField.MONTH,
            FilterField.HOUR_OF_DAY,
            FilterField.WEEKDAY,
        ):
            col = _time_dimension_sql(Dimension(f.field.value), anchor, anchor_kind)
        else:
            col = _NON_TIME_FILTER_SQL.get(source, {}).get(f.field)

        if col is None:
            raise ValidationError(f"Filter field {f.field} is not supported for source {source}")

        pname = f"{param_prefix}_f{i}"

        if f.op == FilterOp.IS_NULL:
            conditions.append(f"{col} IS NULL")
            continue
        if f.op == FilterOp.IS_NOT_NULL:
            conditions.append(f"{col} IS NOT NULL")
            continue

        if not f.values:
            raise ValidationError(f"Filter on {f.field} with op {f.op} requires at least one value")

        if f.op in (FilterOp.IN, FilterOp.NOT_IN):
            names = []
            for j, v in enumerate(f.values):
                pn = f"{pname}_{j}"
                params[pn] = v
                names.append(f":{pn}")
            keyword = "IN" if f.op == FilterOp.IN else "NOT IN"
            conditions.append(f"{col} {keyword} ({', '.join(names)})")
        elif f.op == FilterOp.CONTAINS:
            params[pname] = f"%{f.values[0]}%"
            conditions.append(f"{col} LIKE :{pname}")
        else:
            op_sql = {
                FilterOp.EQ: "=",
                FilterOp.NEQ: "!=",
                FilterOp.GT: ">",
                FilterOp.GTE: ">=",
                FilterOp.LT: "<",
                FilterOp.LTE: "<=",
            }.get(f.op)
            if op_sql is None:
                raise ValidationError(f"Unsupported filter op {f.op}")
            params[pname] = f.values[0]
            conditions.append(f"{col} {op_sql} :{pname}")

    return conditions, params


def _order_by_sql(sort: SortKey, has_group_by: bool) -> str:
    if not has_group_by:
        return ""
    return {
        SortKey.VALUE_DESC: "ORDER BY value DESC",
        SortKey.VALUE_ASC: "ORDER BY value ASC",
        SortKey.DIMENSION_ASC: "ORDER BY 1 ASC",
        SortKey.DIMENSION_DESC: "ORDER BY 1 DESC",
    }[sort]


def _select_group_columns(
    query: AnalyticsQuery, source: QuerySource, anchor: str, anchor_kind: TimeAnchorKind
) -> list[str]:
    return [_dimension_sql(source, dim, anchor, anchor_kind) for dim in query.group_by]


def _group_by_clause(n: int) -> str:
    if n == 0:
        return ""
    return "GROUP BY " + ", ".join(str(i) for i in range(1, n + 1))


# ---------------------------------------------------------------------------
# sessions
# ---------------------------------------------------------------------------

_SESSION_MEASURE_SQL: dict[Measure, str] = {
    Measure.SUM_DURATION: "SUM(weight) / 3600.0",
    Measure.SESSION_COUNT: "COUNT(*)",
    Measure.AVG_SESSION_LENGTH: "SUM(weight) / COUNT(*) / 60.0",
}


def _compile_sessions(query: AnalyticsQuery, ctx: QueryContext) -> CompiledQuery:
    source_spec = SOURCES[QuerySource.SESSIONS]
    anchor_kind = source_spec.anchor_kind

    needs_tag = Dimension.TAG in query.group_by or any(f.field == FilterField.TAG for f in query.filters)

    if query.measure == Measure.AVG_RATING and needs_tag:
        raise ValidationError("avg_rating cannot be combined with the tag dimension/filter")

    if needs_tag:
        return _compile_sessions_tagged(query, ctx, anchor_kind)
    return _compile_sessions_plain(query, ctx, anchor_kind)


def _sessions_base_where(
    query: AnalyticsQuery, ctx: QueryContext, anchor: str, anchor_kind: TimeAnchorKind
) -> tuple[list[str], dict]:
    conditions: list[str] = []
    params: dict[str, object] = {}

    range_sql, range_params = _range_where(anchor_kind, anchor, ctx)
    if range_sql:
        conditions.append(range_sql)
        params.update(range_params)

    non_tag_filters = [f for f in query.filters if f.field != FilterField.TAG]
    filt_sql, filt_params = _build_filter_clause(QuerySource.SESSIONS, non_tag_filters, anchor, anchor_kind, "s", ctx)
    conditions.extend(filt_sql)
    params.update(filt_params)

    return conditions, params


def _compile_sessions_plain(query: AnalyticsQuery, ctx: QueryContext, anchor_kind: TimeAnchorKind) -> CompiledQuery:
    anchor = "s.start_time"
    conditions, params = _sessions_base_where(query, ctx, anchor, anchor_kind)

    from_clause = "session s LEFT JOIN task t ON t.id = s.task_id"

    if query.measure == Measure.AVG_RATING:
        from_clause += (
            " LEFT JOIN ratingentry re ON re.target_type = 'session' AND re.target_id = s.id"
            " AND re.dismissed = 0 AND re.score IS NOT NULL"
        )
        measure_sql = "AVG(re.score)"
    else:
        measure_sql = _SESSION_MEASURE_SQL.get(query.measure)
        if measure_sql is None:
            raise ValidationError(f"Measure {query.measure} is not supported for source sessions")
        measure_sql = measure_sql.replace("weight", "COALESCE(s.duration_seconds, 0)")

    group_cols = _select_group_columns(query, QuerySource.SESSIONS, anchor, anchor_kind)
    select_parts = [f"{col} AS k{i}" for i, col in enumerate(group_cols)]
    select_parts.append(f"{measure_sql} AS value")
    select_parts.append("COUNT(*) AS n")

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    group_sql = _group_by_clause(len(group_cols))
    order_sql = _order_by_sql(query.sort, bool(group_cols))
    limit_sql = "LIMIT :__limit" if group_cols else ""

    if Dimension.WEEK in query.group_by:
        params["__week_start"] = f"weekday {ctx.first_day_of_week}"

    sql = f"SELECT {', '.join(select_parts)} FROM {from_clause} {where_sql} {group_sql} {order_sql} {limit_sql}".strip()

    return CompiledQuery(
        sql=sql,
        params=params,
        group_by=query.group_by,
        measure=query.measure,
        source=QuerySource.SESSIONS,
        has_rows_limit=bool(group_cols),
        totals_overlap=False,
    )


def _compile_sessions_tagged(query: AnalyticsQuery, ctx: QueryContext, anchor_kind: TimeAnchorKind) -> CompiledQuery:
    conditions, params = _sessions_base_where(query, ctx, "s.start_time", anchor_kind)
    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    weight_expr = (
        "dur" if query.tag_attribution == TagAttribution.FAN_OUT else "dur * 1.0 / COUNT(*) OVER (PARTITION BY sid)"
    )

    cte = f"""
WITH RECURSIVE base AS (
    SELECT s.id AS sid, COALESCE(s.duration_seconds, 0) AS dur, s.start_time AS ts,
           t.category AS category, t.status AS status, t.priority AS priority, s.task_id AS task_id,
           TRIM(COALESCE(s.tags, '')) || ' ' AS rest
    FROM session s LEFT JOIN task t ON t.id = s.task_id
    {where_sql}
),
split(sid, dur, ts, category, status, priority, task_id, tok, rest) AS (
    SELECT sid, dur, ts, category, status, priority, task_id, '', rest FROM base
    UNION ALL
    SELECT sid, dur, ts, category, status, priority, task_id,
           TRIM(SUBSTR(rest, 1, INSTR(rest, ' ') - 1)),
           SUBSTR(rest, INSTR(rest, ' ') + 1)
    FROM split WHERE rest <> ''
),
hashed AS (
    SELECT sid, dur, ts, category, status, priority, task_id, tok FROM split WHERE tok LIKE '#%'
),
tagged AS (
    SELECT sid, dur, ts, category, status, priority, task_id, tok AS tag FROM hashed
    UNION ALL
    SELECT b.sid, b.dur, b.ts, b.category, b.status, b.priority, b.task_id, '#general'
    FROM base b WHERE NOT EXISTS (SELECT 1 FROM hashed h WHERE h.sid = b.sid)
),
attributed AS (
    SELECT sid, ts, tag, category, status, priority, task_id, {weight_expr} AS weight
    FROM tagged
)
""".strip()

    tag_filters = [f for f in query.filters if f.field == FilterField.TAG]
    tag_where = ""
    tag_params: dict[str, object] = {}
    tag_conditions: list[str] = []
    for i, f in enumerate(tag_filters):
        if not f.values and f.op not in (FilterOp.IS_NULL, FilterOp.IS_NOT_NULL):
            raise ValidationError(f"Filter on tag with op {f.op} requires at least one value")
        pname = f"tagf_{i}"
        if f.op in (FilterOp.EQ, FilterOp.CONTAINS):
            tag_params[pname] = f.values[0]
            tag_conditions.append(f"tag = :{pname}")
        elif f.op == FilterOp.NEQ:
            tag_params[pname] = f.values[0]
            tag_conditions.append(f"tag != :{pname}")
        elif f.op in (FilterOp.IN, FilterOp.NOT_IN):
            names = []
            for j, v in enumerate(f.values):
                pn = f"{pname}_{j}"
                tag_params[pn] = v
                names.append(f":{pn}")
            keyword = "IN" if f.op == FilterOp.IN else "NOT IN"
            tag_conditions.append(f"tag {keyword} ({', '.join(names)})")
        else:
            raise ValidationError(f"Unsupported filter op {f.op} for tag")
    if tag_conditions:
        tag_where = f"WHERE {' AND '.join(tag_conditions)}"

    # The final SELECT reads the attributed projection, not the original s/t aliases.
    attributed_dimensions = {
        Dimension.TAG: "tag",
        Dimension.CATEGORY: "category",
        Dimension.TASK: "task_id",
        Dimension.STATUS: "status",
        Dimension.PRIORITY: "priority",
    }
    group_cols = []
    for dim in query.group_by:
        if dim in attributed_dimensions:
            group_cols.append(attributed_dimensions[dim])
        else:
            group_cols.append(_dimension_sql(QuerySource.SESSIONS, dim, "ts", anchor_kind))

    select_parts = [f"{col} AS k{i}" for i, col in enumerate(group_cols)]

    measure_sql = _SESSION_MEASURE_SQL.get(query.measure)
    if measure_sql is None:
        raise ValidationError(f"Measure {query.measure} is not supported alongside the tag dimension/filter")
    select_parts.append(f"{measure_sql} AS value")
    select_parts.append("COUNT(*) AS n")

    group_sql = _group_by_clause(len(group_cols))
    order_sql = _order_by_sql(query.sort, bool(group_cols))
    limit_sql = "LIMIT :__limit" if group_cols else ""

    if Dimension.WEEK in query.group_by:
        params["__week_start"] = f"weekday {ctx.first_day_of_week}"

    all_params = {**params, **tag_params}

    sql = (
        f"{cte} SELECT {', '.join(select_parts)} FROM attributed {tag_where} {group_sql} {order_sql} {limit_sql}"
    ).strip()

    totals_overlap = Dimension.TAG in query.group_by and (
        query.tag_attribution == TagAttribution.FAN_OUT or query.measure == Measure.SESSION_COUNT
    )

    return CompiledQuery(
        sql=sql,
        params=all_params,
        group_by=query.group_by,
        measure=query.measure,
        source=QuerySource.SESSIONS,
        has_rows_limit=bool(group_cols),
        totals_overlap=totals_overlap,
    )


# ---------------------------------------------------------------------------
# tasks
# ---------------------------------------------------------------------------

_IS_DONE_SQL = "(COALESCE(ts.is_completed, 0) = 1 OR LOWER(COALESCE(t.status, '')) IN ('done', 'completed'))"

_EST_MINUTES_SQL = "COALESCE(t.estimated_minutes, 15)"

_TASK_MEASURE_SQL: dict[Measure, str] = {
    Measure.TASK_COUNT: "COUNT(*)",
    Measure.COMPLETION_RATE: f"100.0 * SUM(CASE WHEN {_IS_DONE_SQL} THEN 1 ELSE 0 END) / COUNT(*)",
    Measure.SUM_ESTIMATED_DURATION: f"SUM({_EST_MINUTES_SQL}) / 60.0",
}


def _compile_tasks(query: AnalyticsQuery, ctx: QueryContext) -> CompiledQuery:
    needs_estimation = query.measure == Measure.ESTIMATION_ACCURACY or Dimension.ESTIMATION_BUCKET in query.group_by
    if needs_estimation:
        return _compile_tasks_estimation(query, ctx)
    return _compile_tasks_plain(query, ctx)


def _compile_tasks_plain(query: AnalyticsQuery, ctx: QueryContext) -> CompiledQuery:
    anchor = "t.created_at"
    anchor_kind = TimeAnchorKind.UTC_DATETIME

    conditions: list[str] = []
    params: dict[str, object] = {}

    range_sql, range_params = _range_where(anchor_kind, anchor, ctx)
    if range_sql:
        conditions.append(range_sql)
        params.update(range_params)

    filt_sql, filt_params = _build_filter_clause(QuerySource.TASKS, query.filters, anchor, anchor_kind, "t", ctx)
    conditions.extend(filt_sql)
    params.update(filt_params)

    from_clause = "task t LEFT JOIN taskstatus ts ON ts.id = t.status_id"

    if query.measure == Measure.AVG_RATING:
        from_clause += (
            " LEFT JOIN ratingentry re ON re.target_type = 'task' AND re.target_id = t.id"
            " AND re.dismissed = 0 AND re.score IS NOT NULL"
        )
        measure_sql = "AVG(re.score)"
    else:
        measure_sql = _TASK_MEASURE_SQL.get(query.measure)
        if measure_sql is None:
            raise ValidationError(f"Measure {query.measure} is not supported for source tasks")

    group_cols = _select_group_columns(query, QuerySource.TASKS, anchor, anchor_kind)
    select_parts = [f"{col} AS k{i}" for i, col in enumerate(group_cols)]
    select_parts.append(f"{measure_sql} AS value")
    select_parts.append("COUNT(*) AS n")

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    group_sql = _group_by_clause(len(group_cols))
    order_sql = _order_by_sql(query.sort, bool(group_cols))
    limit_sql = "LIMIT :__limit" if group_cols else ""

    if Dimension.WEEK in query.group_by:
        params["__week_start"] = f"weekday {ctx.first_day_of_week}"

    sql = f"SELECT {', '.join(select_parts)} FROM {from_clause} {where_sql} {group_sql} {order_sql} {limit_sql}".strip()

    return CompiledQuery(
        sql=sql,
        params=params,
        group_by=query.group_by,
        measure=query.measure,
        source=QuerySource.TASKS,
        has_rows_limit=bool(group_cols),
        totals_overlap=False,
    )


def _compile_tasks_estimation(query: AnalyticsQuery, ctx: QueryContext) -> CompiledQuery:
    anchor = "t.created_at"
    anchor_kind = TimeAnchorKind.UTC_DATETIME

    conditions: list[str] = []
    params: dict[str, object] = {}

    range_sql, range_params = _range_where(anchor_kind, anchor, ctx)
    if range_sql:
        conditions.append(range_sql)
        params.update(range_params)

    non_estimation_filters = [f for f in query.filters if f.field != FilterField.ESTIMATION_BUCKET]
    filt_sql, filt_params = _build_filter_clause(
        QuerySource.TASKS, non_estimation_filters, anchor, anchor_kind, "t", ctx
    )
    conditions.extend(filt_sql)
    params.update(filt_params)

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    prelude = f"""
WITH actual AS (
    SELECT task_id, SUM(COALESCE(duration_seconds, 0)) AS secs
    FROM session WHERE task_id IS NOT NULL GROUP BY task_id
),
est AS (
    SELECT t.id, t.status, t.priority, t.category, t.created_at,
           {_EST_MINUTES_SQL} * 60 AS est_secs,
           COALESCE(a.secs, 0) AS act_secs
    FROM task t LEFT JOIN actual a ON a.task_id = t.id
    {where_sql}
),
base AS (
    SELECT *, CASE
        WHEN act_secs * 1.0 / est_secs BETWEEN 0.85 AND 1.15 THEN 'accurate'
        WHEN act_secs * 1.0 / est_secs > 1.15 THEN 'underestimated'
        ELSE 'overestimated' END AS estimation_bucket
    FROM est
    WHERE act_secs > 0
)
""".strip()

    bucket_conditions: list[str] = []
    bucket_params: dict[str, object] = {}
    for i, f in enumerate([flt for flt in query.filters if flt.field == FilterField.ESTIMATION_BUCKET]):
        if not f.values:
            raise ValidationError("Filter on estimation_bucket requires at least one value")
        pname = f"eb_{i}"
        if f.op == FilterOp.IN:
            names = []
            for j, v in enumerate(f.values):
                pn = f"{pname}_{j}"
                bucket_params[pn] = v
                names.append(f":{pn}")
            bucket_conditions.append(f"estimation_bucket IN ({', '.join(names)})")
        else:
            bucket_params[pname] = f.values[0]
            bucket_conditions.append(f"estimation_bucket = :{pname}")

    bucket_where = f"WHERE {' AND '.join(bucket_conditions)}" if bucket_conditions else ""

    if query.measure == Measure.ESTIMATION_ACCURACY:
        if query.group_by:
            raise ValidationError(
                "estimation_accuracy does not support group_by; use task_count grouped by estimation_bucket instead"
            )
        sql = (
            f"{prelude} SELECT 100.0 * SUM(CASE WHEN estimation_bucket = 'accurate' THEN 1 ELSE 0 END)"
            f" / COUNT(*) AS value, COUNT(*) AS n FROM base {bucket_where}"
        )
        return CompiledQuery(
            sql=sql.strip(),
            params={**params, **bucket_params},
            group_by=[],
            measure=query.measure,
            source=QuerySource.TASKS,
            has_rows_limit=False,
            totals_overlap=False,
        )

    # These dimensions have already been projected into base; t is no longer in scope.
    base_dimensions = {
        Dimension.ESTIMATION_BUCKET: "estimation_bucket",
        Dimension.CATEGORY: "category",
        Dimension.STATUS: "status",
        Dimension.PRIORITY: "priority",
    }
    group_cols = []
    for dim in query.group_by:
        if dim in base_dimensions:
            group_cols.append(base_dimensions[dim])
        else:
            group_cols.append(_dimension_sql(QuerySource.TASKS, dim, "created_at", anchor_kind))

    measure_sql = _TASK_MEASURE_SQL.get(query.measure)
    if measure_sql is None:
        raise ValidationError(f"Measure {query.measure} is not supported alongside estimation_bucket")

    select_parts = [f"{col} AS k{i}" for i, col in enumerate(group_cols)]
    select_parts.append(f"{measure_sql} AS value")
    select_parts.append("COUNT(*) AS n")

    group_sql = _group_by_clause(len(group_cols))
    order_sql = _order_by_sql(query.sort, bool(group_cols))
    limit_sql = "LIMIT :__limit" if group_cols else ""

    if Dimension.WEEK in query.group_by:
        params["__week_start"] = f"weekday {ctx.first_day_of_week}"

    sql = (
        f"{prelude} SELECT {', '.join(select_parts)} FROM base {bucket_where} {group_sql} {order_sql} {limit_sql}"
    ).strip()

    return CompiledQuery(
        sql=sql,
        params={**params, **bucket_params},
        group_by=query.group_by,
        measure=query.measure,
        source=QuerySource.TASKS,
        has_rows_limit=bool(group_cols),
        totals_overlap=False,
    )


# ---------------------------------------------------------------------------
# habit_logs
# ---------------------------------------------------------------------------


def _compile_habit_logs(query: AnalyticsQuery, ctx: QueryContext) -> CompiledQuery:
    anchor = "hl.date_str"
    anchor_kind = TimeAnchorKind.LOCAL_DATE_STRING

    if query.measure != Measure.HABIT_COMPLETION_RATE:
        raise ValidationError(f"Measure {query.measure} is not supported for source habit_logs")

    conditions: list[str] = []
    params: dict[str, object] = {}

    range_sql, range_params = _range_where(anchor_kind, anchor, ctx)
    if range_sql:
        conditions.append(range_sql)
        params.update(range_params)

    filt_sql, filt_params = _build_filter_clause(QuerySource.HABIT_LOGS, query.filters, anchor, anchor_kind, "hl", ctx)
    conditions.extend(filt_sql)
    params.update(filt_params)

    group_cols = _select_group_columns(query, QuerySource.HABIT_LOGS, anchor, anchor_kind)
    select_parts = [f"{col} AS k{i}" for i, col in enumerate(group_cols)]
    select_parts.append("100.0 * SUM(CASE WHEN hl.status = 'completed' THEN 1 ELSE 0 END) / COUNT(*) AS value")
    select_parts.append("COUNT(*) AS n")

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    group_sql = _group_by_clause(len(group_cols))
    order_sql = _order_by_sql(query.sort, bool(group_cols))
    limit_sql = "LIMIT :__limit" if group_cols else ""

    if Dimension.WEEK in query.group_by:
        params["__week_start"] = f"weekday {ctx.first_day_of_week}"

    sql = f"SELECT {', '.join(select_parts)} FROM habitlog hl {where_sql} {group_sql} {order_sql} {limit_sql}".strip()

    return CompiledQuery(
        sql=sql,
        params=params,
        group_by=query.group_by,
        measure=query.measure,
        source=QuerySource.HABIT_LOGS,
        has_rows_limit=bool(group_cols),
        totals_overlap=False,
    )


# ---------------------------------------------------------------------------
# day_reviews
# ---------------------------------------------------------------------------


def _compile_day_reviews(query: AnalyticsQuery, ctx: QueryContext) -> CompiledQuery:
    anchor = "dr.date_str"
    anchor_kind = TimeAnchorKind.LOCAL_DATE_STRING

    if query.measure != Measure.AVG_RATING:
        raise ValidationError(f"Measure {query.measure} is not supported for source day_reviews")

    conditions: list[str] = []
    params: dict[str, object] = {}

    range_sql, range_params = _range_where(anchor_kind, anchor, ctx)
    if range_sql:
        conditions.append(range_sql)
        params.update(range_params)

    filt_sql, filt_params = _build_filter_clause(QuerySource.DAY_REVIEWS, query.filters, anchor, anchor_kind, "dr", ctx)
    conditions.extend(filt_sql)
    params.update(filt_params)

    group_cols = _select_group_columns(query, QuerySource.DAY_REVIEWS, anchor, anchor_kind)
    select_parts = [f"{col} AS k{i}" for i, col in enumerate(group_cols)]
    select_parts.append("AVG(dr.rating) AS value")
    select_parts.append("COUNT(*) AS n")

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    group_sql = _group_by_clause(len(group_cols))
    order_sql = _order_by_sql(query.sort, bool(group_cols))
    limit_sql = "LIMIT :__limit" if group_cols else ""

    if Dimension.WEEK in query.group_by:
        params["__week_start"] = f"weekday {ctx.first_day_of_week}"

    sql = f"SELECT {', '.join(select_parts)} FROM dayreview dr {where_sql} {group_sql} {order_sql} {limit_sql}".strip()

    return CompiledQuery(
        sql=sql,
        params=params,
        group_by=query.group_by,
        measure=query.measure,
        source=QuerySource.DAY_REVIEWS,
        has_rows_limit=bool(group_cols),
        totals_overlap=False,
    )


# ---------------------------------------------------------------------------
# rating_entries
# ---------------------------------------------------------------------------


def _compile_rating_entries(query: AnalyticsQuery, ctx: QueryContext) -> CompiledQuery:
    anchor = "re.created_at"
    anchor_kind = TimeAnchorKind.UTC_DATETIME

    if query.measure != Measure.AVG_RATING:
        raise ValidationError(f"Measure {query.measure} is not supported for source rating_entries")

    conditions: list[str] = ["re.dismissed = 0", "re.score IS NOT NULL"]
    params: dict[str, object] = {}

    range_sql, range_params = _range_where(anchor_kind, anchor, ctx)
    if range_sql:
        conditions.append(range_sql)
        params.update(range_params)

    filt_sql, filt_params = _build_filter_clause(
        QuerySource.RATING_ENTRIES, query.filters, anchor, anchor_kind, "re", ctx
    )
    conditions.extend(filt_sql)
    params.update(filt_params)

    group_cols = _select_group_columns(query, QuerySource.RATING_ENTRIES, anchor, anchor_kind)
    select_parts = [f"{col} AS k{i}" for i, col in enumerate(group_cols)]
    select_parts.append("AVG(re.score) AS value")
    select_parts.append("COUNT(*) AS n")

    from_clause = "ratingentry re LEFT JOIN ratingdefinition rd ON rd.id = re.rating_definition_id"
    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    group_sql = _group_by_clause(len(group_cols))
    order_sql = _order_by_sql(query.sort, bool(group_cols))
    limit_sql = "LIMIT :__limit" if group_cols else ""

    if Dimension.WEEK in query.group_by:
        params["__week_start"] = f"weekday {ctx.first_day_of_week}"

    sql = f"SELECT {', '.join(select_parts)} FROM {from_clause} {where_sql} {group_sql} {order_sql} {limit_sql}".strip()

    return CompiledQuery(
        sql=sql,
        params=params,
        group_by=query.group_by,
        measure=query.measure,
        source=QuerySource.RATING_ENTRIES,
        has_rows_limit=bool(group_cols),
        totals_overlap=False,
    )


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------


def _compile_recorded_work(query: AnalyticsQuery, ctx: QueryContext) -> CompiledQuery:
    if ctx.range_start_utc is None or ctx.range_end_utc is None:
        raise ValidationError("Recorded-work queries require a bounded local start-date range.")
    zone = ZoneInfo(ctx.timezone)
    start_day = (
        date.fromisoformat(ctx.range_start_local)
        if ctx.range_start_local
        else ctx.range_start_utc.replace(tzinfo=UTC).astimezone(zone).date()
    )
    end_day = (
        date.fromisoformat(ctx.range_end_local)
        if ctx.range_end_local
        else (ctx.range_end_utc.replace(tzinfo=UTC) - timedelta(microseconds=1)).astimezone(zone).date()
    )
    all_time_scalar = (
        ctx.recorded_work_all_time_scalar and query.measure == Measure.SUMMED_RECORDED_WORK and not query.group_by
    )
    if (end_day - start_day).days >= 400 and not all_time_scalar:
        raise ValidationError("Recorded-work ranges cannot exceed 400 local days.")
    if query.fill_gaps or query.comparison:
        raise ValidationError("Recorded work does not support gap filling, baselines or tag attribution.")
    comparison = query.measure in (
        Measure.INSIDE_SCHEDULED_TASK_TIME,
        Measure.OUTSIDE_SCHEDULED_TASK_TIME,
        Measure.PLAN_FILL,
    )
    tagged = Dimension.TAG in query.group_by or any(f.field == FilterField.TAG for f in query.filters)
    if comparison and tagged:
        raise ValidationError("Tag-based plan comparisons are not supported.")
    fill = query.measure == Measure.PLAN_FILL
    if comparison and query.plan_basis not in ("original", "current"):
        raise ValidationError("Plan comparisons require explicit plan_basis original/current.")
    if fill and not query.plan_ids:
        raise ValidationError("plan_fill requires explicit plan_ids for bounded per-plan output.")
    if not comparison and (query.plan_ids or query.plan_basis):
        raise ValidationError("Plan selection is only supported for plan comparison measures.")
    if Dimension.PLAN_ID in query.group_by and not fill:
        raise ValidationError("plan_id grouping is only supported for plan_fill.")
    if fill and query.group_by != [Dimension.PLAN_ID]:
        raise ValidationError("plan_fill requires plan_id grouping; overlapping fills cannot be summed.")
    if query.measure == Measure.UNASSIGNED_RECORDED_TIME and any(
        d not in _TIME_DIMENSIONS and d != Dimension.TAG for d in query.group_by
    ):
        raise ValidationError("Unassigned work does not support task grouping.")
    params = {"start": ctx.range_start_utc, "end": ctx.range_end_utc, "measurement": ctx.now_utc}
    conditions = []
    tag_conditions = []
    for i, f in enumerate(query.filters):
        allowed = (FilterOp.EQ, FilterOp.IN)
        if f.field == FilterField.NOTES:
            allowed = (FilterOp.CONTAINS,)
        elif f.field == FilterField.DURATION_SECONDS:
            allowed = (FilterOp.EQ, FilterOp.GTE, FilterOp.LTE)
        elif f.field == FilterField.HAS_TASK:
            allowed = (FilterOp.EQ,)
        if f.op not in allowed or not f.values or (f.op != FilterOp.IN and len(f.values) != 1):
            raise ValidationError(f"Unsupported recorded-work predicate: {f.field} {f.op}")
        if f.field == FilterField.HAS_TASK and not isinstance(f.values[0], bool):
            raise ValidationError("has_task requires a boolean value.")
        if f.field == FilterField.PROVENANCE and any(v not in ("manual", "timer") for v in f.values):
            raise ValidationError("provenance must be manual or timer.")
        if query.measure == Measure.UNASSIGNED_RECORDED_TIME:
            if f.field in (
                FilterField.TASK,
                FilterField.TASK_PARENT,
                FilterField.CATEGORY,
                FilterField.STATUS,
                FilterField.PRIORITY,
            ):
                raise ValidationError("Unassigned work does not support task metadata filters.")
            if f.field == FilterField.HAS_TASK and f.values != [False]:
                raise ValidationError("Unassigned work requires has_task=false.")
        if f.field == FilterField.TAG:
            names = []
            for j, value in enumerate(f.values):
                name = f"work_tag_{i}_{j}"
                params[name] = value
                names.append(":" + name)
            tag_conditions.append("tag IN (" + ",".join(names) + ")")
            continue
        if f.field == FilterField.PROVENANCE:
            col = "s.provenance"
        elif f.field in _TIME_DIMENSIONS:
            col = _time_dimension_sql(Dimension(f.field.value), "s.start_time", TimeAnchorKind.UTC_DATETIME)
        else:
            col = _NON_TIME_FILTER_SQL[QuerySource.SESSIONS].get(f.field)
        if col is None:
            raise ValidationError(f"Unsupported recorded-work filter: {f.field}")
        names = []
        for j, value in enumerate(f.values):
            name = f"work_filter_{i}_{j}"
            params[name] = f"%{value}%" if f.op == FilterOp.CONTAINS else value
            names.append(":" + name)
        if f.op == FilterOp.IN:
            conditions.append(f"{col} IN ({','.join(names)})")
        else:
            operator = {FilterOp.EQ: "=", FilterOp.CONTAINS: "LIKE", FilterOp.GTE: ">=", FilterOp.LTE: "<="}[f.op]
            conditions.append(f"{col} {operator} {names[0]}")
    predicate = "".join(" AND " + condition for condition in conditions)
    if ctx.recorded_work_ids is not None:
        import json

        params["cohort_ids"] = json.dumps(ctx.recorded_work_ids)
        predicate += " AND s.id IN (SELECT value FROM json_each(:cohort_ids))"
    if ctx.recorded_work_descendant_root is not None:
        params["descendant_root"] = ctx.recorded_work_descendant_root
        predicate += """ AND s.task_id IN (
            WITH RECURSIVE cohort(id) AS (
                SELECT id FROM task WHERE id=:descendant_root
                UNION SELECT t.id FROM task t JOIN cohort c ON t.parent_id=c.id
            ) SELECT id FROM cohort)"""
    task = query.measure in (
        Measure.RECORDED_TASK_TIME,
        Measure.INSIDE_SCHEDULED_TASK_TIME,
        Measure.OUTSIDE_SCHEDULED_TASK_TIME,
    )
    if task:
        predicate += " AND task_id IS NOT NULL"
    elif query.measure == Measure.UNASSIGNED_RECORDED_TIME:
        predicate += " AND task_id IS NULL"
    group_exprs = (
        []
        if fill
        else _select_group_columns(
            query.model_copy(update={"group_by": [d for d in query.group_by if d != Dimension.TAG]}),
            QuerySource.SESSIONS,
            "s.start_time",
            TimeAnchorKind.UTC_DATETIME,
        )
    )
    group_names = [f"g{i}" for i, d in enumerate(query.group_by) if d != Dimension.TAG] if not fill else []
    group_select = "".join(f", {expr} AS {name}" for expr, name in zip(group_exprs, group_names, strict=True))
    group_keys = "".join(f", {name}" for name in group_names)
    params["__week_start"] = f"weekday {ctx.first_day_of_week}"
    partition = "task_id" if task else "'all'"

    def microseconds(expression: str) -> str:
        # Storage is naive UTC with six fractional digits. Integer arithmetic preserves
        # microsecond intervals that SQLite's millisecond-resolution julianday would lose.
        return f"(unixepoch(substr({expression},1,19))*1000000 + CAST(substr({expression},21,6) AS INTEGER))"

    if query.measure == Measure.SUMMED_RECORDED_WORK:
        if tagged or query.tag_attribution == TagAttribution.SPLIT_EVENLY:
            raise ValidationError("Summed recorded work does not support tag attribution.")
        columns = ", ".join(group_names) + "," if group_names else ""
        group = " GROUP BY " + ", ".join(group_names) if group_names else ""
        return CompiledQuery(
            sql=f"""WITH selected AS (
                SELECT s.id,{microseconds("s.start_time")} AS a,{microseconds("s.end_time")} AS b
                {group_select} FROM session s LEFT JOIN task t ON t.id=s.task_id
                WHERE s.kind='recorded_work' AND s.end_time<=:measurement
                  AND s.start_time>=:start AND s.start_time<:end {predicate}
            ) SELECT {columns}COALESCE(SUM(MAX(b-a,0)),0)/1000000.0/{1 if ctx.recorded_work_seconds else 3600} AS value,
                COUNT(*) FROM selected{group}""",
            params=params,
            source=query.source,
            measure=query.measure,
            group_by=query.group_by,
            totals_overlap=False,
        )

    if tagged:
        from timetrace.core.recorded_attribution import tag_union_sql

        selected_sql = f"""SELECT s.id,s.task_id,s.tags,
          {microseconds("s.start_time")} AS a,{microseconds("s.end_time")} AS b{group_select}
          FROM session s LEFT JOIN task t ON t.id=s.task_id
          WHERE s.kind='recorded_work' AND s.end_time<=:measurement
            AND s.start_time>=:start AND s.start_time<:end {predicate}"""
        sql = tag_union_sql(
            selected_sql,
            group_names,
            query.group_by.index(Dimension.TAG) if Dimension.TAG in query.group_by else None,
            task,
            query.tag_attribution == TagAttribution.SPLIT_EVENLY,
            " AND ".join(tag_conditions) or "1",
        )
        return CompiledQuery(
            sql=sql,
            params=params,
            source=query.source,
            measure=query.measure,
            group_by=query.group_by,
            totals_overlap=True,
        )

    windows = []
    for i, (plan_id, task_id, start, end) in enumerate(ctx.plan_windows):
        for key, value in (("id", plan_id), ("task", task_id), ("a", start), ("b", end)):
            params[f"p{i}_{key}"] = value
        windows.append(
            f"SELECT :p{i}_id AS plan_id, :p{i}_task AS task_id, "
            f"{microseconds(f':p{i}_a')} AS a, {microseconds(f':p{i}_b')} AS b"
        )
    plans = " UNION ALL ".join(windows) or "SELECT NULL AS plan_id, NULL AS task_id, NULL AS a, NULL AS b WHERE 0"
    if comparison and not query.plan_ids:
        start_column = "original_start" if query.plan_basis == "original" else "start_time"
        end_column = "original_end" if query.plan_basis == "original" else "end_time"
        plans = f"""SELECT p.id AS plan_id,p.task_id,{microseconds("p." + start_column)} AS a,
            {microseconds("p." + end_column)} AS b FROM scheduled_session p
            WHERE p.task_id IN (SELECT DISTINCT task_id FROM selected)
              AND EXISTS (SELECT 1 FROM selected w WHERE w.task_id=p.task_id
                AND w.a<{microseconds("p." + end_column)} AND w.b>{microseconds("p." + start_column)})"""
    # Union clipped pieces as well as work: overlapping plan windows must not duplicate fill.
    pieces = f"SELECT task_id, a, b, id AS identity{group_keys} FROM selected"
    if comparison:
        pieces = f"""SELECT s.task_id, MAX(s.a,p.a) AS a, MIN(s.b,p.b) AS b,
            p.plan_id AS identity{"".join(", s." + name for name in group_names)}
            FROM selected s JOIN plans p ON s.task_id=p.task_id AND s.a<p.b AND s.b>p.a"""
    key = "identity" if fill else partition

    def merged_ctes(prefix, source, domain):
        return f"""{prefix}_prior AS (
          SELECT *, MAX(b) OVER (PARTITION BY {domain}{group_keys} ORDER BY a,b,identity
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_end FROM ({source})
        ), {prefix}_islands AS (
          SELECT *, SUM(CASE WHEN prior_end IS NULL OR a>prior_end THEN 1 ELSE 0 END)
            OVER (PARTITION BY {domain}{group_keys} ORDER BY a,b,identity) AS island FROM {prefix}_prior
        ), {prefix}_merged AS (
          SELECT {domain} AS domain{group_keys}, MIN(a) AS a,MAX(b) AS b
          FROM {prefix}_islands GROUP BY {domain}{group_keys},island
        )"""

    ctes = merged_ctes("credit", pieces, key)
    expression = f"ROUND(COALESCE(SUM(b-a)/1000000.0,0),6)/{1 if ctx.recorded_work_seconds else 3600}"
    if query.measure == Measure.OUTSIDE_SCHEDULED_TASK_TIME:
        ctes += "," + merged_ctes("whole", f"SELECT task_id,a,b,id AS identity{group_keys} FROM selected", partition)
        ctes += f""", whole_totals AS (
            SELECT domain{group_keys}, SUM(b-a)/1000000.0 AS seconds
            FROM whole_merged GROUP BY domain{group_keys}),
            credit_totals AS (
            SELECT domain{group_keys}, SUM(b-a)/1000000.0 AS seconds
            FROM credit_merged GROUP BY domain{group_keys})"""
        columns = "".join(f"w.{name}," for name in group_names)
        group = " GROUP BY " + ", ".join("w." + name for name in group_names) if group_names else ""
        joins = "".join(f" AND w.{name} IS c.{name}" for name in group_names)
        sql = f"""WITH selected AS (
          SELECT s.id,s.task_id,{microseconds("s.start_time")} AS a,{microseconds("s.end_time")} AS b
          {group_select} FROM session s LEFT JOIN task t ON t.id=s.task_id
          WHERE s.kind='recorded_work' AND s.end_time<=:measurement
            AND s.start_time>=:start AND s.start_time<:end {predicate}
        ), plans AS ({plans}), {ctes}
        SELECT {columns}ROUND(COALESCE(SUM(w.seconds-COALESCE(c.seconds,0)),0),6)/3600 AS value,
            (SELECT COUNT(*) FROM selected r WHERE
                {" AND ".join(f"r.{name} IS w.{name}" for name in group_names) or "1"})
        FROM whole_totals w LEFT JOIN credit_totals c ON w.domain=c.domain{joins}{group}
        """
        return CompiledQuery(
            sql=sql,
            params=params,
            source=query.source,
            measure=query.measure,
            group_by=query.group_by,
            totals_overlap=True,
        )
    columns = ", ".join(group_names) + "," if group_names else ""
    group = " GROUP BY " + ", ".join(group_names) if group_names else ""
    sql = f"""WITH selected AS (
        SELECT s.id,s.task_id,{microseconds("s.start_time")} AS a,{microseconds("s.end_time")} AS b
        {group_select} FROM session s LEFT JOIN task t ON t.id=s.task_id
        WHERE s.kind='recorded_work' AND s.end_time<=:measurement
          AND s.start_time>=:start AND s.start_time<:end {predicate}
    ), plans AS ({plans}), {ctes}
    SELECT {columns}{expression} AS value,
      (SELECT COUNT(*) FROM selected r WHERE
        {" AND ".join(f"r.{name} IS credit_merged.{name}" for name in group_names) or "1"})
    FROM credit_merged{group}
    """
    if fill:
        sql = f"""WITH selected AS (
            SELECT s.id,s.task_id,{microseconds("s.start_time")} AS a,{microseconds("s.end_time")} AS b
            FROM session s LEFT JOIN task t ON t.id=s.task_id
            WHERE s.kind='recorded_work' AND s.end_time<=:measurement
              AND s.start_time>=:start AND s.start_time<:end {predicate}
        ), plans AS ({plans}), {ctes}
        SELECT p.plan_id, ROUND(COALESCE(SUM(c.b-c.a)/1000000.0,0),6)/3600 AS value,
            (SELECT COUNT(*) FROM selected r WHERE r.task_id=p.task_id AND r.a<p.b AND r.b>p.a)
        FROM plans p LEFT JOIN credit_merged c ON p.plan_id=c.domain GROUP BY p.plan_id
        """
    params["__limit"] = query.limit + 1
    return CompiledQuery(
        sql=sql,
        params=params,
        source=query.source,
        measure=query.measure,
        group_by=query.group_by,
        has_rows_limit=bool(group_names),
        totals_overlap=True,
    )


_COMPILERS = {
    QuerySource.RECORDED_WORK: _compile_recorded_work,
    QuerySource.SESSIONS: _compile_sessions,
    QuerySource.TASKS: _compile_tasks,
    QuerySource.HABIT_LOGS: _compile_habit_logs,
    QuerySource.DAY_REVIEWS: _compile_day_reviews,
    QuerySource.RATING_ENTRIES: _compile_rating_entries,
}


def validate_query(query: AnalyticsQuery) -> None:
    """Structural validation against the capability registry, independent of compilation."""
    if query.source != QuerySource.RECORDED_WORK and (query.plan_ids or query.plan_basis):
        raise ValidationError("Plan comparison options require the recorded_work source.")
    source_spec = SOURCES.get(query.source)
    if source_spec is None:
        raise ValidationError(f"Unknown source: {query.source}")

    if query.measure not in source_spec.measures:
        raise ValidationError(f"Measure {query.measure} is not supported for source {query.source}")

    if query.source == QuerySource.RECORDED_WORK:
        capability = recorded_measure_capability(query.measure)
        if any(d.value not in capability["dimensions"] for d in query.group_by):
            raise ValidationError("Unsupported dimensions for this recorded-work measure.")
        for f in query.filters:
            if f.op.value not in capability["filter_operators"].get(f.field.value, []):
                raise ValidationError("Unsupported predicate for this recorded-work measure.")
        if query.tag_attribution.value not in capability["tag_attributions"]:
            raise ValidationError("Unsupported attribution for this recorded-work measure.")

    if len(query.group_by) != len(set(query.group_by)):
        raise ValidationError("group_by dimensions must be distinct")

    for dim in query.group_by:
        if dim not in source_spec.dimensions:
            raise ValidationError(f"Dimension {dim} is not supported for source {query.source}")

    for f in query.filters:
        if f.field not in source_spec.filter_fields:
            raise ValidationError(f"Filter field {f.field} is not supported for source {query.source}")

    if query.measure == Measure.ESTIMATION_ACCURACY and query.group_by:
        raise ValidationError("estimation_accuracy does not support group_by")


def compile_query(query: AnalyticsQuery, ctx: QueryContext) -> CompiledQuery:
    validate_query(query)
    compiler = _COMPILERS.get(query.source)
    if compiler is None:
        raise ValidationError(f"Unsupported source: {query.source}")
    compiled = compiler(query, ctx)
    if query.source == QuerySource.RECORDED_WORK and query.group_by:
        compiled.sql += " " + _order_by_sql(query.sort, True) + ", 1 ASC LIMIT :__limit"
        compiled.has_rows_limit = True
    compiled.params["__limit"] = query.limit + 1
    return compiled
