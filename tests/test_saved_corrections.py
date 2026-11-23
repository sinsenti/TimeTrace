"""Saved correction behavior through actual daemon root HTTP routes."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from test_timer_correction_intervals import exclusion
from test_timer_correction_preview import persisted_snapshot
from test_timer_correction_steps import clock as _base_clock

clock = _base_clock


@pytest.fixture(autouse=True)
def utc_review_context(monkeypatch):
    from timetrace.core import timezones

    monkeypatch.setenv("TZ", "UTC")
    timezones._reset_caches()
    yield
    timezones._reset_caches()


def test_manual_saved_split_preserves_original_identity(client, clock):
    clock.at = datetime(2026, 11, 23, 12, tzinfo=UTC)
    row = client.post(
        "/recorded-work",
        json={
            "start_time": "2026-11-23T11:00:00Z",
            "end_time": "2026-11-23T11:30:00Z",
            "notes": "keep",
            "tags": "context",
        },
    ).json()
    assert client.post("/timers/correction-initialize", json={"operation_id": "init"}).status_code == 200
    path = "/recorded-work/" + row["id"]
    request = exclusion({"kind": "saved", "work_id": row["id"], "expected_revision": row["revision"]})
    response = client.post(path + "/correction-preview", json=request)
    assert response.status_code == 200, response.text
    result = client.post(path + "/correction", json={"operation_id": "correct", "preview": response.json()})
    assert result.status_code == 200, result.text
    ids = result.json()["correction"]["changed_work_ids"] + result.json()["correction"]["created_work_ids"]
    assert ids[0] == row["id"]
    assert result.json()["correction"]["work_fragments"] == [{"source_work_id": row["id"], "work_ids": ids}]
    rows = [client.get("/recorded-work/" + identity).json() for identity in ids]
    assert [(r["start_time"][11:19], r["end_time"][11:19]) for r in rows] == [
        ("11:00:00", "11:10:00"),
        ("11:15:00", "11:30:00"),
    ]
    assert [r["notes"] for r in rows] == ["keep", "keep"]
    assert rows[1]["correction_lineage"]["rating_source_work_id"] == row["id"]


def manual(client, clock, task_id=None, plan=None):
    clock.at = datetime(2026, 11, 23, 12, tzinfo=UTC)
    payload = {
        "start_time": "2026-11-23T11:00:00Z",
        "end_time": "2026-11-23T11:30:00Z",
        "notes": "keep",
        "tags": "context",
        "task_id": task_id,
    }
    if plan:
        payload.update(scheduled_session_id=plan["id"], expected_plan_revision=plan["revision"])
    row = client.post("/recorded-work", json=payload).json()
    assert "id" in row, row
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    return row, "/recorded-work/" + row["id"]


def saved_target(row):
    return {"kind": "saved", "work_id": row["id"], "expected_revision": row["revision"]}


@pytest.mark.parametrize(
    "change,expected",
    [
        ({"kind": "step_start", "credited_delta_seconds": 300}, "10:55:00"),
        ({"kind": "step_start", "credited_delta_seconds": -300}, "11:05:00"),
        (
            {
                "kind": "set_start",
                "start_utc": "2026-11-23T10:50:00Z",
                "timezone": "UTC",
                "local_datetime": "2026-11-23T10:50:00",
                "offset_seconds": 0,
            },
            "10:50:00",
        ),
    ],
)
def test_manual_saved_start_variants_are_receipted(client, clock, change, expected):
    row, path = manual(client, clock)
    approved = client.post(path + "/correction-preview", json={"target": saved_target(row), "change": change})
    assert approved.status_code == 200, approved.text
    payload = {"operation_id": "correct", "preview": approved.json()}
    result = client.post(path + "/correction", json=payload)
    assert result.status_code == 200, result.text
    assert client.get(path).json()["start_time"][11:19] == expected
    assert client.get(path).json()["revision"] == row["revision"] + 1
    assert client.post(path + "/correction", json=payload).json() == result.json()
    payload["preview"]["warnings"] = []
    assert client.post(path + "/correction", json=payload).json()["code"] == "operation_payload_mismatch"


def test_saved_overlap_warning_is_signed_without_changing_union_policy(client, clock):
    task = client.post("/api/tasks", json={"title": "Overlap"}).json()
    row, path = manual(client, clock, task["id"])
    other = client.post(
        "/recorded-work",
        json={"task_id": task["id"], "start_time": "2026-11-23T10:55:00Z", "end_time": "2026-11-23T11:05:00Z"},
    ).json()
    assert "id" in other
    approved = client.post(
        path + "/correction-preview",
        json={"target": saved_target(row), "change": {"kind": "step_start", "credited_delta_seconds": 300}},
    )
    assert approved.status_code == 200, approved.text
    assert any("overlap" in text.lower() for text in approved.json()["plan"]["warnings"])


def test_strict_correction_rejects_nonfinite_json_as_validation_error(client, clock):
    row, path = manual(client, clock)
    request = {"target": saved_target(row), "change": {"kind": "step_start", "credited_delta_seconds": float("inf")}}
    response = client.post(
        path + "/correction-preview", content=json.dumps(request), headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422, response.text


def test_positive_subsecond_remainder_is_not_a_false_zero_interval(client, clock):
    clock.at = datetime(2026, 11, 23, 12, tzinfo=UTC)
    row = client.post(
        "/recorded-work", json={"start_time": "2026-11-23T11:00:00Z", "end_time": "2026-11-23T11:05:00.200000Z"}
    ).json()
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/recorded-work/" + row["id"]
    approved = client.post(
        path + "/correction-preview",
        json={"target": saved_target(row), "change": {"kind": "step_start", "credited_delta_seconds": -300}},
    )
    assert approved.status_code == 200, approved.text
    result = client.post(path + "/correction", json={"operation_id": "correct", "preview": approved.json()})
    assert result.status_code == 200, result.text
    saved = client.get(path).json()
    assert datetime.fromisoformat(saved["start_time"]) == datetime(2026, 11, 23, 11, 5, tzinfo=UTC)
    assert datetime.fromisoformat(saved["end_time"]) == datetime(2026, 11, 23, 11, 5, 0, 200000, tzinfo=UTC)


def test_subsecond_exclusion_is_exact_positive_work_not_uncommittable_zero(client, clock):
    row, path = manual(client, clock)
    approved = client.post(
        path + "/correction-preview",
        json=exclusion(saved_target(row), "2026-11-23T11:10:00.100000", "2026-11-23T11:10:00.300000"),
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["plan"]["removed_seconds"] == pytest.approx(0.2)
    result = client.post(path + "/correction", json={"operation_id": "correct", "preview": approved.json()})
    assert result.status_code == 200, result.text
    left = client.get(path).json()
    right = client.get("/recorded-work/" + result.json()["correction"]["created_work_ids"][0]).json()
    assert datetime.fromisoformat(left["end_time"]) == datetime(2026, 11, 23, 11, 10, 0, 100000, tzinfo=UTC)
    assert datetime.fromisoformat(right["start_time"]) == datetime(2026, 11, 23, 11, 10, 0, 300000, tzinfo=UTC)


@pytest.mark.parametrize(
    "left,right,expected",
    [
        ("2026-11-23T11:00:00", "2026-11-23T11:05:00", ("11:05:00", "11:30:00")),
        ("2026-11-23T11:25:00", "2026-11-23T11:30:00", ("11:00:00", "11:25:00")),
    ],
)
def test_saved_edge_trims_retain_one_original_row(client, clock, left, right, expected):
    row, path = manual(client, clock)
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row), left, right))
    assert approved.status_code == 200, approved.text
    result = client.post(path + "/correction", json={"operation_id": "trim", "preview": approved.json()})
    assert result.status_code == 200, result.text
    assert result.json()["correction"]["changed_work_ids"] == [row["id"]]
    assert result.json()["correction"]["created_work_ids"] == []
    saved = client.get(path).json()
    assert (saved["start_time"][11:19], saved["end_time"][11:19]) == expected


def test_corrected_fragments_feed_integrated_exact_export_cohort_without_double_count(client, db, tmp_path, clock):
    row, path = manual(client, clock)
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row))).json()
    result = client.post(path + "/correction", json={"operation_id": "correct", "preview": approved}).json()
    ids = result["correction"]["changed_work_ids"] + result["correction"]["created_work_ids"]
    before = persisted_snapshot(tmp_path, db)
    exported = client.post(
        "/api/agenda/history-export/preview",
        json={
            "start_date": "2026-11-23",
            "end_date": "2026-11-23",
            "timezone": "UTC",
            "mode": "selected",
            "selected_ids": ids,
        },
    )
    assert exported.status_code == 200, exported.text
    assert exported.json()["work_count"] == 2
    assert exported.json()["summed_recorded_work_seconds"] == 1500
    assert {row["id"] for row in exported.json()["rows"]} == set(ids)
    assert persisted_snapshot(tmp_path, db) == before


def test_saved_metadata_ratings_and_repeated_lineage_are_not_cloned(client, db, clock):
    from timetrace.db.models import Session as Work

    task = client.post("/api/tasks", json={"title": "Rated"}).json()
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2026-11-23T10:00:00Z", "end_time": "2026-11-23T12:00:00Z"},
    ).json()
    row, path = manual(client, clock, task["id"], plan)
    persisted = db.get(Work, row["id"])
    persisted.review_skipped = True
    persisted.timezone = "America/New_York"
    persisted.external_sync_id = "synthetic-external"
    persisted.external_provider = "synthetic"
    persisted.extended_properties_json = '{"fixture":true}'
    db.add(persisted)
    db.commit()
    definition = client.post("/rating-definitions", json={"name": "Quality", "target_type": "session"}).json()
    rating = client.post(
        "/rating-entries",
        json={"rating_definition_id": definition["id"], "target_type": "session", "target_id": row["id"], "score": 8},
    ).json()
    before_plan = client.get("/scheduled-sessions/" + plan["id"]).json()
    before = client.get(path).json()
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(before))).json()
    result = client.post(path + "/correction", json={"operation_id": "split", "preview": approved})
    assert result.status_code == 200, result.text
    created = result.json()["correction"]["created_work_ids"][0]
    right = client.get("/recorded-work/" + created).json()
    left = client.get(path).json()
    for field in (
        "task_id",
        "scheduled_session_id",
        "notes",
        "tags",
        "timezone",
        "review_skipped",
        "external_sync_id",
        "external_provider",
        "extended_properties_json",
        "provenance",
    ):
        assert left[field] == right[field] == before[field]
    assert client.get("/scheduled-sessions/" + plan["id"]).json() == before_plan
    ratings = client.get("/rating-entries", params={"target_type": "session", "target_id": row["id"]}).json()
    assert ratings[0]["id"] == rating["id"]
    assert client.get("/rating-entries", params={"target_type": "session", "target_id": created}).json() == []
    next_preview = client.post(
        "/recorded-work/" + created + "/correction-preview",
        json={"target": saved_target(right), "change": {"kind": "step_start", "credited_delta_seconds": -300}},
    )
    assert next_preview.status_code == 200, next_preview.text
    result = client.post(
        "/recorded-work/" + created + "/correction", json={"operation_id": "trim", "preview": next_preview.json()}
    )
    assert result.status_code == 200, result.text
    lineage = client.get("/recorded-work/" + created).json()["correction_lineage"]
    assert lineage["rating_source_work_id"] == row["id"]
    assert lineage["operation_ids"] == ["split", "trim"]


def test_timer_saved_and_buffered_exclusion_updates_summary_and_stop_once(client, clock):
    clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start", "notes": "older"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/timers/" + timer["id"]
    clock.at += timedelta(minutes=30)
    split = client.post(path + "/split", json={"operation_id": "save", "new_notes": "current"}).json()
    saved = client.get("/recorded-work/" + split["recorded_work_ids"][0]).json()
    clock.at += timedelta(minutes=30)
    current = client.post(path + "/pause", json={"operation_id": "pause"}).json()["timer"]
    target = {
        "kind": "selection",
        "targets": [saved_target(saved), {"kind": "buffered", "segment_id": current["manual_pause_note_segment_id"]}],
    }
    request = exclusion(target, "2026-11-23T11:25:00", "2026-11-23T11:35:00")
    approved = client.post(path + "/correction-preview", json=request)
    assert approved.status_code == 200, approved.text
    result = client.post(path + "/correction", json={"operation_id": "mixed", "preview": approved.json()})
    assert result.status_code == 200, result.text
    assert result.json()["timer"]["manual_pause_note_segment_id"] == current["manual_pause_note_segment_id"]
    edited = client.post(
        path + "/note",
        json={
            "operation_id": "note",
            "expected_revision": result.json()["timer"]["revision"],
            "expected_note_segment_id": current["manual_pause_note_segment_id"],
            "new_notes": "current edited",
        },
    )
    assert edited.status_code == 200, edited.text
    assert client.get("/recorded-work/" + saved["id"]).json()["end_time"][11:19] == "11:25:00"
    stopped = client.post(path + "/stop", json={"operation_id": "stop"}).json()
    assert len(stopped["recorded_work_ids"]) == 1
    latest = client.get("/recorded-work/" + stopped["recorded_work_ids"][0]).json()
    assert (latest["start_time"][11:19], latest["end_time"][11:19]) == ("11:35:00", "12:00:00")
    assert latest["notes"] == "current edited"
    assert client.post(path + "/stop", json={"operation_id": "stop"}).json() == stopped


def test_reversed_saved_selection_normalizes_before_manifest_and_commit(client, clock):
    clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/timers/" + timer["id"]
    clock.at += timedelta(minutes=10)
    first = client.post(path + "/split", json={"operation_id": "save-first"}).json()["recorded_work_ids"][0]
    clock.at += timedelta(minutes=10)
    second = client.post(path + "/split", json={"operation_id": "save-second"}).json()["recorded_work_ids"][0]
    clock.at += timedelta(minutes=10)
    target = {
        "kind": "selection",
        "targets": [saved_target(client.get("/recorded-work/" + identity).json()) for identity in (second, first)],
    }
    approved = client.post(
        path + "/correction-preview", json=exclusion(target, "2026-11-23T11:05:00", "2026-11-23T11:15:00")
    )
    assert approved.status_code == 200, approved.text
    result = client.post(path + "/correction", json={"operation_id": "correct", "preview": approved.json()})
    assert result.status_code == 200, result.text
    assert client.get("/recorded-work/" + first).json()["end_time"].startswith("2026-11-23T11:05:00")
    assert client.get("/recorded-work/" + second).json()["start_time"].startswith("2026-11-23T11:15:00")


def test_post_db_saved_note_survives_stale_file_summary_recovery_and_later_stop(client, clock, monkeypatch):
    import os

    from timetrace.services import multiple_timer_service as module

    clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start", "notes": "older"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    timer_path = "/timers/" + timer["id"]
    clock.at += timedelta(minutes=30)
    first = client.post(timer_path + "/split", json={"operation_id": "save", "new_notes": "current"}).json()
    row = client.get("/recorded-work/" + first["recorded_work_ids"][0]).json()
    path = "/recorded-work/" + row["id"]
    clock.at += timedelta(minutes=30)
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row))).json()
    payload = {"operation_id": "correct", "preview": approved}
    replace = module.os.replace
    calls = 0

    def fail_after_db(source, destination):
        nonlocal calls
        if str(destination) == os.environ["TIMETRACE_TIMER_STATE_FILE"]:
            calls += 1
            if calls == 2:
                raise OSError("synthetic file finalization failure")
        return replace(source, destination)

    monkeypatch.setattr(module.os, "replace", fail_after_db)
    failed = client.post(path + "/correction", json=payload)
    assert failed.status_code == 409, failed.text
    updated = client.patch(path + "/note", json={"expected_revision": row["revision"] + 1, "notes": "legal DB note"})
    assert updated.status_code == 200, updated.text
    monkeypatch.setattr(module.os, "replace", replace)
    result = client.post(path + "/correction", json=payload)
    assert result.status_code == 200, result.text
    assert client.get(path).json()["notes"] == "legal DB note"
    stopped = client.post(timer_path + "/stop", json={"operation_id": "stop"}).json()
    assert len(stopped["recorded_work_ids"]) == 1
    assert client.get(path).json()["notes"] == "legal DB note"
    assert client.get("/recorded-work/" + stopped["recorded_work_ids"][0]).json()["notes"] == "current"
    assert client.post(timer_path + "/stop", json={"operation_id": "stop"}).json() == stopped


def test_stopped_timer_saved_split_keeps_original_tuple_and_summary(client, clock):
    clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=30)
    stopped = client.post("/timers/" + timer["id"] + "/stop", json={"operation_id": "stop"}).json()
    row = client.get("/recorded-work/" + stopped["recorded_work_ids"][0]).json()
    path = "/recorded-work/" + row["id"]
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row)))
    assert approved.status_code == 200, approved.text
    result = client.post(path + "/correction", json={"operation_id": "correct", "preview": approved.json()})
    assert result.status_code == 200, result.text
    original = client.get(path).json()
    assert original["timer_segment_id"] == row["timer_segment_id"]
    current = client.get("/timers/" + timer["id"]).json()
    assert current["state"] == "stopped"
    assert len(current["segments"]) == 2
    assert current["segments"][0]["recorded_work_id"] == row["id"]


@pytest.mark.parametrize(
    "change",
    [
        {"kind": "step_start", "credited_delta_seconds": -300},
        {
            "kind": "set_start",
            "start_utc": "2026-11-23T11:05:00Z",
            "timezone": "UTC",
            "local_datetime": "2026-11-23T11:05:00",
            "offset_seconds": 0,
        },
    ],
)
def test_saved_timer_start_variants(client, clock, change):
    clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start", "notes": "timer snapshot"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=30)
    stopped = client.post("/timers/" + timer["id"] + "/stop", json={"operation_id": "stop"}).json()
    row = client.get("/recorded-work/" + stopped["recorded_work_ids"][0]).json()
    path = "/recorded-work/" + row["id"]
    approved = client.post(path + "/correction-preview", json={"target": saved_target(row), "change": change})
    assert approved.status_code == 200, approved.text
    assert (
        client.post(path + "/correction", json={"operation_id": "correct", "preview": approved.json()}).status_code
        == 200
    )
    current = client.get(path).json()
    assert current["start_time"].startswith("2026-11-23T11:05:00")
    assert current["notes"] == "timer snapshot"
    assert current["timer_segment_id"] == row["timer_segment_id"]


def test_pre_receipt_typed_timer_rows_keep_unknown_context_without_fake_owner(client, db, clock):
    from timetrace.db.models import Session as Work

    row, path = manual(client, clock)
    legacy_timer = db.get(Work, row["id"])
    legacy_timer.provenance = "timer"  # Valid head-0016 typed work, before nullable receipt tuple was added.
    db.add(legacy_timer)
    db.commit()
    original = client.get(path).json()
    earlier = client.post(
        path + "/correction-preview",
        json={"target": saved_target(original), "change": {"kind": "step_start", "credited_delta_seconds": 300}},
    )
    assert earlier.status_code == 400, earlier.text
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(original)))
    assert approved.status_code == 200, approved.text
    result = client.post(path + "/correction", json={"operation_id": "split", "preview": approved.json()})
    assert result.status_code == 200, result.text
    right = client.get("/recorded-work/" + result.json()["correction"]["created_work_ids"][0]).json()
    assert "timer_id" not in right
    assert right["timer_segment_id"]
    assert client.get(path).json().get("timer_segment_id") is None
    later = client.post(
        "/recorded-work/" + right["id"] + "/correction-preview",
        json={"target": saved_target(right), "change": {"kind": "step_start", "credited_delta_seconds": -300}},
    )
    assert later.status_code == 200, later.text


def test_cross_midnight_split_preserves_task_and_dated_reviews(client, clock):
    clock.at = datetime(2026, 11, 23, 12, tzinfo=UTC)
    task = client.post("/api/tasks", json={"title": "Reviewed"}).json()
    review = client.post(
        "/api/task-reviews", json={"task_id": task["id"], "what_went_well": "keep subjective review"}
    ).json()
    for date in ("2026-11-22", "2026-11-23"):
        client.post("/revision/day-review", json={"date_str": date, "notes": "Review " + date})
    before = {
        date: client.get("/revision/day-summary", params={"date_str": date}).json()["day_review"]
        for date in ("2026-11-22", "2026-11-23")
    }
    row = client.post(
        "/recorded-work",
        json={"task_id": task["id"], "start_time": "2026-11-22T23:50:00Z", "end_time": "2026-11-23T00:20:00Z"},
    ).json()
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    path = "/recorded-work/" + row["id"]
    approved = client.post(
        path + "/correction-preview", json=exclusion(saved_target(row), "2026-11-22T23:55:00", "2026-11-23T00:05:00")
    )
    assert approved.status_code == 200, approved.text
    result = client.post(path + "/correction", json={"operation_id": "correct", "preview": approved.json()})
    assert result.status_code == 200, result.text
    assert client.get("/api/task-reviews/" + task["id"]).json() == review
    for date in before:
        assert client.get("/revision/day-summary", params={"date_str": date}).json()["day_review"] == before[date]


def test_lineage_survives_existing_valid_plan_delete(client, db, clock):
    from timetrace.services.session_service import SessionService

    task = client.post("/api/tasks", json={"title": "Deletable plan"}).json()
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2026-11-23T10:00:00Z", "end_time": "2026-11-23T12:00:00Z"},
    ).json()
    row, path = manual(client, clock, task["id"], plan)
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row))).json()
    assert client.post(path + "/correction", json={"operation_id": "correct", "preview": approved}).status_code == 200
    removal = client.get("/scheduled-sessions/" + plan["id"] + "/removal-preview").json()
    assert len(removal["manifest"]["lineage"]) == 1
    result = client.post(
        "/scheduled-sessions/" + plan["id"] + "/removal",
        json={"operation_id": "remove", "action": "delete_everything", "consent_token": removal["consent_token"]},
    )
    assert result.status_code == 200, result.text
    assert client.get(path).status_code == 404
    assert SessionService(db).correction_lineage(row["id"])["rating_source_work_id"] == row["id"]


def test_fragment_approval_includes_original_linked_rating(client, clock):
    row, path = manual(client, clock)
    definition = client.post("/rating-definitions", json={"name": "Original score"}).json()
    rating = {"rating_definition_id": definition["id"], "target_type": "session", "target_id": row["id"], "score": 7}
    client.post("/rating-entries", json=rating)
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row))).json()
    result = client.post(path + "/correction", json={"operation_id": "split", "preview": approved}).json()
    right_id = result["correction"]["created_work_ids"][0]
    right = client.get("/recorded-work/" + right_id).json()
    target_path = "/recorded-work/" + right_id
    approved = client.post(
        target_path + "/correction-preview",
        json={"target": saved_target(right), "change": {"kind": "step_start", "credited_delta_seconds": -300}},
    ).json()
    rating["score"] = 9
    assert client.post("/rating-entries", json=rating).status_code == 201
    stale = client.post(target_path + "/correction", json={"operation_id": "stale", "preview": approved})
    assert stale.status_code == 409, stale.text
    assert stale.json()["code"] == "correction_preview_stale"


def test_saved_review_flags_are_preview_only_dependencies(client, clock):
    row, path = manual(client, clock)
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row))).json()
    review = client.post("/revision/day-review", json={"date_str": "2026-11-23", "review_skipped": True})
    assert review.status_code == 200, review.text
    stale = client.post(path + "/correction", json={"operation_id": "stale", "preview": approved})
    assert stale.status_code == 409, stale.text
    assert stale.json()["code"] == "correction_preview_stale"


@pytest.mark.parametrize("mutation", ["note", "rating"])
def test_saved_approval_stales_on_independent_dependencies(client, clock, mutation):
    row, path = manual(client, clock)
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row))).json()
    if mutation == "note":
        assert (
            client.patch(path + "/note", json={"expected_revision": row["revision"], "notes": "new"}).status_code == 200
        )
    else:
        definition = client.post("/rating-definitions", json={"name": "Q"}).json()
        client.post(
            "/rating-entries",
            json={
                "rating_definition_id": definition["id"],
                "target_type": "session",
                "target_id": row["id"],
                "score": 7,
            },
        )
    result = client.post(path + "/correction", json={"operation_id": "stale", "preview": approved})
    assert result.status_code == 409, result.text
    assert result.json()["code"] == "correction_preview_stale"


@pytest.mark.parametrize("failure", ["complete", "future_range", "future_work", "legacy", "ownership", "revision"])
def test_saved_refusals_leave_all_persisted_state_unchanged(client, db, tmp_path, clock, failure):
    from timetrace.db.models import Session as Work

    row, path = manual(client, clock)
    request = exclusion(saved_target(row))
    route = path + "/correction-preview"
    if failure == "complete":
        request = exclusion(saved_target(row), "2026-11-23T11:00:00", "2026-11-23T11:30:00")
    elif failure == "future_range":
        request = exclusion(saved_target(row), "2026-11-23T11:25:00", "2026-11-23T12:01:00")
    elif failure == "future_work":
        stored = db.get(Work, row["id"])
        stored.end_time = datetime(2027, 1, 1)
        db.add(stored)
        db.commit()
    elif failure == "legacy":
        legacy = client.post(
            "/sessions", json={"start_time": "2026-11-23T11:00:00Z", "end_time": "2026-11-23T11:30:00Z"}
        ).json()
        assert "id" in legacy, legacy
        route = "/recorded-work/" + legacy["id"] + "/correction-preview"
        request = exclusion({"kind": "saved", "work_id": legacy["id"], "expected_revision": 1})
    elif failure == "ownership":
        other = client.post("/timers", json={"operation_id": "other"}).json()["timer"]
        route = "/timers/" + other["id"] + "/correction-preview"
    else:
        request["target"]["expected_revision"] += 1
    before = persisted_snapshot(tmp_path, db)
    response = client.post(route, json=request)
    assert response.status_code in (400, 409), response.text
    assert persisted_snapshot(tmp_path, db) == before


def test_deleted_corrected_buffer_keeps_exact_receipt_backed_lineage(client, db, clock):
    from timetrace.services.session_service import SessionService

    clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
    task = client.post("/api/tasks", json={"title": "Buffered history"}).json()
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2026-11-23T11:00:00Z", "end_time": "2026-11-23T12:00:00Z"},
    ).json()
    timer = client.post(
        "/timers",
        json={
            "operation_id": "start",
            "task_id": task["id"],
            "scheduled_session_id": plan["id"],
            "expected_plan_revision": plan["revision"],
        },
    ).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=30)
    path = "/timers/" + timer["id"]
    approved = client.post(
        path + "/correction-preview", json=exclusion({"kind": "running", "segment_id": timer["running_segment_id"]})
    ).json()
    assert client.post(path + "/correction", json={"operation_id": "exclude", "preview": approved}).status_code == 200
    ids = client.post(path + "/stop", json={"operation_id": "stop"}).json()["recorded_work_ids"]
    removal = client.get("/scheduled-sessions/" + plan["id"] + "/removal-preview").json()
    result = client.post(
        "/scheduled-sessions/" + plan["id"] + "/removal",
        json={"operation_id": "remove", "action": "delete_everything", "consent_token": removal["consent_token"]},
    )
    assert result.status_code == 200, result.text
    for identity in ids:
        lineage = SessionService(db).correction_lineage(identity)
        assert lineage is not None
        assert lineage["operation_ids"] == ["exclude"]
        assert lineage["rating_source_work_id"] == identity


def test_missing_replay_critical_context_refuses_before_intent(client, db, tmp_path, clock):
    from timetrace.db.models import Session as Work

    row, path = manual(client, clock)
    stored = db.get(Work, row["id"])
    stored.task_id = "missing-context"
    db.add(stored)
    db.commit()
    before = persisted_snapshot(tmp_path, db)
    response = client.post(path + "/correction-preview", json=exclusion(saved_target(row)))
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "correction_context_invalid"
    assert persisted_snapshot(tmp_path, db) == before


@pytest.mark.parametrize("linked", [False, True])
def test_pending_guards_only_series_plans_actually_written(client, db, clock, monkeypatch, linked):
    from timetrace.core.timer_store import TimerStore
    from timetrace.db.models import RecurrenceException, Task

    task = client.post("/api/tasks", json={"title": "Scoped recurrence"}).json()
    plan = client.post(
        "/scheduled-sessions",
        json={"task_id": task["id"], "start_time": "2026-11-23T10:00:00Z", "end_time": "2026-11-23T12:00:00Z"},
    ).json()
    if linked:
        stored = db.get(Task, task["id"])
        stored.is_recurring = True
        stored.recurrence_rrule = "FREQ=DAILY"
        stored.recurrence_dtstart = datetime(2026, 11, 23, 10)
        stored.recurrence_duration_minutes = 120
        stored.recurrence_timezone = "UTC"
        db.add(stored)
        db.add(
            RecurrenceException(
                task_id=task["id"],
                occurrence_start=datetime(2026, 11, 23, 10),
                kind="override",
                scheduled_session_id=plan["id"],
            )
        )
        db.commit()
    row, path = manual(client, clock, task["id"], plan)
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row))).json()
    payload = {"operation_id": "correct", "preview": approved}
    write = TimerStore.write

    def fail_after_intent(store, state):
        write(store, state)
        if (state.get("pending_operation") or {}).get("id") == "correct":
            raise OSError("synthetic pre-DB failure")

    monkeypatch.setattr(TimerStore, "write", fail_after_intent)
    assert client.post(path + "/correction", json=payload).status_code == 409
    monkeypatch.setattr(TimerStore, "write", write)
    update = client.put("/api/tasks/" + task["id"], json={"is_recurring": True, "recurrence_rrule": "FREQ=WEEKLY"})
    assert update.status_code == (409 if linked else 200), update.text
    if linked:
        assert update.json()["code"] == "correction_pending"
        assert client.get("/api/tasks/" + task["id"]).json()["recurrence_rrule"] == "FREQ=DAILY"
    result = client.post(path + "/correction", json=payload)
    assert result.status_code == 200, result.text


def test_buffer_audit_uses_segment_identity_then_public_actual_work_lineage(client, clock):
    clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
    timer = client.post("/timers", json={"operation_id": "start"}).json()["timer"]
    client.post("/timers/correction-initialize", json={"operation_id": "init"})
    clock.at += timedelta(minutes=30)
    path = "/timers/" + timer["id"]
    approved = client.post(
        path + "/correction-preview", json=exclusion({"kind": "running", "segment_id": timer["running_segment_id"]})
    ).json()
    assert client.post(path + "/correction", json={"operation_id": "exclude", "preview": approved}).status_code == 200
    stopped = client.post(path + "/stop", json={"operation_id": "stop"}).json()
    for identity in stopped["recorded_work_ids"]:
        row = client.get("/recorded-work/" + identity).json()
        assert row["correction_lineage"]["rating_source_work_id"] == identity
        assert row["correction_lineage"]["operation_ids"] == ["exclude"]


@pytest.mark.parametrize("tamper", ["work", "allocation", "digest"])
def test_saved_signed_authority_and_nonwriting_preview(client, db, tmp_path, clock, tamper):
    row, path = manual(client, clock)
    before = persisted_snapshot(tmp_path, db)
    approved = client.post(path + "/correction-preview", json=exclusion(saved_target(row)))
    assert approved.status_code == 200, approved.text
    assert persisted_snapshot(tmp_path, db) == before
    envelope = deepcopy(approved.json())
    if tamper == "work":
        envelope["request"]["target"]["work_id"] = "other"
    elif tamper == "allocation":
        envelope["plan"]["after"][1]["segment_id"] = "other"
    else:
        envelope["dependency_digest"] = "0" * 64
    result = client.post(path + "/correction", json={"operation_id": "bad", "preview": envelope})
    assert result.status_code == 409, result.text
    assert persisted_snapshot(tmp_path, db) == before
