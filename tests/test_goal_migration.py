"""Normal 0019 -> 0020 upgrade of consistently copied synthetic rich state."""

import shutil
from pathlib import Path

import pytest
from test_saved_correction_migration import OLD_SETUP, UPGRADE
from test_saved_correction_recovery import environment, run


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
