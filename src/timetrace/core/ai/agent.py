"""`create_agent` graph construction (model + tools + middleware), spec S2/S5.

Deliberate deviation (spec S2.1): no LangGraph checkpointer, no `store`, and `interrupt()`/
`HumanInTheLoopMiddleware` are never used -- approval is a post-hoc, per-batch accept/reject
against `aidraftbatch`/`aidraftitem` rows, not an in-graph interrupt. `HumanInTheLoopMiddleware`
is not imported anywhere in this file, not even unused.

This module never opens a DB session and never imports `timetrace.services` -- the caller (a
later chat-service track) is responsible for constructing a real `DbAIToolGateway` bound to one
draft batch, wrapping it in `AIAgentContext`, and passing that as the `context` argument when
invoking/streaming the compiled graph this module builds.
"""

from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import (
    ModelCallLimitMiddleware,
    PIIMiddleware,
    ToolCallLimitMiddleware,
    ToolRetryMiddleware,
)

from timetrace.core.ai.prompts import build_system_prompt
from timetrace.core.ai.tools import ALL_TOOLS, AIAgentContext

# Hard ceilings independent of provider-side limits -- a runaway tool-calling loop (e.g. the
# model repeatedly re-querying `find_free_slots` without converging) must not turn into an
# unbounded bill or an unbounded wait. `exit_behavior="end"` (the default) ends the run gracefully
# with whatever the model has produced so far, rather than raising -- a half-finished plan is
# recoverable; a 500 mid-turn is not.
_DEFAULT_MODEL_CALL_LIMIT = 25
_DEFAULT_TOOL_CALL_LIMIT = 40

# PII types this app's tool-result surface can plausibly leak: task/session titles, descriptions,
# and notes are free text a user might type an email address or a link into (e.g. a task titled
# "reply to jane@example.com" or "check https://internal.example.com/doc"). `credit_card`,
# `ip`, and `mac_address` have no plausible source in this app's data model, so they're left
# unconfigured rather than added speculatively.
_PII_TYPES = ("email", "url")


def build_agent(
    model: Any,
    *,
    sanitization_level: str = "standard",
    model_call_limit: int = _DEFAULT_MODEL_CALL_LIMIT,
    tool_call_limit: int = _DEFAULT_TOOL_CALL_LIMIT,
    extra_system_context: str | None = None,
) -> Any:
    """Builds the compiled LangGraph agent for the AI assistant.

    `model` is an already-constructed chat model (e.g. from `core/ai/providers.py:
    get_chat_model`) -- this function does not know about providers or API keys.

    `sanitization_level` mirrors `AIProviderConfig.sanitization_level` (`"off"` / `"standard"` /
    `"strict"`, spec S4): `"off"` skips `PIIMiddleware` entirely (the caller already asserted the
    user wants raw text -- e.g. a fully-local Ollama model with no third-party network hop);
    `"standard"` redacts tool-result content (the leak surface: DB content flowing out through
    tool results, spec S3); `"strict"` additionally redacts on the way in, so the model itself
    never sees an unredacted email/URL even in the user's own chat message.

    No checkpointer, no `store`, no `interrupt_before`/`interrupt_after` -- this graph is
    stateless between invocations by design (spec S2.1). Conversation history is the caller's job
    (replaying `AIChatMessage` rows into the input message list), and approval happens entirely
    outside the graph via `AIDraftService`.
    """
    middleware: list[Any] = [
        ModelCallLimitMiddleware(run_limit=model_call_limit, exit_behavior="end"),
        ToolCallLimitMiddleware(run_limit=tool_call_limit, exit_behavior="end"),
        ToolRetryMiddleware(max_retries=2),
    ]

    if sanitization_level != "off":
        apply_to_input = sanitization_level == "strict"
        for pii_type in _PII_TYPES:
            # `strategy="redact"` (the default) is deliberate and load-bearing (spec S9.7): a
            # task legitimately titled after an email address must degrade to a redacted
            # placeholder, never raise/500 via `strategy="block"`.
            middleware.append(
                PIIMiddleware(
                    pii_type,
                    strategy="redact",
                    apply_to_input=apply_to_input,
                    apply_to_tool_results=True,
                )
            )

    return create_agent(
        model,
        tools=ALL_TOOLS,
        system_prompt=build_system_prompt(extra_context=extra_system_context),
        middleware=middleware,
        context_schema=AIAgentContext,
    )


__all__ = ["build_agent", "AIAgentContext"]
