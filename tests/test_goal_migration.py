"""Normal 0019 -> 0020 upgrade of consistently copied synthetic rich state."""

import shutil
from pathlib import Path

import pytest
from test_saved_correction_migration import OLD_SETUP, UPGRADE
from test_saved_correction_recovery import environment, run


def test_goal_history_context_and_receipts_are_append_only_in_a_real_migrated_database(tmp_path):
    env = environment(tmp_path)
    env["TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED"] = "false"
    script = """
import os,sqlite3
from fastapi.testclient import TestClient
from timetrace.main import create_daemon_app
with TestClient(create_daemon_app()) as c:
 r=c.post('/goals',json={'operation_id':'append-only-goal','owner_kind':'global','cadence':'day','target_seconds':3600})
 assert r.status_code==201,r.text
with sqlite3.connect(os.environ['TIMETRACE_DB_FILE']) as db:
 for table,field in [('goal_settings_version','id'),('goal_reporting_context','id'),
                     ('goal_settings_receipt','operation_id')]:
  for statement in ['UPDATE '+table+' SET '+field+'='+field,'DELETE FROM '+table]:
   try: db.execute(statement)
   except sqlite3.IntegrityError: db.rollback()
   else: raise AssertionError('History/receipt was mutable: '+statement)
 for target in (0,-1,float('inf')):
  try:
   db.execute('''INSERT INTO goal_settings_version
    (id,goal_id,revision,effective_period_start,context_revision,target_seconds,enabled,
     include_descendants,timezone,first_day_of_week,start_date)
    SELECT 'invalid-version',goal_id,revision+1,effective_period_start,context_revision,?,enabled,
     include_descendants,timezone,first_day_of_week,start_date FROM goal_settings_version''',(target,))
  except sqlite3.IntegrityError: db.rollback()
  else: raise AssertionError('Invalid persisted target was accepted')
 assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
"""
    run(script, env)


@pytest.mark.parametrize("old_phase", ["pre_db", "post_db"])
def test_copied_0019_db_stopped_timer_and_old_receipt_preserve_all_content_twice(tmp_path, old_phase):
    source = tmp_path / "source"
    source.mkdir()
    env = environment(source)
    env["OLD_PHASE"] = old_phase
    env["OLD_STEP_FIXTURE"] = str(Path(__file__).parent / "fixtures" / "timer_step_v1_7a3a37e.json")
    seed = OLD_SETUP.replace("command.upgrade(cfg,'0017_timer_receipts')", "command.upgrade(cfg,'0019_timer_focus')")
    seed = seed.replace(
        "    db.commit()\n    result=semantic(db)",
        """
    from timetrace.db.models import WorkCorrection, TimerNotification
    db.add(WorkCorrection(operation_id='synthetic-past-correction', source_identity='/recorded-work/'+manual.id,
        source_work_id=manual.id, source_revision=1, before_json=manual.model_dump_json(),
        results_json=json.dumps([{'work_id':manual.id,'rating_source_work_id':manual.id}]),
        cutoff='2026-11-22T12:00:00+00:00', action='synthetic-retained-history'))
    db.add(TimerNotification(id='synthetic-cancelled-notice',timer_id=timer_id,kind='two_hour',generation=0,
        due_at='2026-11-22T16:00:00+00:00',status='cancelled',channel='in_app',acknowledged=True))
    db.commit()
    result=semantic(db)""",
    )
    run(seed, env)
    target = tmp_path / "copy"
    shutil.copytree(source, target)  # Source process has exited before any file is copied.
    copied = environment(target)
    verify = UPGRADE.replace(
        "    assert c.get('/health').status_code==200",
        """
    assert c.get('/health').status_code==200
    assert c.get('/goals').json()=={'goals':[]}
    assert c.get('/goals?include_disabled=true').json()=={'goals':[]}""",
    )
    for _ in range(2):
        run(verify, copied)
