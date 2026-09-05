"""Persisted statistics dashboards (statistics dashboards, slice 2).

Owns everything about dashboards and widgets: seeding, slugs, ordering, spec validation, and
running a whole dashboard in one pass. The router is a thin delegation layer over this class.

Two rules worth stating up front, because both are easy to "fix" into a bug:

  * **Seeding is keyed on "zero dashboards exist", not on "the Overview widgets are all
    present".** Deleting a seeded widget must not resurrect it on the next page load. The
    only way Overview comes back is an empty dashboard table -- which does mean deleting your
    single last dashboard recreates Overview on the next list call. That is deliberate: the
    page always has something on it, and nothing is silently resurrected while any dashboard
    still exists.
  * **Every write validates the spec by running it.** `spec_json` is opaque to the DB, so a
    spec that cannot compile would otherwise persist happily and fail forever at render time.
"""

import json
import re
from datetime import UTC, datetime

from pydantic import TypeAdapter
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, select

from timetrace.core.dashboard_seeds import OVERVIEW_NAME, OVERVIEW_SEED, OVERVIEW_SLUG
from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.db.models import Dashboard, DashboardWidget
from timetrace.interfaces.api.schemas import (
    AnalyticsQueryResponse,
    DashboardDataResponse,
    DashboardDetailRead,
    DashboardRead,
    QueryContextRequest,
    SqlQueryResponse,
    SqlWidgetSpec,
    StructuredWidgetSpec,
    WidgetRead,
    WidgetSpec,
)
from timetrace.services.query_service import QueryService
from timetrace.services.sql_query_service import SqlQueryService

_WIDGET_SPEC_ADAPTER: TypeAdapter[WidgetSpec] = TypeAdapter(WidgetSpec)


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "dashboard"


def _now() -> datetime:
    """Naive UTC, matching every other timestamp column in this schema."""
    return datetime.now(UTC).replace(tzinfo=None)


class DashboardService:
    def __init__(self, db: Session):
        self.db = db

    # -- seeding ----------------------------------------------------------------------

    def ensure_seeded(self) -> None:
        """Create the Overview dashboard iff the dashboard table is completely empty.

        Called from `list_dashboards()` rather than a lifespan hook, so a fresh database
        self-heals on the first `/stats` visit and the daemon has no boot-time DB write. Two
        concurrent first-loads can both see a zero count before either commits; the loser's
        `ix_dashboard_slug` UNIQUE insert then fails, which is fine -- the winner already
        seeded it, so this just rolls back and moves on rather than surfacing a 500.
        """
        count = self.db.exec(select(func.count()).select_from(Dashboard)).one()
        if count:
            return

        dashboard = Dashboard(name=OVERVIEW_NAME, slug=OVERVIEW_SLUG, is_seeded=True, position=0)
        self.db.add(dashboard)
        try:
            self.db.flush()
            self._add_seed_widgets(dashboard)
            self.db.commit()
        except IntegrityError:
            self.db.rollback()

    def _add_seed_widgets(self, dashboard: Dashboard) -> None:
        for i, seed in enumerate(OVERVIEW_SEED):
            self.db.add(
                DashboardWidget(
                    dashboard_id=dashboard.id,
                    title=seed.title,
                    width=seed.width,
                    position=i,
                    spec_json=StructuredWidgetSpec(query=seed.query).model_dump_json(),
                    seed_key=seed.seed_key,
                )
            )

    # -- dashboards -------------------------------------------------------------------

    def list_dashboards(self) -> list[DashboardRead]:
        self.ensure_seeded()
        dashboards = self.db.exec(select(Dashboard).order_by(Dashboard.position, Dashboard.created_at)).all()
        return [self._to_read(d) for d in dashboards]

    def get_dashboard(self, dashboard_id: str) -> Dashboard:
        dashboard = self.db.get(Dashboard, dashboard_id)
        if not dashboard:
            raise EntityNotFoundError("Dashboard", dashboard_id)
        return dashboard

    def get_dashboard_by_slug(self, slug: str) -> Dashboard:
        dashboard = self.db.exec(select(Dashboard).where(Dashboard.slug == slug)).first()
        if not dashboard:
            raise EntityNotFoundError("Dashboard", slug)
        return dashboard

    def get_dashboard_detail(self, dashboard_id: str) -> DashboardDetailRead:
        return self._to_detail(self.get_dashboard(dashboard_id))

    def create_dashboard(self, name: str) -> DashboardDetailRead:
        clean = (name or "").strip()
        if not clean:
            raise ValidationError("Dashboard name is required.")

        max_position = self.db.exec(select(func.max(Dashboard.position))).one()
        dashboard = Dashboard(
            name=clean,
            slug=self._unique_slug(_slugify(clean)),
            is_seeded=False,
            position=(max_position or 0) + 1 if max_position is not None else 0,
        )
        self.db.add(dashboard)
        self.db.commit()
        self.db.refresh(dashboard)
        return self._to_detail(dashboard)

    def _unique_slug(self, base: str) -> str:
        # sqlmodel's exec() on a single-column select yields scalars, not 1-tuples.
        existing = set(self.db.exec(select(Dashboard.slug)).all())
        if base not in existing:
            return base
        n = 2
        while f"{base}-{n}" in existing:
            n += 1
        return f"{base}-{n}"

    def update_dashboard(
        self, dashboard_id: str, name: str | None = None, position: int | None = None
    ) -> DashboardDetailRead:
        dashboard = self.get_dashboard(dashboard_id)

        if name is not None:
            clean = name.strip()
            if not clean:
                raise ValidationError("Dashboard name cannot be empty.")
            dashboard.name = clean
        if position is not None:
            dashboard.position = position

        dashboard.updated_at = _now()
        self.db.add(dashboard)
        self.db.commit()
        self.db.refresh(dashboard)
        return self._to_detail(dashboard)

    def delete_dashboard(self, dashboard_id: str) -> None:
        """Delete any dashboard, Overview included.

        Overview is not special-cased: it comes back only if this leaves the table empty
        (see `ensure_seeded`). Deleting it while other dashboards exist just deletes it.
        """
        dashboard = self.get_dashboard(dashboard_id)
        self.db.delete(dashboard)
        self.db.commit()

    def reset_dashboard(self, dashboard_id: str) -> DashboardDetailRead:
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard.is_seeded:
            raise ValidationError("Only the seeded dashboard can be reset to its default widgets.")

        for widget in self._widgets_of(dashboard_id):
            self.db.delete(widget)
        self.db.flush()
        self._add_seed_widgets(dashboard)
        dashboard.updated_at = _now()
        self.db.add(dashboard)
        self.db.commit()
        self.db.refresh(dashboard)
        return self._to_detail(dashboard)

    # -- widgets ----------------------------------------------------------------------

    def create_widget(self, dashboard_id: str, title: str, width: str, spec: WidgetSpec) -> WidgetRead:
        self.get_dashboard(dashboard_id)
        self._validate_spec(spec)

        max_position = self.db.exec(
            select(func.max(DashboardWidget.position)).where(DashboardWidget.dashboard_id == dashboard_id)
        ).one()
        widget = DashboardWidget(
            dashboard_id=dashboard_id,
            title=title.strip() or "Widget",
            width=width,
            position=(max_position + 1) if max_position is not None else 0,
            spec_json=spec.model_dump_json(),
        )
        self.db.add(widget)
        self.db.commit()
        self.db.refresh(widget)
        return self._widget_to_read(widget)

    def update_widget(
        self,
        dashboard_id: str,
        widget_id: str,
        title: str | None = None,
        width: str | None = None,
        spec: WidgetSpec | None = None,
    ) -> WidgetRead:
        widget = self._get_widget(dashboard_id, widget_id)

        if title is not None:
            clean = title.strip()
            if not clean:
                raise ValidationError("Widget title cannot be empty.")
            widget.title = clean
        if width is not None:
            widget.width = width
        if spec is not None:
            self._validate_spec(spec)
            widget.spec_json = spec.model_dump_json()

        widget.updated_at = _now()
        self.db.add(widget)
        self.db.commit()
        self.db.refresh(widget)
        return self._widget_to_read(widget)

    def delete_widget(self, dashboard_id: str, widget_id: str) -> None:
        widget = self._get_widget(dashboard_id, widget_id)
        self.db.delete(widget)
        self.db.commit()

    def reorder_widgets(self, dashboard_id: str, widget_ids: list[str]) -> list[WidgetRead]:
        """Full ordered replacement: `widget_ids` must be exactly this dashboard's widgets.

        Not a pairwise swap. Requiring the complete set means a stale client (one that missed
        a concurrent add or delete) is rejected outright instead of writing a half-order that
        leaves two widgets sharing a position.
        """
        self.get_dashboard(dashboard_id)
        widgets = self._widgets_of(dashboard_id)
        actual = {w.id for w in widgets}
        given = set(widget_ids)

        if len(widget_ids) != len(given):
            raise ValidationError("widget_ids contains duplicates.")
        if given != actual:
            raise ValidationError(
                "widget_ids must list exactly the widgets on this dashboard "
                f"({len(actual)} widgets); reload the dashboard and try again."
            )

        by_id = {w.id: w for w in widgets}
        now = _now()
        for position, widget_id in enumerate(widget_ids):
            widget = by_id[widget_id]
            widget.position = position
            widget.updated_at = now
            self.db.add(widget)
        self.db.commit()
        return [self._widget_to_read(w) for w in self._widgets_of(dashboard_id)]

    # -- running ----------------------------------------------------------------------

    def run_dashboard(self, dashboard_id: str, context: QueryContextRequest) -> DashboardDataResponse:
        dashboard = self.get_dashboard(dashboard_id)
        widgets = self._widgets_of(dashboard_id)

        query_service = QueryService(self.db)
        sql_service = SqlQueryService(self.db)

        reads: list[WidgetRead] = []
        results: dict[str, AnalyticsQueryResponse] = {}
        sql_results: dict[str, SqlQueryResponse] = {}
        errors: dict[str, str] = {}

        for widget in widgets:
            read = self._widget_to_read(widget)
            reads.append(read)

            if read.spec is None:
                errors[widget.id] = "This widget's saved definition could not be read."
                continue

            # Per-widget isolation, same contract as QueryService.run_batch: one broken
            # widget reports its own error and the rest of the dashboard still renders.
            try:
                if isinstance(read.spec, StructuredWidgetSpec):
                    results[widget.id] = query_service.run(read.spec.query, context)
                else:
                    sql_results[widget.id] = sql_service.run(read.spec.sql)
            except ValidationError as e:
                errors[widget.id] = str(e)
            except Exception as e:  # noqa: BLE001 - a widget must never 500 the dashboard
                errors[widget.id] = f"Unexpected error: {e}"

        return DashboardDataResponse(
            dashboard=self._to_read(dashboard),
            widgets=reads,
            results=results,
            sql_results=sql_results,
            errors=errors,
        )

    # -- internals --------------------------------------------------------------------

    def _validate_spec(self, spec: WidgetSpec) -> None:
        """Prove a spec is runnable before it is allowed to persist.

        Structured specs are compiled and executed once (cheap, and the only way to catch
        combinations the compiler rejects, e.g. hour_of_day on a date-only source). SQL specs
        go through the same guard + sandbox the render path uses, so a query that would be
        denied at render time is refused at save time instead.
        """
        context = QueryContextRequest()
        if isinstance(spec, StructuredWidgetSpec):
            QueryService(self.db).run(spec.query, context)
        elif isinstance(spec, SqlWidgetSpec):
            SqlQueryService(self.db).run(spec.sql)
        else:  # pragma: no cover - the discriminated union admits nothing else
            raise ValidationError("Unknown widget spec mode.")

    def _get_widget(self, dashboard_id: str, widget_id: str) -> DashboardWidget:
        widget = self.db.get(DashboardWidget, widget_id)
        if not widget or widget.dashboard_id != dashboard_id:
            raise EntityNotFoundError("Dashboard widget", widget_id)
        return widget

    def _widgets_of(self, dashboard_id: str) -> list[DashboardWidget]:
        # ORDER BY position, never id: a seeding pass mints every widget inside the same
        # millisecond and uuid7 is only coarsely monotonic at that resolution.
        return list(
            self.db.exec(
                select(DashboardWidget)
                .where(DashboardWidget.dashboard_id == dashboard_id)
                .order_by(DashboardWidget.position, DashboardWidget.created_at)
            ).all()
        )

    def _widget_count(self, dashboard_id: str) -> int:
        return self.db.exec(
            select(func.count()).select_from(DashboardWidget).where(DashboardWidget.dashboard_id == dashboard_id)
        ).one()

    def _to_read(self, dashboard: Dashboard) -> DashboardRead:
        return DashboardRead(
            id=dashboard.id,
            name=dashboard.name,
            slug=dashboard.slug,
            is_seeded=dashboard.is_seeded,
            position=dashboard.position,
            widget_count=self._widget_count(dashboard.id),
            created_at=dashboard.created_at,
            updated_at=dashboard.updated_at,
        )

    def _to_detail(self, dashboard: Dashboard) -> DashboardDetailRead:
        base = self._to_read(dashboard)
        return DashboardDetailRead(
            **base.model_dump(),
            widgets=[self._widget_to_read(w) for w in self._widgets_of(dashboard.id)],
        )

    def _widget_to_read(self, widget: DashboardWidget) -> WidgetRead:
        return WidgetRead(
            id=widget.id,
            dashboard_id=widget.dashboard_id,
            title=widget.title,
            width=widget.width if widget.width in ("half", "full") else "half",
            position=widget.position,
            seed_key=widget.seed_key,
            spec=self._parse_spec(widget.spec_json),
            created_at=widget.created_at,
            updated_at=widget.updated_at,
        )

    def _parse_spec(self, spec_json: str) -> WidgetSpec | None:
        """Decode `spec_json`, returning None rather than raising on anything unreadable.

        A row written by a newer version (or hand-edited) must degrade to one broken widget
        card reporting an error, never a 500 that takes the whole dashboard down with it.
        """
        try:
            return _WIDGET_SPEC_ADAPTER.validate_python(json.loads(spec_json))
        except json.JSONDecodeError, PydanticValidationError, TypeError:
            return None
