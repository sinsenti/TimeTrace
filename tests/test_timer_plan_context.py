"""Explicit plan context at the real root: reads never infer or change ownership."""

from uuid import uuid4


def test_plan_context_reads_preserve_task_only_and_paused_explicit_association(client):
    task = client.post("/api/tasks", json={"title": "Read synthetic notes"}).json()
    plans = [
        client.post(
            "/scheduled-sessions",
            json={
                "task_id": task["id"],
                "start_time": f"2025-01-02T{hour}:00:00Z",
                "end_time": f"2025-01-02T{hour}:30:00Z",
            },
        ).json()
        for hour in ("09", "11")
    ]
    timer = client.post("/timers", json={"operation_id": str(uuid4()), "task_id": task["id"]}).json()["timer"]
    assert timer["scheduled_session_id"] is None
    paused = client.post(f"/timers/{timer['id']}/pause", json={"operation_id": str(uuid4())}).json()["timer"]
    selected = client.post(
        "/timers",
        json={
            "operation_id": str(uuid4()),
            "task_id": task["id"],
            "scheduled_session_id": plans[1]["id"],
            "expected_plan_revision": plans[1]["revision"],
        },
    ).json()
    assert selected["selected_existing"] is True
    assert selected["timer"] == paused
    assert selected["timer"]["scheduled_session_id"] is None
    assert "association_not_changed" in [item["code"] for item in selected["information"]]
    before = client.get("/timers").json()
    for plan in plans:
        assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan
    after = client.get("/timers").json()
    assert after["revision"] == before["revision"]
    assert after["timers"] == before["timers"]


def test_fit_schedule_unavailable_reason_uses_recorded_work_language(client):
    plan = client.post(
        "/scheduled-sessions",
        json={"start_time": "2025-01-02T09:00:00Z", "end_time": "2025-01-02T10:00:00Z"},
    ).json()
    response = client.get(f"/scheduled-sessions/{plan['id']}/removal-preview")
    assert response.status_code == 200
    assert response.json()["blocked"]["squeeze"] == ["No explicitly linked recorded work to fit the schedule to."]


def test_explicit_timer_context_uses_its_plan_not_another_plan_for_the_same_task(client):
    task = client.post("/api/tasks", json={"title": "Synthetic linked reading"}).json()
    plans = [
        client.post(
            "/scheduled-sessions",
            json={
                "task_id": task["id"],
                "start_time": f"2025-01-02T{hour}:00:00Z",
                "end_time": f"2025-01-02T{hour}:30:00Z",
            },
        ).json()
        for hour in ("09", "11")
    ]
    timer = client.post(
        "/timers",
        json={
            "operation_id": str(uuid4()),
            "task_id": task["id"],
            "scheduled_session_id": plans[0]["id"],
            "expected_plan_revision": plans[0]["revision"],
        },
    ).json()["timer"]
    paused = client.post(f"/timers/{timer['id']}/pause", json={"operation_id": str(uuid4())}).json()["timer"]
    selected = client.post(
        "/timers",
        json={
            "operation_id": str(uuid4()),
            "task_id": task["id"],
            "scheduled_session_id": plans[1]["id"],
            "expected_plan_revision": plans[1]["revision"],
        },
    ).json()["timer"]
    assert selected == paused
    assert selected["state"] == "paused"
    assert selected["scheduled_session_id"] == plans[0]["id"]
    before = client.get("/timers").json()
    linked_plan = client.get(f"/scheduled-sessions/{selected['scheduled_session_id']}").json()
    # Explicit Start advances the plan dependency revision, not its timestamps.
    assert linked_plan == {**plans[0], "revision": plans[0]["revision"] + 1}
    assert client.get(f"/scheduled-sessions/{selected['scheduled_session_id']}").json() == linked_plan
    assert linked_plan["task_id"] == selected["task_id"]
    after = client.get("/timers").json()
    assert after["revision"] == before["revision"]
    assert after["timers"] == before["timers"]


def test_root_pages_serve_versioned_plan_context_and_fit_action_assets(client):
    for page in (
        "/dashboard",
        "/tasks",
        "/agenda-view",
        "/stats",
        "/habits-view",
        "/revision",
        "/settings",
        "/settings/ai",
    ):
        response = client.get(page)
        assert response.status_code == 200
        assert response.text.count('src="/static/js/multiple_timers.js?v=stop67-2"') == 1
    agenda = client.get("/agenda-view").text
    assert 'src="/static/js/plan_removal.js?v=stop67-1"' in agenda
    timer_asset = client.get("/static/js/multiple_timers.js?v=stop67-2")
    removal_asset = client.get("/static/js/plan_removal.js?v=stop67-1")
    assert timer_asset.status_code == removal_asset.status_code == 200
    assert "No linked plan" in timer_asset.text
    assert "Fit schedule to recorded work" in removal_asset.text
