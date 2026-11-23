"""Additive correction identities/evidence and installation signing material.

No interval edits live here. Legacy evidence deliberately grants no inferred
extension except for a provably plain uninterrupted open interval.
"""

import os
import secrets
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid7

from timetrace.core.exceptions import ConflictError


def evidence(lower_bound, provenance):
    return {"version": 1, "lower_bound": lower_bound, "provenance": provenance, "forbidden_ranges": []}


def initialize_identities(timer):
    try:
        start = timer["running_start"]
        if (timer["state"] == "running") != bool(start):
            raise ValueError("Invalid open interval")
        if start:
            datetime.fromisoformat(start)
        ids = [s["id"] for s in timer["segments"]]
        if len(set(ids)) != len(ids) or any(not isinstance(i, str) or not i for i in ids):
            raise ValueError("Invalid segment identity")
        if "running_segment_id" in timer:
            identity = timer["running_segment_id"]
            if not start or not isinstance(identity, str) or not identity or identity in ids:
                raise ValueError("Invalid running identity")
        for segment in timer["segments"]:
            if datetime.fromisoformat(segment["start_time"]) >= datetime.fromisoformat(segment["end_time"]):
                raise ValueError("Invalid closed interval")
        for item in [timer.get("running_evidence"), *[s.get("correction_evidence") for s in timer["segments"]]]:
            if item is None:
                continue
            if (
                not isinstance(item, dict)
                or set(item) != {"version", "lower_bound", "provenance", "forbidden_ranges"}
                or item["version"] != 1
                or item["provenance"]
                not in {"uninterrupted", "legacy_unknown", "resume", "context_split", "idle_claim"}
                or item["forbidden_ranges"] != []
            ):
                raise ValueError("Unknown correction evidence")
            if item["lower_bound"] is not None:
                datetime.fromisoformat(item["lower_bound"])
    except (ValueError, TypeError, KeyError) as exc:
        raise ConflictError(
            "Correction identity/evidence is corrupt; preserve it for recovery.", code="reconciliation_required"
        ) from exc
    for segment in timer["segments"]:
        segment.setdefault("correction_evidence", evidence(segment["start_time"], "legacy_unknown"))
    if timer["running_start"]:
        timer.setdefault("running_segment_id", str(uuid7()))
        plain = not timer["segments"] and not timer["idle_gaps"] and not timer.get("legacy_payload")
        timer.setdefault(
            "running_evidence",
            evidence(None if plain else timer["running_start"], "uninterrupted" if plain else "legacy_unknown"),
        )


def signing_key(path: Path, *, create=False):
    """Create only under explicit serialized initialization, never expose bytes.

    Link a fully fsynced owner-only temporary file without replacing an existing
    installation key. A crash may leave a key before the timer intent; retry uses
    that same key, and no cross-file atomicity is claimed.
    """
    if not path.exists() and create:
        temporary = None
        try:
            with NamedTemporaryFile(dir=path.parent, delete=False) as stream:
                temporary = Path(stream.name)
                os.chmod(temporary, 0o600)
                stream.write(secrets.token_bytes(32))
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                pass
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    if (
        not path.is_file()
        or path.is_symlink()
        or len(path.read_bytes()) != 32
        or (os.name != "nt" and path.stat().st_mode & 0o077)
    ):
        raise ConflictError("Correction signing material requires explicit recovery.", code="reconciliation_required")
