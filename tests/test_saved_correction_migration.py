"""Real Alembic/lifespan startup on fresh and consistently copied synthetic old data."""

import shutil
from pathlib import Path

import pytest
from process_test_support import environment, run

OLD_SETUP = """
import json,os,sqlite3
from pathlib import Path
from datetime import datetime
from uuid import uuid7
from alembic import command
from alembic.config import Config
from sqlmodel import Session
from timetrace.config import settings
from timetrace.db.session import engine
from timetrace.db.models import (Task,Session as Work,ScheduledSession,TaskReview,DayReview,RatingDefinition,
    RatingEntry,RecurrenceException,AIDraftBatch,AIDraftItem,AIAudit,Dashboard,DashboardWidget,MutationOperation)
from timetrace.core.query_spec import AnalyticsQuery,QuerySource,Measure,DateRange,RangePreset
from timetrace.interfaces.api.schemas import QueryContextRequest,StructuredWidgetSpec
from timetrace.services.query_service import QueryService
cfg=Config('alembic.ini')
command.upgrade(cfg,'0017_timer_receipts')
query=AnalyticsQuery(source=QuerySource.SESSIONS,measure=Measure.SUM_DURATION,
    date_range=DateRange(preset=RangePreset.CUSTOM,start_date='2026-11-22',end_date='2026-11-23'))
def semantic(db):
    result=QueryService(db).run(query,QueryContextRequest(timezone='UTC')).model_dump(mode='json')
    result['meta'].pop('elapsed_ms',None)
    result['meta'].pop('measurement_at',None)
    return result
with Session(engine) as db:
    task=Task(title='Synthetic recurring fixture',is_recurring=True,recurrence_rrule='FREQ=DAILY',
        recurrence_dtstart=datetime(2026,11,24,10),recurrence_duration_minutes=30,recurrence_timezone='UTC')
    db.add(task);db.flush()
    plan=ScheduledSession(task_id=task.id,original_start=datetime(2026,11,22,10),original_end=datetime(2026,11,22,12),
        start_time=datetime(2026,11,22,10),end_time=datetime(2026,11,22,12),notes='original plan')
    db.add(plan);db.flush()
    timer_id,segment_id,op_id=(str(uuid7()) for _ in range(3))
    manual=Work(kind='recorded_work',provenance='manual',task_id=task.id,scheduled_session_id=plan.id,
        start_time=datetime(2026,11,22,11),end_time=datetime(2026,11,22,11,30),duration_seconds=1800,
        notes='manual metadata',review_skipped=True,extended_properties_json='{"synthetic":true}')
    timer=Work(kind='recorded_work',provenance='timer',task_id=task.id,timer_id=timer_id,
        timer_operation_id=op_id,timer_segment_id=segment_id,start_time=datetime(2026,11,22,14),
        end_time=datetime(2026,11,22,14,30),duration_seconds=1800,notes='timer fixture')
    legacy=Work(task_id=task.id,start_time=datetime(2026,11,22,8),end_time=datetime(2026,11,22,8,10),
        duration_seconds=600,notes='legacy uncertain stays uncertain')
    taskless=Work(kind='recorded_work',provenance='manual',start_time=datetime(2026,11,22,9),
        end_time=datetime(2026,11,22,9,10),duration_seconds=600,notes='unassigned')
    db.add_all([manual,timer,legacy,taskless]);db.flush()
    definition=RatingDefinition(name='Synthetic score')
    db.add(definition);db.flush()
    db.add_all([RatingEntry(rating_definition_id=definition.id,target_type='session',target_id=manual.id,score=7),
        RatingEntry(rating_definition_id=definition.id,target_type='session',target_id=timer.id,dismissed=True,score=None),
        TaskReview(task_id=task.id,what_went_well='keep task review'),
        DayReview(date_str='2026-11-22',notes='keep dated review',review_skipped=True),
        RecurrenceException(task_id=task.id,occurrence_start=datetime(2026,11,25,10),kind='skip')])
    batch=AIDraftBatch(summary='Synthetic proposal',item_count=1)
    db.add(batch);db.flush()
    item=AIDraftItem(batch_id=batch.id,op='update',entity_type='session',target_id=manual.id,
        baseline_json=manual.model_dump_json(),proposed_json='{"notes":"proposal only"}')
    dashboard=Dashboard(name='Synthetic dashboard',slug='synthetic')
    db.add_all([item,dashboard]);db.flush()
    db.add_all([AIAudit(batch_id=batch.id,item_id=item.id,transition='proposed',entity_type='session',entity_id=manual.id),
        DashboardWidget(dashboard_id=dashboard.id,title='Stored query',
            spec_json=StructuredWidgetSpec(query=query).model_dump_json())])
    golden=json.loads(Path(os.environ['OLD_STEP_FIXTURE']).read_text())
    receipt=golden['receipt']
    after=json.loads(receipt['after_state_json'])
    stopped={'id':timer_id,'state':'stopped','revision':2,'task_id':task.id,'task_title':task.title,
        'scheduled_session_id':None,'tags':'','notes':'timer fixture','mode':'flowtime','target_minutes':None,
        'pause_when_idle':False,'running_start':None,'idle_gaps':[],
        'segments':[{'id':segment_id,'start_time':'2026-11-22T14:00:00+00:00','end_time':'2026-11-22T14:30:00+00:00',
        'recorded_work_id':timer.id,'task_id':task.id,'scheduled_session_id':None,'tags':'','notes':'timer fixture'}]}
    after['timers'][timer_id]=stopped
    receipt['after_state_json']=json.dumps(after)
    receipt['file_finalized']=False
    if os.environ['OLD_PHASE']=='post_db':
        db.add(MutationOperation.model_validate(receipt))
    db.commit()
    result=semantic(db)
    intent={k:v for k,v in receipt.items() if k!='file_finalized'}
    intent['work']=[]
    before=json.loads(receipt['after_state_json'])
    before['revision']=receipt['before_revision']
    original_timer_id=golden['request']['preview']['resource'].removeprefix('/timers/')
    before['timers'][original_timer_id]['running_start']=golden['request']['preview']['before']['start_utc']
    before['timers'][original_timer_id]['revision']-=1
    before['pending_operation']=intent
    Path(os.environ['TIMETRACE_TIMER_STATE_FILE']).write_text(json.dumps(before))
    expected={'manual_id':manual.id,'timer_id':timer.id,'stopped_timer_id':timer_id,'segment_id':segment_id,
        'dashboard_id':dashboard.id,'query':query.model_dump(mode='json'),'result':result,
        'expected_old_after_state_json':receipt['after_state_json'],'old_hash':receipt['payload_hash'],
        'old_request':golden['request'],'old_path':golden['path'],'old_result':json.loads(receipt['result_json'])}
with sqlite3.connect(os.environ['TIMETRACE_DB_FILE']) as connection:
    tables=[r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        if r[0] not in ('mutation_operation','alembic_version')]
    expected['tables']={t:sorted([[{'blob':v.hex()} if isinstance(v,bytes) else v for v in row]
        for row in connection.execute('SELECT * FROM "'+t+'"')],key=lambda row:json.dumps(row)) for t in tables}
    assert connection.execute('PRAGMA foreign_key_check').fetchall()==[]
Path(os.environ['TIMETRACE_DB_FILE']+'.expected').write_text(json.dumps(expected))
"""

UPGRADE = """
import json,os,sqlite3
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session
from timetrace.main import create_daemon_app
from timetrace.db.session import engine
from timetrace.core.query_spec import AnalyticsQuery
from timetrace.interfaces.api.schemas import QueryContextRequest
from timetrace.services.query_service import QueryService
expected=json.loads(Path(os.environ['TIMETRACE_DB_FILE']+'.expected').read_text())
with TestClient(create_daemon_app()) as c:
    assert c.get('/health').status_code==200
    assert c.get('/operations/historical-correction').json()['status']=='finalized'
    replay=c.post(expected['old_path']+'/correction',json=expected['old_request'])
    assert replay.status_code==200,replay.text
    assert replay.json()==expected['old_result']
    with sqlite3.connect(os.environ['TIMETRACE_DB_FILE']) as db:
        assert db.execute('SELECT version_num FROM alembic_version').fetchone()[0]=='0020_personal_goals'
        stored=db.execute("SELECT payload_hash,after_state_json FROM mutation_operation "
            "WHERE id='historical-correction'").fetchone()
        assert stored==(expected['old_hash'],expected['expected_old_after_state_json'])
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
        for table,rows in expected['tables'].items():
            actual=sorted([[{'blob':v.hex()} if isinstance(v,bytes) else v for v in row]
                for row in db.execute('SELECT * FROM "'+table+'"')],key=lambda row:json.dumps(row))
            assert actual==rows,table
    with Session(engine) as db:
        result=QueryService(db).run(AnalyticsQuery.model_validate(expected['query']),QueryContextRequest(timezone='UTC')).model_dump(mode='json')
        result['meta'].pop('elapsed_ms',None)
        result['meta'].pop('measurement_at',None)
        assert result==expected['result']
    state=json.loads(Path(os.environ['TIMETRACE_TIMER_STATE_FILE']).read_text())
    assert state==json.loads(expected['expected_old_after_state_json'])
    assert c.get('/recorded-work/'+expected['manual_id']).json()['kind']=='recorded_work'
    assert c.get('/api/dashboards/'+expected['dashboard_id']).status_code==200
"""


@pytest.mark.parametrize("old_phase", ["pre_db", "post_db"])
def test_consistent_copied_old_db_timer_upgrade_and_repeated_full_startup(tmp_path, old_phase):
    source = tmp_path / "source"
    source.mkdir()
    env = environment(source)
    env["OLD_PHASE"] = old_phase
    env["OLD_STEP_FIXTURE"] = str(Path(__file__).parent / "fixtures" / "timer_step_v1_7a3a37e.json")
    run(OLD_SETUP, env)
    target = tmp_path / "copy"
    shutil.copytree(source, target)  # All source writers have exited: DB and timer copy are consistent.
    copied = environment(target)
    for _ in range(2):
        run(UPGRADE, copied)


def test_fresh_full_startup_and_append_only_history_and_receipt_downgrade_guard(tmp_path):
    env = environment(tmp_path)
    script = """
import os,sqlite3
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app
from alembic import command
from alembic.config import Config
with TestClient(create_daemon_app()) as c:
    assert c.get('/health').status_code==200
    w=c.post('/recorded-work',json={'start_time':'2026-11-22T11:00:00Z',
        'end_time':'2026-11-22T11:30:00Z'}).json()
    assert c.post('/timers/correction-initialize',json={'operation_id':'init'}).status_code==200
    path='/recorded-work/'+w['id']
    e=c.post(path+'/correction-preview',json={'target':{'kind':'saved','work_id':w['id'],'expected_revision':1},
        'change':{'kind':'step_start','credited_delta_seconds':-300}})
    assert e.status_code==200,e.text
    r=c.post(path+'/correction',json={'operation_id':'correct','preview':e.json()})
    assert r.status_code==200,r.text
with sqlite3.connect(os.environ['TIMETRACE_DB_FILE']) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
    for statement in ('UPDATE work_correction SET action=action','DELETE FROM work_correction'):
        try: db.execute(statement)
        except sqlite3.IntegrityError: db.rollback()
        else: raise AssertionError('History is not append-only')
try: command.downgrade(Config('alembic.ini'),'0017_timer_receipts')
except RuntimeError as exc: assert 'history' in str(exc).lower()
else: raise AssertionError('Downgrade discarded recovery history')
with TestClient(create_daemon_app()) as c:
    assert c.get('/operations/correct').json()['status']=='finalized'
    assert c.get(path).json()['start_time'].startswith('2026-11-22T11:05:00')
"""
    run(script, env)
