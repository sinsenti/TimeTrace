"""THROWAWAY: actual TimeTrace UI + disposable synthetic DB; A=current, B=settings-page proposal.
Run: uv run --no-sync python -P src/timetrace/interfaces/api/prototypes/timer_workspace_real/serve.py
Never starts/imports against personal state. Every run creates a new external scratch directory.
"""
import json
import os
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

HERE = Path(__file__).resolve().parent
SCRATCH = Path(tempfile.mkdtemp(prefix='timetrace-real-layout-'))
for name in ('home', 'tmp'):
    (SCRATCH / name).mkdir()
os.environ.update(TIMETRACE_DB_FILE=str(SCRATCH / 'timetrace.db'), TIMETRACE_PORT='18127',
                  TIMETRACE_IDLE_DETECTION_ENABLED='false', TIMETRACE_NATIVE_NOTIFICATIONS_ENABLED='false',
                  HOME=str(SCRATCH / 'home'), TMPDIR=str(SCRATCH / 'tmp'), TZ='Europe/Warsaw')
time.tzset()
# Environment is isolated before ANY application import.
import httpx
import uvicorn
from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse
from timetrace.main import create_daemon_app
from timetrace.interfaces.api.routers.web import templates

app = create_daemon_app()
original_lifespan = app.router.lifespan_context
seed = {}


@asynccontextmanager
async def lifespan(instance):
    async with original_lifespan(instance):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=instance), base_url='http://prototype') as client:
            async def post(path, data):
                r = await client.post(path, json=data)
                if r.status_code >= 400:
                    raise RuntimeError(f'Synthetic fixture {path}: {r.status_code} {r.text}')
                return r.json()
            now = datetime.now().astimezone()
            tasks = []
            examples = [('Read distributed systems', '#reading', 'In Progress', 240),
                        ('Build the next release', '#build', 'In Progress', 180),
                        ('Practice grammar', '#learn', 'To Do', 30),
                        ('Prepare weekly review', '#reflect', 'Scheduled', 45),
                        ('Write project notes', '#build', 'To Do', 60),
                        ('Plan next week', '#planning', 'To Do', 30),
                        ('Study database indexes', '#reading', 'To Do', 90),
                        ('Review chapter exercises', '#learn', 'To Do', 45)]
            for i, (title, tags, status, estimate) in enumerate(examples):
                tasks.append(await post('/api/tasks', {'title': title, 'tags': tags, 'status': status,
                    'estimated_minutes': estimate, 'description': 'Synthetic preview task. Rendered by the real task-card code.',
                    'priority': str(1 + i % 3)}))
            # Explicit demonstration scenario, NOT a product default: Work parent + child activities, 2h/day.
            work = await post('/api/tasks', {'title': 'Work', 'estimated_minutes': 0, 'tags': '#work'})
            for index in (1, 3, 4, 5):
                changed = await client.put(f"/api/tasks/{tasks[index]['id']}", json={'parent_id': work['id']})
                changed.raise_for_status()
            await post('/goals', {'operation_id': str(uuid4()), 'owner_kind': 'task', 'task_id': work['id'],
                'cadence': 'day', 'target_seconds': 7200.0, 'include_descendants': True})
            tasks.append(work)
            monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
            for i in range(5):
                start = monday + timedelta(days=i, hours=9 + i % 3)
                await post('/scheduled-sessions', {'task_id': tasks[i]['id'], 'start_time': start.isoformat(),
                    'end_time': (start + timedelta(minutes=60)).isoformat(), 'notes': 'Planned session'})
            for i in range(4):
                end = now - timedelta(minutes=20 + i * 55)
                await post('/recorded-work', {'task_id': tasks[i]['id'], 'start_time': (end - timedelta(minutes=25+i*5)).isoformat(),
                    'end_time': end.isoformat(), 'notes': ['Chapter notes', 'Implementation sketch', 'Grammar exercises', 'Review notes'][i]})
            await post('/timers', {'operation_id': str(uuid4()), 'task_id': tasks[0]['id'], 'notes': 'Chapter 4 · consistency models', 'pause_when_idle': False})
            second = await post('/timers', {'operation_id': str(uuid4()), 'task_id': tasks[1]['id'], 'pause_when_idle': False})
            await post(f"/timers/{second['timer']['id']}/pause", {'operation_id': str(uuid4()), 'expected_revision': second['timer']['revision']})
            seed.update(tasks=[t['id'] for t in tasks], run=str(uuid4()), scratch=str(SCRATCH))
        print('REAL RENDERERS, SYNTHETIC ONLY: http://127.0.0.1:18127/dashboard?variant=B', flush=True)
        print(f'Scratch state: {SCRATCH}', flush=True)
        yield


app.router.lifespan_context = lifespan


@app.middleware('http')
async def prototype(request: Request, call_next):
    if request.url.path.startswith(('/api/ai', '/ai')):
        return JSONResponse({'detail': 'AI/provider calls disabled in this isolated visual prototype.'}, status_code=403)
    response = await call_next(request)
    if 'text/html' not in response.headers.get('content-type', ''):
        return response
    body = b''.join([chunk async for chunk in response.body_iterator]).decode()
    config = json.dumps(seed).replace('<', '\\u003c')
    # Early suppression avoids layout flashes and native permission requests. It does not replace application rendering.
    body = body.replace('</head>', '<link rel="stylesheet" href="/prototype-real/layout.css"><script>window.realPreview='+config+';document.documentElement.dataset.layout=new URLSearchParams(location.search).get("variant")==="A"?"A":"B";if(localStorage.getItem("realPreviewRun")!==realPreview.run){for(const store of [localStorage,sessionStorage])for(const k of Object.keys(store))if(k.startsWith("timetrace"))store.removeItem(k);localStorage.setItem("timetrace.workspace.pins.v1",JSON.stringify(realPreview.tasks.slice(0,2)));localStorage.setItem("realPreviewRun",realPreview.run);}Object.defineProperty(window,"Notification",{value:class{static permission="denied";static requestPermission(){return Promise.resolve("denied");}}});</script></head>')
    body = body.replace('</body>', '<script src="/prototype-real/layout.js"></script></body>')
    headers = {k: v for k, v in response.headers.items() if k.lower() not in ('content-length', 'content-encoding')}
    return HTMLResponse(body, status_code=response.status_code, headers=headers)


@app.get('/prototype-real/{name}')
def asset(name: str):
    if name not in ('layout.css', 'layout.js', 'goal_cards.js'):
        return JSONResponse({'detail': 'Not found'}, status_code=404)
    return HTMLResponse((HERE / name).read_text(), media_type='text/css' if name.endswith('.css') else 'text/javascript')


@app.get('/timer-settings')
def timer_settings(request: Request):
    return HTMLResponse(templates.env.from_string((HERE / 'timer_settings.html').read_text()).render(request=request, active_page='settings_ai'))


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=18127)
