"""Instruction approval stays independent from public task/session draft actions."""

from timetrace.services.ai_draft_service import AIDraftService
from timetrace.services.ai_instruction_service import AIInstructionService


def test_domain_draft_accept_undo_reapply_leave_instruction_proposal_pending(client, db):
    conversation = client.post("/api/ai/conversations", json={}).json()
    instruction = AIInstructionService(db).create_proposal(
        conversation_id=conversation["id"],
        source_message_id="instruction-source",
        instruction="Prefer concise responses.",
    )
    drafts = AIDraftService(db)
    batch = drafts.create_batch(
        conversation_id=conversation["id"],
        source_message_id="task-source",
        intent="create_task",
        request_text="Synthetic task proposal",
        provider=None,
        model=None,
    )
    drafts.add_item(
        batch_id=batch.id,
        op="create",
        entity_type="task",
        target_id=None,
        proposed_json={"title": "Synthetic task"},
    )

    def assert_instruction_still_pending():
        current = client.get(f"/api/ai/instruction-proposals/{instruction.id}")
        settings = client.get("/api/ai/settings")
        assert current.status_code == 200
        assert current.json()["status"] == "pending"
        assert settings.status_code == 200
        assert settings.json()["custom_instructions"] == ""

    assert_instruction_still_pending()
    batch_route = f"/api/ai/drafts/batches/{batch.id}"
    for action in ("accept", "undo", "reapply"):
        response = client.post(f"{batch_route}/{action}", json={})
        assert response.status_code == 200
        assert_instruction_still_pending()
