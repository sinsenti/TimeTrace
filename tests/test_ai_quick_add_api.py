"""Read-only Quick Add against the real daemon API; only model inference is faked."""

import logging
from types import SimpleNamespace

import pytest
from sqlmodel import select

from timetrace.db.models import AIDraftBatch, AIDraftItem, AIProviderConfig, AISettings, Task
from timetrace.db.models import Session as SessionModel
from timetrace.services.ai_chat_service import AIChatService


def domain_counts(db):
    return tuple(len(db.exec(select(model)).all()) for model in (Task, SessionModel, AIDraftBatch, AIDraftItem))


@pytest.fixture
def fake_model(db, monkeypatch):
    calls = []
    model = SimpleNamespace(content='{"title":"Synthetic extracted","tags":"work","estimated_duration_minutes":30}')

    async def invoke(prompt):
        calls.append(prompt)
        if isinstance(model.content, Exception):
            raise model.content
        return SimpleNamespace(content=model.content)

    monkeypatch.setattr(AIChatService, "_build_model", lambda self, config: SimpleNamespace(ainvoke=invoke))
    db.add(AIProviderConfig(name="Synthetic fake", provider="openai", model="fake-only", is_active=True))
    db.commit()
    return calls, model


@pytest.mark.parametrize("text,tier", [("Fix login #work !high", 1), ("Synthetic tomorrow at 3pm", 2)])
def test_classify_uses_zero_inference_and_creates_nothing(client, db, fake_model, text, tier):
    before = domain_counts(db)
    response = client.post("/api/ai/quick-add/classify", json={"text": text})
    assert response.status_code == 200
    assert response.json()["tier"] == tier
    assert fake_model[0] == []
    assert domain_counts(db) == before


def test_tier_one_parse_is_read_only_and_leaves_explicit_save_to_human(client, db, fake_model):
    before = domain_counts(db)
    parsed = client.post("/api/ai/quick-add/parse", json={"text": "Fix login #work !high"})
    assert parsed.status_code == 200
    assert parsed.json()["fields"] == {}
    assert fake_model[0] == []
    assert domain_counts(db) == before
    saved = client.post("/api/tasks", json={"title": "Human revision #work !high [30m]"})
    assert saved.status_code == 201
    task = client.get(f"/api/tasks/{saved.json()['id']}").json()
    assert (task["title"], task["tags"], task["priority"], task["estimated_minutes"]) == (
        "Human revision",
        "#work",
        "high",
        30,
    )
    assert domain_counts(db) == (before[0] + 1, *before[1:])


@pytest.mark.parametrize("fallback,status", [(True, 200), (False, 502)])
def test_unconfigured_tier_two_fallback_or_error_never_writes(client, db, monkeypatch, fallback, status):
    monkeypatch.setattr(AIChatService, "_build_model", lambda *args: pytest.fail("Unexpected inference"))
    db.add(AISettings(quickadd_fallback_enabled=fallback))
    db.commit()
    before = domain_counts(db)
    response = client.post("/api/ai/quick-add/parse", json={"text": "Synthetic tomorrow"})
    assert response.status_code == status
    if fallback:
        assert response.json()["tier"] == 1
        assert response.json()["fields"] == {}
    assert domain_counts(db) == before


def test_tier_two_sanitizes_fake_model_input_and_only_prefills(client, db, fake_model, caplog):
    calls, _ = fake_model
    before = domain_counts(db)
    text = "Synthetic tomorrow call jane@example.test at 555-123-4567 on 2026-09-04"
    with caplog.at_level(logging.INFO):
        response = client.post("/api/ai/quick-add/parse", json={"text": text})
    assert response.status_code == 200
    assert response.json()["fields"] == {
        "title": "Synthetic extracted",
        "tags": "work",
        "estimated_duration_minutes": 30,
    }
    assert len(calls) == 1
    assert "jane@example.test" not in calls[0]
    assert "555-123-4567" not in calls[0]
    assert "2026-09-04" in calls[0]
    assert text not in caplog.text
    assert domain_counts(db) == before
    saved = client.post("/api/tasks", json={"title": "Human edited extraction", "tags": "#work"})
    assert saved.status_code == 201
    assert client.get(f"/api/tasks/{saved.json()['id']}").json()["title"] == "Human edited extraction"
    assert domain_counts(db) == (before[0] + 1, *before[1:])


@pytest.mark.parametrize(
    "content", ["not JSON", '```json\n{"title": "Synthetic fenced"}\n```', RuntimeError("secret-provider-detail")]
)
def test_fake_model_extraction_and_sanitized_errors_are_read_only(client, db, fake_model, caplog, content):
    calls, model = fake_model
    model.content = content
    before = domain_counts(db)
    response = client.post("/api/ai/quick-add/parse", json={"text": "Synthetic tomorrow"})
    assert len(calls) == 1
    if isinstance(content, Exception):
        assert response.status_code == 502
        assert response.json()["detail"] == "Quick-add parse failed."
        assert "secret-provider-detail" not in response.text + caplog.text
    else:
        assert response.status_code == 200
        assert response.json()["fields"] == ({} if content == "not JSON" else {"title": "Synthetic fenced"})
    assert domain_counts(db) == before
