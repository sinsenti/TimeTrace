from fastapi import APIRouter, Depends
from sqlmodel import Session as DBSession

from timetrace.db.models import Session as SessionModel
from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import IdleResolveRequest, IdleToggleRequest, TimerSplitRequest, TimerStartRequest
from timetrace.services import TimerService

router = APIRouter(prefix="/timer", tags=["Active Timer"])


@router.get("/status")
def timer_status(db: DBSession = Depends(get_session)):
    return TimerService(db).get_status()


@router.post("/start")
def start_timer(req: TimerStartRequest, db: DBSession = Depends(get_session)):
    return TimerService(db).start_timer(req)


@router.post("/split", response_model=SessionModel)
def split_timer(req: TimerSplitRequest, db: DBSession = Depends(get_session)):
    return TimerService(db).split_timer(req)


@router.post("/stop", response_model=SessionModel)
def stop_timer(db: DBSession = Depends(get_session)):
    return TimerService(db).stop_timer()


# Idle Detection Router
idle_router = APIRouter(prefix="/idle", tags=["Idle Detector"])


@idle_router.post("/toggle")
def toggle_idle_detection(req: IdleToggleRequest, db: DBSession = Depends(get_session)):
    new_state = TimerService(db).toggle_idle_detection(req)
    return {"idle_detection_enabled": new_state}


@idle_router.post("/resolve")
def resolve_idle_gap(req: IdleResolveRequest, db: DBSession = Depends(get_session)):
    return TimerService(db).resolve_idle_gap(req)
