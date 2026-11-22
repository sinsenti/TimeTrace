/** Targeted shared timers. Receipted writes are journaled before HTTP; refresh retries are reads. */
function createTimerController({api, storage, onState, operationId = () => crypto.randomUUID()}) {
    const key = 'timetrace_timer_v2_operation';
    let timers = [], revision = null, receipt = null, pending = false, fresh = false, message = '', lastResult = null;
    try { receipt = JSON.parse(storage.getItem(key) || 'null'); }
    catch (_) { message = 'Timer safety storage unavailable; writes are blocked.'; receipt = {outcome:'storage'}; }
    const snapshot = () => ({timers, revision, receipt, pending, fresh, message, lastResult});
    const publish = () => onState(snapshot());
    async function refresh() {
        try {
            const data = await api.get('/timers');
            if (!Array.isArray(data?.timers)) throw Error('Unknown timer response');
            timers = data.timers; revision = data.revision; fresh = true;
            if (receipt?.outcome === 'acknowledged') { storage.removeItem(key); receipt = null; }
            if (!receipt) message = '';
            publish();
            return data;
        } catch (_) { fresh = false; message = 'Timer status unavailable. Last-known timers retained; retry status.'; publish(); return null; }
    }
    async function write(url, payload, retry = false) {
        if (pending || (receipt && !retry)) return false;
        pending = true; publish();
        try {
            if (!retry) {
                receipt = {url, payload: {...payload, operation_id: operationId()}, outcome:'uncertain'};
                try { storage.setItem(key, JSON.stringify(receipt)); }
                catch (_) { receipt = {outcome:'storage'}; message = 'Safety storage unavailable; no write sent.'; return false; }
            }
            let result;
            try { result = await api.post(receipt.url, receipt.payload); }
            catch (_) { message = 'Outcome uncertain. Check operation status or explicitly retry the same operation.'; return false; }
            if (!result?.operation_id) { message = 'Unrecognized acknowledgement. Check operation status.'; return false; }
            receipt.outcome = 'acknowledged';
            lastResult = result;
            try { storage.setItem(key, JSON.stringify(receipt)); } catch (_) { /* The original fixed request remains retry-safe. */ }
            if (result.timer) timers = [...timers.filter(t => t.id !== result.timer.id), result.timer].filter(t => t.state !== 'stopped');
            message = (result.information || []).map(i => i.code === 'association_not_changed'
                ? 'Selected existing timer; its association and paused/frozen state were not changed.'
                : i.code === 'scheduled_session_ended' ? 'This plan has ended. Work will be recorded without extending it.' : i.code).join(' ');
            const information = message;
            await refresh();
            if (information) message = information;
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('timetrace:timer-mutated', {detail:result}));
            return true;
        } finally { pending = false; publish(); }
    }
    async function recover() {
        if (!receipt?.payload?.operation_id || pending) return;
        try {
            const result = await api.get(`/operations/${encodeURIComponent(receipt.payload.operation_id)}`);
            if (result.status === 'finalized') {
                receipt.outcome = 'acknowledged';
                storage.setItem(key, JSON.stringify(receipt));
                await refresh();
            } else { message = 'Operation needs reconciliation. Retry the same operation to finish recovery.'; publish(); }
        } catch (_) { message = 'Operation not confirmed. Retry only this saved operation, never a new Start/Stop.'; publish(); }
    }
    return {snapshot, refresh, recover,
        retry: () => receipt?.payload && write(receipt.url, receipt.payload, true),
        start: payload => write('/timers', payload),
        act: (id, action, payload = {}) => write(`/timers/${encodeURIComponent(id)}/${action}`, payload)
    };
}

if (typeof module !== 'undefined') module.exports = {createTimerController};

if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const region = document.getElementById('multiple_timers');
        if (!region || window.multipleTimers) return;
        const list = region.querySelector('[data-timer-list]');
        const notice = region.querySelector('[data-timer-message]');
        const tasks = region.querySelector('[data-timer-task]');
        function button(label, action, disabled) {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
            b.disabled = disabled; b.addEventListener('click', action); return b;
        }
        function render(state) {
            notice.textContent = state.message;
            list.replaceChildren();
            const blocked = state.pending || Boolean(state.receipt) || !state.fresh;
            region.querySelector('[data-timer-start]').disabled = blocked;
            for (const timer of state.timers) {
                const row = document.createElement('div'); row.className = 'multiple-timer-row';
                const label = document.createElement('span');
                const seconds = Math.floor(timer.elapsed_seconds || 0);
                label.textContent = `${timer.task_title || timer.notes || 'Unassigned'} · ${timer.id.slice(-8)} · ${timer.state} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')} live`;
                row.append(label);
                const act = (action, payload = {}) => window.multipleTimers.act(timer.id, action, {expected_revision:timer.revision, ...payload});
                row.append(button(timer.state === 'running' ? 'Pause' : 'Resume', () => act(timer.state === 'running' ? 'pause' : 'resume'), blocked || timer.state === 'frozen'));
                row.append(button('Stop & record', () => act('stop'), blocked || timer.state === 'frozen'));
                for (const gap of timer.idle_gaps || []) {
                    if (gap.decision) continue;
                    const text = document.createElement('span');
                    text.textContent = `Idle gap ${gap.id.slice(-8)}: ${new Date(gap.onset).toLocaleString()} — ${gap.return_at ? new Date(gap.return_at).toLocaleString() : 'waiting for observed return'}${gap.boundary_source === 'legacy_uncertain' ? ' (legacy boundary uncertain)' : ''}`;
                    row.append(text);
                    for (const decision of ['claim','discard']) row.append(button(`${decision === 'claim' ? 'Claim' : 'Discard'} gap`,
                        () => act('resolve', {gap_id:gap.id, decision}), blocked || !gap.return_at));
                }
                list.append(row);
            }
            if (state.receipt?.payload) {
                list.append(button('Check saved operation', () => window.multipleTimers.recover(), state.pending));
                list.append(button('Retry same operation', () => window.multipleTimers.retry(), state.pending));
            }
        }
        const control = createTimerController({api, storage:sessionStorage, onState:render});
        window.multipleTimers = control;
        control.perform = async (operation, payload, stillCurrent = () => true) => {
            await control.refresh();
            if (!control.snapshot().fresh || !stillCurrent()) return false;
            const state = control.snapshot();
            if (operation === 'start' || (operation === 'toggle' && state.timers.length !== 1)) return control.start(payload || {});
            if (state.timers.length !== 1) { notice.textContent = 'Choose an explicit timer below; no action sent.'; return false; }
            const timer = state.timers[0];
            if (operation === 'toggle') operation = timer.state === 'running' ? 'stop' : 'resume';
            return control.act(timer.id, operation, {...payload, expected_revision:timer.revision});
        };
        region.querySelector('[data-timer-start]').addEventListener('click', () => control.start({task_id:tasks.value || null,
            pause_when_idle:region.querySelector('[data-timer-idle]').checked}));
        region.querySelector('[data-timer-refresh]').addEventListener('click', () => control.refresh());
        api.get('/api/tasks').then(rows => {
            for (const task of rows) { const option = document.createElement('option'); option.value = task.id; option.textContent = task.title; tasks.append(option); }
        }).catch(() => { notice.textContent = 'Task list unavailable. Taskless timers remain available.'; });
        window.addEventListener('timetrace:timer-mutated', () => {
            if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
            if (typeof agendaPage !== 'undefined') void agendaPage.refresh();
        });
        control.refresh();
        control.recover();
        setInterval(() => { if (!control.snapshot().pending) control.refresh(); }, 3000);
    });
}
