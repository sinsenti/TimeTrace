from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session as DBSession, select
from typing import List, Optional

from timetrace.db.session import get_session
from timetrace.db.models import RatingDefinition, RatingEntry
from timetrace.interfaces.api.schemas import RatingDefinitionCreate, RatingDefinitionUpdate, RatingEntryCreate

router = APIRouter(tags=["Custom Ratings"])


@router.post("/rating-definitions", response_model=RatingDefinition, status_code=status.HTTP_201_CREATED)
def create_rating_definition(req: RatingDefinitionCreate, db: DBSession = Depends(get_session)):
    db_def = RatingDefinition.model_validate(req.model_dump())
    db.add(db_def)
    db.commit()
    db.refresh(db_def)
    return db_def


@router.get("/rating-definitions", response_model=List[RatingDefinition])
def list_rating_definitions(
    target_type: Optional[str] = Query(None),
    db: DBSession = Depends(get_session)
):
    query = select(RatingDefinition)
    if target_type:
        query = query.where(RatingDefinition.target_type == target_type)
    return db.exec(query).all()


@router.put("/rating-definitions/{def_id}", response_model=RatingDefinition)
def update_rating_definition(def_id: int, req: RatingDefinitionUpdate, db: DBSession = Depends(get_session)):
    db_def = db.get(RatingDefinition, def_id)
    if not db_def:
        raise HTTPException(status_code=404, detail="Rating definition not found")
    
    update_dict = req.model_dump(exclude_unset=True)
    for k, v in update_dict.items():
        setattr(db_def, k, v)
    
    db.add(db_def)
    db.commit()
    db.refresh(db_def)
    return db_def


@router.delete("/rating-definitions/{def_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rating_definition(def_id: int, db: DBSession = Depends(get_session)):
    db_def = db.get(RatingDefinition, def_id)
    if not db_def:
        raise HTTPException(status_code=404, detail="Rating definition not found")
    
    entries = db.exec(select(RatingEntry).where(RatingEntry.rating_definition_id == def_id)).all()
    for entry in entries:
        db.delete(entry)
        
    db.delete(db_def)
    db.commit()
    return None


@router.post("/rating-entries", response_model=RatingEntry, status_code=status.HTTP_201_CREATED)
def create_rating_entry(req: RatingEntryCreate, db: DBSession = Depends(get_session)):
    db_def = db.get(RatingDefinition, req.rating_definition_id)
    if not db_def:
        raise HTTPException(status_code=404, detail="Rating definition ID not found")

    if not req.dismissed and req.score is not None:
        if req.score < db_def.min_score or req.score > db_def.max_score:
            raise HTTPException(
                status_code=400,
                detail=f"Score must be between {db_def.min_score} and {db_def.max_score}"
            )

    existing = db.exec(
        select(RatingEntry).where(
            RatingEntry.rating_definition_id == req.rating_definition_id,
            RatingEntry.target_type == req.target_type,
            RatingEntry.target_id == str(req.target_id)
        )
    ).first()

    effective_score = req.score if req.score is not None else 0

    if existing:
        existing.score = effective_score
        existing.dismissed = req.dismissed
        existing.notes = req.notes
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing
    else:
        entry_dict = req.model_dump()
        entry_dict["score"] = effective_score
        entry_dict["target_id"] = str(req.target_id)
        entry = RatingEntry.model_validate(entry_dict)
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry


@router.get("/rating-entries")
def get_rating_entries(
    target_type: str = Query(...),
    target_id: Optional[str] = Query(None),
    db: DBSession = Depends(get_session)
):
    query = select(RatingEntry).where(RatingEntry.target_type == target_type)
    if target_id and target_id != "all":
        query = query.where(RatingEntry.target_id == str(target_id))
    
    entries = db.exec(query).all()

    result = []
    for e in entries:
        r_def = db.get(RatingDefinition, e.rating_definition_id)
        e_dict = e.model_dump()
        e_dict["definition"] = r_def.model_dump() if r_def else None
        result.append(e_dict)
    return result


@router.delete("/rating-entries", status_code=status.HTTP_204_NO_CONTENT)
def delete_rating_entries(
    target_type: str = Query(...),
    target_id: str = Query(...),
    db: DBSession = Depends(get_session)
):
    entries = db.exec(
        select(RatingEntry).where(
            RatingEntry.target_type == target_type,
            RatingEntry.target_id == str(target_id)
        )
    ).all()
    for entry in entries:
        db.delete(entry)
    db.commit()
    return None
