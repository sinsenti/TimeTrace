"""AI assistant API (docs/ai-assistant-spec.md S7 "API contract (reconciled)").

`APIRouter(prefix="/api/ai")`. Static provider routes (`/providers/catalog`, `/providers/test`)
are registered before the dynamic `/providers/{config_id}` route, per spec. Endpoints that invoke
a model (`POST /conversations/{id}/messages`, `POST /quick-add/parse`) are `async def` -- a
week-scheduling turn can take 30-60s and a sync handler would starve the threadpool.
"""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session as DBSession

from timetrace.db.session import get_session
from timetrace.interfaces.api.schemas import (
    AIApplyResult,
    AIChatMessageRequest,
    AIConversationCreateRequest,
    AIConversationDetailResponse,
    AIConversationResponse,
    AIConversationUpdateRequest,
    AIDraftBatchActionResult,
    AIDraftBatchDetailResponse,
    AIDraftBatchItemsRequest,
    AIDraftBatchRejectRequest,
    AIDraftBatchResponse,
    AIDraftItemPatchRequest,
    AIDraftItemRejectRequest,
    AIDraftItemResponse,
    AIDraftOverlayItemResponse,
    AIDraftUndoRequest,
    AIProviderConfigResponse,
    AIProviderCreateRequest,
    AIProviderTestRequest,
    AIProviderTestResult,
    AIProviderUpdateRequest,
    AIQuickAddClassifyRequest,
    AIQuickAddClassifyResponse,
    AIQuickAddParseRequest,
    AIQuickAddParseResponse,
    AISettingsResponse,
    AISettingsUpdateRequest,
    AIStatusResponse,
)
from timetrace.services import AIChatService, AIDraftService, AIProviderService, AISettingsService

router = APIRouter(prefix="/api/ai", tags=["AI Assistant API"])


def _provider_response(config) -> AIProviderConfigResponse:
    return AIProviderConfigResponse(
        id=config.id,
        name=config.name,
        provider=config.provider,
        model=config.model,
        base_url=config.base_url,
        api_key_set=bool(config.api_key_encrypted),
        api_key_last4=config.api_key_last4,
        temperature=config.temperature,
        max_output_tokens=config.max_output_tokens,
        request_timeout_seconds=config.request_timeout_seconds,
        sanitization_level=config.sanitization_level,
        use_native_openrouter=config.use_native_openrouter,
        extra_params=json.loads(config.extra_params_json or "{}"),
        is_active=config.is_active,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


# ============================================================
# Status
# ============================================================


@router.get("/status", response_model=AIStatusResponse)
def get_status(db: DBSession = Depends(get_session)):
    return AIChatService(db).get_status()


# ============================================================
# Providers -- static routes before dynamic (spec S7)
# ============================================================


@router.get("/providers/catalog")
def get_provider_catalog(db: DBSession = Depends(get_session)):
    return AIProviderService(db).list_catalog()


@router.post("/providers/test", response_model=AIProviderTestResult)
def test_provider(req: AIProviderTestRequest, db: DBSession = Depends(get_session)):
    inline = req.inline_config.model_dump() if req.inline_config else None
    return AIProviderService(db).test_config(config_id=req.config_id, inline_config=inline)


@router.get("/providers", response_model=list[AIProviderConfigResponse])
def list_providers(db: DBSession = Depends(get_session)):
    return [_provider_response(c) for c in AIProviderService(db).list_providers()]


@router.post("/providers", response_model=AIProviderConfigResponse, status_code=status.HTTP_201_CREATED)
def create_provider(req: AIProviderCreateRequest, db: DBSession = Depends(get_session)):
    config = AIProviderService(db).create_provider(**req.model_dump())
    return _provider_response(config)


@router.get("/providers/{config_id}/models")
def list_provider_models(config_id: str, db: DBSession = Depends(get_session)):
    return AIProviderService(db).list_models(config_id)


@router.put("/providers/{config_id}", response_model=AIProviderConfigResponse)
def update_provider(config_id: str, req: AIProviderUpdateRequest, db: DBSession = Depends(get_session)):
    # `exclude_unset` is what implements spec S9.4: an OMITTED `api_key` keeps the stored key
    # (never passed to the service at all, so its own `_UNSET` default applies), an explicit
    # `""` clears it, and a real value replaces it.
    data = req.model_dump(exclude_unset=True)
    config = AIProviderService(db).update_provider(config_id, **data)
    return _provider_response(config)


@router.delete("/providers/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_provider(config_id: str, db: DBSession = Depends(get_session)):
    AIProviderService(db).delete_provider(config_id)
    return None


@router.post("/providers/{config_id}/activate", response_model=AIProviderConfigResponse)
def activate_provider(config_id: str, db: DBSession = Depends(get_session)):
    return _provider_response(AIProviderService(db).activate_provider(config_id))


# ============================================================
# Settings
# ============================================================


@router.get("/settings", response_model=AISettingsResponse)
def get_settings(db: DBSession = Depends(get_session)):
    return AISettingsService(db).get_settings()


@router.put("/settings", response_model=AISettingsResponse)
def update_settings(req: AISettingsUpdateRequest, db: DBSession = Depends(get_session)):
    return AISettingsService(db).update_settings(**req.model_dump(exclude_unset=True))


# ============================================================
# Chat
# ============================================================


@router.get("/conversations", response_model=list[AIConversationResponse])
def list_conversations(include_archived: bool = Query(False), db: DBSession = Depends(get_session)):
    return AIChatService(db).list_conversations(include_archived=include_archived)


@router.post("/conversations", response_model=AIConversationResponse, status_code=status.HTTP_201_CREATED)
def create_conversation(req: AIConversationCreateRequest, db: DBSession = Depends(get_session)):
    return AIChatService(db).create_conversation(**req.model_dump())


@router.get("/conversations/{conversation_id}", response_model=AIConversationDetailResponse)
def get_conversation(conversation_id: str, db: DBSession = Depends(get_session)):
    return AIChatService(db).get_conversation_detail(conversation_id)


@router.patch("/conversations/{conversation_id}", response_model=AIConversationResponse)
def update_conversation(conversation_id: str, req: AIConversationUpdateRequest, db: DBSession = Depends(get_session)):
    return AIChatService(db).update_conversation(conversation_id, **req.model_dump(exclude_unset=True))


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: str, db: DBSession = Depends(get_session)):
    AIChatService(db).delete_conversation(conversation_id)
    return None


@router.post("/conversations/{conversation_id}/messages")
async def post_message(conversation_id: str, req: AIChatMessageRequest, db: DBSession = Depends(get_session)):
    """Non-streaming: returns `AIChatTurnResponse`. `stream: true`: returns
    `text/event-stream` (spec S7) -- the response shape necessarily differs, so no single
    `response_model` covers both."""
    service = AIChatService(db)
    if req.stream:
        return StreamingResponse(service.run_turn_stream(conversation_id, req.text), media_type="text/event-stream")
    return await service.run_turn(conversation_id, req.text)


# ============================================================
# Drafts
# ============================================================


@router.get("/drafts/batches", response_model=list[AIDraftBatchResponse])
def list_draft_batches(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: DBSession = Depends(get_session),
):
    return AIChatService(db).list_draft_batches(status=status_filter, limit=limit, offset=offset)


@router.get("/drafts/batches/{batch_id}", response_model=AIDraftBatchDetailResponse)
def get_draft_batch(batch_id: str, db: DBSession = Depends(get_session)):
    return AIChatService(db).get_draft_batch_detail(batch_id)


@router.get("/drafts/overlay", response_model=list[AIDraftOverlayItemResponse])
def get_drafts_overlay(start: datetime, end: datetime, db: DBSession = Depends(get_session)):
    return AIChatService(db).get_draft_overlay(start, end)


@router.patch("/drafts/items/{item_id}", response_model=AIDraftItemResponse)
def patch_draft_item(item_id: str, req: AIDraftItemPatchRequest, db: DBSession = Depends(get_session)):
    return AIChatService(db).update_draft_item(item_id, req.proposed)


@router.post("/drafts/items/{item_id}/reject", response_model=AIDraftItemResponse)
def reject_draft_item(item_id: str, req: AIDraftItemRejectRequest, db: DBSession = Depends(get_session)):
    return AIDraftService(db).reject_item(item_id, reason=req.reason)


@router.post("/drafts/batches/{batch_id}/accept", response_model=AIApplyResult)
def accept_draft_batch(batch_id: str, req: AIDraftBatchItemsRequest, db: DBSession = Depends(get_session)):
    return AIDraftService(db).accept_items(batch_id, item_ids=req.item_ids)


@router.post("/drafts/batches/{batch_id}/reject", response_model=AIDraftBatchActionResult)
def reject_draft_batch(batch_id: str, req: AIDraftBatchRejectRequest, db: DBSession = Depends(get_session)):
    return AIDraftService(db).reject_batch(batch_id, item_ids=req.item_ids, reason=req.reason)


@router.post("/drafts/batches/{batch_id}/undo", response_model=AIDraftBatchActionResult)
def undo_draft_batch(batch_id: str, req: AIDraftBatchItemsRequest, db: DBSession = Depends(get_session)):
    return AIDraftService(db).undo_batch(batch_id, item_ids=req.item_ids)


@router.post("/drafts/batches/{batch_id}/reapply", response_model=AIApplyResult)
def reapply_draft_batch(batch_id: str, req: AIDraftBatchItemsRequest, db: DBSession = Depends(get_session)):
    return AIDraftService(db).reapply_batch(batch_id, item_ids=req.item_ids)


@router.post("/drafts/undo", response_model=list[AIDraftBatchActionResult])
def undo_drafts(req: AIDraftUndoRequest, db: DBSession = Depends(get_session)):
    return AIChatService(db).undo_batches(batch_ids=req.batch_ids, since=req.since)


# ============================================================
# Quick add
# ============================================================


@router.post("/quick-add/classify", response_model=AIQuickAddClassifyResponse)
def quick_add_classify(req: AIQuickAddClassifyRequest, db: DBSession = Depends(get_session)):
    decision = AIChatService(db).quick_add_classify(req.text, force_tier=req.force_tier)
    return AIQuickAddClassifyResponse(
        tier=decision.tier,
        reason=decision.reason,
        signals=decision.signals,
        remaining_text=decision.remaining_text,
        remaining_word_count=decision.remaining_word_count,
    )


@router.post("/quick-add/parse", response_model=AIQuickAddParseResponse)
async def quick_add_parse(req: AIQuickAddParseRequest, db: DBSession = Depends(get_session)):
    return await AIChatService(db).quick_add_parse(req.text, force_tier=req.force_tier)
