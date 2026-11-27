import contextlib
import json
import socket
import sys
import time
from pathlib import Path

import uvicorn

import timetrace.main as main

source = Path(main.__file__).resolve()
assert source.is_relative_to(Path(__file__).resolve().parent / "src"), source
profile = sys.argv[2] == "1"
profiles = {}
if profile:
    from sqlalchemy import event

    from timetrace.core.timer_store import TimerStore
    from timetrace.db.session import engine
    from timetrace.services import multiple_timer_service

    class MeasuredProcessLock:
        def __init__(self, lock):
            self.lock = lock

        def __enter__(self):
            t = time.perf_counter_ns()
            result = self.lock.__enter__()
            profiles.setdefault("timer_process_lock_wait_ns", []).append(time.perf_counter_ns() - t)
            return result

        def __exit__(self, *args):
            return self.lock.__exit__(*args)

    multiple_timer_service._writes = MeasuredProcessLock(multiple_timer_service._writes)

    original_write = TimerStore.write

    def measured_write(self, state):
        t = time.perf_counter_ns()
        try:
            return original_write(self, state)
        finally:
            profiles.setdefault("timer_json_write_ns", []).append(time.perf_counter_ns() - t)

    TimerStore.write = measured_write

    original_commit = engine.dialect.do_commit

    def measured_commit(conn):
        t = time.perf_counter_ns()
        try:
            return original_commit(conn)
        except Exception:
            profiles.setdefault("db_commit_error_ns", []).append(time.perf_counter_ns() - t)
            raise
        finally:
            profiles.setdefault("db_commit_ns", []).append(time.perf_counter_ns() - t)

    engine.dialect.do_commit = measured_commit

    original = TimerStore.locked

    @contextlib.contextmanager
    def measured_lock(self):
        t = time.perf_counter_ns()
        with original(self):
            profiles.setdefault("timer_file_lock_access_ns", []).append(time.perf_counter_ns() - t)
            yield

    TimerStore.locked = measured_lock

    @event.listens_for(engine, "before_cursor_execute")
    def before(conn, cursor, statement, parameters, context, executemany):
        if statement == "UPDATE task SET id = id WHERE 0":
            context._bench_clock = time.perf_counter_ns()
            context._bench_label = "sqlite_writer_reservation_ns"
        elif "WITH " in statement[:15].upper():
            context._bench_clock = time.perf_counter_ns()
            context._bench_label = "sqlite_cte_execute_ns"

    @event.listens_for(engine, "after_cursor_execute")
    def after(conn, cursor, statement, parameters, context, executemany):
        if hasattr(context, "_bench_clock"):
            profiles.setdefault(context._bench_label, []).append(time.perf_counter_ns() - context._bench_clock)

    @event.listens_for(engine, "handle_error")
    def failed(context):
        call = context.execution_context
        if call is not None and hasattr(call, "_bench_clock"):
            profiles.setdefault(call._bench_label + "_error", []).append(time.perf_counter_ns() - call._bench_clock)


try:
    if profile:
        import signal

        # Uvicorn re-raises the captured signal after shutdown. Let this isolated
        # wrapper record the in-memory measurements after the server returns.
        signal.signal(signal.SIGTERM, lambda *_: None)
    listener = socket.socket(fileno=int(sys.argv[1]))
    uvicorn.Server(uvicorn.Config(main.daemon_app, access_log=False, log_level="warning", lifespan="on")).run(
        sockets=[listener]
    )
finally:
    if profile:
        Path("db-profile.json").write_text(json.dumps(profiles))
