"""Isolation and launch helpers for real-process durability tests."""

import os
import subprocess
import sys
from pathlib import Path


def environment(tmp_path: Path) -> dict[str, str]:
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


def run(script: str, env: dict[str, str], expected: int = 0) -> str:
    """Run one fresh interpreter; startup, migration, and recovery belong to the script."""
    process = subprocess.run([sys.executable, "-P", "-c", script], env=env, capture_output=True, text=True, timeout=45)
    assert process.returncode == expected, (
        f"Child exit {process.returncode}, expected {expected}\nstdout:\n{process.stdout}\nstderr:\n{process.stderr}"
    )
    return process.stdout
