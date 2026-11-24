"""DB-only settings receipts, lost ACK, competing processes and normal repeated startup."""

import json
import subprocess
import sys
from pathlib import Path

import pytest
from test_saved_correction_recovery import environment, run

BASE = """
import json,os
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session
from timetrace.db.session import init_db
from timetrace.main import create_daemon_app
c=TestClient(create_daemon_app())
recipe=Path(os.environ['TIMETRACE_DB_FILE']+'.goals.json')
"""
SEED = (
    BASE
    + """
init_db()
task=c.post('/api/tasks',json={'title':'Persisted goal owner'}).json()
work=c.post('/recorded-work',json={'task_id':task['id'],'start_time':'2000-01-04T10:00:00Z',
 'end_time':'2000-01-04T11:00:00Z','notes':'immutable saved evidence'}).json()
request={'operation_id':'persisted-goal-create','owner_kind':'task','task_id':task['id'],
 'cadence':'total','target_seconds':3600}
created=c.post('/goals',json=request);assert created.status_code==201,created.text
recipe.write_text(json.dumps({'work':c.get('/recorded-work/'+work['id']).json(),
 'request':request,'original':created.json()}))
"""
)
WRITE = (
    BASE
    + """
s=json.loads(recipe.read_text());case=os.environ['CASE'];lane=os.environ.get('LANE','a')
if case=='lost_ack':
 real_commit=Session.commit
 def lost_commit(db):
  real_commit(db);os._exit(77)
 Session.commit=lost_commit
if case=='context_vs_edit' and lane=='a':
 url='/goal-reporting-context'
 payload={'operation_id':'context-writer','expected_revision':1,'first_day_of_week':0}
else:
 url='/goals/'+s['original']['id']
 payload={'operation_id':'fixed-edit' if case in ('exact_edit','lost_ack') else 'edit-'+lane,
  'expected_revision':1,'target_seconds':7200 if lane=='a' else 10800}
 if case=='exact_edit': payload['target_seconds']=7200
r=c.put(url,json=payload)
print(json.dumps({'status':r.status_code,'body':r.json()}))
"""
)
VERIFY = (
    BASE
    + """
s=json.loads(recipe.read_text())
with TestClient(create_daemon_app()) as started:
 assert started.get('/health').status_code==200
assert c.post('/goals',json=s['request']).json()==s['original']
assert c.get('/operations/persisted-goal-create').status_code==404
assert c.get('/operations/fixed-edit').status_code==404
assert c.get('/timers').json()['timers']==[]
assert c.get('/recorded-work/'+s['work']['id']).json()==s['work']
goals=c.get('/goals').json()['goals'];assert len(goals)==1,goals
g=goals[0];assert g['summed_recorded_work_seconds']==3600
print(json.dumps({'id':g['id'],'revision':g['revision'],'target':g['target_seconds'],
 'percentage':g['percentage'],'context_revision':g['context_revision']}))
"""
)


@pytest.mark.parametrize("case", ["exact_edit", "competing_edit", "context_vs_edit", "lost_ack"])
def test_settings_receipts_survive_actual_process_writers_and_restarts_without_timer_rows(tmp_path, case):
    env = environment(tmp_path)
    env.update(CASE=case, TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED="false")
    run(SEED, env)
    timer = Path(env["TIMETRACE_TIMER_STATE_FILE"])
    before = timer.read_bytes() if timer.exists() else None
    if case == "lost_ack":
        run(WRITE, env, expected=77)
        replay = json.loads(run(WRITE.replace("if case=='lost_ack':", "if False:"), env).splitlines()[-1])
        assert replay["status"] == 200
    else:
        jobs = [
            subprocess.Popen(
                [sys.executable, "-P", "-c", WRITE],
                env={**env, "LANE": lane},
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for lane in ("a", "b")
        ]
        results = []
        for job in jobs:
            stdout, stderr = job.communicate(timeout=45)
            assert job.returncode == 0, stdout + stderr
            results.append(json.loads(stdout.splitlines()[-1]))
        statuses = sorted(r["status"] for r in results)
        if case == "exact_edit":
            assert statuses == [200, 200]
            assert results[0]["body"] == results[1]["body"]
        elif case == "competing_edit":
            assert statuses == [200, 409]
        else:
            assert results[0]["status"] == 200
            assert results[1]["status"] in (200, 409)
    assert (timer.read_bytes() if timer.exists() else None) == before
    first = json.loads(run(VERIFY, env).splitlines()[-1])
    assert json.loads(run(VERIFY, env).splitlines()[-1]) == first
    if case in ("exact_edit", "lost_ack"):
        assert (first["revision"], first["target"], first["percentage"]) == (2, 7200, 50)
    elif case == "competing_edit":
        assert first["revision"] == 2 and first["target"] in (7200, 10800)
    else:
        assert first["context_revision"] == 2
        assert (first["revision"], first["target"]) in ((2, 3600), (3, 10800))
