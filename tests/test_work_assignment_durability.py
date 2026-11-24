"""Actual process exits and independent writers through public assignment/root HTTP seams."""

import json

import pytest
from test_saved_correction_recovery import environment, run

CORE = """
import json,os
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session
from timetrace.db.session import init_db,engine
from timetrace.main import create_daemon_app
c=TestClient(create_daemon_app())
fixture_path=Path(os.environ['TIMETRACE_DB_FILE']+'.assignment.json')
"""
SEED = (
    CORE
    + """
init_db()
parent=c.post('/api/tasks',json={'title':'Parent #inherited'}).json()
existing=(c.post('/api/tasks',json={'title':'Destination','parent_id':parent['id']}).json()
          if os.environ['DEST']=='existing' else None)
w=c.post('/recorded-work',json={'start_time':'2000-01-04T10:00:00Z','end_time':'2000-01-04T11:00:00Z',
    'notes':'retained metadata','tags':'source-only'}).json()
from timetrace.db.models import Session as Work
with Session(engine) as db:
 row=db.get(Work,w['id']);row.review_skipped=True;row.timezone='America/New_York'
 row.external_sync_id='synthetic-external';row.external_provider='fixture';row.extended_properties_json='{"retained":true}'
 row.duration_seconds=123
 db.add(row);db.commit()
w=c.get('/recorded-work/'+w['id']).json()
definition=c.post('/rating-definitions',json={'name':'Independent score'}).json()
rating=c.post('/rating-entries',json={'rating_definition_id':definition['id'],'target_type':'session','target_id':w['id'],'score':4}).json()
destination=({'kind':'existing','task_id':existing['id']} if existing else
    {'kind':'new','task_draft':{'title':'Created [45m]','parent_id':parent['id']}})
request={'operation_id':'assignment-crash','works':[{'id':w['id'],'expected_revision':w['revision']}],'destination':destination}
fixture_path.write_text(json.dumps({'before':w,'parent':parent,'existing':existing,'definition':definition,'rating':rating,'request':request}))
"""
)
CRASH = (
    CORE
    + """
init_db()
s=json.loads(fixture_path.read_text())
phase=os.environ['PHASE']
real_replace=os.replace
calls=0
def replace(src,dst):
 global calls
 if str(dst)==os.environ['TIMETRACE_TIMER_STATE_FILE']:
  calls+=1
  if phase=='intent' and calls==1:
   real_replace(src,dst);os._exit(77)
  if phase=='db_commit' and calls==2: os._exit(77)
  if phase=='file_install' and calls==2:
   real_replace(src,dst);os._exit(77)
 return real_replace(src,dst)
os.replace=replace
if phase=='finalized':
 real_commit=Session.commit
 commits=0
 def commit(db):
  global commits
  real_commit(db);commits+=1
  if commits==2: os._exit(77)
 Session.commit=commit
c.post('/recorded-work/assignment',json=s['request'])
raise AssertionError('process did not exit at the injected system boundary')
"""
)
COMPETE = (
    CORE
    + """
# Deliberately no startup/reconcile: this is another writer before recovery.
s=json.loads(fixture_path.read_text());w=s['before'];pre=os.environ['PHASE']=='intent'
note=c.patch('/recorded-work/'+w['id']+'/note',json={
    'expected_revision':w['revision']+(0 if pre else 1),'notes':'later independent note'})
assert note.status_code==(409 if pre else 200),note.text
if pre:
 task_id=s['existing']['id'] if s['existing'] else s['parent']['id']
 changed=c.put('/api/tasks/'+task_id,json={'title':'must refuse pending dependency change'})
 assert changed.status_code==409,changed.text
 deleted=c.delete('/api/tasks/'+task_id)
 assert deleted.status_code==409,deleted.text
# Ratings and definitions are independent rows; they remain legal even before DB recovery.
r=c.post('/rating-entries',json={'rating_definition_id':s['definition']['id'],'target_type':'session','target_id':w['id'],'score':9})
assert r.status_code==201,r.text
r=c.put('/rating-definitions/'+s['definition']['id'],json={'description':'independent after acceptance'})
assert r.status_code==200,r.text
"""
)
RECOVER = (
    CORE
    + """
with TestClient(create_daemon_app()) as started:
 assert started.get('/health').status_code==200
s=json.loads(fixture_path.read_text());w=s['before']
r=c.post('/recorded-work/assignment',json=s['request'])
assert r.status_code==200,r.text
receipt=r.json();assert c.get('/operations/assignment-crash').json()['status']=='finalized'
assert c.post('/recorded-work/assignment',json=s['request']).json()==receipt
row=c.get('/recorded-work/'+w['id']).json()
assert row['id']==w['id'] and row['task_id']==receipt['task_id']
assert row['revision']==w['revision']+(1 if os.environ['PHASE']=='intent' else 2)
for field,value in w.items():
 if field not in ('task_id','revision','notes'): assert row[field]==value,(field,row[field],value)
assert row['notes']==('retained metadata' if os.environ['PHASE']=='intent' else 'later independent note')
tasks=c.get('/api/tasks').json();assert len(tasks)==2,tasks
created=next(t for t in tasks if t['id']==receipt['task_id'])
if os.environ['DEST']=='new':
 assert created['title']=='Created' and created['estimated_minutes']==45 and created['tags']=='#inherited',created
entries=c.get('/rating-entries',params={'target_type':'session','target_id':w['id']}).json()
assert len(entries)==1 and entries[0]['id']==s['rating']['id'] and entries[0]['score']==9,entries
query={'source':'recorded_work','measure':'summed_recorded_work','date_range':{'preset':'custom','start_date':'2000-01-04','end_date':'2000-01-04'}}
assert c.post('/analytics/query',json={'query':query,'timezone':'UTC'}).json()['total']==1
for identity in [receipt['task_id'],s['parent']['id']]:
 goal=c.post('/goals',json={'operation_id':'goal-'+identity,'owner_kind':'task','task_id':identity,'cadence':'total','target_seconds':3600,'include_descendants':True})
 assert goal.status_code==201,goal.text
assert [g['summed_recorded_work_seconds'] for g in c.get('/goals').json()['goals']]==[3600,3600]
print(json.dumps(receipt))
"""
)


@pytest.mark.parametrize("destination", ["existing", "new"])
@pytest.mark.parametrize("phase", ["intent", "db_commit", "file_install", "finalized"])
def test_process_crash_assignment_fixed_intent_and_competing_writer_matrix(tmp_path, destination, phase):
    env = environment(tmp_path)
    env.update(DEST=destination, PHASE=phase, TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED="false")
    run(SEED, env)
    run(CRASH, env, expected=77)
    run(COMPETE, env)
    first = json.loads(run(RECOVER, env).splitlines()[-1])
    # The second recovery is read/replay-only: preserve current notes and original receipt IDs.
    replay = (
        CORE
        + """
with TestClient(create_daemon_app()) as started: assert started.get('/health').status_code==200
s=json.loads(fixture_path.read_text())
r=c.post('/recorded-work/assignment',json=s['request']);assert r.status_code==200,r.text
print(json.dumps(r.json()))
"""
    )
    assert json.loads(run(replay, env).splitlines()[-1]) == first


@pytest.mark.parametrize("scope", ["all_future", "all", "following"])
def test_series_writers_cannot_strand_an_accepted_assignment(tmp_path, scope):
    env = environment(tmp_path)
    env.update(PHASE="intent", SCOPE=scope, TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED="false")
    run(
        CORE
        + """
init_db()
series={'is_recurring':True,'recurrence_rule':'daily','recurrence_dtstart':'2099-01-04T09:00:00Z',
        'recurrence_duration_minutes':60,'recurrence_timezone':'UTC'}
for title in ('Destination','Independent'):
 c.post('/api/tasks',json={**series,'title':title}).raise_for_status()
plans=c.get('/agenda',params={'start':'2099-01-04T00:00:00Z','end':'2099-01-05T00:00:00Z'}).json()['items']
assert len(plans)==2,plans
tasks={t['title']:t['id'] for t in c.get('/api/tasks').json()}
w=c.post('/recorded-work',json={'start_time':'2000-01-04T10:00:00Z','end_time':'2000-01-04T11:00:00Z'}).json()
r={'operation_id':'series-assignment','works':[{'id':w['id'],'expected_revision':w['revision']}],
   'destination':{'kind':'existing','task_id':tasks['Destination']}}
fixture_path.write_text(json.dumps({'request':r,'plans':plans,'tasks':tasks,'work':c.get('/recorded-work/'+w['id']).json()}))
""",
        env,
    )
    run(CRASH, env, expected=77)
    run(
        CORE
        + """
from timetrace.core.timer_store import TimerStore
s=json.loads(fixture_path.read_text());scope=os.environ['SCOPE']
def mutate(plan):
 if scope=='all_future':
  return c.put('/scheduled-sessions/'+plan['id'],params={'scope':scope},json={
      'expected_projection_revision':plan['projection_revision'],'start_time':plan['start_time'],
      'end_time':'2099-01-04T11:00:00Z'})
 return c.delete('/sessions/'+plan['id'],params={'scope':scope})
plans={p['task_id']:p for p in s['plans']}
# The TestClient handles HTTP on another thread. If it tries to acquire the timer lock
# while holding SQLite, it cannot finish before the existing subprocess timeout.
with TimerStore(Path(os.environ['TIMETRACE_TIMER_STATE_FILE'])).locked():
 for name in ('Independent','Destination'):
  task=s['tasks'][name]
  response=mutate(plans[task]);print(response.status_code,response.text)
  if name=='Independent':
   assert response.status_code==(200 if scope=='all_future' else 204),response.text
   c.put('/api/tasks/'+task,json={'title':'Independent renamed'}).raise_for_status()
  else:
   assert response.status_code==409,(response.status_code,response.text)
   assert response.json()['code']=='assignment_pending',response.text
   saved=c.get('/api/tasks/'+task).json()
   assert saved['is_recurring'] and saved['recurrence_duration_minutes']==60,saved
""",
        env,
    )
    run(
        CORE
        + """
s=json.loads(fixture_path.read_text());r=s['request'];before=s['work']
first=c.post('/recorded-work/assignment',json=r);first.raise_for_status()
assert c.get('/operations/series-assignment').json()['status']=='finalized'
with TestClient(create_daemon_app()) as started:
 assert started.post('/recorded-work/assignment',json=r).json()==first.json()
work=c.get('/recorded-work/'+before['id']).json()
assert work=={**before,'task_id':s['tasks']['Destination'],'revision':before['revision']+1},work
""",
        env,
    )
