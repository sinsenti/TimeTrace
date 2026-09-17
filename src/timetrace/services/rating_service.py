from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlmodel import Session, select

from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.core.timezones import daemon_tzinfo, to_local_naive
from timetrace.db.models import RatingDefinition, RatingEntry, Task
from timetrace.db.models import Session as SessionModel
from timetrace.interfaces.api.schemas import RatingDefinitionCreate, RatingDefinitionUpdate, RatingEntryCreate
from timetrace.interfaces.api.utils import ensure_utc


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

    def list_definitions_for_ai(self) -> list[dict[str, Any]]:
        return [
            {
                "id": definition.id,
                "name": definition.name,
                "target_type": definition.target_type,
                "min_score": definition.min_score,
                "max_score": definition.max_score,
                "is_required": definition.is_required,
                "description": definition.description or "",
            }
            for definition in self.db.exec(select(RatingDefinition).order_by(RatingDefinition.name)).all()
        ]

    @staticmethod
    def _parse_date(value: str, field_name: str) -> date:
        try:
            parsed = date.fromisoformat(value)
        except (TypeError, ValueError) as exc:
            raise ValidationError(f"{field_name} must use YYYY-MM-DD") from exc
        if parsed.isoformat() != value:
            raise ValidationError(f"{field_name} must use YYYY-MM-DD")
        return parsed

    def _resolved_target(self, entry: RatingEntry) -> dict[str, Any] | None:
        if entry.target_type == "day":
            return {"type": "day", "date": entry.target_id, "title": entry.target_id}
        if entry.target_type == "task":
            task = self.db.get(Task, entry.target_id)
            return {"type": "task", "id": entry.target_id, "title": task.title if task else None}
        if entry.target_type == "session":
            session = self.db.get(SessionModel, entry.target_id)
            if not session:
                return {"type": "session", "id": entry.target_id, "title": None}
            task = self.db.get(Task, session.task_id) if session.task_id else None
            return {
                "type": "session",
                "id": entry.target_id,
                "title": task.title if task else (session.tags or session.notes or "Session"),
                "date": to_local_naive(ensure_utc(session.start_time), daemon_tzinfo()).date().isoformat()
                if session.start_time
                else None,
            }
        return {"type": entry.target_type, "id": entry.target_id, "title": None}

    def list_entries_for_ai(
        self,
        *,
        target_type: str | None = None,
        target_id: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        include_dismissed: bool = False,
        limit: int = 100,
    ) -> dict[str, Any]:
        start = self._parse_date(start_date, "start_date") if start_date else None
        end = self._parse_date(end_date, "end_date") if end_date else None
        if start and end and end < start:
            raise ValidationError("end_date must not be before start_date")
        if start and end and (end - start).days + 1 > 730:
            raise ValidationError("rating date range cannot exceed 730 days")
        try:
            requested_limit = int(limit)
        except (TypeError, ValueError) as exc:
            raise ValidationError("limit must be an integer") from exc
        limit = max(1, min(requested_limit, 500))
        query = select(RatingEntry)
        if target_type:
            query = query.where(RatingEntry.target_type == target_type)
        if target_id:
            query = query.where(RatingEntry.target_id == str(target_id))
        if not include_dismissed:
            query = query.where(RatingEntry.dismissed.is_(False))

        tz = daemon_tzinfo()
        if start:
            start_utc = datetime.combine(start, time.min, tz).astimezone(UTC).replace(tzinfo=None)
            query = query.where(RatingEntry.created_at >= start_utc)
        if end:
            end_utc = datetime.combine(end + timedelta(days=1), time.min, tz).astimezone(UTC).replace(tzinfo=None)
            query = query.where(RatingEntry.created_at < end_utc)

        entries = list(self.db.exec(query.order_by(RatingEntry.created_at.desc()).limit(limit + 1)).all())
        truncated = len(entries) > limit
        entries = entries[:limit]
        result: list[dict[str, Any]] = []
        for entry in entries:
            definition = self.db.get(RatingDefinition, entry.rating_definition_id)
            result.append(
                {
                    "id": entry.id,
                    "rating_definition_id": entry.rating_definition_id,
                    "definition": {
                        "id": definition.id,
                        "name": definition.name,
                        "target_type": definition.target_type,
                        "min_score": definition.min_score,
                        "max_score": definition.max_score,
                        "is_required": definition.is_required,
                        "description": definition.description or "",
                    }
                    if definition
                    else None,
                    "target_type": entry.target_type,
                    "target_id": entry.target_id,
                    "resolved_target": self._resolved_target(entry),
                    "score": entry.score,
                    "dismissed": bool(entry.dismissed),
                    "notes": entry.notes or "",
                    "created_at": ensure_utc(entry.created_at).isoformat() if entry.created_at else None,
                }
            )
        return {
            "target_type": target_type,
            "target_id": target_id,
            "start_date": start.isoformat() if start else None,
            "end_date": end.isoformat() if end else None,
            "include_dismissed": include_dismissed,
            "entries": result,
            "truncated": truncated,
            "warnings": ["Rating entries were limited; request a narrower range."] if truncated else [],
        }

    def update_definition(self, def_id: str, req: RatingDefinitionUpdate) -> RatingDefinition:
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

    def delete_definition(self, def_id: str) -> None:
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
