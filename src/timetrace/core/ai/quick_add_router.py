"""Tier-1 (existing regex quick-add) vs tier-2 (LLM NL quick-add) routing (spec S6).

Deliberately **not** in `core/inline_parser.py`: `parse_inline_task` runs on every
`create_task`/`update_task` in the app, and an LLM branch there would put a model decision in the
path of every task write.

`parse_inline_task` has no "parse failed" signal to fall back from -- it scrapes what it
recognizes out of the title and silently drops the rest. So escalation here is a *positive*
heuristic on what remains after tier-1's grammar (`#tag`, `!priority`, `@status`, `due:`/`target:`,
`(parenthesized)` text) has been stripped out of the first line: a weekday/month name,
`tomorrow`/`next week`, a clock time or range, a duration phrase, multi-clause joiners with more
than 8 remaining words, or more than 14 remaining words outright. A bare short title never
escalates -- never pay LLM latency or money for `fix login bug`.
"""

import re
from dataclasses import dataclass, field

from timetrace.core.inline_parser import strip_comments

# -- Tier-1 grammar stripping -------------------------------------------------------------------
# Mirrors the title-cleaning substitutions in `inline_parser.parse_inline_task` exactly (kept as a
# deliberate duplication rather than importing that function's title, since `parse_inline_task`
# substitutes an "Untitled Task" fallback for an empty title that would corrupt the word count).

_PAREN_RE = re.compile(r"\([^)]*\)")
_TAG_RE = re.compile(r"#\w+")
_PRIORITY_RE = re.compile(r"!(high|medium|med|low|h|m|l|-)", re.IGNORECASE)
_STATUS_RE = re.compile(
    r"@(in_progress|ongoing|completed|scheduled|backlog|ip|og|done|c|todo|to do|sch|bl)",
    re.IGNORECASE,
)
_DUE_RE = re.compile(r"\b(?:due|d):\d+(?!\.\d)(?:h|d)?\b", re.IGNORECASE)
_TARGET_RE = re.compile(r"\b(?:target|t):\d+(?!\.\d)(?:h|d)?\b", re.IGNORECASE)

# -- Tier-2 escalation signals -------------------------------------------------------------------

_WEEKDAY_RE = re.compile(
    r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)\b",
    re.IGNORECASE,
)
_MONTH_RE = re.compile(
    r"\b(january|february|march|april|may|june|july|august|september|october|november|december|"
    r"jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b",
    re.IGNORECASE,
)
_RELATIVE_DATE_RE = re.compile(r"\b(tomorrow|next week)\b", re.IGNORECASE)
_CLOCK_TIME_RE = re.compile(
    r"\b\d{1,2}(:\d{2})?\s*(am|pm)\b"  # 3pm, 3:00pm
    r"|\b\d{1,2}:\d{2}\b"  # 15:00
    r"|\b\d{1,2}(:\d{2})?\s*(am|pm)?\s*-\s*\d{1,2}(:\d{2})?\s*(am|pm)\b",  # 1-2pm, 9-5pm
    re.IGNORECASE,
)
_DURATION_RE = re.compile(
    r"\bfor\s+(an?|\d+)\s*(min|mins|minute|minutes|hr|hrs|hour|hours)\b"
    r"|\b\d+\s*(min|mins|minute|minutes|hr|hrs|hour|hours)\b"
    r"|\bhalf\s+an?\s+hour\b",
    re.IGNORECASE,
)
_JOINER_RE = re.compile(r"\b(and|then|but|while)\b|[,;]", re.IGNORECASE)

_MULTI_CLAUSE_WORD_THRESHOLD = 8
_LONG_REMAINDER_WORD_THRESHOLD = 14


def _tier1_remainder(text: str) -> str:
    """The part of the quick-add title tier-1 (`parse_inline_task`) does *not* recognize --
    everything else that would be left in the title after tags/priority/status/due/target/
    parenthesized text are scraped out."""
    clean_text = strip_comments(text)
    lines = [line.strip() for line in clean_text.splitlines() if line.strip()]
    if not lines:
        return ""

    remainder = lines[0]
    remainder = _PAREN_RE.sub("", remainder)
    remainder = _TAG_RE.sub("", remainder)
    remainder = _PRIORITY_RE.sub("", remainder)
    remainder = _STATUS_RE.sub("", remainder)
    remainder = _DUE_RE.sub("", remainder)
    remainder = _TARGET_RE.sub("", remainder)
    return " ".join(remainder.split()).strip()


@dataclass
class QuickAddDecision:
    """Result of `route_quick_add`."""

    tier: int
    reason: str
    signals: list[str] = field(default_factory=list)
    remaining_text: str = ""
    remaining_word_count: int = 0


def route_quick_add(text: str, force_tier: int | None = None) -> QuickAddDecision:
    """Decides whether a quick-add string should stay on the tier-1 regex parser (`tier=1`) or
    escalate to the tier-2 LLM parser (`tier=2`).

    `force_tier` (1 or 2) bypasses the heuristic entirely -- used by `POST /quick-add/classify`
    when the caller (or a user override in the UI) already knows which tier it wants, and by
    tests. No LLM call happens in either branch of this function; it only decides which parser to
    hand the text to.
    """
    if force_tier is not None:
        return QuickAddDecision(tier=force_tier, reason="forced", remaining_text=text)

    remainder = _tier1_remainder(text)
    words = remainder.split()
    word_count = len(words)

    signals: list[str] = []
    if _WEEKDAY_RE.search(remainder):
        signals.append("weekday")
    if _MONTH_RE.search(remainder):
        signals.append("month")
    if _RELATIVE_DATE_RE.search(remainder):
        signals.append("relative_date")
    if _CLOCK_TIME_RE.search(remainder):
        signals.append("clock_time")
    if _DURATION_RE.search(remainder):
        signals.append("duration")
    if word_count > _LONG_REMAINDER_WORD_THRESHOLD:
        signals.append("long_remainder")
    elif word_count > _MULTI_CLAUSE_WORD_THRESHOLD and _JOINER_RE.search(remainder):
        signals.append("multi_clause")

    tier = 2 if signals else 1
    reason = ", ".join(signals) if signals else "bare short title"
    return QuickAddDecision(
        tier=tier,
        reason=reason,
        signals=signals,
        remaining_text=remainder,
        remaining_word_count=word_count,
    )
