"""Public exact receipts across every shared writer boundary, not just Stop."""

import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
from test_timer_correction_intervals import exclusion
from test_timer_correction_steps import clock as _clock

clock = _clock


def prepare(client, clock, action):
    clock.at = datetime(2026, 11, 23, 9, tzinfo=UTC)
    assert client.post("/timers/correction-initialize", json={"operation_id": "init"}).status_code == 200
    clock.at = datetime(2026, 11, 23, 10, tzinfo=UTC)
    if action == "saved_exclude":
        clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
        row = client.post(
            "/recorded-work",
            json={
                "start_time": "2026-11-23T10:00:00Z",
                "end_time": "2026-11-23T10:30:00Z",
                "notes": "retained metadata",
            },
        ).json()
        path = "/recorded-work/" + row["id"]
        request = exclusion(
            {"kind": "saved", "work_id": row["id"], "expected_revision": row["revision"]},
            "2026-11-23T10:10:00",
            "2026-11-23T10:15:00",
        )
    elif action == "start":
        return "/timers", {"operation_id": "matrix", "notes": "matrix unassigned"}, None
    else:
        response = client.post("/timers", json={"operation_id": "start", "notes": "retained metadata"})
        assert response.status_code == 200, response.text
        timer = response.json()["timer"]
        path = "/timers/" + timer["id"]
        clock.at = datetime(2026, 11, 23, 11, tzinfo=UTC)
        if action in ("resume", "buffer_step", "buffer_exclude", "paused_note"):
            paused = client.post(path + "/pause", json={"operation_id": "setup-pause"})
            assert paused.status_code == 200, paused.text
            timer = paused.json()["timer"]
        if action in ("pause", "resume", "split", "stop", "note", "paused_note"):
            payload = {"operation_id": "matrix", "expected_revision": timer["revision"]}
            if action in ("note", "paused_note"):
                payload.update(
                    new_notes="matrix note",
                    expected_note_segment_id=timer.get("manual_pause_note_segment_id")
                    if action == "paused_note"
                    else None,
                )
            if action == "split":
                payload.update(new_notes="matrix split")
            return path + "/" + ("note" if action == "paused_note" else action), payload, timer["id"]
        target = (
            {"kind": "buffered", "segment_id": timer["manual_pause_note_segment_id"]}
            if action.startswith("buffer")
            else {"kind": "running", "segment_id": timer["running_segment_id"]}
        )
        if action.endswith("exclude"):
            request = exclusion(target, "2026-11-23T10:10:00", "2026-11-23T10:15:00")
        elif action == "dated":
            request = {
                "target": target,
                "change": {
                    "kind": "set_start",
                    "start_utc": "2026-11-23T10:05:00Z",
                    "timezone": "UTC",
                    "local_datetime": "2026-11-23T10:05:00",
                    "offset_seconds": 0,
                },
            }
        else:
            request = {"target": target, "change": {"kind": "step_start", "credited_delta_seconds": -300}}
    preview = client.post(path + "/correction-preview", json=request)
    assert preview.status_code == 200, preview.text
    return path + "/correction", {"operation_id": "matrix", "preview": preview.json()}, None


@pytest.mark.parametrize(
    "action",
    [
        "start",
        "pause",
        "resume",
        "split",
        "stop",
        "note",
        "paused_note",
        "running_step",
        "buffer_step",
        "dated",
        "running_exclude",
        "buffer_exclude",
        "saved_exclude",
    ],
)
@pytest.mark.parametrize(
    "boundary",
    [
        "pre_intent_fsync",
        "intent_replace",
        "intent_directory_fsync",
        "pre_db_commit",
        "post_db_commit",
        "state_replace",
        "state_directory_fsync",
        "pre_finalization",
        "post_finalization",
    ],
)
def test_public_receipt_matrix(client, db, tmp_path, monkeypatch, clock, action, boundary):
    from timetrace.core.timer_store import TimerStore

    monkeypatch.setenv("TIMETRACE_TIMER_STATE_FILE", str(tmp_path / "timers.json"))
    path, payload, _ = prepare(client, clock, action)
    commit, sync, replace, write = db.commit, os.fsync, os.replace, TimerStore.write
    counts = {"commit": 0, "sync": 0, "replace": 0}
    accepted = []

    def capture(store, state):
        pending = state.get("pending_operation")
        if pending and pending["id"] == "matrix":
            accepted.append(json.loads(pending["result_json"]))
        return write(store, state)

    def fault_commit():
        counts["commit"] += 1
        count = counts["commit"]
        if (boundary == "pre_db_commit" and count == 1) or (boundary == "pre_finalization" and count == 2):
            raise OSError("injected commit refusal")
        commit()
        if (boundary == "post_db_commit" and count == 1) or (boundary == "post_finalization" and count == 2):
            raise OSError("injected post-commit uncertain outcome")

    def fault_sync(fd):
        counts["sync"] += 1
        if counts["sync"] == {"pre_intent_fsync": 1, "intent_directory_fsync": 2, "state_directory_fsync": 4}.get(
            boundary
        ):
            raise OSError("injected fsync refusal")
        sync(fd)

    def fault_replace(source, destination):
        counts["replace"] += 1
        if counts["replace"] == {"intent_replace": 1, "state_replace": 2}.get(boundary):
            raise OSError("injected atomic replacement refusal")
        return replace(source, destination)

    with monkeypatch.context() as fault:
        fault.setattr(TimerStore, "write", capture)
        fault.setattr(db, "commit", fault_commit)
        fault.setattr(os, "fsync", fault_sync)
        fault.setattr(os, "replace", fault_replace)
        failed = client.post(path, json=payload)
    assert failed.status_code == 409, failed.text
    assert failed.json()["code"] == "reconciliation_required"
    status = client.get("/operations/matrix")
    assert status.status_code in (200, 404), status.text
    result = client.post(path, json=payload)
    assert result.status_code == 200, result.text
    if status.status_code == 200:
        assert result.json() == accepted[0]
    assert client.get("/operations/matrix").json()["status"] == "finalized"
    assert client.post(path, json=payload).json() == result.json()
    timer = result.json().get("timer")
    if timer and timer["state"] != "stopped":
        clock.at = datetime(2026, 11, 23, 12, tzinfo=UTC)
        stopped = client.post("/timers/" + timer["id"] + "/stop", json={"operation_id": "later-stop"})
        assert stopped.status_code == 200, stopped.text
        assert (
            client.post("/timers/" + timer["id"] + "/stop", json={"operation_id": "later-stop"}).json()
            == stopped.json()
        )
    rows = client.get("/sessions").json()
    assert len({row["id"] for row in rows}) == len(rows)
    assert all(datetime.fromisoformat(row["end_time"]) > datetime.fromisoformat(row["start_time"]) for row in rows)
    assert client.post(path, json=payload).json() == result.json()
    assert client.get("/sessions").json() == rows


@pytest.mark.parametrize(
    "phase", ["after_state_replace", "after_state_fsync", "before_receipt_finalization", "after_receipt_finalization"]
)
def test_saved_process_exit_after_file_install_or_finalization_recovers_twice(tmp_path, phase):
    env = {
        **os.environ,
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path / "tmp"),
        "TIMETRACE_DB_FILE": str(tmp_path / "installation.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "timers.json"),
        "TIMETRACE_PORT": "18461",
        "PYTHONPATH": str(Path(__file__).parent.resolve()),
        "CRASH_PHASE": phase,
        "PACKET": str(tmp_path / "packet.json"),
    }
    (tmp_path / "home").mkdir()
    (tmp_path / "tmp").mkdir()
    script = """
import json,os
from datetime import datetime,UTC
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
from timetrace.services import multiple_timer_service
from test_timer_correction_durability import prepare
init_db()
class Clock(datetime):
    at=datetime(2026,11,23,9,tzinfo=UTC)
    @classmethod
    def now(cls,tz=None): return cls.at
multiple_timer_service.datetime=Clock
c=TestClient(create_daemon_app())
path,payload,_=prepare(c,Clock,'saved_exclude')
Path(os.environ['PACKET']).write_text(json.dumps({'path':path,'payload':payload}))
replace,sync,commit=os.replace,os.fsync,Session.commit
counts={'replace':0,'sync':0,'commit':0}
phase=os.environ['CRASH_PHASE']
def replacement(src,dst):
    counts['replace']+=1
    replace(src,dst)
    if phase=='after_state_replace' and counts['replace']==2: os._exit(77)
def syncing(fd):
    counts['sync']+=1
    sync(fd)
    if phase=='after_state_fsync' and counts['sync']==4: os._exit(77)
def committing(session):
    counts['commit']+=1
    if phase=='before_receipt_finalization' and counts['commit']==2: os._exit(77)
    commit(session)
    if phase=='after_receipt_finalization' and counts['commit']==2: os._exit(77)
os.replace=replacement;os.fsync=syncing;Session.commit=committing
c.post(path,json=payload)
raise AssertionError('crash boundary was not reached')
"""
    crashed = subprocess.run([sys.executable, "-P", "-c", script], env=env, capture_output=True, text=True, timeout=90)
    assert crashed.returncode == 77, crashed.stdout + crashed.stderr
    recovery = """
import json,os,sqlite3
from pathlib import Path
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app
packet=json.loads(Path(os.environ['PACKET']).read_text())
expected={f['segment_id'].removeprefix('saved:') for f in packet['payload']['preview']['plan']['after']}
with TestClient(create_daemon_app()) as c:
    result=c.post(packet['path'],json=packet['payload'])
    assert result.status_code==200,result.text
    assert c.post(packet['path'],json=packet['payload']).json()==result.json()
    assert c.get('/operations/matrix').json()['status']=='finalized'
    rows=c.get('/sessions').json()
    assert {row['id'] for row in rows}==expected,rows
    assert all(row['notes']=='retained metadata' for row in rows)
    geometry=sorted((row['start_time'][11:19],row['end_time'][11:19]) for row in rows)
    assert geometry==[('10:00:00','10:10:00'),('10:15:00','10:30:00')]
    for row in rows:
        work=c.get('/recorded-work/'+row['id']).json()
        assert work['correction_lineage']['operation_ids']==['matrix'],work
with sqlite3.connect(os.environ['TIMETRACE_DB_FILE']) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()==('ok',)
    assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
"""
    for _ in range(2):
        recovered = subprocess.run(
            [sys.executable, "-P", "-c", recovery], env=env, capture_output=True, text=True, timeout=90
        )
        assert recovered.returncode == 0, recovered.stdout + recovered.stderr


@pytest.mark.parametrize("phase", ["finalized", "pre_db", "post_db"])
def test_genuine_checkpoint_v3_receipt_and_pending_recipe_keep_hash_result_and_later_note(tmp_path, phase):
    fixture = Path(__file__).parent / "fixtures" / "saved_correction_v3_bed2237.json"
    env = {
        **os.environ,
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path / "tmp"),
        "TIMETRACE_DB_FILE": str(tmp_path / "installation.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "timers.json"),
        "TIMETRACE_PORT": "18461",
        "V3_PHASE": phase,
        "V3_FIXTURE": str(fixture),
    }
    (tmp_path / "home").mkdir()
    (tmp_path / "tmp").mkdir()
    setup = """
import json,os,sqlite3
from pathlib import Path
from fastapi.testclient import TestClient
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
p=json.loads(Path(os.environ['V3_FIXTURE']).read_text())
init_db()
phase=os.environ['V3_PHASE']
with sqlite3.connect(os.environ['TIMETRACE_DB_FILE']) as db:
    def insert(table,rows):
        for row in rows:
            columns=list(row)
            sql='INSERT INTO '+table+' ('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')'
            db.execute(sql,[row[key] for key in columns])
    insert('session',p['before_rows'] if phase=='pre_db' else p['after_rows'])
    receipts=[dict(row) for row in p['receipts'] if phase!='pre_db' or row['id']!='old-v3-correct']
    if phase=='post_db':
        for row in receipts:
            if row['id']=='old-v3-correct':row['file_finalized']=0
    insert('mutation_operation',receipts)
    if phase!='pre_db':insert('work_correction',p['audits'])
state=p['after_state'] if phase=='finalized' else p['before_state']
if phase!='finalized':state['pending_operation']=p['intent']
Path(os.environ['TIMETRACE_TIMER_STATE_FILE']).write_text(json.dumps(state))
assert not (Path(os.environ['TIMETRACE_DB_FILE']).parent/'correction-signing.key').exists()
if phase=='post_db':
    c=TestClient(create_daemon_app())
    row=c.get(p['path']).json()
    edit=c.patch(p['path']+'/note',json={'notes':'later legal old-v3 note','expected_revision':row['revision']})
    assert edit.status_code==200,edit.text
"""
    initialized = subprocess.run(
        [sys.executable, "-P", "-c", setup], env=env, capture_output=True, text=True, timeout=90
    )
    assert initialized.returncode == 0, initialized.stdout + initialized.stderr
    recovery = """
import json,os,sqlite3
from pathlib import Path
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app
p=json.loads(Path(os.environ['V3_FIXTURE']).read_text())
old=next(r for r in p['receipts'] if r['id']=='old-v3-correct')
with TestClient(create_daemon_app()) as c:
    result=c.post(p['path']+'/correction',json=p['body'])
    assert result.status_code==200,result.text
    assert result.json()==p['result'],result.text
    assert 'work_fragments' not in result.json()['correction']
    assert c.post(p['path']+'/correction',json=p['body']).json()==p['result']
    assert c.get('/operations/old-v3-correct').json()['status']=='finalized'
    rows=c.get('/sessions').json()
    assert {row['id'] for row in rows}=={row['id'] for row in p['after_rows']}
    if os.environ['V3_PHASE']=='post_db':assert c.get(p['path']).json()['notes']=='later legal old-v3 note'
    else:assert c.get(p['path']).json()['notes']=='historical synthetic saved work'
    changed={**p['body'],'preview':{**p['body']['preview'],'cutoff':'2026-11-23T12:00:01+00:00'}}
    refused=c.post(p['path']+'/correction',json=changed)
    assert refused.status_code==409,refused.text
    assert refused.json()['code']=='operation_payload_mismatch'
with sqlite3.connect(os.environ['TIMETRACE_DB_FILE']) as db:
    row=db.execute('SELECT payload_hash,result_json FROM mutation_operation WHERE id=?',('old-v3-correct',)).fetchone()
    assert row==(old['payload_hash'],old['result_json'])
    assert db.execute('SELECT COUNT(*) FROM work_correction').fetchone()==(1,)
    assert db.execute('PRAGMA integrity_check').fetchone()==('ok',)
    assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
"""
    for _ in range(2):
        recovered = subprocess.run(
            [sys.executable, "-P", "-c", recovery], env=env, capture_output=True, text=True, timeout=90
        )
        assert recovered.returncode == 0, recovered.stdout + recovered.stderr
