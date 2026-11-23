"""Focus policy through the public daemon HTTP interface."""


def test_focus_defaults_are_durable_receipted_and_future_timer_only(client):
    initial = client.get("/timer-focus/defaults")
    assert initial.status_code == 200
    assert initial.json() == {
        "revision": 0,
        "enabled": False,
        "work_minutes": 25,
        "break_minutes": 5,
        "behavior": "notify_only",
        "sound_enabled": False,
    }
    old = client.post("/timers", json={"operation_id": "old"}).json()["timer"]
    policy = {
        "operation_id": "defaults",
        "expected_revision": 0,
        "enabled": True,
        "work_minutes": 10,
        "break_minutes": 2,
        "behavior": "notify_only",
        "sound_enabled": False,
    }
    saved = client.post("/timer-focus/defaults", json=policy)
    assert saved.status_code == 200, saved.text
    assert client.post("/timer-focus/defaults", json=policy).json() == saved.json()
    assert client.get("/timer-focus/defaults").json()["work_minutes"] == 10
    assert client.get("/timers/" + old["id"]).json()["focus"]["settings"]["enabled"] is False
    new = client.post("/timers", json={"operation_id": "new"}).json()["timer"]
    assert new["focus"]["settings"]["work_minutes"] == 10
    assert new["focus"]["phase"] == "work"
    assert (
        client.post(
            "/timer-focus/defaults",
            json={**policy, "operation_id": "bad", "expected_revision": 1, "work_minutes": True},
        ).status_code
        == 422
    )
