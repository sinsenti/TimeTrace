const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// Caller seam: shipped handlers + ApiClient, with only HTTP, clock and browser DOM boundaries controlled.
function sessionPage(http = async () => ({ id: 'real-session' })) {
    const elements = new Map(), alerts = [], writes = [], listeners = new Map();
    let context;
    function element(id = '', tag = 'div') {
        const classes = new Set(['hidden']);
        const el = { id, tagName: tag.toUpperCase(), type: '', value: '', textContent: '', children: [], dataset: {}, style: {}, isConnected: true,
            classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, on) { if (on) classes.add(c); else classes.delete(c); } },
            setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
            addEventListener(name, fn) { this[name] = fn; }, removeEventListener() {},
            appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); },
            querySelectorAll() { return []; }, contains(child) { return this === child || this.children.includes(child); },
            insertBefore(child) { this.children.unshift(child); }, remove() { elements.delete(this.id); },
            focus() { context.document.activeElement = this; }, select() {} };
        if (id) elements.set(id, el);
        return el;
    }
    const document = { getElementById: id => elements.get(id) || null, createElement: tag => element('', tag),
        addEventListener() {}, removeEventListener() {}, querySelectorAll() { return []; }, body: element('body') };
    context = vm.createContext({ document, Date, setTimeout: () => {}, console: { error() {} },
        localStorage: { getItem: () => null }, alert: msg => alerts.push(msg),
        addEventListener(name, fn) { listeners.set(name, fn); },
        async fetch(url, options) {
            if (options.method !== 'GET') writes.push({ url, method: options.method, payload: options.body && JSON.parse(options.body) });
            const data = await http(url, options);
            return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => data };
        }
    });
    context.window = context;
    const run = code => vm.runInContext(code, context);
    const load = name => vm.runInContext(fs.readFileSync(path.join(js, name), 'utf8'), context, { filename: name });
    for (const id of ['edit_session_id', 'session_modal_title', 'session_modal_start_now_btn', 'session_modal_delete_btn',
        'session_modal_start', 'session_modal_end', 'session_modal_task_id', 'session_modal_tags_input', 'session_modal_task_search',
        'task_chip_container', 'session_modal_notes', 'session_modal', 'recurring_delete_modal', 'session_modal_save_btn', 'session_modal_feedback']) element(id, 'input');
    element('launcher', 'button').focus();
    for (const name of ['api_client.js', 'task_knowledge.js', 'utils.js', 'task_attach.js', 'tags_engine.js', 'session_modal.js', 'calendar.js']) load(name);
    context.allSessions = [];
    const open = () => run('openCreateSessionModal(new Date("2026-11-10T23:45:00Z"), new Date("2026-11-11T00:30:00Z"))');
    return { context, elements, alerts, writes, listeners, run, load, open, element };
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
