"""Real daemon template/alias adoption; interaction behavior lives in the Node/browser probes."""

import pytest


@pytest.mark.parametrize(
    "route",
    [
        "/dashboard",
        "/tasks",
        "/kanban",
        "/tasks-view",
        "/task-inspector/synthetic",
        "/tasks-detail/synthetic",
        "/habits-view",
        "/stats",
        "/revision",
        "/settings/ai",
    ],
)
def test_pages_share_reachable_appearance_and_preferences(client, route):
    response = client.get(route)
    assert response.status_code == 200
    assert "/static/css/appearance.css" in response.text
    assert 'id="appearance_light_theme"' in response.text
    assert 'id="appearance_toggle"' in response.text
    assert 'id="settings_modal"' in response.text
    assert 'href="/settings/ai"' in response.text


def test_calendar_has_aligned_planning_tools_and_filter_context_outside_totals(client):
    html = client.get("/dashboard").text
    assert 'class="planning-header"' in html
    assert 'id="planning_task_search"' in html
    assert 'id="btn_toggle_right_sidebar"' in html
    assert 'id="calendar_density"' in html
    assert html.index('id="breakdown_filter_chip"') < html.index('id="right_sidebar"')
