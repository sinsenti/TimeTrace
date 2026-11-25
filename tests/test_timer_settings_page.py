"""The approved settings page must use the real application and normal assets."""

from html.parser import HTMLParser

import pytest


class TimerPlacement(HTMLParser):
    def __init__(self):
        super().__init__()
        self.header_depth = 0
        self.inside_header = None

    def handle_starttag(self, tag, attrs):
        if tag == "header":
            self.header_depth += 1
        if dict(attrs).get("id") == "multiple_timers":
            self.inside_header = self.header_depth > 0

    def handle_endtag(self, tag):
        if tag == "header":
            self.header_depth -= 1


@pytest.mark.parametrize(
    "path",
    [
        "/dashboard",
        "/agenda-view",
        "/tasks",
        "/stats",
        "/habits-view",
        "/revision",
        "/settings",
        "/weekly-review-view",
        "/task-inspector/example",
        "/timer-settings",
    ],
)
def test_shared_timer_controls_stay_outside_page_headers(client, path):
    page = client.get(path)
    assert page.status_code == 200
    assert page.text.count('id="multiple_timers"') == 1
    parser = TimerPlacement()
    parser.feed(page.text)
    assert parser.inside_header is False
    assert "data-focus-alerts" in page.text


@pytest.mark.parametrize(
    "path", ["/static/css/timer_workspace.css", "/static/js/timer_settings.js", "/static/js/workspace_summary.js"]
)
def test_settings_assets_are_served_by_the_actual_app(client, path):
    assert client.get(path).status_code == 200


def test_focus_and_goals_have_a_dedicated_page(client):
    response = client.get("/timer-settings")
    assert response.status_code == 200
    assert "Focus &amp; goals" in response.text or "Focus & goals" in response.text
    assert "data-goal-settings" in response.text
    assert "data-focus-settings" in response.text
    assert "variant=" not in response.text
    calendar = client.get("/dashboard").text
    assert 'href="/timer-settings"' in calendar
    assert "data-personal-goals" not in calendar
