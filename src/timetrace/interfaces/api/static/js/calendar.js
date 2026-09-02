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

    const isVirtual = Boolean(s.is_virtual);

    return {
        id: String(s.id),
        title: matchedTask ? matchedTask.title : (s.tags || s.notes || 'Session'),
        start: s.start_time,
        end: s.end_time || new Date().toISOString(),
        backgroundColor: color,
        borderColor: 'transparent',
        classNames: isVirtual ? ['tt-virtual-occurrence'] : [],
        editable: true,
        extendedProps: {
            taskId: s.task_id || null,
            taskTitle: matchedTask ? matchedTask.title : '',
            notes: s.notes || '',
            tags: s.tags || '',
            isVirtual: isVirtual,
            seriesTaskId: s.series_task_id || null
        }
    };
}

function isRecurringCalendarEvent(event) {
    if (!event) return false;
    const props = event.extendedProps || {};
    if (props.isVirtual) return true;
    const taskId = props.taskId;
    if (!taskId || typeof allTasksMap === 'undefined' || !allTasksMap[taskId]) return false;
    return Boolean(allTasksMap[taskId].is_recurring);
}

/**
 * Persist a drag (move) or resize of a calendar event.
 *
 * A projected recurring occurrence carries a synthetic `virt:<task>:<stamp>` id; PUTting it
 * materializes it server-side and returns a real row with a NEW id, so the event has to be
 * swapped out. Resizing an occurrence of a recurring series asks whether the new duration
 * applies to this occurrence only or to all future occurrences (`scope=all_future`, which the
 * API rejects for a move). This function deliberately does NOT touch the task's
 * `estimated_minutes` -- that side effect used to re-trigger session generation and refill the
 * slot the user had just vacated.
 */
async function handleCalendarEventUpdate(event, changeType = 'move', info = null) {
    const startIso = event.start.toISOString();
    const endIso = event.end ? event.end.toISOString() : event.start.toISOString();

    const payload = {
        start_time: startIso,
        end_time: endIso
    };

    const wasVirtual = Boolean(event.extendedProps && event.extendedProps.isVirtual);
    let scope = 'only_this';

    if (changeType === 'resize' && isRecurringCalendarEvent(event)) {
        const choice = typeof showRecurringResizeScopePrompt === 'function'
            ? await showRecurringResizeScopePrompt()
            : 'only_this';
        if (!choice) {
            if (info && typeof info.revert === 'function') info.revert();
            return;
        }
        scope = choice;
    }

    let updatedSession = null;
    try {
        updatedSession = await api.put(
            `/sessions/${encodeURIComponent(event.id)}?scope=${encodeURIComponent(scope)}`,
            payload
        );
    } catch (err) {
        console.error("Failed to update session:", err);
        if (info && typeof info.revert === 'function') info.revert();
        return;
    }

    // A materialized occurrence, or a whole-series duration change, alters what the server would
    // project for this window -- reload the range instead of patching one event locally.
    if (wasVirtual || scope === 'all_future') {
        if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
        if (typeof fetchTasks === 'function') fetchTasks();
        if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        return;
    }

    if (updatedSession && typeof allSessions !== 'undefined' && Array.isArray(allSessions)) {
        const idx = allSessions.findIndex(s => String(s.id) === String(event.id));
        if (idx !== -1) allSessions[idx] = updatedSession;
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
