"""Provider config CRUD, exactly-one-active enforcement, model catalog/listing, and provider
connectivity testing for the AI assistant feature (spec S4 item 1 / S7 "Providers").

The service-level builder handles DB-backed LangChain providers. Pi is handled by the DB-free
`core.ai.pi_model` adapter, which delegates model authentication and inference to Pi's own
ModelRuntime without passing Pi credentials through this service.
"""

import json
from typing import Any

import httpx
from sqlmodel import Session, select

from timetrace.core.ai.pi_model import list_pi_models
from timetrace.core.ai.secrets import decrypt_secret, encrypt_secret, key_last4
from timetrace.core.exceptions import EntityNotFoundError, ValidationError
from timetrace.db.models import AIProviderConfig, AISettings, utc_now

KNOWN_PROVIDERS = ("anthropic", "openai", "openrouter", "ollama", "google", "groq", "pi")
KNOWN_SANITIZATION_LEVELS = ("off", "standard", "strict")

# See core/ai/providers.py's twin constant for why this translation exists: `init_chat_model`'s
# registry key for direct Google AI Studio access is "google_genai", not this app's shorter
# user-facing "google".
_MODEL_PROVIDER_OVERRIDES = {"google": "google_genai"}

# Sentinel distinguishing "argument omitted" (keep existing value) from an explicit value,
# including an explicit `None`/`""`. Needed for `update_provider`'s `api_key` semantics (S7):
# omitted = keep the stored key, "" = clear it.
_UNSET: Any = object()


def _validate_provider(provider: str) -> None:
    if provider not in KNOWN_PROVIDERS:
        raise ValidationError(f"Unknown provider '{provider}'. Expected one of {KNOWN_PROVIDERS}.")


def _validate_sanitization_level(level: str) -> None:
    if level not in KNOWN_SANITIZATION_LEVELS:
        raise ValidationError(f"Unknown sanitization_level '{level}'. Expected one of {KNOWN_SANITIZATION_LEVELS}.")


def build_chat_model(
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
    """Builds a runnable LangChain chat model from provider config fields via
    `langchain.chat_models.init_chat_model` (spec S3 verified API surface).

    OpenRouter needs no extra package unless `use_native_openrouter` is set: by default it's
    routed through `model_provider="openai"` with OpenRouter's base URL (spec S3); the native
    `langchain-openrouter` provider is opt-in and pre-1.0, and isn't a pinned dependency, so
    selecting it without the package installed surfaces as a normal `test_config` failure.

    Groq needs no extra package at all -- its API is fully OpenAI-compatible
    (`https://api.groq.com/openai/v1`, exactly as Groq's own docs recommend), so it's always
    routed through `model_provider="openai"` with no native-package opt-in.
    """
    _validate_provider(provider)
    if provider == "pi":
        from timetrace.core.ai.pi_model import build_pi_model

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


class AIProviderService:
    """CRUD + lifecycle for `AIProviderConfig` rows.

    Returns ORM model instances (matching this codebase's service convention, e.g.
    `SessionService.create_session`), never dicts, for the CRUD methods -- **except** that the
    encrypted key never leaves this class as plaintext. Callers building an API response must
    read `api_key_set = bool(config.api_key_encrypted)` and `config.api_key_last4`; they must
    never serialize `api_key_encrypted` itself into a response (spec S4 "API keys at rest").
    """

    def __init__(self, db: Session):
        self.db = db

    # -- internal helpers -----------------------------------------------------------------

    def _get_or_404(self, config_id: str) -> AIProviderConfig:
        config = self.db.get(AIProviderConfig, config_id)
        if config is None:
            raise EntityNotFoundError("AIProviderConfig", config_id)
        return config

    # -- CRUD -------------------------------------------------------------------------------

    def list_providers(self) -> list[AIProviderConfig]:
        return list(self.db.exec(select(AIProviderConfig).order_by(AIProviderConfig.created_at)).all())

    def get_provider(self, config_id: str) -> AIProviderConfig:
        return self._get_or_404(config_id)

    def create_provider(
        self,
        *,
        name: str,
        provider: str,
        model: str,
        base_url: str | None = None,
        api_key: str | None = None,
        temperature: float = 0.0,
        max_output_tokens: int = 4096,
        request_timeout_seconds: int = 120,
        sanitization_level: str = "standard",
        use_native_openrouter: bool = False,
        extra_params: dict[str, Any] | None = None,
    ) -> AIProviderConfig:
        _validate_provider(provider)
        _validate_sanitization_level(sanitization_level)

        config = AIProviderConfig(
            name=name,
            provider=provider,
            model=model,
            base_url=base_url,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            request_timeout_seconds=request_timeout_seconds,
            sanitization_level=sanitization_level,
            use_native_openrouter=use_native_openrouter,
            extra_params_json=json.dumps(extra_params or {}),
        )
        if api_key:
            config.api_key_encrypted = encrypt_secret(api_key)
            config.api_key_last4 = key_last4(api_key)

        self.db.add(config)
        self.db.commit()
        self.db.refresh(config)
        return config

    def update_provider(
        self,
        config_id: str,
        *,
        name: Any = _UNSET,
        provider: Any = _UNSET,
        model: Any = _UNSET,
        base_url: Any = _UNSET,
        api_key: Any = _UNSET,
        temperature: Any = _UNSET,
        max_output_tokens: Any = _UNSET,
        request_timeout_seconds: Any = _UNSET,
        sanitization_level: Any = _UNSET,
        use_native_openrouter: Any = _UNSET,
        extra_params: Any = _UNSET,
    ) -> AIProviderConfig:
        """Every field defaults to the `_UNSET` sentinel, meaning "leave alone" -- this is what
        lets `api_key` implement spec S7's exact semantics: **omit** the argument entirely to
        keep the existing encrypted key, pass `""` to clear it, pass a non-empty string to
        replace it. An explicit `None` is treated the same as omitted (kept), since a router
        layer built on a Pydantic model with a default of `None` cannot otherwise distinguish
        "field absent from the request body" from "field explicitly nulled" without
        `exclude_unset` bookkeeping of its own -- this service does not assume the caller did
        that, and "keep" is the only interpretation that can never silently wipe a working key.

        `is_active` is deliberately not a field here -- it is only ever changed via
        `activate_provider`, which owns the exactly-one-active invariant.
        """
        config = self._get_or_404(config_id)

        if name is not _UNSET:
            config.name = name
        if provider is not _UNSET:
            _validate_provider(provider)
            config.provider = provider
        if model is not _UNSET:
            config.model = model
        if base_url is not _UNSET:
            config.base_url = base_url
        if temperature is not _UNSET:
            config.temperature = temperature
        if max_output_tokens is not _UNSET:
            config.max_output_tokens = max_output_tokens
        if request_timeout_seconds is not _UNSET:
            config.request_timeout_seconds = request_timeout_seconds
        if sanitization_level is not _UNSET:
            _validate_sanitization_level(sanitization_level)
            config.sanitization_level = sanitization_level
        if use_native_openrouter is not _UNSET:
            config.use_native_openrouter = use_native_openrouter
        if extra_params is not _UNSET:
            config.extra_params_json = json.dumps(extra_params or {})

        if api_key is not _UNSET and api_key is not None:
            if api_key == "":
                config.api_key_encrypted = None
                config.api_key_last4 = None
            else:
                config.api_key_encrypted = encrypt_secret(api_key)
                config.api_key_last4 = key_last4(api_key)

        config.updated_at = utc_now()
        self.db.add(config)
        self.db.commit()
        self.db.refresh(config)
        return config

    def delete_provider(self, config_id: str) -> None:
        config = self._get_or_404(config_id)
        self.db.delete(config)
        self.db.commit()

    def activate_provider(self, config_id: str) -> AIProviderConfig:
        """Activates `config_id` and deactivates every other config in the same commit --
        `is_active` is indexed but not DB-constrained to a single true row, so this method is
        the entire enforcement mechanism (spec S4 item 1)."""
        target = self._get_or_404(config_id)

        others = self.db.exec(
            select(AIProviderConfig).where(
                AIProviderConfig.id != config_id,
                AIProviderConfig.is_active,
            )
        ).all()
        for other in others:
            other.is_active = False
            other.updated_at = utc_now()
            self.db.add(other)

        target.is_active = True
        target.updated_at = utc_now()
        self.db.add(target)

        self.db.commit()
        self.db.refresh(target)
        return target

    # -- connectivity test --------------------------------------------------------------

    def test_config(
        self,
        *,
        config_id: str | None = None,
        inline_config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Attempts a minimal real call against the provider so a bad key/model/base_url is
        caught before it's stored (spec S7). Accepts either a saved `config_id` or an unsaved
        `inline_config` dict with the same shape as `create_provider`'s keyword arguments --
        never both. Returns `{"success": bool, "error": str | None}`; never raises for a
        provider-side failure (auth, timeout, unknown model, ...), only for a malformed call to
        this method itself.
        """
        if config_id and inline_config:
            raise ValidationError("Provide either config_id or inline_config, not both.")

        if config_id:
            config = self._get_or_404(config_id)
            provider = config.provider
            model = config.model
            base_url = config.base_url
            api_key = decrypt_secret(config.api_key_encrypted) if config.api_key_encrypted else None
            temperature = config.temperature
            max_output_tokens = config.max_output_tokens
            request_timeout_seconds = config.request_timeout_seconds
            use_native_openrouter = config.use_native_openrouter
            extra_params = json.loads(config.extra_params_json or "{}")
        elif inline_config is not None:
            provider = inline_config.get("provider")
            model = inline_config.get("model")
            if not provider or not model:
                raise ValidationError("inline_config requires 'provider' and 'model'.")
            base_url = inline_config.get("base_url")
            api_key = inline_config.get("api_key") or None
            temperature = inline_config.get("temperature", 0.0)
            max_output_tokens = inline_config.get("max_output_tokens", 4096)
            request_timeout_seconds = inline_config.get("request_timeout_seconds", 120)
            use_native_openrouter = inline_config.get("use_native_openrouter", False)
            extra_params = inline_config.get("extra_params") or {}
        else:
            raise ValidationError("Provide either config_id or inline_config.")

        try:
            _validate_provider(provider)
            chat_model = build_chat_model(
                provider=provider,
                model=model,
                base_url=base_url,
                api_key=api_key,
                temperature=temperature,
                # Capped independent of the stored config: this is a connectivity probe, not
                # a real generation, and should stay cheap and fast regardless of what the
                # saved config allows for real chat turns.
                max_output_tokens=min(max_output_tokens, 16) if max_output_tokens else 16,
                request_timeout_seconds=min(request_timeout_seconds, 30) if request_timeout_seconds else 30,
                use_native_openrouter=use_native_openrouter,
                extra_params=extra_params,
            )
            chat_model.invoke("Reply with a single word: pong")
        except Exception as exc:
            return {"success": False, "error": str(exc)}
        return {"success": True, "error": None}

    # -- model catalog / listing ---------------------------------------------------------

    def list_catalog(self) -> dict[str, list[dict[str, str]]]:
        """Static, hardcoded catalog of known models per provider -- best-effort, not
        exhaustive or live-fetched (spec S7 `/providers/catalog`)."""
        return {
            "anthropic": [
                {"id": "claude-opus-4-5", "label": "Claude Opus 4.5"},
                {"id": "claude-sonnet-4-5", "label": "Claude Sonnet 4.5"},
                {"id": "claude-haiku-4-5", "label": "Claude Haiku 4.5"},
            ],
            "openai": [
                {"id": "gpt-5.1", "label": "GPT-5.1"},
                {"id": "gpt-5.1-mini", "label": "GPT-5.1 Mini"},
                {"id": "gpt-5-nano", "label": "GPT-5 Nano"},
                {"id": "o4-mini", "label": "o4-mini"},
            ],
            "openrouter": [
                {"id": "anthropic/claude-sonnet-4.5", "label": "Claude Sonnet 4.5 (OpenRouter)"},
                {"id": "openai/gpt-5.1", "label": "GPT-5.1 (OpenRouter)"},
                {"id": "google/gemini-3-pro", "label": "Gemini 3 Pro (OpenRouter)"},
                {"id": "meta-llama/llama-4-maverick", "label": "Llama 4 Maverick (OpenRouter)"},
            ],
            "ollama": [
                {"id": "llama3.2", "label": "Llama 3.2"},
                {"id": "qwen2.5", "label": "Qwen 2.5"},
                {"id": "mistral", "label": "Mistral"},
                {"id": "deepseek-r1", "label": "DeepSeek R1"},
            ],
            "google": [
                {"id": "gemini-3-pro", "label": "Gemini 3 Pro"},
                {"id": "gemini-3-flash", "label": "Gemini 3 Flash"},
                {"id": "gemini-2.5-flash-lite", "label": "Gemini 2.5 Flash-Lite"},
            ],
            "groq": [
                {"id": "openai/gpt-oss-120b", "label": "GPT-OSS 120B (Groq)"},
                {"id": "openai/gpt-oss-20b", "label": "GPT-OSS 20B (Groq)"},
                {"id": "llama-3.3-70b-versatile", "label": "Llama 3.3 70B Versatile (Groq)"},
                {"id": "llama-3.1-8b-instant", "label": "Llama 3.1 8B Instant (Groq)"},
            ],
            "pi": [
                {"id": "openai-codex/gpt-5.6-luna", "label": "GPT-5.6 Luna (OpenAI Codex)"},
                {"id": "openai-codex/gpt-5.6-sol", "label": "GPT-5.6 Sol (OpenAI Codex)"},
                {"id": "openai-codex/gpt-5.6-terra", "label": "GPT-5.6 Terra (OpenAI Codex)"},
                {"id": "openai-codex/gpt-6-astra", "label": "GPT-6 Astra (OpenAI Codex)"},
            ],
        }

    def list_models(self, config_id: str) -> list[dict[str, str]]:
        """Best-effort live model listing for the saved config's provider, falling back to the
        static catalog on any failure (spec S7 `/providers/{id}/models`). Deliberately simple --
        no shared HTTP client abstraction, just a short-timeout `httpx` call per provider."""
        config = self._get_or_404(config_id)
        live = self._fetch_live_models(config)
        if live is not None:
            return live
        return self.list_catalog().get(config.provider, [])

    def _fetch_live_models(self, config: AIProviderConfig) -> list[dict[str, str]] | None:
        try:
            api_key = decrypt_secret(config.api_key_encrypted) if config.api_key_encrypted else None

            if config.provider == "pi":
                return list_pi_models()

            if config.provider == "openai":
                url = (config.base_url or "https://api.openai.com/v1").rstrip("/") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                resp = httpx.get(url, headers=headers, timeout=5.0)
                resp.raise_for_status()
                data = resp.json().get("data", [])
                return [{"id": m["id"], "label": m["id"]} for m in data if "id" in m]

            if config.provider == "groq":
                # Same OpenAI-compatible /models shape as the branch above -- Groq's whole API
                # surface mirrors it, including this endpoint.
                url = (config.base_url or "https://api.groq.com/openai/v1").rstrip("/") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                resp = httpx.get(url, headers=headers, timeout=5.0)
                resp.raise_for_status()
                data = resp.json().get("data", [])
                return [{"id": m["id"], "label": m["id"]} for m in data if "id" in m]

            if config.provider == "openrouter":
                resp = httpx.get(
                    "https://openrouter.ai/api/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
                    timeout=5.0,
                )
                resp.raise_for_status()
                data = resp.json().get("data", [])
                return [{"id": m["id"], "label": m.get("name", m["id"])} for m in data if "id" in m]

            if config.provider == "ollama":
                base = (config.base_url or "http://localhost:11434").rstrip("/")
                resp = httpx.get(f"{base}/api/tags", timeout=5.0)
                resp.raise_for_status()
                models = resp.json().get("models", [])
                return [{"id": m["name"], "label": m["name"]} for m in models if "name" in m]

            if config.provider == "anthropic" and api_key:
                resp = httpx.get(
                    "https://api.anthropic.com/v1/models",
                    headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                    timeout=5.0,
                )
                resp.raise_for_status()
                data = resp.json().get("data", [])
                return [{"id": m["id"], "label": m.get("display_name", m["id"])} for m in data if "id" in m]

            if config.provider == "google" and api_key:
                resp = httpx.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": api_key},
                    timeout=5.0,
                )
                resp.raise_for_status()
                models = resp.json().get("models", [])
                # The API returns names prefixed "models/gemini-..."; strip it to match the bare
                # ids used everywhere else here (list_catalog, init_chat_model's `model=` arg).
                return [
                    {"id": m["name"].removeprefix("models/"), "label": m.get("displayName", m["name"])}
                    for m in models
                    if "name" in m and "generateContent" in (m.get("supportedGenerationMethods") or [])
                ]
        except Exception:
            return None
        return None


class AISettingsService:
    """Singleton-row access for `AISettings` -- the AI behavior toggles the `/settings/ai` page
    persists (spec S4 item 2). The migration deliberately seeds no row; `get_settings` creates
    it on first read."""

    _UPDATABLE_FIELDS = (
        "quickadd_fallback_enabled",
        "redact_before_send",
        "preview_on_calendar",
        "scheduling_window_days",
        "batch_undo_retention_days",
        "custom_instructions",
    )

    def __init__(self, db: Session):
        self.db = db

    def get_settings(self) -> AISettings:
        row = self.db.exec(select(AISettings)).first()
        if row is not None:
            return row
        row = AISettings()
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def update_settings(self, **fields: Any) -> AISettings:
        unknown = set(fields) - set(self._UPDATABLE_FIELDS)
        if unknown:
            raise ValidationError(f"Unknown AI settings field(s): {', '.join(sorted(unknown))}")

        custom_instructions = fields.get("custom_instructions")
        if custom_instructions is not None and len(custom_instructions) > 4000:
            raise ValidationError("custom_instructions must be 4000 characters or fewer.")

        row = self.get_settings()
        for key, value in fields.items():
            if value is not None:
                setattr(row, key, value)
        row.updated_at = utc_now()
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row
