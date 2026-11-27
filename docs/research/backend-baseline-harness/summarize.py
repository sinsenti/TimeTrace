"""Aggregate synthetic run evidence without copying payloads, IDs or timer state."""

import json
import math
import sys
from pathlib import Path


def q(values):
    values = sorted(values)
    n = len(values)
    return (
        {
            "n": n,
            **{
                k: round(values[math.ceil(n * p) - 1], 3)
                for k, p in [("p50", 0.5), ("p95", 0.95), ("p99", 0.99), ("max", 1)]
            },
        }
        if n
        else {"n": 0}
    )


def summary(root):
    result = {}
    for path in sorted(root.glob("*/measurements.json")):
        r = json.loads(path.read_text())
        room = path.parent
        p = room / "db-profile.json"
        rsc = r["elapsed"]
        values = {k: q(v) for k, v in r["metrics"].items()}
        profile = {k: q([n / 1e6 for n in a]) for k, a in json.loads(p.read_text()).items()} if p.exists() else None
        guesses = {
            k: 0 for k in ("database is locked", "pool timeout", "reconciliation_required", "client wait timeout")
        }
        for _route, kind, description in r["errors"]:
            if "database is locked" in description:
                guesses["database is locked"] += 1
            if "reconciliation_required" in description:
                guesses["reconciliation_required"] += 1
            if "Timeout" in kind:
                guesses["client wait timeout"] += 1
        log = (room / "daemon.log").read_text()
        guesses["daemon Locked SQLAlchemy exceptions"] = log.count(
            "sqlalchemy.exc.OperationalError: (sqlite3.OperationalError) database is locked"
        )
        guesses["daemon pool timeout exceptions"] = log.count("sqlalchemy.exc.TimeoutError: QueuePool limit")
        result[room.name] = {
            "lane": r["lane"],
            "journal": r.get("journal_mode", "delete"),
            "affinity": r.get("server_cpu_affinity", "2"),
            "fixture_rows": r["fixture"]["size"],
            "offer_seconds": r["seconds"],
            "actual_wall_s": round(rsc, 3),
            "requests_scheduled": r["queued"],
            "errors": len(r["errors"]),
            "drops": r["dropped"],
            "error_breakdown": guesses,
            "CPU_core_pct": round(100 * r["cpu_s"] / rsc, 1),
            "peak_RSS_MiB": round(r["peak_rss_kib"] / 1024, 1),
            "process_write_MiB": round(r["write_bytes"] / 2**20, 1),
            "measured_rows": r["verified_rows"] - r["warm_ops"],
            "ledger_exact_match": r.get("ledger_exact_match", True),
            "missing_acknowledged_count": r.get("missing_acknowledged_count", 0),
            "unobserved_accepted_count": r.get("unobserved_accepted_count", 0),
            "timers_left": len(r["timers_left"]["timers"]) if r["timers_left"] is not None else None,
            "shutdown": r.get("armed_shutdown", "regular"),
            "request_latency_ms": values,
            "avg_payload_bytes": {k: round(sum(v) / len(v)) for k, v in r["bytes_by"].items()},
            "profile_ms": profile,
        }
    return {"trials": result, "recovery": [json.loads(p.read_text()) for p in sorted(root.glob("*/recovery.json"))]}


if __name__ == "__main__":
    print(json.dumps(summary(Path(sys.argv[1])), indent=2, sort_keys=True))
