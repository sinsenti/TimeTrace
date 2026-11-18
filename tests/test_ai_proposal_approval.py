"""Real API and draft-service approval controls for the proposal UI workflow."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

import timetrace.services.ai_chat_service as chat_module
import timetrace.services.ai_tool_gateway as gateway_module
from timetrace.db.models import AIProviderConfig
from timetrace.db.models import Session as SessionModel
from timetrace.services.ai_audit_service import AIAuditService
from timetrace.services.ai_draft_service import AIDraftService


def test_legacy_ai_undo_cannot_detach_a_new_scheduled_session(client, db):
    drafts = AIDraftService(db)
    batch = drafts.create_batch(None, None, "create_task", "Synthetic task", None, None)
    drafts.add_item(batch.id, "create", "task", None, {"title": "Writing"})
    route = f"/api/ai/drafts/batches/{batch.id}"
    accepted = client.post(f"{route}/accept", json={}).json()["items"][0]
    assert accepted["status"] == "applied"
    task_id = accepted["applied_entity_id"]
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task_id, "start_time": "2099-01-04T14:00:00Z", "end_time": "2099-01-04T15:00:00Z"},
    ).json()
    undone = client.post(f"{route}/undo", json={}).json()["items"][0]
    assert undone["status"] == "failed"
    assert "with scheduled sessions" in undone["error"]
    assert client.get(f"/api/tasks/{task_id}").status_code == 200
    assert client.get(f"/scheduled-sessions/{plan['id']}").json() == plan


@pytest.mark.parametrize("stream", [False, True], ids=["json", "sse"])
def test_proposals_are_draft_only_until_selected_acceptance(client, db, monkeypatch, stream):
    class FakeAgent:
        def _message(self, context):
            context.gateway.propose_create_task(title="First approved task")
            context.gateway.propose_create_task(title="Still pending task")
            context.gateway.propose_remembered_instruction("Keep planning summaries concise.")
            return AIMessage(content="Two tasks are proposed.")

        async def ainvoke(self, payload, *, context):
            return {"messages": [*payload["messages"], self._message(context)]}

        async def astream(self, payload, *, context, **_kwargs):
            message = self._message(context)
            yield {"type": "messages", "data": (AIMessageChunk(content=message.content), {})}
            yield {"type": "updates", "data": {"model": {"messages": [message]}}}

    db.add(AIProviderConfig(name="Synthetic only", provider="ollama", model="fake", is_active=True))
    db.commit()
    monkeypatch.setattr(chat_module, "get_chat_model", lambda **_kwargs: object())
    monkeypatch.setattr(chat_module, "build_agent", lambda *_args, **_kwargs: FakeAgent())
    monkeypatch.setattr(gateway_module, "engine", db.get_bind())
    conversation = client.post("/api/ai/conversations", json={}).json()
    response = client.post(
        f"/api/ai/conversations/{conversation['id']}/messages",
        json={
            "text": "Remember this for future conversations: keep summaries concise. Propose two tasks.",
            "stream": stream,
        },
    )
    assert response.status_code == 200
    if stream:
        events = {}
        for frame in response.text.strip().split("\n\n"):
            name, data = frame.splitlines()
            events[name.removeprefix("event: ")] = json.loads(data.removeprefix("data: "))
        batch = events["draft"]
        instruction = events["instruction_proposal"]
    else:
        payload = response.json()
        batch = payload["draft_batch"]
        instruction = payload["instruction_proposal"]

    assert client.get("/api/tasks").json() == []
    assert client.get(f"/api/ai/instruction-proposals/{instruction['id']}").json()["status"] == "pending"
    item_ids = [item["id"] for item in batch["items"]]
    accepted = client.post(f"/api/ai/drafts/batches/{batch['id']}/accept", json={"item_ids": [item_ids[0]]})
    assert accepted.status_code == 200
    assert [(item["item_id"], item["status"]) for item in accepted.json()["items"]] == [(item_ids[0], "applied")]
    assert [task["title"] for task in client.get("/api/tasks").json()] == ["First approved task"]
    assert client.get(f"/api/ai/instruction-proposals/{instruction['id']}").json()["status"] == "pending"

    rejected = client.post(f"/api/ai/drafts/batches/{batch['id']}/reject", json={"item_ids": [item_ids[1]]})
    assert rejected.status_code == 200
    assert [(item["item_id"], item["status"]) for item in rejected.json()["items"]] == [(item_ids[1], "rejected")]
    assert [task["title"] for task in client.get("/api/tasks").json()] == ["First approved task"]


def test_undo_conflict_and_reapply_preserve_a_later_manual_task_edit(client, db, monkeypatch):
    task = client.post("/api/tasks", json={"title": "Original task"})
    assert task.status_code == 201
    task_id = task.json()["id"]

    class FakeAgent:
        def _message(self, context):
            context.gateway.propose_update_task(task_id, title="AI proposed title")
            return AIMessage(content="A task update is proposed.")

        async def ainvoke(self, payload, *, context):
            return {"messages": [*payload["messages"], self._message(context)]}

        async def astream(self, payload, *, context, **_kwargs):
            message = self._message(context)
            yield {"type": "messages", "data": (AIMessageChunk(content=message.content), {})}
            yield {"type": "updates", "data": {"model": {"messages": [message]}}}

    db.add(AIProviderConfig(name="Synthetic only", provider="ollama", model="fake", is_active=True))
    db.commit()
    monkeypatch.setattr(chat_module, "get_chat_model", lambda **_kwargs: object())
    monkeypatch.setattr(chat_module, "build_agent", lambda *_args, **_kwargs: FakeAgent())
    monkeypatch.setattr(gateway_module, "engine", db.get_bind())
    conversation = client.post("/api/ai/conversations", json={}).json()
    turn = client.post(
        f"/api/ai/conversations/{conversation['id']}/messages",
        json={"text": "Update this task title.", "stream": False},
    )
    assert turn.status_code == 200
    batch_id = turn.json()["draft_batch"]["id"]
    accepted = client.post(f"/api/ai/drafts/batches/{batch_id}/accept", json={})
    assert accepted.status_code == 200
    assert accepted.json()["items"][0]["status"] == "applied"
    audit = AIAuditService(db)
    applied_transitions = [(row.id, row.transition) for row in audit.list_for_batch(batch_id)]
    assert {transition for _, transition in applied_transitions} == {"proposed", "applied"}

    manual = client.put(f"/api/tasks/{task_id}", json={"title": "Later manual edit"})
    assert manual.status_code == 200
    undo = client.post(f"/api/ai/drafts/batches/{batch_id}/undo", json={})
    assert undo.status_code == 200
    assert undo.json()["items"][0]["status"] == "conflict"
    assert client.get(f"/api/tasks/{task_id}").json()["title"] == "Later manual edit"

    reapply = client.post(f"/api/ai/drafts/batches/{batch_id}/reapply", json={})
    assert reapply.status_code == 200
    assert reapply.json()["items"][0]["status"] == "conflict"
    assert client.get(f"/api/tasks/{task_id}").json()["title"] == "Later manual edit"
    assert [(row.id, row.transition) for row in audit.list_for_batch(batch_id)] == applied_transitions


def test_sequential_same_target_accept_reports_later_stale_item_as_failed(client, db, monkeypatch):
    task = client.post("/api/tasks", json={"title": "Original task"})
    assert task.status_code == 201
    task_id = task.json()["id"]

    class FakeAgent:
        def _message(self, context):
            context.gateway.propose_update_task(task_id, title="First accepted title")
            context.gateway.propose_update_task(task_id, title="Stale second title")
            return AIMessage(content="Two updates to the same task are proposed.")

        async def ainvoke(self, payload, *, context):
            return {"messages": [*payload["messages"], self._message(context)]}

        async def astream(self, payload, *, context, **_kwargs):
            message = self._message(context)
            yield {"type": "messages", "data": (AIMessageChunk(content=message.content), {})}
            yield {"type": "updates", "data": {"model": {"messages": [message]}}}

    db.add(AIProviderConfig(name="Synthetic only", provider="ollama", model="fake", is_active=True))
    db.commit()
    monkeypatch.setattr(chat_module, "get_chat_model", lambda **_kwargs: object())
    monkeypatch.setattr(chat_module, "build_agent", lambda *_args, **_kwargs: FakeAgent())
    monkeypatch.setattr(gateway_module, "engine", db.get_bind())
    conversation = client.post("/api/ai/conversations", json={}).json()
    turn = client.post(
        f"/api/ai/conversations/{conversation['id']}/messages",
        json={"text": "Propose two updates to this task.", "stream": False},
    )
    assert turn.status_code == 200
    batch_id = turn.json()["draft_batch"]["id"]
    item_ids = [item["id"] for item in turn.json()["draft_batch"]["items"]]

    accepted = client.post(f"/api/ai/drafts/batches/{batch_id}/accept", json={})
    assert accepted.status_code == 200
    assert [(item["item_id"], item["status"]) for item in accepted.json()["items"]] == [
        (item_ids[0], "applied"),
        (item_ids[1], "failed"),
    ]
    assert "stale" in accepted.json()["items"][1]["error"]
    assert client.get(f"/api/tasks/{task_id}").json()["title"] == "First accepted title"
    detail = client.get(f"/api/ai/drafts/batches/{batch_id}")
    assert detail.status_code == 200
    assert [item["status"] for item in detail.json()["items"]] == ["applied", "failed"]
    audit_transitions = [row.transition for row in AIAuditService(db).list_for_batch(batch_id)]
    assert len(audit_transitions) == 4
    assert set(audit_transitions) == {"proposed", "applied", "failed"}


def test_legacy_ai_proposal_cannot_change_a_newly_captured_occurrence(client, db):
    anchor = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    end = anchor + timedelta(hours=1)
    task_response = client.post(
        "/api/tasks",
        json={
            "title": "Protected series",
            "is_recurring": True,
            "recurrence_dtstart": anchor.isoformat(),
            "recurrence_timezone": "UTC",
            "recurrence_duration_minutes": 30,
        },
    )
    assert task_response.status_code == 201, task_response.text
    params = {"start": anchor.isoformat(), "end": end.isoformat()}
    (projection,) = client.get("/agenda", params=params).json()["items"]
    drafts = AIDraftService(db)
    batch_id = drafts.create_batch(None, None, "schedule", "Synthetic occurrence draft", None, None).id
    drafts.add_item(batch_id, "delete", "session", projection["id"], {})

    save = client.put(
        f"/scheduled-sessions/{projection['id']}",
        json={
            "start_time": anchor.isoformat(),
            "end_time": end.isoformat(),
            "expected_projection_revision": projection["projection_revision"],
        },
    )
    assert save.status_code == 200, save.text
    plan = save.json()
    drafts.add_item(batch_id, "update", "session", plan["id"], {"notes": "Unexpected v1 plan edit"})
    accepted = client.post(f"/api/ai/drafts/batches/{batch_id}/accept", json={})
    assert accepted.status_code == 200, accepted.text
    assert [item["status"] for item in accepted.json()["items"]] == ["failed", "failed"]
    assert client.get("/agenda", params=params).json()["items"] == [plan]
    reflected = client.post("/reflections", json={"session_id": plan["id"], "energy_level": 3})
    assert reflected.status_code == 409, reflected.text


@pytest.mark.parametrize("operation", ["create", "update"])
def test_legacy_ai_approval_refuses_title_scheduling_before_domain_write(client, db, operation):
    now = datetime.now(UTC)
    task = client.post("/api/tasks", json={"title": "Original"}).json() if operation == "update" else None
    target = task["id"] if task else None
    drafts = AIDraftService(db)
    batch = drafts.create_batch(None, None, f"{operation}_task", "Synthetic quick add", None, None)
    drafts.add_item(batch.id, operation, "task", target, {"title": "No implicit plan t:2h"})
    item = client.post(f"/api/ai/drafts/batches/{batch.id}/accept", json={}).json()["items"][0]
    assert item["status"] == "failed"
    assert "scheduling" in item["error"]
    assert [row["title"] for row in client.get("/api/tasks?status=all").json()] == (["Original"] if task else [])
    assert client.get("/sessions").json() == []
    params = {"start": now.isoformat(), "end": (datetime.now(UTC) + timedelta(hours=3)).isoformat()}
    assert client.get("/agenda", params=params).json()["items"] == []


def _approve_test_draft(client, db, op, entity, target, payload):
    drafts = AIDraftService(db)
    batch_id = drafts.create_batch(None, None, None, None, None, None).id
    drafts.add_item(batch_id, op, entity, target, payload)
    path = f"/api/ai/drafts/batches/{batch_id}"
    result = client.post(f"{path}/accept", json={}).json()["items"][0]
    return path, batch_id, result


@pytest.mark.parametrize("when", ["accept", "undo-create", "reapply"])
def test_ai_delete_rechecks_ratings_on_current_legacy_identity(client, db, when):
    payload = {"start_time": "2001-01-04T09:00Z", "end_time": "2001-01-04T10:00Z", "notes": "Keep"}
    if when == "undo-create":
        path, batch_id, applied = _approve_test_draft(client, db, "create", "session", None, payload)
        sid = applied["applied_entity_id"]
    else:
        sid = client.post("/sessions", json=payload).json()["id"]
        if when == "reapply":
            path, batch_id, applied = _approve_test_draft(client, db, "delete", "session", sid, {})
            assert applied["status"] == "applied"
            assert client.post(f"{path}/undo", json={}).json()["items"][0]["status"] == "undone"
            (restored,) = client.get("/sessions").json()
            assert restored["id"] != sid and restored["notes"] == "Keep"
            sid = restored["id"]
    definition = client.post("/rating-definitions", json={"name": "Evidence", "target_type": "session"}).json()["id"]
    rating = client.post(
        "/rating-entries",
        json={
            "rating_definition_id": definition,
            "target_type": "session",
            "target_id": sid,
            "score": 3,
        },
    ).json()
    if when == "accept":
        _, batch_id, outcome = _approve_test_draft(client, db, "delete", "session", sid, {})
    else:
        operation = "undo" if when == "undo-create" else "reapply"
        outcome = client.post(f"{path}/{operation}", json={}).json()["items"][0]
    assert outcome["status"] == "failed" and "ratings" in outcome["error"]
    assert client.get(f"/sessions/{sid}").json()["notes"] == "Keep"
    assert (
        client.get("/rating-entries", params={"target_type": "session", "target_id": sid}).json()[0]["id"]
        == rating["id"]
    )
    assert AIAuditService(db).list_for_batch(batch_id)[0].transition == "failed"


@pytest.mark.parametrize("dependency", ["work", "history", "child"])
def test_legacy_ai_task_delete_refuses_unrestorable_dependents(client, db, dependency):
    task_id = client.post("/api/tasks", json={"title": "Keep task"}).json()["id"]
    if dependency == "child":
        child = client.post("/api/tasks", json={"title": "Keep child", "parent_id": task_id}).json()["id"]
    else:
        row = SessionModel(
            task_id=task_id,
            start_time=datetime(2001, 1, 4, 9),
            end_time=datetime(2001, 1, 4, 10),
            duration_seconds=3600,
            kind="recorded_work" if dependency == "work" else "legacy_uncertain",
            provenance="manual" if dependency == "work" else None,
        )
        db.add(row)
        db.commit()
        sid = row.id
    _, _, outcome = _approve_test_draft(client, db, "delete", "task", task_id, {})
    assert outcome["status"] == "failed"
    assert client.get(f"/api/tasks/{task_id}").status_code == 200
    if dependency == "child":
        assert client.get(f"/api/tasks/{child}").json()["parent_id"] == task_id
    else:
        assert client.get(f"/sessions/{sid}").json()["task_id"] == task_id


def test_legacy_ai_delete_refuses_session_metadata_but_notes_edit_preserves_it(client, db):
    row = SessionModel(
        start_time=datetime(2001, 1, 4, 9),
        end_time=datetime(2001, 1, 4, 10),
        duration_seconds=3600,
        notes="Before",
        timezone="America/New_York",
        external_sync_id="synthetic-event",
        extended_properties_json='{"color":"green"}',
    )
    db.add(row)
    db.commit()
    sid = row.id
    _, _, outcome = _approve_test_draft(client, db, "delete", "session", sid, {})
    assert outcome["status"] == "failed" and "metadata" in outcome["error"]
    path, _, updated = _approve_test_draft(client, db, "update", "session", sid, {"notes": "After"})
    assert updated["status"] == "applied"
    assert client.post(f"{path}/undo", json={}).json()["items"][0]["status"] == "undone"
    current = client.get(f"/sessions/{sid}").json()
    assert (
        current["notes"],
        current["timezone"],
        current["external_sync_id"],
        current["extended_properties_json"],
    ) == (
        "Before",
        "America/New_York",
        "synthetic-event",
        '{"color":"green"}',
    )


@pytest.mark.parametrize("entity", ["session", "task"])
def test_ai_undo_refuses_restore_when_original_task_link_no_longer_exists(client, db, entity):
    task_id = client.post("/api/tasks", json={"title": "Original linked task"}).json()["id"]
    if entity == "session":
        created = client.post(
            "/sessions",
            json={
                "task_id": task_id,
                "start_time": "2001-01-04T09:00Z",
                "end_time": "2001-01-04T10:00Z",
            },
        ).json()
    else:
        created = client.post("/api/tasks", json={"title": "Child to restore", "parent_id": task_id}).json()
    path, _, applied = _approve_test_draft(client, db, "delete", entity, created["id"], {})
    assert applied["status"] == "applied"
    assert client.delete(f"/api/tasks/{task_id}").status_code == 204
    result = client.post(f"{path}/undo", json={}).json()["items"][0]
    assert result["status"] == "failed" and "task link" in result["error"]
    assert client.get("/api/tasks?status=all").json() == []
    assert client.get("/sessions").json() == []
