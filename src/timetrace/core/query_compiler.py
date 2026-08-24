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
from datetime import datetime

from timetrace.core.exceptions import ValidationError
from timetrace.core.query_registry import SOURCES, TimeAnchorKind
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


@dataclass
class CompiledQuery:
    sql: str
    params: dict[str, object] = field(default_factory=dict)
    group_by: list[Dimension] = field(default_factory=list)
    measure: Measure = Measure.SUM_DURATION
    source: QuerySource = QuerySource.SESSIONS
    has_rows_limit: bool = False  # False for a tile (no GROUP BY, exactly one row)
    totals_overlap: bool = False


# ---------------------------------------------------------------------------
# Time dimension fragments
# ---------------------------------------------------------------------------


def _time_dimension_sql(dim: Dimension, anchor: str, anchor_kind: TimeAnchorKind) -> str:
    localtime = anchor_kind == TimeAnchorKind.UTC_DATETIME
    mod = ", 'localtime'" if localtime else ""

    if dim == Dimension.DAY:
        return f"DATE({anchor}{mod})"
    if dim == Dimension.WEEK:
        # '-6 days' THEN 'weekday N' is required. The tempting 'weekday N','-7 days'
        # form is off by a whole week whenever the local date already IS weekday N
        # (probed: local Mon 2026-08-10 with N=1 returns 2026-08-03).
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
# Non-time dimension / filter columns, per source. `None` means "not directly
# selectable here" (tag is handled by the recursive CTE, estimation_bucket by
# the estimation CTE prelude).
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
        Dimension.ESTIMATION_BUCKET: None,  # only inside the estimation CTE, see _compile_tasks
    },
    QuerySource.HABIT_LOGS: {
        Dimension.HABIT: "hl.habit_id",
    },
    QuerySource.DAY_REVIEWS: {},
    QuerySource.RATING_ENTRIES: {
        Dimension.RATING_TYPE: "rd.name",
    },
}

# Same idea for filters -- FilterField shares string values with the matching Dimension for
# every field that is valid as both a group-by and a filter.
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
) -> tuple[list[str], dict[str, object]]:
    conditions: list[str] = []
    params: dict[str, object] = {}

    for i, f in enumerate(filters):
        if f.field == FilterField.TAG:
            # Tag filtering is handled by the caller (needs the recursive fan-out CTE).
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

# `weight` (sessions only) is the per-row duration in seconds credited to a bucket. On the
# non-tag path it's the session's own duration; on the tag fan-out path (see below) the same
# session may be repeated once per tag with `weight` divided per the chosen attribution mode.
_SESSION_MEASURE_SQL: dict[Measure, str] = {
    Measure.SUM_DURATION: "SUM(weight) / 3600.0",
    Measure.SESSION_COUNT: "COUNT(*)",
    Measure.AVG_SESSION_LENGTH: "SUM(weight) / COUNT(*) / 60.0",
    # AVG_RATING is handled specially below -- it needs a join, not just `weight`.
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
    filt_sql, filt_params = _build_filter_clause(QuerySource.SESSIONS, non_tag_filters, anchor, anchor_kind, "s")
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
    # `ts` inside the CTEs below stands in for `s.start_time` -- the anchor column, once we're
    # selecting from the CTE chain rather than the `session` table directly.
    conditions, params = _sessions_base_where(query, ctx, "s.start_time", anchor_kind)
    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    # This recursive CTE is a full, unindexable scan over every session in range, tokenizing
    # `tags` on the fly. Fine at current data volumes; revisit if the sessions table grows large.
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

    group_cols = []
    for dim in query.group_by:
        if dim == Dimension.TAG:
            group_cols.append("tag")
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

_IS_DONE_SQL = (
    # Deliberate: `status` (free text) and `status_id` (FK to a user-configurable list) aren't
    # guaranteed to agree -- the FK wins where it's set, matching how the rest of the app treats
    # these two fields as loosely, not strictly, synced.
    "(COALESCE(ts.is_completed, 0) = 1 OR LOWER(COALESCE(t.status, '')) IN ('done', 'completed'))"
)

# COALESCE(t.estimated_minutes, 15) reproduces Python's `t.get("estimated_minutes") or 15` for
# the common case (column is NULL), but NOT for an explicit `0` -- Python's `or` would still
# fall back to 15 there, COALESCE would not. Pre-existing, latent divergence; not fixed here.
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

    filt_sql, filt_params = _build_filter_clause(QuerySource.TASKS, query.filters, anchor, anchor_kind, "t")
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
    filt_sql, filt_params = _build_filter_clause(QuerySource.TASKS, non_estimation_filters, anchor, anchor_kind, "t")
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
    WHERE LOWER(COALESCE(status, '')) <> 'ongoing' AND act_secs > 0
)
""".strip()

    # `estimation_bucket` isn't in `_NON_TIME_FILTER_SQL` (it only exists inside this CTE), so
    # build its condition directly instead of routing through the generic helper's column lookup.
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
        # Deliberate divergence from the Python reference implementation: it returns 100.0 when
        # zero tasks were evaluated. This engine returns no rows / value=None instead so the
        # tile renders "n/a" client-side rather than a misleading "100%".
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

    # measure=task_count, group_by=[estimation_bucket] (the only other supported combination here)
    group_cols = []
    for dim in query.group_by:
        if dim == Dimension.ESTIMATION_BUCKET:
            group_cols.append("estimation_bucket")
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

    filt_sql, filt_params = _build_filter_clause(QuerySource.HABIT_LOGS, query.filters, anchor, anchor_kind, "hl")
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

    filt_sql, filt_params = _build_filter_clause(QuerySource.DAY_REVIEWS, query.filters, anchor, anchor_kind, "dr")
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

    filt_sql, filt_params = _build_filter_clause(QuerySource.RATING_ENTRIES, query.filters, anchor, anchor_kind, "re")
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

_COMPILERS = {
    QuerySource.SESSIONS: _compile_sessions,
    QuerySource.TASKS: _compile_tasks,
    QuerySource.HABIT_LOGS: _compile_habit_logs,
    QuerySource.DAY_REVIEWS: _compile_day_reviews,
    QuerySource.RATING_ENTRIES: _compile_rating_entries,
}


def validate_query(query: AnalyticsQuery) -> None:
    """Structural validation against the capability registry, independent of compilation."""
    source_spec = SOURCES.get(query.source)
    if source_spec is None:
        raise ValidationError(f"Unknown source: {query.source}")

    if query.measure not in source_spec.measures:
        raise ValidationError(f"Measure {query.measure} is not supported for source {query.source}")

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
    compiled.params["__limit"] = query.limit + 1
    return compiled
