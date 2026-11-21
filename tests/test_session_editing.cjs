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
            if (data instanceof Response) return data;
            if (url.startsWith('/agenda?') && Array.isArray(data)) {
                return { status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => ({ items: data }) };
            }
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

test('delete preserves a legacy successor while its schedule attempt needs review', async () => {
    const p = sessionPage();
    const row = { id: 'legacy-successor', kind: 'scheduled_session', series_task_id: 'task',
        occurrence_start: '2026-11-10T09:00:00Z' };
    p.context.allSessions = [row];
    p.run('calendarNeedsReview.set("virt:task:20261110T090000Z", { latest: { id: "legacy-successor" } })');
    await p.run('promptDeleteSession("legacy-successor")');
    assert.equal(p.writes.length, 0);
    assert.match(p.alerts.at(-1), /explicitly discard/);
    assert.equal(p.context.allSessions.length, 1);
});

test('delete checks review again after confirmation is pending', async () => {
    const confirmation = deferred();
    const p = sessionPage();
    p.context.allSessions = [{ id: 'legacy-successor' }];
    p.context.showCustomConfirm = () => confirmation.promise;
    const deleting = p.run('promptDeleteSession("legacy-successor")');
    p.run('calendarNeedsReview.set("legacy-successor", { latest: { id: "legacy-successor" } })');
    confirmation.resolve(true);
    await deleting;
    assert.equal(p.writes.length, 0);
    assert.match(p.alerts.at(-1), /explicitly discard/);
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
        'notes', 'start', 'end', 'save', 'cancel']) p.element(`agenda-${suffix}`);
    p.context.URLSearchParams = URLSearchParams;
    p.context.confirm = () => true;
    p.load('agenda.js');
    return p.run('agendaPage.refresh()');
}

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
    p.elements.get('agenda-new').click();
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
    p.elements.get('agenda-ledger').children.find(e => e.dataset.agendaRow === 'plan-a').click();
    p.elements.get('agenda-end').value = '2099-01-04T11:00';
    await p.elements.get('agenda-form').submit({ preventDefault() {} });
    await reviewRead.promise;
    assert.equal(p.elements.get('agenda-end').value, '2099-01-04T11:00');
    assert.match(p.elements.get('agenda-edit-status').textContent, /changed on the server/);
    await p.elements.get('agenda-form').submit({ preventDefault() {} });
    assert.equal(p.writes.length, 1);
    p.elements.get('agenda-ledger').children.find(e => e.dataset.agendaRow === 'plan-b').click();
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
    p.elements.get('agenda-new').click();
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
        p.elements.get('agenda-date').change();
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
    p.elements.get('agenda-ledger').children.at(-1).click();
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
        await panel.children.at(-1).children[1].click();
        const review = panel.children.at(-1);
        assert.match(review.children[0].textContent, /Latest saved/);
        await review.children[2].click();
        assert.equal(p.writes.length, 1, 'review is not another write');
        await p.run('handleCalendarEventUpdate(event)');
        assert.match(p.writes[1].url, /\/(scheduled-sessions|sessions)\/successor\?/);
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
