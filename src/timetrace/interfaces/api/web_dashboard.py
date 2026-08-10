# Legacy wrapper pointing to static file
import os

STATIC_INDEX = os.path.join(os.path.dirname(__file__), "static", "index.html")

def get_html_content() -> str:
    with open(STATIC_INDEX, "r", encoding="utf-8") as f:
        return f.read()

HTML_DASHBOARD = get_html_content()

