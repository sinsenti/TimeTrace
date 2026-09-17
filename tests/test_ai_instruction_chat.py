import json
from datetime import datetime

import pytest
from langchain_core.messages import AIMessage
from sqlmodel import select

import timetrace.services.ai_chat_service as ai_chat_service
import timetrace.services.ai_tool_gateway as ai_tool_gateway
from timetrace.core.exceptions import AIProviderError, ValidationError
from timetrace.db.models import AIDraftBatch, AIDraftItem, AIInstructionProposal, AIProviderConfig, AISettings, Session
from timetrace.services.ai_chat_service import AIChatService
from timetrace.services.ai_instruction_service import AIInstructionService


class _FakeAgent:
    def __init__(self, mode: str):
        self.mode = mode

    def _call_tool(self, context):
        if self.mode == "instruction":
            context.gateway.propose_remembered_instruction("Prefer mornings for focused work.")
        elif self.mode == "session":
            context.gateway.propose_create_session(
                task_id=None,
                start_time=datetime(2026, 9, 10, 9),
                end_time=datetime(2026, 9, 10, 10),
                rationale="An explicit draft-only regression test.",
            )
        elif self.mode == "failure_after_instruction":
            context.gateway.propose_remembered_instruction("Do not leak this proposal text.")
            raise RuntimeError("provider response contains secret prompt text")

    async def ainvoke(self, payload, *, context):
        self._call_tool(context)
        if self.mode == "failure":
            raise RuntimeError("provider response contains secret prompt text")
        messages = [*payload["messages"], AIMessage(content="I proposed this for your review.")]
        return {"messages": messages}

    async def astream(self, payload, *, context, **_kwargs):
        self._call_tool(context)
        if self.mode == "failure_after_instruction":
            raise RuntimeError("provider response contains secret prompt text")
        text = "I proposed this for your review."
        yield {"type": "messages", "data": (AIMessage(content=text), {})}
        yield {"type": "updates", "data": {"agent": {"messages": [AIMessage(content=text)]}}}


def _configure_fake_chat(db, monkeypatch, mode: str):
    provider = AIProviderConfig(name="fake", provider="ollama", model="fake-model", is_active=True)
    db.add(provider)
    db.commit()
    monkeypatch.setattr(ai_chat_service, "build_agent", lambda *_args, **_kwargs: _FakeAgent(mode))
    monkeypatch.setattr(AIChatService, "_build_model", lambda self, _config: object())
    monkeypatch.setattr(ai_tool_gateway, "engine", db.get_bind())


def _sse_events(chunks: list[str]) -> list[tuple[str, dict]]:
    events = []
    for chunk in "".join(chunks).split("\n\n"):
        if not chunk.strip():
            continue
        lines = chunk.splitlines()
        event = next(line.removeprefix("event: ") for line in lines if line.startswith("event: "))
        data = next(line.removeprefix("data: ") for line in lines if line.startswith("data: "))
        events.append((event, json.loads(data)))
    return events


@pytest.mark.asyncio
async def test_remembered_instruction_turn_is_proposal_only_and_has_no_empty_batch(db, monkeypatch):
    _configure_fake_chat(db, monkeypatch, "instruction")
    conversation = AIChatService(db).create_conversation()

    response = await AIChatService(db).run_turn(
        conversation.id,
        "Remember this for future conversations: prefer mornings.",
    )

    assert response.instruction_proposal is not None
    assert response.instruction_proposal.status == "pending"
    assert response.instruction_proposal.proposed_instruction == "Prefer mornings for focused work."
    assert response.draft_batch is None
    assert db.exec(select(AISettings)).first().custom_instructions == ""
    assert db.exec(select(AIDraftItem)).all() == []
    assert db.exec(select(AIDraftBatch)).all() == []


@pytest.mark.asyncio
async def test_normal_chat_does_not_create_instruction_proposal(db, monkeypatch):
    _configure_fake_chat(db, monkeypatch, "ordinary")
    service = AIChatService(db)

    for text in ("I prefer mornings.", "Remember my dentist appointment."):
        conversation = service.create_conversation()
        response = await service.run_turn(conversation.id, text)
        assert response.instruction_proposal is None

    assert db.exec(select(AIInstructionProposal)).all() == []
    assert db.exec(select(AIDraftBatch)).all() == []


@pytest.mark.asyncio
async def test_proposal_tool_is_rejected_without_original_future_intent(db, monkeypatch):
    _configure_fake_chat(db, monkeypatch, "instruction")
    conversation = AIChatService(db).create_conversation()

    with pytest.raises(AIProviderError, match="AI provider call failed"):
        await AIChatService(db).run_turn(conversation.id, "I prefer mornings.")

    assert db.exec(select(AIInstructionProposal)).all() == []
    assert db.exec(select(AIDraftBatch)).all() == []


@pytest.mark.asyncio
async def test_streaming_instruction_proposal_matches_non_streaming_and_precedes_end(db, monkeypatch):
    _configure_fake_chat(db, monkeypatch, "instruction")
    service = AIChatService(db)

    non_streaming = await service.run_turn(
        service.create_conversation().id,
        "Remember this for future conversations: prefer mornings.",
    )
    streaming_chunks = [
        chunk
        async for chunk in service.run_turn_stream(
            service.create_conversation().id,
            "Remember this for future conversations: prefer mornings.",
        )
    ]
    events = _sse_events(streaming_chunks)
    names = [name for name, _data in events]
    proposal_events = [data for name, data in events if name == "instruction_proposal"]

    assert len(proposal_events) == 1
    assert "draft" not in names
    assert names.index("instruction_proposal") < names.index("message_end")
    assert proposal_events[0]["proposed_instruction"] == non_streaming.instruction_proposal.proposed_instruction
    assert proposal_events[0]["before_instructions"] == non_streaming.instruction_proposal.before_instructions
    assert proposal_events[0]["after_instructions"] == non_streaming.instruction_proposal.after_instructions
    assert db.exec(select(AIInstructionProposal)).all() and len(db.exec(select(AIInstructionProposal)).all()) == 2
    assert db.exec(select(AIDraftBatch)).all() == []


@pytest.mark.asyncio
async def test_failed_stream_marks_created_proposal_failed_without_sensitive_error_text(db, monkeypatch, caplog):
    _configure_fake_chat(db, monkeypatch, "failure_after_instruction")
    conversation = AIChatService(db).create_conversation()

    events = [
        chunk
        async for chunk in AIChatService(db).run_turn_stream(
            conversation.id,
            "Remember this for future conversations: do not leak this proposal text.",
        )
    ]

    parsed_events = _sse_events(events)
    assert parsed_events[-1] == ("error", {"message": "AI provider call failed."})
    assert db.exec(select(AIInstructionProposal)).one().status == "failed"
    assert "secret prompt text" not in caplog.text


@pytest.mark.asyncio
async def test_task_session_draft_tool_still_persists_a_draft_batch_not_instruction(db, monkeypatch):
    _configure_fake_chat(db, monkeypatch, "session")
    conversation = AIChatService(db).create_conversation()

    response = await AIChatService(db).run_turn(conversation.id, "Propose a focused work session.")

    assert response.instruction_proposal is None
    assert response.draft_batch is not None
    assert response.draft_batch.item_count == 1
    assert len(response.draft_batch.items) == 1
    assert response.draft_batch.items[0].entity_type == "session"
    assert db.exec(select(Session)).all() == []
    assert db.exec(select(AIInstructionProposal)).all() == []


@pytest.mark.asyncio
async def test_failed_turn_marks_created_proposal_failed_without_sensitive_error_text(db, monkeypatch, caplog):
    _configure_fake_chat(db, monkeypatch, "failure_after_instruction")
    conversation = AIChatService(db).create_conversation()

    with pytest.raises(AIProviderError, match="AI provider call failed"):
        await AIChatService(db).run_turn(
            conversation.id,
            "Remember this for future conversations: do not leak this proposal text.",
        )

    proposal = db.exec(select(AIInstructionProposal)).one()
    assert proposal.status == "failed"
    assert db.exec(select(AISettings)).first().custom_instructions == ""
    assert db.exec(select(AIDraftBatch)).all() == []
    assert "secret prompt text" not in caplog.text
    assistant_errors = [
        message.error for message in AIChatService(db).get_conversation_detail(conversation.id).messages
    ]
    assert "secret prompt text" not in " ".join(error or "" for error in assistant_errors)


def test_gateway_rejects_a_second_source_proposal_even_without_gateway_lock(db, monkeypatch):
    _configure_fake_chat(db, monkeypatch, "ordinary")
    service = AIInstructionService(db)
    service.create_proposal(
        conversation_id=None,
        source_message_id="same-source",
        instruction="Use mornings.",
    )

    with pytest.raises(ValidationError, match="one remembered-instruction proposal"):
        service.create_proposal(
            conversation_id=None,
            source_message_id="same-source",
            instruction="Use afternoons.",
        )
