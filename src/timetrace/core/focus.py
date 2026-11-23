"""Correction-independent focus policy and period snapshots (no persistence or IO)."""

from copy import deepcopy
from datetime import datetime

from timetrace.core.exceptions import ConflictError, TimerError

DEFAULTS = {
    "revision": 0,
    "enabled": False,
    "work_minutes": 25,
    "break_minutes": 5,
    "behavior": "notify_only",
    "sound_enabled": False,
}


def validate_policy(policy):
    for name in ("enabled", "sound_enabled"):
        if type(policy.get(name)) is not bool:
            raise TimerError(f"{name} must be boolean.")
    for name in ("work_minutes", "break_minutes"):
        if type(policy.get(name)) is not int or not 1 <= policy[name] <= 1440:
            raise TimerError(f"{name} must be whole minutes from 1 to 1440.")
    if policy.get("behavior") not in ("notify_only", "automatic_break"):
        raise TimerError("Choose notify_only or automatic_break.")


def update_defaults(state, payload):
    current = state.get("focus_defaults", DEFAULTS)
    if payload["expected_revision"] != current["revision"]:
        raise ConflictError("Focus defaults changed.", code="revision_stale")
    policy = {key: payload[key] for key in DEFAULTS if key != "revision"}
    validate_policy(policy)
    state["focus_defaults"] = {**policy, "revision": current["revision"] + 1}


def elapsed(focus, cutoff):
    seconds = focus["active_seconds"]
    if focus.get("recording_anchor"):
        seconds += max(
            0, (datetime.fromisoformat(cutoff) - datetime.fromisoformat(focus["recording_anchor"])).total_seconds()
        )
    return seconds


def checkpoint(timer, cutoff):
    focus = timer.get("focus")
    if focus and focus["phase"] in ("work", "work_due"):
        focus["active_seconds"] = elapsed(focus, cutoff)
        focus["recording_anchor"] = cutoff if timer["state"] == "running" else None


def display(timer, cutoff):
    focus = timer.get("focus")
    if not focus:
        return
    if focus["phase"] in ("work_due", "break_due"):
        focus["remaining_seconds"] = 0
    elif focus["phase"] == "work":
        focus["remaining_seconds"] = max(0, focus["period"]["work_minutes"] * 60 - elapsed(focus, cutoff))
    elif focus["phase"] in ("break", "break_due"):
        focus["remaining_seconds"] = max(
            0, (datetime.fromisoformat(focus["break_deadline"]) - datetime.fromisoformat(cutoff)).total_seconds()
        )
    else:
        focus["remaining_seconds"] = None


def configure(timer, payload, cutoff):
    policy = {key: payload[key] for key in ("enabled", "work_minutes", "break_minutes", "behavior")}
    validate_policy({**policy, "sound_enabled": False})
    old = timer.get("focus")
    if old is None or old["phase"] == "disabled":
        timer["focus"] = new_focus(policy, cutoff)
        timer["focus"]["generation"] = old["generation"] + 1 if old else 1
        if timer["state"] != "running":
            timer["focus"]["recording_anchor"] = None
    else:
        old["settings"] = policy
        if not policy["enabled"]:
            old["phase"] = "disabled"
            old["generation"] += 1
            old["recording_anchor"] = None


def new_focus(policy, cutoff):
    policy = deepcopy(policy)
    return {
        "settings": policy,
        "period": deepcopy(policy),
        "generation": 1,
        "phase": "work" if policy["enabled"] else "disabled",
        "active_seconds": 0,
        "recording_anchor": cutoff if policy["enabled"] else None,
    }
