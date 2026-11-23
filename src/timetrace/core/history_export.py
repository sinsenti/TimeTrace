"""Bounded, non-mutating history report request vocabulary."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HistoryExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_date: date
    end_date: date
    timezone: str
    mode: Literal["filtered", "selected"] = "selected"
    selected_ids: list[str] = Field(default_factory=list, max_length=2000)
    include_uncertain: bool = False
    title: str = ""
    tag: str = ""
    note: str = ""
    task_id: str | None = None
    taskless: bool = False
