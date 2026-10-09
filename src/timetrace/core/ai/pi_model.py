"""LangChain adapter for Pi's ModelRuntime, not its coding agent.

The subprocess only performs inference. LangGraph owns tool execution, middleware and
call limits; no Pi sessions, extensions, context files or coding tools are loaded.
Prompts travel over stdin, never argv or temporary files. Responses are buffered, so SSE
consumers receive one text chunk per model call rather than token-by-token streaming.
"""

import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.utils.function_calling import convert_to_openai_tool

from timetrace.core.exceptions import AIProviderError

_SETUP_ERROR = "Pi requires Node.js and an npm-installed @earendil-works/pi-coding-agent with ModelRuntime support."
_CALL_ERROR = (
    "Pi request failed. Check Pi login, model ID and installation; provider details were withheld for privacy."
)


def _managed_package(install_root: Path) -> Path | None:
    try:
        version = (install_root / "current-version").read_text().strip()
    except OSError:
        return None
    if not version or version in {".", ".."} or Path(version).name != version:
        return None
    return install_root / "releases" / version / "node_modules" / "@earendil-works" / "pi-coding-agent"


def _command() -> list[str]:
    node = shutil.which("node")
    pi = shutil.which("pi")
    # An explicit package directory supports daemon PATHs with wrapper scripts or no pi binary.
    override = os.environ.get("TIMETRACE_PI_PACKAGE_DIR")
    if override:
        candidates = [Path(override).expanduser()]
    else:
        candidates = list(Path(pi).resolve().parents) if pi else []
        install_roots = [Path.home() / ".pi" / "agent" / "install"]
        managed_root = os.environ.get("PI_MANAGED_INSTALL_ROOT")
        if managed_root:
            install_roots.insert(0, Path(managed_root).expanduser())
        candidates.extend(package for root in install_roots if (package := _managed_package(root)) is not None)

    if node:
        for directory in candidates:
            try:
                package = json.loads((directory / "package.json").read_text())
            except OSError, ValueError:
                continue
            if package.get("name") == "@earendil-works/pi-coding-agent":
                entry = directory / "dist" / "index.js"
                if entry.is_file():
                    return [node, str(Path(__file__).with_name("pi_bridge.mjs")), str(entry.resolve())]
    raise AIProviderError(_SETUP_ERROR)


def _environment() -> dict[str, str]:
    return {**os.environ, "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_SKIP_VERSION_CHECK": "1"}


def _decode(stdout: bytes, returncode: int) -> Any:
    try:
        result = json.loads(stdout)
        if returncode or not isinstance(result, dict) or "result" not in result:
            raise ValueError
        return result["result"]
    except ValueError, UnicodeError:
        raise AIProviderError(_CALL_ERROR) from None


def _run(payload: dict, timeout: float) -> Any:
    command = _command()
    try:
        result = subprocess.run(
            command,
            input=json.dumps(payload).encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=_environment(),
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise AIProviderError("Pi request timed out.") from None
    except OSError:
        raise AIProviderError(_SETUP_ERROR) from None
    return _decode(result.stdout, result.returncode)


async def _arun(payload: dict, timeout: float) -> Any:
    command = _command()
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env=_environment(),
        )
    except OSError:
        raise AIProviderError(_SETUP_ERROR) from None
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(json.dumps(payload).encode()), timeout)
    except (TimeoutError, asyncio.CancelledError) as exc:
        if process.returncode is None:
            process.kill()
        await process.wait()
        if isinstance(exc, asyncio.CancelledError):
            raise
        raise AIProviderError("Pi request timed out.") from None
    return _decode(stdout, process.returncode)


def list_pi_models() -> list[dict[str, str]]:
    """Local authenticated catalog only; does not invoke a model or refresh remote catalogs."""
    result = _run({"action": "models"}, 15)
    if not isinstance(result, list) or any(
        not isinstance(m, dict) or not isinstance(m.get("id"), str) or not isinstance(m.get("label"), str)
        for m in result
    ):
        raise AIProviderError(_CALL_ERROR)
    return [{"id": m["id"], "label": m["label"]} for m in result]


class PiChatModel(BaseChatModel):
    model: str
    temperature: float = 0.0
    max_output_tokens: int | None = None
    request_timeout_seconds: float = 120
    disable_streaming: bool = True

    @property
    def _llm_type(self) -> str:
        return "pi"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        if tool_choice not in (None, "auto"):
            raise AIProviderError("Pi supports automatic tool selection only.")
        return self.bind(tools=[convert_to_openai_tool(t)["function"] for t in tools], **kwargs)

    def _payload(self, messages: list[BaseMessage], stop, tools=None, **kwargs) -> dict:
        if stop:
            raise AIProviderError("Pi does not support stop sequences.")
        system = []
        history = []
        names = {}
        for message in messages:
            # Always use middleware-processed text, never a duplicate raw provider response.
            text = message.text
            if isinstance(message, SystemMessage):
                system.append(text)
            elif isinstance(message, HumanMessage):
                history.append({"role": "user", "content": text})
            elif isinstance(message, AIMessage):
                calls = message.tool_calls
                names.update({call["id"]: call["name"] for call in calls})
                content = message.content if isinstance(message.content, list) else text
                history.append({"role": "assistant", "content": content, "tool_calls": calls})
            elif isinstance(message, ToolMessage):
                history.append(
                    {
                        "role": "tool",
                        "content": text,
                        "tool_call_id": message.tool_call_id,
                        "name": message.name or names.get(message.tool_call_id, "tool"),
                        "is_error": message.status == "error",
                    }
                )
            else:
                raise AIProviderError("Pi received an unsupported message type.")
        return {
            "action": "complete",
            "model": self.model,
            "system": "\n\n".join(system),
            "messages": history,
            "tools": tools or [],
            "temperature": self.temperature,
            "maxTokens": self.max_output_tokens,
        }

    def _result(self, response: Any) -> ChatResult:
        try:
            if response["stopReason"] not in ("stop", "length", "toolUse"):
                raise ValueError
            content = [
                {key: block[key] for key in ("type", "thinking", "thinkingSignature") if key in block}
                for block in response["content"]
                if block["type"] == "thinking"
            ]
            content.extend(
                {
                    "type": "text",
                    "text": block["text"],
                    **({"textSignature": block["textSignature"]} if "textSignature" in block else {}),
                }
                for block in response["content"]
                if block["type"] == "text"
            )
            calls = [
                {"name": b["name"], "args": b["arguments"], "id": b["id"], "type": "tool_call"}
                for b in response["content"]
                if b["type"] == "toolCall"
            ]
            usage = response["usage"]
            input_tokens = usage["input"] + usage.get("cacheRead", 0) + usage.get("cacheWrite", 0)
            message = AIMessage(
                content=content,
                tool_calls=calls,
                usage_metadata={
                    "input_tokens": input_tokens,
                    "output_tokens": usage["output"],
                    "total_tokens": input_tokens + usage["output"],
                },
            )
            return ChatResult(generations=[ChatGeneration(message=message)])
        except KeyError, TypeError, ValueError:
            raise AIProviderError(_CALL_ERROR) from None

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        return self._result(_run(self._payload(messages, stop, **kwargs), self.request_timeout_seconds))

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        return self._result(await _arun(self._payload(messages, stop, **kwargs), self.request_timeout_seconds))


def build_pi_model(*, model: str, base_url=None, api_key=None, extra_params=None, **kwargs) -> PiChatModel:
    provider, separator, model_id = model.partition("/")
    if not separator or not provider or not model_id or model != model.strip():
        raise AIProviderError("Pi model must be an exact provider/model ID, for example openai-codex/gpt-5.1-codex.")
    if base_url or api_key or extra_params:
        raise AIProviderError(
            "Configure Pi credentials and custom endpoints in Pi, not TimeTrace's API key/URL/extra fields."
        )
    return PiChatModel(model=model, **{key: value for key, value in kwargs.items() if value is not None})
