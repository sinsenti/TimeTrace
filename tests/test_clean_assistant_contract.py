"""Shared drawer protocol characterization: real HTTP/services, fake model execution only."""

import json

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

import timetrace.services.ai_chat_service as chat_module
import timetrace.services.ai_tool_gateway as gateway_module
from timetrace.db.models import AIProviderConfig


@pytest.mark.parametrize("stream", [False, True], ids=["json", "sse"])
def test_clean_assistant_proposals_need_explicit_independent_approval(client, db, monkeypatch, stream):
    class FakeAgent:
        def propose(self, context):
            context.gateway.propose_create_task(title="<literal task>")
            context.gateway.propose_remembered_instruction("Prefer <literal> concise answers.")
            return AIMessage(content="<literal reply>")

        async def ainvoke(self, payload, *, context):
            return {"messages": [*payload["messages"], self.propose(context)]}

        async def astream(self, _payload, *, context, **_kwargs):
            message = self.propose(context)
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
        json={"text": "Remember this for future conversations: keep answers concise.", "stream": stream},
    )
    assert response.status_code == 200
    if stream:
        events = {}
        for frame in response.text.strip().split("\n\n"):
            name, data = frame.splitlines()
            events[name.removeprefix("event: ")] = json.loads(data.removeprefix("data: "))
        batch, proposal = events["draft"], events["instruction_proposal"]
        assert events["message_end"]["content"] == "<literal reply>"
    else:
        batch, proposal = response.json()["draft_batch"], response.json()["instruction_proposal"]
        assert response.json()["message"]["content"] == "<literal reply>"
    assert client.get("/api/tasks").json() == []
    assert client.get("/sessions").json() == []
    assert client.get("/api/ai/settings").json()["custom_instructions"] == ""
    base = f"/api/ai/drafts/batches/{batch['id']}"
    assert client.post(base + "/accept", json={}).status_code == 200
    assert [task["title"] for task in client.get("/api/tasks").json()] == ["<literal task>"]
    assert client.get("/api/ai/settings").json()["custom_instructions"] == ""
    assert client.post(base + "/undo", json={}).status_code == 200
    assert client.get("/api/tasks").json() == []
    assert client.post(base + "/reapply", json={}).status_code == 200
    assert len(client.get("/api/tasks").json()) == 1
    accepted = client.post(f"/api/ai/instruction-proposals/{proposal['id']}/accept", json={})
    assert accepted.status_code == 200
    assert accepted.json()["settings"]["custom_instructions"] == "Prefer <literal> concise answers."
    assert client.delete(f"/api/ai/conversations/{conversation['id']}").status_code == 204
    assert client.get(base).status_code == 200
    assert len(client.get("/api/tasks").json()) == 1


@pytest.mark.parametrize(
    "path", ["/dashboard", "/tasks", "/stats", "/habits-view", "/revision", "/settings", "/settings/ai"]
)
def test_clean_assistant_initial_http_view_is_inert_and_offers_on_demand_panels(client, path):
    from html.parser import HTMLParser

    class Controls(HTMLParser):
        def __init__(self):
            super().__init__()
            self.nodes = {}

        def handle_starttag(self, _tag, attrs):
            data = dict(attrs)
            if "id" in data:
                self.nodes[data["id"]] = data

    response = client.get(path)
    assert response.status_code == 200
    controls = Controls()
    controls.feed(response.text)
    assert "inert" in controls.nodes["ai_drawer"]
    for panel in ["ai_history_panel", "ai_insights_panel", "ai_drafts_panel"]:
        assert "hidden" in controls.nodes[panel]["class"].split()
    assert controls.nodes["ai_composer_cancel"]["type"] == "button"
    assert controls.nodes["ai_drawer_resize_handle"]["role"] == "separator"
