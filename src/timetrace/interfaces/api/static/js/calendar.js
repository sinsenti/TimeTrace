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

function navigateCalendarPrev() {
    if (!calendar) return;
    const viewType = calendar.view.type;
    if (viewType === 'timeGridDay' || viewType === 'timeGridThreeDay') {
        calendar.incrementDate({ days: -1 });
    } else {
        calendar.prev();
    }
}

function navigateCalendarNext() {
    if (!calendar) return;
    const viewType = calendar.view.type;
    if (viewType === 'timeGridDay' || viewType === 'timeGridThreeDay') {
        calendar.incrementDate({ days: 1 });
    } else {
        calendar.next();
    }
}

function openCalendarHeaderDatePicker() {
    const picker = document.getElementById('calendar_header_datepicker');
    if (!picker) return;
    if (typeof picker.showPicker === 'function') {
        try {
            picker.showPicker();
        } catch (e) {
            picker.focus();
            picker.click();
        }
    } else {
        picker.focus();
        picker.click();
    }
}

function scrollToCurrentTime() {
    if (!calendar) return;
    calendar.today();
    if (calendar.view.type !== 'dayGridMonth') {
        setTimeout(() => calendar.scrollToTime(getInitialScrollTime()), 50);
    }
}

function formatCalEventFromSession(s, idx = 0) {
    if (!s) return null;
    const matchedTask = (s.task_id && typeof allTasksMap !== 'undefined') ? allTasksMap[s.task_id] : null;
    const color = matchedTask 
        ? getTaskColor(matchedTask, idx) 
        : (typeof defaultPalette !== 'undefined' ? defaultPalette[idx % defaultPalette.length] : '#7c3aed');

    return {
        id: String(s.id),
        title: matchedTask ? matchedTask.title : (s.tags || s.notes || 'Session'),
        start: s.start_time,
        end: s.end_time || new Date().toISOString(),
        backgroundColor: color,
        borderColor: 'transparent',
        extendedProps: {
            taskId: s.task_id || null,
            taskTitle: matchedTask ? matchedTask.title : '',
            notes: s.notes || '',
            tags: s.tags || ''
        }
    };
}

async function handleCalendarEventUpdate(event) {
    const startIso = event.start.toISOString();
    const endIso = event.end ? event.end.toISOString() : event.start.toISOString();

    const payload = {
        start_time: startIso,
        end_time: endIso
    };

    const updatedSession = await api.put(`/sessions/${event.id}`, payload);

    if (updatedSession && typeof allSessions !== 'undefined' && Array.isArray(allSessions)) {
        const idx = allSessions.findIndex(s => String(s.id) === String(event.id));
        if (idx !== -1) allSessions[idx] = updatedSession;
    }

    if (event.extendedProps && event.extendedProps.taskId && event.end) {
        const newMins = Math.max(15, Math.round((event.end - event.start) / 60000));
        try {
            await api.put(`/api/tasks/${event.extendedProps.taskId}`, { estimated_minutes: newMins });
            if (typeof fetchTasks === 'function') fetchTasks();
            if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
        } catch (e) {}
    }

    if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
}

async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
    try {
        if (typeof fetchAllTasksRegistry === 'function') await fetchAllTasksRegistry();
        const res = await api.get(`/sessions?start=${fetchInfo.start.toISOString()}&end=${fetchInfo.end.toISOString()}`);
        allSessions = res || [];

        const visibleForCalendar = typeof sessionMatchesBreakdownFilter === 'function'
            ? allSessions.filter(sessionMatchesBreakdownFilter)
            : allSessions;

        const events = visibleForCalendar.map((s, idx) => formatCalEventFromSession(s, idx));
        successCallback(events);
        if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        if (typeof updateDocumentTitle === 'function') updateDocumentTitle();
    } catch (err) { failureCallback(err); }
}
