"""The seeded "Overview" dashboard, as data.

These are the eight charts the hardcoded `/stats` page used to draw, transcribed out of
`static/js/dashboards.js`'s former `OVERVIEW_SEED` array into real `AnalyticsQuery` objects.
Transcribing them here rather than leaving them in JS is free validation: a typo in a measure
or dimension name is now a Pydantic error at import time instead of a widget that silently
fails to load in the browser.

Pure module: imports only `dataclasses` and `core/query_spec.py` -- no FastAPI, no DB. The
service layer (`services/dashboard_service.py`) is what turns a `SeedWidget` into a
`DashboardWidget` row.

`seed_key` is a stable identifier for "which seeded widget is this", carried onto the row so
the frontend can attach the presentation extras that don't belong in a query spec (accent
color, badge text, the estimation tile's "Tracked: Xh / Est: Yh" subtitle, and which
drilldown a click opens). It is NULL for anything the user builds themselves.
"""

from dataclasses import dataclass

from timetrace.core.query_spec import (
    AnalyticsQuery,
    ChartType,
    DateRange,
    Dimension,
    Measure,
    QuerySource,
    RangePreset,
    SortKey,
    TagAttribution,
)

OVERVIEW_SLUG = "overview"
OVERVIEW_NAME = "Overview"


@dataclass(frozen=True)
class SeedWidget:
    seed_key: str
    title: str
    width: str  # "half" | "full"
    query: AnalyticsQuery


OVERVIEW_SEED: tuple[SeedWidget, ...] = (
    SeedWidget(
        seed_key="total_time",
        title="Total Time Logged",
        width="half",
        query=AnalyticsQuery(
            source=QuerySource.SESSIONS,
            measure=Measure.SUM_DURATION,
            chart=ChartType.TILE,
        ),
    ),
    SeedWidget(
        seed_key="total_sessions",
        title="Logged Sessions",
        width="half",
        query=AnalyticsQuery(
            source=QuerySource.SESSIONS,
            measure=Measure.SESSION_COUNT,
            chart=ChartType.TILE,
        ),
    ),
    SeedWidget(
        seed_key="total_tasks",
        title="Total Tasks",
        width="half",
        query=AnalyticsQuery(
            source=QuerySource.TASKS,
            measure=Measure.TASK_COUNT,
            chart=ChartType.TILE,
        ),
    ),
    SeedWidget(
        seed_key="estimation_score",
        title="Estimation Score",
        width="half",
        query=AnalyticsQuery(
            source=QuerySource.TASKS,
            measure=Measure.ESTIMATION_ACCURACY,
            chart=ChartType.TILE,
        ),
    ),
    # The estimation tile's subtitle needs total *estimated* hours, which no other widget
    # produces. It used to be an extra out-of-band query key ("est_total_hours") bolted onto
    # the batch call; as a real widget it is a normal, deletable tile of its own.
    SeedWidget(
        seed_key="est_total_hours",
        title="Total Estimated",
        width="half",
        query=AnalyticsQuery(
            source=QuerySource.TASKS,
            measure=Measure.SUM_ESTIMATED_DURATION,
            chart=ChartType.TILE,
        ),
    ),
    SeedWidget(
        seed_key="estimation_breakdown",
        title="Estimation Accuracy Breakdown",
        width="half",
        query=AnalyticsQuery(
            source=QuerySource.TASKS,
            measure=Measure.TASK_COUNT,
            group_by=[Dimension.ESTIMATION_BUCKET],
            chart=ChartType.DOUGHNUT,
            sort=SortKey.DIMENSION_ASC,
        ),
    ),
    SeedWidget(
        seed_key="daily_trend",
        title="Daily Focus Trend (last 14 days)",
        width="half",
        query=AnalyticsQuery(
            source=QuerySource.SESSIONS,
            measure=Measure.SUM_DURATION,
            group_by=[Dimension.DAY],
            chart=ChartType.BAR,
            sort=SortKey.DIMENSION_ASC,
            fill_gaps=True,
            date_range=DateRange(preset=RangePreset.LAST_14_DAYS),
        ),
    ),
    SeedWidget(
        seed_key="peak_hours",
        title="Peak Focus Hours (24h distribution)",
        width="half",
        query=AnalyticsQuery(
            source=QuerySource.SESSIONS,
            measure=Measure.SUM_DURATION,
            group_by=[Dimension.HOUR_OF_DAY],
            chart=ChartType.BAR,
            sort=SortKey.DIMENSION_ASC,
            fill_gaps=True,
        ),
    ),
    SeedWidget(
        seed_key="tags_breakdown",
        title="Activity Breakdown (#tags)",
        width="half",
        query=AnalyticsQuery(
            source=QuerySource.SESSIONS,
            measure=Measure.SUM_DURATION,
            group_by=[Dimension.TAG],
            chart=ChartType.DOUGHNUT,
            sort=SortKey.VALUE_DESC,
            tag_attribution=TagAttribution.FAN_OUT,
        ),
    ),
)
