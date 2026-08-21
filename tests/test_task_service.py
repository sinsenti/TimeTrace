"""Tests for services/task_service.py's parse_title_estimation, the
"[90m]" / "[2h]" / "[1d]" title-suffix parser."""

import pytest

from timetrace.services.task_service import parse_title_estimation


@pytest.mark.parametrize(
    ("title", "expected_title", "expected_minutes"),
    [
        ("Write migration [90m]", "Write migration", 90),
        ("Write migration [90min]", "Write migration", 90),
        ("Write migration [90mins]", "Write migration", 90),
        ("Ship feature [2h]", "Ship feature", 120),
        ("Ship feature [2hours]", "Ship feature", 120),
        ("Ship feature [1.5h]", "Ship feature", 90),
        ("Plan sprint [1d]", "Plan sprint", 1440),
        ("Plan sprint [1day]", "Plan sprint", 1440),
        ("Plan sprint [2days]", "Plan sprint", 2880),
        ("Quick note [30]", "Quick note", 30),  # no unit defaults to minutes
    ],
)
def test_parse_title_estimation_extracts_value_and_unit(title, expected_title, expected_minutes):
    clean_title, minutes = parse_title_estimation(title)

    assert clean_title == expected_title
    assert minutes == expected_minutes


def test_parse_title_estimation_no_match_returns_title_unchanged_and_none():
    clean_title, minutes = parse_title_estimation("Just a plain title")

    assert clean_title == "Just a plain title"
    assert minutes is None


def test_parse_title_estimation_is_case_insensitive():
    clean_title, minutes = parse_title_estimation("Deploy [2H]")

    assert clean_title == "Deploy"
    assert minutes == 120
