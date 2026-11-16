"""Ticket14: fresh adoption and recreation through public dashboard/query interfaces."""

import pytest


def test_fresh_overview_has_performed_time_without_narrowing_recorded_totals(client):
    dashboard = client.get("/api/dashboards").json()[0]
    widgets = client.get(f"/api/dashboards/{dashboard['id']}").json()["widgets"]
    performed = next((w for w in widgets if w["seed_key"] == "performed_time_by_day"), None)
    assert performed is not None, "Fresh Overview must contain the performed-time preset"
    assert performed["title"] == "Performed time by day"
    q = performed["spec"]["query"]
    assert (q["source"], q["measure"], q["group_by"], q["chart"]) == ("sessions", "sum_duration", ["day"], "line")
    assert q["date_range"]["preset"] == "last_14_days"
    assert q["filters"] == [{"field": "session_time_relative", "op": "eq", "values": ["past"]}]
    assert q["comparison"]["mode"] == "previous_period"
    assert q["sort"] == "dimension_asc" and q["fill_gaps"] is True
    assert q["tag_attribution"] == "fan_out"
    for key, title, measure in [
        ("total_time", "Recorded session time", "sum_duration"),
        ("total_sessions", "Recorded sessions", "session_count"),
    ]:
        widget = next(w for w in widgets if w["seed_key"] == key)
        assert widget["title"] == title
        assert widget["spec"]["query"]["filters"] == []
        assert widget["spec"]["query"]["date_range"]["preset"] == "all_time"
        assert widget["spec"]["query"]["measure"] == measure


def test_existing_dashboard_and_deleted_performed_widget_are_never_backfilled(client):
    # Simulate an existing nine-widget Overview by deleting the new seed, then saving old titles.
    board = client.get("/api/dashboards").json()[0]
    path = f"/api/dashboards/{board['id']}"
    widgets = client.get(path).json()["widgets"]
    performed = next(w for w in widgets if w["seed_key"] == "performed_time_by_day")
    assert client.delete(f"{path}/widgets/{performed['id']}").status_code == 204
    total = next(w for w in widgets if w["seed_key"] == "total_time")
    assert client.put(f"{path}/widgets/{total['id']}", json={"title": "Total Time Logged"}).status_code == 200
    before = client.get(path).json()
    for _ in range(2):
        assert client.get("/api/dashboards").json()[0]["widget_count"] == 9
        assert client.get(path).json() == before
    empty = client.post("/api/dashboards", json={"name": "Existing empty canvas"}).json()
    assert client.get(f"/api/dashboards/{empty['id']}").json()["widgets"] == []


def test_stats_recreation_payload_can_be_saved_edited_and_reopened(client):
    import json
    import re

    page = client.get("/stats")
    assert page.status_code == 200
    serialized = re.search(r'<script id="performed_time_preset" type="application/json">(.*?)</script>', page.text)
    assert serialized is not None
    preset = json.loads(serialized.group(1))
    board = client.post("/api/dashboards", json={"name": "Recreated"}).json()
    path = f"/api/dashboards/{board['id']}/widgets"
    created = client.post(
        path,
        json={
            "title": preset["title"],
            "width": preset["width"],
            "spec": {"mode": "structured", "query": preset["query"]},
        },
    )
    assert created.status_code == 201
    widget = created.json()
    updated = client.put(f"{path}/{widget['id']}", json={"title": "My performed work", "width": "full"})
    assert updated.status_code == 200
    reopened = client.get(f"/api/dashboards/{board['id']}").json()["widgets"][0]
    assert reopened["title"] == "My performed work" and reopened["width"] == "full"
    assert reopened["spec"]["query"] == preset["query"]


@pytest.mark.parametrize("microsecond", [0, 500000])
def test_performed_query_keeps_local_start_days_and_excludes_unperformed_rows(db, monkeypatch, microsecond):
    import os
    import time
    from datetime import UTC, datetime, timedelta

    import timetrace.services.query_service as query_module
    from timetrace.core.dashboard_seeds import OVERVIEW_SEED, PERFORMED_TIME_PRESET
    from timetrace.db.models import Session as SessionModel
    from timetrace.interfaces.api.schemas import QueryContextRequest
    from timetrace.services.query_service import QueryService

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            value = datetime(2026, 11, 13, 12, 0, 0, microsecond, tzinfo=UTC)
            return value.astimezone(tz) if tz else value.replace(tzinfo=None)

        @classmethod
        def combine(cls, *args, **kwargs):
            return datetime.combine(*args, **kwargs)

    # SQLite localtime and the service must use the same local zone. Restore the process zone.
    old_zone = os.environ.get("TZ")
    monkeypatch.setenv("TZ", "Europe/Warsaw")
    time.tzset()
    monkeypatch.setattr(query_module, "datetime", FixedDatetime)
    monkeypatch.setattr(query_module, "daemon_timezone_name", lambda: "Europe/Warsaw")
    try:
        now = datetime(2026, 11, 13, 12, 0, 0, microsecond)
        for start, end, seconds in [
            (datetime(2026, 11, 11, 23, 30), datetime(2026, 11, 12, 0, 30), 3600),
            (now - timedelta(hours=1), now, 3600),
            (now + timedelta(hours=1), now + timedelta(hours=2), 3600),
            (now - timedelta(hours=1), None, 3600),
            (now - timedelta(hours=1), now + timedelta(hours=1), 7200),
            (datetime(2026, 10, 28, 23, 30), datetime(2026, 10, 29, 1, 30), 7200),
        ]:
            db.add(SessionModel(start_time=start, end_time=end, duration_seconds=seconds, tags="#a #b"))
        db.commit()
        service = QueryService(db)
        context = QueryContextRequest(timezone="Europe/Warsaw", first_day_of_week=1)
        result = service.run(PERFORMED_TIME_PRESET.query, context)
        assert sum(row.value for row in result.rows) == 2
        assert sum(row.comparison_value for row in result.rows) == 2
        assert len(result.rows) == 14
        rows = {row.keys[0]: row for row in result.rows}
        assert rows["2026-11-12"].value == 1  # UTC start was Nov11, local start is Nov12.
        assert rows["2026-11-13"].value == 1  # end exactly at now counts as performed.
        assert rows["2026-11-12"].comparison_value == 2
        assert result.comparison.alignment == "positional"
        originals = {seed.seed_key: seed.query for seed in OVERVIEW_SEED}
        assert service.run(originals["total_time"], context).total == 8
        assert service.run(originals["total_sessions"], context).total == 6
    finally:
        if old_zone is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = old_zone
        time.tzset()
