HTML_DASHBOARD = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TimeTrace Web Calendar</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js"></script>
    <style>
        body { background-color: #0f172a; color: #f8fafc; font-family: sans-serif; }
        .fc { background-color: #1e293b; border-radius: 0.75rem; padding: 1rem; border: 1px solid #334155; }
        .fc-theme-standard td, .fc-theme-standard th { border-color: #334155 !important; }
        .fc-timegrid-slot { height: 2.5em !important; }
    </style>
</head>
<body class="p-6">
    <div class="max-w-7xl mx-auto space-y-6">
        <header class="flex items-center justify-between bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg">
            <div class="flex items-center space-x-3">
                <span class="text-3xl">⏱️</span>
                <div>
                    <h1 class="text-xl font-bold text-emerald-400">TimeTrace Engine</h1>
                    <p id="timer_status_label" class="text-sm text-slate-400">Loading timer status...</p>
                </div>
            </div>
            <div class="flex items-center space-x-3">
                <input id="quick_tags" type="text" placeholder="#tags" class="bg-slate-900 border border-slate-700 text-sm px-3 py-2 rounded-lg text-white">
                <input id="quick_notes" type="text" placeholder="Session notes..." class="bg-slate-900 border border-slate-700 text-sm px-3 py-2 rounded-lg text-white">
                <button id="toggle_btn" onclick="toggleTimer()" class="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg transition">
                    Start Timer
                </button>
            </div>
        </header>

        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div class="space-y-6 lg:col-span-1">
                <div class="bg-slate-800 p-4 rounded-xl border border-slate-700">
                    <h2 class="font-bold text-lg text-slate-200 mb-3">📋 Tasks</h2>
                    <div class="space-y-2 mb-4">
                        <input id="task_title" type="text" placeholder="Task title..." class="w-full bg-slate-900 border border-slate-700 text-sm px-3 py-2 rounded-lg text-white">
                        <button onclick="createTask()" class="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-2 rounded-lg transition">
                            + Add Task
                        </button>
                    </div>
                    <ul id="task_list" class="space-y-2 max-h-60 overflow-y-auto"></ul>
                </div>

                <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
                    <h2 class="font-bold text-lg text-slate-200">📝 Markdown Sync</h2>
                    <button onclick="exportMarkdown()" class="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-semibold py-2 rounded-lg border border-slate-600 transition">
                        📥 Export Today as .md
                    </button>
                </div>
            </div>

            <div class="lg:col-span-3">
                <div id="calendar"></div>
            </div>
        </div>
    </div>

    <script>
        let calendar;
        let isRunning = false;

        document.addEventListener('DOMContentLoaded', function() {
            const calendarEl = document.getElementById('calendar');
            calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'timeGridDay',
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'timeGridDay,timeGridWeek'
                },
                slotMinTime: "06:00:00",
                slotMaxTime: "24:00:00",
                editable: true,
                events: fetchCalendarEvents
            });
            calendar.render();

            fetchTimerStatus();
            fetchTasks();
            setInterval(fetchTimerStatus, 2000);
        });

        async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
            try {
                const res = await fetch('/api/v1/sessions');
                const sessions = await res.json();
                const events = sessions.map(s => ({
                    id: s.id,
                    title: `${s.tags || '#session'} - ${s.notes || ''}`,
                    start: s.start_time,
                    end: s.end_time || new Date().toISOString(),
                    backgroundColor: s.tags.includes('#programming') ? '#2563eb' : '#059669',
                    borderColor: 'transparent'
                }));
                successCallback(events);
            } catch (err) {
                failureCallback(err);
            }
        }

        async function fetchTimerStatus() {
            const res = await fetch('/api/v1/timer/status');
            const data = await res.json();
            isRunning = data.is_running;

            const label = document.getElementById('timer_status_label');
            const btn = document.getElementById('toggle_btn');

            if (isRunning) {
                const mins = Math.floor(data.elapsed_seconds / 60);
                const secs = data.elapsed_seconds % 60;
                label.innerText = `⏱️ Running: ${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')} | ${data.tags}`;
                btn.innerText = 'Stop Timer';
                btn.className = 'bg-rose-600 hover:bg-rose-500 text-white font-semibold px-4 py-2 rounded-lg transition';
            } else {
                label.innerText = '⏸️ Timer Idle';
                btn.innerText = 'Start Timer';
                btn.className = 'bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg transition';
            }
        }

        async function toggleTimer() {
            if (isRunning) {
                await fetch('/api/v1/timer/stop', { method: 'POST' });
                calendar.refetchEvents();
            } else {
                const tags = document.getElementById('quick_tags').value || '#general';
                const notes = document.getElementById('quick_notes').value || '';
                await fetch('/api/v1/timer/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tags, notes })
                });
            }
            fetchTimerStatus();
        }

        async function fetchTasks() {
            const res = await fetch('/api/v1/tasks');
            const tasks = await res.json();
            const list = document.getElementById('task_list');
            list.innerHTML = tasks.map(t => `
                <li class="bg-slate-900 p-2.5 rounded-lg border border-slate-700/60 flex justify-between items-center text-sm">
                    <span class="font-medium text-slate-200">${t.title}</span>
                    <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">P${t.priority}</span>
                </li>
            `).join('');
        }

        async function createTask() {
            const title = document.getElementById('task_title').value;
            if (!title) return;
            await fetch('/api/v1/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, priority: 1 })
            });
            document.getElementById('task_title').value = '';
            fetchTasks();
        }

        async function exportMarkdown() {
            window.open('/api/v1/markdown/export', '_blank');
        }
    </script>
</body>
</html>
"""
