"""Daemon timezone resolution and explicit local<->naive-UTC conversion.

Pure module: no FastAPI, no SQLModel, no DB. This is the single answer to "what timezone is
the daemon in", extracted from `services/query_service.py` -- two independent copies of that
answer is exactly how the UTC-vs-local bucketing bug the statistics slice fixed comes back.

The DB stores naive UTC. Everything user-facing (calendar day bucketing, recurrence wall-clock
expansion) is local, so the conversion has to be explicit and in one place.
"""

import os
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_TZ_NAME = "UTC"

_daemon_tz_name_cache: str | None = None
_daemon_tz_cache: ZoneInfo | None = None


def daemon_timezone_name() -> str:
    """IANA name of the daemon process's timezone.

    Resolution order (unchanged from the original `_daemon_timezone_name`): the `TZ` env var,
    then the `/etc/localtime` symlink tail after the `zoneinfo` path component, then `"UTC"`.
    Cached at module level for the process lifetime.
    """
    global _daemon_tz_name_cache
    if _daemon_tz_name_cache is not None:
        return _daemon_tz_name_cache

    tz = os.environ.get("TZ")
    if not tz:
        try:
            resolved = Path("/etc/localtime").resolve()
            parts = resolved.parts
            if "zoneinfo" in parts:
                idx = parts.index("zoneinfo")
                tz = "/".join(parts[idx + 1 :])
        except OSError:
            tz = None

    _daemon_tz_name_cache = tz or DEFAULT_TZ_NAME
    return _daemon_tz_name_cache


def daemon_tzinfo() -> ZoneInfo:
    """Resolved `ZoneInfo` for `daemon_timezone_name()`, falling back to UTC. Never raises."""
    global _daemon_tz_cache
    if _daemon_tz_cache is not None:
        return _daemon_tz_cache
    try:
        _daemon_tz_cache = ZoneInfo(daemon_timezone_name())
    except Exception:
        _daemon_tz_cache = ZoneInfo(DEFAULT_TZ_NAME)
    return _daemon_tz_cache


# Plan (section 3.2) names this `daemon_timezone`; kept as an alias so either name resolves.
daemon_timezone = daemon_tzinfo


def resolve_timezone(name: str | None) -> ZoneInfo:
    """`ZoneInfo` for `name`, or the daemon's zone when `name` is empty/unknown. Never raises."""
    if name:
        try:
            return ZoneInfo(name)
        except Exception:
            pass
    return daemon_tzinfo()


def to_local_naive(utc_naive: datetime, tz: ZoneInfo) -> datetime:
    """Naive UTC -> naive local wall-clock in `tz`.

    An aware input is accepted and converted from its own offset; a naive input is assumed UTC.
    """
    aware = utc_naive.replace(tzinfo=UTC) if utc_naive.tzinfo is None else utc_naive
    return aware.astimezone(tz).replace(tzinfo=None)


def from_local_naive(local_naive: datetime, tz: ZoneInfo) -> datetime:
    """Naive local wall-clock in `tz` -> naive UTC.

    Two DST edge cases, both deterministic and documented rather than silently wrong:

    * A *nonexistent* local time (spring forward, e.g. `2026-03-29 02:30` Europe/Berlin) resolves
      with `fold=0`, i.e. the pre-transition offset: it becomes `01:30Z`, which renders back as
      `03:30` local.
    * An *ambiguous* local time (fall back) resolves to the first (DST) occurrence.
    """
    if local_naive.tzinfo is not None:
        local_naive = local_naive.replace(tzinfo=None)
    return local_naive.replace(tzinfo=tz).astimezone(UTC).replace(tzinfo=None)


def _reset_caches() -> None:
    """Test hook: drop the memoized daemon timezone so a changed `TZ` is picked up."""
    global _daemon_tz_name_cache, _daemon_tz_cache
    _daemon_tz_name_cache = None
    _daemon_tz_cache = None
