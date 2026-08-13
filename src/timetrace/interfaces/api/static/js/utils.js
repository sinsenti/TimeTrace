/**
 * TimeTrace Utility Helpers & Hash Color Dispersion Engine
 */

let defaultPalette = [
    '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#ec4899', '#0284c7', '#0d9488',
    '#4f46e5', '#9333ea', '#16a34a', '#ea580c', '#e11d48', '#c026d3', '#0891b2', '#b45309'
];
let defaultDurationMinutes = parseInt(localStorage.getItem('timetrace_slot_duration') || '15');

/**
 * Polynomial Rolling Hash Dispersion Engine with Seed Offset Support
 */
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

    const title = task.title || '';
    if (title.length > 0) {
        const seedStr = seed ? `_${seed}` : '';
        const hash = hashString(title + seedStr);
        return activePalette[hash % activePalette.length];
    }
    
    return activePalette[(index + seed) % activePalette.length];
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

// Fast Time Steppers & Duration Controls
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
            } else if (e.key === 'Escape') {
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
