from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from timetrace.core.ai.pi_model import PiChatModel, build_pi_model
from timetrace.core.ai.providers import KNOWN_PROVIDERS, get_chat_model
from timetrace.core.exceptions import AIProviderError


def test_pi_is_a_provider_and_uses_the_exact_model_id():
    assert "pi" in KNOWN_PROVIDERS
    model = build_pi_model(model="openai-codex/gpt-6-astra")
    assert isinstance(model, PiChatModel)
    assert model.model == "openai-codex/gpt-6-astra"
    assert isinstance(get_chat_model(provider="pi", model="openai-codex/gpt-6-astra"), PiChatModel)


def test_pi_rejects_time_trace_credentials_and_invalid_model_ids():
    for kwargs in (
        {"model": "gpt-6-astra"},
        {"model": "openai-codex/gpt-6-astra", "api_key": "secret"},
        {"model": "openai-codex/gpt-6-astra", "base_url": "http://localhost"},
    ):
        try:
            build_pi_model(**kwargs)
        except AIProviderError:
            pass
        else:
            raise AssertionError("invalid Pi configuration was accepted")


def test_pi_result_preserves_reasoning_signatures_for_replay():
    model = PiChatModel(model="openai-codex/gpt-6-astra")
    result = model._result(
        {
            "stopReason": "stop",
            "content": [
                {"type": "thinking", "thinking": "plan", "thinkingSignature": "opaque"},
                {"type": "text", "text": "done", "textSignature": "sig"},
            ],
            "usage": {"input": 1, "output": 2, "cacheRead": 0, "cacheWrite": 0},
        }
    )

    assert result.generations[0].message.content[0]["thinkingSignature"] == "opaque"
    assert result.generations[0].message.content[1]["text"] == "done"


def test_pi_payload_preserves_tool_call_history():
    model = PiChatModel(model="openai-codex/gpt-6-astra")
    messages = [
        HumanMessage(content="Find my task"),
        AIMessage(
            content="",
            tool_calls=[{"name": "list_tasks", "args": {"query": "task"}, "id": "call-1", "type": "tool_call"}],
        ),
        ToolMessage(content='[{"id":"task-1"}]', tool_call_id="call-1", name="list_tasks"),
    ]

    payload = model._payload(
        messages, None, tools=[{"name": "list_tasks", "description": "List tasks", "parameters": {}}]
    )

    assert payload["messages"][1]["tool_calls"][0]["name"] == "list_tasks"
    assert payload["messages"][2]["tool_call_id"] == "call-1"
    assert payload["tools"][0]["name"] == "list_tasks"
