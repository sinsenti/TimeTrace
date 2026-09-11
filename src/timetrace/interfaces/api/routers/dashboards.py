"""Persisted statistics dashboards (statistics dashboards, slice 2).

Thin router: every endpoint delegates straight to `DashboardService(db)`. Domain errors
(`EntityNotFoundError` / `ValidationError`) propagate to the handlers registered in `main.py`
-- no `HTTPException` here or in the service.

All path params are `str`: ids are UUIDv7 strings.

`/data` is a POST rather than a GET because the request carries `QueryContextRequest`
(timezone, first day of week) in its body, matching `POST /analytics/query/batch`.
"""

from fastapi import APIRouter, Depends, Response, status
from sqlmodel import Session as DBSession

from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import (
    DashboardCreate,
    DashboardDataResponse,
    DashboardDetailRead,
    DashboardRead,
    DashboardUpdate,
    QueryContextRequest,
    WidgetCreate,
    WidgetRead,
    WidgetReorderRequest,
    WidgetUpdate,
)
from timetrace.services import DashboardService

router = APIRouter(prefix="/api/dashboards", tags=["Statistics Dashboards"])


@router.get("", response_model=list[DashboardRead])
def list_dashboards(db: DBSession = Depends(get_session)):
    return DashboardService(db).list_dashboards()


@router.post("", response_model=DashboardDetailRead, status_code=status.HTTP_201_CREATED)
def create_dashboard(payload: DashboardCreate, db: DBSession = Depends(get_session)):
    return DashboardService(db).create_dashboard(payload.name)


@router.get("/{dashboard_id}", response_model=DashboardDetailRead)
def get_dashboard(dashboard_id: str, db: DBSession = Depends(get_session)):
    return DashboardService(db).get_dashboard_detail(dashboard_id)


@router.put("/{dashboard_id}", response_model=DashboardDetailRead)
def update_dashboard(dashboard_id: str, payload: DashboardUpdate, db: DBSession = Depends(get_session)):
    return DashboardService(db).update_dashboard(dashboard_id, name=payload.name, position=payload.position)


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dashboard(dashboard_id: str, db: DBSession = Depends(get_session)):
    DashboardService(db).delete_dashboard(dashboard_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{dashboard_id}/data", response_model=DashboardDataResponse)
def run_dashboard(dashboard_id: str, context: QueryContextRequest, db: DBSession = Depends(get_session)):
    return DashboardService(db).run_dashboard(dashboard_id, context)


@router.post("/{dashboard_id}/reset", response_model=DashboardDetailRead)
def reset_dashboard(dashboard_id: str, db: DBSession = Depends(get_session)):
    return DashboardService(db).reset_dashboard(dashboard_id)


@router.post("/{dashboard_id}/widgets", response_model=WidgetRead, status_code=status.HTTP_201_CREATED)
def create_widget(dashboard_id: str, payload: WidgetCreate, db: DBSession = Depends(get_session)):
    return DashboardService(db).create_widget(dashboard_id, payload.title, payload.width, payload.spec)


@router.put("/{dashboard_id}/widgets/{widget_id}", response_model=WidgetRead)
def update_widget(
    dashboard_id: str,
    widget_id: str,
    payload: WidgetUpdate,
    db: DBSession = Depends(get_session),
):
    return DashboardService(db).update_widget(
        dashboard_id, widget_id, title=payload.title, width=payload.width, spec=payload.spec
    )


@router.delete("/{dashboard_id}/widgets/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_widget(dashboard_id: str, widget_id: str, db: DBSession = Depends(get_session)):
    DashboardService(db).delete_widget(dashboard_id, widget_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{dashboard_id}/widgets/reorder", response_model=list[WidgetRead])
def reorder_widgets(dashboard_id: str, payload: WidgetReorderRequest, db: DBSession = Depends(get_session)):
    return DashboardService(db).reorder_widgets(dashboard_id, payload.widget_ids)
