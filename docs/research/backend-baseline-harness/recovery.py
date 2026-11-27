"""A response-loss proxy for the synthetic loopback daemon only."""

import asyncio
import json
import shutil
import sqlite3
import time
from uuid import uuid4

import httpx
from bench import ROOT, daemon, quantiles


async def exercises(url, task):
    results = {}
    timings = {key: [] for key in ("accepted_first", "receipt_lookup_after_loss", "exact_retry")}
    async with httpx.AsyncClient(base_url=url, trust_env=False, timeout=10) as client:

        async def post(path, body):
            res = await client.post(path, json=body)
            assert res.is_success, (res.status_code, res.text)
            return res.json()

        other = (await post("/timers", {"operation_id": uuid4().hex, "pause_when_idle": False}))["timer"]
        for i in range(12):
            timer = (await post("/timers", {"operation_id": uuid4().hex, "task_id": task, "pause_when_idle": False}))[
                "timer"
            ]
            tid = timer["id"]
            operation = uuid4().hex
            route = f"/timers/{tid}/stop"
            body = {"expected_revision": timer["revision"], "operation_id": operation}
            if i % 2:
                route = f"/timers/{tid}/stop-commit"
                rev = (
                    await post(
                        f"/timers/{tid}/stop-review",
                        {"operation_id": uuid4().hex, "expected_revision": timer["revision"]},
                    )
                )["timer"]
                choice = {"review_id": rev["stop_review"]["id"], "expected_revision": rev["revision"]}
                preview = await post(f"/timers/{tid}/stop-preview", choice)
                body = dict(choice, operation_id=operation, policy="actual", consent_token=preview["consent_token"])
            future = asyncio.get_running_loop().create_future()

            async def drop(reader, writer, *, route=route, body=body, future=future):
                try:
                    header = (await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 3)).decode("ascii")
                    assert header.startswith(f"POST {route} HTTP/1.1\r\n")
                    length = int(
                        next(
                            line.split(":", 1)[1]
                            for line in header.split("\r\n")
                            if line.lower().startswith("content-length:")
                        )
                    )
                    received = json.loads(await reader.readexactly(length))
                    assert received == body
                    start = time.perf_counter()
                    result = await post(route, received)
                    timings["accepted_first"].append(1000 * (time.perf_counter() - start))
                    future.set_result(result)
                    # Close the offered client connection without sending status or body.
                except Exception as e:
                    if not future.done():
                        future.set_exception(e)
                finally:
                    writer.close()
                    await writer.wait_closed()

            listener = await asyncio.start_server(drop, "127.0.0.1", 0)
            async with listener:
                port = listener.sockets[0].getsockname()[1]
                async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=12) as lossy:
                    try:
                        await lossy.post(route, json=body)
                    except httpx.RemoteProtocolError:
                        pass
                    else:
                        raise AssertionError("proxy leaked response")
                upstream = await asyncio.wait_for(future, 5)
            start = time.perf_counter()
            res = await client.get(f"/operations/{operation}")
            timings["receipt_lookup_after_loss"].append(1000 * (time.perf_counter() - start))
            assert res.status_code == 200 and res.json()["status"] == "finalized" and res.json()["result"] == upstream
            start = time.perf_counter()
            assert await post(route, body) == upstream
            timings["exact_retry"].append(1000 * (time.perf_counter() - start))
            invalid = dict(body, new_notes="changed synthetic intent") if not i % 2 else dict(body, policy="fit")
            assert (await client.post(route, json=invalid)).status_code == 409
            ids = upstream.get("recorded_work_ids", upstream.get("session_ids"))
            assert len(ids) == 1
            results[operation] = {"work_id": ids[0], "result": upstream}
        still_active = (await client.get(f"/timers/{other['id']}")).json()
        assert still_active["state"] == "running"
    return results, timings, other["id"]


def main():
    import sys

    mode = sys.argv[1]
    assert mode in ("wal", "delete")
    state = ROOT / f"recovery-{mode}"
    state.mkdir(mode=0o700)
    fixture = ROOT / "seed-small"
    db = state / "fixture.sqlite"
    shutil.copy2(fixture / "fixture.sqlite", db)
    with sqlite3.connect(db) as c:
        if mode == "wal":
            assert c.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
    task = json.loads((fixture / "fixture.json").read_text())["tasks"][0]
    with daemon(state) as (url, _, _):
        results, stats, other = asyncio.run(exercises(url, task))
    with daemon(state) as (url, _, _), httpx.Client(base_url=url, trust_env=False, timeout=8) as client:
        for operation, evidence in results.items():
            receipt = client.get(f"/operations/{operation}").json()
            assert receipt["status"] == "finalized" and receipt["result"] == evidence["result"]
            work = client.get(f"/recorded-work/{evidence['work_id']}")
            assert work.status_code == 200
        assert client.get(f"/timers/{other}").json()["state"] == "running"
    with sqlite3.connect(db) as c:
        grouped = c.execute("SELECT timer_operation_id, id FROM session WHERE provenance='timer'").fetchall()
        assert len(grouped) == 12 and dict(grouped) == {oid: x["work_id"] for oid, x in results.items()}
        assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    out = {
        "mode": mode,
        "durable_receipts_equal_after_restart": len(results),
        "work_rows": len(grouped),
        "independent_timer_survived": True,
        "fault": "upstream response fully discarded before reaching caller; graceful daemon restart afterwards",
        "timings_ms": {k: quantiles(v) for k, v in stats.items()},
    }
    (state / "recovery.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
