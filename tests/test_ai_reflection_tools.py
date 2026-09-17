import pytest
from sqlmodel import select

from timetrace.core.ai.redaction import sanitize_payload
from timetrace.core.exceptions import ValidationError
from timetrace.db.models import AIDraftBatch, DayReview, Habit, HabitLog, RatingDefinition, RatingEntry
from timetrace.services.ai_draft_service import AIDraftService
from timetrace.services.ai_provider_service import AISettingsService
from timetrace.services.ai_tool_gateway import DbAIToolGateway


def _gateway(db, monkeypatch, scope=None):
    import timetrace.services.ai_tool_gateway as gateway_module

    monkeypatch.setattr(gateway_module, "engine", db.get_bind())
    batch = AIDraftBatch()
    db.add(batch)
    db.commit()
    return DbAIToolGateway(batch.id, data_scope=scope), batch


def test_data_scope_defaults_are_safe_for_malformed_stored_values(db):
    settings = AISettingsService(db).get_settings()
    settings.data_scope_json = '{"habits": "false", "ratings": true}'
    db.add(settings)
    db.commit()
    scope = AISettingsService(db).get_data_scope()
    assert scope["habits"] is False
    assert scope["ratings"] is True
    assert scope["tasks"] is True


def test_sensitive_gateway_tools_default_to_disabled(db, monkeypatch):
    gateway, _ = _gateway(db, monkeypatch)
    with pytest.raises(ValidationError, match="habits.*disabled"):
        gateway.list_habits(start_date="2026-09-01", end_date="2026-09-02")


def test_habits_are_bounded_and_missing_is_not_failed(db, monkeypatch):
    habit = Habit(name="Read private notes", habit_type="boolean", frequency="Every day")
    db.add(habit)
    db.add(HabitLog(habit_id=habit.id, date_str="2026-09-01", status="completed", value=1))
    db.add(HabitLog(habit_id=habit.id, date_str="2026-09-02", status="skipped", value=0))
    db.commit()

    gateway, _ = _gateway(db, monkeypatch, {"habits": True})
    result = gateway.list_habits(start_date="2026-09-01", end_date="2026-09-03")
    assert result["truncated"] is False
    assert [log["status"] for log in result["habits"][0]["logs"]] == ["completed", "skipped"]

    progress = gateway.get_habit_progress(habit_id=habit.id, start_date="2026-09-01", end_date="2026-09-03")
    assert progress["counts"]["completed"] == 1
    assert progress["counts"]["skipped"] == 1
    assert progress["counts"]["no_log"] == 1
    assert progress["counts"]["failed"] == 0
    assert "2026-09-03" in progress["missing_log_days"]


def test_day_review_proposal_is_draft_until_acceptance(db, monkeypatch):
    gateway, batch = _gateway(db, monkeypatch, {"reviews": True, "tasks": True, "sessions": True, "ratings": True})
    item = gateway.propose_day_review(
        date_str="2026-09-03",
        rating=4,
        highlights="Finished the report",
        friction="Too many interruptions",
    )
    assert item["entity_type"] == "day_review"
    assert item["target_id"] == "2026-09-03"
    assert db.exec(select(DayReview)).all() == []

    result = AIDraftService(db).accept_items(batch.id)
    assert result["items"][0]["status"] == "applied"
    review = db.exec(select(DayReview).where(DayReview.date_str == "2026-09-03")).one()
    assert review.rating == 4
    assert not AIDraftService(db).is_stale(AIDraftService(db).list_items(batch.id)[0])


def test_day_review_create_detects_natural_key_race(db, monkeypatch):
    gateway, batch = _gateway(db, monkeypatch, {"reviews": True})
    gateway.propose_day_review(date_str="2026-09-04", rating=4)
    db.add(DayReview(date_str="2026-09-04", rating=1))
    db.commit()
    service = AIDraftService(db)
    stored = db.get(AIDraftBatch, batch.id)
    assert stored is not None
    draft_item = service.list_items(batch.id)[0]
    assert service.is_stale(draft_item)
    assert service.accept_items(batch.id)["items"][0]["status"] == "failed"
    assert db.exec(select(DayReview).where(DayReview.date_str == "2026-09-04")).one().rating == 1


def test_day_review_update_undo_and_reapply_use_date_natural_key(db, monkeypatch):
    existing = DayReview(date_str="2026-09-03", rating=2, highlights="old")
    db.add(existing)
    db.commit()
    gateway, batch = _gateway(db, monkeypatch, {"reviews": True})
    gateway.propose_day_review(date_str="2026-09-03", rating=5, highlights="new")
    service = AIDraftService(db)
    assert service.accept_items(batch.id)["items"][0]["status"] == "applied"
    assert service.undo_batch(batch.id)["items"][0]["status"] == "undone"
    assert db.exec(select(DayReview).where(DayReview.date_str == "2026-09-03")).one().rating == 2
    assert service.reapply_batch(batch.id)["items"][0]["status"] == "applied"
    assert db.exec(select(DayReview).where(DayReview.date_str == "2026-09-03")).one().rating == 5


def test_scope_rejects_sensitive_tools_and_stats_are_source_specific(db, monkeypatch):
    gateway, _ = _gateway(db, monkeypatch, {"tasks": True, "sessions": True, "habits": False})
    with pytest.raises(ValidationError, match="habits.*disabled"):
        gateway.list_habits(start_date="2026-09-01", end_date="2026-09-02")
    unrestricted, _ = _gateway(db, monkeypatch, {"habits": True})
    with pytest.raises(ValidationError, match="measure"):
        unrestricted.get_time_stats({"source": "habit_logs", "measure": "sum_duration"})

    unrestricted, _ = _gateway(db, monkeypatch, {"habits": True})
    with pytest.raises(ValidationError, match="dimension"):
        unrestricted.get_time_stats({"source": "habit_logs", "measure": "habit_completion_rate", "group_by": ["tag"]})


def test_source_specific_habit_stats_execute_through_query_service(db, monkeypatch):
    habit = Habit(name="Meditate", habit_type="boolean", frequency="Every day")
    db.add(habit)
    db.add(HabitLog(habit_id=habit.id, date_str="2026-09-01", status="completed", value=1))
    db.commit()
    gateway, _ = _gateway(db, monkeypatch, {"habits": True})
    result = gateway.get_time_stats(
        {
            "source": "habit_logs",
            "measure": "habit_completion_rate",
            "date_range": {"preset": "custom", "start_date": "2026-09-01", "end_date": "2026-09-01"},
        }
    )
    assert result["rows"][0]["value"] == 100
    assert result["meta"]["truncated"] is False


def test_day_review_and_rating_stats_execute_through_query_service(db, monkeypatch):
    definition = RatingDefinition(name="Mood", target_type="day", min_score=1, max_score=5)
    db.add(definition)
    db.add(DayReview(date_str="2026-09-01", rating=4))
    db.add(RatingEntry(rating_definition_id=definition.id, target_type="day", target_id="2026-09-01", score=5))
    db.commit()
    gateway, _ = _gateway(db, monkeypatch, {"reviews": True, "ratings": True})
    date_range = {"preset": "custom", "start_date": "2026-09-01", "end_date": "2026-09-01"}
    review_result = gateway.get_time_stats({"source": "day_reviews", "measure": "avg_rating", "date_range": date_range})
    rating_result = gateway.get_time_stats({"source": "rating_entries", "measure": "avg_rating"})
    assert review_result["rows"][0]["value"] == 4
    assert rating_result["rows"][0]["value"] == 5


def test_reflection_context_is_bounded_and_marks_missing_data(db, monkeypatch):
    gateway, _ = _gateway(
        db,
        monkeypatch,
        {"tasks": True, "sessions": True, "habits": True, "reviews": True, "ratings": True, "timer": False},
    )
    result = gateway.get_reflection_context(start_date="2026-09-01", end_date="2026-09-03")
    assert result["range"]["start_date"] == "2026-09-01"
    assert result["time"]["logged_total"]["total"] is None
    assert result["day_reviews"]["missing_dates"] == ["2026-09-01", "2026-09-02", "2026-09-03"]
    assert result["warnings"]
    assert result["timer"] is None


def test_recursive_redaction_covers_nested_sensitive_content():
    payload = {"habit": {"name": "email jane@example.com"}, "reviews": [{"notes": "call 555-123-4567"}]}
    result = sanitize_payload(payload)
    assert "jane@example.com" not in result["habit"]["name"]
    assert "555-123-4567" not in result["reviews"][0]["notes"]
