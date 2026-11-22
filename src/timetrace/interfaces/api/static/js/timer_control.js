/** Shared file-timer status and explicit recovery. No timer write is automatically replayed. */
let isRunning = false;
let idleDetectionEnabled = null;
let idleSwitchPending = false;
let lastTimerData = null;
let globalSessionsCache = [];
let lastSessionsFetchTime = 0;
let timerActionPending = false;
let timerReadVersion = 0;
let timerStatusFresh = false;
let timerNotice = '';
let timerRecoveryLauncher = null;
let timerDismissedGap = null;
const timerReceiptKey = 'timetrace_timer_receipt';
let timerReceipt = null;
try {
    const stored = sessionStorage.getItem(timerReceiptKey);
    if (stored) timerReceipt = JSON.parse(stored);
} catch (_) {
    timerNotice = 'Timer safety storage unavailable. Timer writes are blocked until storage is available.';
    timerReceipt = { operation: 'storage', outcome: 'uncertain' };
}

function timerGapIdentity(data) {
    const gap = data?.pending_idle_gap;
    return gap ? `${gap.idle_start}/${gap.idle_end}` : null;
}

function renderTimerState() {
    const data = lastTimerData;
    const gap = data?.pending_idle_gap;
    const blocked = timerActionPending || Boolean(timerReceipt) || !timerStatusFresh;
    let text = 'Loading timer status…';
    if (data?.multiple_count > 1) text = `${data.multiple_count} independent timers · use targeted controls`;
    else if (data?.is_running) {
        const seconds = data.elapsed_seconds || 0;
        const remaining = data.remaining_seconds == null ? '' : ` (${Math.ceil(data.remaining_seconds / 60)}m left)`;
        text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}${remaining} | ${data.task_title || data.notes || data.tags || 'Active timer'}`;
    } else if (gap || data?.is_frozen_idle) text = 'Timer frozen · recovery required';
    else if (data) text = 'Timer idle';
    if (data && !timerStatusFresh) text += ' · last known';
    const label = document.getElementById('timer_status_label');
    if (label) label.textContent = text;
    const button = document.getElementById('toggle_btn');
    if (button) {
        button.textContent = gap || data?.is_frozen_idle ? 'Review idle time' : data?.is_running ? 'Stop' : 'Start Timer';
        button.disabled = blocked;
    }
    const notice = document.getElementById('timer_recovery_notice');
    let message = timerNotice;
    if (timerReceipt?.operation === 'storage') message = 'Timer safety storage unavailable. Timer writes are blocked until storage is available.';
    else if (timerReceipt?.outcome === 'acknowledged') message = 'Timer write acknowledged. Status refresh is pending or failed. Retry reads only; do not repeat the write.';
    else if (timerReceipt && timerReceipt.operation !== 'storage') {
        message = `Timer ${timerReceipt.operation} outcome uncertain; partial work may already be logged. Timer writes are blocked in this tab. Check and correct the interval in Calendar before acknowledging. No automatic retry.`;
        if (timerReceipt.start) message += ` Interval: ${timerReceipt.start} — ${timerReceipt.end || 'time of action'}.`;
    }
    if (!message && gap) message = 'Timer frozen. Review the captured idle interval before starting another timer.';
    if (notice) notice.classList.toggle('hidden', !message);
    const noticeText = document.getElementById('timer_notice_text');
    if (noticeText) noticeText.textContent = message;
    const manual = document.getElementById('timer_manual_ack');
    if (manual) {
        manual.classList.toggle('hidden', !timerReceipt || timerReceipt.outcome === 'acknowledged');
        manual.disabled = timerActionPending;
    }
    const open = document.getElementById('timer_recovery_open');
    if (open) open.classList.toggle('hidden', !gap);
    const modal = document.getElementById('idle_resolution_modal');
    if (modal) {
        modal.setAttribute('aria-busy', String(timerActionPending));
        for (const control of modal.querySelectorAll('[data-timer-write]')) control.disabled = blocked;
    }
    const feedback = document.getElementById('idle_resolution_feedback');
    if (feedback) feedback.textContent = message;
    const summary = document.getElementById('idle_time_summary_label');
    if (summary && gap) {
        const duration = Math.max(0, Math.round((new Date(gap.idle_end) - new Date(gap.idle_start)) / 60000));
        summary.textContent = `${duration} minutes captured: ${new Date(gap.idle_start).toLocaleString()} — ${new Date(gap.idle_end).toLocaleString()}. ${gap.task_title || gap.saved_session?.task_title || gap.tags || 'Unattached timer'}`;
    }
    updateIdleSwitchUI();
    updateDocumentTitle();
}

async function fetchGlobalSessionsIfNeeded() {
    if (typeof allSessions !== 'undefined' && Array.isArray(allSessions) && allSessions.length) {
        globalSessionsCache = allSessions;
        return;
    }
    if (Date.now() - lastSessionsFetchTime < 30000) return;
    try {
        const data = await api.get('/sessions');
        if (Array.isArray(data)) { globalSessionsCache = data; lastSessionsFetchTime = Date.now(); }
    } catch (_) { /* Optional title hints must not replace authoritative timer state. */ }
}

async function readTimerStatus(actionRead = false) {
    if (timerActionPending && !actionRead) return null;
    const version = ++timerReadVersion;
    try {
        if (window.multipleTimersReady) await window.multipleTimersReady;
        let data;
        if (window.multipleTimers) {
            const status = await window.multipleTimers.refresh();
            if (!status) throw new Error('Timer status unavailable');
            const timer = status.timers.length === 1 ? status.timers[0] : {};
            data = {...timer, is_running:timer.state === 'running', is_frozen_idle:timer.state === 'frozen',
                idle_detection_enabled:status.idle_detection_enabled, pending_idle_gap:null,
                elapsed_seconds:Math.floor(timer.elapsed_seconds || 0), multiple_count:status.timers.length,
                start_time:timer.running_start, remaining_seconds:timer.remaining_seconds ?? null};
        } else data = await api.get('/timer/status');
        if (version !== timerReadVersion) return null;
        if (!data || typeof data.is_running !== 'boolean' || typeof data.is_frozen_idle !== 'boolean') throw new Error('Unknown timer status');
        lastTimerData = data;
        isRunning = data.is_running;
        idleDetectionEnabled = typeof data.idle_detection_enabled === 'boolean' ? data.idle_detection_enabled : null;
        timerStatusFresh = true;
        timerNotice = '';
        if (timerReceipt?.outcome === 'acknowledged') {
            sessionStorage.removeItem(timerReceiptKey);
            timerReceipt = null;
        }
        renderTimerState();
        if (data.pending_idle_gap && timerDismissedGap !== timerGapIdentity(data) && !timerReceipt) openIdleResolution();
        return data;
    } catch (_) {
        if (version !== timerReadVersion) return null;
        timerStatusFresh = false;
        timerNotice = 'Timer status unavailable. Last-known state is retained. Retry status before acting.';
        renderTimerState();
        return null;
    }
}

async function fetchTimerStatus() {
    const data = await readTimerStatus();
    // Auxiliary reads are never part of a write's acknowledgment boundary.
    if (data && !timerActionPending) { await fetchGlobalSessionsIfNeeded(); updateDocumentTitle(); }
    return data;
}

async function retryTimerRead() {
    return fetchTimerStatus();
}

function updateDocumentTitle() {
    const now = new Date();

    if (lastTimerData && lastTimerData.is_running) {
        const taskName = lastTimerData.task_title || lastTimerData.notes || lastTimerData.tags || 'Active Session';
        if (lastTimerData.mode === 'pomodoro' && lastTimerData.remaining_seconds !== null && lastTimerData.remaining_seconds !== undefined) {
            const minsLeft = Math.max(0, Math.ceil(lastTimerData.remaining_seconds / 60));
            document.title = `${minsLeft}m left | ${taskName}`;
        } else {
            const minsElapsed = Math.floor(lastTimerData.elapsed_seconds / 60);
            document.title = `${minsElapsed}m | ${taskName}`;
        }
        return;
    }

    if (lastTimerData && lastTimerData.is_frozen_idle) {
        document.title = 'AFK Frozen | TimeTrace';
        return;
    }

    const sessions = (typeof allSessions !== 'undefined' && Array.isArray(allSessions) && allSessions.length > 0)
        ? allSessions
        : globalSessionsCache;

    const currentSession = sessions.find(s => {
        const start = new Date(s.start_time);
        const end = s.end_time ? new Date(s.end_time) : new Date(start.getTime() + 15 * 60000);
        return start <= now && now <= end;
    });

    if (currentSession) {
        const end = currentSession.end_time ? new Date(currentSession.end_time) : new Date(now.getTime() + 15 * 60000);
        const minsLeft = Math.max(1, Math.ceil((end - now) / 60000));
        const matchedTask = typeof taskKnowledge !== 'undefined' ? taskKnowledge.get(currentSession.task_id) : null;
        const titleName = (matchedTask ? matchedTask.title : null) || currentSession.notes || currentSession.tags || 'Current Task';
        document.title = `${minsLeft}m left | ${titleName}`;
        return;
    }

    if (lastTimerData?.next_scheduled_session || lastTimerData?.next_session) {
        const next = lastTimerData.next_scheduled_session || lastTimerData.next_session;
        const minutes = Math.max(1, Math.ceil((new Date(next.start_time) - now) / 60000));
        if (minutes <= 300) {
            document.title = `in ${minutes}m | ${next.title || 'Next Task'}`;
            return;
        }
    }

    const upcomingSessions = sessions
        .filter(s => new Date(s.start_time) > now)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    if (upcomingSessions.length > 0) {
        const nextSession = upcomingSessions[0];
        const nextStart = new Date(nextSession.start_time);
        const diffMs = nextStart - now;
        const minsUntilNext = Math.max(1, Math.ceil(diffMs / 60000));
        const hoursUntilNext = diffMs / (1000 * 60 * 60);

        if (hoursUntilNext <= 5) {
            const matchedTask = typeof taskKnowledge !== 'undefined' ? taskKnowledge.get(nextSession.task_id) : null;
            const titleName = (matchedTask ? matchedTask.title : null) || nextSession.notes || nextSession.tags || 'Next Task';
            document.title = `in ${minsUntilNext}m | ${titleName}`;
            return;
        }
    }

    document.title = 'TimeTrace';
}

// Shared by Calendar and Session Timer Now; status preflight is not a cross-client lock.
async function performTimerAction(operation, payload, stillCurrent = () => true, recoveryLauncher = null) {
    if (window.multipleTimers) return window.multipleTimers.perform(operation, payload, stillCurrent);
    if (timerActionPending || timerReceipt) { renderTimerState(); return false; }
    const checkpoint = operation === 'resolve' && payload?.option === 're_tag' && typeof settingsDraftCheckpoint === 'function'
        ? settingsDraftCheckpoint('idle_resolution_modal') : null;
    timerActionPending = true;
    ++timerReadVersion; // Invalidate a poll begun before this action.
    renderTimerState();
    try {
        const data = await readTimerStatus(true);
        if (!data) return false;
        if (!stillCurrent()) {
            timerNotice = 'Timer or editor changed while checking status. Review the current state and choose again. No write was sent.';
            return false;
        }
        if (operation === 'toggle') operation = data.is_running ? 'stop' : 'start';
        if (operation !== 'resolve' && (data.pending_idle_gap || data.is_frozen_idle)) {
            openIdleResolution(recoveryLauncher);
            return false;
        }
        if (operation === 'resolve' && !data.pending_idle_gap) return false;
        if (operation === 'start' && data.is_running) {
            timerNotice = 'A timer is already running. Stop it explicitly before starting another.';
            return false;
        }
        const gap = data.pending_idle_gap;
        const receipt = { operation, outcome: 'uncertain', task_id: gap?.task_id || data.task_id || payload?.task_id || null,
            start: gap?.saved_session?.start_time || gap?.idle_start || data.start_time || new Date().toISOString(),
            end: gap?.idle_end || new Date().toISOString() };
        try {
            // Journal before HTTP, so navigation/lost responses cannot silently enable a repeat.
            sessionStorage.setItem(timerReceiptKey, JSON.stringify(receipt));
        } catch (_) {
            timerNotice = 'Timer safety storage unavailable. No timer write was sent. Enable session storage, then retry status.';
            return false;
        }
        timerReceipt = receipt;
        renderTimerState();
        try {
            await api.post(operation === 'resolve' ? '/idle/resolve' : `/timer/${operation}`, payload);
        } catch (_) {
            // The shared client cannot classify rejection versus partial commit/lost response.
            return false;
        }
        checkpoint?.();
        timerReceipt.outcome = 'acknowledged';
        try { sessionStorage.setItem(timerReceiptKey, JSON.stringify(timerReceipt)); } catch (_) { /* Existing uncertain journal remains conservative on reload. */ }
        ++timerReadVersion;
        await readTimerStatus(true);
        if (operation === 'resolve') closeIdleResolution();
        if (typeof calendar !== 'undefined' && calendar) {
            try { calendar.refetchEvents(); } catch (_) {
                timerNotice = 'Timer write acknowledged. Calendar refresh failed; reload Calendar to verify saved rows. Do not repeat the write.';
            }
        }
        return true;
    } finally {
        timerActionPending = false;
        renderTimerState();
    }
}

function timerActionIdentity(data) {
    if (!data) return null;
    return timerGapIdentity(data) || (data.is_running ? `running/${data.start_time}/${data.task_id}` : 'stopped');
}

async function toggleTimer() {
    const select = document.getElementById('timer_task_select');
    const expected = timerActionIdentity(lastTimerData);
    return performTimerAction('toggle', { task_id: select?.value || null, tags: '' },
        () => !expected || timerActionIdentity(lastTimerData) === expected);
}

async function startTimerFromSession(payload, stillCurrent, recoveryLauncher) {
    return performTimerAction('start', payload, stillCurrent, recoveryLauncher);
}

function openIdleResolution(launcher = null) {
    const modal = document.getElementById('idle_resolution_modal');
    if (!modal) return;
    if (launcher) timerRecoveryLauncher = launcher;
    if (modal.classList.contains('hidden')) {
        if (!launcher) timerRecoveryLauncher = document.activeElement;
        modal.classList.remove('hidden');
        const higherConfirmationOpen = ['recurring_delete_modal', 'recurring_resize_modal', 'custom_confirm_modal'].some(id => {
            const confirmation = document.getElementById(id);
            return confirmation && !confirmation.classList.contains('hidden');
        });
        if (!higherConfirmationOpen) document.getElementById('idle_resolution_title')?.focus();
    }
    renderTimerState();
}

function closeIdleResolution() {
    const modal = document.getElementById('idle_resolution_modal');
    const wasOpen = modal && !modal.classList.contains('hidden');
    modal?.classList.add('hidden');
    timerDismissedGap = timerGapIdentity(lastTimerData);
    if (!wasOpen) return; // Late ACK/refresh must not restore a dismissed owner's old launcher.
    const launcher = typeof timerRecoveryLauncher === 'function' ? timerRecoveryLauncher() : timerRecoveryLauncher;
    if (launcher?.isConnected && !launcher.disabled) launcher.focus();
    else document.getElementById('timer_recovery_open')?.focus();
}

function acknowledgeTimerVerification() {
    if (timerActionPending || !timerReceipt || timerReceipt.outcome === 'acknowledged') return;
    try {
        sessionStorage.removeItem(timerReceiptKey);
        timerReceipt = null;
        timerNotice = 'Client safety hold cleared by your verification only. No data changed. Choose any next action separately; do not repeat already logged work.';
    } catch (_) {
        timerNotice = 'Safety hold could not be cleared: session storage unavailable.';
    }
    renderTimerState();
}

async function toggleIdleSwitch() {
    if (idleSwitchPending) return;
    idleSwitchPending = true;
    updateIdleSwitchUI();
    try {
        const current = await readTimerStatus();
        if (!current || typeof current.idle_detection_enabled !== 'boolean') return;
        const data = await api.post('/idle/toggle', {});
        ++timerReadVersion; // A read begun before the ACK cannot replace it.
        if (typeof data?.idle_detection_enabled !== 'boolean') {
            timerStatusFresh = false;
            throw new Error('Idle detection change was not confirmed. Retry status before acting.');
        }
        idleDetectionEnabled = data.idle_detection_enabled;
    } catch (error) {
        timerStatusFresh = false;
        throw error;
    } finally {
        idleSwitchPending = false;
        updateIdleSwitchUI();
    }
}

function updateIdleSwitchUI() {
    const btn = document.getElementById('idle_killer_switch_btn');
    const label = document.getElementById('idle_switch_label');
    if (!btn || !label) return;

    const known = typeof idleDetectionEnabled === 'boolean';
    btn.disabled = idleSwitchPending || !timerStatusFresh || !known;
    if (!known) {
        label.innerText = 'Idle Detector: unknown';
        btn.className = 'h-8 bg-[#181a28] text-slate-400 border border-slate-700 px-3 rounded-lg font-bold flex items-center whitespace-nowrap';
        return;
    }
    const suffix = timerStatusFresh ? '' : ' · last known';
    if (idleDetectionEnabled) {
        label.innerText = `Idle Detector: ON${suffix}`;
        btn.className = 'h-8 bg-[#181a28] hover:bg-[#222536] text-amber-400 border border-amber-500/40 px-3 rounded-lg font-bold transition flex items-center whitespace-nowrap';
    } else {
        label.innerText = `Idle Detector: OFF${suffix}`;
        btn.className = 'h-8 bg-[#181a28] hover:bg-[#222536] text-slate-500 border border-slate-700 px-3 rounded-lg font-bold transition flex items-center whitespace-nowrap';
    }
}

async function resolveIdleGap(option) {
    if (!['break', 'claim_work', 're_tag', 'skip'].includes(option)) return false;
    const expected = timerGapIdentity(lastTimerData);
    return performTimerAction('resolve', {
        option, new_tags: document.getElementById('idle_retag_input')?.value.trim() || '',
        new_notes: document.getElementById('idle_retag_notes')?.value || ''
    }, () => !expected || timerGapIdentity(lastTimerData) === expected);
}

// Existing five pages include this controller at the footer; navbar supplies only the two missing pages.
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('idle_resolution_modal');
    const notice = document.getElementById('timer_recovery_notice');
    // Navbar lives inside headers; recovery must escape their stacking/scroll/clipping context.
    if (modal) {
        document.body.append(modal);
        modal.dataset.settingsDraftRetained = 'true';
        if (typeof rememberSettingsDraft === 'function') rememberSettingsDraft('idle_resolution_modal');
    }
    if (notice) document.body.append(notice);
    window.addEventListener('keydown', e => {
        // Earlier window capture can consume Escape without stopping later listeners here.
        if (e.defaultPrevented || !modal || modal.classList.contains('hidden') || !['Escape', 'Esc'].includes(e.key)) return;
        if (['recurring_delete_modal', 'recurring_resize_modal', 'custom_confirm_modal'].some(id => {
            const confirmation = document.getElementById(id);
            return confirmation && !confirmation.classList.contains('hidden');
        })) return;
        e.preventDefault();
        e.stopPropagation();
        closeIdleResolution();
    }, true);
    modal?.addEventListener('keydown', e => {
        // Recovery typing must not submit Preferences or another underlying editor.
        if (e.ctrlKey && e.key === 'Enter') e.stopPropagation();
        if (e.key === 'Tab') {
            const controls = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]')]
                .filter(el => el.offsetParent !== null);
            if (e.shiftKey && (document.activeElement === controls[0] || document.activeElement.id === 'idle_resolution_title')) {
                e.preventDefault(); controls.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === controls.at(-1)) {
                e.preventDefault(); controls[0]?.focus();
            }
        }
    });
    renderTimerState();
    fetchTimerStatus();
    setInterval(fetchTimerStatus, 3000);
});
