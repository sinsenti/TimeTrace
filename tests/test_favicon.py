import re

import pytest


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/agenda-view",
        "/dashboard",
        "/habits-view",
        "/revision",
        "/settings",
        "/settings/ai",
        "/stats",
        "/task-inspector/0195e535-0000-7000-8000-00000000000a",
        "/tasks",
        "/timer-settings",
        "/weekly-review-view",
    ],
)
def test_web_page_links_to_a_served_png_favicon(client, path):
    page = client.get(path)
    assert page.status_code == 200
    head = re.search(r"<head>(.*?)</head>", page.text, re.S)
    assert head is not None
    icons = re.findall(r'<link\b[^>]*\brel="icon"[^>]*\bhref="([^"]+)"[^>]*>', head[1])
    assert len(icons) == 1
    assert icons[0].startswith("/static/")

    icon = client.get(icons[0])
    assert icon.status_code == 200
    assert icon.headers["content-type"] == "image/png"
    assert icon.content.startswith(b"\x89PNG\r\n\x1a\n")
