"""Tests for interfaces/api/utils.py's ensure_utc, which every datetime boundary
in the app relies on."""

from datetime import UTC, datetime, timedelta, timezone

from timetrace.interfaces.api.utils import ensure_utc


def test_ensure_utc_none_stays_none():
    assert ensure_utc(None) is None


def test_ensure_utc_naive_datetime_becomes_utc_aware_without_shifting_wall_clock():
    naive = datetime(2026, 8, 21, 12, 30, 0)

    result = ensure_utc(naive)

    assert result.tzinfo is UTC
    # Naive values are assumed to already be UTC - attach the tzinfo, don't convert.
    assert result.hour == 12
    assert result.minute == 30


def test_ensure_utc_aware_utc_datetime_is_unchanged():
    aware = datetime(2026, 8, 21, 12, 30, 0, tzinfo=UTC)

    result = ensure_utc(aware)

    assert result == aware
    assert result.tzinfo is UTC


def test_ensure_utc_converts_other_timezone_to_utc():
    plus_two = timezone(timedelta(hours=2))
    aware_local = datetime(2026, 8, 21, 14, 30, 0, tzinfo=plus_two)

    result = ensure_utc(aware_local)

    assert result.tzinfo is UTC
    assert result.hour == 12  # 14:30 +02:00 == 12:30 UTC
    assert result == aware_local
