import pytest


@pytest.mark.parametrize("target", [0, -1, 5])
@pytest.mark.parametrize("amount", [0, -3])
def test_numeric_zero_is_pending_for_every_target(client, target, amount):
    habit = client.post("/habits", json={"name": "Numeric", "habit_type": "numeric", "target_value": target}).json()
    response = client.post(f"/habits/{habit['id']}/log", json={"date_str": "2026-11-01", "set_value": amount})
    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    assert response.json()["value"] == 0


@pytest.mark.parametrize("status", ["completed", "failed", "skipped"])
def test_boolean_sequential_upsert_and_selected_day_clear(client, status):
    a = client.post("/habits", json={"name": "A"}).json()["id"]
    b = client.post("/habits", json={"name": "B"}).json()["id"]
    first = client.post(f"/habits/{a}/log", json={"date_str": "2026-11-01", "status": "completed"}).json()
    updated = client.post(f"/habits/{a}/log", json={"date_str": "2026-11-01", "status": status}).json()
    assert updated["id"] == first["id"]
    assert updated["status"] == status
    for habit, day in [(a, "2026-11-02"), (b, "2026-11-01")]:
        assert client.post(f"/habits/{habit}/log", json={"date_str": day, "status": "skipped"}).status_code == 200
    assert client.get(f"/habits/{a}/stats").json()["summary"]["total_logs"] == 2
    client.post(f"/habits/{a}/log", json={"date_str": "2026-11-01", "status": "erase"})
    assert client.get(f"/habits/{a}/stats").json()["history"] == [
        {"date": "2026-11-02", "value": 0, "status": "skipped"}
    ]
    assert client.get(f"/habits/{b}/stats").json()["summary"]["total_logs"] == 1


def test_target_update_preserves_logs_notes_metadata_and_recorded_denominator(client, db):
    from timetrace.db.models import HabitGoalHistory, HabitLog

    habit = client.post(
        "/habits",
        json={
            "name": "Numeric",
            "habit_type": "numeric",
            "target_value": 5,
            "frequency": "custom schedule",
            "reminder_time": "custom reminder",
            "unit": "freeform units",
            "color": "#aabbcc",
        },
    ).json()
    id = habit["id"]
    old = HabitLog(habit_id=id, date_str="2025-01-01", value=0, status="completed", notes="Retain historic notes")
    db.add(old)
    db.add(HabitGoalHistory(habit_id=id, effective_from="2025-01-01", target_value=2))
    db.commit()
    written = client.post(f"/habits/{id}/log", json={"date_str": "2026-11-01", "set_value": 3}).json()
    assert written["status"] == "in_progress"
    client.post(f"/habits/{id}/log", json={"date_str": "2026-11-02", "set_value": 0})
    updated = client.put(f"/habits/{id}", json={"target_value": -1}).json()
    for key in ["frequency", "reminder_time", "unit", "color"]:
        assert updated[key] == habit[key]
    stats = client.get(f"/habits/{id}/stats").json()
    assert stats["summary"] == {"completed": 1, "failed": 0, "skipped": 0, "total_logs": 3}
    assert stats["history"][0] == {"date": "2025-01-01", "value": 0, "status": "completed"}
    assert stats["history"][1]["status"] == "in_progress"
    assert stats["goal_history"][0] == {"target_value": 2, "effective_from": "2025-01-01"}
    # Explicit later writes derive new status, without replacing metadata on the row.
    changed = client.post(f"/habits/{id}/log", json={"date_str": "2025-01-01", "set_value": 1}).json()
    assert changed["notes"] == "Retain historic notes"
    assert changed["id"] == old.id
    assert changed["status"] == "completed"
    zero = client.post(f"/habits/{id}/log", json={"date_str": "2025-01-01", "set_value": 0}).json()
    assert zero["notes"] == "Retain historic notes"
    assert zero["status"] == "pending"
    # Old dates are omitted by the convenience list, not erased from storage/stats.
    listed = next(h for h in client.get("/habits").json() if h["id"] == id)
    assert "2025-01-01" not in listed["logs"]
    assert client.get(f"/habits/{id}/stats").json()["summary"]["total_logs"] == 3


@pytest.mark.parametrize(
    "target,amount,status", [(0, 1, "completed"), (-1, 1, "completed"), (5, 3, "in_progress"), (5, 5, "completed")]
)
def test_numeric_nonzero_derivation_is_unchanged(client, target, amount, status):
    id = client.post("/habits", json={"name": "Numeric", "habit_type": "numeric", "target_value": target}).json()["id"]
    first = client.post(f"/habits/{id}/log", json={"date_str": "2026-11-01", "set_value": amount}).json()
    assert first["status"] == status
    zero = client.post(f"/habits/{id}/log", json={"date_str": "2026-11-01", "delta_value": -100}).json()
    assert zero["id"] == first["id"]
    assert zero["value"] == 0
    assert zero["status"] == "pending"
