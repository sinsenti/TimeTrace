"""Characterize the JSON/SSE chat contracts using fake agents and real draft gateways."""

import json
from datetime import datetime

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage

import timetrace.services.ai_chat_service as chat_module
import timetrace.services.ai_tool_gateway as gateway_module
from timetrace.db.models import AIProviderConfig
from timetrace.services.ai_chat_service import AIChatService


def _events(response):
    events = []
    for frame in response.text.strip().split("\n\n"):
        name, data = frame.splitlines()
        events.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return events


class FakeAgent:
    def __init__(self):
        self.calls = []
        self.messages = []
        self.propose = False
        self.remember = False
        self.failure = False
        self.partial_failure = False
        self.batches_during_execution = None

    def execute(self, payload, context):
        self.calls.append(payload["messages"])
        if self.batches_during_execution is not None:
            assert len(self.batches_during_execution()) == 1
        if self.remember:
            context.gateway.propose_remembered_instruction("Use mornings for focused work.")
        if self.propose:
            context.gateway.propose_create_session(
                task_id=None,
                start_time=datetime(2026, 9, 10, 9),
                end_time=datetime(2026, 9, 10, 10),
            )
        if self.failure:
            raise RuntimeError("SECRET provider response and prompt")
        return self.messages

    async def ainvoke(self, payload, *, context):
        messages = self.execute(payload, context)
        if self.partial_failure:
            raise RuntimeError("SECRET provider failure after a reply")
        return {"messages": [*payload["messages"], *messages]}

    async def astream(self, payload, *, context, **kwargs):
        assert kwargs == {"stream_mode": ["messages", "updates"], "version": "v2"}
        messages = self.execute(payload, context)
        # Tool output and non-text blocks must never appear as assistant tokens.
        yield {"type": "messages", "data": (ToolMessage(content="PRIVATE tool result", tool_call_id="call-1"), {})}
        yield {"type": "messages", "data": (AIMessageChunk(content=[{"type": "tool_use", "id": "hidden"}]), {})}
        yield {"type": "messages", "data": (AIMessageChunk(content="Hello "), {})}
        yield {"type": "messages", "data": (AIMessageChunk(content="again."), {})}
        for message in messages:
            node = "tools" if isinstance(message, ToolMessage) else "model"
            yield {"type": "updates", "data": {node: {"messages": [message]}}}
        if self.partial_failure:
            raise RuntimeError("SECRET provider failure after a reply")


@pytest.fixture
def chat(db, client, monkeypatch):
    db.add(AIProviderConfig(name="fake", provider="ollama", model="fake-model", is_active=True))
    db.commit()
    agent = FakeAgent()
    options = []

    def build(_model, **kwargs):
        options.append(kwargs)
        return agent

    monkeypatch.setattr(chat_module, "get_chat_model", lambda **kwargs: object())
    monkeypatch.setattr(chat_module, "build_agent", build)
    monkeypatch.setattr(gateway_module, "engine", db.get_bind())
    return AIChatService(db), client, agent, options


@pytest.mark.parametrize("stream", [False, True], ids=["json", "sse"])
def test_chat_persists_tool_transcript_and_usage_with_single_agent_execution(chat, stream):
    service, client, agent, _options = chat
    conversation = service.create_conversation()
    tool_calls = [{"name": "list_tasks", "args": {}, "id": "call-1", "type": "tool_call"}]
    agent.messages = [
        AIMessage(content="", tool_calls=tool_calls),
        ToolMessage(content='{"tasks": []}', tool_call_id="call-1", name="list_tasks"),
        SystemMessage(content="not a persisted reply"),
        AIMessage(
            content=[{"type": "text", "text": "Hello again."}],
            usage_metadata={"input_tokens": 11, "output_tokens": 3, "total_tokens": 14},
        ),
    ]

    response = client.post(
        f"/api/ai/conversations/{conversation.id}/messages", json={"text": "Hello", "stream": stream}
    )
    assert response.status_code == 200
    if stream:
        events = _events(response)
        assert [name for name, _ in events] == [
            "message_start",
            "status",
            "token",
            "token",
            "status",
            "status",
            "status",
            "status",
            "message_end",
        ]
        assert [data["text"] for name, data in events if name == "token"] == ["Hello ", "again."]
        assert [data["message"] for name, data in events if name == "status"] == [
            "thinking",
            "thinking",
            "running tools",
            "thinking",
            "thinking",
        ]
        final = events[-1][1]
    else:
        result = response.json()
        assert result["draft_batch"] is None
        assert result["instruction_proposal"] is None
        final = result["message"]

    detail = client.get(f"/api/ai/conversations/{conversation.id}").json()
    assert [(m["role"], m["content"]) for m in detail["messages"]] == [
        ("user", "Hello"),
        ("assistant", ""),
        ("tool", '{"tasks": []}'),
        ("assistant", "Hello again."),
    ]
    assert json.loads(detail["messages"][1]["tool_calls_json"]) == tool_calls
    assert detail["messages"][2]["tool_call_id"] == "call-1"
    assert detail["messages"][2]["tool_name"] == "list_tasks"
    assert detail["messages"][-1]["id"] == final["id"]
    assert (final["provider"], final["model"], final["input_tokens"], final["output_tokens"]) == (
        "ollama",
        "fake-model",
        11,
        3,
    )
    assert final["latency_ms"] >= 0
    assert final["error"] is None
    assert detail["message_count"] == 4
    assert (detail["total_input_tokens"], detail["total_output_tokens"]) == (11, 3)
    assert client.get("/api/ai/drafts/batches").json() == []
    assert len(agent.calls) == 1
    assert agent.calls[0] == [HumanMessage(content="Hello")]


@pytest.mark.parametrize("stream", [False, True], ids=["json", "sse"])
@pytest.mark.parametrize(
    "fails", [None, "before-reply", "after-reply"], ids=["success", "provider-error", "partial-error"]
)
def test_chat_retains_batch_written_by_tool_session_even_on_failure(chat, stream, fails, caplog):
    service, client, agent, _options = chat
    conversation = service.create_conversation(intent="schedule")
    agent.messages = [AIMessage(content="A proposed session.")]
    agent.propose = True
    agent.remember = True
    agent.failure = fails == "before-reply"
    agent.partial_failure = fails == "after-reply"
    agent.batches_during_execution = service.list_draft_batches
    response = client.post(
        f"/api/ai/conversations/{conversation.id}/messages",
        json={"text": "Remember this for future conversations: use mornings.", "stream": stream},
    )
    if fails:
        if stream:
            names = [name for name, _ in _events(response)]
            if fails == "before-reply":
                assert names == ["message_start", "status", "error"]
            else:
                assert names == ["message_start", "status", "token", "token", "status", "error"]
            assert _events(response)[-1][1] == {"message": "AI provider call failed."}
        else:
            assert response.status_code == 502
            assert response.json() == {"detail": "AI provider call failed."}
    elif stream:
        assert [name for name, _ in _events(response)][-3:] == ["draft", "instruction_proposal", "message_end"]
    else:
        assert response.status_code == 200
        assert response.json()["draft_batch"]["item_count"] == 1
        assert response.json()["instruction_proposal"]["status"] == "pending"

    detail = client.get(f"/api/ai/conversations/{conversation.id}").json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][-1]["content"] == ("" if fails else "A proposed session.")
    proposal = detail["instruction_proposals"][0]
    assert proposal["status"] == ("failed" if fails else "pending")
    batches = client.get("/api/ai/drafts/batches").json()
    assert len(batches) == 1
    batch = client.get(f"/api/ai/drafts/batches/{batches[0]['id']}").json()
    assert batch["source_message_id"] == detail["messages"][0]["id"]
    assert batch["intent"] == "schedule"
    assert batch["items"][0]["status"] == "pending"
    assert batch["items"][0]["entity_type"] == "session"
    assert detail["messages"][-1]["draft_batch_id"] == (None if fails else batch["id"])
    assert detail["messages"][-1]["error"] == ("AI provider call failed." if fails else None)
    assert client.get("/sessions").json() == []
    assert client.get("/api/ai/settings").json()["custom_instructions"] == ""
    assert "SECRET" not in caplog.text
    assert "SECRET" not in json.dumps(detail)
    assert "SECRET" not in response.text
    assert len(agent.calls) == 1


@pytest.mark.parametrize("stream", [False, True], ids=["json", "sse"])
@pytest.mark.parametrize("messages", [[], [AIMessage(content="")]], ids=["no-reply", "empty-reply"])
def test_chat_empty_response_cleans_eager_batch(chat, stream, messages):
    service, client, agent, _options = chat
    conversation = service.create_conversation()
    agent.messages = messages
    agent.batches_during_execution = service.list_draft_batches
    response = client.post(
        f"/api/ai/conversations/{conversation.id}/messages", json={"text": "Hello", "stream": stream}
    )
    assert response.status_code == 200
    final = _events(response)[-1][1] if stream else response.json()["message"]
    assert final["content"] == ""
    assert final["error"] == (None if messages else "model produced no response")
    assert service.get_conversation_detail(conversation.id).message_count == 2
    assert client.get("/api/ai/drafts/batches").json() == []
    assert len(agent.calls) == 1


@pytest.mark.parametrize("stream", [False, True], ids=["json", "sse"])
def test_chat_replays_bounded_history_in_turn_order_and_sanitizes_current_input(chat, stream):
    service, client, agent, options = chat
    conversation = service.create_conversation()
    for index in range(6):
        service.add_message(conversation.id, role="user", content=f"Question {index}")
        service.add_message(
            conversation.id,
            role="assistant",
            content="",
            tool_calls_json=json.dumps([{"name": "list_tasks", "args": {}, "id": f"call-{index}"}]),
        )
        service.add_message(
            conversation.id, role="tool", content="[]", tool_call_id=f"call-{index}", tool_name="list_tasks"
        )
        service.add_message(conversation.id, role="assistant", content=f"Answer {index}")
    assert client.put("/api/ai/settings", json={"custom_instructions": "Keep replies short."}).status_code == 200
    agent.messages = [AIMessage(content="Done.")]
    response = client.post(
        f"/api/ai/conversations/{conversation.id}/messages",
        json={"text": "Ask jane@example.com about 2026-09-10", "stream": stream},
    )
    assert response.status_code == 200
    expected = []
    # The 20-row window starts mid-turn; discard the orphaned turn, not its tool result alone.
    for index in range(2, 6):
        expected.extend(
            [
                HumanMessage(content=f"Question {index}"),
                AIMessage(content="", tool_calls=[{"name": "list_tasks", "args": {}, "id": f"call-{index}"}]),
                ToolMessage(content="[]", tool_call_id=f"call-{index}", name="list_tasks"),
                AIMessage(content=f"Answer {index}"),
            ]
        )
    expected.append(HumanMessage(content="Ask [redacted-email] about 2026-09-10"))
    assert agent.calls == [expected]
    assert options[0]["custom_instructions"] == "Keep replies short."
    assert options[0]["sanitization_level"] == "standard"
    assert "Current UTC datetime:" in options[0]["extra_system_context"]
    detail = client.get(f"/api/ai/conversations/{conversation.id}").json()
    assert detail["messages"][-2]["content"] == "Ask [redacted-email] about 2026-09-10"


@pytest.mark.parametrize("stream", [False, True], ids=["json", "sse"])
def test_chat_remember_gate_uses_original_message_not_sanitized_future_intent(chat, stream, monkeypatch):
    service, client, agent, _options = chat
    conversation = service.create_conversation()
    agent.remember = True
    monkeypatch.setattr(chat_module, "sanitize_text", lambda text: "From now on, use mornings.")
    response = client.post(
        f"/api/ai/conversations/{conversation.id}/messages", json={"text": "I prefer mornings.", "stream": stream}
    )
    if stream:
        assert _events(response)[-1] == ("error", {"message": "AI provider call failed."})
    else:
        assert response.status_code == 502
    detail = client.get(f"/api/ai/conversations/{conversation.id}").json()
    assert detail["instruction_proposals"] == []
    assert detail["messages"][-1]["error"] == "AI provider call failed."
    assert client.get("/api/ai/drafts/batches").json() == []


@pytest.mark.parametrize("stream", [False, True], ids=["json", "sse"])
def test_chat_initialization_failure_cleans_batch_without_persisting_assistant_error(chat, stream, monkeypatch, caplog):
    service, client, agent, _options = chat
    conversation = service.create_conversation()

    def fail(**kwargs):
        raise RuntimeError("SECRET credentials and provider body")

    monkeypatch.setattr(chat_module, "get_chat_model", fail)
    response = client.post(
        f"/api/ai/conversations/{conversation.id}/messages", json={"text": "Hello", "stream": stream}
    )
    if stream:
        assert [name for name, _ in _events(response)] == ["message_start", "error"]
        assert _events(response)[-1][1] == {"message": "Failed to initialize the AI provider."}
    else:
        assert response.status_code == 502
        assert response.json() == {"detail": "Failed to initialize provider 'ollama'."}
    detail = service.get_conversation_detail(conversation.id)
    assert [(m.role, m.content) for m in detail.messages] == [("user", "Hello")]
    assert client.get("/api/ai/drafts/batches").json() == []
    assert agent.calls == []
    assert "SECRET" not in caplog.text + response.text
