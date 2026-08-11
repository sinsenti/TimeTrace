let isRunning = false;
let idleDetectionEnabled = true;

async function fetchTimerStatus() {
    try {
        const res = await fetch('/api/v1/timer/status');
        const data = await res.json();
        isRunning = data.is_running;
        idleDetectionEnabled = data.idle_detection_enabled;
        updateIdleSwitchUI();

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
            
            let remTitleStr = '';
            let remPillStr = '';
            if (data.remaining_seconds !== null && data.remaining_seconds !== undefined) {
                const rMins = Math.ceil(data.remaining_seconds / 60);
                remTitleStr = `${rMins}m left - `;
                remPillStr = ` (${rMins}m left)`;
            }

            if (label) label.innerText = `${timeStr}${remPillStr} | ${taskName}`;
            if (btn) {
                btn.innerText = 'Stop';
                btn.className = 'h-6 bg-red-600 hover:bg-red-500 text-white font-semibold px-2.5 rounded text-[11px] whitespace-nowrap';
            }
            document.title = `${remTitleStr}${timeStr} - [${taskName}]`;
        } else {
            const nextSess = data.next_session;
            let idleText = data.is_frozen_idle ? 'Timer Frozen (AFK)' : 'Timer Idle';
            let tabTitle = data.is_frozen_idle ? 'AFK Detected - TimeTrace' : 'TimeTrace Dashboard';
            
            if (!data.is_frozen_idle && nextSess) {
                const startDt = new Date(nextSess.start_time);
                const timeLabel = `${String(startDt.getHours()).padStart(2,'0')}:${String(startDt.getMinutes()).padStart(2,'0')}`;
                idleText = `Next: ${nextSess.title} in ${nextSess.starts_in_minutes}m (at ${timeLabel})`;
                tabTitle = `Next: ${nextSess.title} in ${nextSess.starts_in_minutes}m`;
            }

            if (label) label.innerText = idleText;
            if (btn) {
                btn.innerText = 'Start Timer';
                btn.className = 'h-6 bg-purple-600 hover:bg-purple-500 text-white font-semibold px-2.5 rounded text-[11px] whitespace-nowrap';
            }
            document.title = tabTitle;
        }
    } catch(e) {}
}

async function toggleTimer() {
    if (isRunning) {
        await fetch('/api/v1/timer/stop', { method: 'POST' });
        if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
    } else {
        const taskId = document.getElementById('timer_task_select').value;
        const settings = typeof getUserSettings === 'function' ? getUserSettings() : {};
        await fetch('/api/v1/timer/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId ? parseInt(taskId) : null, tags: settings.defaultTag || "#general" })
        });
    }
    fetchTimerStatus();
}

async function toggleIdleSwitch() {
    const res = await fetch('/api/v1/idle/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json();
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

    await fetch('/api/v1/idle/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option: option, new_tags: newTags })
    });

    const modal = document.getElementById('idle_resolution_modal');
    if (modal) modal.classList.add('hidden');

    fetchTimerStatus();
    if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
}
