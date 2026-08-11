let defaultPalette = ['#7c3aed', '#2563eb', '#d97706', '#dc2626', '#059669', '#ec4899', '#0284c7', '#0d9488'];
let defaultDurationMinutes = parseInt(localStorage.getItem('timetrace_slot_duration') || '15');

function parseApiDateTime(dtStr) {
    if (!dtStr) return null;
    if (typeof dtStr !== 'string') dtStr = String(dtStr);
    
    // Check if the time portion contains a timezone offset or 'Z'
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

function getTagColor(tagStr) {
    let clean = tagStr.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (!clean) return defaultPalette[0];
    let hash = 0;
    for (let i = 0; i < clean.length; i++) hash += clean.charCodeAt(i);
    return defaultPalette[hash % defaultPalette.length];
}

function setSlotDuration(val) {
    defaultDurationMinutes = parseInt(val) || 15;
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
}

function setStartTimeNow() {
    const startInput = document.getElementById('session_modal_start');
    if (!startInput) return;
    startInput.value = formatIsoLocal(new Date());
}

function setDurationFromStart(minutes) {
    const startInput = document.getElementById('session_modal_start');
    const endInput = document.getElementById('session_modal_end');
    if (!startInput || !endInput) return;

    const startDt = startInput.value ? new Date(startInput.value) : new Date();
    const endDt = new Date(startDt.getTime() + minutes * 60000);
    endInput.value = formatIsoLocal(endDt);
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
        };

        const onCancel = () => { cleanup(); resolve(false); };
        const onProceed = () => { cleanup(); resolve(true); };

        cancelBtn.addEventListener('click', onCancel);
        proceedBtn.addEventListener('click', onProceed);
    });
}
