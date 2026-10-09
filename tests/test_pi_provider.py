import json

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

import timetrace.core.ai.pi_model as pi_model
from timetrace.core.ai.pi_model import PiChatModel, build_pi_model
from timetrace.core.ai.providers import KNOWN_PROVIDERS, get_chat_model
from timetrace.core.exceptions import AIProviderError


def test_pi_is_a_provider_and_uses_the_exact_model_id():
    assert "pi" in KNOWN_PROVIDERS
    model = build_pi_model(model="openai-codex/gpt-6-astra")
    assert isinstance(model, PiChatModel)
    assert model.model == "openai-codex/gpt-6-astra"
    assert isinstance(get_chat_model(provider="pi", model="openai-codex/gpt-6-astra"), PiChatModel)


def test_command_discovers_standard_managed_pi_install(monkeypatch, tmp_path):
    home = tmp_path / "home"
    install_root = home / ".pi" / "agent" / "install"
    package = install_root / "releases" / "1.1.0" / "node_modules" / "@earendil-works" / "pi-coding-agent"
    (package / "dist").mkdir(parents=True)
    (install_root / "current-version").write_text("1.1.0")
    (package / "package.json").write_text(json.dumps({"name": "@earendil-works/pi-coding-agent"}))
    (package / "dist" / "index.js").touch()

    monkeypatch.setattr(pi_model.Path, "home", classmethod(lambda cls: home))
    monkeypatch.delenv("TIMETRACE_PI_PACKAGE_DIR", raising=False)
    monkeypatch.delenv("PI_MANAGED_INSTALL_ROOT", raising=False)
    monkeypatch.setattr(pi_model.shutil, "which", lambda name: f"/usr/bin/{name}")

    assert pi_model._command() == [
        "/usr/bin/node",
        str(pi_model.Path(pi_model.__file__).with_name("pi_bridge.mjs")),
        str((package / "dist" / "index.js").resolve()),
    ]


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
