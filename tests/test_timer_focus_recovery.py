"""Real-process receipt/event recovery, normal migrations and copied synthetic state."""

import json
import os
import shutil
import subprocess
import sys

import pytest

SETUP = """
import json, os
from datetime import datetime, UTC, timedelta
from fastapi.testclient import TestClient
from timetrace.db.session import init_db, engine
from sqlmodel import Session, select
from timetrace.db.models import MutationOperation
from timetrace.main import create_daemon_app
from timetrace.services.timer_focus_service import FocusEvaluator
from timetrace.services.multiple_timer_service import MultipleTimerService
init_db()
with TestClient(create_daemon_app()) as started:
 assert started.get('/health').status_code==200
c = TestClient(create_daemon_app())
"""
SEED = """
r=c.post('/timers',json={'operation_id':'start'})
assert r.status_code==200,r.text
t=r.json()['timer']; path='/timers/'+t['id']
r=c.post(path+'/focus-settings',json={'operation_id':'enable','expected_revision':1,
 'enabled':True,'work_minutes':1,'break_minutes':1,'behavior':'notify_only'})
assert r.status_code==200,r.text
"""
EVALUATE = """
with Session(engine) as db:
 t=c.get('/timers').json()['timers'][0]
 due=datetime.fromisoformat(t['identity_started_at'])+timedelta(seconds=61)
 FocusEvaluator(db,wall_clock=lambda:due).evaluate()
"""


def run(root, code, expected=0):
    (root / "home").mkdir(exist_ok=True)
    (root / "tmp").mkdir(exist_ok=True)
    env = {
        **os.environ,
        "HOME": str(root / "home"),
        "TMPDIR": str(root / "tmp"),
        "TIMETRACE_DB_FILE": str(root / "db.sqlite"),
        "TIMETRACE_TIMER_STATE_FILE": str(root / "active_timer.json"),
    }
    result = subprocess.run([sys.executable, "-P", "-c", code], env=env, capture_output=True, text=True)
    assert result.returncode == expected, result.stderr + result.stdout
    return result.stdout


@pytest.mark.parametrize("replace_number", [1, 2])
def test_events_and_fixed_intent_survive_pre_post_database_crash(tmp_path, replace_number):
    run(tmp_path, SETUP + SEED.replace("'notify_only'", "'automatic_break'"))
    crash = """
real_replace=os.replace
calls=0
def crash_replace(src,dst):
 global calls
 if str(dst)==os.environ['TIMETRACE_TIMER_STATE_FILE']:
  calls+=1
  if calls==REPLACE_NUMBER:
   if REPLACE_NUMBER==1: real_replace(src,dst)
   os._exit(77)
 return real_replace(src,dst)
""".replace("REPLACE_NUMBER", str(replace_number))
    automatic = """
with Session(engine) as db:
 t=c.get('/timers').json()['timers'][0]
 anchor=datetime.fromisoformat(t['focus']['recording_anchor'])
 instant=[anchor+timedelta(seconds=59)]
 ticks=[59.0]
 evaluator=FocusEvaluator(db,wall_clock=lambda:instant[0],monotonic_clock=lambda:ticks[0],suspend_clock=lambda:ticks[0])
 evaluator.evaluate()
 os.replace=crash_replace
 instant[0]+=timedelta(seconds=1)
 ticks[0]+=1
 evaluator.evaluate()
"""
    run(tmp_path, SETUP + crash + automatic, expected=77)
    recovery = (
        SETUP
        + """
with Session(engine) as db: MultipleTimerService(db).reconcile()
"""
        + EVALUATE
        + """
notices=c.get('/timer-notifications').json()['notices']
assert len(notices)==1,notices
assert notices[0]['kind']=='work_due'
with Session(engine) as db:
 assert all(r.file_finalized for r in db.exec(select(MutationOperation)).all())
print(json.dumps({'notices':notices,'timer':c.get('/timers').json()['timers'][0]}))
"""
    )
    first = json.loads(run(tmp_path, recovery).splitlines()[-1])
    second = json.loads(run(tmp_path, recovery).splitlines()[-1])
    assert first["notices"] == second["notices"]
    assert first["timer"]["state"] == second["timer"]["state"] == "paused"
    assert len(first["timer"]["segments"]) == 1
    for field in ("id", "running_start", "running_segment_id", "segments"):
        assert first["timer"].get(field) == second["timer"].get(field)
    for result in (first, second):
        result["timer"]["focus"].pop("remaining_seconds", None)
    assert first["timer"]["focus"] == second["timer"]["focus"]


def test_two_process_evaluators_and_claims_are_exclusive(tmp_path):
    run(tmp_path, SETUP + SEED)
    env = {
        **os.environ,
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path / "tmp"),
        "TIMETRACE_DB_FILE": str(tmp_path / "db.sqlite"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "active_timer.json"),
    }
    jobs = [
        subprocess.Popen(
            [sys.executable, "-P", "-c", SETUP + EVALUATE],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for _ in range(2)
    ]
    for process in jobs:
        out, err = process.communicate(timeout=60)
        assert process.returncode == 0, out + err
    claim = (
        SETUP
        + """
n=c.get('/timer-notifications').json()['notices']
assert len(n)==1,n
r=c.post('/timer-notifications/'+n[0]['id']+'/claim',json={'operation_id':str(os.getpid()),'channel':'native'})
print(r.status_code)
"""
    )
    jobs = [
        subprocess.Popen(
            [sys.executable, "-P", "-c", claim], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        for _ in range(2)
    ]
    outcomes = []
    for process in jobs:
        out, err = process.communicate(timeout=60)
        assert process.returncode == 0, out + err
        outcomes.append(int(out.splitlines()[-1]))
    assert sorted(outcomes) == [200, 409]


def test_fresh_chain_and_copied_old_pending_receipt_upgrade_twice(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    # Normal fresh chain first, then a consistent synthetic pre-0019 installation.
    prepare = (
        SETUP
        + SEED
        + """
from alembic import command
from alembic.config import Config
from pathlib import Path
with Session(engine) as db:
 receipt=db.get(MutationOperation,'start')
 old=json.loads(receipt.after_state_json)
 timer=next(iter(old['timers'].values()))
 for key in ['focus','identity_started_at','identity_started_at_provenance']:
  timer.pop(key,None)
 response=json.loads(receipt.result_json)
 response['timer']=timer
 receipt.after_state_json=json.dumps(old)
 receipt.result_json=json.dumps(response)
 receipt.file_finalized=False
 db.add(receipt)
 # Remove later state; retain the historical creation receipt and exact payload hash.
 db.delete(db.get(MutationOperation,'enable'))
 db.commit()
 db.refresh(receipt)
 intent={**receipt.model_dump(exclude={'file_finalized'}),'work':[]}
 Path(os.environ['TIMETRACE_TIMER_STATE_FILE']).write_text(json.dumps(
  {'version':2,'revision':0,'timers':{},'pending_operation':intent}))
 print(json.dumps({'receipt':response,'hash':receipt.payload_hash,'timer':timer['id']}))
cfg=Config('alembic.ini')
command.downgrade(cfg,'0018_work_corrections')
engine.dispose()
"""
    )
    fixture = json.loads(run(source, prepare).splitlines()[-1])
    target = tmp_path / "copy"
    target.mkdir()
    for name in ("db.sqlite", "active_timer.json"):
        shutil.copy2(source / name, target / name)
    verify = (
        SETUP
        + """
with Session(engine) as db: MultipleTimerService(db).reconcile()
replay=c.post('/timers',json={'operation_id':'start'})
assert replay.status_code==200,replay.text
with Session(engine) as db:
 FocusEvaluator(db).evaluate()
 r=db.get(MutationOperation,'start')
 from sqlalchemy import text
 assert db.exec(text('PRAGMA integrity_check')).all()==[('ok',)]
 assert db.exec(text('PRAGMA foreign_key_check')).all()==[]
 assert db.exec(text('SELECT version_num FROM alembic_version')).one()[0]=='0019_timer_focus'
 print(json.dumps({'receipt':replay.json(),'hash':r.payload_hash,'timer':c.get('/timers').json()['timers'][0]}))
"""
    )
    outputs = [json.loads(run(target, verify).splitlines()[-1]) for _ in range(2)]
    for result in outputs:
        assert result["receipt"] == fixture["receipt"]
        assert result["hash"] == fixture["hash"]
        assert result["timer"]["identity_started_at_provenance"] == "creation_receipt"
    assert outputs[0]["timer"]["identity_started_at"] == outputs[1]["timer"]["identity_started_at"]
