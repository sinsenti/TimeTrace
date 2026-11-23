"""Pure elapsed-start steps and authenticated canonical approval content."""

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

from timetrace.core.exceptions import TimerError


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def fingerprint(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def signature(envelope, key):
    return hmac.new(key, canonical({k: v for k, v in envelope.items() if k != "signature"}), hashlib.sha256).hexdigest()


def step_start(start, end, delta, boundary):
    """Keep actual elapsed arithmetic and conservative immutable evidence separate."""
    try:
        start, end = datetime.fromisoformat(start), datetime.fromisoformat(end)
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("Invalid work interval")
        if type(delta) is not int or delta not in (-300, 300):
            raise ValueError("Choose an elapsed five-minute step")
        if (
            not isinstance(boundary, dict)
            or set(boundary) != {"version", "lower_bound", "provenance", "forbidden_ranges"}
            or type(boundary["version"]) is not int
            or boundary["version"] != 1
            or boundary["provenance"]
            not in {"uninterrupted", "legacy_unknown", "resume", "context_split", "idle_claim"}
            or not isinstance(boundary["forbidden_ranges"], list)
            or (boundary["lower_bound"] is None and boundary["provenance"] != "uninterrupted")
        ):
            raise ValueError("Initialize valid correction evidence first")
        proposed = start - timedelta(seconds=delta)
        if proposed >= end:
            raise ValueError("Correction must retain positive work; cannot remove the whole interval")
        floor = boundary["lower_bound"]
        if floor is not None and proposed < datetime.fromisoformat(floor):
            raise ValueError("Correction crosses a known or conservative context boundary")
        for gap in boundary["forbidden_ranges"]:
            if proposed < datetime.fromisoformat(gap["end_utc"]) and end > datetime.fromisoformat(gap["start_utc"]):
                raise ValueError("Correction would restore excluded work")
        return proposed.astimezone(UTC).isoformat(), int((end - proposed).total_seconds())
    except (ValueError, TypeError, KeyError) as exc:
        raise TimerError(str(exc)) from exc
