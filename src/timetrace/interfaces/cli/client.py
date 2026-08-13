import httpx
import sys
from timetrace.config import settings

BASE_URL = f"http://{settings.host}:{settings.port}/api/v1"


def get_client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=3.0)


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
