/** Targeted shared timers. Receipted writes are journaled before HTTP; refresh retries are reads. */
function createTimerController({api, storage, onState, operationId = () => crypto.randomUUID()}) {
    const key = 'timetrace_timer_v2_operation';
    let timers = [], revision = null, receipt = null, pending = false, fresh = false, message = '', lastResult = null;
    let informationNotice = '', readGeneration = 0, selectedTimerId = null, selectionGeneration = 0, writeGeneration = 0;
    try {
        receipt = JSON.parse(storage.getItem(key) || 'null');
        const legacy = JSON.parse(storage.getItem('timetrace_timer_receipt') || 'null');
        if (legacy && legacy.outcome !== 'acknowledged' && !receipt) {
            receipt = {outcome:'legacy'};
            message = 'A legacy timer write is unconfirmed. Use the existing Calendar verification hold before starting new work.';
        }
    }
    catch (_) { message = 'Timer safety storage unavailable; writes are blocked.'; receipt = {outcome:'storage'}; }
    try { selectedTimerId = storage.getItem('timetrace_timer_selected') || null; } catch (_) { /* Display preference only. */ }
    let observedAt = null;
    const snapshot = () => ({timers, revision, receipt, pending, fresh, message, lastResult, selectedTimerId, observed_at:observedAt});
    const publish = () => {
        const state = snapshot();
        onState(state);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('timetrace:timer-state', {detail:state}));
    };
    async function refresh() {
        const generation = ++readGeneration;
        try {
            const data = await api.get('/timers');
            if (generation !== readGeneration) return null;
            if (!Array.isArray(data?.timers)) throw Error('Unknown timer response');
            timers = data.timers; revision = data.revision; fresh = true; observedAt = data.observed_at;
            if (!timers.some(timer => timer.id === selectedTimerId)) selectedTimerId = timers[0]?.id || null;
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
        } catch (_) {
            if (generation !== readGeneration) return null;
            fresh = false; message = 'Timer status unavailable. Last-known timers retained; retry status.'; publish(); return null;
        }
    }
    async function write(url, payload, retry = false, onAcknowledged = null, selectResult = true) {
        if (pending || (receipt && receipt.outcome !== 'acknowledged' && !retry)) return false;
        const ownership = ++writeGeneration;
        ++readGeneration; // Pre-write reads must never restore obsolete timer/gap state.
        pending = true; publish();
        let acknowledged = false;
        const selectionAtStart = selectionGeneration;
        try {
            if (!retry) {
                informationNotice = ''; message = '';
                receipt = {url, payload: JSON.parse(JSON.stringify({...payload, operation_id: operationId()})), outcome:'uncertain'};
                try { storage.setItem(key, JSON.stringify(receipt)); }
                catch (_) { receipt = {outcome:'storage'}; message = 'Safety storage unavailable; no write sent.'; return false; }
            }
            publish();
            let result;
            try { result = await api.post(receipt.url, receipt.payload); }
            catch (error) {
                // A definite rejection plus serialized operation-not-found proves THIS request
                // has no intent/receipt. A lost response alone never permits clearing its journal.
                if ([400,404,409,422].includes(error.status) && error.code !== 'reconciliation_required' && error.code !== 'operation_payload_mismatch') {
                    pending = false; publish(); // A status GET must not own the writer phase.
                    try { await api.get(`/operations/${encodeURIComponent(receipt.payload.operation_id)}`); }
                    catch (lookup) {
                        if (ownership !== writeGeneration) return false;
                        if (receipt?.outcome === 'acknowledged') return true;
                        if (lookup.status === 404) {
                            storage.removeItem(key); receipt = null;
                            informationNotice = error.message || 'Timer action refused. Refresh and choose again.';
                            message = informationNotice;
                            return false;
                        }
                    }
                }
                if (ownership !== writeGeneration) return false;
                if (receipt?.outcome === 'acknowledged') return true;
                message = 'Outcome uncertain. Check operation status or explicitly retry the same operation.'; return false;
            }
            if (result?.operation_id !== receipt.payload.operation_id) { message = 'Unrecognized acknowledgement. Check operation status.'; return false; }
            ++readGeneration;
            observedAt = null;
            receipt.outcome = 'acknowledged';
            lastResult = result;
            if (selectResult && !receipt.url.endsWith('/correction') && result.timer && result.timer.state !== 'stopped' && selectionAtStart === selectionGeneration) {
                selectedTimerId = result.timer.id;
                try {storage.setItem('timetrace_timer_selected',selectedTimerId);}catch(_){/* Non-authoritative display preference. */}
            }
            try { storage.setItem(key, JSON.stringify(receipt)); } catch (_) { /* The original fixed request remains retry-safe. */ }
            if (result.timer) timers = [...timers.filter(t => t.id !== result.timer.id), result.timer].filter(t => t.state !== 'stopped');
            message = (result.information || []).map(i => i.code === 'association_not_changed'
                ? 'Selected existing timer; its association and paused/frozen state were not changed.'
                : i.code === 'scheduled_session_ended' ? 'This plan has ended. Work will be recorded without extending it.' : i.code).join(' ');
            informationNotice = message;
            // ACK is a writer checkpoint, not a status read. Release the request phase
            // and notify owners before a display GET can fail or remain pending forever.
            acknowledged = true; pending = false; fresh = false;
            if (onAcknowledged) onAcknowledged(result);
            publish();
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('timetrace:timer-mutated', {detail:result}));
            void refresh();
            return true;
        } finally { if (!acknowledged && ownership === writeGeneration) pending = false; publish(); }
    }
    async function recover() {
        if (!receipt?.payload?.operation_id || pending) return;
        if (receipt.outcome === 'acknowledged' && receipt.url.endsWith('/correction')) return refresh();
        const recovering = receipt;
        try {
            const result = await api.get(`/operations/${encodeURIComponent(recovering.payload.operation_id)}`);
            if (receipt !== recovering || pending) return;
            if (receipt.outcome === 'acknowledged' && receipt.url.endsWith('/correction')) return refresh();
            if (result.status === 'finalized') {
                ++readGeneration;
                observedAt = null;
                lastResult = result.result;
                if (lastResult?.correction) { informationNotice = 'Saved correction acknowledged from authoritative operation status; subsequent recovery retries are reads only.'; message = informationNotice; }
                if (!recovering.url.endsWith('/correction') && lastResult?.timer && lastResult.timer.state !== 'stopped' && selectionGeneration === 0) selectedTimerId = lastResult.timer.id;
                receipt.outcome = 'acknowledged';
                try { storage.setItem(key, JSON.stringify(receipt)); } catch (_) { /* Retain the original journal, as for a direct ACK. */ }
                if (lastResult?.timer) timers = [...timers.filter(t => t.id !== lastResult.timer.id), lastResult.timer].filter(t => t.state !== 'stopped');
                fresh = false; publish();
                if (typeof window !== 'undefined' && lastResult) window.dispatchEvent(new CustomEvent('timetrace:timer-mutated', {detail:lastResult}));
                void refresh();
            } else { message = 'Operation needs reconciliation. Retry the same operation to finish recovery.'; publish(); }
        } catch (_) { if (receipt !== recovering || pending) return; message = 'Operation not confirmed. Retry only this saved operation, never a new Start/Stop.'; publish(); }
    }
    async function review(choices) {
        const acknowledged = [];
        for (const choice of choices) {
            if (!fresh || pending || receipt) break;
            const {timer_id, gap_id, decision, expected_revision} = choice;
            if (!await write(`/timers/${encodeURIComponent(timer_id)}/resolve`, {gap_id, decision, expected_revision})) break;
            acknowledged.push(gap_id);
        }
        return {acknowledged, remaining:choices.map(c => c.gap_id).filter(id => !acknowledged.includes(id))};
    }
    return {snapshot, refresh, recover, review,
        initializeFocus:()=>write('/timer-focus/initialize',{},false,null,false),
        saveFocusDefaults:({enabled,work_minutes,break_minutes,behavior,sound_enabled,expected_revision},onAcknowledged=null)=>write('/timer-focus/defaults',
            {enabled,work_minutes,break_minutes,behavior,sound_enabled,expected_revision},false,onAcknowledged,false),
        select: id => {
            if (!timers.some(timer => timer.id === id)) return false;
            selectionGeneration++; selectedTimerId = id;
            try {storage.setItem('timetrace_timer_selected',id);}catch(_){/* Display preference only; safety journal is independent. */}
            publish(); return true;
        },
        retry: () => receipt?.outcome === 'acknowledged' ? refresh() : receipt?.payload && write(receipt.url, receipt.payload, true),
        initializeCorrections: () => write('/timers/correction-initialize', {}),
        previewCorrection: (resource, request) => {
            if (pending || (receipt && receipt.outcome !== 'acknowledged')) return Promise.reject(Error('Finish timer recovery before previewing corrections.'));
            if (!/^\/(timers|recorded-work)\/[^/]+$/.test(resource)) return Promise.reject(Error('Choose an explicit correction resource.'));
            return api.post(`${resource}/correction-preview`, request);
        },
        commitCorrection: (resource, preview) => {
            if (!/^\/(timers|recorded-work)\/[^/]+$/.test(resource) || preview?.resource !== resource) return Promise.reject(Error('Correction resource does not match approval.'));
            return write(`${resource}/correction`, {preview}, false, null, false);
        },
        start: payload => write('/timers', payload),
        act: (id, action, payload = {}, onAcknowledged = null) => write(`/timers/${encodeURIComponent(id)}/${action}`, payload, false, onAcknowledged)
    };
}

function createTimerStartFocus({interaction, guarded, focus}) {
    let intent = null;
    return state => {
        const receipt = state.receipt;
        if (receipt?.url !== '/timers') return;
        const id = receipt.payload?.operation_id;
        if (state.pending && receipt.outcome === 'uncertain' && intent?.id !== id) intent = {id, interaction:interaction()};
        if (receipt.outcome === 'acknowledged' && intent?.id === id) {
            const safe = intent.interaction === interaction() && !guarded();
            intent = null;
            if (safe) focus();
        }
    };
}

function timerWorkspaceClock(timer, fresh) {
    if (!Number.isFinite(timer.elapsed_seconds)) return `Credited total awaiting authoritative read · ${timer.state}`;
    return `${Math.floor(timer.elapsed_seconds / 60)}:${String(Math.floor(timer.elapsed_seconds) % 60).padStart(2,'0')} ${fresh ? 'live' : 'last known'} · ${timer.state}`;
}
function renderTimerWorkspaceCard(root, state, control) {
    const create = (tag, text) => {
        const node = root.ownerDocument.createElement(tag); node.textContent = text; return node;
    };
    const timer = state.timers.find(timer => timer.id === state.selectedTimerId);
    const signature = JSON.stringify([state.selectedTimerId, state.pending, state.fresh, Boolean(state.receipt), timer && {...timer, elapsed_seconds:0, remaining_seconds:0}]);
    if (root.dataset.workspaceSignature === signature && timer) {
        root.querySelector('.workspace-clock').firstChild.textContent = timerWorkspaceClock(timer, state.fresh);
        return;
    }
    root.dataset.workspaceSignature = signature;
    root.replaceChildren();
    if (!timer) { root.append(create('p', 'Choose an activity or start unassigned recording.')); return; }
    const title = create('h2', timer.task_title || (timer.task_id ? `Task ${timer.task_id.slice(-8)} · title awaiting read` : 'Unassigned recording'));
    const clock = create('p', timerWorkspaceClock(timer, state.fresh));
    clock.className = 'workspace-clock';
    clock.dataset.timerCorrectionClock = ''; // #61 owns circular step controls beside this clock.
    const row = create('div', ''); row.className = 'workspace-actions';
    if (timer.task_id && control?.editTask) {
        const edit = create('button', 'Edit task'); edit.type = 'button';
        edit.addEventListener('click', () => control.editTask(timer.task_id)); row.append(edit);
    }
    row.dataset.timerCorrectionActions = ''; // #61 owns reviewed Adjust time wiring.
    const ackOwnsTimer = state.receipt?.outcome === 'acknowledged' && state.lastResult?.timer?.id === timer.id && state.lastResult.timer.revision === timer.revision;
    const blocked = state.pending || Boolean(state.receipt && state.receipt.outcome !== 'acknowledged') || (!state.fresh && !ackOwnsTimer) || timer.state === 'frozen' || (timer.idle_gaps || []).some(g=>!g.decision);
    if (control?.correctTime) {
        const target = timer.state === 'running' ? {start_time:timer.running_start} : (timer.segments || []).find(s=>s.id === timer.manual_pause_note_segment_id && !s.recorded_work_id);
        for (const [symbol,delta] of [['−',-300],['+',300]]) {
            const step=create('button',symbol); step.type='button'; step.className='correction-step';
            step.title=`${delta > 0 ? 'Add' : 'Remove'} five credited minutes by moving the start of ${target?.start_time || 'an explicitly selected actual interval'} ${delta > 0 ? 'earlier' : 'later'}; preview before applying.`;
            step.setAttribute('aria-label',step.title);
            step.disabled=blocked || !target?.start_time;
            step.addEventListener('click',()=>control.correctTime(timer,{kind:'step_start',credited_delta_seconds:delta})); clock.append(step);
        }
        const adjust=create('button','Adjust time'); adjust.type='button'; adjust.disabled=blocked;
        adjust.addEventListener('click',()=>control.correctTime(timer)); row.append(adjust);
        if (timer.state === 'frozen' || (timer.idle_gaps || []).some(g=>!g.decision)) {
            const review=create('a','Review idle time'); review.href='#multiple_timers'; row.append(review);
        }
    }
    for (const [label, action] of [[timer.state === 'running' ? 'Pause' : 'Resume', timer.state === 'running' ? 'pause' : 'resume'], ['Stop & record', 'stop']]) {
        const button = create('button', label); button.type = 'button'; button.disabled = blocked;
        button.addEventListener('click', () => control.act(timer.id, action, {expected_revision:timer.revision}));
        row.append(button);
    }
    root.append(title, clock, row);
}

function guardTimerWorkspaceNavigation(event) {
    if(typeof hasSettingsDrafts==='function'&&hasSettingsDrafts()&&!window.confirm('Leave unsaved editor changes to open the timer workspace?'))event.preventDefault();
}
const timerStripExpansion=new WeakMap();
function renderTimerStripStatus(root,state) {
    const selected=root.querySelector('[data-timer-selected]');if(!selected)return;
    const timer=state.timers.find(t=>t.id===state.selectedTimerId);
    selected.onclick=guardTimerWorkspaceNavigation;
    selected.textContent=timer?`${timer.task_title||'Unassigned'} · ${timerWorkspaceClock(timer,state.fresh)}`:'Open timer workspace';
    selected.href=timer?`/agenda-view?${new URLSearchParams({timer:timer.id})}`:'/agenda-view';
    root.querySelector('[data-timer-count]').textContent=`Other timers · ${state.timers.filter(t=>t.id!==state.selectedTimerId).length}${state.receipt?' · Operation recovery':''}`;
    const expander=root.querySelector('[data-timer-expander]');
    const recovery=Boolean(state.receipt&&!state.pending&&state.receipt.outcome!=='acknowledged')||state.timers.some(t=>t.state==='frozen'||(t.idle_gaps||[]).some(g=>!g.decision));
    if(recovery&&!expander.open){expander.open=true;timerStripExpansion.set(root,true);}
    else if(!recovery&&timerStripExpansion.get(root)){expander.open=false;timerStripExpansion.delete(root);}
}
if (typeof module !== 'undefined') module.exports = {createTimerController, renderTimerWorkspaceCard, createTimerStartFocus, renderTimerStripStatus};

if (typeof window !== 'undefined') {
    let ready;
    window.multipleTimersReady = new Promise(resolve => { ready = resolve; });
    document.addEventListener('DOMContentLoaded', () => {
        const region = document.getElementById('multiple_timers');
        if (!region || window.multipleTimers) { ready(); return; }
        const list = region.querySelector('[data-timer-list]');
        const currentCard = document.getElementById('workspace-current-timer');
        let interaction = 0, noteView = null;
        let requestedTimer = new URLSearchParams(window.location.search).get('timer');
        for (const event of ['pointerdown', 'keydown', 'focusin']) document.addEventListener(event, () => { interaction++; }, true);
        const startFocus = createTimerStartFocus({interaction:()=>interaction,
            guarded:()=> Boolean(document.activeElement?.closest?.('input,textarea,select,[contenteditable="true"],[role="dialog"]')) ||
                (typeof agendaPage !== 'undefined' && agendaPage.hasDraft()) || Boolean(noteView?.hasDraft()) || Boolean(window.multipleTimers?.hasFocusDraft?.()) ||
                (typeof hasSettingsDrafts === 'function' && hasSettingsDrafts()),
            focus:()=> {
                if (!currentCard) {
                    const id = window.multipleTimers.snapshot().selectedTimerId;
                    if (id) window.location.href = `/agenda-view?${new URLSearchParams({timer:id})}`;
                    return;
                }
                currentCard.scrollIntoView({block:'nearest'}); currentCard.focus({preventScroll:true});
            }});
        const notice = region.querySelector('[data-timer-message]');
        const tasks = region.querySelector('[data-timer-task]');
        let taskRead=0,taskMessage='';
        const reviewPanel = region.querySelector('[data-idle-review]');
        const reviewList = region.querySelector('[data-idle-review-list]');
        const choices = new Map();
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
            if (requestedTimer && state.timers.some(timer=>timer.id === requestedTimer)) {
                const id = requestedTimer; requestedTimer = null;
                window.multipleTimers.select(id); return;
            }
            notice.textContent = [state.message,taskMessage].filter(Boolean).join(' ');
            renderTimerStripStatus(region,state);
            if (currentCard) renderTimerWorkspaceCard(currentCard.querySelector('[data-current-display]'), state, window.multipleTimers);
            noteView?.render(state);
            startFocus(state);
            const focused = region.contains(document.activeElement) ? document.activeElement.dataset.timerFocus : null;
            if (focused) restoreFocus = focused;
            const blocked = state.pending || Boolean(state.receipt) || !state.fresh;
            region.querySelector('[data-timer-start]').disabled = blocked;
            for (const button of document.querySelectorAll('[data-workspace-start]')) button.disabled = blocked || button.dataset.metadataAvailable !== 'true';
            const signature = JSON.stringify([state.pending, state.fresh, state.receipt?.outcome, state.selectedTimerId,
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
            if (!currentCard && state.selectedTimerId) {
                const link = document.createElement('a'); link.textContent = 'Open selected timer workspace';
                link.href = `/agenda-view?${new URLSearchParams({timer:state.selectedTimerId})}`;
                link.addEventListener('click',guardTimerWorkspaceNavigation);
                list.append(link);
            }
            reviewList.replaceChildren();
            const unresolved = new Set(state.timers.flatMap(t => (t.idle_gaps || []).filter(g => !g.decision).map(g => g.id)));
            for (const id of choices.keys()) if (!unresolved.has(id)) choices.delete(id);
            reviewPanel.hidden = unresolved.size === 0;
            region.querySelector('[data-idle-apply]').disabled = blocked || choices.size === 0;
            for (const timer of state.timers) {
                const row = document.createElement('div'); row.className = 'multiple-timer-row';
                const label = document.createElement('span');
                label.dataset.timerLabel = timer.id;
                label.textContent = timerLabel(timer);
                row.append(label);
                if (currentCard) {
                    const select = button('Select timer', () => { window.multipleTimers.select(timer.id); currentCard.scrollIntoView({block:'nearest'}); }, false, `${timer.id}/select`);
                    select.setAttribute('aria-pressed', String(state.selectedTimerId === timer.id));
                    row.append(select);
                }
                if (timer.scheduled_session_id && document.getElementById('agenda-extension')) {
                    row.append(button('Extend selected plan', () => window.dispatchEvent(new CustomEvent('extend-selected-plan',
                        {detail:{planId:timer.scheduled_session_id, timerId:timer.id}})), blocked, `${timer.id}/extend-plan`));
                }
                const act = (action, payload = {}) => window.multipleTimers.act(timer.id, action, {expected_revision:timer.revision, ...payload});
                row.append(button(timer.state === 'running' ? 'Pause' : 'Resume', () => act(timer.state === 'running' ? 'pause' : 'resume'), blocked || timer.state === 'frozen', `${timer.id}/pause-resume`));
                row.append(button('Stop & record', () => act('stop'), blocked || timer.state === 'frozen', `${timer.id}/stop`));
                const preference = document.createElement('select');
                preference.setAttribute('aria-label', `Idle preference for ${timer.task_title || timer.id.slice(-8)}`);
                for (const [value, text] of [['pause','Pause when idle'],['keep','Keep recording while idle']]) {
                    const option = document.createElement('option'); option.value = value; option.textContent = text; preference.append(option);
                }
                preference.value = timer.pause_when_idle ? 'pause' : 'keep';
                preference.disabled = blocked || timer.state === 'frozen';
                preference.addEventListener('change', () => act('idle_preference', {pause_when_idle:preference.value === 'pause'}));
                row.append(preference);
                for (const gap of timer.idle_gaps || []) {
                    if (gap.decision) continue;
                    const text = document.createElement('span');
                    text.textContent = `Idle gap ${gap.id.slice(-8)}: ${new Date(gap.onset).toLocaleString()} — ${gap.return_at ? new Date(gap.return_at).toLocaleString() : 'waiting for observed return'}${gap.boundary_source === 'legacy_uncertain' ? ' (legacy boundary uncertain)' : ''}`;
                    const gapRow = document.createElement('fieldset');
                    const legend = document.createElement('legend'); legend.textContent = `${timer.task_title || 'Unassigned'} · timer ${timer.id.slice(-8)}`;
                    gapRow.append(legend, text);
                    const select = document.createElement('select'); select.setAttribute('aria-label', `Decision for gap ${gap.id.slice(-8)}`);
                    for (const [value, label] of [['','Leave unresolved'],['claim','Claim as work'],['discard','Discard absence']]) {
                        const option = document.createElement('option'); option.value = value; option.textContent = label;
                        option.disabled = value === 'claim' && gap.boundary_source === 'legacy_uncertain'; select.append(option);
                    }
                    select.value = choices.get(gap.id)?.decision || '';
                    select.disabled = blocked || !gap.return_at;
                    select.dataset.timerFocus = `${timer.id}/${gap.id}/decision`;
                    select.addEventListener('change', () => {
                        if (select.value) choices.set(gap.id, {timer_id:timer.id, gap_id:gap.id, decision:select.value, expected_revision:timer.revision});
                        else choices.delete(gap.id);
                        region.querySelector('[data-idle-apply]').disabled = blocked || choices.size === 0;
                    });
                    gapRow.append(select); reviewList.append(gapRow);
                }
                list.append(row);
            }
            if (state.receipt?.payload) {
                list.append(button('Check saved operation', () => window.multipleTimers.recover(), state.pending, 'receipt/check'));
                list.append(button(state.receipt.outcome === 'acknowledged' ? 'Retry status refresh' : 'Retry same operation',
                    () => window.multipleTimers.retry(), state.pending, 'receipt/retry'));
            }
            if (restoreFocus && !state.pending && region.contains(document.activeElement)) {
                const next = [...region.querySelectorAll('[data-timer-focus]')].find(b => b.dataset.timerFocus === restoreFocus && !b.disabled);
                (next || region.querySelector('[data-timer-refresh]')).focus({preventScroll:true});
                restoreFocus = null;
            }
        }
        const control = createTimerController({api, storage:sessionStorage, onState:render});
        window.multipleTimers = control;
        if (currentCard) noteView = createCurrentNoteView(document.getElementById('workspace-current-note'),control);
        control.hasNoteDraft = id => Boolean(noteView?.hasDraft(id));
        const act = control.act;
        control.act = (id, action, ...args) => {
            if (action === 'stop' && noteView?.hasDraft(id)) {
                notice.textContent = 'Save the work-note draft or explicitly discard its changes before Stop & record.';
                if(control.snapshot().selectedTimerId===id){const panel=document.querySelector('[data-current-note]');if(panel)panel.open=true;}
                return Promise.resolve(false);
            }
            return act(id,action,...args);
        };
        if (typeof window.openTimeCorrection === 'function') control.correctTime = (timer,change) => window.openTimeCorrection({timer,change});
        control.editTask = id => { if (typeof openEditTaskModal === 'function') return openEditTaskModal(id); };
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
        region.querySelector('[data-idle-apply]').addEventListener('click', async () => {
            const result = await control.review([...choices.values()]);
            for (const id of result.acknowledged) choices.delete(id);
            renderedSignature = null; render(control.snapshot());
            notice.textContent = `${result.acknowledged.length} selected gap decision(s) acknowledged; ${result.remaining.length} not applied. ${control.snapshot().message}`;
        });
        async function refreshTaskOptions(){const generation=++taskRead;
            try{const rows=await api.get('/api/tasks');if(generation!==taskRead)return;if(!Array.isArray(rows))throw Error('Unknown task response');
                const selected=tasks.value,previous=tasks.selectedOptions?.[0]?.textContent;tasks.replaceChildren();
                const unassigned=document.createElement('option');unassigned.value='';unassigned.textContent='Unassigned';tasks.append(unassigned);
                for(const task of rows){const option=document.createElement('option');option.value=task.id;option.textContent=task.title;tasks.append(option);}
                if(selected&&!rows.some(t=>t.id===selected)){const option=document.createElement('option');option.value=selected;option.textContent=previous||'Unavailable activity';tasks.append(option);}
                tasks.value=selected;taskMessage='';
            }catch(_){if(generation!==taskRead)return;taskMessage='Task names unavailable. The selected identity is retained; unassigned recording remains available.';}
            render(control.snapshot());
        }
        window.addEventListener('timetrace:tasks-mutated',()=>void refreshTaskOptions());void refreshTaskOptions();
        window.addEventListener('timetrace:timer-mutated', () => {
            if (typeof calendar !== 'undefined' && calendar) calendar.refetchEvents();
            if (typeof agendaPage !== 'undefined') void agendaPage.refresh();
        });
        control.refresh();
        control.recover();
        setInterval(() => { if (!control.snapshot().pending) control.refresh(); }, 3000);
    });
}
