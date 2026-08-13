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
    const payload = {
        start_time: event.start.toISOString(),
        end_time: event.end ? event.end.toISOString() : event.start.toISOString()
    };
    await api.put(`/api/v1/sessions/${event.id}`, payload);
    if (calendar) calendar.refetchEvents();
}

async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
    try {
        await fetchAllTasksRegistry();
        const res = await api.get(`/api/v1/sessions?start=${fetchInfo.start.toISOString()}&end=${fetchInfo.end.toISOString()}`);
        allSessions = res || [];
        
        const events = allSessions.map((s, idx) => {
            const matchedTask = allTasksMap[s.task_id];
            const color = matchedTask ? getTaskColor(matchedTask, idx) : defaultPalette[idx % defaultPalette.length];

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
        updateDocumentTitle();
    } catch (err) { failureCallback(err); }
}
