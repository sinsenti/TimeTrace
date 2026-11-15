"""Ticket 18: preserve shipped rating contracts through the real daemon HTTP boundary."""

from datetime import datetime

import pytest


@pytest.mark.parametrize("bounds", [(0, 10), (-10, 0), (2, 7)])
def test_definition_bounds_context_and_history_are_preserved(client, bounds):
    low, high = bounds
    created = client.post(
        "/rating-definitions",
        json={
            "name": "Synthetic scale",
            "target_type": "day",
            "min_score": low,
            "max_score": high,
            "is_required": True,
            "description": "<img src=x onerror=alert(1)>",
        },
    )
    assert created.status_code == 201
    definition = created.json()
    definition_id = definition["id"]
    entry = {"rating_definition_id": definition_id, "target_type": "day", "target_id": "2026-11-01"}
    saved = client.post("/rating-entries", json={**entry, "score": high}).json()
    assert saved["score"] == high
    assert client.post("/rating-entries", json={**entry, "score": high + 1}).status_code == 400
    updated = client.put(
        f"/rating-definitions/{definition_id}", json={"min_score": low - 5, "max_score": low, "target_type": "task"}
    )
    assert updated.status_code == 200
    assert client.get("/rating-definitions?target_type=day").json() == []
    assert client.get("/rating-definitions?target_type=task").json()[0]["id"] == definition_id
    historical = client.get("/rating-entries?target_type=day&target_id=2026-11-01").json()[0]
    assert historical["score"] == high  # Range/context edits never rewrite past scores or targets.
    assert historical["id"] == saved["id"]
    assert historical["definition"]["description"] == "<img src=x onerror=alert(1)>"
    dismissed = client.post("/rating-entries", json={**entry, "score": 999, "dismissed": True})
    assert dismissed.status_code == 201  # Required does not forbid shipped explicit dismissal.
    assert dismissed.json()["dismissed"] is True
    assert dismissed.json()["id"] == saved["id"]
    assert client.delete(f"/rating-definitions/{definition_id}").status_code == 204
    assert client.get("/rating-entries?target_type=day&target_id=2026-11-01").json() == []
    assert client.delete(f"/rating-definitions/{definition_id}").status_code == 404


def test_definition_context_and_reversed_bounds_are_not_new_ui_domain_policy(client):
    # The shipped schema/service does not constrain these; administration must not invent policy.
    result = client.post(
        "/rating-definitions", json={"name": "Context", "target_type": "custom", "min_score": 5, "max_score": -2}
    )
    assert result.status_code == 201
    assert result.json()["target_type"] == "custom"
    assert result.json()["min_score"] == 5
    assert result.json()["max_score"] == -2


@pytest.mark.parametrize("target_type", ["day", "session", "task"])
def test_required_dismissal_is_independent_of_session_exemption_and_review_text(client, target_type):
    task = client.post("/api/tasks", json={"title": "Synthetic review subject"}).json()
    session = client.post(
        "/sessions",
        json={
            "task_id": task["id"],
            "start_time": "2026-10-11T12:00:00Z",
            "end_time": "2026-10-11T13:00:00Z",
            "notes": "Recorded work",
            "review_skipped": True,
        },
    ).json()
    target_id = {"day": "2026-10-11", "task": task["id"], "session": session["id"]}[target_type]
    definition = client.post(
        "/rating-definitions",
        json={"name": "Required", "target_type": target_type, "is_required": True, "min_score": 0, "max_score": 4},
    ).json()
    payload = {"rating_definition_id": definition["id"], "target_type": target_type, "target_id": target_id}
    dismissed = client.post("/rating-entries", json={**payload, "dismissed": True, "score": 0}).json()
    assert dismissed["dismissed"] is True
    undismissed = client.post("/rating-entries", json={**payload, "dismissed": False, "score": 4}).json()
    assert undismissed["id"] == dismissed["id"]
    assert undismissed["score"] == 4
    assert undismissed["dismissed"] is False
    assert client.delete(f"/rating-definitions/{definition['id']}").status_code == 204
    retained_session = client.get(f"/sessions/{session['id']}").json()
    assert retained_session["review_skipped"] is True
    assert retained_session["notes"] == "Recorded work"
    assert datetime.fromisoformat(retained_session["start_time"]) == datetime.fromisoformat(session["start_time"])
    assert datetime.fromisoformat(retained_session["end_time"]) == datetime.fromisoformat(session["end_time"])
    retained_task = client.get(f"/api/tasks/{task['id']}").json()
    assert retained_task["status"] == task["status"]


def test_equal_bounds_and_missing_definition_responses_remain_shipped_contract(client):
    created = client.post(
        "/rating-definitions", json={"name": "Equal scale", "target_type": "day", "min_score": 0, "max_score": 0}
    )
    assert created.status_code == 201
    definition_id = created.json()["id"]
    payload = {"rating_definition_id": definition_id, "target_type": "day", "target_id": "2026-11-01"}
    assert client.post("/rating-entries", json={**payload, "score": 0}).status_code == 201
    assert client.post("/rating-entries", json={**payload, "score": 1}).status_code == 400
    assert client.delete(f"/rating-definitions/{definition_id}").status_code == 204
    assert client.put(f"/rating-definitions/{definition_id}", json={"name": "Missing"}).status_code == 404
    assert client.post("/rating-entries", json={**payload, "score": 0}).status_code == 404
