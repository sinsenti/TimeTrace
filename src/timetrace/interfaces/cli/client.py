import sys

import httpx
import typer

from timetrace.config import settings
from timetrace.core.ids import short_id

BASE_URL = f"http://{settings.host}:{settings.port}"


def get_client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=3.0)


def resolve_task_id(id_or_suffix: str) -> str:
    """Resolve a full task UUID or a unique short id typed at the CLI to a full id.

    Fetches the full task list over HTTP and matches client-side; this is a CLI-only
    convenience, not an API feature (every id sent back to the API stays the full UUID).
    An exact id match always wins. Otherwise matches by SUFFIX, matching what `short_id()`
    displays — a UUIDv7 PREFIX is dominated by its timestamp bits and collides across any
    batch of rows minted close together in time (see core/ids.py), so prefix matching here
    would make the very common case of "the id shown in the table" fail to resolve.
    """
    with get_client() as client:
        res = client.get("/api/tasks")
        if res.status_code != 200:
            print(f"Error: could not fetch tasks to resolve id '{id_or_suffix}'.")
            raise typer.Exit(1)
        tasks = res.json()

    for t in tasks:
        if t["id"] == id_or_suffix:
            return t["id"]

    matches = [t for t in tasks if t["id"].endswith(id_or_suffix)]

    if len(matches) == 1:
        return matches[0]["id"]

    if not matches:
        print(f"Error: no task found matching id '{id_or_suffix}'.")
        raise typer.Exit(1)

    print(f"Error: '{id_or_suffix}' matches {len(matches)} tasks, please be more specific:")
    for t in matches:
        print(f"  #{short_id(t['id'])}  {t['title']}")
    raise typer.Exit(1)


def ensure_daemon_running():
    try:
        with get_client() as client:
            res = client.get(f"http://{settings.host}:{settings.port}/health")
            if res.status_code == 200:
                return True
    except httpx.RequestError:
        print("TimeTrace daemon is not running.")
        print("Please start the daemon in the background using: timetrace daemon")
        sys.exit(1)
