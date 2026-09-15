"""Small, DB-free safety gate for conversational standing-instruction proposals.

This is intentionally conservative. The model still turns a request into concise instruction
text, but the server only permits the proposal tool when the original user message contains an
explicit future/persistence cue. Ordinary preferences and one-off facts must stay ordinary chat.
"""

from __future__ import annotations

import re

_FUTURE_CUE_RE = re.compile(
    r"\b(?:"
    r"from\s+now\s+on|going\s+forward|"
    r"for\s+future\s+(?:conversations?|chats?|turns?)|"
    r"keep\s+this\s+as\s+a?\s*standing\s+preference|"
    r"save\s+this\s+as\s+(?:a\s+)?(?:standing\s+)?preference|"
    r"store\s+this\s+as\s+(?:a\s+)?(?:standing\s+)?preference|"
    r"make\s+this\s+my\s+default"
    r")\b",
    re.IGNORECASE,
)
_REMEMBER_THIS_RE = re.compile(r"\bremember\s+this\b", re.IGNORECASE)
_ONE_OFF_RE = re.compile(
    r"\bremember\s+(?:my|the|a|an|that|when|where|who|what|to)\b|"
    r"\bremember\s+this\s+(?:appointment|meeting|dentist|event|task|reminder)\b",
    re.IGNORECASE,
)
_FIRST_PERSON_MEMORY_RE = re.compile(r"\bI\s+(?:still\s+)?remember\b", re.IGNORECASE)
_EMBEDDED_TEXT_RE = re.compile(
    r"\b(?:task|description|import(?:ed)?\s+text)\b\s*(?:is|:)?\s*[\"']",
    re.IGNORECASE,
)


def is_remember_intent(text: str) -> bool:
    """Return whether *text* explicitly asks for a future standing instruction.

    In particular, ``I remember ...``, ``remember my appointment``, and ``I prefer mornings``
    are not permission to persist anything. This function does not attempt to extract the rule.
    """
    if not isinstance(text, str) or not text.strip():
        return False
    if _FIRST_PERSON_MEMORY_RE.search(text) or _ONE_OFF_RE.search(text) or _EMBEDDED_TEXT_RE.search(text):
        return False
    return bool(_FUTURE_CUE_RE.search(text) or _REMEMBER_THIS_RE.search(text))


__all__ = ["is_remember_intent"]
