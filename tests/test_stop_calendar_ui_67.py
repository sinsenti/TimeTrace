"""Root HTTP composition for the mounted Stop/Calendar controllers, not a source-text seam."""

import pytest


@pytest.mark.parametrize(
    "route",
    [
        "/dashboard",
        "/agenda-view",
        "/tasks",
        "/task-inspector/synthetic",
        "/stats",
        "/revision",
        "/habits-view",
        "/settings/ai",
    ],
)
def test_root_pages_serve_versioned_stop_review_before_timer_controller(client, route):
    response = client.get(route)
    assert response.status_code == 200
    assert "/static/js/stop_review.js?v=stop67-1" in response.text
    assert "/static/js/multiple_timers.js?v=stop67-1" in response.text
    assert response.text.index("/static/js/stop_review.js?") < response.text.index("/static/js/multiple_timers.js?")
    assert "/static/js/api_client.js?v=stop67-1" in response.text
    if route in {"/dashboard", "/agenda-view"}:
        assert 'id="plan_removal_recovery"' in response.text
        assert "/static/js/recorded_work_recovery.js?v=stop67-1" in response.text


@pytest.mark.parametrize("route", ["/dashboard", "/tasks", "/task-inspector/synthetic"])
def test_calendar_session_editors_compose_reviewed_recording_and_guarded_removal(client, route):
    response = client.get(route)
    assert response.status_code == 200
    assert "/static/js/reviewed_recording.js?v=stop67-1" in response.text
    assert "/static/js/plan_removal.js?v=stop67-1" in response.text
    assert "/static/js/session_modal.js?v=stop67-1" in response.text
    assert response.text.index("/static/js/reviewed_recording.js?") < response.text.index(
        "/static/js/session_modal.js?"
    )
