"""Provider abstraction (`init_chat_model` wiring plus the Pi ModelRuntime adapter).

Layering (spec S5: "core/ free of FastAPI and SQLModel"): `services/ai_provider_service.py`
already has a `build_chat_model` helper, but it can't be imported here -- `services/` imports
`core/`, never the reverse, and importing it from `core/ai/providers.py` would invert that
dependency direction. Instead this module takes already-extracted plain values (provider name,
model, base url, decrypted api key, temperature, etc.) rather than an `AIProviderConfig` ORM
object; the ORM-to-plain-values extraction and Fernet decryption stay the caller's job (a later
chat-service track reading an `AIProviderConfig` row).

This means the OpenRouter `base_url` routing logic (`model_provider="openai"` unless
`use_native_openrouter`) is duplicated here in a DB-free form rather than shared with
`ai_provider_service.build_chat_model`. That's deliberate, not an oversight: the two functions
serve different layers (one is DB-aware and returns/consumes `AIProviderConfig`, this one is
pure and agent-facing) and the duplicated logic is a few lines that change together only if
OpenRouter's routing convention itself changes -- an actual shared helper would need to live in
a third module either both of these already depend on, which doesn't exist and isn't worth
inventing for four lines.
"""

from typing import Any

from timetrace.core.ai.pi_model import build_pi_model

KNOWN_PROVIDERS = ("anthropic", "openai", "openrouter", "ollama", "google", "groq", "pi")

# `init_chat_model`'s provider registry key for direct Google AI Studio access is "google_genai"
# (-> `langchain_google_genai.ChatGoogleGenerativeAI`), not "google" -- "google_vertexai"/
# "google_anthropic_vertex" are the separate Vertex AI routes we deliberately don't offer here.
# "google" is this app's own, shorter, user-facing provider name; this is the one place that
# translates it.
_MODEL_PROVIDER_OVERRIDES = {"google": "google_genai"}


def get_chat_model(
    *,
    provider: str,
    model: str,
    base_url: str | None = None,
    api_key: str | None = None,
    temperature: float = 0.0,
    max_output_tokens: int | None = None,
    request_timeout_seconds: int | None = None,
    use_native_openrouter: bool = False,
    extra_params: dict[str, Any] | None = None,
) -> Any:
    """Builds a runnable LangChain chat model from plain provider parameters, via
    `langchain.chat_models.init_chat_model` (spec S3 verified API surface).

    Callers (the chat-service track) are responsible for reading an `AIProviderConfig` row and
    decrypting `api_key_encrypted` (`core/ai/secrets.py: decrypt_secret`) before calling this --
    this function never touches the DB or the encryption layer.

    OpenRouter needs no extra package unless `use_native_openrouter` is set: by default it's
    routed through `model_provider="openai"` with OpenRouter's base URL (spec S3); the native
    `langchain-openrouter` provider is opt-in, pre-1.0, and not a pinned dependency, so selecting
    it without the package installed will surface as a normal connectivity failure rather than an
    import error here.

    Groq needs no extra package at all: its API is fully OpenAI-compatible
    (`https://api.groq.com/openai/v1`), which is exactly how Groq's own docs recommend using it
    (`from openai import OpenAI`, custom `base_url`). Unlike OpenRouter this has no native-package
    opt-in -- there's no meaningful upside to `langchain_groq` over the OpenAI-compatible route
    for this app, so it isn't offered.
    """
    if provider not in KNOWN_PROVIDERS:
        raise ValueError(f"Unknown provider '{provider}'. Expected one of {KNOWN_PROVIDERS}.")
    if provider == "pi":
        return build_pi_model(
            model=model,
            base_url=base_url,
            api_key=api_key,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            request_timeout_seconds=request_timeout_seconds or 120,
            use_native_openrouter=use_native_openrouter,
            extra_params=extra_params,
        )

    model_provider = _MODEL_PROVIDER_OVERRIDES.get(provider, provider)
    resolved_base_url = base_url
    if provider == "openrouter" and not use_native_openrouter:
        model_provider = "openai"
        resolved_base_url = base_url or "https://openrouter.ai/api/v1"
    elif provider == "groq":
        model_provider = "openai"
        resolved_base_url = base_url or "https://api.groq.com/openai/v1"

    kwargs: dict[str, Any] = dict(extra_params or {})
    if resolved_base_url:
        kwargs["base_url"] = resolved_base_url
    if api_key:
        kwargs["api_key"] = api_key
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_output_tokens:
        kwargs["max_tokens"] = max_output_tokens
    if request_timeout_seconds:
        kwargs["timeout"] = request_timeout_seconds

    from langchain.chat_models import init_chat_model

    return init_chat_model(model=model, model_provider=model_provider, **kwargs)


__all__ = ["get_chat_model", "KNOWN_PROVIDERS"]
