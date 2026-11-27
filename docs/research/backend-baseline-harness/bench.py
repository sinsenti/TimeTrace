"""Synthetic loopback sessions only; start and stop the private daemon per trial."""

import argparse
import asyncio
import collections
import contextlib
import json
import math
import os
import random
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import httpx

ROOT = Path(__file__).resolve().parent
PID_HZ = os.sysconf("SC_CLK_TCK")


def request(client, method, path, **kwargs):
    res = client.request(method, path, **kwargs)
    if not res.is_success:
        raise AssertionError((method, path, res.status_code, res.text[:1000]))
    return res.json()


@contextlib.contextmanager
def daemon(state, profile=False):
    state.mkdir(exist_ok=True, mode=0o700)
    for folder in ("home", "tmp"):
        (state / folder).mkdir(exist_ok=True, mode=0o700)
    db = state / "fixture.sqlite"
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    port = listener.getsockname()[1]
    env = {
        "PATH": os.defpath,
        "HOME": str(state / "home"),
        "TMPDIR": str(state / "tmp"),
        "TZ": "UTC",
        "PYTHONPATH": str(ROOT / "src" / "src"),
        "PYTHONDONTWRITEBYTECODE": "1",
        "TIMETRACE_DB_FILE": str(db),
        "TIMETRACE_HOST": "127.0.0.1",
        "TIMETRACE_PORT": str(port),
        "TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED": "false",
        "TIMETRACE_IDLE_DETECTION_ENABLED": "false",
        "TIMETRACE_SQL_WIDGETS_ENABLED": "false",
    }
    cmd = [
        "/usr/bin/taskset",
        "-c",
        os.environ.get("BENCH_SERVER_CPUS", "2"),
        sys.executable,
        "-P",
        str(ROOT / "serve.py"),
        str(listener.fileno()),
        str(int(profile)),
    ]
    start = time.perf_counter()
    with (state / "daemon.log").open("ab") as log:
        proc = subprocess.Popen(cmd, cwd=state, env=env, pass_fds=(listener.fileno(),), stdout=log, stderr=log)
        listener.close()
        url = f"http://127.0.0.1:{port}"
        try:
            with httpx.Client(base_url=url, trust_env=False, timeout=1) as client:
                for _ in range(300):
                    if proc.poll() is not None:
                        raise RuntimeError((proc.returncode, (state / "daemon.log").read_text()[-5000:]))
                    try:
                        health = request(client, "GET", "/health")
                        assert health["db_file"] == str(db) and health["port"] == port, health
                        break
                    except httpx.TransportError:
                        time.sleep(0.05)
                else:
                    raise RuntimeError("scratch daemon health timeout")
            yield url, proc.pid, time.perf_counter() - start
        finally:
            proc.terminate()
            shutdown = "terminated"
            try:
                proc.wait(timeout=16)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)
                shutdown = "forced_termination_after_shutdown_timeout"
            (state / "shutdown-status.txt").write_text(f"{shutdown}:{proc.returncode}")
            if shutdown == "terminated" and proc.returncode not in (0, -15, 143):
                raise RuntimeError((proc.returncode, (state / "daemon.log").read_text()[-5000:]))


def sql_dt(dt):
    return dt.replace(tzinfo=None).isoformat(sep=" ", timespec="microseconds")


def seed(size, suffix):
    state = ROOT / f"seed-{suffix}"
    assert not state.exists()
    anchor = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    with daemon(state) as (url, _, _), httpx.Client(base_url=url, trust_env=False, timeout=8) as client:
        tasks = [
            request(
                client,
                "POST",
                "/api/tasks",
                json={"title": f"Synthetic benchmark activity {i}", "tags": f"#lane{i % 6} #scope{i % 3}"},
            )["id"]
            for i in range(32)
        ]
        for i in range(6):
            request(
                client,
                "POST",
                "/api/tasks",
                json={
                    "title": f"Synthetic recurring activity {i}",
                    "is_recurring": True,
                    "recurrence_rrule": "FREQ=WEEKLY;BYDAY=MO,WE,FR",
                    "recurrence_dtstart": (anchor - timedelta(days=90) + timedelta(hours=9 + i)).isoformat(),
                    "recurrence_duration_minutes": 45,
                    "recurrence_timezone": "America/New_York",
                },
            )
        for i in range(72):
            start = anchor + timedelta(days=(i % 60) - 30, hours=8 + i % 10)
            request(
                client,
                "POST",
                "/scheduled-sessions",
                json={
                    "task_id": tasks[i % 32],
                    "start_time": start.isoformat(),
                    "end_time": (start + timedelta(minutes=40)).isoformat(),
                    "notes": "Synthetic plan",
                },
            )
    rand = random.Random(67381)
    age_days = 365 if size == 10000 else 3650
    db = state / "fixture.sqlite"
    with sqlite3.connect(db) as c:
        c.execute("PRAGMA foreign_keys=on")

        def rows():
            for i in range(size):
                age = rand.randint(1, 30) if i < min(size // 6, 2800) else rand.randint(1, age_days)
                start = (
                    anchor
                    - timedelta(days=age)
                    + timedelta(
                        hours=rand.randrange(7, 22), minutes=rand.randrange(60), microseconds=rand.randrange(1_000_000)
                    )
                )
                length = rand.randint(8, 90) * 60
                yield (
                    str(UUID(int=i + 16384)),
                    None if i % 19 == 0 else tasks[i % 32],
                    sql_dt(start),
                    sql_dt(start + timedelta(seconds=length)),
                    length,
                    f"#lane{i % 6} #synthetic",
                    "Synthetic work",
                    0,
                    "UTC",
                    "{}",
                    "recorded_work",
                    "manual",
                    1,
                )

        c.executemany(
            """INSERT INTO session (id,task_id,start_time,end_time,duration_seconds,tags,notes,
            review_skipped,timezone,extended_properties_json,kind,provenance,revision)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows(),
        )
        c.commit()
        assert c.execute("PRAGMA foreign_key_check").fetchall() == []
        settings = {
            k: c.execute(f"PRAGMA {k}").fetchone()[0]
            for k in ("journal_mode", "synchronous", "page_size", "page_count")
        }
    (state / "fixture.json").write_text(
        json.dumps(
            {
                "tasks": tasks,
                "anchor": anchor.isoformat(),
                "size": size,
                "settings": settings,
                "bytes": db.stat().st_size,
            },
            indent=2,
        )
    )
    print("seeded", suffix, size, settings, db.stat().st_size, flush=True)


def quantiles(numbers):
    ordered = sorted(numbers)
    n = len(ordered)
    return (
        {
            "n": n,
            **{
                k: round(ordered[max(0, math.ceil(n * f) - 1)], 3)
                for k, f in [("p50", 0.5), ("p95", 0.95), ("p99", 0.99), ("max", 1)]
            },
        }
        if n
        else {"n": 0}
    )


def process_metrics(pid):
    path = Path(f"/proc/{pid}")
    fields = (path / "stat").read_text().split(") ", 1)[1].split()
    rss = int(next(line.split()[1] for line in (path / "status").read_text().splitlines() if line.startswith("VmRSS:")))
    io = dict(line.split(": ", 1) for line in (path / "io").read_text().splitlines())
    return (int(fields[11]) + int(fields[12])) / PID_HZ, rss, int(io["write_bytes"])


def reads(fixture, lane):
    end = datetime.fromisoformat(fixture["anchor"])
    days = 30 if lane in ("wide", "burst", "wide-reads", "wide-paced") else 1
    from_day = end - timedelta(days=days)
    report_from = end - timedelta(days=365 if days == 30 else 30)
    agenda = f"/agenda?start={from_day:%Y-%m-%d}T00%3A00%3A00Z&end={end + timedelta(days=1):%Y-%m-%d}T00%3A00%3A00Z"
    report = {
        "query": {
            "source": "recorded_work",
            "measure": "elapsed_recorded_time",
            "group_by": ["week"],
            "date_range": {"preset": "custom", "start_date": str(report_from.date()), "end_date": str(end.date())},
        }
    }
    return agenda, report


async def load(url, pid, fixture, lane, seconds):
    metrics = collections.defaultdict(list)
    bytes_by = collections.defaultdict(list)
    errors = []
    ledger = {}
    queued = collections.Counter()
    drops = collections.Counter()
    agenda, report = reads(fixture, lane)
    rates = {
        "control": {"direct": 2, "reviewed": 2},
        "mixed": {"direct": 1, "reviewed": 1, "agenda": 1, "report": 1, "timers": 2},
        "wide": {"direct": 2, "reviewed": 2, "agenda": 4, "report": 3, "timers": 2},
        "wide-reads": {"agenda": 4, "report": 3},
        "wide-paced": {"direct": 1, "reviewed": 1, "agenda": 1, "report": 1, "timers": 2},
        "burst": {"direct": 5, "reviewed": 5, "agenda": 4, "report": 3, "timers": 2},
    }[lane]
    free = asyncio.Queue()
    for task in fixture["tasks"]:
        free.put_nowait(task)
    active = set()
    cpus = []
    async with httpx.AsyncClient(
        base_url=url, trust_env=False, timeout=18, limits=httpx.Limits(max_connections=64, max_keepalive_connections=32)
    ) as client:

        async def call(name, method, path, body=None, record=True):
            start = time.perf_counter()
            resp = await client.request(method, path, json=body)
            ms = (time.perf_counter() - start) * 1000
            if not resp.is_success:
                raise AssertionError((name, resp.status_code, resp.text[:450]))
            if record:
                metrics[name].append(ms)
                bytes_by[name].append(len(resp.content))
            return resp.json()

        async def step(route, record=True):
            if route == "agenda":
                ans = await call("agenda", "GET", agenda, record=record)
                assert ans["items"]
            elif route == "report":
                ans = await call("report", "POST", "/analytics/query", report, record)
                assert ans["rows"] and ans["total"] > 0
            elif route == "timers":
                await call("read_timers", "GET", "/timers", record=record)
            else:
                if free.empty():
                    drops[f"{route}_no_task"] += 1
                    return
                task = free.get_nowait()
                try:
                    timer = (
                        await call(
                            "start",
                            "POST",
                            "/timers",
                            {"operation_id": uuid4().hex, "task_id": task, "pause_when_idle": False},
                            record,
                        )
                    )["timer"]
                    timer_id = timer["id"]
                    prefix = f"/timers/{timer_id}"
                    await asyncio.sleep(0.025)
                    started = time.perf_counter()
                    operation_id = uuid4().hex
                    if route == "direct":
                        result = await call(
                            "stop_direct",
                            "POST",
                            prefix + "/stop",
                            {"operation_id": operation_id, "expected_revision": timer["revision"]},
                            record,
                        )
                    else:
                        review = (
                            await call(
                                "stop_review",
                                "POST",
                                prefix + "/stop-review",
                                {"operation_id": uuid4().hex, "expected_revision": timer["revision"]},
                                record,
                            )
                        )["timer"]
                        choice = {"review_id": review["stop_review"]["id"], "expected_revision": review["revision"]}
                        preview = await call("stop_preview", "POST", prefix + "/stop-preview", choice, record)
                        result = await call(
                            "stop_commit",
                            "POST",
                            prefix + "/stop-commit",
                            dict(
                                choice,
                                operation_id=operation_id,
                                policy="actual",
                                consent_token=preview["consent_token"],
                            ),
                            record,
                        )
                        if record:
                            metrics["reviewed_stop_end_to_end"].append((time.perf_counter() - started) * 1000)
                    if "recorded_work_ids" in result:
                        items = result["recorded_work_ids"]
                    else:
                        items = result["session_ids"]
                    assert len(items) == 1, result
                    assert operation_id not in ledger
                    ledger[operation_id] = items[0]
                finally:
                    free.put_nowait(task)

        await step("agenda", False)
        await step("report", False)
        await step("direct", False)
        await step("reviewed", False)
        warm_ops = len(ledger)

        async def monitor():
            while True:
                cpus.append(process_metrics(pid))
                await asyncio.sleep(0.2)

        watcher = asyncio.create_task(monitor())

        async def scheduled(route, due):
            try:
                metrics["driver_schedule_delay"].append(max(0.0, (time.perf_counter() - due) * 1000))
                await step(route)
            except Exception as exc:
                errors.append((route, type(exc).__name__, str(exc)[:800]))

        start = time.perf_counter()
        schedule = sorted(
            (i / rate + index * 0.013, route)
            for index, (route, rate) in enumerate(rates.items())
            for i in range(rate * seconds)
        )
        for offset, route in schedule:
            due = start + offset
            await asyncio.sleep(max(0, due - time.perf_counter()))
            if len(active) >= 64:
                drops[f"{route}_inflight_cap"] += 1
                continue
            queued[route] += 1
            t = asyncio.create_task(scheduled(route, due))
            active.add(t)
            t.add_done_callback(active.discard)
        if active:
            await asyncio.gather(*active)
        elapsed = time.perf_counter() - start
        cpus.append(process_metrics(pid))
        watcher.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await watcher
        try:
            remains = await asyncio.wait_for(call("verify_timers", "GET", "/timers", record=False), timeout=3)
        except Exception as exc:
            remains = None
            errors.append(("verify_timers", type(exc).__name__, str(exc)[:800]))
    return {
        "elapsed": elapsed,
        "rates": rates,
        "queued": dict(queued),
        "dropped": dict(drops),
        "errors": errors,
        "metrics": dict(metrics),
        "bytes_by": dict(bytes_by),
        "cpu_s": cpus[-1][0] - cpus[0][0],
        "peak_rss_kib": max(p[1] for p in cpus),
        "write_bytes": cpus[-1][2] - cpus[0][2],
        "ledger": ledger,
        "warm_ops": warm_ops,
        "timers_left": remains,
    }


def trial(fixture_name, name, lane, seconds, profile, wal):
    fixture_dir = ROOT / f"seed-{fixture_name}"
    fixture = json.loads((fixture_dir / "fixture.json").read_text())
    state = ROOT / name
    state.mkdir(mode=0o700)
    shutil.copy2(fixture_dir / "fixture.sqlite", state / "fixture.sqlite")
    with sqlite3.connect(state / "fixture.sqlite") as c:
        if wal:
            assert c.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
        mode = c.execute("PRAGMA journal_mode").fetchone()[0]
        verified_sync = c.execute("PRAGMA synchronous").fetchone()[0]
    with daemon(state, profile) as (url, pid, ready):
        result = asyncio.run(load(url, pid, fixture, lane, seconds))
    with sqlite3.connect(state / "fixture.sqlite") as c:
        saved = dict(c.execute("SELECT timer_operation_id,id FROM session WHERE provenance='timer'"))
        count_after = c.execute("SELECT count(*) FROM session").fetchone()[0]
    verified = result["ledger"] == saved and count_after == fixture["size"] + len(saved)
    result["ledger_exact_match"] = verified
    result["armed_shutdown"] = (state / "shutdown-status.txt").read_text()
    result["unobserved_accepted_count"] = len(set(saved) - set(result["ledger"]))
    result["missing_acknowledged_count"] = len(set(result["ledger"]) - set(saved))
    result.update(
        fixture=fixture,
        lane=lane,
        seconds=seconds,
        journal_mode=mode,
        synchronous_default=verified_sync,
        server_cpu_affinity=os.environ.get("BENCH_SERVER_CPUS", "2"),
        readiness_seconds=ready,
        verified_rows=len(saved),
    )
    (state / "measurements.json").write_text(json.dumps(result))
    summary = {k: v for k, v in result.items() if k not in ("metrics", "bytes_by", "ledger", "fixture", "timers_left")}
    summary["unfinished_count"] = len(result["timers_left"]["timers"]) if result["timers_left"] is not None else None
    summary["lat_ms"] = {k: quantiles(v) for k, v in sorted(result["metrics"].items())}
    summary["body_bytes"] = {k: round(sum(v) / len(v)) for k, v in result["bytes_by"].items()}
    print(name, json.dumps(summary), flush=True)
    assert verified and not result["errors"] and not result["dropped"]
    assert result["timers_left"] is not None and not result["timers_left"]["timers"], result["timers_left"]


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("seed")
    s.add_argument("size", type=int)
    s.add_argument("name")
    t = sub.add_parser("trial")
    t.add_argument("seed")
    t.add_argument("name")
    t.add_argument("lane", choices=["control", "mixed", "wide", "burst", "wide-reads", "wide-paced"])
    t.add_argument("seconds", type=int)
    t.add_argument("--profile", action="store_true")
    t.add_argument("--wal", action="store_true")
    args = parser.parse_args()
    if args.command == "seed":
        seed(args.size, args.name)
    else:
        trial(args.seed, args.name, args.lane, args.seconds, args.profile, args.wal)


if __name__ == "__main__":
    main()
