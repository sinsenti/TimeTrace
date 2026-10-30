"""Provider construction at the SDK boundary; no network or Pi inference."""

import json
from types import SimpleNamespace

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage

from timetrace.core.ai.pi_model import PiChatModel
from timetrace.core.ai.providers import get_chat_model
from timetrace.core.exceptions import AIProviderError, EntityNotFoundError, ValidationError
from timetrace.services.ai_chat_service import AIChatService
from timetrace.services.ai_provider_service import AIProviderService, build_chat_model


@pytest.mark.parametrize("construct", [get_chat_model, build_chat_model])
@pytest.mark.parametrize(
    ("provider", "native", "routed_provider", "base_url"),
    [
        ("anthropic", False, "anthropic", None),
        ("openai", False, "openai", None),
        ("ollama", False, "ollama", None),
        ("google", False, "google_genai", None),
        ("openrouter", False, "openai", "https://openrouter.ai/api/v1"),
        ("openrouter", True, "openrouter", None),
        ("groq", False, "openai", "https://api.groq.com/openai/v1"),
    ],
)
def test_provider_routing_and_default_generation_options(
    monkeypatch, construct, provider, native, routed_provider, base_url
):
    monkeypatch.setattr("langchain.chat_models.init_chat_model", lambda **kwargs: SimpleNamespace(options=kwargs))

    model = construct(provider=provider, model="test-model", use_native_openrouter=native)

    expected = {"model": "test-model", "model_provider": routed_provider, "temperature": 0.0}
    if base_url:
        expected["base_url"] = base_url
    assert model.options == expected


@pytest.mark.parametrize("construct", [get_chat_model, build_chat_model])
@pytest.mark.parametrize("provider", ["anthropic", "openai", "ollama", "google", "openrouter", "groq"])
def test_explicit_provider_options_override_extras_without_mutating_them(monkeypatch, construct, provider):
    monkeypatch.setattr("langchain.chat_models.init_chat_model", lambda **kwargs: SimpleNamespace(options=kwargs))
    extras = {
        "base_url": "https://extra.invalid",
        "api_key": "extra-key",
        "temperature": 0.9,
        "max_tokens": 9999,
        "timeout": 999,
        "top_p": 0.8,
    }
    original = dict(extras)

    model = construct(
        provider=provider,
        model="test-model",
        base_url="https://explicit.invalid",
        api_key="test-key",
        temperature=0.4,
        max_output_tokens=512,
        request_timeout_seconds=45,
        extra_params=extras,
    )

    assert model.options == {
        "model": "test-model",
        "model_provider": {"google": "google_genai", "openrouter": "openai", "groq": "openai"}.get(provider, provider),
        "base_url": "https://explicit.invalid",
        "api_key": "test-key",
        "temperature": 0.4,
        "max_tokens": 512,
        "timeout": 45,
        "top_p": 0.8,
    }
    assert extras == original


@pytest.mark.parametrize("construct", [get_chat_model, build_chat_model])
@pytest.mark.parametrize("provider", ["openai", "openrouter", "groq"])
def test_unset_options_retain_extras_except_routed_defaults(monkeypatch, construct, provider):
    monkeypatch.setattr("langchain.chat_models.init_chat_model", lambda **kwargs: SimpleNamespace(options=kwargs))

    model = construct(
        provider=provider,
        model="test-model",
        base_url="",
        api_key="",
        max_output_tokens=0,
        request_timeout_seconds=0,
        extra_params={"base_url": "https://extra.invalid", "api_key": "extra-key", "max_tokens": 7, "timeout": 8},
    )

    assert (
        model.options["base_url"]
        == {
            "openai": "https://extra.invalid",
            "openrouter": "https://openrouter.ai/api/v1",
            "groq": "https://api.groq.com/openai/v1",
        }[provider]
    )
    assert model.options["api_key"] == "extra-key"
    assert model.options["temperature"] == 0.0
    assert model.options["max_tokens"] == 7
    assert model.options["timeout"] == 8


@pytest.mark.parametrize("construct", [get_chat_model, build_chat_model])
def test_pi_construction_preserves_exact_model_and_generation_options(construct):
    model = construct(
        provider="pi",
        model="openai-codex/gpt-6-astra",
        temperature=0.3,
        max_output_tokens=512,
        request_timeout_seconds=45,
    )

    assert isinstance(model, PiChatModel)
    assert model.model == "openai-codex/gpt-6-astra"
    assert model.temperature == 0.3
    assert model.max_output_tokens == 512
    assert model.request_timeout_seconds == 45
    assert construct(provider="pi", model="openai-codex/gpt-6-astra").request_timeout_seconds == 120


@pytest.mark.parametrize("construct", [get_chat_model, build_chat_model])
@pytest.mark.parametrize(
    "options",
    [{"model": "bare-model"}, {"api_key": "test-key"}, {"base_url": "https://invalid"}, {"extra_params": {"x": 1}}],
)
def test_pi_keeps_credentials_and_custom_endpoints_out_of_timetrace(construct, options):
    with pytest.raises(AIProviderError):
        construct(provider="pi", **{"model": "openai-codex/gpt-6-astra", **options})


@pytest.mark.parametrize("construct, error", [(get_chat_model, ValueError), (build_chat_model, ValidationError)])
def test_unknown_provider_preserves_caller_specific_validation(construct, error):
    with pytest.raises(error, match="Unknown provider 'unsupported'"):
        construct(provider="unsupported", model="test-model")


@pytest.mark.parametrize("saved", [False, True], ids=["inline", "saved"])
@pytest.mark.parametrize(
    "tokens, timeout, capped_tokens, capped_timeout", [(4096, 120, 16, 30), (8, 10, 8, 10), (0, 0, 16, 30)]
)
def test_connectivity_probe_decrypts_saved_keys_and_caps_generation(
    db, monkeypatch, saved, tokens, timeout, capped_tokens, capped_timeout
):
    constructed = []
    prompts = []

    def fake_init(**kwargs):
        constructed.append(kwargs)
        return SimpleNamespace(invoke=prompts.append)

    monkeypatch.setattr("langchain.chat_models.init_chat_model", fake_init)
    service = AIProviderService(db)
    config = {
        "provider": "openrouter",
        "model": "test-model",
        "base_url": "https://probe.invalid",
        "api_key": "test-key",
        "temperature": 0.2,
        "max_output_tokens": tokens,
        "request_timeout_seconds": timeout,
        "extra_params": {"max_tokens": 999, "timeout": 999, "top_p": 0.8},
    }
    if saved:
        stored = service.create_provider(name="test", **config)
        result = service.test_config(config_id=stored.id)
    else:
        result = service.test_config(inline_config=config)

    assert result == {"success": True, "error": None}
    assert prompts == ["Reply with a single word: pong"]
    assert constructed == [
        {
            "model": "test-model",
            "model_provider": "openai",
            "base_url": "https://probe.invalid",
            "api_key": "test-key",
            "temperature": 0.2,
            "max_tokens": capped_tokens,
            "timeout": capped_timeout,
            "top_p": 0.8,
        }
    ]


@pytest.mark.parametrize("stage", ["initialization", "invocation"])
@pytest.mark.parametrize("saved", [False, True], ids=["inline", "saved"])
def test_connectivity_probe_returns_provider_error_shape(db, monkeypatch, stage, saved):
    def fail(*args, **kwargs):
        raise RuntimeError("fake provider failure")

    monkeypatch.setattr(
        "langchain.chat_models.init_chat_model",
        fail if stage == "initialization" else lambda **kwargs: SimpleNamespace(invoke=fail),
    )
    service = AIProviderService(db)
    config = {"provider": "ollama", "model": "test-model"}
    if saved:
        stored = service.create_provider(name="test", **config)
        result = service.test_config(config_id=stored.id)
    else:
        result = service.test_config(inline_config=config)

    assert result == {"success": False, "error": "fake provider failure"}


def test_connectivity_probe_distinguishes_malformed_requests_from_provider_failures(db):
    service = AIProviderService(db)
    for request in ({}, {"inline_config": {}}, {"config_id": "id", "inline_config": {"provider": "ollama"}}):
        with pytest.raises(ValidationError):
            service.test_config(**request)
    with pytest.raises(EntityNotFoundError):
        service.test_config(config_id="missing")
    result = service.test_config(inline_config={"provider": "unsupported", "model": "test-model"})
    assert result["success"] is False
    assert result["error"].startswith("Unknown provider 'unsupported'")


@pytest.mark.parametrize("saved", [False, True], ids=["inline", "saved"])
def test_pi_probe_uses_pi_credentials_and_cheap_limits(db, monkeypatch, saved):
    requests = []

    def fake_run(payload, timeout):
        requests.append((payload, timeout))
        return {"stopReason": "stop", "content": [{"type": "text", "text": "pong"}], "usage": {"input": 1, "output": 1}}

    monkeypatch.setattr("timetrace.core.ai.pi_model._run", fake_run)
    service = AIProviderService(db)
    config = {"provider": "pi", "model": "openai-codex/gpt-6-astra"}
    if saved:
        stored = service.create_provider(name="test", **config)
        result = service.test_config(config_id=stored.id)
    else:
        result = service.test_config(inline_config=config)

    assert result == {"success": True, "error": None}
    assert len(requests) == 1
    payload, timeout = requests[0]
    assert payload["model"] == "openai-codex/gpt-6-astra"
    assert payload["maxTokens"] == 16
    assert timeout == 30
    assert "api_key" not in payload


class _ToolReadyFakeModel(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


@pytest.mark.parametrize("stream", [False, True], ids=["json", "sse"])
@pytest.mark.parametrize("initialization_fails", [False, True], ids=["success", "initialization-error"])
async def test_chat_constructs_configured_model_without_probe_caps(
    db, monkeypatch, stream, initialization_fails, caplog
):
    constructed = []

    def fake_init(**kwargs):
        constructed.append(kwargs)
        if initialization_fails:
            raise RuntimeError("private provider response and test-key")
        return _ToolReadyFakeModel(responses=[AIMessage(content="pong")])

    monkeypatch.setattr("langchain.chat_models.init_chat_model", fake_init)
    provider = AIProviderService(db).create_provider(
        name="test",
        provider="openrouter",
        model="test-model",
        api_key="test-key",
        temperature=0.6,
        max_output_tokens=2048,
        request_timeout_seconds=90,
        extra_params={"top_p": 0.8},
    )
    service = AIChatService(db)
    conversation = service.create_conversation(provider_config_id=provider.id)

    if stream:
        chunks = [chunk async for chunk in service.run_turn_stream(conversation.id, "Hello")]
        events = [(chunk.splitlines()[0][7:], json.loads(chunk.splitlines()[1][6:])) for chunk in chunks]
        if initialization_fails:
            assert events[-1] == ("error", {"message": "Failed to initialize the AI provider."})
        else:
            assert events[-1][0] == "message_end"
            assert events[-1][1]["content"] == "pong"
    elif initialization_fails:
        with pytest.raises(AIProviderError, match="^Failed to initialize provider 'openrouter'\\.$"):
            await service.run_turn(conversation.id, "Hello")
    else:
        response = await service.run_turn(conversation.id, "Hello")
        assert response.message.content == "pong"

    assert constructed == [
        {
            "model": "test-model",
            "model_provider": "openai",
            "base_url": "https://openrouter.ai/api/v1",
            "api_key": "test-key",
            "temperature": 0.6,
            "max_tokens": 2048,
            "timeout": 90,
            "top_p": 0.8,
        }
    ]
    detail = service.get_conversation_detail(conversation.id)
    assert [message.content for message in detail.messages] == (
        ["Hello"] if initialization_fails else ["Hello", "pong"]
    )
    assert "private provider response" not in caplog.text
    assert "test-key" not in caplog.text
