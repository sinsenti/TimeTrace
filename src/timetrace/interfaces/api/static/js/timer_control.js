/**
 * Universal TimeTrace Timer Controller & Dynamic Browser Tab Title Manager
 */

let isRunning = false;
let idleDetectionEnabled = true;
let lastTimerData = null;
let globalSessionsCache = [];
let lastSessionsFetchTime = 0;

async function fetchGlobalSessionsIfNeeded() {
    if (typeof allSessions !== 'undefined' && Array.isArray(allSessions) && allSessions.length > 0) {
        globalSessionsCache = allSessions;
        return;
    }
    
    const now = Date.now();
    if (now - lastSessionsFetchTime > 30000 || globalSessionsCache.length === 0) {
        try {
            const data = await api.get('/sessions');
            if (data) {
                globalSessionsCache = data;
                lastSessionsFetchTime = now;
            }
        } catch (e) {}
    }
}

async function fetchTimerStatus() {
    try {
        const data = await api.get('/timer/status');
        if (!data) return;
        
        lastTimerData = data;
        isRunning = data.is_running;
        idleDetectionEnabled = data.idle_detection_enabled;
        
        if (typeof updateIdleSwitchUI === 'function') {
            updateIdleSwitchUI();
        }

        if (data.is_frozen_idle && data.pending_idle_gap) {
            const idleModal = document.getElementById('idle_resolution_modal');
            const idleLabel = document.getElementById('idle_time_summary_label');
            if (idleModal && idleLabel) {
                const idleMins = Math.round((data.pending_idle_gap.idle_seconds || 600) / 60);
                idleLabel.innerText = `You were away for ${idleMins} mins.`;
                idleModal.classList.remove('hidden');
            }
        }

        const label = document.getElementById('timer_status_label');
        const btn = document.getElementById('toggle_btn');

        if (isRunning) {
            const mins = Math.floor(data.elapsed_seconds / 60);
            const secs = data.elapsed_seconds % 60;
            const timeStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
            const taskName = data.task_title || (data.tags || 'Task');

            let remPillStr = '';
            if (data.remaining_seconds !== null && data.remaining_seconds !== undefined) {
                const rMins = Math.ceil(data.remaining_seconds / 60);
                remPillStr = ` (${rMins}m left)`;
            }

            if (label) label.innerText = `${timeStr}${remPillStr} | ${taskName}`;
            if (btn) {
                btn.innerText = 'Stop';
                btn.className = 'h-6 bg-red-600 hover:bg-red-500 text-white font-semibold px-2.5 rounded text-[11px] whitespace-nowrap';
            }
        } else {
            let idleText = data.is_frozen_idle ? 'Timer Frozen (AFK)' : 'Timer Idle';

            if (label) label.innerText = idleText;
            if (btn) {
                btn.innerText = 'Start Timer';
                btn.className = 'h-6 bg-purple-600 hover:bg-purple-500 text-white font-bold px-3 rounded transition text-[10px] whitespace-nowrap';
            }
        }
    } catch(e) {}

    await fetchGlobalSessionsIfNeeded();
    updateDocumentTitle();
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
        const matchedTask = (typeof allTasksMap !== 'undefined' && allTasksMap) ? allTasksMap[currentSession.task_id] : null;
        const titleName = (matchedTask ? matchedTask.title : null) || currentSession.notes || currentSession.tags || 'Current Task';
        document.title = `${minsLeft}m left | ${titleName}`;
        return;
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
            const matchedTask = (typeof allTasksMap !== 'undefined' && allTasksMap) ? allTasksMap[nextSession.task_id] : null;
            const titleName = (matchedTask ? matchedTask.title : null) || nextSession.notes || nextSession.tags || 'Next Task';
            document.title = `in ${minsUntilNext}m | ${titleName}`;
            return;
        }
    }

    document.title = 'TimeTrace';
}

async function toggleTimer() {
    if (isRunning) {
        await api.post('/timer/stop');
        if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
    } else {
        const select = document.getElementById('timer_task_select');
        const taskId = select ? select.value : null;
        const settings = typeof getUserSettings === 'function' ? getUserSettings() : {};
        await api.post('/timer/start', {
            task_id: taskId ? taskId : null,
            tags: settings.defaultTag || "#general"
        });
    }
    fetchTimerStatus();
}

async function toggleIdleSwitch() {
    const data = await api.post('/idle/toggle', {});
    idleDetectionEnabled = data.idle_detection_enabled;
    updateIdleSwitchUI();
}

function updateIdleSwitchUI() {
    const btn = document.getElementById('idle_killer_switch_btn');
    const label = document.getElementById('idle_switch_label');
    if (!btn || !label) return;

    if (idleDetectionEnabled) {
        label.innerText = 'Idle Detector: ON';
        btn.className = 'h-8 bg-[#181a28] hover:bg-[#222536] text-amber-400 border border-amber-500/40 px-3 rounded-lg font-bold transition flex items-center whitespace-nowrap';
    } else {
        label.innerText = 'Idle Detector: OFF';
        btn.className = 'h-8 bg-[#181a28] hover:bg-[#222536] text-slate-500 border border-slate-700 px-3 rounded-lg font-bold transition flex items-center whitespace-nowrap';
    }
}

async function resolveIdleGap(option) {
    const retagInput = document.getElementById('idle_retag_input');
    const newTags = retagInput ? retagInput.value.trim() || '#general' : '#general';

    await api.post('/idle/resolve', { option: option, new_tags: newTags });

    const modal = document.getElementById('idle_resolution_modal');
    if (modal) modal.classList.add('hidden');

    fetchTimerStatus();
    if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
}

document.addEventListener('DOMContentLoaded', () => {
    fetchTimerStatus();
    setInterval(fetchTimerStatus, 3000);
});
