"""RFC 5545 recurrence projection: one master RRULE per series, expanded to occurrence
instants for whatever window the caller asks for.

Pure module, structured like `core/query_spec.py`: frozen dataclasses plus module functions,
no I/O, no FastAPI, no DB. It may raise `core.exceptions.ValidationError` (a domain error, not
an HTTP one) and it may import `core.timezones`.

Key invariant: expansion happens in **local wall-clock** in the series' timezone and only then
converts to naive UTC. A 09:00-local weekly rule therefore stays at 09:00 local across a DST
boundary (the UTC instant shifts by an hour; the wall clock does not). Expanding in UTC would
silently drift such a series twice a year.

Storage conventions this module assumes:

* `dtstart_utc` is naive UTC at second precision (ids are second-precision, so a sub-second
  DTSTART would make `format_occurrence_id` lossy).
* `UNTIL`, when present in the rule, is **naive local** and never `Z`-suffixed --
  `dateutil.rrule.rrulestr` raises `ValueError` for a `Z` UNTIL against a naive DTSTART, and
  DTSTART is naive local here by construction.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dateutil.rrule import rrulestr

from timetrace.core.exceptions import ValidationError
from timetrace.core.timezones import from_local_naive, resolve_timezone, to_local_naive

MAX_OCCURRENCES_PER_SERIES = 500  # hard cap per expand() call; truncates rather than hanging
MAX_WINDOW_DAYS = 400  # widest projection window any caller may request

VIRTUAL_ID_PREFIX = "virt:"
_OCCURRENCE_STAMP_FMT = "%Y%m%dT%H%M%SZ"
_UNTIL_STAMP_FMT = "%Y%m%dT%H%M%S"
_STAMP_RE = re.compile(r"^\d{8}T\d{6}Z$")
_UNTIL_Z_RE = re.compile(r"UNTIL=\d{8}T\d{6}Z", re.IGNORECASE)
_TASK_ID_LEN = 36

PRESET_TO_RRULE = {
    "daily": "FREQ=DAILY",
    "weekdays": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    "weekly": "FREQ=WEEKLY",
    "monthly": "FREQ=MONTHLY",
}
DEFAULT_PRESET = "daily"
CUSTOM_PRESET = "custom"

_RRULE_TO_PRESET = {v: k for k, v in PRESET_TO_RRULE.items()}

_REJECTED_FREQUENCIES = {"SECONDLY", "MINUTELY", "HOURLY"}


@dataclass(frozen=True)
class RecurrenceSpec:
    """The stored recurrence of one series."""

    rrule: str  # RRULE body, no "RRULE:" prefix, e.g. "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    dtstart_utc: datetime  # naive UTC, second precision
    duration_minutes: int
    timezone_name: str


@dataclass(frozen=True)
class Occurrence:
    """One projected instance of a series. `start_utc` is the RFC 5545 RECURRENCE-ID."""

    start_utc: datetime  # naive UTC
    end_utc: datetime  # start_utc + duration
    occurrence_id: str  # "virt:<task_id>:<YYYYMMDDTHHMMSSZ>"


# --- preset <-> RRULE ------------------------------------------------------------------


def preset_to_rrule(preset: str | None) -> str:
    """UI preset label -> RRULE body. Unknown or missing presets fall back to daily, matching
    the old generator's fall-through."""
    if preset:
        rule = PRESET_TO_RRULE.get(preset.strip().lower())
        if rule:
            return rule
    return PRESET_TO_RRULE[DEFAULT_PRESET]


def rrule_to_preset(rrule: str | None) -> str:
    """RRULE body -> UI preset label. Exact match only; anything else is "custom"."""
    if not rrule:
        return CUSTOM_PRESET
    return _RRULE_TO_PRESET.get(_normalize_rrule(rrule), CUSTOM_PRESET)


def _normalize_rrule(rrule: str) -> str:
    body = rrule.strip()
    if body.upper().startswith("RRULE:"):
        body = body.split(":", 1)[1]
    return body.strip().upper()


def _rrule_parts(rrule: str) -> dict[str, str]:
    parts: dict[str, str] = {}
    for chunk in _normalize_rrule(rrule).split(";"):
        if not chunk:
            continue
        key, _, value = chunk.partition("=")
        parts[key.strip()] = value.strip()
    return parts


# --- occurrence ids -------------------------------------------------------------------


def format_occurrence_id(task_id: str, start_utc: datetime) -> str:
    """`virt:<task_id>:<YYYYMMDDTHHMMSSZ>` from the occurrence's naive-UTC instant."""
    if start_utc.tzinfo is not None:
        raise ValidationError("Occurrence start must be a naive UTC datetime.")
    return f"{VIRTUAL_ID_PREFIX}{task_id}:{start_utc.strftime(_OCCURRENCE_STAMP_FMT)}"


def parse_occurrence_id(value: str) -> tuple[str, datetime] | None:
    """`(task_id, naive-UTC start)` or `None`.

    Returns `None` rather than raising for anything that isn't a synthetic occurrence id
    (including a plain UUIDv7), so callers can use it as a discriminator. No real UUIDv7 can
    begin with `virt:`, so the two namespaces cannot collide.
    """
    if not value or not value.startswith(VIRTUAL_ID_PREFIX):
        return None
    rest = value[len(VIRTUAL_ID_PREFIX) :]
    task_id, sep, stamp = rest.rpartition(":")
    if not sep or len(task_id) != _TASK_ID_LEN or not _STAMP_RE.match(stamp):
        return None
    try:
        start_utc = datetime.strptime(stamp, _OCCURRENCE_STAMP_FMT)
    except ValueError:
        return None
    return task_id, start_utc


def is_occurrence_id(value: str) -> bool:
    """True when `value` is a well-formed synthetic occurrence id."""
    return parse_occurrence_id(value) is not None


# --- validation -----------------------------------------------------------------------


def validate_rrule(rrule: str, dtstart_utc: datetime, timezone_name: str | None) -> None:
    """Raise `ValidationError` unless the rule is one this engine can project.

    Rejects: anything dateutil cannot parse; sub-daily `FREQ`; a `Z`-suffixed `UNTIL` (the
    stored form is naive local); a rule yielding zero occurrences ever; a sub-second DTSTART.
    """
    if not rrule or not rrule.strip():
        raise ValidationError("Recurrence rule is empty.")
    if dtstart_utc.tzinfo is not None:
        raise ValidationError("Recurrence DTSTART must be a naive UTC datetime.")
    if dtstart_utc.microsecond != 0:
        raise ValidationError("Recurrence DTSTART must be second-precision (no microseconds).")

    body = _normalize_rrule(rrule)
    if _UNTIL_Z_RE.search(body):
        raise ValidationError("Recurrence UNTIL must be stored as naive local time, without a 'Z' suffix.")

    freq = _rrule_parts(body).get("FREQ")
    if freq in _REJECTED_FREQUENCIES:
        raise ValidationError(f"Recurrence frequency '{freq}' is not supported (daily or coarser only).")

    tz = resolve_timezone(timezone_name)
    rule = _build_rule(body, to_local_naive(dtstart_utc, tz))
    if next(iter(rule), None) is None:
        raise ValidationError("Recurrence rule produces no occurrences.")


def _build_rule(rrule: str, dtstart_local: datetime):
    """`rrulestr` with a naive local DTSTART -- naive in, naive out."""
    try:
        return rrulestr(_normalize_rrule(rrule), dtstart=dtstart_local)
    except (ValueError, TypeError) as exc:
        raise ValidationError(f"Invalid recurrence rule: {exc}") from exc


# --- UNTIL ----------------------------------------------------------------------------


def set_until(rrule: str, until_local_naive: datetime) -> str:
    """Return `rrule` with `UNTIL` set to a naive local stamp, dropping any `COUNT`.

    `UNTIL` and `COUNT` are mutually exclusive in RFC 5545, and a `Z`-suffixed `UNTIL` is
    unparseable against this engine's naive DTSTART, hence the naive stamp.
    """
    if until_local_naive.tzinfo is not None:
        raise ValidationError("UNTIL must be a naive local datetime.")
    stamp = until_local_naive.replace(microsecond=0).strftime(_UNTIL_STAMP_FMT)
    kept = [
        f"{key}={value}"
        for key, value in _rrule_parts(rrule).items()
        if key not in ("UNTIL", "COUNT")
    ]
    kept.append(f"UNTIL={stamp}")
    return ";".join(kept)


# --- projection -----------------------------------------------------------------------


def expand(
    spec: RecurrenceSpec,
    window_start_utc: datetime,
    window_end_utc: datetime,
    task_id: str,
) -> list[Occurrence]:
    """Occurrences of `spec` whose start falls in `[window_start_utc, window_end_utc)`.

    Half-open on purpose: adjacent calendar viewports must not both emit the occurrence sitting
    on their shared seam. `rrule.between(..., inc=True)` is inclusive on *both* ends and does
    exactly that, so this uses `xafter` with an explicit upper-bound break instead.
    """
    if window_start_utc.tzinfo is not None or window_end_utc.tzinfo is not None:
        raise ValidationError("Projection window bounds must be naive UTC datetimes.")
    if window_end_utc <= window_start_utc:
        return []
    if (window_end_utc - window_start_utc) > timedelta(days=MAX_WINDOW_DAYS):
        raise ValidationError(f"Projection window exceeds the maximum of {MAX_WINDOW_DAYS} days.")
    if spec.duration_minutes is None or spec.duration_minutes <= 0:
        raise ValidationError("Recurrence duration must be a positive number of minutes.")

    tz: ZoneInfo = resolve_timezone(spec.timezone_name)
    rule = _build_rule(spec.rrule, to_local_naive(spec.dtstart_utc, tz))

    ws_local = to_local_naive(window_start_utc, tz)
    we_local = to_local_naive(window_end_utc, tz)
    duration = timedelta(minutes=spec.duration_minutes)

    occurrences: list[Occurrence] = []
    for occ_local in rule.xafter(ws_local, inc=True):
        if occ_local >= we_local:
            break
        start_utc = from_local_naive(occ_local, tz)
        occurrences.append(
            Occurrence(
                start_utc=start_utc,
                end_utc=start_utc + duration,
                occurrence_id=format_occurrence_id(task_id, start_utc),
            )
        )
        if len(occurrences) >= MAX_OCCURRENCES_PER_SERIES:
            break
    return occurrences


def next_occurrence(spec: RecurrenceSpec, after_utc: datetime, task_id: str) -> Occurrence | None:
    """The first occurrence strictly after `after_utc`, or `None` if the series has ended.

    Note the window bounds of `expand` are half-open on the *start*, so this uses the rule
    directly rather than guessing a search window.
    """
    if after_utc.tzinfo is not None:
        raise ValidationError("`after_utc` must be a naive UTC datetime.")
    if spec.duration_minutes is None or spec.duration_minutes <= 0:
        raise ValidationError("Recurrence duration must be a positive number of minutes.")

    tz = resolve_timezone(spec.timezone_name)
    rule = _build_rule(spec.rrule, to_local_naive(spec.dtstart_utc, tz))
    after_local = to_local_naive(after_utc, tz)

    for occ_local in rule.xafter(after_local, inc=False):
        start_utc = from_local_naive(occ_local, tz)
        return Occurrence(
            start_utc=start_utc,
            end_utc=start_utc + timedelta(minutes=spec.duration_minutes),
            occurrence_id=format_occurrence_id(task_id, start_utc),
        )
    return None
