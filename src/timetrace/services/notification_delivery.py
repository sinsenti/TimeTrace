"""Bounded Linux session-bus submission. Acceptance is not human visibility."""

import ast
import json
import os
import re
import shutil
import subprocess
import sys


class LinuxNotifications:
    def __init__(self, *, transport=None, environment=None, platform=None, executable=None, enabled=True):
        self.transport = transport or subprocess.run
        self.environment = dict(os.environ if environment is None else environment)
        self.platform = platform or sys.platform
        self.executable = executable or shutil.which("gdbus")
        self.enabled = enabled
        self.cached = None

    def call(self, method, *arguments):
        return self.transport(
            [
                self.executable,
                "call",
                "--session",
                "--dest",
                "org.freedesktop.Notifications",
                "--object-path",
                "/org/freedesktop/Notifications",
                "--method",
                "org.freedesktop.Notifications." + method,
                *arguments,
            ],
            capture_output=True,
            text=True,
            timeout=2,
            env=self.environment,
            shell=False,
        )

    def capability(self):
        if self.cached is not None:
            return self.cached
        reason = None
        if not self.enabled:
            reason = "Native delivery disabled; in-app fallback."
        elif hasattr(os, "geteuid") and os.geteuid() == 0:
            reason = "Root/system desktop delivery is not supported; in-app fallback."
        elif self.platform != "linux":
            reason = "Native adapter supports Linux interactive sessions only."
        elif self.environment.get("WSL_DISTRO_NAME") or self.environment.get("SSH_CONNECTION"):
            reason = "WSL/SSH desktop delivery is not supported."
        elif (
            not self.executable
            or not self.environment.get("DBUS_SESSION_BUS_ADDRESS")
            or not (self.environment.get("DISPLAY") or self.environment.get("WAYLAND_DISPLAY"))
        ):
            reason = "No interactive desktop bus or gdbus binary; in-app fallback."
        caps = []
        if reason is None:
            try:
                response = self.call("GetCapabilities")
                if response.returncode:
                    reason = "Desktop notification service unavailable."
                else:
                    parsed = ast.literal_eval(response.stdout)
                    caps = parsed[0]
                    if not isinstance(caps, list) or not all(isinstance(c, str) for c in caps):
                        raise ValueError()
            except OSError, subprocess.TimeoutExpired, ValueError, SyntaxError, IndexError, TypeError:
                reason = "Desktop capability probe failed or timed out."
        self.cached = {
            "available": reason is None,
            "channel": "native" if reason is None else "in_app",
            "reason": reason or "Linux session-bus submission available; acceptance does not mean seen.",
            "sound_supported": "sound" in caps,
            "limitations": (
                "Requires running daemon and desktop session; "
                "sleep/stopped daemon cannot guarantee exact-time delivery."
            ),
        }
        return self.cached

    def send(self, event, *, sound=False):
        if not self.capability()["available"]:
            return "failed"
        labels = {
            "work_due": "Focus period complete",
            "break_due": "Break complete — resume explicitly",
            "two_hour": "Timer has been unfinished for two hours",
        }
        hint = (
            "{'suppress-sound': <false>}"
            if sound and self.capability()["sound_supported"]
            else "{'suppress-sound': <true>}"
        )
        try:
            result = self.call(
                "Notify",
                json.dumps("TimeTrace"),
                "0",
                json.dumps(""),
                json.dumps(labels[event["kind"]]),
                json.dumps("Timer " + event["timer_id"][-8:] + ". Review TimeTrace for actions."),
                "[]",
                hint,
                "-1",
            )
            if result.returncode:
                return "failed"
            return "accepted" if re.fullmatch(r"\(uint32 [1-9][0-9]*,\)\s*", result.stdout) else "unknown"
        except subprocess.TimeoutExpired:
            return "unknown"
        except OSError:
            return "failed"
