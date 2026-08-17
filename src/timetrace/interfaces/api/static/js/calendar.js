/**
 * FullCalendar Engine & View Event Handlers
 */

function switchView(viewName) {
    if (!calendar) return;
    calendar.changeView(viewName);
    if (viewName !== 'dayGridMonth') {
        setTimeout(() => calendar.scrollToTime(getInitialScrollTime()), 50);
    }
    const settings = typeof getUserSettings === 'function' ? getUserSettings() : null;
    if (settings) {
        settings.lastSelectedView = viewName;
        if (typeof saveUserSettings === 'function') saveUserSettings(settings);
    }
}

function updateViewButtons(activeViewType) {
    const btnDay = document.getElementById('btn_view_day');
    const btnThreeDay = document.getElementById('btn_view_three_day');
    const btnWeek = document.getElementById('btn_view_week');
    const btnMonth = document.getElementById('btn_view_month');

    const activeClass = "h-6 px-2 rounded text-white font-bold bg-purple-600 text-[11px]";
    const inactiveClass = "h-6 px-2 rounded text-slate-300 hover:text-white text-[11px]";

    if (btnDay) btnDay.className = (activeViewType === 'timeGridDay') ? activeClass : inactiveClass;
    if (btnThreeDay) btnThreeDay.className = (activeViewType === 'timeGridThreeDay') ? activeClass : inactiveClass;
    if (btnWeek) btnWeek.className = (activeViewType === 'timeGridWeek') ? activeClass : inactiveClass;
    if (btnMonth) btnMonth.className = (activeViewType === 'dayGridMonth') ? activeClass : inactiveClass;
}

function scrollToCurrentTime() {
    if (!calendar) return;
    calendar.today();
    if (calendar.view.type !== 'dayGridMonth') {
        setTimeout(() => calendar.scrollToTime(getInitialScrollTime()), 50);
    }
}

async function handleCalendarEventUpdate(event) {
    const startIso = event.start.toISOString();
    const endIso = event.end ? event.end.toISOString() : event.start.toISOString();

    const payload = {
        start_time: startIso,
        end_time: endIso
    };

    await api.put(`/sessions/${event.id}`, payload);

    if (event.extendedProps && event.extendedProps.taskId && event.end) {
        const newMins = Math.max(15, Math.round((event.end - event.start) / 60000));
        try {
            await api.put(`/tasks/${event.extendedProps.taskId}`, { estimated_minutes: newMins });
            if (typeof fetchTasks === 'function') fetchTasks();
            if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
        } catch (e) {}
    }

    if (calendar) calendar.refetchEvents();
}

async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
    try {
        if (typeof fetchAllTasksRegistry === 'function') await fetchAllTasksRegistry();
        const res = await api.get(`/sessions?start=${fetchInfo.start.toISOString()}&end=${fetchInfo.end.toISOString()}`);
        allSessions = res || [];

        const events = allSessions.map((s, idx) => {
            const matchedTask = typeof allTasksMap !== 'undefined' ? allTasksMap[s.task_id] : null;
            const color = matchedTask ? getTaskColor(matchedTask, idx) : defaultPalette[idx % defaultPalette.length];

            return {
                id: String(s.id),
                title: s.notes || s.tags || 'Session',
                start: s.start_time,
                end: s.end_time || new Date().toISOString(),
                backgroundColor: color,
                borderColor: 'transparent',
                extendedProps: {
                    taskId: s.task_id,
                    taskTitle: matchedTask ? matchedTask.title : '',
                    notes: s.notes || '',
                    tags: s.tags || ''
                }
            };
        });
        successCallback(events);
        if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        if (typeof updateDocumentTitle === 'function') updateDocumentTitle();
    } catch (err) { failureCallback(err); }
}
