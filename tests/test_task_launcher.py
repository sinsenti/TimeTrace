"""Public launcher HTTP contracts; no private helper or database side channels."""


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


def test_typo_candidates_are_labelled_and_literal_search_is_not_sql_wildcard(client):
    reading = task(client, "Reading")
    literal = task(client, "100%_complete")
    task(client, "Other task")
    task(client, "Straße")
    rows = client.get("/api/tasks/launcher", params={"q": "raeding"}).json()["suggestions"]
    assert [(r["id"], r["match_kind"]) for r in rows] == [(reading["id"], "fuzzy")]
    rows = client.get("/api/tasks/launcher", params={"q": "%_"}).json()["suggestions"]
    assert [r["id"] for r in rows] == [literal["id"]]
    rows = client.get("/api/tasks/launcher", params={"q": "STRASSE"}).json()["suggestions"]
    assert rows[0]["title"] == "Straße"
    assert rows[0]["match_kind"] == "exact"


def test_launcher_combines_literal_tag_discovery_with_title_ranking(client):
    wanted = task(client, "Reading", tags="Study%_work")
    task(client, "Reading", tags="Other")
    response = client.get("/api/tasks/launcher", params={"q": "read", "tag_contains": "%_"})
    assert [row["id"] for row in response.json()["suggestions"]] == [wanted["id"]]


def test_default_ranking_is_complete_across_metadata_batches_and_reads_do_not_create_work(client, db):
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
    result = TaskLauncherService(db).suggestions(limit=1, measurement_at=datetime(2000, 1, 10, 12), timezone="UTC")
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
