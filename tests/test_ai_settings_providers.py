"""Ticket20 public HTTP regressions: private SQLite, fake SDK only, no lifespan.

B7 forbids secret responses even though the unchanged provider-construction tests
currently characterize raw probe errors and credential-bearing SDK extra options.
These assertions intentionally expose that conflict; they do not change the API.
"""

from types import SimpleNamespace

import pytest
from sqlmodel import Session, SQLModel, create_engine


@pytest.fixture(name="db")
def private_provider_db(tmp_path):
    """The existing real-app client fixture uses this per-test file DB override."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'providers.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def create_provider(client, **options):
    response = client.post(
        "/api/ai/providers",
        json={"name": "Synthetic provider", "provider": "openai", "model": "synthetic-model", **options},
    )
    assert response.status_code == 201
    return response


@pytest.mark.parametrize("saved", [False, True], ids=["inline", "saved"])
@pytest.mark.parametrize("stage", ["initialization", "invocation"])
def test_probe_http_failure_excludes_fake_secret_and_private_response(client, monkeypatch, caplog, saved, stage):
    secret = "NONFUNCTIONAL-ticket20-probe-secret-9021"
    private_response = "SYNTHETIC-PRIVATE-PROVIDER-RESPONSE"
    constructed, invoked = [], []

    def fail():
        raise RuntimeError(f"{private_response}: {secret}")

    def fake_invoke(prompt):
        invoked.append(prompt)
        fail()

    def fake_init(**options):
        constructed.append(options)
        if stage == "initialization":
            fail()
        return SimpleNamespace(invoke=fake_invoke)

    # SDK construction is replaced BEFORE any entry into the actual HTTP probe.
    monkeypatch.setattr("langchain.chat_models.init_chat_model", fake_init)
    if saved:
        config_id = create_provider(client, api_key=secret).json()["id"]
        request = {"config_id": config_id}
    else:
        request = {"inline_config": {"provider": "openai", "model": "synthetic-model", "api_key": secret}}
    response = client.post("/api/ai/providers/test", json=request)

    assert response.status_code == 200
    result = response.json()
    assert set(result) == {"success", "error"}
    assert result["success"] is False
    assert isinstance(result["error"], str) and result["error"]
    assert len(constructed) == 1
    assert constructed[0]["api_key"] == secret
    assert constructed[0]["max_tokens"] == 16
    assert constructed[0]["timeout"] == 30
    assert invoked == ([] if stage == "initialization" else ["Reply with a single word: pong"])
    assert secret not in caplog.text
    assert private_response not in caplog.text
    assert secret not in response.text, "B7: HTTP probe must not expose the fake credential in an SDK exception"
    assert private_response not in response.text, "B7: HTTP probe must not expose private SDK exception text"


@pytest.mark.parametrize("boundary", ["create", "update", "list", "activate"])
def test_provider_http_response_excludes_known_extra_params_api_key(client, boundary, caplog):
    secret = "NONFUNCTIONAL-ticket20-extra-api-key-4732"
    if boundary == "create":
        response = create_provider(client, extra_params={"api_key": secret, "top_p": 0.7})
        assert response.status_code == 201
    else:
        created = create_provider(client, extra_params={"api_key": secret, "top_p": 0.7}).json()
        if boundary == "activate":
            response = client.post(f"/api/ai/providers/{created['id']}/activate")
            assert response.json()["is_active"] is True
        elif boundary == "update":
            response = client.put(f"/api/ai/providers/{created['id']}", json={"name": "Renamed synthetic"})
        else:
            response = client.get("/api/ai/providers")
        assert response.status_code == 200
    data = response.json()
    provider = data[0] if boundary == "list" else data
    assert provider["extra_params"]["top_p"] == 0.7
    assert secret not in caplog.text
    # Deliberately only the KNOWN SDK credential path; no arbitrary extra/URL policy.
    assert secret not in response.text, "B7: provider DTO must not echo extra_params.api_key"


def test_saved_probe_keeps_extra_api_key_forwarding_and_explicit_option_precedence(client, monkeypatch):
    constructed, invoked = [], []

    def fake_init(**options):
        constructed.append(options)
        return SimpleNamespace(invoke=invoked.append)

    monkeypatch.setattr("langchain.chat_models.init_chat_model", fake_init)
    extra_key = "NONFUNCTIONAL-ticket20-extra-fallback-7481"
    primary_key = "NONFUNCTIONAL-ticket20-explicit-primary-2609"
    created = create_provider(
        client,
        extra_params={"api_key": extra_key, "top_p": 0.7, "max_tokens": 999, "timeout": 999},
    ).json()
    for patch, expected_key in [(None, extra_key), ({"api_key": primary_key}, primary_key)]:
        if patch is not None:
            assert client.put(f"/api/ai/providers/{created['id']}", json=patch).status_code == 200
        response = client.post("/api/ai/providers/test", json={"config_id": created["id"]})
        assert response.status_code == 200
        assert response.json() == {"success": True, "error": None}
        assert constructed[-1] == {
            "model": "synthetic-model",
            "model_provider": "openai",
            "api_key": expected_key,
            "temperature": 0.0,
            "max_tokens": 16,
            "timeout": 30,
            "top_p": 0.7,
        }
    assert invoked == ["Reply with a single word: pong"] * 2


def test_provider_primary_key_mask_keep_null_replace_and_clear_http_control(client, monkeypatch):
    constructed = []

    def fake_init(**options):
        constructed.append(options)
        return SimpleNamespace(invoke=lambda prompt: None)

    monkeypatch.setattr("langchain.chat_models.init_chat_model", fake_init)
    first = "NONFUNCTIONAL-ticket20-primary-first-1938"
    second = "NONFUNCTIONAL-ticket20-primary-second-8426"
    created = create_provider(client, api_key=first).json()
    path = f"/api/ai/providers/{created['id']}"
    for patch, expected in [
        ({}, first),
        ({"api_key": None}, first),
        ({"api_key": second}, second),
        ({"api_key": ""}, None),
    ]:
        response = client.put(path, json=patch)
        assert response.status_code == 200
        dto = response.json()
        assert dto["api_key_set"] is bool(expected)
        assert dto["api_key_last4"] == (expected[-4:] if expected else None)
        assert "api_key" not in dto and "api_key_encrypted" not in dto
        assert first not in response.text and second not in response.text
        probe = client.post("/api/ai/providers/test", json={"config_id": created["id"]})
        assert probe.json() == {"success": True, "error": None}
        assert constructed[-1].get("api_key") == expected
    listed = client.get("/api/ai/providers")
    assert listed.status_code == 200
    assert listed.json()[0]["api_key_set"] is False


def test_behavior_scope_defaults_and_scheduling_validation_http_control(client):
    response = client.get("/api/ai/settings")
    assert response.status_code == 200
    assert response.json()["data_scope"] == {
        "tasks": True,
        "sessions": True,
        "habits": False,
        "reviews": False,
        "ratings": False,
        "timer": False,
    }
    invalid = client.put("/api/ai/settings", json={"scheduling_day_start": "17:00", "scheduling_day_end": "09:00"})
    assert invalid.status_code == 400
    assert client.get("/api/ai/settings").json()["scheduling_day_start"] == response.json()["scheduling_day_start"]


def test_activation_changes_only_selected_config_and_preserves_keys_without_sdk(client, monkeypatch):
    def forbidden_sdk(**options):
        pytest.fail("Activation must not construct a model")

    monkeypatch.setattr("langchain.chat_models.init_chat_model", forbidden_sdk)
    first = create_provider(client, api_key="NONFUNCTIONAL-first-activation-1234").json()
    second = create_provider(client, api_key="NONFUNCTIONAL-second-activation-5678").json()
    for selected in [first, second]:
        response = client.post(f"/api/ai/providers/{selected['id']}/activate")
        assert response.status_code == 200
        rows = client.get("/api/ai/providers").json()
        assert [row["id"] for row in rows if row["is_active"]] == [selected["id"]]
        assert all(row["api_key_set"] for row in rows)


@pytest.mark.parametrize("stage", ["decrypt", "json"])
def test_saved_probe_extraction_failure_is_safe_and_never_enters_sdk(client, db, monkeypatch, caplog, stage):
    from timetrace.db.models import AIProviderConfig

    sentinel = "NONFUNCTIONAL-private-extraction-sentinel"
    created = create_provider(client, api_key="NONFUNCTIONAL-private-extraction-key").json()

    def forbidden_sdk(**options):
        pytest.fail("Invalid saved extraction must not enter SDK")

    monkeypatch.setattr("langchain.chat_models.init_chat_model", forbidden_sdk)
    if stage == "decrypt":

        def failed_decrypt(value):
            raise RuntimeError(sentinel)

        monkeypatch.setattr("timetrace.services.ai_provider_service.decrypt_secret", failed_decrypt)
    else:
        config = db.get(AIProviderConfig, created["id"])
        config.extra_params_json = sentinel
        db.add(config)
        db.commit()
    response = client.post("/api/ai/providers/test", json={"config_id": created["id"]})
    assert response.status_code == 200
    assert response.json() == {
        "success": False,
        "error": "Connection failed. Check the provider, model, credentials and URL, then retry.",
    }
    assert sentinel not in response.text and sentinel not in caplog.text
