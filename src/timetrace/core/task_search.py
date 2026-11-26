"""Deterministic title matching shared with the bounded launcher SQL query."""


def title_match_rank(title: str | None, query: str) -> int:
    title = (title or "").casefold()
    query = query.strip().casefold()
    if not query or title == query:
        return 0
    if title.startswith(query):
        return 1
    if query in title:
        return 2
    if 3 <= len(query) <= 64:
        allowed = 1 if len(query) <= 5 else 2
        if any(_within_edits(query, word, allowed) for word in [title, *title.split()]):
            return 3
    return 4


def _within_edits(left: str, right: str, allowed: int) -> bool:
    if abs(len(left) - len(right)) > allowed:
        return False
    previous = list(range(len(right) + 1))
    for i, char in enumerate(left, 1):
        current = [i]
        for j, other in enumerate(right, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (char != other)))
        if min(current) > allowed:
            return False
        previous = current
    return previous[-1] <= allowed
