/**
 * FullCalendar Engine & View Event Handlers
 */

let restoringCalendarContext = false;

function syncCalendarContext(replace = false) {
    if (restoringCalendarContext || typeof calendar === 'undefined' || !calendar || !window.location?.href) return;
    const url = new URL(window.location.href);
    const date = calendar.getDate();
    const localDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    url.searchParams.set('date', localDay);
    url.searchParams.set('view', calendar.view.type);
    url.searchParams.delete('tag');
    url.searchParams.delete('task');
    if (typeof breakdownFilter !== 'undefined' && breakdownFilter) {
        url.searchParams.set(breakdownFilter.type, breakdownFilter.value);
    }
    if (url.href !== window.location.href) {
        if (replace) history.replaceState(null, '', url);
        else history.pushState(null, '', url);
    }
}

function restoreCalendarContext() {
    if (typeof calendar === 'undefined' || !calendar) return;
    const params = new URLSearchParams(window.location.search);
    const tag = params.get('tag');
    const task = params.get('task');
    breakdownFilter = tag ? { type: 'tag', value: tag } : task ? { type: 'task', value: task } : null;
    const settings = getUserSettings();
    const view = params.get('view');
    const validView = SUPPORTED_CALENDAR_VIEWS.includes(view);
    restoringCalendarContext = true;
    try {
        calendar.changeView(validView ? view : settings.lastSelectedView, params.get('date') || undefined);
        renderBreakdownLists();
        renderBreakdownFilterChip();
        calendar.refetchEvents();
    } finally {
        restoringCalendarContext = false;
    }
}

function createPlanningSession(taskId = null) {
    if (!calendar) return;
    const date = new Date(calendar.getDate());
    const now = new Date();
    date.setHours(now.getHours(), Math.floor(now.getMinutes() / 15) * 15, 0, 0);
    openCreateSessionModal(date, null, taskId);
}

function filterPlanningTasks(query) {
    const text = query.trim().toLocaleLowerCase();
    let visible = 0;
    document.querySelectorAll('#task_card_list .task-card').forEach(card => {
        card.hidden = !card.dataset.taskTitle.toLocaleLowerCase().includes(text);
        if (!card.hidden) visible++;
    });
    const count = document.getElementById('selected_tasks_count');
    if (count) count.textContent = text && !visible ? 'No matching tasks' : `${visible} task${visible === 1 ? '' : 's'}`;
}

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
    for (const [button, view] of [[btnDay, 'timeGridDay'], [btnThreeDay, 'timeGridThreeDay'], [btnWeek, 'timeGridWeek'], [btnMonth, 'dayGridMonth']]) {
        if (button) button.setAttribute('aria-pressed', String(view === activeViewType));
    }
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
    const matchedTask = s.task_id ? taskKnowledge.get(s.task_id) : null;
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

async function isRecurringCalendarEvent(event) {
    const props = event.extendedProps || {};
    if (props.isVirtual || props.seriesTaskId || String(event.id).startsWith('virt:')) return true;
    return taskKnowledge.recurrenceFor(props.taskId);
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

    const wasVirtual = Boolean(event.extendedProps && event.extendedProps.isVirtual) || String(event.id).startsWith('virt:');
    let scope = 'only_this';

    const recurring = changeType === 'resize' ? await isRecurringCalendarEvent(event) : false;
    if (recurring === null) {
        if (info && typeof info.revert === 'function') info.revert();
        alert('Cannot verify task recurrence. Try resizing again to retry the lookup. No changes were saved.');
        return;
    }
    if (recurring) {
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

    // Commit the returned identity before fallible range reads or a second user gesture.
    rememberSavedSession(updatedSession, event.id, event);
    if (wasVirtual || scope === 'all_future') {
        await refreshSessionDisplay();
    } else {
        try {
            if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        } catch (err) {
            taskKnowledge.viewResult('calendar', false);
        }
    }
}

async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
    const generation = taskKnowledge.state().generation;
    try {
        if (typeof fetchAllTasksRegistry === 'function') await fetchAllTasksRegistry();
        const res = await api.get(`/sessions?start=${fetchInfo.start.toISOString()}&end=${fetchInfo.end.toISOString()}`);
        const current = generation === taskKnowledge.state().generation;
        if (current) allSessions = res || [];
        // Settle superseded FullCalendar requests with the last-known display, not old rows.

        const visibleForCalendar = typeof sessionMatchesBreakdownFilter === 'function'
            ? allSessions.filter(sessionMatchesBreakdownFilter)
            : allSessions;

        const events = visibleForCalendar.map((s, idx) => formatCalEventFromSession(s, idx));
        successCallback(events);
        if (!current) return;
        if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        if (typeof updateDocumentTitle === 'function') updateDocumentTitle();
        taskKnowledge.viewResult('calendar', true);
    } catch (err) {
        if (generation === taskKnowledge.state().generation) taskKnowledge.viewResult('calendar', false);
        failureCallback(err);
    }
}

function rememberSavedSession(savedSession, previousId, event = null) {
    if (!savedSession) return;
    if (typeof allSessions !== 'undefined' && Array.isArray(allSessions)) {
        const idx = allSessions.findIndex(s => String(s.id) === String(previousId));
        if (idx !== -1) allSessions[idx] = savedSession;
        else allSessions.push(savedSession);
    }
    taskKnowledge.invalidate();
    if (!event && typeof calendar !== 'undefined' && calendar?.getEventById) {
        event = calendar.getEventById(String(previousId));
    }
    if (event && String(event.id) !== String(savedSession.id)) {
        event.setProp?.('id', String(savedSession.id));
        event.setExtendedProp?.('isVirtual', false);
        event.setProp?.('classNames', []);
    }
}

// Refresh-only recovery uses the shared notice; it must never replay a session mutation.
async function refreshSessionDisplay() {
    try {
        await taskKnowledge.refresh();
        if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        if (typeof updateDocumentTitle === 'function') updateDocumentTitle();
    } catch (err) {
        console.error('Session saved, but display refresh failed:', err);
        taskKnowledge.viewResult('calendar', false);
    }
}
