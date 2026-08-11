let calendar;
let activeTasks = [];
let allSessions = [];
let currentFilter = 'all';

// ==========================================
// 🚀 Main Entry Orchestrator
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    const durationSelect = document.getElementById('config_slot_duration');
    if (durationSelect) durationSelect.value = defaultDurationMinutes;

    const calendarEl = document.getElementById('calendar');
    if (calendarEl) {
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'timeGridWeek',
            headerToolbar: false,
            slotMinTime: "00:00:00",
            slotMaxTime: "24:00:00",
            slotDuration: `00:${String(defaultDurationMinutes).padStart(2,'0')}:00`,
            scrollTime: getInitialScrollTime(),
            scrollTimeReset: false,
            nowIndicator: true,
            editable: true,
            selectable: true,
            selectMirror: true,
            droppable: true,
            defaultTimedEventDuration: `00:${String(defaultDurationMinutes).padStart(2,'0')}:00`,
            events: fetchCalendarEvents,

            // Calendar Event Renderer (Hierarchy: Task Title -> Notes -> Tags)
            eventContent: function(arg) {
                const props = arg.event.extendedProps || {};
                const taskTitle = props.taskTitle || '';
                const notes = props.notes || '';
                const tags = props.tags || '';

                return {
                    html: `
                        <div class="fc-event-custom flex flex-col h-full w-full overflow-hidden leading-tight p-0.5 text-white">
                            ${taskTitle ? `<div class="font-black text-[11px] truncate shrink-0">${taskTitle}</div>` : ''}
                            ${notes ? `<div class="text-[10px] opacity-85 overflow-hidden line-clamp-1 shrink">${notes}</div>` : ''}
                            ${tags ? `<div class="text-[9px] font-mono text-purple-200 opacity-90 truncate shrink-0 mt-auto">${tags}</div>` : ''}
                        </div>
                    `
                };
            },

            dayHeaderContent: function(arg) {
                const dayName = arg.date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                const dayNum = arg.date.getDate();
                return {
                    html: `
                        <div class="flex flex-col items-center py-1">
                            <span class="text-[10px] font-bold tracking-widest text-slate-500 uppercase">${dayName}</span>
                            <span class="mt-1 text-base font-bold text-slate-200">${dayNum}</span>
                        </div>
                    `
                };
            },

            select: function(selectionInfo) {
                cursorStart = selectionInfo.start;
                cursorEnd = selectionInfo.end;

                if (!suppressModalOnSelect) {
                    openCreateSessionModal(selectionInfo.start, selectionInfo.end);
                }
            },

            eventDrop: async function(info) { await handleCalendarEventUpdate(info.event); },
            eventResize: async function(info) { await handleCalendarEventUpdate(info.event); },
            
            eventClick: function(info) {
                openEditSessionModal(info.event.id);
            },

            eventReceive: function(info) {
                const taskTitle = info.event.title;
                const taskId = info.event.extendedProps.taskId;
                const startTime = info.event.start;
                const endTime = new Date(startTime.getTime() + defaultDurationMinutes * 60000);

                info.event.remove();
                openCreateSessionModal(startTime, endTime, taskId, taskTitle);
            },

            datesSet: function(info) {
                const titleEl = document.getElementById('calendar_range_title');
                if (titleEl) titleEl.innerText = info.view.title;
                updateViewButtons(info.view.type);
                fetchRangeTotals();
                injectTimezoneLabel();
            }
        });
        calendar.render();
    }

    const taskCardList = document.getElementById('task_card_list');
    if (taskCardList) {
        new FullCalendar.Draggable(taskCardList, {
            itemSelector: '.task-card',
            eventData: function(eventEl) {
                return {
                    title: eventEl.getAttribute('data-task-title'),
                    backgroundColor: eventEl.getAttribute('data-task-color'),
                    extendedProps: {
                        taskId: parseInt(eventEl.getAttribute('data-task-id'))
                    }
                };
            }
        });
    }

    setupModalKeyboardListeners();
    setupVimKeyboardListeners();

    fetchAllTasksRegistry();
    fetchTasks();
    fetchTimerStatus();
    setInterval(fetchTimerStatus, 1000);
});

async function handleCalendarEventUpdate(event) {
    const payload = {
        start_time: event.start.toISOString(),
        end_time: event.end ? event.end.toISOString() : event.start.toISOString()
    };
    await fetch(`/api/v1/sessions/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (calendar) calendar.refetchEvents();
}

function switchView(viewName) {
    if (!calendar) return;
    calendar.changeView(viewName);
    if (viewName !== 'dayGridMonth') {
        setTimeout(() => calendar.scrollToTime(getInitialScrollTime()), 50);
    }
}

function updateViewButtons(activeViewType) {
    const btnDay = document.getElementById('btn_view_day');
    const btnWeek = document.getElementById('btn_view_week');
    const btnMonth = document.getElementById('btn_view_month');

    const activeClass = "h-8 px-2.5 rounded-lg border text-white font-bold bg-purple-600 border-purple-400 whitespace-nowrap";
    const inactiveClass = "h-8 px-2.5 rounded-lg border text-slate-300 bg-[#181a28] hover:bg-[#222536] border-[#262938] whitespace-nowrap";

    if (btnDay) btnDay.className = (activeViewType === 'timeGridDay') ? activeClass : inactiveClass;
    if (btnWeek) btnWeek.className = (activeViewType === 'timeGridWeek') ? activeClass : inactiveClass;
    if (btnMonth) btnMonth.className = (activeViewType === 'dayGridMonth') ? activeClass : inactiveClass;
}

// Dynamic Sidebar Toggle Button Styling Handler
function toggleSidebar(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('hidden');
    const isHidden = el.classList.contains('hidden');

    if (id === 'left_sidebar') {
        const btn = document.getElementById('btn_toggle_left_sidebar');
        if (btn) {
            btn.innerText = isHidden ? 'Show Tasks' : 'Hide Tasks';
            btn.className = isHidden 
                ? 'h-8 bg-[#181a28] hover:bg-[#222536] text-slate-500 border border-slate-800 px-3 rounded-lg whitespace-nowrap transition'
                : 'h-8 bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border border-purple-700/50 px-3 rounded-lg font-semibold whitespace-nowrap transition';
        }
    } else if (id === 'right_sidebar') {
        const btn = document.getElementById('btn_toggle_right_sidebar');
        if (btn) {
            btn.innerText = isHidden ? 'Show Totals' : 'Hide Totals';
            btn.className = isHidden 
                ? 'h-8 bg-[#181a28] hover:bg-[#222536] text-slate-500 border border-slate-800 px-3 rounded-lg whitespace-nowrap transition'
                : 'h-8 bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border border-purple-700/50 px-3 rounded-lg font-semibold whitespace-nowrap transition';
        }
    }
}

// ==========================================
// 📡 Data Fetching & Sync Functions
// ==========================================
async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
    try {
        await fetchAllTasksRegistry(); // Sync full task lookup table
        const res = await fetch(`/api/v1/sessions?start=${fetchInfo.start.toISOString()}&end=${fetchInfo.end.toISOString()}`);
        allSessions = await res.json();
        
        const events = allSessions.map(s => {
            const matchedTask = allTasksMap[s.task_id];
            const color = matchedTask ? matchedTask.color : '#7c3aed';

            return {
                id: s.id,
                title: s.notes || s.tags || '#session',
                start: s.start_time,
                end: s.end_time || new Date().toISOString(),
                backgroundColor: color,
                borderColor: 'transparent',
                extendedProps: {
                    taskTitle: matchedTask ? matchedTask.title : '',
                    notes: s.notes || '',
                    tags: s.tags || ''
                }
            };
        });
        successCallback(events);
        fetchRangeTotals();
    } catch (err) { failureCallback(err); }
}

function setTaskFilter(filterName) {
    currentFilter = filterName;
    
    const tabAll = document.getElementById('filter_tab_all');
    const tabActive = document.getElementById('filter_tab_active');
    const tabDone = document.getElementById('filter_tab_done');
    
    const activeClass = "flex-1 py-1 text-[10px] rounded bg-purple-600 text-white font-bold";
    const inactiveClass = "flex-1 py-1 text-[10px] rounded bg-[#181a28] text-slate-400 hover:text-white";

    if (tabAll) tabAll.className = (filterName === 'all') ? activeClass : inactiveClass;
    if (tabActive) tabActive.className = (filterName === 'hide_completed') ? activeClass : inactiveClass;
    if (tabDone) tabDone.className = (filterName === 'completed') ? activeClass : inactiveClass;

    fetchTasks();
}

async function fetchTasks() {
    try {
        const res = await fetch(`/api/v1/tasks?status=${currentFilter}`);
        activeTasks = await res.json();

        const cardList = document.getElementById('task_card_list');
        const select = document.getElementById('timer_task_select');
        
        const countEl = document.getElementById('selected_tasks_count');
        if (countEl) countEl.innerText = `${activeTasks.length} tasks`;
        
        if (select) {
            select.innerHTML = '<option value="">-- Attach Task --</option>' + 
                activeTasks.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
        }

        if (cardList) {
            if (activeTasks.length === 0) {
                cardList.innerHTML = '<div class="text-xs text-slate-500 text-center py-4">No tasks found.</div>';
            } else {
                cardList.innerHTML = activeTasks.map((t, idx) => {
                    const color = t.color || defaultPalette[idx % defaultPalette.length];
                    const prioLabel = (t.priority || '-').toUpperCase();
                    return `
                        <div onclick="openEditTaskModal(${t.id})" data-task-id="${t.id}" data-task-title="${t.title}" data-task-color="${color}" style="background-color: ${color};" class="task-card p-3 rounded-lg shadow-md transition transform hover:-translate-y-0.5 hover:brightness-110 flex flex-col justify-between h-24 text-white">
                            <div>
                                <div class="font-black text-sm tracking-wide leading-snug">${t.title}</div>
                                <div class="text-[11px] opacity-80 truncate">${t.description || ''}</div>
                            </div>
                            <div class="flex justify-between items-center text-[10px] font-semibold opacity-90">
                                <span class="bg-black/20 px-1.5 py-0.5 rounded">${t.status}</span>
                                <span class="bg-black/30 px-1.5 py-0.5 rounded font-bold">${prioLabel}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        fetchRangeTotals();
    } catch (err) {
        console.error("Error fetching tasks:", err);
    }
}

async function clearCompletedTasks() {
    if (confirm("Are you sure you want to delete all completed tasks?")) {
        await fetch('/api/v1/tasks/completed', { method: 'DELETE' });
        fetchTasks();
    }
}

function fetchRangeTotals() {
    if (!calendar) return;
    const viewType = calendar.view.type;
    let rangeLabel = "Week";
    if (viewType === 'timeGridDay') rangeLabel = "Day";
    if (viewType === 'dayGridMonth') rangeLabel = "Month";

    const labelEl = document.getElementById('range_breakdown_label');
    const headerEl = document.getElementById('range_total_header');
    if (labelEl) labelEl.innerText = `${rangeLabel} Breakdown`;
    if (headerEl) headerEl.innerText = `${rangeLabel} Total`;

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

    const badgeEl = document.getElementById('weekly_total_badge');
    const sideEl = document.getElementById('side_total_hours');
    if (badgeEl) badgeEl.innerText = `${(grandTotalSecs / 3600).toFixed(1)}h`;
    if (sideEl) sideEl.innerText = `${(grandTotalSecs / 3600).toFixed(1)}h`;

    const activityList = document.getElementById('activity_totals_list');
    const sortedTags = Object.entries(tagHours).sort((a,b) => b[1] - a[1]);
    if (activityList) {
        if (sortedTags.length === 0) {
            activityList.innerHTML = '<div class="text-xs text-slate-500">No activities in this range.</div>';
        } else {
            activityList.innerHTML = sortedTags.map(([tag, secs]) => `
                <div class="bg-[#161824] border border-[#262938] p-2.5 rounded-lg flex justify-between items-center">
                    <span class="text-xs font-bold text-emerald-400">${tag}</span>
                    <span class="text-xs font-black text-white">${(secs / 3600).toFixed(1)}h</span>
                </div>
            `).join('');
        }
    }

    const totalsList = document.getElementById('weekly_totals_list');
    if (totalsList) {
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
}
