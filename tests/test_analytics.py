"""Tests for core/analytics.py's calculate_tag_summaries.

This deliberately pins down the CURRENT fan-out behaviour: a session tagged
with multiple tags credits its *full* duration to each tag, so totals across
tags can exceed real tracked time. This is a known, intentional-for-now
contract - the statistics rework (see CLAUDE.md "Current focus: statistics &
custom dashboards") will make attribution configurable (fan-out vs. split
evenly), but until then this is the documented behaviour. Do not "fix" this
test to make totals reconcile.
"""

from timetrace.core.analytics import calculate_tag_summaries


def test_multi_tag_session_fans_out_full_duration_to_every_tag():
    sessions = [
        {"duration_seconds": 2 * 3600, "tags": "#a #b"},
    ]

    summary = calculate_tag_summaries(sessions)
    by_tag = {row["tag"]: row for row in summary}

    # Each tag gets the FULL 2 hours credited - not 1 hour each.
    assert by_tag["#a"]["total_hours"] == 2.0
    assert by_tag["#b"]["total_hours"] == 2.0

    # So the sum across tags (4h) exceeds the actual tracked time (2h).
    total_across_tags = sum(row["total_hours"] for row in summary)
    assert total_across_tags == 4.0


def test_session_without_tags_falls_back_to_general():
    sessions = [{"duration_seconds": 3600, "tags": ""}]

    summary = calculate_tag_summaries(sessions)

    assert len(summary) == 1
    assert summary[0]["tag"] == "#general"
    assert summary[0]["total_hours"] == 1.0
    assert summary[0]["session_count"] == 1


def test_summary_sorted_descending_by_total_hours():
    sessions = [
        {"duration_seconds": 1 * 3600, "tags": "#small"},
        {"duration_seconds": 3 * 3600, "tags": "#big"},
    ]

    summary = calculate_tag_summaries(sessions)

    assert [row["tag"] for row in summary] == ["#big", "#small"]
