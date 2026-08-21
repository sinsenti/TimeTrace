"""Helpers for presenting UUIDv7 primary keys to humans.

Primary keys throughout the codebase are 36-char UUIDv7 strings (see the
"UUIDv7 migration" note in CLAUDE.md). That's the right storage/API
representation, but it's unusable in a terminal table or a Markdown export.

We use a SUFFIX of the id, not a prefix. UUIDv7 packs a 48-bit millisecond
timestamp into its leading bits, so any batch of rows minted close together in
time — a bulk migration, a bulk import, or just several tasks typed in one
sitting — shares an identical leading prefix no matter how many characters you
show. This is not theoretical: every row in this project's own database was
minted in one fast migration run, and a leading-8-hex-char prefix collides
across every single session, habit, and habitlog row, and across most tasks.
The trailing bits are the high-entropy random tail (RFC 9562 rand_b), so a
short suffix stays unique in practice even for rows created in the same
millisecond. The cost is that a short id no longer sorts chronologically —
nothing here depends on that.

This module is pure string manipulation with no FastAPI/DB dependency, so it
lives in `core/` (per CLAUDE.md's layering) and is imported by both the
service layer (`services/analytics_service.py`, for Markdown exports) and the
CLI (`interfaces/cli/commands.py` and `interfaces/cli/client.py`, for the task
table and suffix-based id resolution). Display only ever shortens an id for
output — every id sent back to the API must stay the full UUID.
"""

SHORT_ID_LEN = 8


def short_id(full_id: str) -> str:
    """Return a short, practically-unique suffix of a UUIDv7 id for display."""
    if not full_id:
        return full_id
    return full_id[-SHORT_ID_LEN:]
