"""Actual root HTTP composition; visual/keyboard acceptance still belongs in the browser."""

import re

import pytest


@pytest.mark.parametrize(
    "path",
    [
        "/agenda-view",
        "/tasks",
        "/dashboard",
        "/stats",
        "/revision",
        "/habits-view",
        "/settings",
        "/settings/ai",
        "/timer-settings",
        "/weekly-review-view",
        "/task-inspector/0195e535-0000-7000-8000-00000000000a",
    ],
)
def test_app_dialogs_available_before_served_callers(client, path):
    response = client.get(path)
    assert response.status_code == 200
    html = response.text
    assert html.count("/static/js/app_dialogs.js") == 1
    assert html.count("/static/css/app_dialogs.css") == 1
    for caller in ["agenda.js", "settings.js", "utils.js", "ai_assistant.js", "dashboards.js", "subtasks.js"]:
        if f"/static/js/{caller}" in html:
            assert html.index("/static/js/app_dialogs.js") < html.index(f"/static/js/{caller}")


def test_agenda_help_and_filters_have_named_dialogs_with_footer_close(client):
    html = client.get("/agenda-view").text
    for name in ["agenda-help", "agenda-filters"]:
        dialog = re.search(rf'<dialog id="{name}".*?</dialog>', html, re.S).group()
        assert f'aria-labelledby="{name}-title"' in dialog
        assert re.search(r"<footer[^>]*>.*?<button[^>]*>Close</button>.*?</footer>\s*</dialog>", dialog, re.S)
    assert "Notes contain" in html
    assert "Task tag contains" in html
    assert 'step="0.001"' not in html
