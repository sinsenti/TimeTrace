"""Vocabulary for the structured analytics query engine (statistics dashboards, slice 1).

Pure domain vocabulary: imports only `enum` and `pydantic`, no FastAPI, no SQLAlchemy, no
`sqlmodel.Session`. `AnalyticsQuery` is what a saved dashboard widget will persist as JSON in
slice 2 -- it deliberately excludes request context (timezone, first_day_of_week), which is
per-request, not per-widget. See `interfaces/api/schemas.py` for the request/response envelope
that wraps this, and `core/query_compiler.py` for how it becomes SQL.
"""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class QuerySource(StrEnum):
    SESSIONS = "sessions"
    TASKS = "tasks"
    HABIT_LOGS = "habit_logs"
    DAY_REVIEWS = "day_reviews"
    RATING_ENTRIES = "rating_entries"


class Measure(StrEnum):
    SUM_DURATION = "sum_duration"  # hours
    SESSION_COUNT = "session_count"  # count
    AVG_SESSION_LENGTH = "avg_session_length"  # minutes
    TASK_COUNT = "task_count"  # count
    COMPLETION_RATE = "completion_rate"  # percent
    AVG_RATING = "avg_rating"  # score
    HABIT_COMPLETION_RATE = "habit_completion_rate"  # percent
    ESTIMATION_ACCURACY = "estimation_accuracy"  # percent
    # Addition beyond the settled vocabulary (see plan section 0b): the estimation
    # ratio subtitle ("Tracked: Xh / Est: Yh") needs total *estimated* hours, which
    # no settled measure produces.
    SUM_ESTIMATED_DURATION = "sum_estimated_duration"  # hours


class Dimension(StrEnum):
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    HOUR_OF_DAY = "hour_of_day"
    WEEKDAY = "weekday"
    TAG = "tag"
    CATEGORY = "category"
    TASK = "task"
    STATUS = "status"
    PRIORITY = "priority"
    HABIT = "habit"
    RATING_TYPE = "rating_type"
    # Addition beyond the settled vocabulary (see plan section 0a): the existing
    # Estimation Accuracy doughnut is a per-task derived bucket (accurate /
    # underestimated / overestimated), not any of the settled dimensions. Valid
    # only on source=tasks.
    ESTIMATION_BUCKET = "estimation_bucket"


class FilterField(StrEnum):
    # Every Dimension member is also a valid filter field (same string values).
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    HOUR_OF_DAY = "hour_of_day"
    WEEKDAY = "weekday"
    TAG = "tag"
    CATEGORY = "category"
    TASK = "task"
    STATUS = "status"
    PRIORITY = "priority"
    HABIT = "habit"
    RATING_TYPE = "rating_type"
    ESTIMATION_BUCKET = "estimation_bucket"
    # Plus fields that only make sense as filters, never as a group-by dimension.
    NOTES = "notes"
    TASK_PARENT = "task_parent"
    HAS_TASK = "has_task"
    DURATION_SECONDS = "duration_seconds"
    RATING_SCORE = "rating_score"


class FilterOp(StrEnum):
    EQ = "eq"
    NEQ = "neq"
    IN = "in"
    NOT_IN = "not_in"
    CONTAINS = "contains"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    IS_NULL = "is_null"
    IS_NOT_NULL = "is_not_null"


class ChartType(StrEnum):
    TILE = "tile"
    BAR = "bar"
    LINE = "line"
    DOUGHNUT = "doughnut"
    STACKED_BAR = "stacked_bar"
    TABLE = "table"


class TagAttribution(StrEnum):
    FAN_OUT = "fan_out"
    SPLIT_EVENLY = "split_evenly"


class SortKey(StrEnum):
    VALUE_DESC = "value_desc"
    VALUE_ASC = "value_asc"
    DIMENSION_ASC = "dimension_asc"
    DIMENSION_DESC = "dimension_desc"


class RangePreset(StrEnum):
    ALL_TIME = "all_time"
    TODAY = "today"
    YESTERDAY = "yesterday"
    LAST_7_DAYS = "last_7_days"
    LAST_14_DAYS = "last_14_days"
    LAST_30_DAYS = "last_30_days"
    THIS_WEEK = "this_week"
    THIS_MONTH = "this_month"
    CUSTOM = "custom"


class DateRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preset: RangePreset = RangePreset.ALL_TIME
    start_date: str | None = None  # inclusive LOCAL YYYY-MM-DD, required iff preset=custom
    end_date: str | None = None  # inclusive LOCAL YYYY-MM-DD, required iff preset=custom


class QueryFilter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: FilterField
    op: FilterOp = FilterOp.EQ
    values: list[str | float | bool] = Field(default_factory=list, max_length=200)


class AnalyticsQuery(BaseModel):
    """A saved widget IS one of these. Nothing client-specific belongs in here."""

    model_config = ConfigDict(extra="forbid")

    source: QuerySource
    measure: Measure
    group_by: list[Dimension] = Field(default_factory=list, max_length=2)
    filters: list[QueryFilter] = Field(default_factory=list, max_length=20)
    date_range: DateRange = Field(default_factory=DateRange)
    chart: ChartType = ChartType.BAR
    tag_attribution: TagAttribution = TagAttribution.FAN_OUT
    sort: SortKey = SortKey.VALUE_DESC
    limit: int = Field(default=200, ge=1, le=2000)
    fill_gaps: bool = False
