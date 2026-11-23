"""Correction preparation is read-only through the real root HTTP interface."""

import json
import os
from copy import deepcopy
from pathlib import Path

import pytest
from sqlalchemy import text

from timetrace.db.models import MutationOperation

REQUEST = {
    "target": {"kind": "running", "segment_id": "old-running-segment"},
    "change": {"kind": "step_start", "credited_delta_seconds": -300},
}


def persisted_snapshot(directory, db):
    """Observe every file/directory and all SQL rows, not just timer summaries."""
    files = {
        str(path.relative_to(directory)): (
            (path.read_bytes(), path.stat().st_ino, path.stat().st_mtime_ns) if path.is_file() else None
        )
        for path in directory.rglob("*")
    }
    tables = db.exec(text("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).all()
    rows = {name: db.exec(text(f'SELECT * FROM "{name}"')).all() for (name,) in tables}
    from timetrace.config import settings

    installation_files = {
        path.name: (path.read_bytes(), path.stat().st_ino, path.stat().st_mtime_ns)
        for path in settings.db_file.parent.iterdir()
        if path.is_file()
    }
    return files, rows, installation_files


def test_old_v2_preview_requires_initialization_without_any_persisted_change(client, db, tmp_path):
    timer = client.post("/timers", json={"operation_id": "start-before-corrections"}).json()["timer"]
    before = persisted_snapshot(tmp_path, db)
    response = client.post(f"/timers/{timer['id']}/correction-preview", json=REQUEST)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "correction_initialization_required"
    assert "initializ" in response.json()["detail"].lower()
    assert persisted_snapshot(tmp_path, db) == before


def test_legacy_v1_preview_does_not_create_backup_identity_or_key(client, db, tmp_path):
    path = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"])
    path.write_text(json.dumps({"is_running": True, "start_time": "2026-11-23T10:00:00+00:00"}))
    before = persisted_snapshot(tmp_path, db)
    response = client.post("/timers/legacy/correction-preview", json=REQUEST)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "correction_initialization_required"
    assert persisted_snapshot(tmp_path, db) == before


def test_pending_old_file_intent_preview_requires_recovery_without_replaying(client, db, tmp_path):
    timer = client.post("/timers", json={"operation_id": "pending-old-start"}).json()["timer"]
    receipt = db.get(MutationOperation, "pending-old-start")
    path = Path(os.environ["TIMETRACE_TIMER_STATE_FILE"])
    state = json.loads(path.read_text())
    state["pending_operation"] = {**receipt.model_dump(exclude={"file_finalized"}), "work": []}
    path.write_text(json.dumps(state))
    before = persisted_snapshot(tmp_path, db)
    response = client.post(f"/timers/{timer['id']}/correction-preview", json=REQUEST)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "reconciliation_required"
    assert persisted_snapshot(tmp_path, db) == before


def test_unfinalized_old_receipt_preview_requires_recovery_without_finalizing(client, db, tmp_path):
    timer = client.post("/timers", json={"operation_id": "unfinalized-old-start"}).json()["timer"]
    receipt = db.get(MutationOperation, "unfinalized-old-start")
    receipt.file_finalized = False
    db.add(receipt)
    db.commit()
    before = persisted_snapshot(tmp_path, db)
    response = client.post(f"/timers/{timer['id']}/correction-preview", json=REQUEST)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "reconciliation_required"
    assert persisted_snapshot(tmp_path, db) == before


def test_preview_without_state_does_not_create_parent_or_lock(client, db, tmp_path, monkeypatch):
    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "absent" / "timers.json"))
    before = persisted_snapshot(tmp_path, db)
    response = client.post("/timers/not-initialized/correction-preview", json=REQUEST)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "correction_initialization_required"
    assert persisted_snapshot(tmp_path, db) == before


@pytest.mark.parametrize("contents", ["{invalid", "[]", '{"version": 99}'])
def test_corrupt_or_unknown_preview_state_fails_closed_without_writes(client, db, tmp_path, contents):
    Path(os.environ["TIMETRACE_TIMER_STATE_FILE"]).write_text(contents)
    before = persisted_snapshot(tmp_path, db)
    response = client.post("/timers/not-initialized/correction-preview", json=REQUEST)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "reconciliation_required"
    assert persisted_snapshot(tmp_path, db) == before


@pytest.mark.parametrize(
    ("section", "field", "value"),
    [
        (None, "operation_id", "must-not-be-a-mutation"),
        ("target", "unexpected", "value"),
        ("target", "segment_id", 123),
        ("target", "segment_id", ""),
        ("target", "kind", "guessed"),
        ("change", "unexpected", "value"),
        ("change", "credited_delta_seconds", "300"),
        ("change", "credited_delta_seconds", True),
        ("change", "credited_delta_seconds", 300.0),
        ("change", "credited_delta_seconds", 0),
        ("change", "credited_delta_seconds", -301),
        ("change", "kind", "arbitrary-subtraction"),
    ],
)
def test_preview_strict_schema_rejects_malformed_requests_without_writes(client, db, tmp_path, section, field, value):
    payload = deepcopy(REQUEST)
    (payload if section is None else payload[section])[field] = value
    before = persisted_snapshot(tmp_path, db)
    response = client.post("/timers/not-initialized/correction-preview", json=payload)
    assert response.status_code == 422, response.text
    assert persisted_snapshot(tmp_path, db) == before


@pytest.mark.parametrize(
    "target",
    [
        {"kind": "running", "segment_id": "running-id"},
        {"kind": "buffered", "segment_id": "buffer-id"},
        {"kind": "saved", "work_id": "saved-id", "expected_revision": 1},
    ],
)
def test_supported_target_shapes_never_issue_unsigned_preview(client, db, tmp_path, target):
    before = persisted_snapshot(tmp_path, db)
    response = client.post(
        "/timers/not-initialized/correction-preview",
        json={"target": target, "change": {"kind": "step_start", "credited_delta_seconds": 300}},
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "correction_initialization_required"
    assert persisted_snapshot(tmp_path, db) == before
