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


def test_instruction_actions_allow_empty_bodies_and_proposal_survives_conversation_delete(client, db):
    conversation = client.post("/api/ai/conversations", json={}).json()
    proposal = AIInstructionService(db).create_proposal(
        conversation_id=conversation["id"],
        source_message_id="api-no-body-accept",
        instruction="Use mornings.",
    )

    accepted = client.post(f"/api/ai/instruction-proposals/{proposal.id}/accept")
    assert accepted.status_code == 200
    assert accepted.json()["proposal"]["status"] == "accepted"

    rejected_proposal = AIInstructionService(db).create_proposal(
        conversation_id=conversation["id"],
        source_message_id="api-no-body-reject",
        instruction="Keep meetings grouped.",
    )
    rejected = client.post(f"/api/ai/instruction-proposals/{rejected_proposal.id}/reject")
    assert rejected.status_code == 200
    assert rejected.json()["proposal"]["status"] == "rejected"

    deleted = client.delete(f"/api/ai/conversations/{conversation['id']}")
    assert deleted.status_code == 204
    fetched = client.get(f"/api/ai/instruction-proposals/{proposal.id}")
    assert fetched.status_code == 200
    assert fetched.json()["status"] == "accepted"
    assert fetched.json()["conversation_id"] is None


def test_conversation_detail_reloads_all_instruction_proposal_statuses(client, db):
    conversation = client.post("/api/ai/conversations", json={}).json()
    service = AIInstructionService(db)
    pending = service.create_proposal(
        conversation_id=conversation["id"],
        source_message_id="api-status-pending",
        instruction="Prefer mornings.",
    )
    accepted = service.create_proposal(
        conversation_id=conversation["id"],
        source_message_id="api-status-accepted",
        instruction="Use concise answers.",
    )
    service.accept(accepted.id)
    rejected = service.create_proposal(
        conversation_id=conversation["id"],
        source_message_id="api-status-rejected",
        instruction="Group meetings.",
    )
    service.reject(rejected.id)
    conflict = service.create_proposal(
        conversation_id=conversation["id"],
        source_message_id="api-status-conflict",
        instruction="Use afternoons.",
    )
    from timetrace.services.ai_provider_service import AISettingsService

    AISettingsService(db).update_settings(custom_instructions="Manual edit.")
    conflict_response = client.post(f"/api/ai/instruction-proposals/{conflict.id}/accept", json={})
    assert conflict_response.status_code == 409
    failed = service.create_proposal(
        conversation_id=conversation["id"],
        source_message_id="api-status-failed",
        instruction="Use short agendas.",
    )
    service.mark_failed_for_source(failed.source_message_id)

    detail = client.get(f"/api/ai/conversations/{conversation['id']}")
    assert detail.status_code == 200
    proposals = {proposal["id"]: proposal["status"] for proposal in detail.json()["instruction_proposals"]}
    assert proposals == {
        pending.id: "pending",
        accepted.id: "accepted",
        rejected.id: "rejected",
        conflict.id: "conflict",
        failed.id: "failed",
    }


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
