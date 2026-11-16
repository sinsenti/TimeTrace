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
    assert 'href="/settings" onclick="return followSettingsLink(event)"' in response.text


def test_calendar_has_aligned_planning_tools_and_filter_context_outside_totals(client):
    html = client.get("/dashboard").text
    assert 'class="planning-header"' in html
    assert 'id="planning_task_search"' in html
    assert 'id="btn_toggle_right_sidebar"' in html
    assert 'id="calendar_density"' in html
    assert 'class="calendar-toolbar calendar-tools"' in html
    assert "/static/css/appearance.css?v=ui-review2-4" in html
    assert "/static/js/dashboard.js?v=ui-review2-2" in html
    assert 'id="vim_mode_indicator" class="vim-mode-indicator" role="status" aria-live="polite"' in html
    assert "/static/css/timer.css?v=ui-review2-3" in html
    assert "/static/js/sidebar_totals.js?v=ui-polish-3" in html
    toolbar = html.split('class="calendar-toolbar calendar-tools"', 1)[1].split(
        "</div>\n        <div id=\"breakdown_filter_chip\"", 1
    )[0]
    primary = toolbar.index('class="calendar-toolbar-primary"')
    secondary = toolbar.index("<details class=\"calendar-toolbar-more\">")
    assert primary < secondary
    for control_id in ("btn_view_day", "btn_view_three_day", "btn_view_week", "btn_view_month", "calendar_range_title"):
        assert f'id="{control_id}"' in toolbar
    for secondary_control in (
        'onclick="openCustomFilterModal()"',
        'onclick="openExportModal()"',
        'id="btn_toggle_left_sidebar"',
        'id="btn_toggle_right_sidebar"',
        'onclick="createPlanningSession()"',
        'id="calendar_density"',
    ):
        assert secondary_control in toolbar
    assert html.index('id="breakdown_filter_chip"') < html.index('id="right_sidebar"')
    assert html.index("/static/js/settings.js") < html.index("/static/js/calendar.js")
    assert html.index("/static/js/settings.js") < html.index("/static/js/dashboard.js")


def test_calendar_task_cards_keep_a_bounded_mobile_width(client):
    stylesheet = client.get("/static/css/appearance.css").text
    assert "flex: 0 0 220px; width: 220px; min-width: 0; max-width: 220px" in stylesheet
    assert "position: relative; width: 100%; padding: 6px 10px" in stylesheet
    assert ".calendar-page .calendar-toolbar-more { position: static; }" in stylesheet
    assert "top: 100%; right: 10px; left: auto; width: min(360px, calc(100vw - 20px))" in stylesheet
    assert "min-width: 0; min-height: 24px; padding: 3px 4px" in stylesheet
