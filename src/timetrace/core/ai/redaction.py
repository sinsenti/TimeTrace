"""Sanitization of task/session text before it leaves the machine (spec S1 non-negotiables,
S9.7 trap).

Every string that reaches an LLM provider -- a task title/description in a tool result, or the
`request_text` persisted on `aidraftbatch` -- is redacted through `sanitize_text` first where the
application owns the payload; provider middleware is the backstop for structured tool messages.

Trap (spec S9.7): never a bare `\\d{9,}` phone/id detector. TimeTrace ids are UUIDv7 strings
(`8-4-4-4-12` hex groups); several of those groups are all-digit by chance, and a naive long-digit-
run detector would happily "redact" a chunk of a real id, corrupting it for the round trip back
through `resolve_task_reference`. To avoid that, this module locates UUID-shaped substrings first
and never runs any other pattern across them -- everything else, plus lack of a wrapping hyphen
structure, is what makes a phone number a phone number.
"""

import re

_UUID_RE = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")

# Confirmed live by adversarial review: an ISO date (2026-09-04) or a dot/slash date
# (12.09.2026) is exactly a dash/dot-separated run of 2-4-digit groups -- precisely what
# `_PHONE_RE` below matches. A scheduling assistant's requests are full of dates
# ("reschedule 2026-09-04 09:00 meeting"), and _PHONE_RE was eating them by default
# (sanitization_level="standard"), silently stripping the date the model needed to ground its
# own reply -- carved out here the same way `_UUID_RE` already is, before phone-matching runs.
_DATE_RE = re.compile(r"\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b")

_PROTECTED_RE = re.compile(f"(?:{_UUID_RE.pattern})|(?:{_DATE_RE.pattern})")
_PROTECTED_TOKEN_RE = re.compile(r"__TT_PROTECTED_\d+__")

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[A-Za-z]{2,}")
_URL_RE = re.compile(r"https?://[^\s<]+", re.IGNORECASE)

# Phone numbers, not bare digit runs: requires human-typed grouping punctuation (space, dot,
# dash, or parens) between digit groups, or a leading `+` country code. A contiguous digit run
# with no separators (e.g. the all-digit segment of a UUID) never matches this.
_PHONE_RE = re.compile(
    r"(?<![\w-])"
    r"(?:\+\d{1,3}[\s.-]?)?"
    r"(?:\(\d{2,4}\)[\s.-]?)?"
    r"\d{2,4}(?:[\s.-]\d{2,4}){2,4}"
    r"(?![\w-])"
)

REDACTED_EMAIL = "[redacted-email]"
REDACTED_PHONE = "[redacted-phone]"
REDACTED_URL = "[redacted-url]"


def _redact_segment(segment: str) -> str:
    def redact_url(match: re.Match[str]) -> str:
        # Keep protected UUID/date tokens visible even when embedded in a URL. This avoids
        # leaking the URL around them while preserving identifiers and calendar keys.
        protected = "".join(_PROTECTED_TOKEN_RE.findall(match.group(0)))
        return REDACTED_URL + protected

    segment = _URL_RE.sub(redact_url, segment)
    segment = _EMAIL_RE.sub(REDACTED_EMAIL, segment)
    segment = _PHONE_RE.sub(REDACTED_PHONE, segment)
    return segment


def detect_phone_pii(text: str) -> list[dict[str, object]]:
    """Return LangChain-compatible match records for phone-shaped text.

    The detector is kept here so provider middleware can apply the same protected-date/UUID
    rules as ``sanitize_text`` when tool results are still structured message content.
    """
    matches: list[dict[str, object]] = []
    last_end = 0
    for protected in _PROTECTED_RE.finditer(text):
        for match in _PHONE_RE.finditer(text, last_end, protected.start()):
            matches.append({"type": "phone", "value": match.group(0), "start": match.start(), "end": match.end()})
        last_end = protected.end()
    for match in _PHONE_RE.finditer(text, last_end):
        matches.append({"type": "phone", "value": match.group(0), "start": match.start(), "end": match.end()})
    return matches


def sanitize_text(text: str | None) -> str | None:
    """Redacts emails, HTTP(S) URLs, and phone-number-shaped substrings from `text`.

    UUID-shaped and date-shaped substrings are carved out first and passed through untouched, so
    a task/session id embedded in free text (rare, but e.g. a pasted link) always survives
    round-tripping intact, and a plain date the user typed never gets mistaken for a phone number.
    """
    if not text:
        return text

    protected_values: list[str] = []

    def protect(match: re.Match[str]) -> str:
        index = len(protected_values)
        protected_values.append(match.group(0))
        return f"__TT_PROTECTED_{index}__"

    redacted = _redact_segment(_PROTECTED_RE.sub(protect, text))
    for index, original in enumerate(protected_values):
        redacted = redacted.replace(f"__TT_PROTECTED_{index}__", original)
    return redacted


def sanitize_value(value):
    """Recursively redact string leaves in provider-bound JSON-like data.

    Tool results are nested (for example ``rating -> resolved_target`` and ``review -> task``),
    so sanitizing only the top-level task/session fields leaves a sensitive note one level down.
    Keys and non-string values are preserved; date and UUID-shaped values remain protected by
    ``sanitize_text`` itself.
    """
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, dict):
        return {key: sanitize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(sanitize_value(item) for item in value)
    return value


def sanitize_task_fields(fields: dict) -> dict:
    """Return a recursively sanitized copy of a task/session-shaped payload."""
    return sanitize_value(fields)


# Public descriptive alias for nested tool results such as habits, reviews, ratings, and timer
# notes. It intentionally accepts JSON-like values rather than ORM objects.
sanitize_payload = sanitize_value
