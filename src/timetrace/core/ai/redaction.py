"""Sanitization of task/session text before it leaves the machine (spec S1 non-negotiables,
S9.7 trap).

Every string that reaches an LLM provider -- a task title/description in a tool result, or the
`request_text` persisted on `aidraftbatch` -- is redacted through `sanitize_text` first.

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

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[A-Za-z]{2,}")

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


def _redact_segment(segment: str) -> str:
    segment = _EMAIL_RE.sub(REDACTED_EMAIL, segment)
    segment = _PHONE_RE.sub(REDACTED_PHONE, segment)
    return segment


def sanitize_text(text: str | None) -> str | None:
    """Redacts emails and phone-number-shaped substrings from `text`.

    UUID-shaped and date-shaped substrings are carved out first and passed through untouched, so
    a task/session id embedded in free text (rare, but e.g. a pasted link) always survives
    round-tripping intact, and a plain date the user typed never gets mistaken for a phone number.
    """
    if not text:
        return text

    pieces: list[str] = []
    last_end = 0
    for match in _PROTECTED_RE.finditer(text):
        pieces.append(_redact_segment(text[last_end : match.start()]))
        pieces.append(match.group(0))
        last_end = match.end()
    pieces.append(_redact_segment(text[last_end:]))
    return "".join(pieces)


def sanitize_task_fields(fields: dict) -> dict:
    """Returns a shallow copy of a task/session-shaped dict with every string value passed
    through `sanitize_text`. Non-string values (ids, dates, numbers) pass through unchanged --
    this is deliberately not a deep/recursive sanitizer."""
    return {key: (sanitize_text(value) if isinstance(value, str) else value) for key, value in fields.items()}
