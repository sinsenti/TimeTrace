"""Pure unit tests for `core/recurrence.py` (no DB, no HTTP).

The DST case below is the one thing manual testing cannot reach: it needs a clock that crosses a
transition. Everything else here guards a specific library trap the design ran into (`xafter`
vs `between` inclusivity, `Z`-suffixed `UNTIL`, the occurrence-id round-trip).
"""

import uuid
from datetime import datetime, timedelta

import pytest

from timetrace.core.exceptions import ValidationError
from timetrace.core.recurrence import (
    MAX_OCCURRENCES_PER_SERIES,
    MAX_WINDOW_DAYS,
    PRESET_TO_RRULE,
    RecurrenceSpec,
    expand,
    format_occurrence_id,
    is_occurrence_id,
    next_occurrence,
    parse_occurrence_id,
    preset_to_rrule,
    rrule_to_preset,
    set_until,
    validate_rrule,
)
from timetrace.core.timezones import from_local_naive, resolve_timezone, to_local_naive

TASK_ID = "01a02108-eb92-74ac-aa82-83fb19a270b3"


def spec_at_local(tz_name: str, local_naive: datetime, rrule: str, duration_minutes: int = 30) -> RecurrenceSpec:
    """Build a spec whose DTSTART is `local_naive` wall-clock in `tz_name`."""
    tz = resolve_timezone(tz_name)
    return RecurrenceSpec(
        rrule=rrule,
        dtstart_utc=from_local_naive(local_naive, tz),
        duration_minutes=duration_minutes,
        timezone_name=tz_name,
    )


# --- preset <-> rrule -----------------------------------------------------------------


@pytest.mark.parametrize("preset", ["daily", "weekdays", "weekly", "monthly"])
def test_preset_to_rrule_known_presets(preset):
    assert preset_to_rrule(preset) == PRESET_TO_RRULE[preset]
    assert rrule_to_preset(preset_to_rrule(preset)) == preset


@pytest.mark.parametrize("preset", [None, "", "fortnightly", "DAILYish"])
def test_preset_to_rrule_falls_back_to_daily(preset):
    assert preset_to_rrule(preset) == "FREQ=DAILY"


def test_preset_lookup_is_case_insensitive():
    assert preset_to_rrule("WeekDays") == PRESET_TO_RRULE["weekdays"]


def test_rrule_to_preset_custom_and_none():
    assert rrule_to_preset("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE") == "custom"
    assert rrule_to_preset(None) == "custom"


def test_rrule_to_preset_tolerates_prefix_and_case():
    assert rrule_to_preset("RRULE:freq=daily") == "daily"


# --- occurrence ids -------------------------------------------------------------------


def test_occurrence_id_round_trip():
    start = datetime(2026, 9, 3, 7, 29, 0)
    oid = format_occurrence_id(TASK_ID, start)
    assert oid == f"virt:{TASK_ID}:20260903T072900Z"
    assert parse_occurrence_id(oid) == (TASK_ID, start)
    assert is_occurrence_id(oid)


@pytest.mark.parametrize(
    "value",
    [
        "",
        str(uuid.uuid7()),
        TASK_ID,
        f"virt:{TASK_ID}",
        f"virt:{TASK_ID}:20260903T0729Z",
        f"virt:{TASK_ID}:20260903T072900",
        "virt:short-id:20260903T072900Z",
    ],
)
def test_parse_occurrence_id_returns_none_for_non_occurrence_ids(value):
    assert parse_occurrence_id(value) is None
    assert is_occurrence_id(value) is False


def test_format_occurrence_id_rejects_aware_datetime():
    from datetime import UTC

    with pytest.raises(ValidationError):
        format_occurrence_id(TASK_ID, datetime(2026, 9, 3, 7, 29, tzinfo=UTC))


# --- expansion basics -----------------------------------------------------------------


def test_expand_weekdays_skips_the_weekend():
    # Mon 2026-09-07 09:00 local, UTC zone so local == UTC.
    spec = spec_at_local("UTC", datetime(2026, 9, 7, 9, 0), PRESET_TO_RRULE["weekdays"], duration_minutes=15)
    got = expand(spec, datetime(2026, 9, 7, 0, 0), datetime(2026, 9, 14, 0, 0), TASK_ID)
    assert [o.start_utc.date().isoformat() for o in got] == [
        "2026-09-07",
        "2026-09-08",
        "2026-09-09",
        "2026-09-10",
        "2026-09-11",
    ]
    assert all(o.end_utc - o.start_utc == timedelta(minutes=15) for o in got)
    assert all(o.occurrence_id == format_occurrence_id(TASK_ID, o.start_utc) for o in got)


def test_expand_returns_empty_for_inverted_or_empty_window():
    spec = spec_at_local("UTC", datetime(2026, 9, 7, 9, 0), "FREQ=DAILY")
    assert expand(spec, datetime(2026, 9, 10, 0, 0), datetime(2026, 9, 10, 0, 0), TASK_ID) == []
    assert expand(spec, datetime(2026, 9, 11, 0, 0), datetime(2026, 9, 10, 0, 0), TASK_ID) == []


def test_expand_rejects_aware_window_bounds():
    from datetime import UTC

    spec = spec_at_local("UTC", datetime(2026, 9, 7, 9, 0), "FREQ=DAILY")
    with pytest.raises(ValidationError):
        expand(spec, datetime(2026, 9, 7, tzinfo=UTC), datetime(2026, 9, 8), TASK_ID)


def test_expand_rejects_window_wider_than_max_window_days():
    spec = spec_at_local("UTC", datetime(2026, 9, 7, 9, 0), "FREQ=WEEKLY")
    start = datetime(2026, 1, 1)
    with pytest.raises(ValidationError):
        expand(spec, start, start + timedelta(days=MAX_WINDOW_DAYS + 1), TASK_ID)
    # Exactly at the limit is allowed.
    assert expand(spec, start, start + timedelta(days=MAX_WINDOW_DAYS), TASK_ID)


def test_expand_truncates_at_max_occurrences_per_series():
    # 2/day over a 400-day window = 800 candidate occurrences, capped at 500.
    spec = spec_at_local("UTC", datetime(2026, 1, 1, 9, 0), "FREQ=DAILY;BYHOUR=9,17", duration_minutes=5)
    got = expand(spec, datetime(2026, 1, 1), datetime(2026, 1, 1) + timedelta(days=MAX_WINDOW_DAYS), TASK_ID)
    assert len(got) == MAX_OCCURRENCES_PER_SERIES


def test_expand_rejects_non_positive_duration():
    spec = RecurrenceSpec(rrule="FREQ=DAILY", dtstart_utc=datetime(2026, 9, 7, 9, 0), duration_minutes=0,
                          timezone_name="UTC")
    with pytest.raises(ValidationError):
        expand(spec, datetime(2026, 9, 7), datetime(2026, 9, 8), TASK_ID)


# --- window seams (the xafter-vs-between trap) ----------------------------------------


def test_adjacent_windows_are_disjoint_and_cover_the_whole_range():
    """`between(inc=True)` double-emits on a shared seam; `xafter` with a half-open upper bound
    must not. The seam here lands exactly on an occurrence instant."""
    spec = spec_at_local("UTC", datetime(2026, 9, 7, 9, 0), "FREQ=DAILY", duration_minutes=30)
    w1_start = datetime(2026, 9, 7, 9, 0)
    seam = datetime(2026, 9, 10, 9, 0)  # exactly an occurrence
    w2_end = datetime(2026, 9, 14, 9, 0)

    first = [o.start_utc for o in expand(spec, w1_start, seam, TASK_ID)]
    second = [o.start_utc for o in expand(spec, seam, w2_end, TASK_ID)]
    whole = [o.start_utc for o in expand(spec, w1_start, w2_end, TASK_ID)]

    assert set(first) & set(second) == set()
    assert first + second == whole
    assert seam in second and seam not in first


# --- DST ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tz_name", "dst_start_date"),
    [
        ("Europe/Berlin", "2026-03-29"),
        ("America/New_York", "2026-03-08"),
    ],
)
def test_weekly_0900_local_survives_spring_forward(tz_name, dst_start_date):
    """A 09:00-local weekly rule must stay at 09:00 local across a DST boundary; the naive-UTC
    instant shifts by exactly one hour at the transition."""
    tz = resolve_timezone(tz_name)
    transition = datetime.fromisoformat(dst_start_date)
    dtstart_local = (transition - timedelta(days=21)).replace(hour=9)
    spec = spec_at_local(tz_name, dtstart_local, "FREQ=WEEKLY", duration_minutes=60)

    window_start = from_local_naive(dtstart_local, tz)
    window_end = from_local_naive(dtstart_local + timedelta(days=42), tz)
    got = expand(spec, window_start, window_end, TASK_ID)
    assert len(got) == 6

    # Every occurrence renders as 09:00 local.
    for occ in got:
        local = to_local_naive(occ.start_utc, tz)
        assert (local.hour, local.minute) == (9, 0)

    utc_hours = {o.start_utc.hour for o in got}
    assert len(utc_hours) == 2, f"expected the UTC hour to shift across the DST boundary, got {utc_hours}"
    before = [o for o in got if o.start_utc < from_local_naive(transition, tz)]
    after = [o for o in got if o.start_utc >= from_local_naive(transition, tz)]
    assert before and after
    assert before[-1].start_utc.hour - after[0].start_utc.hour == 1


def test_dst_shift_is_absent_when_expanding_in_utc():
    """Control: the same rule pinned to UTC never shifts, which is what expanding a local series
    in UTC would wrongly look like."""
    spec = spec_at_local("UTC", datetime(2026, 3, 8, 9, 0), "FREQ=WEEKLY", duration_minutes=60)
    got = expand(spec, datetime(2026, 3, 8), datetime(2026, 4, 12), TASK_ID)
    assert {o.start_utc.hour for o in got} == {9}


# --- validate_rrule -------------------------------------------------------------------


def test_validate_rrule_accepts_every_preset():
    for rule in PRESET_TO_RRULE.values():
        validate_rrule(rule, datetime(2026, 9, 7, 9, 0), "Europe/Berlin")


@pytest.mark.parametrize(
    "rrule",
    [
        "",
        "   ",
        "NOT A RULE",
        "FREQ=NOPE",
        "FREQ=HOURLY",
        "FREQ=MINUTELY",
        "FREQ=SECONDLY",
        "FREQ=DAILY;UNTIL=20260101T090000Z",  # Z-suffixed UNTIL, unparseable against naive DTSTART
        "FREQ=DAILY;COUNT=0",  # yields nothing, ever
        "FREQ=DAILY;UNTIL=20260101T090000",  # UNTIL before DTSTART -> zero occurrences
    ],
)
def test_validate_rrule_rejects(rrule):
    with pytest.raises(ValidationError):
        validate_rrule(rrule, datetime(2026, 9, 7, 9, 0), "UTC")


def test_validate_rrule_rejects_sub_second_dtstart():
    with pytest.raises(ValidationError):
        validate_rrule("FREQ=DAILY", datetime(2026, 8, 17, 12, 29, 1, 544567), "UTC")


def test_validate_rrule_rejects_aware_dtstart():
    from datetime import UTC

    with pytest.raises(ValidationError):
        validate_rrule("FREQ=DAILY", datetime(2026, 9, 7, 9, 0, tzinfo=UTC), "UTC")


# --- set_until ------------------------------------------------------------------------


def test_set_until_writes_naive_until_and_drops_count():
    rule = set_until("FREQ=DAILY;COUNT=10", datetime(2026, 9, 10, 8, 59, 59))
    assert "COUNT" not in rule
    assert "UNTIL=20260910T085959" in rule
    assert not rule.endswith("Z")
    # And the result is still parseable / projectable against a naive DTSTART.
    spec = spec_at_local("Europe/Berlin", datetime(2026, 9, 7, 9, 0), rule, duration_minutes=15)
    validate_rrule(rule, spec.dtstart_utc, "Europe/Berlin")
    got = expand(spec, spec.dtstart_utc, spec.dtstart_utc + timedelta(days=30), TASK_ID)
    assert len(got) == 3  # 7th, 8th, 9th -- UNTIL cuts before the 10th's 09:00


def test_set_until_replaces_an_existing_until():
    rule = set_until("FREQ=WEEKLY;UNTIL=20270101T000000", datetime(2026, 10, 1, 0, 0))
    assert rule.count("UNTIL=") == 1
    assert "UNTIL=20261001T000000" in rule


def test_set_until_rejects_aware_datetime():
    from datetime import UTC

    with pytest.raises(ValidationError):
        set_until("FREQ=DAILY", datetime(2026, 10, 1, tzinfo=UTC))


# --- next_occurrence ------------------------------------------------------------------


def test_next_occurrence_is_strictly_after():
    spec = spec_at_local("UTC", datetime(2026, 9, 7, 9, 0), "FREQ=DAILY", duration_minutes=15)
    at_occurrence = datetime(2026, 9, 8, 9, 0)
    nxt = next_occurrence(spec, at_occurrence, TASK_ID)
    assert nxt is not None
    assert nxt.start_utc == datetime(2026, 9, 9, 9, 0)


def test_next_occurrence_returns_none_past_the_end_of_the_series():
    spec = spec_at_local("UTC", datetime(2026, 9, 7, 9, 0), "FREQ=DAILY;COUNT=3", duration_minutes=15)
    assert next_occurrence(spec, datetime(2026, 9, 9, 9, 0), TASK_ID) is None
