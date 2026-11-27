const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// Caller seam: shipped handlers + ApiClient, with only HTTP, clock and browser DOM boundaries controlled.
function sessionPage(http = async () => ({ id: 'real-session' })) {
    const elements = new Map(), alerts = [], writes = [], listeners = new Map(), documentListeners = new Map();
    let context;
    const safetyStorage = new Map();
    function element(id = '', tag = 'div') {
        const classes = new Set(['hidden']);
        const el = { id, tagName: tag.toUpperCase(), get ownerDocument(){return context?.document;}, type: '', value: '', _text: '', get textContent(){return this._text;}, set textContent(value){this._text=value;this.children=[];}, children: [], dataset: {}, style: {}, isConnected: true,
            classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, on) { if (on) classes.add(c); else classes.delete(c); } },
            setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
            addEventListener(name, fn) { this[name] = fn; }, removeEventListener() {},
            appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); },
            append(...children) { for (const child of children) this.appendChild(child); },
            replaceChildren(...children) { this.children = []; this.append(...children); },
            querySelectorAll() { return []; }, contains(child) { return this === child || this.children.some(node=>node.contains?.(child)); },
            insertBefore(child) { this.children.unshift(child); }, remove() { elements.delete(this.id); },
            showModal(){this.open=true;},close(){this.open=false;},
            focus() { context.document.activeElement = this; }, select() {} };
        if (id) elements.set(id, el);
        return el;
    }
    const document = { getElementById: id => elements.get(id) || null, createElement: tag => element('', tag),
        addEventListener(name, fn) { documentListeners.set(name, fn); }, removeEventListener() {}, querySelectorAll() { return []; }, body: element('body') };
    context = vm.createContext({ document, Date, URLSearchParams, crypto:require('node:crypto').webcrypto, location: {search:'',pathname:'/agenda-view',href:''}, setTimeout: () => {}, console: { error() {} },
        sessionStorage: {getItem:key => safetyStorage.get(key) || null, setItem:(key,value) => safetyStorage.set(key,value), removeItem:key => safetyStorage.delete(key)},
        localStorage: { getItem: () => null }, alert: msg => alerts.push(msg),
        addEventListener(name, fn) { listeners.set(name, fn); },
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        dispatchEvent(event) { return listeners.get(event.type)?.(event); },
        async fetch(url, options) {
            if (options.method !== 'GET') writes.push({ url, method: options.method, payload: options.body && JSON.parse(options.body) });
            const data = await http(url, options);
            if (data instanceof Response) return data;
            if (url.startsWith('/agenda?') && Array.isArray(data)) {
                return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({ items: data }) };
            }
            return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => data };
        }
    });
    context.window = context;
    context.appDialogs = {confirm:async ({message}) => context.confirm?.(message) ?? true,
        alert:({message}) => alerts.push(message), prompt:async () => null};
    const run = code => vm.runInContext(code, context);
    const load = name => vm.runInContext(fs.readFileSync(path.join(js, name), 'utf8'), context, { filename: name });
    for (const id of ['edit_session_id', 'session_modal_title', 'session_modal_start_now_btn', 'session_modal_delete_btn',
        'session_modal_start', 'session_modal_end', 'session_modal_task_id', 'session_modal_tags_input', 'session_modal_task_search',
        'task_chip_container', 'session_modal_notes', 'session_modal', 'recurring_delete_modal', 'session_modal_save_btn', 'session_modal_feedback']) element(id, 'input');
    element('launcher', 'button').focus();
    for (const name of ['api_client.js', 'task_knowledge.js', 'utils.js', 'task_attach.js', 'tags_engine.js', 'reviewed_recording.js', 'session_modal.js', 'calendar.js']) load(name);
    context.allSessions = [];
    const open = () => run('openCreateSessionModal(new Date("2026-11-10T23:45:00Z"), new Date("2026-11-11T00:30:00Z"))');
    return { context, elements, alerts, writes, listeners, documentListeners, run, load, open, element };
}

test('pending Session Save ignores double activation and retains failed mutation draft for explicit retry', async () => {
    const held = deferred(); let fail = true;
    const p = sessionPage(async (url, options) => {
        if (options.method === 'GET') return [];
        await held.promise;
        if (fail) throw Error('synthetic write rejection');
        return { id: 'real-session', ...JSON.parse(options.body) };
    });
    p.open();
    p.elements.get('session_modal_notes').value = 'First\nSecond';
    const saving = p.run('saveSessionFromModal()');
    const duplicate = p.run('saveSessionFromModal()');
    const inFlightWrites = p.writes.length;
    held.resolve(); await Promise.all([saving, duplicate]);
    assert.equal(inFlightWrites, 1, 'one in-flight session write');
    assert.equal(p.elements.get('session_modal').classList.contains('hidden'), false);
    assert.equal(p.elements.get('session_modal_notes').value, 'First\nSecond');
    fail = false;
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes.length, 2);
    assert.equal(p.elements.get('session_modal').classList.contains('hidden'), true);
});

test('successful create followed by failed display refresh records identity and offers read-only retry', async () => {
    let refreshFails = true;
    const p = sessionPage(async (url, options) => options.method === 'GET' ? [] : { id: 'saved-id', ...JSON.parse(options.body) });
    p.context.calendar = { unselect() {}, refetchEvents() {
        if (refreshFails) throw Error('synthetic range failure');
        return p.run('fetchCalendarEvents({start:new Date("2026-11-10Z"),end:new Date("2026-11-12Z")}, () => {}, () => {})');
    } };
    p.open();
    await p.run('saveSessionFromModal()');
    assert.equal(p.elements.get('edit_session_id').value, 'saved-id', 'authoritative create identity survives refresh failure');
    assert.equal(p.alerts.length, 0, 'a committed write is not reported as failed Save');
    assert.equal(p.elements.get('session_modal').classList.contains('hidden'), true);
    assert.ok(p.elements.get('task_metadata_notice'), 'visible refresh-only retry');
    refreshFails = false;
    await p.run('taskKnowledge.refresh()');
    assert.equal(p.writes.length, 1, 'refresh never repeats POST');
    assert.equal(p.elements.has('task_metadata_notice'), false);
});

test('Session Cancel and Save restore the connected launcher without losing a newer editor', async () => {
    const held = deferred();
    const p = sessionPage(async (url, options) => options.method === 'GET' ? [] : (await held.promise, { id: 'old-saved', ...JSON.parse(options.body) }));
    p.open(); p.elements.get('session_modal_notes').focus();
    p.run('closeSessionModal()');
    assert.equal(p.context.document.activeElement.id, 'launcher');
    p.open();
    const saving = p.run('saveSessionFromModal()');
    p.element('second-launcher', 'button').focus();
    p.open();
    p.elements.get('session_modal_notes').value = 'New editor';
    held.resolve(); await saving;
    assert.equal(p.elements.get('edit_session_id').value, '');
    assert.equal(p.elements.get('session_modal_notes').value, 'New editor');
    assert.equal(p.elements.get('session_modal').classList.contains('hidden'), false);
    assert.equal(p.elements.get('session_modal_save_btn').disabled, false);
    await p.run('saveSessionFromModal()');
    assert.equal(p.context.document.activeElement.id, 'second-launcher');
});

test('planning Schedule Cancel restores its launcher but clean Save focuses Calendar before sidebar replacement', async () => {
    const p = sessionPage(async (url, options) => options.method === 'GET' ? [] : { id: 'planning-session', ...JSON.parse(options.body) });
    const list = p.element('task_card_list');
    const launcher = p.element('planning-schedule', 'button');
    list.appendChild(launcher);
    const calendar = p.element('calendar');
    launcher.focus(); p.open();
    p.elements.get('session_modal_notes').focus();
    p.run('closeSessionModal()');
    assert.equal(p.context.document.activeElement, launcher, 'Cancel keeps the connected Schedule launcher');
    p.open();
    let replaced = false, focusBeforeReplacement;
    p.context.fetchTasks = async () => {
        focusBeforeReplacement = p.context.document.activeElement;
        launcher.isConnected = false;
        list.children = [];
        if (p.context.document.activeElement === launcher) p.context.document.body.focus();
        replaced = true;
        return true;
    };
    await p.run('saveSessionFromModal()');
    assert.equal(replaced, true, 'real metadata refresh reaches sidebar caller');
    assert.equal(focusBeforeReplacement, calendar, 'focus is stable before disposable sidebar HTML is replaced');
    assert.equal(p.context.document.activeElement, calendar);
    assert.equal(p.writes.length, 1);
});

test('edits made during Save remain dirty and the next Save updates the returned real identity', async () => {
    const held = deferred();
    const p = sessionPage(async (url, options) => options.method === 'GET' ? [] : (await held.promise, { id: 'materialized', ...JSON.parse(options.body) }));
    p.open();
    p.elements.get('edit_session_id').value = 'virt:task:20261110T234500Z';
    p.elements.get('session_modal_notes').value = 'Submitted';
    const saving = p.run('saveSessionFromModal()');
    p.elements.get('session_modal_notes').value = 'Concurrent draft';
    held.resolve(); await saving;
    assert.equal(p.elements.get('session_modal').classList.contains('hidden'), false, 'do not discard concurrent Notes');
    assert.equal(p.elements.get('edit_session_id').value, 'materialized');
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes[1].url, '/sessions/materialized');
    assert.equal(p.writes[1].payload.notes, 'Concurrent draft');
});

test('virtual resize adopts materialized event identity before failed range reads; refresh-only retry cannot resend virt PUT', async () => {
    let rangeFails = true;
    const p = sessionPage(async (url, options) => {
        if (options.method !== 'GET') return { id: 'real-occurrence', ...JSON.parse(options.body), task_id: 'task' };
        if (url.startsWith('/sessions?') && rangeFails) throw Error('synthetic failed range read');
        return url.startsWith('/sessions?') ? [{ id: 'real-occurrence', task_id: 'task' }] : [];
    });
    const event = { id: 'virt:task:20261110T234500Z', start: new Date('2026-11-10T23:45Z'), end: new Date('2026-11-11T00:45Z'),
        extendedProps: { isVirtual: true, taskId: 'task' }, setProp(name, value) { this[name] = value; }, setExtendedProp(name, value) { this.extendedProps[name] = value; } };
    p.context.event = event;
    p.context.allSessions = [{ id: event.id, is_virtual: true, task_id: 'task' }];
    p.context.showRecurringResizeScopePrompt = async () => 'only_this';
    p.context.calendar = { getEventById: id => id === event.id ? event : null, refetchEvents() {
        return p.run('fetchCalendarEvents({start:new Date("2026-11-10Z"),end:new Date("2026-11-12Z")}, () => {}, () => {})');
    } };
    await p.run('handleCalendarEventUpdate(event, "resize")');
    assert.equal(event.id, 'real-occurrence', 'failed range refresh cannot leave a stale synthetic event');
    assert.equal(event.extendedProps.isVirtual, false);
    assert.equal(p.context.allSessions[0].id, 'real-occurrence');
    assert.ok(p.elements.has('task_metadata_notice'));
    rangeFails = false;
    await p.run('taskKnowledge.refresh()');
    assert.equal(p.writes.length, 1);
    assert.equal(p.elements.has('task_metadata_notice'), false);
    await p.run('handleCalendarEventUpdate(event, "move")');
    assert.equal(p.writes[1].url, '/sessions/real-occurrence?scope=only_this');
});

test('Escape reaches the active recurring resize confirmation instead of canceling the underlying Session', () => {
    const p = sessionPage(); p.open();
    p.element('recurring_resize_modal').classList.remove('hidden');
    let consumed = false;
    p.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopPropagation() { consumed = true; } });
    assert.equal(consumed, false, 'confirmation owns Escape so its Promise can resolve Cancel');
    assert.equal(p.elements.get('session_modal').classList.contains('hidden'), false);
});

test('uncached legacy deletion without Calendar review support still fetches its metadata', async () => {
    const reads = [];
    const p = sessionPage(async (url, options) => {
        if (options.method === 'GET') {
            reads.push(url);
            if (url === '/sessions/uncached') return { id: 'uncached', task_id: null };
            return [];
        }
        return {};
    });
    p.context.calendarScheduleNeedsReview = undefined;
    p.context.showCustomConfirm = async () => true;
    await p.run('promptDeleteSession("uncached")');
    assert.ok(reads.includes('/sessions/uncached'));
    assert.equal(p.writes.filter(write => write.method === 'DELETE').length, 1);
});

test('successful delete with failed display refresh stays deleted and retry performs no second DELETE', async () => {
    let fails = true;
    const p = sessionPage(async (url, options) => options.method === 'GET' ? [] : null);
    p.context.allSessions = [{ id: 'delete-me' }];
    p.context.calendar = { unselect() {}, getEventById: () => ({ remove() {} }), refetchEvents() {
        if (fails) throw Error('synthetic delete range read failure');
        return p.run('fetchCalendarEvents({start:new Date("2026-11-10Z"),end:new Date("2026-11-12Z")}, () => {}, () => {})');
    } };
    p.open(); p.elements.get('edit_session_id').value = 'delete-me';
    await p.run('pendingDeleteSessionId="delete-me"; confirmRecurringDelete("all")');
    assert.equal(p.elements.get('session_modal').classList.contains('hidden'), true);
    assert.equal(p.context.allSessions.length, 0);
    assert.ok(p.elements.has('task_metadata_notice'));
    fails = false; await p.run('taskKnowledge.refresh()');
    assert.equal(p.writes.length, 1);
    assert.equal(p.writes[0].method, 'DELETE');
});

test('explicit attachment focuses Tags immediately, never a delayed callback stealing subsequent Notes typing', () => {
    const p = sessionPage(); const timers = [];
    p.context.setTimeout = callback => timers.push(callback);
    p.open();
    p.run('attachTaskById("task", false, "Synthetic task")');
    assert.equal(p.context.document.activeElement.id, 'session_modal_tags_input');
    p.elements.get('session_modal_notes').focus();
    timers.forEach(callback => callback());
    assert.equal(p.context.document.activeElement.id, 'session_modal_notes');
});

for (const outcome of ['declined', 'closed', 'restored-launcher']) {
    test(`global Escape ${outcome} close uses actual dialog visibility before focus cleanup`, () => {
        const p = sessionPage();
        const modal = p.element('task_modal'); modal.classList.remove('hidden');
        const field = p.element('retained_task_input', 'input'); field.value = 'Retained draft'; field.focus();
        let unselected = 0, blurred = 0;
        field.blur = () => { blurred++; p.context.document.activeElement = p.context.document.body; };
        p.context.calendar = { unselect() { unselected++; } };
        // Public dialog callback: the global handler must inspect the DOM, not invent a return contract.
        p.context.closeTaskModal = () => {
            if (outcome === 'declined') return;
            modal.classList.add('hidden');
            if (outcome === 'restored-launcher') p.elements.get('launcher').focus();
        };
        p.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
        assert.equal(modal.classList.contains('hidden'), outcome !== 'declined');
        assert.equal(field.value, 'Retained draft');
        assert.equal(unselected, outcome === 'declined' ? 0 : 1);
        assert.equal(blurred, outcome === 'closed' ? 1 : 0);
        assert.equal(p.context.document.activeElement.id,
            outcome === 'declined' ? field.id : outcome === 'closed' ? 'body' : 'launcher');
        assert.equal(p.writes.length, 0);
    });
}

for (const declined of [true, false]) {
    test(`global Escape respects AI drawer openClass after ${declined ? 'declined' : 'successful'} close`, () => {
        const p = sessionPage();
        const drawer = p.element('ai_drawer'); drawer.classList.add('ai-drawer-open');
        const field = p.element('composer', 'textarea'); field.focus();
        let unselected = 0, blurred = 0;
        field.blur = () => { blurred++; p.context.document.activeElement = p.context.document.body; };
        p.context.calendar = { unselect() { unselected++; } };
        p.context.closeAiDrawer = () => { if (!declined) drawer.classList.remove('ai-drawer-open'); };
        p.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
        assert.equal(drawer.classList.contains('ai-drawer-open'), declined);
        assert.equal(unselected, declined ? 0 : 1);
        assert.equal(blurred, declined ? 0 : 1);
    });
}

test('details opens its own recorded session without publishing task history as a global calendar list',()=>{
    const p=sessionPage();
    p.context.recorded={id:'own-session',task_id:null,start_time:'2026-11-10T23:45:00Z',end_time:'2026-11-11T00:30:00Z',notes:'Own history'};
    p.run('openEditSessionModal("own-session", null, recorded)');
    assert.equal(p.elements.get('edit_session_id').value,'own-session');
    assert.equal(p.elements.get('session_modal_notes').value,'Own history');
    assert.equal(p.context.allSessions.length,0,'own history must not become Timer global hints');
});

function loadFolio(p) {
    for (const suffix of ['workspace', 'date', 'new', 'status', 'retry', 'ledger', 'kind', 'inspector-title',
        'detail', 'edit-status', 'review', 'latest', 'use-latest', 'form', 'metadata', 'task', 'tags',
        'notes', 'notes-label', 'start', 'end', 'save', 'cancel', 'record', 'attach', 'attachment', 'progress', 'extension',
        'unfinished', 'pin-status', 'pins', 'activities', 'search', 'activity-filter', 'filter-tag', 'filter-note', 'help-open', 'help', 'inspector-panel', 'columns']) p.element(`agenda-${suffix}`);
    p.elements.get('agenda-progress').ownerDocument=p.context.document;
    p.context.URLSearchParams = URLSearchParams;
    p.context.crypto = require('node:crypto').webcrypto;
    p.context.confirm = () => true;
    p.load('plan_extension.js');
    p.load('workspace_pins.js');
    p.load('workspace_history.js');
    p.load('workspace_notes.js');
    p.load('workspace_summary.js');
    p.load('agenda.js');
    return p.run('agendaPage.refresh()');
}

for (const intent of ['same-row typing', 'other-row', 'date', 'late failure', 'unchanged']) {
    test(`Folio extension lookup respects newer intent: ${intent}`, async () => {
        const held = deferred(), requested = deferred();
        const plan = {id:'old-plan', kind:'scheduled_session', revision:1,
            start_time:'2000-01-04T09:00:00Z', end_time:'2000-01-04T10:00:00Z',
            original_start:'2000-01-04T09:00:00Z', original_end:'2000-01-04T10:00:00Z'};
        const p = sessionPage(async url => {
            if (url === '/api/tasks?status=all') return [];
            if (url === '/scheduled-sessions/old-plan') { requested.resolve(); return held.promise; }
            return {items:[plan, {...plan,id:'new-plan'}]};
        });
        await loadFolio(p);
        const select = id => p.elements.get('agenda-ledger').children.find(e=>e.dataset.agendaRow===id).click();
        await select('old-plan');
        p.context.dispatchEvent = event => p.listeners.get(event.type)?.(event);
        const lookup = p.context.dispatchEvent({type:'extend-selected-plan', detail:{planId:'old-plan'}});
        try {
            await requested.promise;
            if (intent === 'other-row') await select('new-plan');
            if (intent === 'date') {
                p.elements.get('agenda-date').value = '2000-01-05';
                await p.elements.get('agenda-date').change();
            }
            if (intent !== 'unchanged') {
                p.elements.get('agenda-notes').value = 'newer input';
                p.elements.get('agenda-notes').focus();
            }
        } finally {
            held.resolve(intent === 'late failure' ? new Response(JSON.stringify({detail:'offline'}),{status:503}) : plan);
            await lookup;
        }
        if (intent === 'unchanged') assert.ok(p.elements.get('agenda-extension').children.some(e=>e.textContent==='Preview extension'));
        else {
            assert.equal(p.elements.get('agenda-notes').value, 'newer input');
            assert.equal(p.context.document.activeElement, p.elements.get('agenda-notes'));
            assert.equal(p.elements.get('agenda-extension').children.length, 0);
            assert.doesNotMatch(p.elements.get('agenda-edit-status').textContent, /Could not read/);
        }
    });
}

test('actual Agenda Start keeps the early capture revision through its continuation and the next form Save', async () => {
    const status = deferred(), statusRequested = deferred(), planRead = deferred();
    const projection = {id:'virt:task:20990104T090000Z', kind:'scheduled_session', task_id:'task',
        is_virtual:true, projection_revision:'token', start_time:'2099-01-04T09:00:00Z',
        end_time:'2099-01-04T10:00:00Z', original_start:'2099-01-04T09:00:00Z', original_end:'2099-01-04T10:00:00Z'};
    const saved = {...projection, id:'captured', is_virtual:false, revision:2, projection_revision:null};
    let captured = false, redundantReads = 0;
    const p = sessionPage(async (url, options) => {
        if (url === '/api/tasks?status=all') return [{id:'task',title:'Task'}];
        if (url === '/timers' && options.method === 'POST') {
            captured = true;
            return {operation_id:'start-op', requested_scheduled_session_id:projection.id, captured_plan_id:'captured',
                plan_revision:2, timer:{id:'timer-a',state:'running',scheduled_session_id:'captured'}};
        }
        if (url === '/timers') { statusRequested.resolve(); return status.promise; }
        if (url === '/scheduled-sessions/captured' && options.method === 'GET') { redundantReads++; return planRead.promise; }
        if (options.method === 'PUT') return {...saved, revision:3};
        return {items:[captured ? saved : projection]};
    });
    await loadFolio(p);
    p.context.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
    p.context.dispatchEvent = event => { void p.listeners.get(event.type)?.(event); };
    p.load('multiple_timers.js');
    p.run(`window.multipleTimers = createTimerController({api,storage:sessionStorage,onState(){},operationId:()=> 'start-op'})`);
    await p.elements.get('agenda-ledger').children.find(e=>e.dataset.agendaRow===projection.id).click();
    const start = p.elements.get('agenda-detail').children.find(e=>e.textContent==='Start working').click();
    try {
        await statusRequested.promise;
        assert.match(p.elements.get('agenda-kind').textContent, /Scheduled session/i);
        p.elements.get('agenda-notes').value = 'newer draft';
        status.resolve({timers:[],revision:2});
        await new Promise(resolve=>setImmediate(resolve));
        // The status read is done, but any obsolete plan hydration remains truly held.
        p.elements.get('agenda-end').value = '2099-01-04T11:00';
        await p.elements.get('agenda-form').submit({preventDefault(){}});
        const save = p.writes.find(w=>w.method==='PUT');
        assert.equal(save.url, '/scheduled-sessions/captured?scope=only_this');
        assert.equal(save.payload.expected_revision, 2);
        assert.equal(save.payload.end_time, new Date('2099-01-04T11:00').toISOString());
        assert.equal(redundantReads, 0, 'the authoritative capture needs no owner-replacing plan hydration');
    } finally { status.resolve({timers:[],revision:2}); planRead.resolve(saved); await start; }
});

for (const intent of ['other row', 'same-owner typing', 'new date']) test(`Agenda Start cannot report a late plan-read error over ${intent}`, async () => {
    const status = deferred(), requested = deferred(), planRead = deferred();
    const plan = {id:'virt:task:20990104T090000Z', kind:'scheduled_session', task_id:'task', is_virtual:true,
        projection_revision:'token', start_time:'2099-01-04T09:00:00Z',end_time:'2099-01-04T10:00:00Z',
        original_start:'2099-01-04T09:00:00Z',original_end:'2099-01-04T10:00:00Z'};
    const saved = {...plan,id:'captured',is_virtual:false,revision:2};
    const p = sessionPage(async (url, options) => {
        if (url === '/api/tasks?status=all') return [];
        if (url === '/timers' && options.method === 'POST') return {operation_id:'start-op',
            requested_scheduled_session_id:plan.id,captured_plan_id:'captured',plan_revision:2,
            timer:{id:'a',state:'running',scheduled_session_id:'captured'}};
        if (url === '/timers') { requested.resolve(); return status.promise; }
        if (url === '/scheduled-sessions/captured') return planRead.promise;
        return {items:[plan,{...saved,id:'other'}]};
    });
    await loadFolio(p);
    p.context.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
    p.context.dispatchEvent = event => { void p.listeners.get(event.type)?.(event); };
    p.load('multiple_timers.js');
    p.run(`window.multipleTimers = createTimerController({api,storage:sessionStorage,onState(){},operationId:()=> 'start-op'})`);
    await p.elements.get('agenda-ledger').children.find(e=>e.dataset.agendaRow===plan.id).click();
    const start = p.elements.get('agenda-detail').children.find(e=>e.textContent==='Start working').click();
    try {
        await requested.promise;
        status.resolve({timers:[],revision:2});
        await new Promise(resolve=>setImmediate(resolve));
        if (intent === 'other row') await p.elements.get('agenda-ledger').children.find(e=>e.dataset.agendaRow==='other').click();
        if (intent === 'new date') {
            p.elements.get('agenda-date').value = '2099-01-05';
            await p.elements.get('agenda-date').change();
        }
        p.elements.get('agenda-notes').value = 'new input';
        p.elements.get('agenda-notes').focus();
        const previousStatus = p.elements.get('agenda-edit-status').textContent;
        planRead.resolve(new Response(JSON.stringify({detail:'late failure'}),{status:503}));
        await start;
        assert.equal(p.elements.get('agenda-edit-status').textContent, previousStatus);
        assert.equal(p.elements.get('agenda-notes').value, 'new input');
        assert.equal(p.context.document.activeElement, p.elements.get('agenda-notes'));
    } finally {
        status.resolve({timers:[],revision:2}); planRead.resolve(saved); await start;
    }
});

test('Folio explicit extension retains stale attempt and offers read-only review', async () => {
    const plan = {id:'plan-stale', kind:'scheduled_session', revision:1,
        start_time:'2000-01-04T09:00:00Z', end_time:'2000-01-04T10:00:00Z',
        original_start:'2000-01-04T09:00:00Z', original_end:'2000-01-04T10:00:00Z'};
    const p = sessionPage(async (url, options) => {
        if (url === '/api/tasks?status=all') return [];
        if (options.method === 'POST') return new Response(JSON.stringify({detail:'Changed',code:'revision_stale'}),{status:409});
        if (url.startsWith('/agenda?')) return {items:[plan]};
        return {...plan,revision:2};
    });
    await loadFolio(p);
    await p.elements.get('agenda-ledger').children.find(e=>e.dataset.agendaRow===plan.id).click();
    p.elements.get('agenda-detail').children.find(e=>e.textContent==='Extend current schedule').click();
    const extension = p.elements.get('agenda-extension');
    const input = extension.children.find(e=>e.type==='datetime-local');
    input.value='2000-01-05T14:00';
    extension.children.find(e=>e.textContent==='Preview extension').click();
    assert.match(extension.children.find(e=>e.tagName==='P').textContent,/Proposed CURRENT/);
    assert.equal(p.writes.length,0);
    await extension.children.find(e=>e.textContent==='Apply extension').click();
    assert.equal(p.writes.length,1);
    assert.equal(input.value,'2000-01-05T14:00');
    assert.equal(p.elements.get('agenda-review').hidden,false);
    await p.elements.get('agenda-review').click();
    assert.equal(p.writes.length,1);
    assert.equal(p.elements.get('agenda-use-latest').hidden,false);
});

test('Folio acknowledges a create before refreshing and retains later endpoint typing', async () => {
    const held = deferred();
    let rejectRange = false;
    const p = sessionPage(async (url, options) => {
        if (url === '/api/tasks?status=all') return [{ id: 'task-uuid', title: '<Task>' }];
        if (options.method === 'GET') {
            if (rejectRange) throw Error('range unavailable');
            return { items: [] };
        }
        await held.promise;
        return { kind: 'scheduled_session', id: 'saved-plan', revision: 1, ...JSON.parse(options.body) };
    });
    await loadFolio(p);
    await p.elements.get('agenda-new').click();
    p.elements.get('agenda-task').value = 'task-uuid';
    const saving = p.elements.get('agenda-form').submit({ preventDefault() {} });
    p.elements.get('agenda-end').value = '2099-01-04T18:30';
    rejectRange = true;
    held.resolve();
    await saving;
    assert.equal(p.writes[0].url, '/scheduled-sessions');
    assert.equal(p.writes[0].payload.task_id, 'task-uuid');
    assert.equal(p.elements.get('agenda-end').value, '2099-01-04T18:30');
    assert.match(p.elements.get('agenda-edit-status').textContent, /saved/i);
    assert.match(p.elements.get('agenda-status').textContent, /refresh/i);
    rejectRange = false;
    await p.elements.get('agenda-retry').click();
    assert.equal(p.writes.length, 1);
    await p.elements.get('agenda-form').submit({ preventDefault() {} });
    assert.equal(p.writes[1].url, '/scheduled-sessions/saved-plan?scope=only_this');
    assert.equal(p.writes[1].payload.expected_revision, 1);
});

test('Calendar shows overlap plans and one typed projection without changing its legacy totals input', async () => {
    const recurring = { id: 'virt:task:20990104T090000Z', kind: 'scheduled_session', is_virtual: true, projection_revision: 'anchor-token' };
    const p = sessionPage(async url => url.startsWith('/agenda?') ? { items: [
        { id: 'legacy', kind: 'legacy_uncertain', start_time: '2099-01-04T08:00Z' },
        recurring, { id: 'carry-in', kind: 'scheduled_session', revision: 3 },
        { id: 'legacy-carry-in', kind: 'legacy_uncertain', start_time: '2099-01-03T23:00Z' },
    ] } : url.startsWith('/sessions?') ? [{ id: 'legacy' }, { id: recurring.id, is_virtual: true }] : []);
    p.context.URLSearchParams = URLSearchParams;
    p.context.onEvents = data => { p.events = data; };
    await p.run('fetchCalendarEvents({start:new Date("2099-01-04Z"),end:new Date("2099-01-05Z")}, onEvents, () => {})');
    assert.deepEqual(Array.from(p.events, e => e.id), ['legacy', recurring.id, 'carry-in']);
    assert.equal(p.events[1].extendedProps.projectionRevision, 'anchor-token');
    assert.deepEqual(Array.from(p.context.allSessions, row => row.id), ['legacy', recurring.id]);
});

test('a pending Calendar plan modal prevents a second drag writer without losing later input', async () => {
    const held = deferred();
    const p = sessionPage(async (url, options) => options.method === 'GET' ? [] :
        (await held.promise, {id:'held-plan', kind:'scheduled_session', revision:2, ...JSON.parse(options.body)}));
    p.run(`rememberSavedSession({id:'held-plan', kind:'scheduled_session', revision:1, start_time:'2099-01-04T09:00Z', end_time:'2099-01-04T10:00Z'}); openEditSessionModal('held-plan')`);
    const saving = p.run('saveSessionFromModal()');
    p.elements.get('session_modal_end').value = '2099-01-04T13:00';
    let reverted = false;
    p.context.revertHeldDrag = () => { reverted = true; };
    await p.run(`handleCalendarEventUpdate({id:'held-plan', start:new Date('2099-01-04T11:00Z'), end:new Date('2099-01-04T12:00Z'), extendedProps:{kind:'scheduled_session', revision:1}}, 'move', {revert:revertHeldDrag})`);
    assert.equal(reverted, true);
    assert.equal(p.writes.length, 1);
    held.resolve(); await saving;
    assert.equal(p.elements.get('session_modal_end').value, '2099-01-04T13:00');
    assert.equal(p.elements.get('session_modal').classList.contains('hidden'), false);
});

test('Calendar modal conflict remains blocked after reopening and through a drag', async () => {
    const p = sessionPage(async (url, options) => options.method === 'GET' ? [] : new Response(JSON.stringify({detail:'stale'}), {status:409}));
    p.run(`rememberSavedSession({id:'conflicted', kind:'scheduled_session', revision:1, start_time:'2099-01-04T09:00Z', end_time:'2099-01-04T10:00Z'}); openEditSessionModal('conflicted')`);
    await p.run('saveSessionFromModal()');
    p.run(`closeSessionModal(); openEditSessionModal('conflicted')`);
    await p.run('saveSessionFromModal()');
    await p.run(`handleCalendarEventUpdate({id:'conflicted', start:new Date('2099-01-04T11:00Z'),end:new Date('2099-01-04T12:00Z'), extendedProps:{kind:'scheduled_session', revision:1}}, 'move', {revert(){}})`);
    assert.equal(p.writes.length, 1, 'review latches all writers, not just one modal owner');
});

test('manual recording uncertainty blocks Calendar reopen and navigation to another client until explicit review', async () => {
    const p = sessionPage(async (url, options) => { if (options.method === 'GET') return {items:[]}; if(url==='/recorded-work/preview')return {consent_token:'approval',existing_work:[]}; throw Error('lost response'); });
    const walk=node=>[node,...node.children.flatMap(walk)];
    p.run('openCreateSessionModal(new Date("2000-01-04T09:00Z"), new Date("2000-01-04T10:00Z"), null, "", "work")');
    const first=p.run('saveSessionFromModal()');await new Promise(setImmediate);
    const firstDialog=p.context.document.body.children.at(-1);
    await walk(firstDialog).find(n=>n.textContent==='Save recorded work').click();
    firstDialog.cancel({preventDefault(){}});await first;
    p.run('closeSessionModal(); openCreateSessionModal(new Date("2000-01-04T09:00Z"), new Date("2000-01-04T10:00Z"), null, "", "work")');
    const second=p.run('saveSessionFromModal()');await new Promise(setImmediate);
    const secondDialog=p.context.document.body.children.at(-1);
    await walk(secondDialog).find(n=>n.textContent==='Save recorded work').click();
    secondDialog.cancel({preventDefault(){}});await second;
    assert.equal(p.writes.filter(w=>w.url==='/recorded-work').length, 1, 'uncertain manual work must not be replayed by reopening');
    await assert.rejects(p.run('new ApiClient().saveRecordedWork({start_time:"2000-01-04T09:00Z", end_time:"2000-01-04T10:00Z"})'), /unconfirmed/);
    assert.equal(p.writes.filter(w=>w.url==='/recorded-work').length, 1, 'the navigation client consumes the same persisted journal');
});

for (const recovery of [false, true]) test(`Calendar receives production timer capture ACK before pending status (${recovery ? 'receipt recovery after reload' : 'POST'})`, async () => {
    const held = deferred(), requested = deferred();
    const ack = {operation_id:'capture-op', requested_scheduled_session_id:'virt:task:20990104T090000Z',
        captured_plan_id:'captured', plan_revision:2,
        timer:{id:'timer-a', state:'running', scheduled_session_id:'captured'}};
    const p = sessionPage(async (url, options) => {
        if (url === '/operations/capture-op') return {status:'finalized', result:ack};
        if (url === '/timers' && options.method === 'POST') {
            if (recovery) throw Error('lost ACK');
            return ack;
        }
        if (url === '/timers') { requested.resolve(); return held.promise; }
        return {items:[]};
    });
    p.context.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
    p.context.dispatchEvent = event => { void p.listeners.get(event.type)?.(event); };
    p.load('multiple_timers.js');
    p.run(`rememberSavedSession({id:'virt:task:20990104T090000Z', kind:'scheduled_session', task_id:'task',
        is_virtual:true, projection_revision:'projection', start_time:'2099-01-04T09:00Z', end_time:'2099-01-04T10:00Z'});
        openEditSessionModal('virt:task:20990104T090000Z');
        window.control = createTimerController({api, storage:sessionStorage, onState() {}, operationId:()=> 'capture-op'});`);
    let start = p.run(`control.start({scheduled_session_id:'virt:task:20990104T090000Z'})`);
    if (recovery) {
        await start;
        p.run(`window.control = createTimerController({api, storage:sessionStorage, onState() {}})`);
        start = p.run('control.recover()');
    }
    try {
        await requested.promise;
        assert.equal(p.elements.get('edit_session_id').value, 'captured');
        assert.equal(p.run('sessionModalOwner.session.kind'), 'scheduled_session');
        assert.equal(p.run('sessionModalOwner.session.revision'), 2);
        assert.equal(p.run('control.snapshot().pending'), false);
        assert.equal(p.run('control.snapshot().fresh'), false, 'partial ACK is not a full read');
        assert.equal(p.run('control.snapshot().receipt.outcome'), 'acknowledged');
        p.elements.get('session_modal_notes').value = 'newer draft';
        assert.equal(p.writes.length, 1);
    } finally { held.resolve({timers:[], revision:2}); await start; }
    assert.equal(p.elements.get('session_modal_notes').value, 'newer draft');
    p.run(`openCreateSessionModal(new Date('2099-01-05T09:00Z'), new Date('2099-01-05T10:00Z'))`);
    p.elements.get('session_modal_notes').value = 'new selection';
    await p.run('control.recover()');
    assert.equal(p.elements.get('edit_session_id').value, '');
    assert.equal(p.elements.get('session_modal_notes').value, 'new selection');
});

test('visible acknowledged timer retry reads status without replaying the POST', async () => {
    let fail = false, reads = 0;
    const p = sessionPage(async (url, options) => {
        if (url === '/api/tasks') return [];
        if (options.method === 'POST') {
            fail = true;
            return {operation_id:JSON.parse(options.body).operation_id, timer:{id:'timer-a', state:'running'}};
        }
        if (url === '/timers') { reads++; if (fail) throw Error('offline'); return {timers:[], revision:2}; }
        return {items:[]};
    });
    const region = p.element('multiple_timers'), nodes = new Map();
    for (const name of ['timer-list','timer-message','timer-task','idle-review','idle-review-list',
        'timer-start','idle-apply','timer-refresh','timer-idle']) nodes.set(`[data-${name}]`, p.element());
    region.querySelector = selector => nodes.get(selector);
    p.context.setInterval = () => {};
    p.context.crypto = {randomUUID:()=> 'visible-op'};
    p.context.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
    p.context.dispatchEvent = event => { void p.listeners.get(event.type)?.(event); };
    p.load('multiple_timers.js');
    p.documentListeners.get('DOMContentLoaded')();
    await p.run('multipleTimers.refresh()');
    await p.run('multipleTimers.start({})');
    const retry = nodes.get('[data-timer-list]').children.find(child => child.textContent === 'Retry status refresh');
    assert.ok(retry, 'ACK recovery is visibly a read-only refresh');
    const before = reads;
    await retry.click();
    assert.ok(reads > before);
    assert.equal(p.writes.length, 1);
    fail = false;
    await p.run('multipleTimers.retry()');
    assert.equal(p.writes.length, 1);
    assert.equal(p.run('multipleTimers.snapshot().receipt'), null);
});

test('Calendar targeted timer ACK adopts captured plan UUID and revision before a failed read', async () => {
    const p = sessionPage(async () => { throw Error('offline read'); });
    const id = 'virt:task:20990104T090000Z';
    p.run(`rememberSavedSession({id:${JSON.stringify(id)}, kind:'scheduled_session', task_id:'task', is_virtual:true, projection_revision:'projection', start_time:'2099-01-04T09:00Z', end_time:'2099-01-04T10:00Z'})`);
    p.run(`openEditSessionModal(${JSON.stringify(id)})`);
    await p.listeners.get('timetrace:timer-mutated')({detail:{requested_scheduled_session_id:id, captured_plan_id:'captured', plan_revision:2, timer:{scheduled_session_id:'captured'}}});
    assert.equal(p.elements.get('edit_session_id').value, 'captured');
    p.elements.get('session_modal_end').value = '2099-01-04T11:00';
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes[0].url, '/scheduled-sessions/captured?scope=only_this');
    assert.equal(p.writes[0].payload.expected_revision, 2);
});

test('Calendar explicit manual recording creates typed work and never falls back to legacy edits', async () => {
    const p = sessionPage(async (url, options) => options.method === 'GET' ? [] : url==='/recorded-work/preview' ? {consent_token:'approval',existing_work:[]} :
        {id:'manual-work', kind:'recorded_work', provenance:'manual', ...JSON.parse(options.body)});
    p.run('openCreateSessionModal(new Date("2000-01-04T09:00Z"), new Date("2000-01-04T10:00Z"), null, "", "work")');
    const saving=p.run('saveSessionFromModal()');await new Promise(setImmediate);
    const walk=node=>[node,...node.children.flatMap(walk)];
    await walk(p.context.document.body).find(n=>n.textContent==='Save recorded work').click();await saving;
    assert.equal(p.writes[0].url, '/recorded-work/preview');
    assert.equal(p.writes[1].url, '/recorded-work');
    assert.equal(p.writes[1].payload.consent_token,'approval');
    assert.ok(p.writes[1].payload.operation_id);
    p.run('openEditSessionModal("manual-work")');
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes.filter(w=>w.url==='/recorded-work').length, 1, 'typed recorded work is read-only, including repeat Save');
});

test('explicit Calendar scheduling writes a plan, but an existing legacy edit keeps its old route', async () => {
    const p = sessionPage(async (url, options) => {
        if (url.startsWith('/agenda?')) return { items: [] };
        if (options.method === 'GET') return [];
        return { id: 'saved-plan', kind: 'scheduled_session', revision: 1, ...JSON.parse(options.body) };
    });
    p.run('openCreateSessionModal(new Date("2000-01-04T09:00Z"), new Date("2000-01-04T10:00Z"), null, "", "schedule")');
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes[0].url, '/scheduled-sessions');
    p.context.allSessions = [{ id: 'legacy-1', start_time: '2000-01-04T09:00Z', end_time: '2000-01-04T10:00Z' }];
    p.run('openEditSessionModal("legacy-1")');
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes[1].url, '/sessions/legacy-1');
});

test('Calendar acknowledges a typed projection before a held range refresh and sends the returned revision next', async () => {
    const hold = deferred(), rangeRead = deferred();
    const virtualId = 'virt:task:20990104T090000Z';
    const p = sessionPage(async (url, options) => {
        if (url.startsWith('/agenda?')) { rangeRead.resolve(); return hold.promise; }
        if (options.method === 'GET') return [];
        const { start_time, end_time, expected_revision } = JSON.parse(options.body);
        return { id: 'captured-plan', kind: 'scheduled_session', is_virtual: false, start_time, end_time,
            revision: expected_revision ? 2 : 1, series_task_id: 'task', occurrence_start: '2099-01-04T09:00Z',
            original_start: '2099-01-04T09:00Z', original_end: '2099-01-04T10:00Z' };
    });
    let reverts = 0;
    p.context.allSessions = [{ id: virtualId, is_virtual: true }];
    p.context.event = {
        id: virtualId, start: new Date('2099-01-04T10:00Z'), end: new Date('2099-01-04T11:00Z'),
        extendedProps: { kind: 'scheduled_session', isVirtual: true, projectionRevision: 'original-projection' },
        setProp(name, value) { this[name] = value; }, setExtendedProp(name, value) { this.extendedProps[name] = value; }
    };
    p.context.revert = () => { reverts++; };
    p.context.calendar = { refetchEvents() {
        return p.run('fetchCalendarEvents({start:new Date("2099-01-04Z"),end:new Date("2099-01-05Z")}, () => {}, () => {})');
    } };
    const first = p.run('handleCalendarEventUpdate(event, "move", {revert})');
    await rangeRead.promise;
    assert.equal(p.context.event.id, 'captured-plan');
    assert.equal(p.context.allSessions.some(row => row.id === virtualId), false);
    assert.equal(p.context.event.extendedProps.projectionRevision, null);
    assert.equal(p.context.event.extendedProps.seriesTaskId, 'task');
    assert.equal(p.context.event.extendedProps.originalStart, '2099-01-04T09:00Z');
    p.context.showRecurringResizeScopePrompt = async () => 'all_future';
    p.context.event.end = new Date('2099-01-04T11:30Z');
    const second = p.run('handleCalendarEventUpdate(event, "resize", {revert})');
    hold.resolve(null); // Malformed refresh response, not a failed mutation acknowledgement.
    await Promise.all([first, second]);
    assert.equal(reverts, 0);
    assert.deepEqual(p.writes.map(w => [w.url, w.payload.expected_projection_revision ?? w.payload.expected_revision]), [
        [`/scheduled-sessions/${encodeURIComponent(virtualId)}?scope=only_this`, 'original-projection'],
        ['/scheduled-sessions/captured-plan?scope=all_future', 1]
    ]);
    assert.equal(p.context.event.extendedProps.revision, 2);
    await p.run('promptDeleteSession("captured-plan")');
    assert.match(p.alerts.at(-1), /not available/);
    assert.equal(p.writes.length, 2);
});

test('Folio keeps a stale draft without replay, and a held conflict read cannot retarget a new selection', async () => {
    const hold = deferred(), reviewRead = deferred();
    const first = { id: 'plan-a', kind: 'scheduled_session', revision: 1, start_time: '2099-01-04T09:00Z',
        end_time: '2099-01-04T10:00Z', original_start: '2099-01-04T09:00Z', original_end: '2099-01-04T10:00Z' };
    const second = { ...first, id: 'plan-b', start_time: '2099-01-04T13:00Z', end_time: '2099-01-04T14:00Z' };
    const p = sessionPage(async (url, options) => {
        if (url.startsWith('/agenda?')) return { items: [first, second] };
        if (url === '/scheduled-sessions/plan-a') { reviewRead.resolve(); return hold.promise; }
        if (options.method === 'GET') return [];
        return new Response(JSON.stringify({ detail: 'Schedule changed.', code: 'revision_stale' }), { status: 409 });
    });
    await loadFolio(p);
    await p.elements.get('agenda-ledger').children.find(e => e.dataset.agendaRow === 'plan-a').click();
    p.elements.get('agenda-end').value = '2099-01-04T11:00';
    await p.elements.get('agenda-form').submit({ preventDefault() {} });
    await reviewRead.promise;
    assert.equal(p.elements.get('agenda-end').value, '2099-01-04T11:00');
    assert.match(p.elements.get('agenda-edit-status').textContent, /changed on the server/);
    await p.elements.get('agenda-form').submit({ preventDefault() {} });
    assert.equal(p.writes.length, 1);
    await p.elements.get('agenda-ledger').children.find(e => e.dataset.agendaRow === 'plan-b').click();
    p.elements.get('agenda-start').focus();
    hold.resolve({ ...first, revision: 2 });
    await new Promise(setImmediate);
    assert.equal(p.elements.get('agenda-latest').textContent, '');
    assert.equal(p.elements.get('agenda-use-latest').hidden, true);
    assert.equal(p.context.document.activeElement.id, 'agenda-start');
});

test('an unconfirmed Folio create is not replayed by Save or refresh', async () => {
    const p = sessionPage(async (url, options) => {
        if (url.startsWith('/agenda?')) return { items: [] };
        if (options.method === 'GET') return [];
        throw Error('connection dropped');
    });
    await loadFolio(p);
    await p.elements.get('agenda-new').click();
    await p.elements.get('agenda-form').submit({ preventDefault() {} });
    assert.match(p.elements.get('agenda-edit-status').textContent, /not confirmed/);
    assert.equal(p.elements.get('agenda-save')['aria-disabled'], 'true');
    await p.elements.get('agenda-retry').click();
    await p.elements.get('agenda-form').submit({ preventDefault() {} });
    assert.equal(p.writes.length, 1);
});

test('Folio reads the 23-hour local spring-forward day, not a UTC date or fixed 24 hours', async () => {
    const originalZone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
        const boundedRead = deferred();
        const p = sessionPage(async url => {
            if (url.startsWith('/agenda?')) {
                const query = new URL(url, 'http://test').searchParams;
                if (query.get('start') === '2026-03-08T05:00:00.000Z') boundedRead.resolve(query.get('end'));
                return { items: [] };
            }
            return [];
        });
        await loadFolio(p);
        p.elements.get('agenda-date').value = '2026-03-08';
        await p.elements.get('agenda-date').change();
        const end = await Promise.race([boundedRead.promise, new Promise(resolve => setImmediate(() => resolve(null)))]);
        assert.equal(end, '2026-03-09T04:00:00.000Z');
    } finally {
        if (originalZone === undefined) delete process.env.TZ;
        else process.env.TZ = originalZone;
    }
});

for (const materialized of [false, true]) {
    test(`Calendar trusts the planning snapshot even when the totals snapshot is ${materialized ? 'older' : 'newer'}`, async () => {
        const anchor = 'virt:series:20990104T090000Z';
        const real = { id: 'legacy-moved', kind: 'legacy_uncertain', start_time: '2099-01-04T10:00Z' };
        const projection = { id: anchor, kind: 'scheduled_session', is_virtual: true, start_time: '2099-01-04T09:00Z' };
        const held = deferred(), started = deferred();
        const p = sessionPage(async url => {
            if (url.startsWith('/agenda?')) return { items: [materialized ? real : projection] };
            if (url.startsWith('/sessions?')) { started.resolve(); return held.promise; }
            return [];
        });
        p.context.onEvents = events => { p.events = events; };
        const read = p.run('fetchCalendarEvents({start:new Date("2099-01-04Z"),end:new Date("2099-01-05Z")}, onEvents, () => {})');
        await started.promise;
        held.resolve([materialized ? projection : real]);
        await read;
        assert.deepEqual(Array.from(p.events, event => event.id), [materialized ? real.id : anchor]);
        assert.equal(p.context.allSessions[0].id, materialized ? anchor : real.id);
    });
}

test('stale Calendar drag retains attempted and latest intervals and blocks writes until explicit review', async () => {
    const latest = { id: 'plan-a', kind: 'scheduled_session', revision: 2,
        start_time: '2099-01-04T08:00Z', end_time: '2099-01-04T09:00Z' };
    const p = sessionPage(async (url, options) => {
        if (url.startsWith('/agenda?')) return { items: [latest] };
        if (url === '/scheduled-sessions/plan-a') return latest;
        if (options.method === 'GET') return [];
        return new Response(JSON.stringify({ detail: 'Schedule changed.' }), { status: 409 });
    });
    const panel = p.element('calendar_schedule_reviews');
    p.context.event = { id: latest.id, title: 'First plan', start: new Date('2099-01-04T10:00Z'),
        end: new Date('2099-01-04T11:00Z'), extendedProps: { kind: 'scheduled_session', revision: 1 } };
    await p.run('handleCalendarEventUpdate(event)');
    await p.run('fetchCalendarEvents({ start: new Date("2099-01-04Z"), end: new Date("2099-01-05Z") }, () => {}, () => {})');
    await p.run('handleCalendarEventUpdate(event)');
    assert.equal(p.writes.length, 1);
    const review = panel.children.at(-1);
    assert.match(review.children[0].textContent, /Attempted.*First plan|First plan.*Attempted/);
    await review.children[1].click();
    const inspected = panel.children.at(-1);
    assert.match(inspected.children[0].textContent, /Attempted.*Latest saved/s);
    assert.equal(p.writes.length, 1);
    await inspected.children[2].click();
    p.context.event.extendedProps.revision = 2;
    await p.run('handleCalendarEventUpdate(event)');
    assert.equal(p.writes[1].payload.expected_revision, 2);
});

test('lost Schedule create stays blocked across modal reopen and task drop until inspection and new intent', async () => {
    let failRead = true, committed;
    const p = sessionPage(async (url, options) => {
        if (url.startsWith('/agenda?')) {
            if (failRead) throw Error('range read unavailable');
            return { items: [committed] };
        }
        if (options.method === 'GET') return [];
        committed = { ...JSON.parse(options.body), id: 'real-committed', kind: 'scheduled_session', revision: 1 };
        if (p.writes.length === 1) throw Error('lost response after commit');
        return committed;
    });
    const panel = p.element('schedule_create_recovery');
    p.element('schedule_create_recovery_status');
    const inspect = p.element('schedule_create_inspect');
    const allow = p.element('schedule_create_new_intent');
    p.load('dashboard.js');
    const reopen = () => p.run('openCreateSessionModal(new Date("2099-01-04T09:00Z"), new Date("2099-01-04T10:00Z"), null, "", "schedule")');
    reopen();
    await p.run('saveSessionFromModal()');
    p.run('closeSessionModal()');
    reopen();
    await p.run('saveSessionFromModal()');
    p.context.drop = { event: { start: new Date('2099-01-04T09:00Z'), remove() {} } };
    await p.run('scheduleCalendarDrop(drop)');
    assert.equal(p.writes.length, 1);
    await inspect.onclick();
    assert.equal(allow.disabled, true);
    await p.run('scheduleCalendarDrop(drop)');
    assert.equal(p.writes.length, 1);
    failRead = false;
    await inspect.onclick();
    assert.equal(panel.hidden, false);
    assert.match(p.elements.get('schedule_create_recovery_status').textContent, /real-committed/);
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes.length, 1);
    allow.onclick();
    await p.run('scheduleCalendarDrop(drop)');
    assert.equal(p.writes.length, 2);
});

test('same-page task metadata refresh retitles the Folio inspector without replacing its draft or focus', async () => {
    let title = 'Original label';
    const held = deferred(), requested = deferred();
    let hold = false;
    const plan = { id: 'folio-id', task_id: 'task-1', kind: 'scheduled_session', revision: 1,
        start_time: '2099-01-04T09:00Z', end_time: '2099-01-04T10:00Z', original_start: '2099-01-04T09:00Z', original_end: '2099-01-04T10:00Z' };
    const p = sessionPage(async url => {
        if (url.startsWith('/agenda?')) {
            if (hold) { requested.resolve(); await held.promise; }
            return { items: [plan] };
        }
        if (url === '/api/tasks?status=all') return [{ id: 'task-1', title }];
        return [];
    });
    await loadFolio(p);
    await p.elements.get('agenda-ledger').children.at(-1).click();
    const end = p.elements.get('agenda-end');
    end.value = '2099-01-04T11:15';
    end.focus();
    hold = true;
    const old = p.run('agendaPage.refresh()');
    await requested.promise;
    title = '<Renamed task>';
    await p.run('taskKnowledge.changed()');
    held.resolve();
    await old;
    assert.equal(p.elements.get('agenda-inspector-title').textContent, '<Renamed task>');
    assert.equal(p.elements.get('agenda-task').value, 'task-1');
    assert.equal(end.value, '2099-01-04T11:15');
    assert.equal(p.context.document.activeElement, end);
});

for (const kind of ['scheduled_session', 'legacy_uncertain']) {
    test(`Calendar review follows a captured projection into its ${kind} successor without unlocking`, async () => {
        const anchor = '2099-01-04T09:00:00Z';
        const virtual = 'virt:series:20990104T090000Z';
        const latest = { id: 'successor', kind, revision: 2, series_task_id: 'series', occurrence_start: anchor,
            start_time: '2099-01-04T11:00:00Z', end_time: '2099-01-04T12:00:00Z' };
        const p = sessionPage(async (url, options) => {
            if (url.startsWith('/agenda?')) return { items: [latest] };
            if (url === `/agenda/occurrences/${encodeURIComponent(virtual)}`) return latest;
            if (options.method === 'GET') return [];
            if (url.includes('successor')) return kind === 'scheduled_session' ? latest : { ...latest, kind: undefined };
            return new Response(JSON.stringify({ detail: 'Projection changed' }), { status: 409 });
        });
        const panel = p.element('calendar_schedule_reviews');
        p.context.event = { id: virtual, start: new Date('2099-01-04T10:00Z'), end: new Date('2099-01-04T10:30Z'),
            extendedProps: { kind: 'scheduled_session', isVirtual: true, seriesTaskId: 'series', occurrenceStart: anchor } };
        await p.run('handleCalendarEventUpdate(event)');
        p.context.onEvents = events => { p.context.event = { ...events[0], start: new Date(events[0].start), end: new Date(events[0].end) }; };
        await p.run('fetchCalendarEvents({start:new Date("2099-01-04Z"),end:new Date("2099-01-05Z")}, onEvents, () => {})');
        await p.run('handleCalendarEventUpdate(event)');
        assert.equal(p.writes.length, 1);
        p.context.showCustomConfirm = async () => true;
        await p.run('promptDeleteSession("successor")');
        await p.run('confirmRecurringDelete("only_this")');
        assert.equal(p.writes.length, 1, 'review latch blocks deletion of the legacy successor');
        assert.match(p.alerts.at(-1), /explicitly discard/);
        p.context.allSessions = [];
        p.run('pendingDeleteSessionId = ' + JSON.stringify(virtual));
        await p.run('confirmRecurringDelete("only_this")');
        assert.equal(p.writes.length, 1, 'known virtual ID remains blocked when no current row is cached');
        await panel.children.at(-1).children[1].click();
        const review = panel.children.at(-1);
        assert.match(review.children[0].textContent, /Latest saved/);
        await review.children[2].click();
        assert.equal(p.writes.length, 1, 'review is not another write');
        await p.run('handleCalendarEventUpdate(event)');
        assert.match(p.writes[1].url, /\/(scheduled-sessions|sessions)\/successor\?/);
        if (kind === 'legacy_uncertain') {
            await p.run('promptDeleteSession("successor")');
            await p.run('confirmRecurringDelete("only_this")');
            assert.equal(p.writes.filter(write => write.method === 'DELETE').length, 1,
                'explicit review restores ordinary legacy deletion');
        }
    });
}

test('Calendar invalidates a held drop across create recovery and rejects latched drops before metadata', async () => {
    const held = deferred(), requested = deferred();
    let metadataReads = 0, committed;
    const p = sessionPage(async (url, options) => {
        if (url === '/api/tasks?status=all') {
            metadataReads++;
            requested.resolve();
            return held.promise;
        }
        if (url.startsWith('/agenda?')) return { items: [committed] };
        if (options.method === 'GET') return [];
        if (url.startsWith('/api/tasks/')) return {};
        committed = { ...JSON.parse(options.body), id: 'saved-plan', kind: 'scheduled_session', revision: 1 };
        if (p.writes.filter(w => w.method === 'POST').length === 1) throw Error('lost response');
        return committed;
    });
    p.element('schedule_create_recovery');
    p.element('schedule_create_recovery_status');
    const inspect = p.element('schedule_create_inspect');
    const allow = p.element('schedule_create_new_intent');
    p.load('dashboard.js');
    p.context.drop = { event: { start: new Date('2099-01-04T09:00Z'), extendedProps: { taskId: 'linked' }, remove() {} } };
    const old = p.run('scheduleCalendarDrop(drop)');
    await requested.promise;
    p.run('openCreateSessionModal(new Date("2099-01-04T09:00Z"), new Date("2099-01-04T10:00Z"), null, "", "schedule")');
    await p.run('saveSessionFromModal()');
    const latched = p.run('scheduleCalendarDrop(drop)');
    await inspect.onclick();
    allow.onclick();
    held.resolve([{ id: 'linked', title: 'Linked', status: 'Ongoing' }]);
    await Promise.all([old, latched]);
    assert.equal(metadataReads, 1);
    assert.equal(p.writes.filter(w => w.method === 'POST').length, 1);
    await p.run('scheduleCalendarDrop(drop)');
    assert.equal(p.writes.filter(w => w.method === 'POST').length, 2);
});

test('Folio explicit manual work ACK retains later typing and never replays after refresh failure', async () => {
    const held = deferred(); let fail = false;
    const p = sessionPage(async (url, options) => {
        if (options.method === 'GET') {
            if (fail) throw Error('read unavailable');
            return url === '/api/tasks?status=all' ? [] : { items: [] };
        }
        await held.promise;
        return { id: 'work-id', kind: 'recorded_work', provenance: 'manual', revision: 1,
            ...JSON.parse(options.body), warnings: [{code:'same_task_overlap',record_ids:['other'],overlap_seconds:1800}] };
    });
    await loadFolio(p);
    await p.elements.get('agenda-record').click();
    p.elements.get('agenda-start').value = '2000-01-04T09:00';
    p.elements.get('agenda-end').value = '2000-01-04T10:00';
    const saving = p.elements.get('agenda-form').submit({preventDefault(){}});
    p.elements.get('agenda-end').value = '2000-01-04T10:30';
    held.resolve(); fail = true; await saving;
    assert.equal(p.writes[0].url, '/recorded-work');
    assert.equal(p.elements.get('agenda-end').value, '2000-01-04T10:30');
    assert.equal(p.elements.get('agenda-form').hidden, false, 'later draft must remain visible');
    assert.match(p.elements.get('agenda-edit-status').textContent, /1800.*other/);
    await p.elements.get('agenda-form').submit({preventDefault(){}});
    fail = false; await p.elements.get('agenda-retry').click();
    assert.equal(p.writes.length, 1, 'ACK never permits an implicit new write');
});

test('Folio shows union-based progress with explicit local-start and non-additive labels', async () => {
    const p = sessionPage(async (url) => {
        if (url.startsWith('/recorded-work-progress?')) return {
            measurement_at:'2000-01-05T00:00:00Z',cohort:'Whole intervals by local record-start; non-additive',
            recorded_task_time:{total:1.5},elapsed_recorded_time:{total:1.5},unassigned_recorded_time:{total:0},
            tasks:{rows:[]},
        };
        return url === '/api/tasks?status=all' ? [] : {items:[]};
    });
    await loadFolio(p);
    const text=node=>[node.textContent,...node.children.map(text)].join(' ');
    const progress=p.elements.get('agenda-progress');
    assert.match(text(progress), /1h 30m.*recorded time/);
    assert.match(text(progress.children[1]), /Recorded task time.*1.5.*local record-start.*non-additive/);
});

test('Folio plan context prefills task but attachment is explicit; 409 keeps work input and review is read-only', async () => {
    const plan = {id:'plan-id',kind:'scheduled_session',task_id:'task-id',revision:3,start_time:'2000-01-04T09:00Z',end_time:'2000-01-04T10:00Z'};
    const p = sessionPage(async (url, options) => {
        if (url.startsWith('/agenda?')) return {items:[plan]};
        if (url === '/api/tasks?status=all') return [{id:'task-id',title:'Task'}];
        if (url === '/scheduled-sessions/plan-id') return {...plan,revision:4};
        if (options.method === 'GET') return [];
        return new Response(JSON.stringify({detail:'Plan changed',code:'revision_stale'}),{status:409});
    });
    await loadFolio(p);
    await p.elements.get('agenda-ledger').children.find(el => el.dataset.agendaRow === plan.id).click();
    await p.elements.get('agenda-record').click();
    assert.equal(p.elements.get('agenda-task').value,'task-id');
    assert.equal(p.elements.get('agenda-attach').checked,false);
    p.elements.get('agenda-attach').checked=true;
    p.elements.get('agenda-start').value='2000-01-04T09:15';
    p.elements.get('agenda-end').value='2000-01-04T10:15';
    await p.elements.get('agenda-form').submit({preventDefault(){}});
    assert.equal(p.writes[0].payload.scheduled_session_id,'plan-id');
    assert.equal(p.writes[0].payload.expected_plan_revision,3);
    await p.elements.get('agenda-review').click();
    assert.equal(p.elements.get('agenda-start').value,'2000-01-04T09:15');
    assert.equal(p.elements.get('agenda-use-latest').hidden,true);
    await p.elements.get('agenda-form').submit({preventDefault(){}});
    assert.equal(p.writes.length,1);
});
test('ui72 Agenda hides fractions while retaining untouched schedule endpoint precision', async () => {
    const plan={id:'precise-plan',kind:'scheduled_session',revision:1,
        start_time:'2099-01-04T09:00:12.123456Z',end_time:'2099-01-04T10:00:34.654321Z',
        original_start:'2099-01-04T09:00:12.123456Z',original_end:'2099-01-04T10:00:34.654321Z'};
    const p=sessionPage(async (url,options)=>options.method==='GET' ? url.startsWith('/agenda?') ? {items:[plan]} : [] : {...plan,...JSON.parse(options.body)});
    await loadFolio(p);
    await p.elements.get('agenda-ledger').children.find(el=>el.dataset.agendaRow===plan.id).click();
    assert.match(p.elements.get('agenda-start').value,/T\d{2}:00:12$/);
    assert.match(p.elements.get('agenda-end').value,/T\d{2}:00:34$/);
    await p.elements.get('agenda-form').submit({preventDefault(){}});
    assert.equal(p.writes[0].payload.start_time,'2099-01-04T09:00:12.123456Z');
    assert.equal(p.writes[0].payload.end_time,'2099-01-04T10:00:34.654321Z');
});
test('ui72 Agenda cancelled or superseded departure retains the original schedule draft', async () => {
    const plan={id:'guarded-plan',kind:'scheduled_session',revision:1,start_time:'2099-01-04T09:00Z',end_time:'2099-01-04T10:00Z'};
    const p=sessionPage(async url=>url.startsWith('/agenda?')?{items:[plan]}:[]);
    await loadFolio(p);
    await p.elements.get('agenda-ledger').children.find(el=>el.dataset.agendaRow===plan.id).click();
    p.elements.get('agenda-end').value='2099-01-04T11:00';
    p.load('app_dialogs.js');
    const departing=p.elements.get('agenda-new').click();await Promise.resolve();
    p.elements.get('agenda-end').value='2099-01-04T12:00';
    const choose=label=>p.context.document.body.children.at(-1).children.at(-1).children.find(button=>button.textContent===label).click();
    choose('Discard changes'); await departing;
    assert.equal(p.elements.get('agenda-end').value,'2099-01-04T12:00');
    const canceled=p.elements.get('agenda-new').click();await Promise.resolve();choose('Cancel');await canceled;
    assert.equal(p.elements.get('agenda-end').value,'2099-01-04T12:00'); assert.equal(p.writes.length,0);
});
test('ui72 recurring resize without a scope chooser fails closed instead of treating Cancel as one occurrence', async () => {
    const p=sessionPage(async()=>[]);p.load('app_dialogs.js');
    p.context.event={id:'virt:task:20990104T090000',start:new Date('2099-01-04T09:00Z'),end:new Date('2099-01-04T10:00Z'),extendedProps:{isVirtual:true}};
    let reverted=0;p.context.info={revert(){reverted++;}};
    await p.run('handleCalendarEventUpdate(event, "resize", info)');
    assert.equal(p.writes.length,0);assert.equal(reverted,1);
    assert.match(p.context.document.body.children.at(-1).children[1].textContent,/scope chooser/i);
});
test('ui72 Notes filter retains saved entry and plan-note matches but ignores task descriptions and live Entry note text',async()=>{
    const base={start_time:'2099-01-04T09:00Z',end_time:'2099-01-04T10:00Z',task_id:'task',revision:1};
    const rows=[{...base,id:'saved-note',kind:'recorded_work',notes:'needle saved entry'},
        {...base,id:'plan-note',kind:'scheduled_session',notes:'needle plan'},
        {...base,id:'description-only',kind:'scheduled_session',notes:''}];
    const p=sessionPage(async url=>url.startsWith('/agenda?')?{items:rows}:url==='/api/tasks?status=all'?[{id:'task',title:'Task',description:'needle description'}]:[]);
    await loadFolio(p);
    p.element('workspace-current-note','textarea').value='needle live timer';
    p.elements.get('agenda-filter-note').value='needle';
    p.elements.get('agenda-filter-note').input();
    const descendants=root=>root.children.flatMap(child=>[child,...descendants(child)]);
    assert.deepEqual(descendants(p.elements.get('agenda-ledger')).filter(el=>el.dataset.agendaRow).map(el=>el.dataset.agendaRow).sort(),['plan-note','saved-note']);
});

test('ui72 manual recording labels Entry note separately from plan notes',async()=>{
    const p=sessionPage(async url=>url.startsWith('/agenda?')?{items:[]}:[]);await loadFolio(p);
    await p.elements.get('agenda-record').click();assert.equal(p.elements.get('agenda-notes-label').textContent,'Entry note');
    await p.elements.get('agenda-new').click();assert.equal(p.elements.get('agenda-notes-label').textContent,'Plan notes');
});

test('saved-history actions have distinct styling without changing correction identity or task-only repeat payload',async()=>{
    const saved={id:'saved-history-style',task_id:null,kind:'recorded_work',revision:3,provenance:'manual',
        start_time:'2000-01-04T09:00:00Z',end_time:'2000-01-04T09:20:00Z',notes:'Keep saved entry note'};
    const original=JSON.stringify(saved),starts=[],corrections=[];
    const p=sessionPage(async url=>url.startsWith('/agenda?')?[saved]:[]);
    p.context.multipleTimers={snapshot:()=>({fresh:true,pending:false,receipt:null}),start:async payload=>starts.push(payload)};
    p.context.openTimeCorrection=options=>corrections.push(options);
    await loadFolio(p);
    const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
    const buttons=descendants(p.elements.get('agenda-ledger')).filter(el=>el.tagName==='BUTTON');
    const adjust=buttons.find(el=>el.textContent==='Adjust saved actual time');
    const again=buttons.find(el=>el.textContent==='Start again');
    assert.equal(adjust.className,'history-entry-action history-entry-adjust');
    assert.equal(again.className,'history-entry-action history-entry-repeat');
    assert.equal(adjust.type,'button');assert.equal(again.type,'button');assert.equal(again.disabled,false);
    await adjust.click();assert.equal(corrections[0].row.id,saved.id);assert.equal(corrections[0].row.revision,3);
    await again.click();assert.deepEqual({...starts[0]},{task_id:null});
    assert.equal(JSON.stringify(saved),original,'restyling/repeat never rewrites saved notes, times or associations');
    assert.equal(p.writes.length,0,'correction entrypoint only opens its existing approval flow');
});
test('restyled repeat retains unavailable-task and pending/stale/uncertain timer disabling',async()=>{
    for(const scenario of ['pending','stale','receipt','missing task']){
        const saved={id:'guarded-history',task_id:scenario==='missing task'?'missing':null,kind:'recorded_work',
            start_time:'2000-01-04T09:00:00Z',end_time:'2000-01-04T09:20:00Z'};
        const p=sessionPage(async url=>url.startsWith('/agenda?')?[saved]:[]);
        p.context.multipleTimers={snapshot:()=>({fresh:scenario!=='stale',pending:scenario==='pending',receipt:scenario==='receipt'?{}:null})};
        await loadFolio(p);
        const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
        const again=descendants(p.elements.get('agenda-ledger')).find(el=>el.textContent==='Start again');
        assert.equal(again.disabled,true,scenario);
        assert.equal(again.dataset.workspaceStart,'true','shared timer synchronization must still own this control');
    }
});
test('Agenda mounts priority discovery through the shared launcher and keeps pins secondary',async()=>{
    const reads=[];
    const task={id:'low-priority-task',title:'Low task',priority:'low',match_kind:'default'};
    const p=sessionPage(async(url,options)=>{
        if(options.method!=='GET')return {operation_id:JSON.parse(options.body).operation_id,timer:{id:'started-timer',task_id:task.id,state:'running'}};
        reads.push(url);
        if(url.startsWith('/api/tasks/launcher'))return {suggestions:[{...task,match_kind:new URLSearchParams(url.split('?')[1]).get('q')?'prefix':'default'}]};
        if(url==='/api/tasks?status=all')return [task];
        if(url===`/api/tasks/${task.id}`)return task;
        if(url==='/timers')return {timers:[],revision:1};
        if(url.startsWith('/agenda?'))return [];
        return [];
    });
    const root=p.element('agenda-launcher');root.ownerDocument=p.context.document;root.querySelector=()=>null;
    const allTab=p.element('priority-tab','button'),pinnedTab=p.element('pinned-tab','button');
    allTab.dataset.activityTab='all';pinnedTab.dataset.activityTab='pinned';
    p.context.document.querySelectorAll=selector=>selector==='[data-activity-tab]'?[allTab,pinnedTab]:[];
    p.element('agenda-priority-control');p.element('agenda-priority','select').value='all';
    p.context.document.createTextNode=text=>{const node=p.element();node.textContent=text;return node;};
    p.context.document.querySelector=()=>({checked:true});
    const {createTimerController}=require('../src/timetrace/interfaces/api/static/js/multiple_timers.js');
    const storage=new Map();
    p.context.multipleTimers=createTimerController({api:p.run('api'),storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},operationId:()=> 'agenda-priority-start',onState(){}});
    await p.context.multipleTimers.refresh();
    p.load('task_launcher.js');loadFolio(p);
    await p.documentListeners.get('DOMContentLoaded')();
    await p.context.agendaTaskLauncher.model.refresh();
    assert.equal(p.context.agendaTaskLauncher.model.snapshot().view,'priority');
    assert.equal(p.context.agendaTaskLauncher.model.snapshot().filterOnly,true);
    await pinnedTab.click();assert.equal(root.hidden,true,'priority-only filter is not shown for pinned activities');
    await allTab.click();assert.equal(root.hidden,false);
    const historySearch=p.elements.get('agenda-search'),activityFilter=p.elements.get('agenda-activity-filter');
    assert.equal(typeof activityFilter.input,'function');
    historySearch.value='No such history';historySearch.input();
    assert.equal(p.context.agendaTaskLauncher.model.snapshot().query,'','history search does not refilter activities');
    activityFilter.value='Low';activityFilter.input();
    await p.context.agendaTaskLauncher.model.input('Low');
    await p.context.agendaTaskLauncher.model.key({key:'Enter'});assert.equal(p.writes.length,0,'filter Enter never starts');
    assert.equal(new URL(reads.findLast(url=>url.startsWith('/api/tasks/launcher')),'http://test').searchParams.get('view'),'priority');
    assert.equal(p.elements.get('agenda-pins').hidden,true);
    assert.equal(p.elements.get('agenda-activities').hidden,false);
    const section=p.elements.get('agenda-activities').children.find(el=>el.dataset.priority==='low');
    const body=section.children.find(el=>el.className==='launcher-group-body');
    const start=body.children.find(el=>el.tagName==='ARTICLE').children[1].children[0];
    await start.click();
    assert.equal(p.writes.length,1);assert.equal(p.writes[0].url,'/timers');assert.equal(p.writes[0].payload.task_id,task.id);assert.equal(p.writes[0].payload.scheduled_session_id,undefined);
});

test('#67 wholly past Calendar creation defaults to explicit work, while future and existing plans stay scheduling',()=>{
    const p=sessionPage();p.element('session_modal_intent');
    p.run('openCreateSessionModal(new Date("2020-01-01T09:00:00Z"),new Date("2020-01-01T10:00:00Z"),null,"","calendar")');
    assert.equal(p.run('sessionModalOwner.intent'),'work');
    assert.equal(p.elements.get('session_modal_save_btn').textContent,'Review actual work');
    p.run('openCreateSessionModal(new Date("2099-01-01T09:00:00Z"),new Date("2099-01-01T10:00:00Z"),null,"","calendar")');
    assert.equal(p.run('sessionModalOwner.intent'),'schedule');
    p.run('openEditSessionModal("plan",null,{id:"plan",kind:"scheduled_session",revision:2,start_time:"2020-01-01T09:00:00Z",end_time:"2020-01-01T10:00:00Z"})');
    assert.equal(p.run('sessionModalOwner.intent'),'schedule');
});

test('#67 reviewed manual recording retains its operation receipt and recovers only by GET',async()=>{
    const calls=[];let lost=true;
    const p=sessionPage(async(url,options)=>{calls.push([options.method,url]);
        if(options.method==='POST') {if(lost)throw Error('lost response');}
        if(url.startsWith('/operations/'))return {status:'finalized',result:{id:'work-uuid',kind:'recorded_work',linked_plan:{id:'plan-uuid',kind:'scheduled_session',revision:4}}};
        return [];
    });
    await assert.rejects(p.run('api.saveRecordedWork({operation_id:"reviewed-op",consent_token:"exact",start_time:"2020-01-01T09:00Z",end_time:"2020-01-01T10:00Z"})'),/lost response/);
    const recovered=await p.run('api.recoverRecordedWork()');
    assert.equal(recovered.id,'work-uuid');
    assert.equal(recovered.linked_plan.revision,4);
    assert.deepEqual(calls,[['POST','/recorded-work'],['GET','/operations/recorded-work%3Areviewed-op'],['GET','/api/tasks?status=all']]);
    assert.equal(p.run('api.recordedWorkAttempt()'),null);
});

test('#67 Calendar scheduled block offers explicit Record time initialized from current plan, not original or edited inputs',async()=>{
    const p=sessionPage();p.element('session_modal_plan_detail');p.context.crypto={randomUUID:()=> 'record-op'};
    p.load('reviewed_recording.js');
    p.run('rememberSavedSession({id:"plan-uuid",kind:"scheduled_session",task_id:"task-uuid",revision:3,original_start:"2020-01-01T08:00:00Z",original_end:"2020-01-01T09:00:00Z",start_time:"2020-01-01T09:00:00Z",end_time:"2020-01-01T10:00:00Z"});openEditSessionModal("plan-uuid")');
    const detail=p.elements.get('session_modal_plan_detail');
    const record=detail.children.find(n=>n.textContent==='Record time');assert.ok(record);
    await record.click();await new Promise(setImmediate);
    const preview=p.writes.find(w=>w.url==='/recorded-work/preview');
    assert.equal(preview.payload.start_time,'2020-01-01T09:00:00Z');
    assert.equal(preview.payload.end_time,'2020-01-01T10:00:00Z');
    assert.equal(preview.payload.scheduled_session_id,'plan-uuid');
    assert.equal(preview.payload.expected_plan_revision,3);
    assert.equal(preview.payload.task_id,'task-uuid');
    assert.equal(p.writes.filter(w=>w.url==='/recorded-work').length,0,'Record time only opens review');
});

test('#67 past external task drop opens recording confirmation without creating plan or changing task status',async()=>{
    const p=sessionPage(async()=>[]);p.load('dashboard.js');
    p.run('taskKnowledge.rememberFallback({id:"task-uuid",title:"Task",tags:"#tag"})');
    p.context.drop={event:{title:'Task',start:new Date('2020-01-01T09:00:00Z'),extendedProps:{taskId:'task-uuid',estimatedMinutes:20},remove(){}}};
    await p.run('scheduleCalendarDrop(drop)');
    assert.equal(p.writes.length,0);
    assert.equal(p.run('sessionModalOwner.intent'),'work');
    assert.equal(p.elements.get('session_modal_task_id').value,'task-uuid');
});

test('#67 Calendar adopts every final split part and replacement plan before failed refresh, retaining open schedule input',async()=>{
    const p=sessionPage(async()=>{throw Error('read failed');});
    const source={id:'source-plan',kind:'scheduled_session',revision:2,start_time:'2020-01-01T09:00:00Z',end_time:'2020-01-01T10:00:00Z',original_start:'2020-01-01T09:00:00Z',original_end:'2020-01-01T10:00:00Z'};
    p.context.source=source;p.run('rememberSavedSession(source);openEditSessionModal(source.id)');
    p.elements.get('session_modal_end').value='2020-01-01T10:15';
    await p.listeners.get('timetrace:timer-mutated')({detail:{schedule:{source_plan_id:source.id,parts:[{...source,revision:4,end_time:'2020-01-01T09:20:00Z'},{...source,id:'second-part',revision:2,start_time:'2020-01-01T09:30:00Z',end_time:'2020-01-01T09:40:00Z'}]}}});
    assert.equal(p.run('calendarSessionRows().find(r=>r.id==="source-plan").revision'),4);
    assert.equal(p.run('calendarSessionRows().find(r=>r.id==="second-part").revision'),2);
    assert.equal(p.elements.get('session_modal_end').value,'2020-01-01T10:15');
    assert.equal(p.run('sessionModalOwner.blocked'),true,'fresh endpoints require explicit review, not overwriting the draft');
});

test('#67 Calendar linked recording requires duplicate acknowledgement and adopts final plan revision without task or plan edits',async()=>{
    const plan={id:'plan-uuid',kind:'scheduled_session',task_id:'task-uuid',revision:3,start_time:'2020-01-01T09:00:00Z',end_time:'2020-01-01T10:00:00Z',original_start:'2020-01-01T08:00:00Z',original_end:'2020-01-01T09:00:00Z'};
    const p=sessionPage(async(url,options)=>{
        if(url==='/recorded-work/preview')return {plan,consent_token:'exact-duplicate-consent',duplicate_warning:true,existing_work:[{id:'existing-work',start_time:plan.start_time,end_time:plan.end_time}]};
        if(url==='/recorded-work')return {id:'new-work',kind:'recorded_work',...JSON.parse(options.body),linked_plan:{...plan,revision:4}};
        throw Error('display unavailable');
    });
    p.element('session_modal_plan_detail');p.context.plan=plan;p.run('rememberSavedSession(plan);openEditSessionModal(plan.id)');
    const initialEnd=p.elements.get('session_modal_end').value;
    const walk=n=>[n,...n.children.flatMap(walk)];
    const launch=p.elements.get('session_modal_plan_detail').children.find(n=>n.textContent==='Record time');
    launch.focus();launch.click();await new Promise(setImmediate);
    const dialog=p.context.document.body.children.at(-1),save=walk(dialog).find(n=>n.textContent==='Save linked recorded work');
    assert.equal(save.disabled,true);
    const check=walk(dialog).find(n=>n.type==='checkbox');check.checked=true;check.change();
    await save.click();await new Promise(setImmediate);
    const committed=p.writes.filter(w=>w.url==='/recorded-work');assert.equal(committed.length,1);
    assert.equal(committed[0].payload.acknowledge_existing_work,true);assert.equal(committed[0].payload.consent_token,'exact-duplicate-consent');
    assert.equal(p.run('sessionModalOwner.session.revision'),4);
    assert.equal(p.elements.get('session_modal_end').value,initialEnd);
    assert.equal(p.context.document.activeElement,launch,'ACK preserves the plan action DOM/focus');
    launch.click();await new Promise(setImmediate);
    assert.equal(p.writes.filter(w=>w.url==='/recorded-work/preview').at(-1).payload.expected_plan_revision,4);
    assert.equal(p.writes.some(w=>w.method==='PUT'),false,'no status, estimate or schedule rewrite');
});

test('#67 future manual end is previewed unchanged, rejected visibly and never clipped or saved',async()=>{
    const p=sessionPage(async(url)=>url==='/recorded-work/preview'?new Response(JSON.stringify({detail:'Recorded work cannot end in the future.',code:'future_recorded_end'}),{status:400}):[]);
    p.run('openCreateSessionModal(new Date("2099-01-01T09:00:00Z"),new Date("2099-01-01T10:00:00Z"),null,"","work")');
    const initialEnd=p.elements.get('session_modal_end').value;
    const saving=p.run('saveSessionFromModal()');await new Promise(setImmediate);
    const walk=n=>[n,...n.children.flatMap(walk)],dialog=p.context.document.body.children.at(-1);
    assert.equal(p.writes[0].payload.end_time,'2099-01-01T10:00:00.000Z');
    assert.ok(walk(dialog).some(n=>n.textContent.includes('cannot end in the future')));
    assert.equal(walk(dialog).find(n=>n.textContent==='Save recorded work').disabled,true);
    dialog.cancel({preventDefault(){}});await saving;
    assert.equal(p.writes.some(w=>w.url==='/recorded-work'),false);
    assert.equal(p.elements.get('session_modal_end').value,initialEnd);
});

test('#67 Calendar past quick creation uses its resolved default duration before choosing work intent',()=>{
    const p=sessionPage();p.element('session_modal_intent');
    p.run('openCreateSessionModal(new Date("2020-01-01T09:00:00Z"),null,null,"","calendar")');
    assert.equal(p.run('sessionModalOwner.intent'),'work');
    assert.equal(p.elements.get('session_modal_intent').value,'work');
    assert.equal(p.elements.get('session_modal_save_btn').textContent,'Review actual work');
});
