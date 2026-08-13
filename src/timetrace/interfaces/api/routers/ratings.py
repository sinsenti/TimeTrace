
from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session as DBSession

from timetrace.db.models import RatingDefinition, RatingEntry
from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import RatingDefinitionCreate, RatingDefinitionUpdate, RatingEntryCreate
from timetrace.services import RatingService

router = APIRouter(tags=["Custom Ratings"])


@router.post("/rating-definitions", response_model=RatingDefinition, status_code=status.HTTP_201_CREATED)
def create_rating_definition(req: RatingDefinitionCreate, db: DBSession = Depends(get_session)):
    return RatingService(db).create_definition(req)


@router.get("/rating-definitions", response_model=list[RatingDefinition])
def list_rating_definitions(
    target_type: str | None = Query(None),
    db: DBSession = Depends(get_session)
):
    return RatingService(db).list_definitions(target_type)


@router.put("/rating-definitions/{def_id}", response_model=RatingDefinition)
def update_rating_definition(def_id: int, req: RatingDefinitionUpdate, db: DBSession = Depends(get_session)):
    return RatingService(db).update_definition(def_id, req)


@router.delete("/rating-definitions/{def_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rating_definition(def_id: int, db: DBSession = Depends(get_session)):
    RatingService(db).delete_definition(def_id)
    return None


@router.post("/rating-entries", response_model=RatingEntry, status_code=status.HTTP_201_CREATED)
def create_rating_entry(req: RatingEntryCreate, db: DBSession = Depends(get_session)):
    return RatingService(db).create_entry(req)


@router.get("/rating-entries")
def get_rating_entries(
    target_type: str = Query(...),
    target_id: str | None = Query(None),
    db: DBSession = Depends(get_session)
):
    return RatingService(db).get_entries(target_type, target_id)


@router.delete("/rating-entries", status_code=status.HTTP_204_NO_CONTENT)
def delete_rating_entries(
    target_type: str = Query(...),
    target_id: str = Query(...),
    db: DBSession = Depends(get_session)
):
    RatingService(db).delete_entries(target_type, target_id)
    return None
