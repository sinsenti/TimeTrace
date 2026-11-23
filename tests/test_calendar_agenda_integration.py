"""Calendar and Agenda consume one root HTTP dataset, never infer performed work."""


def test_calendar_keeps_layout_and_exposes_explicit_manual_recording(client):
    page = client.get("/dashboard")
    assert page.status_code == 200
    for marker in ('id="calendar"', 'id="task_card_list"', 'value="work"', "manual_work_recovery", "multiple_timers"):
        assert marker in page.text
    assert 'value="legacy"' not in page.text
    assert client.get("/agenda-view").status_code == 200


def test_cross_page_dataset_distinguishes_past_plan_work_and_legacy(client):
    interval = {"start_time": "2000-01-04T09:00:00Z", "end_time": "2000-01-04T10:00:00Z"}
    task = client.post("/api/tasks", json={"title": "Shared calendar task"}).json()["id"]
    plan = client.post("/scheduled-sessions", json={**interval, "task_id": task}).json()
    assert client.get("/sessions").json() == []
    work = client.post("/recorded-work", json={**interval, "task_id": task}).json()
    legacy = client.post("/sessions", json=interval).json()
    params = {"start": "2000-01-04T00:00:00Z", "end": "2000-01-05T00:00:00Z"}
    for extra in ({}, {"legacy_cohort": "start"}):
        rows = client.get("/agenda", params={**params, **extra}).json()["items"]
        assert {(row["id"], row["kind"]) for row in rows} == {
            (plan["id"], "scheduled_session"),
            (work["id"], "recorded_work"),
            (legacy["id"], "legacy_uncertain"),
        }
        assert len(rows) == 3
    moved = client.put(
        f"/scheduled-sessions/{plan['id']}",
        json={
            "start_time": "2000-01-04T11:00:00Z",
            "end_time": "2000-01-04T12:00:00Z",
            "expected_revision": plan["revision"],
        },
    )
    assert moved.status_code == 200
    assert moved.json()["original_start"] == interval["start_time"]
    assert client.get(f"/recorded-work/{work['id']}").json()["start_time"] == interval["start_time"]
    assert client.put(f"/sessions/{work['id']}", json=interval).status_code == 409
