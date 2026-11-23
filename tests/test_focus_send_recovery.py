"""A fake external effect survives crash; unknown claims never blast again."""

import pytest
from test_timer_focus_recovery import SEED, SETUP, run


@pytest.mark.parametrize("after_send", [False, True])
def test_crash_at_external_send_boundary_keeps_unknown_claim_without_resend(tmp_path, after_send):
    run(tmp_path, SETUP + SEED)
    runtime = """
from pathlib import Path
from timetrace.services.focus_runtime import FocusRuntime
counter=Path(os.environ['TIMETRACE_DB_FILE']+'.fake-sends')
class Fake:
 def capability(self): return {'available':True}
 def send(self,event,*,sound):
  if AFTER_SEND or not CRASH:
   counter.write_text(str(int(counter.read_text())+1 if counter.exists() else 1))
  if CRASH: os._exit(77)
  return 'accepted'
with Session(engine) as db:
 t=c.get('/timers').json()['timers'][0]
 at=datetime.fromisoformat(t['identity_started_at'])+timedelta(seconds=61)
FocusRuntime(engine,Fake(),evaluator_factory=lambda db:FocusEvaluator(db,wall_clock=lambda:at)).tick()
assert c.get('/timer-notifications').json()['notices'][0]['status']=='unknown'
print(counter.read_text() if counter.exists() else '0')
"""
    run(tmp_path, SETUP + runtime.replace("AFTER_SEND", str(after_send)).replace("CRASH", "True"), expected=77)
    expected = "1" if after_send else "0"
    for _ in range(2):
        result = run(tmp_path, SETUP + runtime.replace("AFTER_SEND", str(after_send)).replace("CRASH", "False"))
        assert result.splitlines()[-1] == expected
