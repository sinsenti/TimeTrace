/**
 * TimeTrace Utility Helpers, Color Dispersion & Persistence
 */

let defaultPalette = [
    '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#ec4899', '#0284c7', '#0d9488',
    '#4f46e5', '#9333ea', '#16a34a', '#ea580c', '#e11d48', '#c026d3', '#0891b2', '#b45309'
];
let defaultDurationMinutes = parseInt(localStorage.getItem('timetrace_slot_duration') || '15');
let pendingDeleteSessionId = null;

function parseDurationToMinutes(val) {
    if (val === null || val === undefined) return 15;
    const clean = String(val).trim().toLowerCase();
    if (clean === '-' || clean === '' || clean === 'none' || clean === 'null') {
        return null;
    }
    const daysMatch = clean.match(/^(\d+(?:\.\d+)?)\s*(d|day|days)$/);
    if (daysMatch) {
        return Math.round(parseFloat(daysMatch[1]) * 1440);
    }
    const hoursMatch = clean.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)$/);
    if (hoursMatch) {
        return Math.round(parseFloat(hoursMatch[1]) * 60);
    }
    const minsMatch = clean.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)$/);
    if (minsMatch) {
        return Math.round(parseFloat(minsMatch[1]));
    }
    const numMatch = clean.match(/^(\d+(?:\.\d+)?)$/);
    if (numMatch) {
        return Math.round(parseFloat(numMatch[1]));
    }
    return null;
}

function formatMinutesToDuration(mins) {
    if (mins === null || mins === undefined || mins === 0) return '-';
    if (mins >= 1440 && mins % 1440 === 0) {
        return `${mins / 1440}d`;
    }
    if (mins >= 60 && mins % 60 === 0) {
        return `${mins / 60}h`;
    }
    return `${mins}m`;
}

function openNativePicker(pickerId, textInputId) {
    const picker = document.getElementById(pickerId);
    const textInput = document.getElementById(textInputId);
    if (!picker) return;

    if (textInput && textInput.value && textInput.value.trim()) {
        const parsed = parseFlexibleDateInput(textInput.value);
        if (parsed) {
            if (parsed.isTimeSet) {
                const dt = new Date(parsed.isoString);
                if (!isNaN(dt.getTime())) {
                    const pad = (n) => String(n).padStart(2, '0');
                    picker.value = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
                }
            } else {
                picker.value = `${parsed.dateStr}T23:59`;
            }
        }
    } else {
        picker.value = "";
    }

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

function syncPickerToText(pickerId, textInputId) {
    const picker = document.getElementById(pickerId);
    const textInput = document.getElementById(textInputId);
    if (!picker || !textInput || !picker.value) return;

    const val = picker.value;
    if (val.includes('T')) {
        const [datePart, timePart] = val.split('T');
        const cleanTime = timePart.substring(0, 5);
        if (cleanTime === '23:59' || cleanTime === '00:00') {
            textInput.value = datePart;
        } else {
            textInput.value = `${datePart} ${cleanTime}`;
        }
    } else {
        textInput.value = val;
    }
}

function parseFlexibleDateInput(val) {
    if (!val || !val.trim()) return null;
    const clean = val.trim();
    
    const dateOnlyMatch = clean.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateOnlyMatch) {
        return { isTimeSet: false, isoString: `${dateOnlyMatch[1]}T23:59:00`, dateStr: dateOnlyMatch[1] };
    }
    
    const dateTimeMatch = clean.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?$/);
    if (dateTimeMatch) {
        const dt = new Date(`${dateTimeMatch[1]}T${dateTimeMatch[2]}:00`);
        if (!isNaN(dt.getTime())) {
            const isDefaultTime = dateTimeMatch[2] === '23:59' || dateTimeMatch[2] === '00:00';
            return { isTimeSet: !isDefaultTime, isoString: `${dateTimeMatch[1]}T${dateTimeMatch[2]}:00`, dateStr: `${dateTimeMatch[1]} ${dateTimeMatch[2]}` };
        }
    }

    const dt = new Date(clean);
    if (!isNaN(dt.getTime())) {
        const hasTime = clean.includes(":") || clean.includes("T");
        return { isTimeSet: hasTime, isoString: dt.toISOString(), dateStr: clean };
    }

    return null;
}

function formatFlexibleDateForInput(dtStr) {
    if (!dtStr) return '';
    const clean = String(dtStr).trim();
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        return clean;
    }
    
    if (clean.includes('T23:59:00') || clean.includes(' 23:59:00') || clean.includes('T00:00:00') || clean.includes(' 00:00:00')) {
        return clean.split(/[T\s]/)[0];
    }
    
    const parts = clean.split(/[T\s]/);
    if (parts.length >= 2) {
        const timePart = parts[1].substring(0, 5);
        if (timePart === '23:59' || timePart === '00:00') {
            return parts[0];
        }
        const dt = parseApiDateTime(clean);
        if (dt && !isNaN(dt.getTime())) {
            const pad = (n) => String(n).padStart(2, '0');
            const formattedTime = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
            if (formattedTime === '23:59' || formattedTime === '00:00') {
                return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
            }
            return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${formattedTime}`;
        }
        return `${parts[0]} ${timePart}`;
    }
    
    return clean;
}

function getDueAlertStatus(dueDateStr) {
    if (!dueDateStr) return null;
    const clean = String(dueDateStr).trim();
    let dueYear, dueMonth, dueDayNum, dueHours = 0, dueMins = 0, hasTime = false;

    if (clean.includes("T23:59:00") || clean.includes(" 23:59:00") || clean.includes("T00:00:00") || clean.includes(" 00:00:00")) {
        const datePart = clean.split(/[T\s]/)[0];
        const [y, m, d] = datePart.split("-").map(Number);
        dueYear = y; dueMonth = m - 1; dueDayNum = d;
        hasTime = false;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        const [y, m, d] = clean.split("-").map(Number);
        dueYear = y; dueMonth = m - 1; dueDayNum = d;
        hasTime = false;
    } else {
        const dt = parseApiDateTime(clean) || new Date(clean);
        if (!dt || isNaN(dt.getTime())) return null;
        dueYear = dt.getFullYear(); dueMonth = dt.getMonth(); dueDayNum = dt.getDate();
        dueHours = dt.getHours(); dueMins = dt.getMinutes();
        hasTime = !(dueHours === 23 && dueMins === 59) && !(dueHours === 0 && dueMins === 0);
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dueDay = new Date(dueYear, dueMonth, dueDayNum);
    
    const pad = (n) => String(n).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedDateLabel = `${monthNames[dueMonth]} ${dueDayNum}`;
    const timeLabel = hasTime ? ` ${pad(dueHours)}:${pad(dueMins)}` : '';

    if (dueDay < today) {
        return { isUrgent: true, label: `OVERDUE (${formattedDateLabel}${timeLabel})` };
    } else if (dueDay.getTime() === today.getTime()) {
        return { isUrgent: true, label: `Due Today${timeLabel}` };
    } else if (dueDay.getTime() === tomorrow.getTime()) {
        return { isUrgent: true, label: `Due Tomorrow${timeLabel}` };
    } else {
        return { isUrgent: false, label: `Due ${formattedDateLabel}${timeLabel}` };
    }
}

function getTargetDayBadge(assignedDateStr) {
    if (!assignedDateStr) return null;
    const clean = String(assignedDateStr).trim();
    if (!clean) return null;

    let dueYear, dueMonth, dueDayNum, dueHours = 0, dueMins = 0, hasTime = false;

    if (clean.includes("T23:59:00") || clean.includes(" 23:59:00") || clean.includes("T00:00:00") || clean.includes(" 00:00:00")) {
        const datePart = clean.split(/[T\s]/)[0];
        const [y, m, d] = datePart.split("-").map(Number);
        dueYear = y; dueMonth = m - 1; dueDayNum = d;
        hasTime = false;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        const [y, m, d] = clean.split("-").map(Number);
        dueYear = y; dueMonth = m - 1; dueDayNum = d;
        hasTime = false;
    } else {
        const dt = parseApiDateTime(clean) || new Date(clean);
        if (!dt || isNaN(dt.getTime())) return { isUrgent: false, label: `Target: ${clean}` };
        dueYear = dt.getFullYear(); dueMonth = dt.getMonth(); dueDayNum = dt.getDate();
        dueHours = dt.getHours(); dueMins = dt.getMinutes();
        hasTime = !(dueHours === 23 && dueMins === 59) && !(dueHours === 0 && dueMins === 0);
    }

    const pad = (n) => String(n).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedDateLabel = `${monthNames[dueMonth]} ${dueDayNum}`;
    const timeLabel = hasTime ? ` ${pad(dueHours)}:${pad(dueMins)}` : '';

    return { isUrgent: false, label: `Target: ${formattedDateLabel}${timeLabel}` };
}

function getTaskDateBadge(dueDateStr, assignedDateStr) {
    const dueAlert = getDueAlertStatus(dueDateStr);
    if (dueAlert) return dueAlert;
    return getTargetDayBadge(assignedDateStr);
}

window.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
        let closedAny = false;

        const modalOrder = [
            // The drawer is toggled via an 'ai-drawer-open' class (translateX slide), not the
            // 'hidden' class every other entry here uses, hence `openClass` instead of the
            // default hidden-class check below.
            { id: 'ai_drawer', closeFn: typeof closeAiDrawer === 'function' ? closeAiDrawer : null, openClass: 'ai-drawer-open' },
            { id: 'completion_policy_modal', closeFn: typeof closeCompletionPolicyModal === 'function' ? closeCompletionPolicyModal : null },
            { id: 'recurring_delete_modal', closeFn: typeof closeRecurringDeleteModal === 'function' ? closeRecurringDeleteModal : null },
            { id: 'add_status_modal', closeFn: typeof closeAddStatusModal === 'function' ? closeAddStatusModal : null },
            { id: 'subtask_modal', closeFn: typeof closeSubtaskModal === 'function' ? closeSubtaskModal : null },
            { id: 'export_modal', closeFn: typeof closeExportModal === 'function' ? closeExportModal : null },
            { id: 'custom_filter_modal', closeFn: typeof closeCustomFilterModal === 'function' ? closeCustomFilterModal : null },
            { id: 'task_modal', closeFn: typeof closeTaskModal === 'function' ? closeTaskModal : null },
            { id: 'session_modal', closeFn: typeof closeSessionModal === 'function' ? closeSessionModal : null },
            { id: 'habit_modal', closeFn: typeof closeHabitModal === 'function' ? closeHabitModal : null },
            { id: 'settings_modal', closeFn: typeof closeSettingsModal === 'function' ? closeSettingsModal : null },
            { id: 'status_manager_modal', closeFn: typeof closeStatusManagerModal === 'function' ? closeStatusManagerModal : null },
            { id: 'sidebar_tab_config_modal', closeFn: typeof closeSidebarTabsConfigModal === 'function' ? closeSidebarTabsConfigModal : null },
            { id: 'session_review_modal', closeFn: typeof closeSessionReviewModal === 'function' ? closeSessionReviewModal : null },
            { id: 'rating_def_modal', closeFn: typeof closeRatingDefModal === 'function' ? closeRatingDefModal : null },
            { id: 'widget_builder_modal', closeFn: typeof closeWidgetBuilder === 'function' ? closeWidgetBuilder : null },
            { id: 'idle_resolution_modal', closeFn: null },
            { id: 'custom_confirm_modal', closeFn: null }
        ];

        for (const item of modalOrder) {
            const el = document.getElementById(item.id);
            const isOpen = el && (item.openClass ? el.classList.contains(item.openClass) : !el.classList.contains('hidden'));
            if (isOpen) {
                e.preventDefault();
                e.stopPropagation();
                if (item.closeFn) {
                    item.closeFn();
                } else {
                    el.classList.add('hidden');
                }
                closedAny = true;
                break;
            }
        }

        if (closedAny) {
            if (typeof calendar !== 'undefined' && calendar) calendar.unselect();
            if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
        }
    }
}, true);

async function promptDeleteSession(sessionId) {
    if (!sessionId) return;
    pendingDeleteSessionId = sessionId;

    let isRecurring = false;
    if (typeof allSessions !== 'undefined' && Array.isArray(allSessions)) {
        const s = allSessions.find(item => String(item.id) === String(sessionId));
        if (s && s.task_id && typeof allTasksMap !== 'undefined' && allTasksMap[s.task_id]) {
            isRecurring = Boolean(allTasksMap[s.task_id].is_recurring);
        }
    }

    if (isRecurring) {
        const modal = document.getElementById('recurring_delete_modal');
        if (modal) {
            modal.classList.remove('hidden');
            return;
        }
    }

    const confirmed = await showCustomConfirm("Delete Session Log", "Are you sure you want to delete this session log?");
    if (confirmed) {
        confirmRecurringDelete('only_this');
    }
}

function closeRecurringDeleteModal() {
    const modal = document.getElementById('recurring_delete_modal');
    if (modal) modal.classList.add('hidden');
    pendingDeleteSessionId = null;
}

async function confirmRecurringDelete(scope) {
    const sid = pendingDeleteSessionId;
    closeRecurringDeleteModal();
    if (!sid) return;

    try {
        // Ids may be synthetic (`virt:<task>:<stamp>`), so encode before interpolating.
        await api.delete(`/sessions/${encodeURIComponent(sid)}?scope=${encodeURIComponent(scope || 'only_this')}`);

        if (typeof allSessions !== 'undefined' && Array.isArray(allSessions)) {
            allSessions = allSessions.filter(item => String(item.id) !== String(sid));
        }

        if (typeof calendar !== 'undefined' && calendar) {
            const calEv = calendar.getEventById(String(sid));
            if (calEv) calEv.remove();
            // "following"/"all" end or truncate the series, so other projected occurrences in
            // this window disappear too -- only a refetch can show that.
            if (scope === 'following' || scope === 'all') calendar.refetchEvents();
        }

        if (typeof closeSessionModal === 'function') closeSessionModal();
        if (typeof closeSessionReviewModal === 'function') closeSessionReviewModal();
        if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
        if (typeof loadCurrentRevisionView === 'function') loadCurrentRevisionView();
    } catch (err) {
        console.error("Failed to delete session:", err);
    }
}

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) & 0x7FFFFFFF;
    }
    return hash;
}

function getTaskColor(task, index = 0) {
    if (!task) return defaultPalette[0];
    
    if (task.color && task.color !== 'auto' && task.color !== '' && task.color.startsWith('#')) {
        return task.color;
    }
    
    const activePalette = (typeof defaultPalette !== 'undefined' && defaultPalette.length > 0)
        ? defaultPalette
        : ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#ec4899', '#0284c7', '#0d9488'];

    const settings = typeof getUserSettings === 'function' ? getUserSettings() : {};
    const seed = settings.colorSeed || 0;

    const identifier = task.id ? String(task.id) : (task.title || String(index));
    const seedStr = seed ? `_${seed}` : '';
    const hash = hashString(identifier + seedStr);
    
    return activePalette[hash % activePalette.length];
}

function reshuffleColors() {
    const settings = typeof getUserSettings === 'function' ? getUserSettings() : {};
    settings.colorSeed = (settings.colorSeed || 0) + 1;
    if (typeof saveUserSettings === 'function') saveUserSettings(settings);
    
    if (typeof fetchTasks === 'function') fetchTasks();
    if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
    if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
    if (typeof fetchRangeTotals === 'function') fetchRangeTotals();
}

function roundVal(val, decimals) {
    return Number(Math.round(val + 'e' + decimals) + 'e-' + decimals);
}

function getGradeColorClasses(score, minScore = 1, maxScore = 5) {
    const neutral = { text: 'text-slate-400', badge: 'bg-slate-800 text-slate-400 border border-slate-700', hex: '#94a3b8' };

    const numScore = Number(score);
    if (score === null || score === undefined || isNaN(numScore) || maxScore === minScore) {
        return neutral;
    }

    const steps = [
        { text: 'text-red-400', badge: 'bg-red-900/60 text-red-300 border border-red-700', hex: '#f87171' },
        { text: 'text-orange-400', badge: 'bg-orange-900/60 text-orange-300 border border-orange-700', hex: '#fb923c' },
        { text: 'text-amber-400', badge: 'bg-amber-900/60 text-amber-300 border border-amber-700', hex: '#fbbf24' },
        { text: 'text-lime-400', badge: 'bg-lime-900/60 text-lime-300 border border-lime-700', hex: '#a3e635' },
        { text: 'text-emerald-400', badge: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700', hex: '#34d399' }
    ];

    let normalized = (numScore - minScore) / (maxScore - minScore);
    normalized = Math.min(1, Math.max(0, normalized));

    let idx = Math.floor(normalized * steps.length);
    if (idx >= steps.length) idx = steps.length - 1;
    if (idx < 0) idx = 0;

    return steps[idx];
}

function getTagColor(tagStr) {
    let clean = tagStr.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!clean) return defaultPalette[0];
    const settings = typeof getUserSettings === 'function' ? getUserSettings() : {};
    const seed = settings.colorSeed || 0;
    const seedStr = seed ? `_${seed}` : '';
    const hash = hashString(clean + seedStr);
    return defaultPalette[hash % defaultPalette.length];
}

function parseApiDateTime(dtStr) {
    if (!dtStr) return null;
    if (typeof dtStr !== 'string') dtStr = String(dtStr);
    
    const timePart = dtStr.includes('T') ? dtStr.split('T')[1] : dtStr;
    if (!dtStr.endsWith('Z') && !timePart.includes('+') && !timePart.includes('-')) {
        dtStr += 'Z';
    }
    return new Date(dtStr);
}

function formatIsoLocal(dt) {
    if (!dt || isNaN(dt.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function getLocalTodayStr() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getInitialScrollTime() {
    const now = new Date();
    let targetHour = now.getHours() - 1;
    if (targetHour < 0) targetHour = 0;
    return `${String(targetHour).padStart(2, '0')}:00:00`;
}

function getLocalTimezoneLabel() {
    const offsetMins = -new Date().getTimezoneOffset();
    const hours = Math.floor(Math.abs(offsetMins) / 60);
    const sign = offsetMins >= 0 ? '+' : '-';
    return `GMT${sign}${String(hours).padStart(2, '0')}`;
}

function injectTimezoneLabel() {
    setTimeout(() => {
        const cornerCell = document.querySelector('.fc-timegrid-axis-frame');
        if (cornerCell && !cornerCell.querySelector('.tz-header-label')) {
            cornerCell.innerHTML = `<div class="tz-header-label">${getLocalTimezoneLabel()}</div>`;
        }
    }, 50);
}

function setSlotDuration(val, updateSettings = true) {
    let mins = parseInt(val);
    if (isNaN(mins)) {
        const s = typeof getUserSettings === 'function' ? getUserSettings() : {};
        mins = s.lastSelectedSlot || 15;
    } else if (updateSettings) {
        const s = typeof getUserSettings === 'function' ? getUserSettings() : {};
        s.lastSelectedSlot = mins;
        if (typeof saveUserSettings === 'function') saveUserSettings(s);
    }
    defaultDurationMinutes = mins;
    localStorage.setItem('timetrace_slot_duration', defaultDurationMinutes);
    if (typeof calendar !== 'undefined' && calendar) {
        const durStr = `00:${String(defaultDurationMinutes).padStart(2,'0')}:00`;
        calendar.setOption('slotDuration', durStr);
        calendar.setOption('defaultTimedEventDuration', durStr);
    }
}

function adjustStartTime(minutes) {
    const startInput = document.getElementById('session_modal_start');
    if (!startInput || !startInput.value) return;
    const current = new Date(startInput.value);
    current.setMinutes(current.getMinutes() + minutes);
    startInput.value = formatIsoLocal(current);
    updateSessionModalDurationBadge();
}

function setStartTimeNow() {
    const startInput = document.getElementById('session_modal_start');
    if (!startInput) return;
    startInput.value = formatIsoLocal(new Date());
    updateSessionModalDurationBadge();
}

function updateSessionModalDurationBadge() {
    const startInput = document.getElementById('session_modal_start');
    const endInput = document.getElementById('session_modal_end');
    const badge = document.getElementById('session_modal_duration_badge');
    if (!startInput || !endInput || !badge) return;

    if (!startInput.value || !endInput.value) {
        badge.innerText = '0m';
        return;
    }

    const startDt = new Date(startInput.value);
    const endDt = new Date(endInput.value);
    let diffMins = Math.round((endDt - startDt) / 60000);

    if (diffMins <= 0) diffMins = 0;

    if (diffMins < 60) {
        badge.innerText = `${diffMins}m`;
    } else {
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        if (mins === 0) {
            badge.innerText = `${hrs}h`;
        } else if (mins === 30) {
            badge.innerText = `${hrs}.5h`;
        } else {
            badge.innerText = `${hrs}h ${mins}m`;
        }
    }
}

function adjustDurationMinutes(deltaMins) {
    const startInput = document.getElementById('session_modal_start');
    const endInput = document.getElementById('session_modal_end');
    if (!startInput || !endInput) return;

    const startDt = startInput.value ? new Date(startInput.value) : new Date();
    let endDt = endInput.value ? new Date(endInput.value) : new Date(startDt.getTime() + 15 * 60000);

    let newEndMs = endDt.getTime() + deltaMins * 60000;
    if (newEndMs <= startDt.getTime()) {
        newEndMs = startDt.getTime() + 15 * 60000;
    }

    endInput.value = formatIsoLocal(new Date(newEndMs));
    updateSessionModalDurationBadge();
}

/**
 * Ask whether a duration change applies to one occurrence or the whole future series.
 * Resolves to 'only_this', 'all_future', or null when the user cancels.
 * Degrades to window.confirm on pages that do not include confirm_modal.html (e.g. stats.html).
 */
function showRecurringResizeScopePrompt() {
    return new Promise((resolve) => {
        const modal = document.getElementById('recurring_resize_modal');
        if (!modal) {
            const wantsAll = window.confirm(
                "Apply this new duration to ALL FUTURE occurrences?\n\nOK: all future occurrences. Cancel: only this occurrence."
            );
            resolve(wantsAll ? 'all_future' : 'only_this');
            return;
        }

        const onlyBtn = document.getElementById('recurring_resize_only_btn');
        const allBtn = document.getElementById('recurring_resize_all_btn');
        const cancelBtn = document.getElementById('recurring_resize_cancel_btn');
        const closeBtn = document.getElementById('recurring_resize_close_btn');

        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            onlyBtn.removeEventListener('click', onOnly);
            allBtn.removeEventListener('click', onAll);
            cancelBtn.removeEventListener('click', onCancel);
            if (closeBtn) closeBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKeyDown, true);
        };

        const finish = (value) => { cleanup(); resolve(value); };
        const onOnly = () => finish('only_this');
        const onAll = () => finish('all_future');
        const onCancel = () => finish(null);

        const onKeyDown = (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            }
        };

        onlyBtn.addEventListener('click', onOnly);
        allBtn.addEventListener('click', onAll);
        cancelBtn.addEventListener('click', onCancel);
        if (closeBtn) closeBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKeyDown, true);
    });
}

function showCustomConfirm(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom_confirm_modal');
        const titleEl = document.getElementById('confirm_modal_title');
        const msgEl = document.getElementById('confirm_modal_message');
        const cancelBtn = document.getElementById('confirm_modal_cancel_btn');
        const proceedBtn = document.getElementById('confirm_modal_proceed_btn');

        if (!modal) {
            resolve(window.confirm(message));
            return;
        }

        titleEl.innerText = title || "Confirm Action";
        msgEl.innerText = message || "Are you sure you want to proceed?";
        modal.classList.remove('hidden');

        const cleanup = () => {
            modal.classList.add('hidden');
            cancelBtn.removeEventListener('click', onCancel);
            proceedBtn.removeEventListener('click', onProceed);
            document.removeEventListener('keydown', onKeyDown, true);
        };

        const onCancel = () => { cleanup(); resolve(false); };
        const onProceed = () => { cleanup(); resolve(true); };

        const onKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                onProceed();
            } else if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            }
        };

        cancelBtn.addEventListener('click', onCancel);
        proceedBtn.addEventListener('click', onProceed);
        document.addEventListener('keydown', onKeyDown, true);
    });
}
