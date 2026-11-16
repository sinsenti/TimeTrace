"""Real API and draft-service approval controls for the proposal UI workflow."""

import json

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

import timetrace.services.ai_chat_service as chat_module
import timetrace.services.ai_tool_gateway as gateway_module
from timetrace.db.models import AIProviderConfig
from timetrace.services.ai_audit_service import AIAuditService


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
