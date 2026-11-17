"""Public chat regression with the real agent/tools and a model-boundary fake only."""

import json
import logging

import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

import timetrace.services.ai_chat_service as ai_chat_service
from timetrace.main import create_daemon_app


class InstructionToolModel(BaseChatModel):
    instructions: list[str] = Field(default_factory=lambda: ["Prefer synthetic morning focus blocks."])
    tool_results: list[ToolMessage] = Field(default_factory=list)

    @property
    def _llm_type(self):
        return "synthetic-instruction-tool-result"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        if isinstance(messages[-1], ToolMessage):
            self.tool_results.append(messages[-1])
        if len(self.tool_results) < len(self.instructions):
            response = AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "propose_remembered_instruction",
                        "args": {"instruction": self.instructions[len(self.tool_results)]},
                        "id": f"synthetic-instruction-call-{len(self.tool_results) + 1}",
                        "type": "tool_call",
                    }
                ],
            )
        else:
            response = AIMessage(content="Synthetic follow-up, not evidence of tool success.")
        return ChatResult(generations=[ChatGeneration(message=response)])


@pytest.fixture(scope="module")
def root_client():
    # conftest redirects the real engine/timer/key directory before imports. Unlike the
    # usual client fixture, run lifespan migrations and use real request/tool DB sessions.
    root_logger = logging.getLogger()
    handlers, level = root_logger.handlers[:], root_logger.level
    try:
        with TestClient(create_daemon_app()) as client:
            # Startup reconfigures root logging; retain pytest's capture handlers.
            root_logger.handlers = handlers
            root_logger.setLevel(level)
            provider = client.post(
                "/api/ai/providers",
                json={"name": "Synthetic model only", "provider": "openai", "model": "synthetic-instruction"},
            )
            assert provider.status_code == 201
            activated = client.post(f"/api/ai/providers/{provider.json()['id']}/activate")
            assert activated.status_code == 200
            yield client
    finally:
        root_logger.handlers = handlers
        root_logger.setLevel(level)


def test_remembered_instruction_chat_delivers_successful_pending_tool_result(root_client, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="timetrace.ai")
    model = InstructionToolModel()
    monkeypatch.setattr(ai_chat_service, "get_chat_model", lambda **kwargs: model)
    created = root_client.post("/api/ai/conversations", json={})
    assert created.status_code == 201
    conversation_id = created.json()["id"]

    response = root_client.post(
        f"/api/ai/conversations/{conversation_id}/messages",
        json={
            "text": "Remember this for future conversations: Prefer synthetic morning focus blocks.",
            "stream": False,
        },
    )

    assert response.status_code == 200
    detail = root_client.get(f"/api/ai/conversations/{conversation_id}")
    assert detail.status_code == 200
    proposals = detail.json()["instruction_proposals"]
    assert len(proposals) == 1
    proposal = proposals[0]
    assert proposal["status"] == "pending"
    assert proposal["proposed_instruction"] == "Prefer synthetic morning focus blocks."
    proposal_read = root_client.get(f"/api/ai/instruction-proposals/{proposal['id']}")
    assert proposal_read.status_code == 200
    assert proposal_read.json() == proposal
    settings = root_client.get("/api/ai/settings")
    assert settings.status_code == 200
    assert settings.json()["custom_instructions"] == ""
    for path in ("/api/tasks", "/sessions"):
        rows = root_client.get(path)
        assert rows.status_code == 200
        assert rows.json() == []

    assert len(model.tool_results) == 1
    tool_result = model.tool_results[0]
    assert tool_result.name == "propose_remembered_instruction"
    assert tool_result.tool_call_id == "synthetic-instruction-call-1"
    assert tool_result.status == "success", tool_result.content
    result = json.loads(tool_result.content)
    assert result["id"] == proposal["id"]
    assert result["status"] == "pending"
    assert result["operation"] == "append"
    assert result["proposed_instruction"] == "Prefer synthetic morning focus blocks."
    assert result["before_instructions"] == ""
    assert result["after_instructions"] == "Prefer synthetic morning focus blocks."
    assert result["confirmation_message"] == (
        "I proposed this standing instruction. Save it to use it in future conversations."
    )
    persisted_tools = [message for message in detail.json()["messages"] if message["role"] == "tool"]
    assert len(persisted_tools) == 1
    assert json.loads(persisted_tools[0]["content"]) == result
    assert "AI tool call: name=propose_remembered_instruction argument_count=1" in caplog.text
    assert "AI tool result: name=propose_remembered_instruction result=dict[" in caplog.text
    assert "Prefer synthetic morning focus blocks." not in caplog.text
    assert result["confirmation_message"] not in caplog.text


@pytest.mark.parametrize(
    ("text", "instruction", "error"),
    [
        (
            "I prefer synthetic morning focus blocks.",
            "Prefer synthetic morning focus blocks.",
            "the original message did not clearly request a standing preference",
        ),
        (
            "Remember this for future conversations: prefer synthetic mornings.",
            "   ",
            "instruction must not be empty",
        ),
    ],
    ids=["missing-future-intent", "empty-instruction"],
)
def test_invalid_remembered_instruction_chat_returns_tool_error_without_proposal(
    root_client, monkeypatch, text, instruction, error
):
    model = InstructionToolModel(instructions=[instruction])
    monkeypatch.setattr(ai_chat_service, "get_chat_model", lambda **kwargs: model)
    created = root_client.post("/api/ai/conversations", json={})
    assert created.status_code == 201
    conversation_id = created.json()["id"]

    response = root_client.post(
        f"/api/ai/conversations/{conversation_id}/messages",
        json={"text": text, "stream": False},
    )

    assert response.status_code == 200
    assert len(model.tool_results) == 1
    assert model.tool_results[0].status == "error"
    assert error in model.tool_results[0].content
    detail = root_client.get(f"/api/ai/conversations/{conversation_id}")
    assert detail.status_code == 200
    assert detail.json()["instruction_proposals"] == []
    settings = root_client.get("/api/ai/settings")
    assert settings.status_code == 200
    assert settings.json()["custom_instructions"] == ""


def test_second_remembered_instruction_in_one_chat_turn_returns_tool_error(root_client, monkeypatch):
    model = InstructionToolModel(instructions=["Prefer synthetic mornings.", "Prefer synthetic afternoons."])
    monkeypatch.setattr(ai_chat_service, "get_chat_model", lambda **kwargs: model)
    created = root_client.post("/api/ai/conversations", json={})
    assert created.status_code == 201
    conversation_id = created.json()["id"]

    response = root_client.post(
        f"/api/ai/conversations/{conversation_id}/messages",
        json={"text": "Remember this for future conversations: prefer synthetic mornings.", "stream": False},
    )

    assert response.status_code == 200
    assert len(model.tool_results) == 2
    assert model.tool_results[0].status == "success"
    assert model.tool_results[1].status == "error"
    assert "only one remembered-instruction proposal is allowed per turn" in model.tool_results[1].content
    detail = root_client.get(f"/api/ai/conversations/{conversation_id}")
    assert detail.status_code == 200
    proposals = detail.json()["instruction_proposals"]
    assert len(proposals) == 1
    assert proposals[0]["id"] == json.loads(model.tool_results[0].content)["id"]
    assert proposals[0]["proposed_instruction"] == "Prefer synthetic mornings."
    assert proposals[0]["status"] == "pending"
    settings = root_client.get("/api/ai/settings")
    assert settings.status_code == 200
    assert settings.json()["custom_instructions"] == ""
