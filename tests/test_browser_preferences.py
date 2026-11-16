"""Tabbed Settings HTML entry points, using the actual daemon application."""

import pytest


@pytest.mark.parametrize(("route", "category"), [("/settings", "browser"), ("/settings/ai", "ai")])
def test_browser_preferences_routes_keep_independent_editors(client, route, category):
    response = client.get(route)
    assert response.status_code == 200
    html = response.text
    assert f'data-settings-category="{category}"' in html
    for identifier in ["settings_modal", "ai_behavior_settings", "ai_provider_form_section"]:
        assert html.count(f'id="{identifier}"') == 1
    assert 'id="settings_categories"' in html
    assert "/static/js/browser_preferences.js" in html
    assert "/static/css/browser_preferences.css" in html
