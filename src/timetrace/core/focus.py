"""Correction-independent focus policy and period snapshots (no persistence or IO)."""

from copy import deepcopy

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
