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
    openCreateSessionModal(date, null, taskId, "", "calendar");
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
        editable: s.kind !== 'recorded_work',
        extendedProps: {
            kind: s.kind || 'legacy_uncertain',
            revision: s.revision ?? null,
            projectionRevision: s.projection_revision ?? null,
            originalStart: s.original_start ?? null,
            originalEnd: s.original_end ?? null,
            occurrenceStart: s.occurrence_start ?? null,
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
    if (props.kind === 'scheduled_session') return false;
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
let calendarDisplayRows = [];
let calendarReadVersion = 0;
const calendarWrites = new Set();
const calendarNeedsReview = new Map();

function calendarOccurrenceId(id, seriesTaskId, occurrenceStart) {
    if (id?.startsWith('virt:')) return id;
    // Date rounds to milliseconds; reject fractional anchor text before converting.
    if (!seriesTaskId || !occurrenceStart || /\.\d*[1-9]\d*(?:Z|[+-]\d\d:\d\d)$/.test(occurrenceStart)) return null;
    const stamp = new Date(occurrenceStart).toISOString();
    return `virt:${seriesTaskId}:${stamp.replace(/[-:]/g, '').replace('.000Z', 'Z')}`;
}

function calendarScheduleNeedsReview(row) {
    if (!row) return false;
    const occurrence = calendarOccurrenceId(row.id, row.series_task_id, row.occurrence_start);
    const key = occurrence || row.id;
    const editor = typeof sessionModalOwner !== 'undefined' ? sessionModalOwner : null;
    const editing = editor?.session;
    const editingKey = editing && (calendarOccurrenceId(editing.id, editing.series_task_id, editing.occurrence_start) || editing.id);
    return calendarWrites.has(key) || (editor?.pending && editingKey === key) || calendarNeedsReview.has(key) ||
        [...calendarNeedsReview.values()].some(attempt => attempt.latest?.id === row.id);
}

function renderCalendarScheduleReviews() {
    const root = document.getElementById('calendar_schedule_reviews');
    if (!root) return;
    const focused = document.activeElement?.dataset?.reviewKey;
    root.textContent = '';
    const interval = row => `${new Date(row.start_time).toLocaleString()} — ${new Date(row.end_time).toLocaleString()}`;
    for (const [key, attempt] of calendarNeedsReview) {
        const panel = document.createElement('section');
        const notice = document.createElement('p');
        notice.setAttribute('role', 'status');
        notice.textContent = `${attempt.title}: ${attempt.uncertain ? 'Save not confirmed.' : 'Schedule changed.'} ` +
            `Attempted ${interval(attempt.payload)}. ` + (attempt.latest ? `Latest saved: ${interval(attempt.latest)}.`
                : attempt.latest === null ? 'This entry is no longer available. Check Calendar for its replacement.' : attempt.error || 'Read the saved state before editing again.');
        panel.appendChild(notice);
        const button = (key, label, click) => {
            const control = document.createElement('button');
            control.type = 'button';
            control.className = 'underline mr-3';
            control.textContent = label;
            control.dataset.reviewKey = `${attempt.id}:${key}`;
            control.addEventListener('click', click);
            panel.appendChild(control);
            return control;
        };
        const read = button('read', 'Read latest schedule', async () => {
            if (attempt.reading) return;
            attempt.reading = true;
            try {
                const path = attempt.occurrence ? `/agenda/occurrences/${encodeURIComponent(attempt.occurrence)}`
                    : `/scheduled-sessions/${encodeURIComponent(attempt.id)}`;
                const latest = await api.get(path);
                const latestKey = attempt.occurrence
                    ? calendarOccurrenceId(latest?.id, latest?.series_task_id, latest?.occurrence_start) : latest?.id;
                if (latestKey !== key) throw Error('Schedule identity mismatch');
                attempt.latest = latest;
            } catch (err) {
                attempt.latest = err.status === 404 ? null : undefined;
                attempt.error = 'Could not read saved schedule. Retry the read.';
            } finally {
                attempt.reading = false;
            }
            if (calendarNeedsReview.get(key) === attempt) renderCalendarScheduleReviews();
        });
        const done = attempt.latest !== undefined && button('done', 'Reviewed — discard attempt', () => {
            if (attempt.reading || calendarNeedsReview.get(key) !== attempt) return;
            calendarNeedsReview.delete(key);
            renderCalendarScheduleReviews();
            const region = document.getElementById('calendar');
            if (document.activeElement === document.body && region) {
                region.setAttribute('tabindex', '-1');
                region.focus({ preventScroll: true });
            }
            void refreshSessionDisplay();
        });
        root.appendChild(panel);
        for (const control of [read, done]) if (control && control.dataset.reviewKey === focused) control.focus();
    }
    root.hidden = !calendarNeedsReview.size;
}

function calendarSessionRows() {
    return calendarDisplayRows;
}

async function handleCalendarEventUpdate(event, changeType = 'move', info = null) {
    const id = event.id;
    const props = event.extendedProps || {};
    const typed = props.kind === 'scheduled_session';
    const occurrence = calendarOccurrenceId(id, props.seriesTaskId, props.occurrenceStart);
    const key = occurrence || id;
    if (calendarWrites.has(key) || calendarScheduleNeedsReview({ id, series_task_id: props.seriesTaskId,
        occurrence_start: props.occurrenceStart }) || props.kind === 'recorded_work') {
        info?.revert?.();
        return;
    }
    const payload = { start_time: event.start.toISOString(), end_time: (event.end || event.start).toISOString() };
    const wasVirtual = Boolean(props.isVirtual) || String(id).startsWith('virt:');
    const target = { id, is_virtual: wasVirtual, revision: props.revision, projection_revision: props.projectionRevision };
    let scope = 'only_this';
    let reconcile = false;
    let updatedSession;
    calendarWrites.add(key);
    try {
        const recurring = changeType === 'resize' ? await isRecurringCalendarEvent(event) : false;
        if (recurring === null) {
            info?.revert?.();
            window.appDialogs.alert({message:'Cannot verify task recurrence. Try resizing again to retry the lookup. No changes were saved.'});
            return;
        }
        if (recurring) {
            scope = typeof showRecurringResizeScopePrompt === 'function' ? await showRecurringResizeScopePrompt() : null;
            if (!scope) { info?.revert?.(); return; }
        }
        updatedSession = typed ? await api.saveScheduledSession(target, payload, scope)
            : await api.put(`/sessions/${encodeURIComponent(id)}?scope=${encodeURIComponent(scope)}`, payload);
    } catch (err) {
        info?.revert?.();
        if (typed) {
            const uncertain = !err.status || err.status >= 500;
            reconcile = uncertain || err.status === 409;
            if (reconcile) {
                calendarNeedsReview.set(key, { id, occurrence, title: event.title || 'Scheduled session', payload, uncertain });
                renderCalendarScheduleReviews();
            } else window.appDialogs.alert({message:err.message});
        } else console.error('Failed to update session:', err);
    } finally {
        calendarWrites.delete(key);
    }
    if (!updatedSession) {
        if (reconcile) await refreshSessionDisplay();
        return;
    }
    rememberSavedSession(updatedSession, id, event);
    if (typed || wasVirtual || scope === 'all_future') await refreshSessionDisplay();
    else {
        try {
            if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        } catch (err) {
            taskKnowledge.viewResult('calendar', false);
        }
    }
}

async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
    const generation = taskKnowledge.state().generation;
    const version = ++calendarReadVersion;
    const current = () => generation === taskKnowledge.state().generation && version === calendarReadVersion;
    const query = `start=${fetchInfo.start.toISOString()}&end=${fetchInfo.end.toISOString()}`;
    try {
        if (typeof fetchAllTasksRegistry === 'function') await fetchAllTasksRegistry();
        const [legacy, planning] = await Promise.allSettled([api.get(`/sessions?${query}`), api.get(`/agenda?${query}&legacy_cohort=start`)]);
        if (current() && Array.isArray(legacy.value)) allSessions = legacy.value;
        if (!Array.isArray(planning.value?.items)) throw planning.reason || new Error('Invalid calendar range response');
        if (current()) {
            // The display must never mix two database snapshots of the same occurrence.
            calendarDisplayRows = planning.value.items.filter(row => row.kind === 'scheduled_session' ||
                (Date.parse(row.start_time) >= +fetchInfo.start && Date.parse(row.start_time) < +fetchInfo.end));
        }
        const rows = calendarSessionRows();
        const visible = typeof sessionMatchesBreakdownFilter === 'function' ? rows.filter(sessionMatchesBreakdownFilter) : rows;
        successCallback(visible.map(formatCalEventFromSession));
        if (!current()) return;
        if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        if (typeof updateDocumentTitle === 'function') updateDocumentTitle();
        taskKnowledge.viewResult('calendar', Array.isArray(legacy.value));
    } catch (err) {
        if (current()) taskKnowledge.viewResult('calendar', false);
        failureCallback(err);
    }
}

function forgetCalendarPlanningRow(id) {
    calendarDisplayRows = calendarDisplayRows.filter(row => row.id !== id);
}

function rememberSavedSession(savedSession, previousId, event = null) {
    if (!savedSession) return;
    const typed = savedSession.kind === 'scheduled_session';
    if (typeof allSessions !== 'undefined' && Array.isArray(allSessions)) {
        if (typed && String(previousId).startsWith('virt:')) {
            allSessions = allSessions.filter(row => row.id !== previousId);
        }
        if (!typed) {
            const index = allSessions.findIndex(row => row.id === previousId);
            if (index !== -1) allSessions[index] = savedSession;
            else allSessions.push(savedSession);
        }
    }
    calendarDisplayRows = calendarDisplayRows.filter(row => row.id !== previousId && row.id !== savedSession.id);
    calendarDisplayRows.push(savedSession);
    taskKnowledge.invalidate();
    if (!event && typeof calendar !== 'undefined' && calendar?.getEventById) event = calendar.getEventById(String(previousId));
    if (event) {
        const formatted = formatCalEventFromSession(savedSession, 0);
        if (String(event.id) !== formatted.id) event.setProp?.('id', formatted.id);
        for (const [key, value] of Object.entries(formatted.extendedProps)) event.setExtendedProp?.(key, value);
        event.setProp?.('classNames', formatted.classNames);
        if (typed && savedSession.start_time && savedSession.end_time) event.setDates?.(savedSession.start_time, savedSession.end_time);
    }
}

// Timer receipts own recording. Adopt their plan identity before any fallible range GET.
window.addEventListener('timetrace:timer-mutated', async event => {
    ++calendarReadVersion; // Fence in-flight ranges at the authoritative ACK, before any fallible GET.
    const result = event.detail;
    const finalPlans = result?.schedule?.parts || (result?.replacement?.plan ? [result.replacement.plan] : []);
    for (const plan of finalPlans) {
        rememberSavedSession(plan,plan.id);
        if (typeof sessionModalOwner !== 'undefined' && sessionModalOwner?.session?.id === plan.id) {
            sessionModalOwner.session = plan;
            sessionModalOwner.latest = plan;
            sessionModalOwner.blocked = true;
            sessionModalFeedback('Stop updated this schedule. Your input is retained. Explicitly use saved times before another edit.');
            document.getElementById('session_modal_use_latest')?.classList.remove('hidden');
            setSessionSavePending(sessionModalOwner,false);
        }
    }
    const previousId = result?.requested_scheduled_session_id || result?.timer?.scheduled_session_id;
    const row = calendarSessionRows().find(row => row.id === previousId && row.kind === 'scheduled_session');
    if (row && result.plan_revision) {
        const saved = {...row, id: result.captured_plan_id || row.id, revision: result.plan_revision,
            is_virtual: false, projection_revision: null};
        rememberSavedSession(saved, previousId);
        if (typeof sessionModalOwner !== 'undefined' && sessionModalOwner?.session?.id === previousId) {
            sessionModalOwner.session = saved;
            document.getElementById('edit_session_id').value = saved.id;
            showSessionModalPlan(saved);
        }
    }
    await refreshSessionDisplay();
});

window.addEventListener('timetrace:plan-removal-acknowledged', async event => {
    ++calendarReadVersion;
    const result = event.detail;
    if (result.plan) rememberSavedSession(result.plan,result.plan.id);
    if (['remove_schedule','delete_everything'].includes(result.action)) {
        forgetCalendarPlanningRow(result.plan_id);
        if (typeof sessionModalOwner !== 'undefined' && sessionModalOwner?.session?.id === result.plan_id) closeSessionModal();
    }
    await refreshSessionDisplay();
});

window.addEventListener('timetrace:recording-acknowledged', async event => {
    ++calendarReadVersion;
    acknowledgeCalendarRecording(event.detail);
    await refreshSessionDisplay();
});

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
