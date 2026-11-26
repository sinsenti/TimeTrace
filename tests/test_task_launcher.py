"""Public launcher HTTP contracts; no private helper or database side channels."""

import pytest


def task(client, title, **fields):
    response = client.post("/api/tasks", json={"title": title, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_default_suggestions_prioritize_current_plans_then_priority_and_recorded_task_time(client, db):
    from datetime import datetime

    from timetrace.services import TaskLauncherService

    low = task(client, "Low priority", priority="low")
    high_short = task(client, "High short", priority="high")
    high_long = task(client, "High long", priority="high")
    medium = task(client, "Medium", priority="medium")
    soon = task(client, "Starts soon", priority="low")
    now = task(client, "Scheduled now", priority="low")
    for owner, start, end in [
        (soon, "2000-01-10T12:30:00Z", "2000-01-10T13:00:00Z"),
        (now, "2000-01-10T11:30:00Z", "2000-01-10T12:30:00Z"),
        (now, "2000-01-10T12:40:00Z", "2000-01-10T13:30:00Z"),
    ]:
        response = client.post(
            "/scheduled-sessions", json={"task_id": owner["id"], "start_time": start, "end_time": end}
        )
        assert response.status_code == 201, response.text
    for owner, start, end in [
        (high_short, "1999-12-20T09:00:00Z", "1999-12-20T10:00:00Z"),
        (high_long, "1999-12-20T10:00:00Z", "1999-12-20T12:00:00Z"),
        (high_long, "1999-12-20T11:00:00Z", "1999-12-20T13:00:00Z"),
        (low, "1999-12-20T09:00:00Z", "1999-12-20T14:00:00Z"),
    ]:
        response = client.post("/recorded-work", json={"task_id": owner["id"], "start_time": start, "end_time": end})
        assert response.status_code == 201, response.text
    result = TaskLauncherService(db).suggestions(measurement_at=datetime(2000, 1, 10, 12), timezone="UTC")
    rows = result["suggestions"]
    assert [r["id"] for r in rows] == [t["id"] for t in [now, soon, high_long, high_short, medium, low]]
    assert rows[0]["scheduled_state"] == "now"
    assert rows[1]["scheduled_state"] == "soon"
    assert rows[2]["recorded_hours"] == 3
    assert all("scheduled_session_id" not in row for row in rows)


@pytest.mark.parametrize("view", ["suggested", "priority"])
def test_typo_candidates_are_labelled_and_literal_search_is_not_sql_wildcard(client, view):
    reading = task(client, "Reading")
    literal = task(client, "100%_complete")
    task(client, "Other task")
    task(client, "Straße")
    rows = client.get("/api/tasks/launcher", params={"q": "raeding", "view": view}).json()["suggestions"]
    assert [(r["id"], r["match_kind"]) for r in rows] == [(reading["id"], "fuzzy")]
    rows = client.get("/api/tasks/launcher", params={"q": "%_", "view": view}).json()["suggestions"]
    assert [r["id"] for r in rows] == [literal["id"]]
    rows = client.get("/api/tasks/launcher", params={"q": "STRASSE", "view": view}).json()["suggestions"]
    assert rows[0]["title"] == "Straße"
    assert rows[0]["match_kind"] == "exact"


def test_launcher_combines_literal_tag_discovery_with_title_ranking(client):
    wanted = task(client, "Reading", tags="Study%_work")
    task(client, "Reading", tags="Other")
    response = client.get("/api/tasks/launcher", params={"q": "read", "tag_contains": "%_"})
    assert [row["id"] for row in response.json()["suggestions"]] == [wanted["id"]]


@pytest.mark.parametrize("view", ["suggested", "priority"])
def test_ranking_is_complete_across_metadata_batches_and_reads_do_not_create_work(client, db, view):
    from datetime import datetime

    from timetrace.services import TaskLauncherService

    for i in range(202):
        task(client, f"Alpha {i:03}", priority="high")
    worked = task(client, "Zeta worked", priority="high")
    response = client.post(
        "/recorded-work",
        json={"task_id": worked["id"], "start_time": "2000-01-01T10:00:00Z", "end_time": "2000-01-01T11:00:00Z"},
    )
    assert response.status_code == 201, response.text
    params = {"start": "2000-01-01T00:00:00Z", "end": "2000-02-01T00:00:00Z"}
    before_response = client.get("/agenda", params=params)
    assert before_response.status_code == 200
    before = before_response.json()["items"]
    result = TaskLauncherService(db).suggestions(
        limit=1, view=view, measurement_at=datetime(2000, 1, 10, 12), timezone="UTC"
    )
    assert result["suggestions"][0]["id"] == worked["id"]
    assert result["suggestions"][0]["recorded_hours"] == 1
    assert client.get("/agenda", params=params).json()["items"] == before


def test_scheduled_suggestions_reuse_virtual_projection_and_respect_a_moved_occurrence(client, db):
    from datetime import UTC, datetime, timedelta

    from timetrace.services import SessionService, TaskLauncherService

    now = datetime.now(UTC).replace(microsecond=0)
    anchor = now + timedelta(minutes=15)
    ordinary = task(client, "Ordinary high", priority="high")
    recurring = task(
        client,
        "Recurring low",
        priority="low",
        is_recurring=True,
        recurrence_rule="daily",
        recurrence_dtstart=anchor.isoformat(),
        recurrence_duration_minutes=30,
        recurrence_timezone="UTC",
    )
    plan = next(
        p for p in SessionService(db).list_planning_plans(now, now + timedelta(hours=1)) if p.task_id == recurring["id"]
    )
    assert plan.is_virtual
    path = f"/scheduled-sessions/{plan.id}"
    original = client.get(path).json()
    rows = TaskLauncherService(db).suggestions(timezone="UTC", measurement_at=now)["suggestions"]
    assert rows[0]["id"] == recurring["id"]
    priority_rows = TaskLauncherService(db).suggestions(view="priority", measurement_at=now)["suggestions"]
    assert [row["id"] for row in priority_rows] == [ordinary["id"], recurring["id"]]
    assert priority_rows[1]["scheduled_state"] == "soon"
    assert client.get(path).json() == original
    response = client.put(
        path,
        json={
            "start_time": (anchor + timedelta(hours=3)).isoformat(),
            "end_time": (anchor + timedelta(hours=3, minutes=30)).isoformat(),
            "expected_projection_revision": original["projection_revision"],
        },
    )
    assert response.status_code == 200, response.text
    rows = TaskLauncherService(db).suggestions(timezone="UTC", measurement_at=now)["suggestions"]
    assert rows[0]["id"] == ordinary["id"]
    assert next(r for r in rows if r["id"] == recurring["id"])["scheduled_state"] is None
    moved = client.get(path).json()
    priority_rows = TaskLauncherService(db).suggestions(view="priority", priority="low", measurement_at=now)[
        "suggestions"
    ]
    assert priority_rows[0]["scheduled_state"] is None
    assert client.get(path).json() == moved


def test_launcher_uses_the_analytics_daemon_day_when_browser_timezone_differs(client, db, monkeypatch):
    from datetime import datetime

    import timetrace.core.timezones as zones
    from timetrace.services import TaskLauncherService

    monkeypatch.setenv("TZ", "UTC")
    zones._reset_caches()
    try:
        task(client, "Alpha no work", priority="high")
        worked = task(client, "Beta worked", priority="high")
        response = client.post(
            "/recorded-work",
            json={"task_id": worked["id"], "start_time": "2000-01-10T00:00:00Z", "end_time": "2000-01-10T00:10:00Z"},
        )
        assert response.status_code == 201, response.text
        result = TaskLauncherService(db).suggestions(
            timezone="America/Los_Angeles", measurement_at=datetime(2000, 1, 10, 0, 30)
        )
        assert result["suggestions"][0]["id"] == worked["id"]
        assert result["suggestions"][0]["recorded_hours"] > 0
        assert result["timezone"] == "UTC"
    finally:
        zones._reset_caches()


def test_launcher_uses_configured_completion_flags_and_opt_in(client):
    response = client.post("/api/tasks/statuses", json={"name": "Shelved", "is_completed": True})
    assert response.status_code == 201, response.text
    finished = task(client, "Reading done", status="Shelved")
    active = task(client, "Reading active")
    response = client.get("/api/tasks/launcher", params={"q": "reading"})
    assert [r["id"] for r in response.json()["suggestions"]] == [active["id"]]
    included = client.get("/api/tasks/launcher", params={"q": "reading", "include_completed": True}).json()
    assert {r["id"] for r in included["suggestions"]} == {active["id"], finished["id"]}
    assert next(r for r in included["suggestions"] if r["id"] == finished["id"])["completed"] is True


def test_launcher_ranks_titles_before_limiting_not_by_creation_id(client):
    for i in range(12):
        task(client, f"Read book {i:02}")
    exact = task(client, "READ")
    task(client, "Notes about reading")
    response = client.get("/api/tasks/launcher", params={"q": "read", "limit": 2})
    assert response.status_code == 200, response.text
    rows = response.json()["suggestions"]
    assert rows[0]["id"] == exact["id"]
    assert [r["match_kind"] for r in rows] == ["exact", "prefix"]
    assert len(rows) == 2


def test_priority_discovery_filters_the_full_stream_before_limiting(client):
    for i in range(23):
        task(client, f"Reading high {i:02}", priority="high")
    low = task(client, "Reading low", priority="low")
    unset = task(client, "Reading unset")
    task(client, "Unrelated low", priority="low")
    response = client.get("/api/tasks/launcher", params={"view": "priority", "priority": "low", "q": "reading"})
    assert response.status_code == 200, response.text
    assert [row["id"] for row in response.json()["suggestions"]] == [low["id"]]
    response = client.get("/api/tasks/launcher", params={"view": "priority", "priority": "none", "q": "reading"})
    assert [row["id"] for row in response.json()["suggestions"]] == [unset["id"]]


def test_priority_view_keeps_schedule_badges_without_promoting_low_priority(client, db):
    from datetime import datetime

    from timetrace.services import TaskLauncherService

    low = task(client, "A low planned", priority="low")
    unset = task(client, "A unset")
    medium = task(client, "A medium", priority="medium")
    high = task(client, "Z high", priority="high")
    worked = task(client, "Z high worked", priority="high")
    assert (
        client.post(
            "/scheduled-sessions",
            json={"task_id": low["id"], "start_time": "2000-01-10T11:30:00Z", "end_time": "2000-01-10T12:30:00Z"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/recorded-work",
            json={"task_id": worked["id"], "start_time": "2000-01-01T10:00:00Z", "end_time": "2000-01-01T11:00:00Z"},
        ).status_code
        == 201
    )
    result = TaskLauncherService(db).suggestions(view="priority", measurement_at=datetime(2000, 1, 10, 12))
    assert [r["id"] for r in result["suggestions"]] == [worked["id"], high["id"], medium["id"], low["id"], unset["id"]]
    assert result["suggestions"][0]["recorded_hours"] == 1
    assert result["suggestions"][3]["scheduled_state"] == "now"
    assert all("scheduled_session_id" not in r for r in result["suggestions"])


def test_priority_filtered_search_preserves_title_ranks_tags_parent_and_configured_completion(client):
    assert client.post("/api/tasks/statuses", json={"name": "Shelved", "is_completed": True}).status_code == 201
    parent = task(client, "Parent")
    exact = task(client, "READ", priority="low", tags="Study%_work", parent_id=parent["id"])
    prefix = task(client, "Reading", priority="low", tags="Study%_work")
    task(client, "Read high", priority="high", tags="Study%_work")
    done = task(client, "Read done", priority="low", tags="Study%_work", status="Shelved")
    task(client, "Read untagged", priority="low")
    params = {"view": "priority", "priority": "low", "q": "read", "tag_contains": "%_", "limit": 2}
    response = client.get("/api/tasks/launcher", params=params)
    assert response.status_code == 200, response.text
    rows = response.json()["suggestions"]
    assert [(r["id"], r["match_kind"]) for r in rows] == [(exact["id"], "exact"), (prefix["id"], "prefix")]
    assert rows[0]["parent_title"] == "Parent"
    rows = client.get("/api/tasks/launcher", params={**params, "include_completed": True, "limit": 50}).json()[
        "suggestions"
    ]
    assert {r["id"] for r in rows} == {exact["id"], prefix["id"], done["id"]}
    assert next(r for r in rows if r["id"] == done["id"])["completed"] is True


def test_launcher_validates_view_priority_and_bounds_at_http_and_service(client, db):
    from timetrace.core.exceptions import ValidationError
    from timetrace.services import TaskLauncherService

    for params in [
        {"view": "unsupported"},
        {"priority": "unknown"},
        {"limit": 51},
        {"limit": 0},
        {"query": "x" * 201},
        {"tag_contains": "x" * 201},
    ]:
        http_params = {"q" if key == "query" else key: value for key, value in params.items()}
        assert client.get("/api/tasks/launcher", params=http_params).status_code == 422
        with pytest.raises(ValidationError):
            TaskLauncherService(db).suggestions(**params)


def test_agenda_serves_priority_filters_and_bounded_discovery_hooks(client):
    from html.parser import HTMLParser

    class DiscoveryHTML(HTMLParser):
        def __init__(self):
            super().__init__()
            self.nodes = []

        def handle_starttag(self, tag, attrs):
            self.nodes.append((tag, dict(attrs)))

    response = client.get("/agenda-view")
    assert response.status_code == 200
    page = DiscoveryHTML()
    page.feed(response.text)
    by_id = {attrs["id"]: (tag, attrs) for tag, attrs in page.nodes if "id" in attrs}
    assert by_id["agenda-priority"][0] == "select"
    assert by_id["agenda-activities"][1]["class"] == "agenda-priority-results"
    assert {attrs["value"] for tag, attrs in page.nodes if tag == "option"} >= {"all", "high", "medium", "low", "none"}
    assert any(attrs.get("src") == "/static/js/task_launcher.js?v=ui72-priority1" for _, attrs in page.nodes)
    assert any(attrs.get("href") == "/static/css/agenda_discovery.css?v=ui72-priority1" for _, attrs in page.nodes)
    assert by_id["agenda-manage-pins"][0] == "button"
    assert client.get("/static/css/agenda_discovery.css").status_code == 200
