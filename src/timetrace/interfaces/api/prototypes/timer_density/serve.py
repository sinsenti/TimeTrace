"""THROWAWAY: current layout + three lower-noise alternatives on /dashboard and /agenda-view.
Run from repo root: uv run --no-sync python -P src/timetrace/interfaces/api/prototypes/timer_density/serve.py
Open http://127.0.0.1:18126/agenda-view?variant=B . Synthetic data only; no timetrace imports/DB.
A uses current templates and focus/goals renderers, not a screenshot of personal data.
B toolbar/dialogs; C side drawer; D minimal/settings-first. Verdict pending owner feedback.
"""
import mimetypes
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

from jinja2 import Environment, FileSystemLoader, select_autoescape

HERE = Path(__file__).resolve().parent
API = HERE.parents[1]
ENV = Environment(loader=FileSystemLoader(API / 'templates'), autoescape=select_autoescape())


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/', '/dashboard', '/agenda-view'):
            agenda = path != '/dashboard'
            request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(ui_prototype=False)), query_params={})
            html = ENV.get_template('agenda.html' if agenda else 'dashboard.html').render(request=request, active_page='agenda' if agenda else 'dashboard')
            # Do not boot the application, its network clients, storage or mutation handlers.
            html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S | re.I)
            html = re.sub(r'\s+on\w+="[^"]*"', '', html)
            html = html.replace('</head>', '<script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="/prototype/preview.css"></head>')
            html = html.replace('</body>', '<script src="/prototype/fixtures.js"></script><script src="/static/js/multiple_timers.js"></script><script src="/static/js/personal_goals.js"></script><script src="/static/js/timer_focus.js"></script><script src="/prototype/preview.js"></script></body>')
            self.send(html.encode(), 'text/html; charset=utf-8')
            return
        if path.startswith('/prototype/'):
            base, relative = HERE, path.removeprefix('/prototype/')
        elif path.startswith('/static/'):
            base, relative = API / 'static', path.removeprefix('/static/')
        else:
            self.send(b'Prototype only: use /dashboard or /agenda-view.', 'text/plain', 404)
            return
        file = (base / relative).resolve()
        if not file.is_relative_to(base.resolve()) or not file.is_file():
            self.send(b'Not found', 'text/plain', 404)
            return
        self.send(file.read_bytes(), mimetypes.guess_type(file.name)[0] or 'application/octet-stream')

    def send(self, data, mime, status=200):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        self.send(b'No backend mutations in this prototype.', 'text/plain', 405)

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST


if __name__ == '__main__':
    print('THROWAWAY, synthetic only: http://127.0.0.1:18126/agenda-view?variant=B', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 18126), Handler).serve_forever()
