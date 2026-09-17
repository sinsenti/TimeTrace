"""`AIChatService` -- conversations, chat turns (streaming and not), and the draft-adjacent read
endpoints (`GET /drafts/batches`, `GET /drafts/overlay`, `PATCH /drafts/items/{id}`,
`GET /status`) that don't belong to `AIDraftService`'s accept/reject/undo/reapply lifecycle
(spec S8, owned by a sibling track).

Draft lifecycle ownership remains in `services/ai_draft_service.py`; the read-only insight and
same-turn planning methods live in `services/ai_insights_service.py` and are exposed through the
protocol-backed `ai_tool_gateway.py`. Where a router endpoint needs a draft-adjacent read/patch
operation those services don't own (listing batches, the calendar overlay, editing a pending
item's `proposed_json`), this module implements it directly against the
`AIDraftBatch`/`AIDraftItem` tables.

**Lazy vs eager batch creation (spec S6/S7):** a batch is created EAGERLY at the start of every
`run_turn`/`run_turn_stream` call, not lazily on the first `propose_*` tool call. `DbAIToolGateway`
requires a real `batch_id` at construction time and `AIDraftService.add_item` requires the batch
row to already exist -- making creation truly lazy would need an additive change to one or both of
those sibling-owned files. Since a pure Q&A turn ("what's on my calendar tomorrow?") makes no
`propose_*` call, `_finalize_batch` deletes the batch row again after the turn if it ended with
zero items and no `summary` -- no empty-batch clutter in the undo history, and no changes to
`ai_draft_service.py`/`ai_tool_gateway.py` were needed.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from sqlmodel import Session, select

from timetrace.core.ai.agent import build_agent
from timetrace.core.ai.providers import get_chat_model
from timetrace.core.ai.quick_add_router import route_quick_add
from timetrace.core.ai.redaction import sanitize_text
from timetrace.core.ai.secrets import decrypt_secret
from timetrace.core.ai.tools import AIAgentContext
from timetrace.core.exceptions import AIProviderError, EntityNotFoundError, TimeTraceError, ValidationError
from timetrace.core.timezones import daemon_timezone_name, daemon_tzinfo, to_local_naive
from timetrace.db.models import (
    AIChatMessage,
    AIConversation,
    AIDraftBatch,
    AIDraftItem,
    AIInstructionProposal,
    AIProviderConfig,
    AISettings,
    Task,
    utc_now,
)
from timetrace.interfaces.api.schemas import (
    AIChatMessageResponse,
    AIChatTurnResponse,
    AIConversationDetailResponse,
    AIConversationResponse,
    AIDraftBatchDetailResponse,
    AIDraftBatchResponse,
    AIDraftItemResponse,
    AIDraftOverlayItemResponse,
    AIInstructionProposalResponse,
    AIQuickAddParseResponse,
    AIStatusResponse,
)
from timetrace.interfaces.api.utils import ensure_utc
from timetrace.services.ai_draft_service import AIDraftService
from timetrace.services.ai_instruction_service import AIInstructionService
from timetrace.services.ai_provider_service import AIProviderService, AISettingsService
from timetrace.services.ai_tool_gateway import DbAIToolGateway

logger = logging.getLogger("timetrace.ai")

# Recent-history window replayed into the agent on every turn. Not specced -- a judgment call.
# 20 rows is generous multi-turn context (a "turn" mints several rows: user + assistant + n tool
# messages) without unbounded token growth on a long-lived conversation.
_HISTORY_LIMIT = 20


def _parse_json_field(value: str | None) -> dict[str, Any] | None:
    if value is None:
        return None
    return json.loads(value)


def _draft_display_title(
    item: AIDraftItem,
    proposed: dict[str, Any],
    baseline: dict[str, Any] | None,
    applied_after: dict[str, Any] | None,
    db: Session,
) -> str:
    """Human-readable label for a draft item -- never "untitled session" (spec: sessions have no
    title field of their own, so the naive fallback showed nothing useful). Must not raise if a
    referenced task id is stale/deleted; falls through to the tag/notes chain instead."""
    baseline = baseline or {}
    if item.entity_type == "task":
        return proposed.get("title") or baseline.get("title") or "(untitled task)"

    if item.entity_type == "session":
        task_id = proposed.get("task_id") or baseline.get("task_id") or (applied_after or {}).get("task_id")
        if task_id:
            try:
                task = db.get(Task, task_id)
            except Exception:
                task = None
            if task is not None and task.title:
                return task.title
        # Matches the real calendar's convention (static/js/calendar.js: `s.tags || s.notes ||
        # 'Session'`) -- tags before notes, not the other way around. `proposed_json`/
        # `baseline_json` are user/tool-editable via PATCH (schemas.py's `proposed: dict[str, Any]`
        # is unvalidated), so coerce to str rather than trusting these are strings -- a non-string
        # value here would otherwise fail AIDraftItemResponse's `display_title: str` validation and
        # 500 every read of this batch/overlay, not just the request that wrote it.
        for candidate in (proposed.get("tags"), proposed.get("notes"), baseline.get("tags"), baseline.get("notes")):
            if isinstance(candidate, str) and candidate:
                return candidate
        return "Session"

    return ""


def _draft_item_response(item: AIDraftItem, draft_service: AIDraftService) -> AIDraftItemResponse:
    proposed = json.loads(item.proposed_json or "{}")
    baseline = _parse_json_field(item.baseline_json)
    applied_after = _parse_json_field(item.applied_after_json)
    return AIDraftItemResponse(
        id=item.id,
        batch_id=item.batch_id,
        position=item.position,
        op=item.op,
        entity_type=item.entity_type,
        target_id=item.target_id,
        proposed=proposed,
        baseline=baseline,
        applied_before=_parse_json_field(item.applied_before_json),
        applied_after=applied_after,
        applied_entity_id=item.applied_entity_id,
        status=item.status,
        rationale=item.rationale,
        error=item.error,
        is_stale=draft_service.is_stale(item),
        ui_kind=proposed.get("ui_kind"),
        group_key=proposed.get("group_key"),
        display_title=_draft_display_title(item, proposed, baseline, applied_after, draft_service.db),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _stringify_content(content: Any) -> str:
    """LangChain message `.content` is either a plain string or a list of provider-specific
    content blocks (Anthropic-style `{"type": "text", "text": ...}`, among others). Only text
    blocks are kept -- there is no rendering surface for tool-use/image blocks in this chat."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return str(content)


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _instruction_proposal_response(proposal: AIInstructionProposal) -> AIInstructionProposalResponse:
    return AIInstructionProposalResponse.model_validate(proposal)


class AIChatService:
    """`AIChatService(db)` -- construct per-request, like every other service in this codebase."""

    def __init__(self, db: Session):
        self.db = db

    # -- status --------------------------------------------------------------------------

    def get_status(self) -> AIStatusResponse:
        provider_service = AIProviderService(self.db)
        draft_service = AIDraftService(self.db)
        providers = provider_service.list_providers()
        active = next((p for p in providers if p.is_active), None)

        # "configured" = an active provider with a key set -- except Ollama, which is
        # legitimately keyless for a fully local model and must not be reported as unconfigured.
        configured = bool(active) and (bool(active.api_key_encrypted) or active.provider == "ollama")

        settings = AISettingsService(self.db).get_settings()

        pending_draft_count = len(self.db.exec(select(AIDraftItem.id).where(AIDraftItem.status == "pending")).all())
        undoable_batch_count = len(draft_service.list_undoable_batches())
        latest = self.db.exec(select(AIDraftBatch).order_by(AIDraftBatch.created_at.desc()).limit(1)).first()

        return AIStatusResponse(
            configured=configured,
            default_provider=active.provider if active else None,
            quickadd_fallback_enabled=settings.quickadd_fallback_enabled,
            pending_draft_count=pending_draft_count,
            undoable_batch_count=undoable_batch_count,
            latest_batch=AIDraftBatchResponse.model_validate(latest) if latest else None,
        )

    # -- conversations ---------------------------------------------------------------------

    def create_conversation(
        self,
        title: str | None = None,
        intent: str | None = None,
        provider_config_id: str | None = None,
    ) -> AIConversation:
        kwargs: dict[str, Any] = {}
        if title is not None:
            kwargs["title"] = title
        if intent is not None:
            kwargs["intent"] = intent
        if provider_config_id is not None:
            kwargs["provider_config_id"] = provider_config_id
        conv = AIConversation(**kwargs)
        self.db.add(conv)
        self.db.commit()
        self.db.refresh(conv)
        return conv

    def list_conversations(self, include_archived: bool = False) -> list[AIConversation]:
        query = select(AIConversation).order_by(AIConversation.updated_at.desc())
        if not include_archived:
            query = query.where(~AIConversation.is_archived)
        return list(self.db.exec(query).all())

    def get_conversation(self, conversation_id: str) -> AIConversation:
        conv = self.db.get(AIConversation, conversation_id)
        if not conv:
            raise EntityNotFoundError("AIConversation", conversation_id)
        return conv

    def get_conversation_detail(self, conversation_id: str) -> AIConversationDetailResponse:
        conv = self.get_conversation(conversation_id)
        messages = self.db.exec(
            select(AIChatMessage)
            .where(AIChatMessage.conversation_id == conversation_id)
            .order_by(AIChatMessage.position)
        ).all()
        resp = AIConversationDetailResponse.model_validate(conv)
        resp.messages = [AIChatMessageResponse.model_validate(m) for m in messages]
        proposals = AIInstructionService(self.db).list_for_conversation(conversation_id)
        resp.instruction_proposals = [_instruction_proposal_response(p) for p in proposals]
        return resp

    def update_conversation(self, conversation_id: str, **fields: Any) -> AIConversation:
        allowed = {"title", "is_archived"}
        unknown = set(fields) - allowed
        if unknown:
            raise ValidationError(f"Unknown conversation field(s): {', '.join(sorted(unknown))}")
        conv = self.get_conversation(conversation_id)
        for key, value in fields.items():
            if value is not None:
                setattr(conv, key, value)
        conv.updated_at = utc_now()
        self.db.add(conv)
        self.db.commit()
        self.db.refresh(conv)
        return conv

    def delete_conversation(self, conversation_id: str) -> None:
        """Cascades messages (ORM relationship cascade); draft batches are explicitly nulled
        rather than deleted, per spec S4 -- and explicitly in Python, not left to the DB, since
        `PRAGMA foreign_keys` is never turned on for this project's SQLite connections
        (`db/session.py`), so an `ON DELETE SET NULL` on the FK is not actually enforced."""
        conv = self.get_conversation(conversation_id)
        batches = self.db.exec(select(AIDraftBatch).where(AIDraftBatch.conversation_id == conversation_id)).all()
        for batch in batches:
            batch.conversation_id = None
            self.db.add(batch)
        proposals = AIInstructionService(self.db).list_for_conversation(conversation_id)
        for proposal in proposals:
            proposal.conversation_id = None
            proposal.updated_at = utc_now()
            self.db.add(proposal)
        self.db.delete(conv)
        self.db.commit()

    def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        *,
        tool_calls_json: str | None = None,
        tool_call_id: str | None = None,
        tool_name: str | None = None,
        draft_batch_id: str | None = None,
        provider: str | None = None,
        model: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        latency_ms: int | None = None,
        error: str | None = None,
    ) -> AIChatMessage:
        """Auto-increments `position` -- never trust `id` ordering (uuid7 is only coarsely
        monotonic and several messages per turn land in the same millisecond)."""
        conv = self.get_conversation(conversation_id)

        last_position = self.db.exec(
            select(AIChatMessage.position)
            .where(AIChatMessage.conversation_id == conversation_id)
            .order_by(AIChatMessage.position.desc())
        ).first()
        position = 0 if last_position is None else last_position + 1

        msg = AIChatMessage(
            conversation_id=conversation_id,
            position=position,
            role=role,
            content=content or "",
            tool_calls_json=tool_calls_json,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            draft_batch_id=draft_batch_id,
            provider=provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
            error=error,
        )
        self.db.add(msg)

        conv.message_count = (conv.message_count or 0) + 1
        conv.last_message_at = utc_now()
        if input_tokens:
            conv.total_input_tokens = (conv.total_input_tokens or 0) + input_tokens
        if output_tokens:
            conv.total_output_tokens = (conv.total_output_tokens or 0) + output_tokens
        conv.updated_at = utc_now()
        self.db.add(conv)

        self.db.commit()
        self.db.refresh(msg)
        return msg

    # -- chat turns ------------------------------------------------------------------------

    async def run_turn(self, conversation_id: str, user_text: str) -> AIChatTurnResponse:
        logger.info("AI turn start: conversation=%s input_chars=%d", conversation_id, len(user_text))
        conv = self.get_conversation(conversation_id)
        provider_config = self._resolve_provider_config(conv)
        sanitized_text = self._sanitize_for_provider(user_text, provider_config)
        logger.info("AI turn provider: %s/%s", provider_config.provider, provider_config.model)

        user_msg = self.add_message(conversation_id, role="user", content=sanitized_text)

        draft_service = AIDraftService(self.db)
        batch = draft_service.create_batch(
            conversation_id=conversation_id,
            source_message_id=user_msg.id,
            intent=conv.intent,
            request_text=sanitized_text,
            provider=provider_config.provider,
            model=provider_config.model,
        )
        logger.info("AI turn batch created: batch=%s", batch.id)
        gateway = DbAIToolGateway(
            batch_id=batch.id,
            conversation_id=conversation_id,
            source_message_id=user_msg.id,
            source_message_text=user_text,
        )

        history = self._recent_history(conversation_id, exclude_message_id=user_msg.id)
        input_messages = self._history_to_langchain(history) + [HumanMessage(content=sanitized_text)]

        try:
            model = self._build_model(provider_config)
            agent = build_agent(
                model,
                sanitization_level=provider_config.sanitization_level,
                extra_system_context=self._turn_context(),
                custom_instructions=AISettingsService(self.db).get_settings().custom_instructions,
            )
        except AIProviderError as exc:
            logger.warning(
                "AI turn failed building agent: conversation=%s error_type=%s", conversation_id, type(exc).__name__
            )
            self._finalize_batch(batch.id, None)
            raise

        start = time.monotonic()
        try:
            result = await agent.ainvoke({"messages": input_messages}, context=AIAgentContext(gateway=gateway))
        except Exception as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "AI turn failed: conversation=%s batch=%s latency_ms=%d error_type=%s",
                conversation_id,
                batch.id,
                latency_ms,
                type(exc).__name__,
            )
            self.add_message(
                conversation_id,
                role="assistant",
                content="",
                provider=provider_config.provider,
                model=provider_config.model,
                latency_ms=latency_ms,
                # Provider exceptions can contain response bodies, prompt fragments, or other
                # sensitive data. Keep only a stable generic marker in the conversation record;
                # the log above records the exception class, never its text.
                error="AI provider call failed.",
            )
            AIInstructionService(self.db).mark_failed_for_source(user_msg.id)
            self._finalize_batch(batch.id, None)
            raise AIProviderError("AI provider call failed.") from exc
        latency_ms = int((time.monotonic() - start) * 1000)

        new_messages = result.get("messages", [])[len(input_messages) :]
        final_msg = self._persist_new_messages(conversation_id, new_messages, provider_config, latency_ms)
        if final_msg is None:
            final_msg = self.add_message(
                conversation_id,
                role="assistant",
                content="",
                provider=provider_config.provider,
                model=provider_config.model,
                latency_ms=latency_ms,
                error="model produced no response",
            )

        finalized_batch = self._finalize_batch(batch.id, final_msg)
        conv = self.get_conversation(conversation_id)
        draft_batch_resp = self.get_draft_batch_detail(finalized_batch.id) if finalized_batch else None
        instruction_proposal = AIInstructionService(self.db).get_for_source_message(user_msg.id)
        logger.info(
            "AI turn done: conversation=%s batch=%s latency_ms=%d draft_items=%d",
            conversation_id,
            finalized_batch.id if finalized_batch else None,
            latency_ms,
            finalized_batch.item_count if finalized_batch else 0,
        )

        return AIChatTurnResponse(
            conversation=AIConversationResponse.model_validate(conv),
            message=AIChatMessageResponse.model_validate(final_msg),
            draft_batch=draft_batch_resp,
            instruction_proposal=(
                _instruction_proposal_response(instruction_proposal) if instruction_proposal is not None else None
            ),
        )

    async def run_turn_stream(self, conversation_id: str, user_text: str) -> AsyncIterator[str]:
        """SSE event stream: `message_start`, `status`, `token`, `draft` (once, fully-formed),
        `message_end`, `error` (spec S7). Built on
        `agent.astream(input, stream_mode=["messages","updates"], version="v2")` (spec S3):
        `"messages"` mode yields `(chunk, metadata)` token pairs for `token` events; `"updates"`
        mode yields `{node_name: state_update}` dicts, and this graph's `AgentState` keeps new
        messages under an `add_messages`-reduced `"messages"` key on every node's state update --
        so accumulating `update["messages"]` off every `"updates"` event reconstructs exactly the
        same final message list `run_turn`'s `agent.ainvoke(...)` would have returned, without a
        second model call.
        """
        try:
            conv = self.get_conversation(conversation_id)
            provider_config = self._resolve_provider_config(conv)
        except TimeTraceError as exc:
            yield _sse("error", {"message": str(exc)})
            return

        logger.info("AI turn start (stream): conversation=%s input_chars=%d", conversation_id, len(user_text))
        sanitized_text = self._sanitize_for_provider(user_text, provider_config)
        logger.info("AI turn provider: %s/%s", provider_config.provider, provider_config.model)
        user_msg = self.add_message(conversation_id, role="user", content=sanitized_text)
        yield _sse("message_start", {"conversation_id": conversation_id, "user_message_id": user_msg.id})

        draft_service = AIDraftService(self.db)
        batch = draft_service.create_batch(
            conversation_id=conversation_id,
            source_message_id=user_msg.id,
            intent=conv.intent,
            request_text=sanitized_text,
            provider=provider_config.provider,
            model=provider_config.model,
        )
        logger.info("AI turn batch created: batch=%s", batch.id)
        gateway = DbAIToolGateway(
            batch_id=batch.id,
            conversation_id=conversation_id,
            source_message_id=user_msg.id,
            source_message_text=user_text,
        )

        history = self._recent_history(conversation_id, exclude_message_id=user_msg.id)
        input_messages = self._history_to_langchain(history) + [HumanMessage(content=sanitized_text)]

        try:
            model = self._build_model(provider_config)
            agent = build_agent(
                model,
                sanitization_level=provider_config.sanitization_level,
                extra_system_context=self._turn_context(),
                custom_instructions=AISettingsService(self.db).get_settings().custom_instructions,
            )
        except AIProviderError:
            self._finalize_batch(batch.id, None)
            yield _sse("error", {"message": "Failed to initialize the AI provider."})
            return

        start = time.monotonic()
        new_messages: list[Any] = []
        yield _sse("status", {"message": "thinking"})
        try:
            async for event in agent.astream(
                {"messages": input_messages},
                context=AIAgentContext(gateway=gateway),
                stream_mode=["messages", "updates"],
                version="v2",
            ):
                # This installed langgraph version emits multi-mode stream events as
                # {"type": mode, "ns": namespace, "data": payload} dicts, not (mode, data)
                # tuples -- the module's docstring paraphrase is stale for this pin.
                mode, data = event["type"], event["data"]
                if mode == "messages":
                    chunk, _metadata = data
                    # "messages" mode streams every message chunk flowing through the graph,
                    # including ToolMessage chunks carrying a tool's raw return value (JSON) --
                    # confirmed live: without this filter a propose_* tool's JSON result renders
                    # as if the assistant had said it. Only AI message chunks are real assistant
                    # text.
                    if not isinstance(chunk, AIMessage):
                        continue
                    text = _stringify_content(getattr(chunk, "content", None))
                    if text:
                        yield _sse("token", {"text": text})
                elif mode == "updates":
                    for node_name, node_update in (data or {}).items():
                        logger.info("AI turn step: conversation=%s node=%s", conversation_id, node_name)
                        yield _sse("status", {"message": "running tools" if node_name == "tools" else "thinking"})
                        if isinstance(node_update, dict):
                            msgs = node_update.get("messages")
                            if msgs:
                                new_messages.extend(msgs)
        except Exception as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            logger.warning(
                "AI turn failed (stream): conversation=%s batch=%s latency_ms=%d error_type=%s",
                conversation_id,
                batch.id,
                latency_ms,
                type(exc).__name__,
            )
            self.add_message(
                conversation_id,
                role="assistant",
                content="",
                provider=provider_config.provider,
                model=provider_config.model,
                latency_ms=latency_ms,
                error="AI provider call failed.",
            )
            AIInstructionService(self.db).mark_failed_for_source(user_msg.id)
            self._finalize_batch(batch.id, None)
            yield _sse("error", {"message": "AI provider call failed."})
            return

        latency_ms = int((time.monotonic() - start) * 1000)
        final_msg = self._persist_new_messages(conversation_id, new_messages, provider_config, latency_ms)
        if final_msg is None:
            final_msg = self.add_message(
                conversation_id,
                role="assistant",
                content="",
                provider=provider_config.provider,
                model=provider_config.model,
                latency_ms=latency_ms,
                error="model produced no response",
            )

        finalized_batch = self._finalize_batch(batch.id, final_msg)
        if finalized_batch:
            draft_resp = self.get_draft_batch_detail(finalized_batch.id)
            yield _sse("draft", json.loads(draft_resp.model_dump_json()))

        instruction_proposal = AIInstructionService(self.db).get_for_source_message(user_msg.id)
        if instruction_proposal is not None:
            yield _sse(
                "instruction_proposal",
                json.loads(_instruction_proposal_response(instruction_proposal).model_dump_json()),
            )

        logger.info(
            "AI turn done (stream): conversation=%s batch=%s latency_ms=%d draft_items=%d",
            conversation_id,
            finalized_batch.id if finalized_batch else None,
            latency_ms,
            finalized_batch.item_count if finalized_batch else 0,
        )
        yield _sse("message_end", json.loads(AIChatMessageResponse.model_validate(final_msg).model_dump_json()))

    # -- draft-adjacent reads (kept here; see module docstring) -----------------------------

    def list_draft_batches(
        self, status: str | None = None, limit: int = 50, offset: int = 0
    ) -> list[AIDraftBatchResponse]:
        query = select(AIDraftBatch).order_by(AIDraftBatch.created_at.desc())
        if status:
            query = query.where(AIDraftBatch.status == status)
        query = query.offset(offset).limit(limit)
        return [AIDraftBatchResponse.model_validate(b) for b in self.db.exec(query).all()]

    def get_draft_batch_detail(self, batch_id: str) -> AIDraftBatchDetailResponse:
        draft_service = AIDraftService(self.db)
        batch = draft_service.get_batch(batch_id)
        items = draft_service.list_items(batch_id)
        # NOT `AIDraftBatchDetailResponse.model_validate(batch)` -- `batch.items` is a live ORM
        # relationship of `AIDraftItem` rows, and `from_attributes` validation would try to
        # coerce it against the `items` field before we get a chance to overwrite it with the
        # computed `AIDraftItemResponse` list below, raising a `pydantic.ValidationError` (caught
        # live while exercising this endpoint). Build the scalar fields via the item-less
        # response first, then attach the computed items.
        base = AIDraftBatchResponse.model_validate(batch)
        return AIDraftBatchDetailResponse(
            **base.model_dump(),
            items=[_draft_item_response(i, draft_service) for i in items],
        )

    def get_draft_overlay(self, start: datetime, end: datetime) -> list[AIDraftOverlayItemResponse]:
        """The calendar draft layer: pending session proposals whose (possibly ghost, for a
        delete) window falls in `[start, end)`. Only `status == "pending"` -- an applied item is
        already a real calendar row and would double-render; rejected/undone items are gone."""
        start_utc = ensure_utc(start)
        end_utc = ensure_utc(end)
        settings = self.db.exec(select(AISettings)).first()
        if settings is not None and not settings.preview_on_calendar:
            return []
        draft_service = AIDraftService(self.db)
        tz = daemon_tzinfo()

        items = self.db.exec(
            select(AIDraftItem).where(AIDraftItem.entity_type == "session", AIDraftItem.status == "pending")
        ).all()

        results: list[AIDraftOverlayItemResponse] = []
        for item in items:
            proposed = json.loads(item.proposed_json or "{}")
            baseline = json.loads(item.baseline_json) if item.baseline_json else None

            if item.op == "delete":
                st_raw = (baseline or {}).get("start_time")
                et_raw = (baseline or {}).get("end_time")
            else:
                st_raw = proposed.get("start_time") or (baseline or {}).get("start_time")
                et_raw = proposed.get("end_time") or (baseline or {}).get("end_time")
            if not st_raw or not et_raw:
                continue

            st = ensure_utc(datetime.fromisoformat(st_raw))
            et = ensure_utc(datetime.fromisoformat(et_raw))
            if et <= start_utc or st >= end_utc:
                continue

            local_start = to_local_naive(st, tz)
            local_end = to_local_naive(et, tz)
            base = _draft_item_response(item, draft_service)
            results.append(
                AIDraftOverlayItemResponse(
                    **base.model_dump(),
                    display={
                        "start_time_local": local_start.isoformat(),
                        "end_time_local": local_end.isoformat(),
                    },
                    day_key=local_start.date().isoformat(),
                )
            )
        return results

    def update_draft_item(self, item_id: str, proposed_updates: dict[str, Any]) -> AIDraftItemResponse:
        """Edit a still-pending item's `proposed_json` before it is accepted (spec S7)."""
        item = self.db.get(AIDraftItem, item_id)
        if not item:
            raise EntityNotFoundError("AIDraftItem", item_id)
        if item.status != "pending":
            raise ValidationError(f"draft item {item_id} is not pending (status={item.status}); cannot edit")

        current = json.loads(item.proposed_json or "{}")
        current.update(proposed_updates)

        start_raw = current.get("start_time")
        end_raw = current.get("end_time")
        if start_raw and end_raw:
            try:
                start_dt = ensure_utc(datetime.fromisoformat(start_raw))
                end_dt = ensure_utc(datetime.fromisoformat(end_raw))
            except (TypeError, ValueError) as exc:
                raise ValidationError(f"invalid start_time/end_time: {exc}") from exc
            if end_dt <= start_dt:
                raise ValidationError("end_time must be strictly after start_time")

        item.proposed_json = json.dumps(current, default=str)
        item.updated_at = utc_now()
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)
        return _draft_item_response(item, AIDraftService(self.db))

    def reject_draft_item(self, item_id: str, reason: str | None = None) -> AIDraftItemResponse:
        """`AIDraftService.reject_item` returns the raw ORM row -- confirmed live to 500 through
        `response_model=AIDraftItemResponse`, which needs computed fields (`is_stale`) and parsed
        JSON (`proposed`/`baseline`) the row doesn't carry. Wrap it the same way
        `update_draft_item` above already does, rather than handing the router a shape it can't
        serialize."""
        draft_service = AIDraftService(self.db)
        item = draft_service.reject_item(item_id, reason=reason)
        return _draft_item_response(item, draft_service)

    def undo_batches(self, batch_ids: list[str] | None, since: datetime | None) -> list[dict[str, Any]]:
        """The one-action week undo (spec S7 `POST /drafts/undo`)."""
        draft_service = AIDraftService(self.db)
        targets = batch_ids if batch_ids else [b.id for b in draft_service.list_undoable_batches(since=since)]
        return [draft_service.undo_batch(bid) for bid in targets]

    # -- quick add ---------------------------------------------------------------------------

    def quick_add_classify(self, text: str, force_tier: int | None = None):
        return route_quick_add(text, force_tier=force_tier)

    async def quick_add_parse(self, text: str, force_tier: int | None = None) -> AIQuickAddParseResponse:
        """Read-only, creates nothing (spec S7). Tier-1 texts (or tier-2 with no configured
        provider, if fallback is enabled) return empty `fields` -- the caller falls back to the
        existing tier-1 regex parser."""
        decision = route_quick_add(text, force_tier=force_tier)
        if decision.tier == 1:
            return AIQuickAddParseResponse(tier=1, reason=decision.reason, fields={}, raw_text=text)

        settings = AISettingsService(self.db).get_settings()
        providers = AIProviderService(self.db).list_providers()
        active = next((p for p in providers if p.is_active), None)
        if not active:
            if settings.quickadd_fallback_enabled:
                return AIQuickAddParseResponse(
                    tier=1,
                    reason="no AI provider configured; falling back to tier 1",
                    fields={},
                    raw_text=text,
                )
            raise AIProviderError("Quick-add escalated to tier 2 but no AI provider is configured.")

        sanitized = self._sanitize_for_provider(text, active)
        model = self._build_model(active)
        prompt = (
            "Extract task/session fields from this quick-add text as compact JSON with keys: "
            "title (str), tags (str, space separated, no #), priority (one of -, low, medium, "
            "high), due_date (ISO date or null), start_time (ISO datetime or null), end_time "
            "(ISO datetime or null), estimated_duration_minutes (int or null). Respond with JSON "
            f"only, no prose.\n\nText: {sanitized}"
        )
        try:
            response = await model.ainvoke(prompt)
        except Exception as exc:
            raise AIProviderError("Quick-add parse failed.") from exc

        raw = _stringify_content(getattr(response, "content", response))
        fields = self._extract_json(raw)
        return AIQuickAddParseResponse(tier=2, reason=decision.reason, fields=fields, raw_text=text)

    @staticmethod
    def _extract_json(raw: str) -> dict[str, Any]:
        raw = (raw or "").strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.lower().startswith("json"):
                raw = raw[4:]
        try:
            return json.loads(raw)
        except json.JSONDecodeError, TypeError:
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(0))
                except json.JSONDecodeError:
                    pass
            return {}

    # -- internal helpers --------------------------------------------------------------------

    def _sanitize_for_provider(self, text: str, provider_config: AIProviderConfig) -> str:
        # Confirmed live (adversarial review): `AISettings.redact_before_send` was persisted and
        # shown as a working checkbox on /settings/ai but nothing ever read it -- redaction was
        # gated solely on the per-provider `sanitization_level`, so turning this toggle off did
        # nothing (still redacted) and turning it on with a provider set to `sanitization_level=
        # "off"` also did nothing (never redacted) -- a privacy control reporting the opposite of
        # reality either way. Both must now agree to skip sanitization.
        if provider_config.sanitization_level == "off":
            return text
        if not AISettingsService(self.db).get_settings().redact_before_send:
            return text
        return sanitize_text(text) or ""

    def _resolve_provider_config(self, conv: AIConversation) -> AIProviderConfig:
        if conv.provider_config_id:
            config = self.db.get(AIProviderConfig, conv.provider_config_id)
            if config:
                return config
        providers = AIProviderService(self.db).list_providers()
        active = next((p for p in providers if p.is_active), None)
        if not active:
            raise AIProviderError("No active AI provider is configured. Add and activate one in Settings > AI.")
        return active

    def _build_model(self, config: AIProviderConfig) -> Any:
        api_key = decrypt_secret(config.api_key_encrypted) if config.api_key_encrypted else None
        extra_params = json.loads(config.extra_params_json or "{}")
        try:
            return get_chat_model(
                provider=config.provider,
                model=config.model,
                base_url=config.base_url,
                api_key=api_key,
                temperature=config.temperature,
                max_output_tokens=config.max_output_tokens,
                request_timeout_seconds=config.request_timeout_seconds,
                use_native_openrouter=config.use_native_openrouter,
                extra_params=extra_params,
            )
        except Exception as exc:
            # Provider libraries may include response bodies or request fragments in their
            # exception text. Expose only the configured provider name to the caller.
            raise AIProviderError(f"Failed to initialize provider '{config.provider}'.") from exc

    def _turn_context(self) -> str:
        """Grounding info injected into the system prompt every turn (spec's `build_system_prompt
        extra_context` hook). Without this the model has no way to know today's actual date --
        confirmed live: asked for "sessions until 10pm" with no date anchor, a small model has to
        guess a date out of thin air, gets a validation error back with no way to self-correct
        (it doesn't know what "today" is either), and just repeats the same broken attempt.
        Also states the naive-UTC-vs-local-wall-clock conversion explicitly, since every tool's
        datetime arguments are naive UTC (this app's DB convention) while the user always speaks
        in local wall-clock time."""
        tz = daemon_tzinfo()
        # utc_now() returns an AWARE datetime (datetime.now(UTC)); to_local_naive() returns naive
        # local wall-clock -- strip tzinfo here so the subtraction below isn't naive-vs-aware, and
        # so the ISO string shown to the model has no "+00:00" suffix contradicting the "naive
        # UTC, no timezone suffix" instruction we give it.
        now_utc = utc_now().replace(tzinfo=None)
        now_local = to_local_naive(now_utc, tz)
        offset = now_local - now_utc
        offset_hours = offset.total_seconds() / 3600
        sign = "+" if offset_hours >= 0 else "-"
        # A concrete worked example beats a verbal rule -- confirmed live: telling the model to
        # "convert using the offset above" left the arithmetic direction ambiguous and it added
        # the offset instead of subtracting it (local 21:40 -> stored as 23:40 UTC, +2h too late,
        # for a UTC+2 local zone). Showing the actual subtraction with today's real numbers is
        # unambiguous and directly copyable.
        example_local = now_local.replace(hour=21, minute=40, second=0, microsecond=0)
        example_utc = example_local - offset
        settings = AISettingsService(self.db).get_settings()
        try:
            scheduling_days = json.loads(settings.scheduling_days_json or "[]")
        except (TypeError, ValueError):
            scheduling_days = []
        try:
            preferred_tags = json.loads(settings.preferred_tags_json or "[]")
        except (TypeError, ValueError):
            preferred_tags = []
        scheduling_days_text = ", ".join(str(item) for item in scheduling_days) or "all days"
        preferred_tags_text = ", ".join(str(item) for item in preferred_tags) or "none"
        return (
            f"Current UTC datetime: {now_utc.isoformat()}. "
            f"Current local datetime: {now_local.isoformat()} ({daemon_timezone_name()}, "
            f"UTC{sign}{abs(offset_hours):g}). "
            "Every tool argument that takes a datetime is naive UTC with no timezone suffix, "
            "in ISO 8601 format (e.g. 2026-09-04T22:00:00) -- always include the date, never a "
            "bare time like '22:00'. The user always speaks in LOCAL time; every datetime tool "
            "argument must be UTC. To convert, SUBTRACT the local offset from the local time "
            f"(never add it): local time minus UTC{sign}{abs(offset_hours):g} equals UTC time. "
            f"Worked example using today's date: local {example_local.isoformat()} "
            f"-> UTC {example_utc.isoformat()}. "
            f"Scheduling preferences: local {settings.scheduling_day_start}-{settings.scheduling_day_end}, "
            f"minimum break {settings.minimum_break_minutes} minutes, "
            f"maximum daily planned time {settings.maximum_daily_minutes or 'unlimited'} minutes, "
            f"scheduling window {settings.scheduling_window_days} days, "
            f"allowed days {scheduling_days_text}, preferred tags {preferred_tags_text}."
        )

    def _recent_history(self, conversation_id: str, exclude_message_id: str | None = None) -> list[AIChatMessage]:
        rows = self.db.exec(
            select(AIChatMessage)
            .where(AIChatMessage.conversation_id == conversation_id)
            .order_by(AIChatMessage.position.desc())
            .limit(_HISTORY_LIMIT)
        ).all()
        rows = list(reversed(rows))
        # Confirmed by review: a flat row-count window can start mid-turn -- a tool-using turn
        # mints user + assistant(tool_calls) + N tool + assistant rows, so after ~4-5 such turns
        # the window's oldest surviving rows can be a ToolMessage (or the assistant reply after
        # one) whose parent tool-calling AIMessage already fell off the front. Anthropic/OpenAI
        # both reject a tool result with no matching tool call, which would otherwise turn every
        # later turn in a long-lived conversation into a hard failure. Trim to the nearest real
        # turn boundary (a `user` row) instead of an arbitrary row count.
        first_user_idx = next((i for i, r in enumerate(rows) if r.role == "user"), None)
        rows = rows[first_user_idx:] if first_user_idx is not None else []
        if exclude_message_id:
            rows = [r for r in rows if r.id != exclude_message_id]
        return rows

    def _history_to_langchain(self, messages: list[AIChatMessage]) -> list[Any]:
        out: list[Any] = []
        for m in messages:
            if m.role == "user":
                out.append(HumanMessage(content=m.content))
            elif m.role == "assistant":
                tool_calls = json.loads(m.tool_calls_json) if m.tool_calls_json else []
                out.append(AIMessage(content=m.content, tool_calls=tool_calls))
            elif m.role == "tool":
                out.append(ToolMessage(content=m.content, tool_call_id=m.tool_call_id or "", name=m.tool_name))
            elif m.role == "system":
                out.append(SystemMessage(content=m.content))
        return out

    def _persist_new_messages(
        self,
        conversation_id: str,
        new_messages: list[Any],
        provider_config: AIProviderConfig,
        latency_ms: int,
    ) -> AIChatMessage | None:
        """Persists every message the agent produced this turn, in order, and returns the FINAL
        assistant message (the one that gets `provider`/`model`/token counts/`latency_ms`,
        matching spec S7's "record ... on the assistant message", singular)."""
        final_msg: AIChatMessage | None = None
        for index, m in enumerate(new_messages):
            is_last = index == len(new_messages) - 1
            if isinstance(m, ToolMessage):
                self.add_message(
                    conversation_id,
                    role="tool",
                    content=_stringify_content(m.content),
                    tool_call_id=getattr(m, "tool_call_id", None),
                    tool_name=getattr(m, "name", None),
                )
            elif isinstance(m, AIMessage):
                tool_calls_json = json.dumps(m.tool_calls, default=str) if getattr(m, "tool_calls", None) else None
                kwargs: dict[str, Any] = {}
                if is_last:
                    usage = getattr(m, "usage_metadata", None) or {}
                    kwargs = {
                        "provider": provider_config.provider,
                        "model": provider_config.model,
                        "input_tokens": usage.get("input_tokens"),
                        "output_tokens": usage.get("output_tokens"),
                        "latency_ms": latency_ms,
                    }
                final_msg = self.add_message(
                    conversation_id,
                    role="assistant",
                    content=_stringify_content(m.content),
                    tool_calls_json=tool_calls_json,
                    **kwargs,
                )
            # SystemMessage / other message types are not expected in agent output and are
            # skipped rather than persisted.
        return final_msg

    def _finalize_batch(self, batch_id: str, final_msg: AIChatMessage | None) -> AIDraftBatch | None:
        """Attaches `draft_batch_id` to the final assistant message when the turn produced at
        least one draft item; otherwise deletes the empty batch row (see module docstring)."""
        batch = self.db.get(AIDraftBatch, batch_id)
        if not batch:
            return None
        # Draft tools intentionally use short-lived sessions because LangGraph may dispatch
        # them concurrently. Refresh the batch before deciding whether it is empty; otherwise
        # this request session can still hold the zero item_count written at batch creation and
        # delete a batch whose tool session has just added real draft items.
        self.db.refresh(batch)
        if (batch.item_count or 0) > 0:
            if final_msg is not None:
                final_msg.draft_batch_id = batch.id
                self.db.add(final_msg)
                self.db.commit()
                self.db.refresh(final_msg)
            return batch
        self.db.delete(batch)
        self.db.commit()
        return None


__all__ = ["AIChatService"]
