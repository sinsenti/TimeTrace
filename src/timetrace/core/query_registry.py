"""Capability tables for the structured query engine.

Data, not logic: which measures / dimensions / filter fields each `QuerySource` supports, plus
the metadata (unit, human label) needed to render a `ColumnSpec` and to back a future
`GET /analytics/capabilities` as a pure projection over these frozen dataclasses.

`core/query_compiler.py` is the only consumer that turns this into SQL; it still owns the actual
join/CTE construction because that genuinely differs per source (recursive tag fan-out for
sessions, the estimation-accuracy CTE for tasks) -- this module only says what is *allowed*.
"""

from dataclasses import dataclass, field
from enum import StrEnum

from timetrace.core.query_spec import Dimension, FilterField, Measure, QuerySource


class TimeAnchorKind(StrEnum):
    UTC_DATETIME = "utc_datetime"  # naive-UTC datetime column -> needs the 'localtime' modifier
    LOCAL_DATE_STRING = "local_date_string"  # already local YYYY-MM-DD -> must NOT get 'localtime'


Unit = str  # "hours" | "minutes" | "count" | "percent" | "score"


@dataclass(frozen=True)
class MeasureSpec:
    measure: Measure
    unit: Unit
    label: str


@dataclass(frozen=True)
class DimensionSpec:
    dimension: Dimension
    label: str


@dataclass(frozen=True)
class FilterSpec:
    field: FilterField
    label: str


@dataclass(frozen=True)
class SourceSpec:
    source: QuerySource
    table: str
    alias: str
    anchor_column: str  # e.g. "s.start_time", unqualified by anchor kind
    anchor_kind: TimeAnchorKind
    measures: dict[Measure, MeasureSpec] = field(default_factory=dict)
    dimensions: dict[Dimension, DimensionSpec] = field(default_factory=dict)
    filter_fields: dict[FilterField, FilterSpec] = field(default_factory=dict)


def _measures(*specs: MeasureSpec) -> dict[Measure, MeasureSpec]:
    return {s.measure: s for s in specs}


def _dimensions(*specs: DimensionSpec) -> dict[Dimension, DimensionSpec]:
    return {s.dimension: s for s in specs}


def _filters(*specs: FilterSpec) -> dict[FilterField, FilterSpec]:
    return {s.field: s for s in specs}


# Time dimensions common to every UTC_DATETIME-anchored source.
_UTC_TIME_DIMS = (
    DimensionSpec(Dimension.DAY, "Day"),
    DimensionSpec(Dimension.WEEK, "Week"),
    DimensionSpec(Dimension.MONTH, "Month"),
    DimensionSpec(Dimension.HOUR_OF_DAY, "Hour of day"),
    DimensionSpec(Dimension.WEEKDAY, "Weekday"),
)

# Time dimensions for a LOCAL_DATE_STRING-anchored source: no hour_of_day (meaningless on a
# date-only value).
_LOCAL_DATE_TIME_DIMS = (
    DimensionSpec(Dimension.DAY, "Day"),
    DimensionSpec(Dimension.WEEK, "Week"),
    DimensionSpec(Dimension.MONTH, "Month"),
    DimensionSpec(Dimension.WEEKDAY, "Weekday"),
)

_UTC_TIME_FILTERS = (
    FilterSpec(FilterField.DAY, "Day"),
    FilterSpec(FilterField.WEEK, "Week"),
    FilterSpec(FilterField.MONTH, "Month"),
    FilterSpec(FilterField.HOUR_OF_DAY, "Hour of day"),
    FilterSpec(FilterField.WEEKDAY, "Weekday"),
)

_LOCAL_DATE_FILTERS = (
    FilterSpec(FilterField.DAY, "Day"),
    FilterSpec(FilterField.WEEK, "Week"),
    FilterSpec(FilterField.MONTH, "Month"),
    FilterSpec(FilterField.WEEKDAY, "Weekday"),
)


SOURCES: dict[QuerySource, SourceSpec] = {
    QuerySource.SESSIONS: SourceSpec(
        source=QuerySource.SESSIONS,
        table="session",
        alias="s",
        anchor_column="s.start_time",
        anchor_kind=TimeAnchorKind.UTC_DATETIME,
        measures=_measures(
            MeasureSpec(Measure.SUM_DURATION, "hours", "Total duration"),
            MeasureSpec(Measure.SESSION_COUNT, "count", "Session count"),
            MeasureSpec(Measure.AVG_SESSION_LENGTH, "minutes", "Avg session length"),
            MeasureSpec(Measure.AVG_RATING, "score", "Avg rating"),
        ),
        dimensions=_dimensions(
            *_UTC_TIME_DIMS,
            DimensionSpec(Dimension.TAG, "Tag"),
            DimensionSpec(Dimension.CATEGORY, "Category"),
            DimensionSpec(Dimension.TASK, "Task"),
            DimensionSpec(Dimension.STATUS, "Status"),
            DimensionSpec(Dimension.PRIORITY, "Priority"),
        ),
        filter_fields=_filters(
            *_UTC_TIME_FILTERS,
            FilterSpec(FilterField.TAG, "Tag"),
            FilterSpec(FilterField.CATEGORY, "Category"),
            FilterSpec(FilterField.TASK, "Task"),
            FilterSpec(FilterField.STATUS, "Status"),
            FilterSpec(FilterField.PRIORITY, "Priority"),
            FilterSpec(FilterField.NOTES, "Notes"),
            FilterSpec(FilterField.HAS_TASK, "Has task"),
            FilterSpec(FilterField.DURATION_SECONDS, "Duration (seconds)"),
            FilterSpec(FilterField.TASK_PARENT, "Parent task"),
        ),
    ),
    QuerySource.TASKS: SourceSpec(
        source=QuerySource.TASKS,
        table="task",
        alias="t",
        anchor_column="t.created_at",
        anchor_kind=TimeAnchorKind.UTC_DATETIME,
        measures=_measures(
            MeasureSpec(Measure.TASK_COUNT, "count", "Task count"),
            MeasureSpec(Measure.COMPLETION_RATE, "percent", "Completion rate"),
            MeasureSpec(Measure.AVG_RATING, "score", "Avg rating"),
            MeasureSpec(Measure.ESTIMATION_ACCURACY, "percent", "Estimation accuracy"),
            MeasureSpec(Measure.SUM_ESTIMATED_DURATION, "hours", "Total estimated duration"),
        ),
        dimensions=_dimensions(
            *_UTC_TIME_DIMS,
            DimensionSpec(Dimension.CATEGORY, "Category"),
            DimensionSpec(Dimension.STATUS, "Status"),
            DimensionSpec(Dimension.PRIORITY, "Priority"),
            DimensionSpec(Dimension.ESTIMATION_BUCKET, "Estimation bucket"),
        ),
        filter_fields=_filters(
            *_UTC_TIME_FILTERS,
            FilterSpec(FilterField.CATEGORY, "Category"),
            FilterSpec(FilterField.STATUS, "Status"),
            FilterSpec(FilterField.PRIORITY, "Priority"),
            FilterSpec(FilterField.TASK_PARENT, "Parent task"),
            FilterSpec(FilterField.ESTIMATION_BUCKET, "Estimation bucket"),
        ),
    ),
    QuerySource.HABIT_LOGS: SourceSpec(
        source=QuerySource.HABIT_LOGS,
        table="habitlog",
        alias="hl",
        anchor_column="hl.date_str",
        anchor_kind=TimeAnchorKind.LOCAL_DATE_STRING,
        measures=_measures(
            MeasureSpec(Measure.HABIT_COMPLETION_RATE, "percent", "Habit completion rate"),
        ),
        dimensions=_dimensions(
            *_LOCAL_DATE_TIME_DIMS,
            DimensionSpec(Dimension.HABIT, "Habit"),
        ),
        filter_fields=_filters(
            *_LOCAL_DATE_FILTERS,
            FilterSpec(FilterField.HABIT, "Habit"),
        ),
    ),
    QuerySource.DAY_REVIEWS: SourceSpec(
        source=QuerySource.DAY_REVIEWS,
        table="dayreview",
        alias="dr",
        anchor_column="dr.date_str",
        anchor_kind=TimeAnchorKind.LOCAL_DATE_STRING,
        measures=_measures(
            MeasureSpec(Measure.AVG_RATING, "score", "Avg day rating"),
        ),
        dimensions=_dimensions(*_LOCAL_DATE_TIME_DIMS),
        filter_fields=_filters(*_LOCAL_DATE_FILTERS),
    ),
    QuerySource.RATING_ENTRIES: SourceSpec(
        source=QuerySource.RATING_ENTRIES,
        table="ratingentry",
        alias="re",
        anchor_column="re.created_at",
        anchor_kind=TimeAnchorKind.UTC_DATETIME,
        measures=_measures(
            MeasureSpec(Measure.AVG_RATING, "score", "Avg rating"),
        ),
        dimensions=_dimensions(
            *_UTC_TIME_DIMS,
            DimensionSpec(Dimension.RATING_TYPE, "Rating type"),
        ),
        filter_fields=_filters(
            *_UTC_TIME_FILTERS,
            FilterSpec(FilterField.RATING_TYPE, "Rating type"),
            FilterSpec(FilterField.RATING_SCORE, "Score"),
        ),
    ),
}
