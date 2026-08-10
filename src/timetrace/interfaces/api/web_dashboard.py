HTML_DASHBOARD = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TimeTrace Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js"></script>
    <style>
        body { background-color: #0f0f15; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif; }
        .fc { background-color: #14141f; border-radius: 0.5rem; border: 1px solid #232334; }
        .fc-theme-standard td, .fc-theme-standard th { border-color: #232334 !important; }
        .fc-timegrid-slot { height: 3em !important; }
        .fc-col-header-cell { background-color: #181826; padding: 6px 0; }
        .fc-event { border-radius: 6px !important; border: none !important; padding: 2px 4px !important; font-size: 0.75rem !important; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #14141f; }
        ::-webkit-scrollbar-thumb { background: #2d2d42; border-radius: 3px; }
    </style>
</head>
<body class="h-screen flex flex-col overflow-hidden">

    <header class="bg-[#14141f] border-b border-[#232334] px-4 py-2.5 flex items-center justify-between shrink-0">
        <div class="flex items-center space-x-4">
            <span class="text-xl font-black text-purple-400 tracking-wider">TimeTrace</span>
            <div id="active_timer_pill" class="bg-[#1c1c2b] border border-[#2d2d42] px-3 py-1 rounded-md flex items-center space-x-3 text-xs">
                <span id="timer_status_label" class="text-slate-400">Loading timer...</span>
                <select id="timer_task_select" class="bg-[#14141f] border border-[#2d2d42] text-slate-200 px-2 py-0.5 rounded text-xs">
                    <option value="">-- Attach Task --</option>
                </select>
                <button id="toggle_btn" onclick="toggleTimer()" class="bg-purple-600 hover:bg-purple-500 text-white font-medium px-3 py-1 rounded transition text-xs">
                    Start Timer
                </button>
            </div>
        </div>

        <div class="flex items-center space-x-2 text-xs">
            <button onclick="openStatsModal()" class="bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 font-semibold px-3 py-1 rounded border border-purple-700/50 flex items-center space-x-1">
                <span>📊</span>
                <span>Stats</span>
            </button>
            <button onclick="toggleSidebar('left_sidebar')" class="bg-[#1c1c2b] hover:bg-[#28283d] text-slate-300 px-2.5 py-1 rounded border border-[#2d2d42]">Hide Task</button>
            <button onclick="toggleSidebar('right_sidebar')" class="bg-[#1c1c2b] hover:bg-[#28283d] text-slate-300 px-2.5 py-1 rounded border border-[#2d2d42]">Hide Totals</button>
            <div class="flex items-center bg-[#1c1c2b] rounded border border-[#2d2d42] px-1">
                <button onclick="calendar.prev()" class="px-2 py-1 text-slate-300 hover:text-white">&lt;</button>
                <span id="calendar_range_title" class="px-3 py-1 font-semibold text-slate-200">Date Range</span>
                <button onclick="calendar.next()" class="px-2 py-1 text-slate-300 hover:text-white">&gt;</button>
            </div>
            <button onclick="calendar.today()" class="bg-[#1c1c2b] hover:bg-[#28283d] text-slate-300 px-2.5 py-1 rounded border border-[#2d2d42]">Today</button>
            
            <button id="btn_view_day" onclick="switchView('timeGridDay')" class="px-2.5 py-1 rounded border text-slate-300 bg-[#1c1c2b] hover:bg-[#28283d] border-[#2d2d42]">Day</button>
            <button id="btn_view_week" onclick="switchView('timeGridWeek')" class="px-2.5 py-1 rounded border text-white font-bold bg-purple-600 border-purple-400">Week</button>
            <button id="btn_view_month" onclick="switchView('dayGridMonth')" class="px-2.5 py-1 rounded border text-slate-300 bg-[#1c1c2b] hover:bg-[#28283d] border-[#2d2d42]">Month</button>
        </div>

        <div class="flex items-center space-x-3 text-xs">
            <span id="range_total_header" class="text-slate-400">Range Total</span>
            <span id="weekly_total_badge" class="text-lg font-black text-purple-400">0.0h</span>
        </div>
    </header>

    <div class="flex-1 flex overflow-hidden">
        <aside id="left_sidebar" class="w-64 bg-[#14141f] border-r border-[#232334] p-3 flex flex-col shrink-0">
            <div class="flex justify-between items-center mb-3">
                <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Tasks</span>
                <span id="selected_tasks_count" class="text-xs text-slate-500">0 tasks</span>
            </div>

            <div id="task_card_list" class="flex-1 overflow-y-auto space-y-2.5 pr-1"></div>

            <button onclick="openNewTaskModal()" class="mt-3 w-full border border-dashed border-[#33334d] hover:border-purple-500 text-slate-400 hover:text-purple-400 py-2.5 rounded-lg text-xs font-medium transition">
                + Add task slot
            </button>
        </aside>

        <main class="flex-1 bg-[#0f0f15] p-3 overflow-hidden flex flex-col">
            <div id="calendar" class="flex-1"></div>
        </main>

        <aside id="right_sidebar" class="w-72 bg-[#14141f] border-l border-[#232334] p-3 flex flex-col shrink-0 overflow-y-auto space-y-4">
            <div class="flex justify-between items-center border-b border-[#232334] pb-2">
                <span id="range_breakdown_label" class="text-xs font-bold uppercase tracking-wider text-slate-400">Range Breakdown</span>
                <span id="side_total_hours" class="text-xs font-black text-purple-400">0.0h</span>
            </div>

            <div>
                <span class="text-[11px] font-extrabold uppercase tracking-wider text-emerald-400 mb-2 block">🏷️ By Activity (#tags)</span>
                <div id="activity_totals_list" class="space-y-2"></div>
            </div>

            <div>
                <span class="text-[11px] font-extrabold uppercase tracking-wider text-purple-400 mb-2 block">📋 By Task</span>
                <div id="weekly_totals_list" class="space-y-2"></div>
            </div>
        </aside>
    </div>

    <div id="stats_modal" class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center hidden z-50">
        <div class="bg-[#181826] border border-[#2d2d42] w-[540px] max-h-[85vh] rounded-xl p-6 shadow-2xl flex flex-col space-y-4">
            <div class="flex justify-between items-center border-b border-[#2d2d42] pb-3">
                <div>
                    <h3 class="font-black text-lg text-white">📊 Analytics & Summary</h3>
                    <p id="stats_range_label" class="text-xs text-purple-400 font-medium">Range: Week</p>
                </div>
                <button onclick="closeStatsModal()" class="text-slate-400 hover:text-white font-bold text-lg">&times;</button>
            </div>

            <div class="grid grid-cols-3 gap-3">
                <div class="bg-[#10101a] border border-[#2d2d42] p-3 rounded-lg text-center">
                    <span class="text-xs text-slate-400 block">Total Hours</span>
                    <span id="stats_total_hours" class="text-xl font-black text-purple-400">0.0h</span>
                </div>
                <div class="bg-[#10101a] border border-[#2d2d42] p-3 rounded-lg text-center">
                    <span class="text-xs text-slate-400 block">Sessions</span>
                    <span id="stats_total_sessions" class="text-xl font-black text-emerald-400">0</span>
                </div>
                <div class="bg-[#10101a] border border-[#2d2d42] p-3 rounded-lg text-center">
                    <span class="text-xs text-slate-400 block">Avg Energy</span>
                    <span id="stats_avg_energy" class="text-xl font-black text-amber-400">N/A</span>
                </div>
            </div>

            <div class="flex-1 overflow-y-auto space-y-4 pr-1">
                <div>
                    <h4 class="text-xs font-bold text-slate-300 uppercase mb-2">Activities (#tags)</h4>
                    <div id="stats_tag_bars" class="space-y-2"></div>
                </div>
                <div>
                    <h4 class="text-xs font-bold text-slate-300 uppercase mb-2">Tasks</h4>
                    <div id="stats_task_bars" class="space-y-2"></div>
                </div>
            </div>

            <div class="pt-2 border-t border-[#2d2d42] flex justify-end">
                <button onclick="closeStatsModal()" class="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-4 py-1.5 rounded-lg text-xs">Close</button>
            </div>
        </div>
    </div>

    <div id="task_modal" class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center hidden z-50">
        <div class="bg-[#181826] border border-[#2d2d42] w-96 rounded-xl p-5 shadow-2xl space-y-4">
            <h3 id="modal_task_title" class="font-bold text-lg text-white">Task Details</h3>
            <input type="hidden" id="edit_task_id">
            <div>
                <label class="text-xs text-slate-400 block mb-1">Task Title / Code</label>
                <input id="modal_input_title" type="text" placeholder="e.g. ALP-101 Portal Refresh" class="w-full bg-[#10101a] border border-[#2d2d42] px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500">
            </div>
            <div>
                <label class="text-xs text-slate-400 block mb-1">Description / Subtitle</label>
                <input id="modal_input_desc" type="text" placeholder="Optional notes..." class="w-full bg-[#10101a] border border-[#2d2d42] px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-purple-500">
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="text-xs text-slate-400 block mb-1">Status</label>
                    <select id="modal_input_status" class="w-full bg-[#10101a] border border-[#2d2d42] px-2 py-2 rounded-lg text-xs text-white">
                        <option value="in_progress">in progress</option>
                        <option value="ongoing">ongoing</option>
                        <option value="completed">completed</option>
                    </select>
                </div>
                <div>
                    <label class="text-xs text-slate-400 block mb-1">Card Color</label>
                    <input id="modal_input_color" type="color" value="#7c3aed" class="w-full h-9 bg-[#10101a] border border-[#2d2d42] rounded-lg cursor-pointer p-1">
                </div>
            </div>
            <div class="flex justify-between items-center pt-2">
                <button id="modal_delete_btn" onclick="deleteTask()" class="bg-red-900/40 hover:bg-red-800 text-red-300 border border-red-700/50 px-3 py-1.5 rounded-lg text-xs font-semibold">Delete</button>
                <div class="space-x-2">
                    <button onclick="closeTaskModal()" class="bg-[#232334] hover:bg-[#2d2d42] text-slate-300 px-3 py-1.5 rounded-lg text-xs">Cancel</button>
                    <button onclick="saveTask()" class="bg-purple-600 hover:bg-purple-500 text-white font-semibold px-4 py-1.5 rounded-lg text-xs">Save</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        let calendar;
        let isRunning = false;
        let activeTasks = [];
        let allSessions = [];
        let defaultPalette = ['#7c3aed', '#2563eb', '#d97706', '#dc2626', '#059669', '#ec4899'];

        document.addEventListener('DOMContentLoaded', function() {
            const calendarEl = document.getElementById('calendar');
            calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'timeGridWeek',
                headerToolbar: false,
                slotMinTime: "07:00:00",
                slotMaxTime: "23:00:00",
                editable: true,
                events: fetchCalendarEvents,
                datesSet: function(info) {
                    document.getElementById('calendar_range_title').innerText = info.view.title;
                    updateViewButtons(info.view.type);
                    fetchRangeTotals();
                }
            });
            calendar.render();

            fetchTasks();
            fetchTimerStatus();
            setInterval(fetchTimerStatus, 1000);
        });

        function switchView(viewName) {
            calendar.changeView(viewName);
        }

        function updateViewButtons(activeViewType) {
            const btnDay = document.getElementById('btn_view_day');
            const btnWeek = document.getElementById('btn_view_week');
            const btnMonth = document.getElementById('btn_view_month');

            const activeClass = "px-2.5 py-1 rounded border text-white font-bold bg-purple-600 border-purple-400 shadow-md";
            const inactiveClass = "px-2.5 py-1 rounded border text-slate-300 bg-[#1c1c2b] hover:bg-[#28283d] border-[#2d2d42]";

            btnDay.className = (activeViewType === 'timeGridDay') ? activeClass : inactiveClass;
            btnWeek.className = (activeViewType === 'timeGridWeek') ? activeClass : inactiveClass;
            btnMonth.className = (activeViewType === 'dayGridMonth') ? activeClass : inactiveClass;
        }

        async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
            try {
                const res = await fetch('/api/v1/sessions');
                allSessions = await res.json();
                
                const events = allSessions.map(s => {
                    const matchedTask = activeTasks.find(t => t.id === s.task_id);
                    const color = matchedTask ? matchedTask.color : '#7c3aed';
                    const title = matchedTask ? matchedTask.title : (s.tags || '#session');
                    return {
                        id: s.id,
                        title: `${title}\n${s.notes || ''}`,
                        start: s.start_time,
                        end: s.end_time || new Date().toISOString(),
                        backgroundColor: color,
                        borderColor: 'transparent'
                    };
                });
                successCallback(events);
                fetchRangeTotals();
            } catch (err) { failureCallback(err); }
        }

        async function fetchTimerStatus() {
            try {
                const res = await fetch('/api/v1/timer/status');
                const data = await res.json();
                isRunning = data.is_running;

                const label = document.getElementById('timer_status_label');
                const btn = document.getElementById('toggle_btn');

                if (isRunning) {
                    const mins = Math.floor(data.elapsed_seconds / 60);
                    const secs = data.elapsed_seconds % 60;
                    const timeStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
                    const taskName = data.task_title || (data.tags || 'Task');
                    
                    label.innerText = `⏱️ ${timeStr} | ${taskName}`;
                    btn.innerText = 'Stop';
                    btn.className = 'bg-red-600 hover:bg-red-500 text-white font-medium px-3 py-1 rounded text-xs';

                    document.title = `⏱️ ${timeStr} - [${taskName}] ${data.tags}`;
                } else {
                    label.innerText = '⏸️ Idle';
                    btn.innerText = 'Start Timer';
                    btn.className = 'bg-purple-600 hover:bg-purple-500 text-white font-medium px-3 py-1 rounded text-xs';
                    document.title = 'TimeTrace Dashboard';
                }
            } catch(e) {}
        }

        async function fetchTasks() {
            const res = await fetch('/api/v1/tasks');
            activeTasks = await res.json();

            const cardList = document.getElementById('task_card_list');
            const select = document.getElementById('timer_task_select');
            
            document.getElementById('selected_tasks_count').innerText = `${activeTasks.length} tasks`;
            
            select.innerHTML = '<option value="">-- Attach Task --</option>' + 
                activeTasks.map(t => `<option value="${t.id}">${t.title}</option>`).join('');

            cardList.innerHTML = activeTasks.map((t, idx) => {
                const color = t.color || defaultPalette[idx % defaultPalette.length];
                return `
                    <div onclick="openEditTaskModal(${t.id})" style="background-color: ${color};" class="p-3 rounded-lg shadow-md cursor-pointer transition transform hover:-translate-y-0.5 hover:brightness-110 flex flex-col justify-between h-24 text-white">
                        <div>
                            <div class="font-black text-sm tracking-wide leading-snug">${t.title}</div>
                            <div class="text-[11px] opacity-80 truncate">${t.description || ''}</div>
                        </div>
                        <div class="flex justify-between items-center text-[10px] font-semibold opacity-90">
                            <span class="bg-black/20 px-1.5 py-0.5 rounded">${t.status}</span>
                            <span>P${t.priority}</span>
                        </div>
                    </div>
                `;
            }).join('');

            fetchRangeTotals();
        }

        function fetchRangeTotals() {
            if (!calendar) return;
            const viewType = calendar.view.type;
            let rangeLabel = "Week";
            if (viewType === 'timeGridDay') rangeLabel = "Day";
            if (viewType === 'dayGridMonth') rangeLabel = "Month";

            document.getElementById('range_breakdown_label').innerText = `${rangeLabel} Breakdown`;
            document.getElementById('range_total_header').innerText = `${rangeLabel} Total`;

            const viewStart = calendar.view.activeStart;
            const viewEnd = calendar.view.activeEnd;

            let taskHours = {};
            let tagHours = {};
            let grandTotalSecs = 0;

            const visibleSessions = allSessions.filter(s => {
                const start = new Date(s.start_time);
                return start >= viewStart && start < viewEnd;
            });

            visibleSessions.forEach(s => {
                const dur = s.duration_seconds || 0;
                grandTotalSecs += dur;

                const tid = s.task_id || 0;
                taskHours[tid] = (taskHours[tid] || 0) + dur;

                const tagStr = s.tags || '#general';
                const tags = tagStr.split(' ').filter(t => t.startsWith('#'));
                if (tags.length === 0) tags.push('#general');
                tags.forEach(tg => {
                    tagHours[tg] = (tagHours[tg] || 0) + dur;
                });
            });

            document.getElementById('weekly_total_badge').innerText = `${(grandTotalSecs / 3600).toFixed(1)}h`;
            document.getElementById('side_total_hours').innerText = `${(grandTotalSecs / 3600).toFixed(1)}h`;

            const activityList = document.getElementById('activity_totals_list');
            const sortedTags = Object.entries(tagHours).sort((a,b) => b[1] - a[1]);
            if (sortedTags.length === 0) {
                activityList.innerHTML = '<div class="text-xs text-slate-500">No activities in this range.</div>';
            } else {
                activityList.innerHTML = sortedTags.map(([tag, secs]) => `
                    <div class="bg-[#181826] border border-[#232334] p-2.5 rounded-lg flex justify-between items-center">
                        <span class="text-xs font-bold text-emerald-400">${tag}</span>
                        <span class="text-xs font-black text-white">${(secs / 3600).toFixed(1)}h</span>
                    </div>
                `).join('');
            }

            const totalsList = document.getElementById('weekly_totals_list');
            totalsList.innerHTML = activeTasks.map((t, idx) => {
                const color = t.color || defaultPalette[idx % defaultPalette.length];
                const hrs = ((taskHours[t.id] || 0) / 3600).toFixed(1);
                return `
                    <div style="background-color: ${color};" class="p-2.5 rounded-lg shadow text-white flex justify-between items-center">
                        <span class="font-bold text-xs truncate">${t.title}</span>
                        <span class="text-sm font-black">${hrs}h</span>
                    </div>
                `;
            }).join('');
        }

        function openStatsModal() {
            const viewType = calendar.view.type;
            let rangeName = "Week";
            if (viewType === 'timeGridDay') rangeName = "Day";
            if (viewType === 'dayGridMonth') rangeName = "Month";

            document.getElementById('stats_range_label').innerText = `Statistics for Current ${rangeName} (${calendar.view.title})`;

            const viewStart = calendar.view.activeStart;
            const viewEnd = calendar.view.activeEnd;

            const visibleSessions = allSessions.filter(s => {
                const start = new Date(s.start_time);
                return start >= viewStart && start < viewEnd;
            });

            let totalSecs = 0;
            let totalEnergy = 0;
            let energyCount = 0;
            let tagMap = {};
            let taskMap = {};

            visibleSessions.forEach(s => {
                const dur = s.duration_seconds || 0;
                totalSecs += dur;

                if (s.reflection && s.reflection.energy_level) {
                    totalEnergy += s.reflection.energy_level;
                    energyCount++;
                }

                const tagStr = s.tags || '#general';
                const tags = tagStr.split(' ').filter(t => t.startsWith('#'));
                if (tags.length === 0) tags.push('#general');
                tags.forEach(tg => {
                    tagMap[tg] = (tagMap[tg] || 0) + dur;
                });

                const tid = s.task_id;
                const taskObj = activeTasks.find(t => t.id === tid);
                const taskName = taskObj ? taskObj.title : 'Unassigned';
                taskMap[taskName] = (taskMap[taskName] || 0) + dur;
            });

            document.getElementById('stats_total_hours').innerText = `${(totalSecs / 3600).toFixed(1)}h`;
            document.getElementById('stats_total_sessions').innerText = visibleSessions.length;
            document.getElementById('stats_avg_energy').innerText = energyCount > 0 ? `${(totalEnergy / energyCount).toFixed(1)} / 5` : 'N/A';

            const tagBars = document.getElementById('stats_tag_bars');
            const sortedTags = Object.entries(tagMap).sort((a,b) => b[1] - a[1]);
            tagBars.innerHTML = sortedTags.map(([tag, secs]) => {
                const pct = totalSecs > 0 ? Math.round((secs / totalSecs) * 100) : 0;
                return `
                    <div>
                        <div class="flex justify-between text-xs text-slate-300 mb-1">
                            <span class="font-bold text-emerald-400">${tag}</span>
                            <span>${(secs/3600).toFixed(1)}h (${pct}%)</span>
                        </div>
                        <div class="w-full bg-[#10101a] h-2 rounded-full overflow-hidden">
                            <div style="width: ${pct}%;" class="bg-emerald-500 h-full rounded-full"></div>
                        </div>
                    </div>
                `;
            }).join('');

            const taskBars = document.getElementById('stats_task_bars');
            const sortedTasks = Object.entries(taskMap).sort((a,b) => b[1] - a[1]);
            taskBars.innerHTML = sortedTasks.map(([taskTitle, secs]) => {
                const pct = totalSecs > 0 ? Math.round((secs / totalSecs) * 100) : 0;
                return `
                    <div>
                        <div class="flex justify-between text-xs text-slate-300 mb-1">
                            <span class="font-bold text-purple-400">${taskTitle}</span>
                            <span>${(secs/3600).toFixed(1)}h (${pct}%)</span>
                        </div>
                        <div class="w-full bg-[#10101a] h-2 rounded-full overflow-hidden">
                            <div style="width: ${pct}%;" class="bg-purple-600 h-full rounded-full"></div>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('stats_modal').classList.remove('hidden');
        }

        function closeStatsModal() {
            document.getElementById('stats_modal').classList.add('hidden');
        }

        async function toggleTimer() {
            if (isRunning) {
                await fetch('/api/v1/timer/stop', { method: 'POST' });
                calendar.refetchEvents();
            } else {
                const taskId = document.getElementById('timer_task_select').value;
                await fetch('/api/v1/timer/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: taskId ? parseInt(taskId) : null, tags: "#timetrace" })
                });
            }
            fetchTimerStatus();
        }

        function openNewTaskModal() {
            document.getElementById('edit_task_id').value = '';
            document.getElementById('modal_task_title').innerText = 'Create Task Slot';
            document.getElementById('modal_input_title').value = '';
            document.getElementById('modal_input_desc').value = '';
            document.getElementById('modal_input_status').value = 'in_progress';
            document.getElementById('modal_input_color').value = defaultPalette[activeTasks.length % defaultPalette.length];
            document.getElementById('modal_delete_btn').classList.add('hidden');
            document.getElementById('task_modal').classList.remove('hidden');
        }

        function openEditTaskModal(id) {
            const t = activeTasks.find(item => item.id === id);
            if (!t) return;
            document.getElementById('edit_task_id').value = t.id;
            document.getElementById('modal_task_title').innerText = 'Edit Task Slot';
            document.getElementById('modal_input_title').value = t.title;
            document.getElementById('modal_input_desc').value = t.description || '';
            document.getElementById('modal_input_status').value = t.status || 'in_progress';
            document.getElementById('modal_input_color').value = t.color || '#7c3aed';
            document.getElementById('modal_delete_btn').classList.remove('hidden');
            document.getElementById('task_modal').classList.remove('hidden');
        }

        function closeTaskModal() {
            document.getElementById('task_modal').classList.add('hidden');
        }

        async function saveTask() {
            const id = document.getElementById('edit_task_id').value;
            const payload = {
                title: document.getElementById('modal_input_title').value,
                description: document.getElementById('modal_input_desc').value,
                status: document.getElementById('modal_input_status').value,
                color: document.getElementById('modal_input_color').value
            };

            if (!payload.title) return;

            if (id) {
                await fetch(`/api/v1/tasks/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                await fetch('/api/v1/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }
            closeTaskModal();
            fetchTasks();
            calendar.refetchEvents();
        }

        async function deleteTask() {
            const id = document.getElementById('edit_task_id').value;
            if (!id) return;
            if (confirm("Are you sure you want to delete this task slot?")) {
                await fetch(`/api/v1/tasks/${id}`, { method: 'DELETE' });
                closeTaskModal();
                fetchTasks();
                calendar.refetchEvents();
            }
        }

        function toggleSidebar(id) {
            const el = document.getElementById(id);
            el.classList.toggle('hidden');
        }
    </script>
</body>
</html>
"""
