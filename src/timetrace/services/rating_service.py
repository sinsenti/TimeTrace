from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.db.models import RatingDefinition, RatingEntry
from timetrace.interfaces.api.schemas import RatingDefinitionCreate, RatingDefinitionUpdate, RatingEntryCreate


class RatingService:
    def __init__(self, db: Session):
        self.db = db

    def create_definition(self, req: RatingDefinitionCreate) -> RatingDefinition:
        db_def = RatingDefinition.model_validate(req.model_dump())
        self.db.add(db_def)
        self.db.commit()
        self.db.refresh(db_def)
        return db_def

    def list_definitions(self, target_type: str | None = None) -> list[RatingDefinition]:
        query = select(RatingDefinition)
        if target_type:
            query = query.where(RatingDefinition.target_type == target_type)
        return self.db.exec(query).all()

    def update_definition(self, def_id: int, req: RatingDefinitionUpdate) -> RatingDefinition:
        db_def = self.db.get(RatingDefinition, def_id)
        if not db_def:
            raise EntityNotFoundError("RatingDefinition", def_id)

        update_dict = req.model_dump(exclude_unset=True)
        for k, v in update_dict.items():
            setattr(db_def, k, v)

        self.db.add(db_def)
        self.db.commit()
        self.db.refresh(db_def)
        return db_def

    def delete_definition(self, def_id: int) -> None:
        db_def = self.db.get(RatingDefinition, def_id)
        if not db_def:
            raise EntityNotFoundError("RatingDefinition", def_id)

        entries = self.db.exec(select(RatingEntry).where(RatingEntry.rating_definition_id == def_id)).all()
        for entry in entries:
            self.db.delete(entry)

        self.db.delete(db_def)
        self.db.commit()

    def create_entry(self, req: RatingEntryCreate) -> RatingEntry:
        db_def = self.db.get(RatingDefinition, req.rating_definition_id)
        if not db_def:
            raise EntityNotFoundError("RatingDefinition", req.rating_definition_id)

        if not req.dismissed and req.score is not None:
            if req.score < db_def.min_score or req.score > db_def.max_score:
                raise ValidationError(f"Score must be between {db_def.min_score} and {db_def.max_score}")

        existing = self.db.exec(
            select(RatingEntry).where(
                RatingEntry.rating_definition_id == req.rating_definition_id,
                RatingEntry.target_type == req.target_type,
                RatingEntry.target_id == str(req.target_id),
            )
        ).first()

        effective_score = req.score if req.score is not None else 0

        if existing:
            existing.score = effective_score
            existing.dismissed = bool(req.dismissed)
            existing.notes = req.notes
            self.db.add(existing)
            self.db.commit()
            self.db.refresh(existing)
            return existing
        else:
            entry_dict = req.model_dump()
            entry_dict["score"] = effective_score
            entry_dict["target_id"] = str(req.target_id)
            entry = RatingEntry.model_validate(entry_dict)
            self.db.add(entry)
            self.db.commit()
            self.db.refresh(entry)
            return entry

    def get_entries(self, target_type: str, target_id: str | None = None) -> list[dict[str, Any]]:
        query = select(RatingEntry).where(RatingEntry.target_type == target_type)
        if target_id and target_id != "all":
            query = query.where(RatingEntry.target_id == str(target_id))

        entries = self.db.exec(query).all()
        result = []
        for e in entries:
            r_def = self.db.get(RatingDefinition, e.rating_definition_id)
            e_dict = e.model_dump()
            e_dict["definition"] = r_def.model_dump() if r_def else None
            result.append(e_dict)
        return result

    def delete_entries(self, target_type: str, target_id: str) -> None:
        entries = self.db.exec(
            select(RatingEntry).where(
                RatingEntry.target_type == target_type,
                RatingEntry.target_id == str(target_id),
            )
        ).all()
        for entry in entries:
            self.db.delete(entry)
        self.db.commit()
