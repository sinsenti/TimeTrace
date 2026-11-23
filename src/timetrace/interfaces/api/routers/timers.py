"""Additive targeted timer HTTP interface."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator
from sqlmodel import Session

from timetrace.db.session import get_session
from timetrace.services.multiple_timer_service import MultipleTimerService

router = APIRouter(tags=["Timers"])


class NotificationClaim(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=128)
    channel: Literal["in_app", "browser", "native"]


class NotificationResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    claim_token: str = Field(min_length=1, max_length=128)
    outcome: Literal["accepted", "failed", "unknown", "in_app_acknowledged"]


@router.get("/timer-notifications/capability")
def notification_capability(request: Request):
    return request.app.state.notification_adapter.capability()


@router.get("/timer-notifications")
def notifications(db: Session = Depends(get_session)):
    from timetrace.services.timer_focus_service import TimerNotificationService

    return TimerNotificationService(db).list_notices()


@router.post("/timer-notifications/{event_id}/claim")
def notification_claim(event_id: str, req: NotificationClaim, db: Session = Depends(get_session)):
    from timetrace.services.timer_focus_service import TimerNotificationService

    return TimerNotificationService(db).claim(event_id, req.operation_id, req.channel)


@router.post("/timer-notifications/{event_id}/ack")
def notification_ack(event_id: str, db: Session = Depends(get_session)):
    from timetrace.services.timer_focus_service import TimerNotificationService

    return TimerNotificationService(db).acknowledge(event_id)


@router.post("/timer-notifications/{event_id}/result")
def notification_result(event_id: str, req: NotificationResult, db: Session = Depends(get_session)):
    from timetrace.services.timer_focus_service import TimerNotificationService

    return TimerNotificationService(db).result(event_id, req.claim_token, req.outcome)


class FocusInitializeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=128)


@router.post("/timer-focus/initialize")
def focus_initialize(req: FocusInitializeRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).mutate("focus_initialize", None, req.model_dump())


class FocusDefaultsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=0)
    enabled: bool
    work_minutes: int = Field(ge=1, le=1440)
    break_minutes: int = Field(ge=1, le=1440)
    behavior: Literal["notify_only", "automatic_break"]
    sound_enabled: bool


@router.get("/timer-focus/defaults")
def focus_defaults(db: Session = Depends(get_session)):
    return MultipleTimerService(db).focus_defaults()


@router.post("/timer-focus/defaults")
def set_focus_defaults(req: FocusDefaultsRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).mutate("focus_defaults", None, req.model_dump())


class FocusSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=1)
    enabled: bool
    work_minutes: int = Field(ge=1, le=1440)
    break_minutes: int = Field(ge=1, le=1440)
    behavior: Literal["notify_only", "automatic_break"]


class FocusActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=1)
    expected_generation: int = Field(ge=1)
    action: Literal["take_break", "keep_working", "resume_work"]


@router.post("/timers/{timer_id}/focus-settings")
def focus_settings(timer_id: str, req: FocusSettingsRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).mutate("focus_settings", timer_id, req.model_dump())


@router.post("/timers/{timer_id}/focus-action")
def focus_action(timer_id: str, req: FocusActionRequest, db: Session = Depends(get_session)):
    payload = req.model_dump()
    payload["focus_action"] = payload.pop("action")
    return MultipleTimerService(db).mutate("focus_action", timer_id, payload)


class StartTimer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: str = Field(min_length=1, max_length=128)
    task_id: str | None = None
    tags: str = ""
    notes: str = ""
    mode: str = "flowtime"
    target_minutes: int | None = None
    pause_when_idle: bool = True
    scheduled_session_id: str | None = None
    expected_plan_revision: int | None = None
    expected_projection_revision: str | None = None


class TimerMutation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: str = Field(min_length=1, max_length=128)
    expected_revision: int | None = None
    new_tags: str = ""
    new_notes: str = ""
    expected_note_segment_id: str | None = None
    gap_id: str | None = None
    decision: str | None = None
    pause_when_idle: bool | None = None


class CorrectionInitializeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=128)


@router.post("/timers/correction-initialize")
def correction_initialize(req: CorrectionInitializeRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).mutate("correction_initialize", None, req.model_dump())


class CorrectionRunningTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["running"]
    segment_id: str = Field(min_length=1, max_length=128)


class CorrectionBufferedTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["buffered"]
    segment_id: str = Field(min_length=1, max_length=128)


class CorrectionSavedTarget(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["saved"]
    work_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=1)


class CorrectionStartStep(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["step_start"]
    credited_delta_seconds: int

    @field_validator("credited_delta_seconds")
    @classmethod
    def five_minute_step(cls, value):
        if value not in (-300, 300):
            raise ValueError("Choose an elapsed five-minute step.")
        return value


class CorrectionSetStart(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["set_start"]
    start_utc: str = Field(min_length=1, max_length=64)
    timezone: str = Field(min_length=1, max_length=128)
    local_datetime: str = Field(min_length=1, max_length=64)
    offset_seconds: int = Field(ge=-86400, le=86400)


class CorrectionSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["selection"]
    targets: list[
        Annotated[
            CorrectionRunningTarget | CorrectionBufferedTarget | CorrectionSavedTarget, Field(discriminator="kind")
        ]
    ] = Field(min_length=1, max_length=64)


class CorrectionExclude(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["exclude"]
    start_utc: str = Field(min_length=1, max_length=64)
    end_utc: str = Field(min_length=1, max_length=64)
    timezone: str = Field(min_length=1, max_length=128)
    start_local_datetime: str = Field(min_length=1, max_length=64)
    end_local_datetime: str = Field(min_length=1, max_length=64)
    start_offset_seconds: int = Field(ge=-86400, le=86400)
    end_offset_seconds: int = Field(ge=-86400, le=86400)


class CorrectionPreviewRequest(BaseModel):
    """Strict explicit target/change request; old step dumps gain no defaults."""

    model_config = ConfigDict(extra="forbid", strict=True)
    target: Annotated[
        CorrectionRunningTarget | CorrectionBufferedTarget | CorrectionSavedTarget | CorrectionSelection,
        Field(discriminator="kind"),
    ]
    change: Annotated[CorrectionStartStep | CorrectionSetStart | CorrectionExclude, Field(discriminator="kind")]


class CorrectionInterval(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    start_utc: str = Field(min_length=1, max_length=64)
    end_utc: str = Field(min_length=1, max_length=64)


class CorrectionEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: int = Field(ge=1, le=1)
    resource: str = Field(min_length=1, max_length=256)
    action: Literal["step_start"]
    request: CorrectionPreviewRequest
    cutoff: str = Field(min_length=1, max_length=64)
    timer_revision: int = Field(ge=1)
    dependency_digest: str = Field(pattern="^[0-9a-f]{64}$")
    before: CorrectionInterval
    after: CorrectionInterval
    duration_seconds: int | FiniteFloat = Field(gt=0)
    warnings: list[Annotated[str, Field(max_length=512)]] = Field(max_length=16)
    signature: str = Field(pattern="^[0-9a-f]{64}$")


class CorrectionPresentation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    timezone: Annotated[str, Field(min_length=1, max_length=128)]
    before_local: Annotated[str, Field(min_length=1, max_length=64)]
    after_local: Annotated[str, Field(min_length=1, max_length=64)]
    before_local_day: Annotated[str, Field(min_length=1, max_length=16)]
    after_local_day: Annotated[str, Field(min_length=1, max_length=16)]
    day_rebucket: Literal["True", "False"]
    before_duration_seconds: Annotated[str, Field(min_length=1, max_length=32)]
    after_duration_seconds: Annotated[str, Field(min_length=1, max_length=32)]


class DatedCorrectionEnvelope(CorrectionEnvelope):
    schema_version: int = Field(ge=2, le=2)
    action: Literal["set_start"]
    presentation: CorrectionPresentation


class CorrectionFragment(CorrectionInterval):
    source_segment_id: str = Field(min_length=1, max_length=128)
    segment_id: str = Field(min_length=1, max_length=128)
    running: bool


class ExclusionEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: int = Field(ge=2, le=2)
    resource: str = Field(min_length=1, max_length=256)
    action: Literal["exclude"]
    request: CorrectionPreviewRequest
    cutoff: str = Field(min_length=1, max_length=64)
    timer_revision: int = Field(ge=1)
    dependency_digest: str = Field(pattern="^[0-9a-f]{64}$")
    before: list[CorrectionFragment] = Field(max_length=64)
    after: list[CorrectionFragment] = Field(max_length=128)
    removed_seconds: int | FiniteFloat = Field(gt=0)
    already_uncredited_seconds: int | FiniteFloat = Field(ge=0)
    unselected_covered_seconds: int | FiniteFloat = Field(ge=0)
    warnings: list[Annotated[str, Field(max_length=512)]] = Field(max_length=16)
    signature: str = Field(pattern="^[0-9a-f]{64}$")


class SavedCorrectionEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schema_version: int = Field(ge=3, le=3)
    resource: str = Field(min_length=1, max_length=256)
    action: Literal["step_start", "set_start", "exclude"]
    request: CorrectionPreviewRequest
    cutoff: str = Field(min_length=1, max_length=64)
    plan: CorrectionEnvelope | DatedCorrectionEnvelope | ExclusionEnvelope
    timer_state: Literal["running", "paused", "stopped"] | None
    warnings: list[Annotated[str, Field(max_length=512)]] = Field(max_length=16)
    dependency_digest: str = Field(pattern="^[0-9a-f]{64}$")
    signature: str = Field(pattern="^[0-9a-f]{64}$")


class CorrectionCommitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=128)
    preview: CorrectionEnvelope | DatedCorrectionEnvelope | ExclusionEnvelope | SavedCorrectionEnvelope


class SavedPreviewRequest(CorrectionPreviewRequest):
    target: CorrectionSavedTarget


class SavedCommitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(min_length=1, max_length=128)
    preview: SavedCorrectionEnvelope


@router.post("/recorded-work/{work_id}/correction-preview")
def saved_preview(work_id: str, req: SavedPreviewRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).correction_preview("/recorded-work/" + work_id, req.model_dump())


@router.post("/recorded-work/{work_id}/correction")
def saved_commit(work_id: str, req: SavedCommitRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).mutate("correction", "/recorded-work/" + work_id, req.model_dump())


@router.post("/timers/{timer_id}/correction")
def correction_commit(timer_id: str, req: CorrectionCommitRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).mutate("correction", timer_id, req.model_dump())


# Must precede the legacy two-component mutation route, whose schema/hashes stay unchanged.
@router.post("/timers/{timer_id}/correction-preview")
def correction_preview(timer_id: str, req: CorrectionPreviewRequest, db: Session = Depends(get_session)):
    return MultipleTimerService(db).correction_preview(timer_id, req.model_dump())


@router.post("/timers/{timer_id}/{action}")
def mutate_timer(timer_id: str, action: str, req: TimerMutation, db: Session = Depends(get_session)):
    payload = req.model_dump()
    if action != "note":
        # Keep canonical payload hashes for operations journaled before note support.
        payload.pop("expected_note_segment_id", None)
    return MultipleTimerService(db).mutate(action, timer_id, payload)


@router.get("/timers/{timer_id}")
def get_timer(timer_id: str, db: Session = Depends(get_session)):
    return MultipleTimerService(db).get_timer(timer_id)


@router.get("/operations/{operation_id}")
def get_operation(operation_id: str, db: Session = Depends(get_session)):
    return MultipleTimerService(db).operation(operation_id)


@router.get("/timers")
def list_timers(db: Session = Depends(get_session)):
    return MultipleTimerService(db).list_timers()


@router.post("/timers")
def start_timer(req: StartTimer, db: Session = Depends(get_session)):
    return MultipleTimerService(db).start(req.model_dump())
