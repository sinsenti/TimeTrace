"""Shared advanced filter dialog composition through real daemon page routes."""

import pytest


@pytest.mark.parametrize("route", ["/dashboard", "/tasks", "/kanban", "/tasks-view"])
def test_task_pages_share_one_accessible_filter_dialog(client, route):
    response = client.get(route)
    assert response.status_code == 200
    html = response.text
    head = html.split("</head>", 1)[0]
    assert html.count('id="custom_filter_modal"') == 1
    assert html.count("/static/js/custom_filter.js") == 1
    assert html.count("/static/css/task_filters.css") == 1
    assert "/static/css/task_filters.css" in head
    assert 'aria-labelledby="custom_filter_title"' in html
    assert 'aria-label="Close advanced task filters"' in html
    for field in ["query", "status", "category", "est_op", "priority"]:
        assert f'for="filter_input_{field}"' in html
    assert 'aria-label="Estimated minutes"' in html
    assert 'id="filter_status_feedback" role="status"' in html
    assert 'id="filter_persistence_feedback" role="status"' in html
    assert 'onclick="refreshCustomFilterStatuses()"' in html


def test_calendar_tab_dialog_keeps_export_and_session_handoff_reachable(client):
    html = client.get("/dashboard").text
    assert 'id="sidebar_status_tabs" role="group" aria-label="Filter planning tasks by status"' in html
    assert html.count('id="sidebar_tab_config_modal"') == 1
    assert html.count('id="export_modal"') == 1
    assert "/static/css/export_workflow.css" in html
    assert 'id="breakdown_filter_chip"' in html
    assert 'id="calendar"' in html
    assert 'id="sidebar_tab_config_feedback"' in html
    assert 'id="sidebar_task_feedback"' in html
