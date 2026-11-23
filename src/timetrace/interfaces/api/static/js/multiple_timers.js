/** Targeted shared timers. Receipted writes are journaled before HTTP; refresh retries are reads. */
function createTimerController({api, storage, onState, operationId = () => crypto.randomUUID()}) {
    const key = 'timetrace_timer_v2_operation';
    let timers = [], revision = null, receipt = null, pending = false, fresh = false, message = '', lastResult = null;
    let informationNotice = '';
    try {
        receipt = JSON.parse(storage.getItem(key) || 'null');
        const legacy = JSON.parse(storage.getItem('timetrace_timer_receipt') || 'null');
        if (legacy && legacy.outcome !== 'acknowledged' && !receipt) {
            receipt = {outcome:'legacy'};
            message = 'A legacy timer write is unconfirmed. Use the existing Calendar verification hold before starting new work.';
        }
    }
    catch (_) { message = 'Timer safety storage unavailable; writes are blocked.'; receipt = {outcome:'storage'}; }
    const snapshot = () => ({timers, revision, receipt, pending, fresh, message, lastResult});
    const publish = () => onState(snapshot());
    async function refresh() {
        try {
            const data = await api.get('/timers');
            if (!Array.isArray(data?.timers)) throw Error('Unknown timer response');
            timers = data.timers; revision = data.revision; fresh = true;
            if (receipt?.outcome === 'legacy' && !storage.getItem('timetrace_timer_receipt')) receipt = null;
            if (receipt?.outcome === 'acknowledged') { storage.removeItem(key); receipt = null; }
            if (!receipt) {
                const legacy = JSON.parse(storage.getItem('timetrace_timer_receipt') || 'null');
                if (legacy && legacy.outcome !== 'acknowledged') {
                    receipt = {outcome:'legacy'};
                    message = 'A legacy timer write is unconfirmed. Verify it in the existing Calendar recovery hold.';
                } else message = informationNotice;
            }
            publish();
            return data;
        } catch (_) { fresh = false; message = 'Timer status unavailable. Last-known timers retained; retry status.'; publish(); return null; }
    }
    async function write(url, payload, retry = false) {
        if (pending || (receipt && !retry)) return false;
        pending = true; publish();
        try {
            if (!retry) {
                informationNotice = ''; message = '';
                receipt = {url, payload: {...payload, operation_id: operationId()}, outcome:'uncertain'};
                try { storage.setItem(key, JSON.stringify(receipt)); }
                catch (_) { receipt = {outcome:'storage'}; message = 'Safety storage unavailable; no write sent.'; return false; }
            }
            let result;
            try { result = await api.post(receipt.url, receipt.payload); }
            catch (error) {
                // A definite rejection plus serialized operation-not-found proves THIS request
                // has no intent/receipt. A lost response alone never permits clearing its journal.
                if ([400,404,409,422].includes(error.status) && error.code !== 'reconciliation_required' && error.code !== 'operation_payload_mismatch') {
                    try { await api.get(`/operations/${encodeURIComponent(receipt.payload.operation_id)}`); }
                    catch (lookup) {
                        if (lookup.status === 404) {
                            storage.removeItem(key); receipt = null;
                            informationNotice = error.message || 'Timer action refused. Refresh and choose again.';
                            message = informationNotice;
                            return false;
                        }
                    }
                }
                message = 'Outcome uncertain. Check operation status or explicitly retry the same operation.'; return false;
            }
            if (!result?.operation_id) { message = 'Unrecognized acknowledgement. Check operation status.'; return false; }
            receipt.outcome = 'acknowledged';
            lastResult = result;
            try { storage.setItem(key, JSON.stringify(receipt)); } catch (_) { /* The original fixed request remains retry-safe. */ }
            if (result.timer) timers = [...timers.filter(t => t.id !== result.timer.id), result.timer].filter(t => t.state !== 'stopped');
            message = (result.information || []).map(i => i.code === 'association_not_changed'
                ? 'Selected existing timer; its association and paused/frozen state were not changed.'
                : i.code === 'scheduled_session_ended' ? 'This plan has ended. Work will be recorded without extending it.' : i.code).join(' ');
            const information = message;
            informationNotice = information;
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
                lastResult = result.result;
                receipt.outcome = 'acknowledged';
                storage.setItem(key, JSON.stringify(receipt));
                if (lastResult?.timer) timers = [...timers.filter(t => t.id !== lastResult.timer.id), lastResult.timer].filter(t => t.state !== 'stopped');
                await refresh();
                if (typeof window !== 'undefined' && lastResult) window.dispatchEvent(new CustomEvent('timetrace:timer-mutated', {detail:lastResult}));
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
    let ready;
    window.multipleTimersReady = new Promise(resolve => { ready = resolve; });
    document.addEventListener('DOMContentLoaded', () => {
        const region = document.getElementById('multiple_timers');
        if (!region || window.multipleTimers) { ready(); return; }
        const list = region.querySelector('[data-timer-list]');
        const notice = region.querySelector('[data-timer-message]');
        const tasks = region.querySelector('[data-timer-task]');
        function button(label, action, disabled, focusKey = '') {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
            b.dataset.timerFocus = focusKey;
            b.disabled = disabled; b.addEventListener('click', action); return b;
        }
        let renderedSignature = null, restoreFocus = null;
        const timerLabel = timer => {
            const seconds = Math.floor(timer.elapsed_seconds || 0);
            const remaining = timer.remaining_seconds == null ? '' : ` (${Math.ceil(timer.remaining_seconds / 60)}m left)`;
            return `${timer.task_title || timer.notes || 'Unassigned'} · ${timer.id.slice(-8)} · ${timer.state} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')} live${remaining}`;
        };
        function render(state) {
            notice.textContent = state.message;
            const focused = list.contains(document.activeElement) ? document.activeElement.dataset.timerFocus : null;
            if (focused) restoreFocus = focused;
            const blocked = state.pending || Boolean(state.receipt) || !state.fresh;
            region.querySelector('[data-timer-start]').disabled = blocked;
            const signature = JSON.stringify([state.pending, state.fresh, state.receipt?.outcome,
                state.timers.map(({elapsed_seconds, remaining_seconds, ...timer}) => timer)]);
            if (signature === renderedSignature) {
                for (const label of list.querySelectorAll('[data-timer-label]')) {
                    const timer = state.timers.find(t => t.id === label.dataset.timerLabel);
                    if (timer) label.textContent = timerLabel(timer);
                }
                return;
            }
            renderedSignature = signature;
            list.replaceChildren();
            for (const timer of state.timers) {
                const row = document.createElement('div'); row.className = 'multiple-timer-row';
                const label = document.createElement('span');
                label.dataset.timerLabel = timer.id;
                label.textContent = timerLabel(timer);
                row.append(label);
                if (timer.scheduled_session_id && document.getElementById('agenda-extension')) {
                    row.append(button('Extend selected plan', () => window.dispatchEvent(new CustomEvent('extend-selected-plan',
                        {detail:{planId:timer.scheduled_session_id, timerId:timer.id}})), blocked, `${timer.id}/extend-plan`));
                }
                const act = (action, payload = {}) => window.multipleTimers.act(timer.id, action, {expected_revision:timer.revision, ...payload});
                row.append(button(timer.state === 'running' ? 'Pause' : 'Resume', () => act(timer.state === 'running' ? 'pause' : 'resume'), blocked || timer.state === 'frozen', `${timer.id}/pause-resume`));
                row.append(button('Stop & record', () => act('stop'), blocked || timer.state === 'frozen', `${timer.id}/stop`));
                for (const gap of timer.idle_gaps || []) {
                    if (gap.decision) continue;
                    const text = document.createElement('span');
                    text.textContent = `Idle gap ${gap.id.slice(-8)}: ${new Date(gap.onset).toLocaleString()} — ${gap.return_at ? new Date(gap.return_at).toLocaleString() : 'waiting for observed return'}${gap.boundary_source === 'legacy_uncertain' ? ' (legacy boundary uncertain)' : ''}`;
                    row.append(text);
                    for (const decision of ['claim','discard']) row.append(button(`${decision === 'claim' ? 'Claim' : 'Discard'} gap`,
                        () => act('resolve', {gap_id:gap.id, decision}), blocked || !gap.return_at || (decision === 'claim' && gap.boundary_source === 'legacy_uncertain'), `${timer.id}/${gap.id}/${decision}`));
                }
                list.append(row);
            }
            if (state.receipt?.payload) {
                list.append(button('Check saved operation', () => window.multipleTimers.recover(), state.pending, 'receipt/check'));
                list.append(button('Retry same operation', () => window.multipleTimers.retry(), state.pending, 'receipt/retry'));
            }
            if (restoreFocus && !state.pending) {
                const next = [...list.querySelectorAll('button')].find(b => b.dataset.timerFocus === restoreFocus && !b.disabled);
                (next || region.querySelector('[data-timer-refresh]')).focus({preventScroll:true});
                restoreFocus = null;
            }
        }
        const control = createTimerController({api, storage:sessionStorage, onState:render});
        window.multipleTimers = control;
        ready();
        control.perform = async (operation, payload, stillCurrent = () => true) => {
            await control.refresh();
            if (!control.snapshot().fresh || !stillCurrent()) return false;
            const state = control.snapshot();
            if (operation === 'start' || (operation === 'toggle' && state.timers.length !== 1)) return control.start(payload || {});
            if (state.timers.length !== 1) { notice.textContent = 'Choose an explicit timer below; no action sent.'; return false; }
            const timer = state.timers[0];
            if (operation === 'toggle' && timer.state === 'frozen') {
                region.scrollIntoView({block:'nearest'}); region.tabIndex = -1; region.focus(); return false;
            }
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
