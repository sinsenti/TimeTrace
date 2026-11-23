"""Calendar and Agenda consume one root HTTP dataset, never infer performed work."""


def test_live_status_has_authoritative_observation_cutoff(client):
    from datetime import datetime

    status = client.get("/timers")
    assert status.status_code == 200
    assert datetime.fromisoformat(status.json()["observed_at"]).tzinfo is not None


def test_live_geometry_reuses_corrected_segments_and_committed_identities(client):
    from uuid import uuid4

    def post(path, payload=None):
        response = client.post(path, json={"operation_id": str(uuid4()), **(payload or {})})
        assert response.status_code == 200, response.text
        return response.json()

    timer = post("/timers", {"notes": "live separate note"})["timer"]
    post("/timers/correction-initialize")
    resource = f"/timers/{timer['id']}"
    preview = client.post(
        resource + "/correction-preview",
        json={
            "target": {"kind": "running", "segment_id": timer["running_segment_id"]},
            "change": {"kind": "step_start", "credited_delta_seconds": 300},
        },
    )
    assert preview.status_code == 200, preview.text
    corrected = post(resource + "/correction", {"preview": preview.json()})["timer"]
    paused = post(resource + "/pause")["timer"]
    first = paused["segments"][0]
    assert first["start_time"] == corrected["running_start"]
    assert paused["running_start"] is None
    assert client.get(resource).json()["segments"] == paused["segments"]
    post(resource + "/resume")
    split = post(resource + "/split", {"new_notes": "future note"})
    status = client.get(resource).json()
    assert status["running_segment_id"] not in {s["id"] for s in status["segments"]}
    assert {s["recorded_work_id"] for s in status["segments"]} == set(split["recorded_work_ids"])
    saved = client.get("/recorded-work/" + split["recorded_work_ids"][0]).json()
    assert saved["start_time"].replace("Z", "+00:00") == first["start_time"]
    assert saved["notes"] == "live separate note"
    assert status["notes"] == "future note"
    stopped = post(resource + "/stop")
    assert len(stopped["recorded_work_ids"]) == 1
    assert client.get("/timers").json()["timers"] == []


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
