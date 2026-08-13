"""Web Dashboard legacy router wrapper."""
from fastapi.responses import RedirectResponse


def get_html_dashboard_redirect():
    return RedirectResponse(url="/api/v1/dashboard")
