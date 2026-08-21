"""Tests for core/inline_parser.py's parse_inline_task quick-add syntax:
#tag, !priority, due:/d: and target:/t: with day or hour units, and the
(parenthesized) -> description lift."""

from timetrace.core.inline_parser import parse_inline_task


def test_due_days_sets_due_date_and_strips_token():
    result = parse_inline_task("Pay tax due:1d")

    assert result["title"] == "Pay tax"
    assert result["due_date"] is not None


def test_target_hours_schedules_a_session():
    result = parse_inline_task("Standup t:2h")

    assert result["title"] == "Standup"
    assert result["schedule_session_at"] is not None
    assert result["assigned_date"] == result["schedule_session_at"].date().isoformat()


def test_target_hours_crossing_midnight_keeps_assigned_date_in_sync():
    result = parse_inline_task("Late night thing t:30h")

    assert result["assigned_date"] == result["schedule_session_at"].date().isoformat()


def test_decimal_offsets_are_left_unparsed_not_mangled():
    """A decimal like `t:1.5h` isn't a supported offset -- it must fall through
    untouched rather than matching the integer part and silently corrupting the
    title/date (regression: `(\\d+)(h|d)?` greedily matched "1" out of "1.5h")."""
    result = parse_inline_task("Design doc t:1.5h")

    assert result["title"] == "Design doc t:1.5h"
    assert result.get("schedule_session_at") is None
    assert result.get("assigned_date") is None


def test_decimal_due_offset_is_left_unparsed():
    result = parse_inline_task("Pay tax due:1.5d")

    assert result["title"] == "Pay tax due:1.5d"
    assert result.get("due_date") is None


def test_parenthesized_text_becomes_description():
    result = parse_inline_task("Renew passport (bring old one + 2 photos)")

    assert result["title"] == "Renew passport"
    assert result["description"] == "bring old one + 2 photos"
