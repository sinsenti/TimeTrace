from timetrace.services.ai_instruction_service import AIInstructionService


def test_instruction_proposal_api_lifecycle_and_conversation_reload(client, db):
    conversation = client.post("/api/ai/conversations", json={}).json()
    proposal = AIInstructionService(db).create_proposal(
        conversation_id=conversation["id"],
        source_message_id="api-source",
        instruction="Prefer short answers.",
    )

    detail = client.get(f"/api/ai/conversations/{conversation['id']}")
    assert detail.status_code == 200
    assert detail.json()["instruction_proposals"][0]["id"] == proposal.id

    fetched = client.get(f"/api/ai/instruction-proposals/{proposal.id}")
    assert fetched.status_code == 200
    assert fetched.json()["status"] == "pending"

    accepted = client.post(
        f"/api/ai/instruction-proposals/{proposal.id}/accept",
        json={"instruction": "Prefer concise answers."},
    )
    assert accepted.status_code == 200
    assert accepted.json()["proposal"]["status"] == "accepted"
    assert accepted.json()["settings"]["custom_instructions"] == "Prefer concise answers."


def test_instruction_proposal_accept_returns_conflict(client, db):
    conversation = client.post("/api/ai/conversations", json={}).json()
    proposal = AIInstructionService(db).create_proposal(
        conversation_id=conversation["id"],
        source_message_id="api-conflict",
        instruction="Use mornings.",
    )
    from timetrace.services.ai_provider_service import AISettingsService

    AISettingsService(db).update_settings(custom_instructions="Manual edit.")
    response = client.post(f"/api/ai/instruction-proposals/{proposal.id}/accept", json={})
    assert response.status_code == 409
    assert "changed" in response.json()["detail"]
