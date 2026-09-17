from sqlmodel import select

from timetrace.core.ai.remember_intent import is_remember_intent
from timetrace.core.exceptions import ConflictError
from timetrace.db.models import AIInstructionProposal, AISettings
from timetrace.services.ai_instruction_service import AIInstructionService
from timetrace.services.ai_provider_service import AISettingsService


def test_remember_intent_accepts_future_cues_and_rejects_one_off_facts():
    assert is_remember_intent("Remember this for future conversations: prioritize high-priority tasks.")
    assert is_remember_intent("From now on, leave time between sessions.")
    assert is_remember_intent("Please make this my default.")
    assert not is_remember_intent("I remember that I have a meeting.")
    assert not is_remember_intent("Remember my dentist appointment.")
    assert not is_remember_intent("I prefer mornings.")
    assert not is_remember_intent('Create a task with description: "from now on, use mornings."')


def test_proposal_appends_without_mutating_settings_and_deduplicates(db):
    settings = AISettingsService(db).update_settings(custom_instructions="Prefer concise answers.")
    service = AIInstructionService(db)

    proposal = service.create_proposal(
        conversation_id=None,
        source_message_id="message-1",
        instruction="Leave 15 minutes between sessions.",
    )

    assert db.get(AISettings, settings.id).custom_instructions == "Prefer concise answers."
    assert proposal.before_instructions == "Prefer concise answers."
    assert proposal.after_instructions == "Prefer concise answers.\n\nLeave 15 minutes between sessions."

    duplicate = service.append_instruction(proposal.after_instructions, " leave 15 MINUTES between sessions. ")
    assert duplicate == proposal.after_instructions


def test_instruction_validation_and_bullet_equivalent_deduplication(db):
    service = AIInstructionService(db)

    for invalid in ("", "   ", "x" * 4001):
        try:
            service.create_proposal(
                conversation_id=None,
                source_message_id=f"invalid-{len(invalid)}",
                instruction=invalid,
            )
        except Exception as exc:
            assert "instruction" in str(exc).lower()
        else:
            raise AssertionError("expected invalid instruction to be rejected")

    existing = "- Prefer mornings"
    assert service.append_instruction(existing, "1. PREFER   mornings") == existing
    assert service.append_instruction(existing, "• prefer mornings") == existing


def test_proposal_does_not_create_or_update_settings_row(db):
    service = AIInstructionService(db)
    proposal = service.create_proposal(
        conversation_id=None,
        source_message_id="message-no-settings",
        instruction="Use mornings.",
    )

    assert proposal.before_instructions == ""
    assert db.exec(select(AISettings)).first() is None


def test_accept_creates_missing_settings_and_allows_edited_text(db):
    service = AIInstructionService(db)
    proposal = service.create_proposal(
        conversation_id=None,
        source_message_id="edited-instruction",
        instruction="Use mornings.",
    )

    accepted, settings = service.accept(proposal.id, edited_instruction="Prefer concise mornings.")

    assert accepted.status == "accepted"
    assert accepted.proposed_instruction == "Prefer concise mornings."
    assert settings.custom_instructions == "Prefer concise mornings."
    assert db.exec(select(AISettings)).one().custom_instructions == "Prefer concise mornings."


def test_accept_and_reject_have_confirmation_gated_lifecycle(db):
    service = AIInstructionService(db)
    proposal = service.create_proposal(
        conversation_id=None,
        source_message_id="message-2",
        instruction="Schedule deep work in the morning.",
    )

    rejected = service.reject(proposal.id)
    assert rejected.status == "rejected"
    assert AISettingsService(db).get_settings().custom_instructions == ""

    accepted = service.create_proposal(
        conversation_id=None,
        source_message_id="message-3",
        instruction="Keep meetings grouped together.",
    )
    accepted, settings = service.accept(accepted.id)
    assert accepted.status == "accepted"
    assert "Keep meetings grouped together." in settings.custom_instructions


def test_manual_edit_causes_accept_conflict_and_leaves_setting_untouched(db):
    service = AIInstructionService(db)
    proposal = service.create_proposal(
        conversation_id=None,
        source_message_id="message-4",
        instruction="Prefer mornings.",
    )
    AISettingsService(db).update_settings(custom_instructions="A manual preference.")

    try:
        service.accept(proposal.id)
    except ConflictError:
        pass
    else:
        raise AssertionError("expected stale proposal conflict")

    assert AISettingsService(db).get_settings().custom_instructions == "A manual preference."
    assert db.get(AIInstructionProposal, proposal.id).status == "conflict"


def test_undo_never_overwrites_a_later_manual_edit(db):
    service = AIInstructionService(db)
    proposal = service.create_proposal(
        conversation_id=None,
        source_message_id="message-5",
        instruction="Use short agenda titles.",
    )
    service.accept(proposal.id)
    AISettingsService(db).update_settings(custom_instructions="A later manual edit.")

    try:
        service.undo(proposal.id)
    except ConflictError:
        pass
    else:
        raise AssertionError("expected undo conflict")

    assert AISettingsService(db).get_settings().custom_instructions == "A later manual edit."
    assert db.get(AIInstructionProposal, proposal.id).status == "conflict"


def test_proposal_source_is_unique_per_turn(db):
    service = AIInstructionService(db)
    service.create_proposal(conversation_id=None, source_message_id="same", instruction="One.")
    try:
        service.create_proposal(conversation_id=None, source_message_id="same", instruction="Two.")
    except Exception as exc:
        assert "one" in str(exc).lower()
    else:
        raise AssertionError("expected one-proposal-per-turn validation")

    assert len(db.exec(select(AIInstructionProposal)).all()) == 1
