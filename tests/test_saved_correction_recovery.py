"""Real process/SQLite recovery checks for accepted saved corrections."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SETUP = """
import json,os
from pathlib import Path
from datetime import UTC,datetime
from fastapi.testclient import TestClient
from sqlmodel import Session
from timetrace.db.session import init_db,engine,lock_sqlite_writer
from timetrace.main import create_daemon_app
from timetrace.services import multiple_timer_service as module
class Clock(datetime):
    @classmethod
    def now(cls,tz=None): return cls(2026,11,23,12,tzinfo=UTC)
module.datetime=Clock
init_db()
c=TestClient(create_daemon_app())
"""


def environment(tmp_path):
    return {
        **os.environ,
        "TIMETRACE_DB_FILE": str(tmp_path / "synthetic.db"),
        "TIMETRACE_TIMER_STATE_FILE": str(tmp_path / "active_timer.json"),
        "HOME": str(tmp_path / "home"),
        "TMPDIR": str(tmp_path),
        "TIMETRACE_PORT": "18461",
        "TIMETRACE_IDLE_DETECTION_ENABLED": "false",
        "TZ": "UTC",
    }


def run(script, env, expected=0):
    process = subprocess.run([sys.executable, "-P", "-c", script], env=env, capture_output=True, text=True, timeout=45)
    assert process.returncode == expected, process.stderr
    return process.stdout


@pytest.mark.parametrize("pending", [False, True])
def test_genuine_v2_exclusion_receipt_replays_unchanged_then_stops_once(tmp_path, pending):
    env = environment(tmp_path)
    env["OLD_V2_FIXTURE"] = str(Path(__file__).parent / "fixtures" / "timer_exclusion_v2_9e0e7d2.json")
    env["OLD_PENDING"] = "1" if pending else "0"
    script = (
        SETUP
        + """
from timetrace.db.models import MutationOperation
class StopClock(datetime):
    @classmethod
    def now(cls,tz=None): return cls(2026,11,23,11,30,tzinfo=UTC)
module.datetime=StopClock
s=json.loads(Path(os.environ['OLD_V2_FIXTURE']).read_text())
with Session(engine) as db:
    if db.get(MutationOperation,s['receipt']['id']) is None:
        receipt=dict(s['receipt'])
        if os.environ['OLD_PENDING']=='1': receipt['file_finalized']=False
        db.add(MutationOperation.model_validate(receipt));db.commit()
        state=json.loads(receipt['after_state_json'])
        if os.environ['OLD_PENDING']=='1':
            state=s['before_state']
            state['pending_operation']={**{k:v for k,v in receipt.items() if k!='file_finalized'},
                'work':[],'task_deletion':None,'plan_capture':None,'plan_update':None}
        Path(os.environ['TIMETRACE_TIMER_STATE_FILE']).write_text(json.dumps(state))
r=c.post(s['path']+'/correction',json=s['request'])
assert r.status_code==200,r.text
assert r.json()==json.loads(s['receipt']['result_json'])
with Session(engine) as db:
    assert db.get(MutationOperation,s['receipt']['id']).payload_hash==s['receipt']['payload_hash']
stopped=c.post(s['path']+'/stop',json={'operation_id':'legacy-stop'})
assert stopped.status_code==200,stopped.text
assert c.post(s['path']+'/stop',json={'operation_id':'legacy-stop'}).json()==stopped.json()
rows=[c.get('/recorded-work/'+i).json() for i in stopped.json()['recorded_work_ids']]
assert len(rows)==2
assert datetime.fromisoformat(rows[0]['end_time'])==datetime(2026,11,23,11,10,0,100000,tzinfo=UTC)
assert datetime.fromisoformat(rows[1]['start_time'])==datetime(2026,11,23,11,15,0,300000,tzinfo=UTC)
assert [row['timer_segment_id'] for row in rows]==[part['segment_id'] for part in s['request']['preview']['after']]
"""
    )
    for _ in range(2):
        run(script, env)


@pytest.mark.parametrize("crash", ["pre_db", "post_db"])
def test_saved_fixed_intent_guards_and_independent_edits_across_processes(tmp_path, crash):
    source = tmp_path / "source"
    source.mkdir()
    env = environment(source)
    seed = (
        SETUP
        + """
task=c.post('/api/tasks',json={'title':'Synthetic task'}).json()
plan=c.post('/scheduled-sessions',json={'task_id':task['id'],'start_time':'2026-11-23T10:00:00Z',
    'end_time':'2026-11-23T12:00:00Z'}).json()
w=c.post('/recorded-work',json={'task_id':task['id'],'scheduled_session_id':plan['id'],
    'expected_plan_revision':plan['revision'],'start_time':'2026-11-23T11:00:00Z',
    'end_time':'2026-11-23T11:30:00Z','notes':'keep'}).json()
assert c.post('/timers/correction-initialize',json={'operation_id':'init'}).status_code==200
path='/recorded-work/'+w['id']
from timetrace.db.models import AIDraftBatch,AIDraftItem,Session as Work
with Session(engine) as db:
    batch=AIDraftBatch(summary='Synthetic independent draft',item_count=1)
    db.add(batch);db.flush()
    draft=AIDraftItem(batch_id=batch.id,entity_type='session',op='update',target_id=w['id'],
        baseline_json=db.get(Work,w['id']).model_dump_json(),proposed_json='{"notes":"proposal"}')
    db.add(draft);db.commit()
    batch_id,draft_id=batch.id,draft.id
e=c.post(path+'/correction-preview',json={'target':{'kind':'saved','work_id':w['id'],'expected_revision':w['revision']},
    'change':{'kind':'exclude','start_utc':'2026-11-23T11:10:00Z','end_utc':'2026-11-23T11:15:00Z',
    'timezone':'UTC','start_local_datetime':'2026-11-23T11:10:00','end_local_datetime':'2026-11-23T11:15:00',
    'start_offset_seconds':0,'end_offset_seconds':0}})
assert e.status_code==200,e.text
payload={'operation_id':'correct','preview':e.json()}
definition=c.post('/rating-definitions',json={'name':'Quality'}).json()
saved={'path':path,'work':w,'task':task,'plan':c.get('/scheduled-sessions/'+plan['id']).json(),
       'definition':definition,'payload':payload,'batch_id':batch_id,'draft_id':draft_id}
Path(os.environ['TIMETRACE_DB_FILE']+'.request').write_text(json.dumps(saved))
"""
    )
    if crash == "pre_db":
        fault = """
from timetrace.core.timer_store import TimerStore
write=TimerStore.write
def die(self,state):
    write(self,state)
    if state.get('pending_operation',{}).get('id')=='correct': os._exit(77)
TimerStore.write=die
"""
    else:
        fault = """
replace=os.replace
calls=0
def die(src,dst):
    global calls
    if str(dst)==os.environ['TIMETRACE_TIMER_STATE_FILE']:
        calls+=1
        if calls==2: os._exit(77)
    return replace(src,dst)
os.replace=die
"""
    run(seed + fault + "c.post(path+'/correction',json=payload)\n", env, 77)
    copied = tmp_path / "copy"
    shutil.copytree(source, copied)  # The crashed source writer is dead before consistent DB/file/key copy.
    env = environment(copied)
    competing = (
        SETUP
        + """
from timetrace.core.timer_store import TimerStore
from timetrace.core.exceptions import ConflictError
from timetrace.services.task_service import TaskService
s=json.loads(Path(os.environ['TIMETRACE_DB_FILE']+'.request').read_text())
mode=os.environ['CRASH_MODE']
# Holding advisory lock proves these DB-only guards do not take it in reverse order.
with TimerStore(Path(os.environ['TIMETRACE_TIMER_STATE_FILE'])).locked():
    note=c.patch(s['path']+'/note',json={'expected_revision':s['work']['revision']+(mode=='post_db'),
        'notes':'legal after DB' if mode=='post_db' else 'must refuse'})
    if mode=='pre_db':
        assert note.status_code==409,note.text
        assert note.json()['code']=='correction_pending'
        with Session(engine) as db:
            lock_sqlite_writer(db)
            try:
                TaskService(db).stage_task_deletion([s['task']['id']],{s['task']['id']})
            except ConflictError as exc:
                assert exc.code=='correction_pending'
                db.rollback()
            else: raise AssertionError('Task detachment bypassed pending guard')
        extension=c.post('/scheduled-sessions/'+s['plan']['id']+'/extend',json={
            'operation_id':'extension','end_time':'2026-11-23T13:00:00Z','expected_revision':s['plan']['revision']})
        assert extension.status_code==409,extension.text
        assert extension.json()['code']=='correction_pending'
        p=c.get('/scheduled-sessions/'+s['plan']['id']+'/removal-preview').json()
        removal=c.post('/scheduled-sessions/'+s['plan']['id']+'/removal',json={
            'operation_id':'remove','action':'delete_everything','consent_token':p['consent_token']})
        assert removal.status_code==409,removal.text
        assert removal.json()['code']=='correction_pending'
    else: assert note.status_code==200,note.text
    rating=c.post('/rating-entries',json={'rating_definition_id':s['definition']['id'],
        'target_type':'session','target_id':s['work']['id'],'score':8})
    assert rating.status_code==201,rating.text
    definition=c.put('/rating-definitions/'+s['definition']['id'],json={'name':'Independent edit'})
    assert definition.status_code==200,definition.text
    rejected=c.post('/api/ai/drafts/batches/'+s['batch_id']+'/reject',json={'item_ids':[s['draft_id']],'reason':'Independent'})
    assert rejected.status_code==200,rejected.text
    reviewed=c.post('/revision/day-review',json={'date_str':'2026-11-23',
        'review_skipped':True,'notes':'Independent day review'})
    assert reviewed.status_code==200,reviewed.text
    reviewed=c.post('/api/task-reviews',json={'task_id':s['task']['id'],'what_went_well':'Independent task review'})
    assert reviewed.status_code==201,reviewed.text
"""
    )
    run(competing, {**env, "CRASH_MODE": crash})
    recover = (
        SETUP
        + """
s=json.loads(Path(os.environ['TIMETRACE_DB_FILE']+'.request').read_text())
r=c.post(s['path']+'/correction',json=s['payload'])
assert r.status_code==200,r.text
assert c.post(s['path']+'/correction',json=s['payload']).json()==r.json()
ids=r.json()['correction']['changed_work_ids']+r.json()['correction']['created_work_ids']
assert ids==[s['work']['id'],s['payload']['preview']['plan']['after'][1]['segment_id']]
rows=[c.get('/recorded-work/'+i).json() for i in ids]
assert [(w['start_time'][11:19],w['end_time'][11:19]) for w in rows]==[('11:00:00','11:10:00'),('11:15:00','11:30:00')]
assert rows[0]['notes']==('legal after DB' if os.environ['CRASH_MODE']=='post_db' else 'keep')
assert rows[1]['notes']=='keep'
assert c.get('/scheduled-sessions/'+s['plan']['id']).json()==s['plan']
ratings=c.get('/rating-entries',params={'target_type':'session','target_id':s['work']['id']}).json()
assert len(ratings)==1 and ratings[0]['score']==8
assert c.get('/rating-entries',params={'target_type':'session','target_id':ids[1]}).json()==[]
assert any(d['name']=='Independent edit' for d in c.get('/rating-definitions').json())
assert c.get('/operations/correct').json()['status']=='finalized'
assert c.get('/api/ai/drafts/batches/'+s['batch_id']).json()['status']=='rejected'
day=c.get('/revision/day-summary',params={'date_str':'2026-11-23'}).json()
assert day['day_review']['notes']=='Independent day review'
assert c.get('/api/task-reviews/'+s['task']['id']).json()['what_went_well']=='Independent task review'
"""
    )
    for _ in range(2):
        run(recover, {**env, "CRASH_MODE": crash})
