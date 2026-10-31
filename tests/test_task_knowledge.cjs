const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const staticJs = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
function page(api) {
    const elements = new Map();
    function element(tag = 'div') {
        const classes = new Set();
        return {
            tagName: tag.toUpperCase(), value: '', textContent: '', innerHTML: '', children: [], style: {}, dataset: {},
            get childNodes() { return this.children; },
            classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
            appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); return child; },
            setAttribute() {}, addEventListener(name, fn) { this[name] = fn; },
            querySelectorAll() { return []; }, insertBefore(child) { this.children.push(child); },
            remove() { if (this.id) elements.delete(this.id); }, focus() {}, select() {}
        };
    }
    const document = { getElementById: id => elements.get(id) || null, createElement: element,
        addEventListener() {}, querySelectorAll() { return []; }, body: element('body') };
    const alerts = [];
    const logs = [];
    const context = vm.createContext({ api, document, console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) }, setTimeout: () => {},
        localStorage: { getItem: () => null }, addEventListener() {}, alert: msg => alerts.push(msg) });
    context.window = context;
    const run = code => vm.runInContext(code, context);
    const load = filename => vm.runInContext(fs.readFileSync(path.join(staticJs, filename), 'utf8'), context, { filename });
    if (fs.existsSync(path.join(staticJs, 'task_knowledge.js'))) load('task_knowledge.js');
    load('task_attach.js');
    return { context, run, load, elements, element, alerts, logs };
}
function sessionPage(api = {}) {
    const writes = [];
    const p = page({
        get: async () => { throw Error('offline'); },
        async put(url, payload) {
            writes.push({ url, payload });
            return { id: 'session-1', ...payload };
        },
        ...api
    });
    for (const id of ['edit_session_id', 'session_modal_title', 'session_modal_start_now_btn',
        'session_modal_delete_btn', 'session_modal_start', 'session_modal_end', 'session_modal_task_id',
        'session_modal_tags_input', 'session_modal_task_search', 'task_chip_container', 'session_modal_notes',
        'session_modal', 'recurring_delete_modal']) p.elements.set(id, p.element());
    p.load('utils.js');
    p.load('tags_engine.js');
    p.load('session_modal.js');
    p.load('calendar.js');
    p.context.confirm = () => false;
    p.context.allSessions = [{ id: 'session-1', task_id: 'missing-id',
        start_time: '2026-01-01T10:00:00Z', end_time: '2026-01-01T10:45:00Z', tags: '#kept', notes: 'Keep notes' }];
    return { ...p, writes };
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test('session open/save retains its task ID when metadata is unavailable', async () => {
    const p = sessionPage();
    await p.run('fetchAllTasksRegistry()');
    p.run('openEditSessionModal("session-1")');
    assert.equal(p.elements.get('session_modal_task_id').value, 'missing-id');
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes[0].payload.task_id, 'missing-id');
    assert.equal(p.writes[0].payload.notes, 'Keep notes');
    assert.equal(p.writes[0].payload.tags, '#kept');
});

for (const metadata of [[], [{ id: 'missing-id', title: 'Title only' }]]) {
    test(`session link survives ${metadata.length ? 'partial' : 'successfully empty'} metadata and later refresh`, async () => {
        const p = sessionPage({ get: async () => metadata });
        await p.run('fetchAllTasksRegistry()');
        p.run('openEditSessionModal("session-1")');
        p.elements.get('session_modal_notes').value = 'Unsaved edit';
        await p.run('taskKnowledge.changed()');
        await p.run('saveSessionFromModal()');
        assert.equal(p.writes[0].payload.task_id, 'missing-id');
        assert.equal(p.writes[0].payload.notes, 'Unsaved edit');
        assert.equal(p.writes[0].payload.end_time, '2026-01-01T10:45:00.000Z');
    });
}

test('only explicit detach or an authoritative session row clears a session link', async () => {
    const p = sessionPage();
    p.run('openEditSessionModal("session-1"); detachTask()');
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes[0].payload.task_id, null);
    p.context.allSessions[0].task_id = 'missing-id';
    p.run('openEditSessionModal("session-1")');
    assert.equal(p.elements.get('session_modal_task_id').value, 'missing-id');
    // A subsequent daemon session read, unlike a metadata miss, is authoritative.
    p.context.allSessions[0].task_id = null;
    p.run('openEditSessionModal("session-1")');
    await p.run('saveSessionFromModal()');
    assert.equal(p.writes[1].payload.task_id, null);
});

test('ordinary title-only attachment and creation replace the previous link without requiring metadata', async () => {
    const p = sessionPage();
    p.run('openEditSessionModal("session-1")');
    p.run('openCreateSessionModal(new Date("2026-01-02T10:00Z"), null, "other-id", "Dragged title")');
    assert.equal(p.elements.get('session_modal_task_id').value, 'other-id');
    assert.match(p.elements.get('task_chip_container').children.at(-1).children[0].textContent, /Dragged title/);
    p.run('attachTaskById("third-id", true)');
    assert.equal(p.elements.get('session_modal_task_id').value, 'third-id');
});

function resizeEvent(props = { taskId: 'missing-id' }, id = 'session-1') {
    return { id, start: new Date('2026-01-01T10:00Z'), end: new Date('2026-01-01T11:00Z'), extendedProps: props };
}

test('resize resolves unknown recurrence before offering a scope', async () => {
    const p = sessionPage({ get: async () => [{ id: 'missing-id', title: 'Recurring', is_recurring: true }] });
    p.context.event = resizeEvent();
    p.context.showRecurringResizeScopePrompt = async () => 'all_future';
    await p.run('handleCalendarEventUpdate(event, "resize")');
    assert.equal(p.writes[0].url, '/sessions/session-1?scope=all_future');
    assert.deepEqual(Object.keys(p.writes[0].payload).sort(), ['end_time', 'start_time']);
});

test('delete resolves unknown recurrence before offering series scopes', async () => {
    const p = sessionPage({ get: async () => [{ id: 'missing-id', title: 'Recurring', is_recurring: true }] });
    p.elements.get('recurring_delete_modal').classList.add('hidden');
    await p.run('promptDeleteSession("session-1")');
    assert.equal(p.elements.get('recurring_delete_modal').classList.contains('hidden'), false);
});

for (const result of ['offline', 'missing', 'partial']) {
    test(`unresolved ${result} recurrence blocks only resize, reverts, and can be retried`, async () => {
        let recover = false;
        const p = sessionPage({ get: async () => {
            if (recover) return [{ id: 'missing-id', title: 'Known ordinary', is_recurring: false }];
            if (result === 'offline') throw Error('offline');
            return result === 'partial' ? [{ id: 'missing-id', title: 'Title only', recurrence_rule: 'daily' }] : [];
        } });
        p.context.event = resizeEvent();
        let reverted = 0;
        p.context.info = { revert() { reverted++; } };
        p.run('openEditSessionModal("session-1")');
        await p.run('handleCalendarEventUpdate(event, "resize", info)');
        assert.equal(p.writes.length, 0);
        assert.equal(reverted, 1);
        assert.match(p.alerts[0], /recurrence.*retry/i);
        assert.equal(p.elements.get('session_modal_task_id').value, 'missing-id');
        assert.equal(p.elements.get('session_modal_notes').value, 'Keep notes');
        // Moving this occurrence needs no recurrence scope decision and still works offline.
        await p.run('handleCalendarEventUpdate(event, "move", info)');
        assert.equal(p.writes.length, 1);
        recover = true;
        await p.run('handleCalendarEventUpdate(event, "resize", info)');
        assert.equal(p.writes.length, 2, 'retry must not queue/replay the blocked write');
        assert.equal(p.writes[1].url, '/sessions/session-1?scope=only_this');
    });
}

for (const choice of ['only_this', 'all_future', null]) {
    test(`known virtual resize keeps scope choice ${choice} even without task metadata`, async () => {
        const p = sessionPage();
        const id = 'virt:missing-id:20260101T100000Z';
        p.context.event = resizeEvent({}, id);
        p.context.showRecurringResizeScopePrompt = async () => choice;
        let reverted = 0;
        let refreshed = 0;
        p.context.info = { revert() { reverted++; } };
        p.context.calendar = { refetchEvents() { refreshed++; } };
        await p.run('handleCalendarEventUpdate(event, "resize", info)');
        assert.equal(reverted, choice === null ? 1 : 0);
        assert.equal(p.writes.length, choice === null ? 0 : 1);
        if (choice) {
            assert.equal(p.writes[0].url, `/sessions/${encodeURIComponent(id)}?scope=${choice}`);
            assert.equal(refreshed, 1, 'a synthetic ID materializes and needs a range refresh');
        }
        assert.equal(p.alerts.length, 0);
    });
}

test('known ordinary and stale recurring metadata retain their distinct resize behavior', async () => {
    for (const recurring of [false, true]) {
        let offline = false;
        const p = sessionPage({ get: async () => {
            if (offline) throw Error('offline');
            return [{ id: 'missing-id', title: 'Known', is_recurring: recurring, estimated_minutes: 35 }];
        } });
        await p.run('fetchAllTasksRegistry()');
        offline = true;
        await p.run('taskKnowledge.changed()');
        let prompts = 0;
        p.context.showRecurringResizeScopePrompt = async () => { prompts++; return 'only_this'; };
        p.context.event = resizeEvent();
        await p.run('handleCalendarEventUpdate(event, "resize")');
        assert.equal(prompts, recurring ? 1 : 0);
        assert.equal(p.writes.length, 1);
        assert.equal(p.writes[0].url, '/sessions/session-1?scope=only_this');
        assert.equal(p.run('taskKnowledge.get("missing-id").estimated_minutes'), 35);
    }
});

test('a rejected recurring resize reverts instead of trying a different scope', async () => {
    const p = sessionPage({ put: async () => { throw Error('scope rejected by server'); } });
    p.context.event = resizeEvent({ isVirtual: true });
    p.context.showRecurringResizeScopePrompt = async () => 'all_future';
    let reverted = 0;
    p.context.info = { revert() { reverted++; } };
    await p.run('handleCalendarEventUpdate(event, "resize", info)');
    assert.equal(reverted, 1);
    assert.equal(p.logs.length, 1);
});

for (const result of ['offline', 'missing', 'partial']) {
    test(`delete with ${result} recurrence stops before confirmation and retries without replay`, async () => {
        let recover = false;
        const deleted = [];
        let confirmations = 0;
        const p = sessionPage({
            get: async () => {
                if (recover) return [{ id: 'missing-id', title: 'Resolved recurring', is_recurring: true }];
                if (result === 'offline') throw Error('offline');
                return result === 'partial' ? [{ id: 'missing-id', title: 'Title only' }] : [];
            },
            delete: async url => deleted.push(url)
        });
        p.context.confirm = () => { confirmations++; return true; };
        p.elements.get('recurring_delete_modal').classList.add('hidden');
        await p.run('promptDeleteSession("session-1")');
        assert.equal(confirmations, 0);
        assert.equal(deleted.length, 0);
        assert.equal(p.elements.get('recurring_delete_modal').classList.contains('hidden'), true);
        assert.match(p.alerts[0], /recurrence.*retry/i);
        recover = true;
        await p.run('promptDeleteSession("session-1")');
        assert.equal(deleted.length, 0, 'recovery only offers scopes, never replays a delete');
        assert.equal(p.elements.get('recurring_delete_modal').classList.contains('hidden'), false);
        await p.run('confirmRecurringDelete("following")');
        assert.deepEqual(deleted, ['/sessions/session-1?scope=following']);
    });
}

for (const identity of ['synthetic', 'virtual', 'materialized']) {
    test(`known ${identity} occurrence deletion offers scopes even with unavailable task metadata`, async () => {
        const deleted = [];
        const p = sessionPage({ delete: async url => deleted.push(url) });
        const id = identity === 'synthetic' ? 'virt:missing-id:20260101T100000Z' : 'session-1';
        if (identity === 'synthetic') p.context.allSessions = [];
        if (identity === 'virtual') p.context.allSessions[0].is_virtual = true;
        if (identity === 'materialized') p.context.allSessions[0].series_task_id = 'missing-id';
        p.context.sid = id;
        p.elements.get('recurring_delete_modal').classList.add('hidden');
        await p.run('promptDeleteSession(sid)');
        assert.equal(p.elements.get('recurring_delete_modal').classList.contains('hidden'), false);
        p.run('closeRecurringDeleteModal()');
        await p.run('confirmRecurringDelete("all")');
        assert.deepEqual(deleted, [], 'cancellation must not delete');
        await p.run('promptDeleteSession(sid); confirmRecurringDelete("only_this")');
        assert.deepEqual(deleted, [`/sessions/${encodeURIComponent(id)}?scope=only_this`]);
    });
}

test('deleting an uncached session uses its authoritative daemon link and known nonrecurrence', async () => {
    const deleted = [];
    const p = sessionPage({
        get: async url => url === '/sessions/session-1' ? { id: 'session-1', task_id: null } : [],
        delete: async url => deleted.push(url)
    });
    p.context.allSessions = [];
    p.context.confirm = () => true;
    await p.run('promptDeleteSession("session-1")');
    assert.deepEqual(deleted, ['/sessions/session-1?scope=only_this']);
});

test('session save accepts authoritative detachment and materialized IDs returned by the daemon', async () => {
    const p = sessionPage({ put: async (url, payload) => ({ id: 'real-id', ...payload, task_id: null }) });
    const id = 'virt:missing-id:20260101T100000Z';
    p.context.allSessions[0].id = id;
    p.context.sid = id;
    p.run('openEditSessionModal(sid)');
    await p.run('saveSessionFromModal()');
    assert.equal(p.elements.get('edit_session_id').value, 'real-id');
    assert.deepEqual(p.context.allSessions.map(s => s.id), ['real-id']);
    p.run('openEditSessionModal("real-id")');
    assert.equal(p.elements.get('session_modal_task_id').value, '');
});

test('fallback attachment titles are displayed as text, never executable markup', () => {
    const p = sessionPage();
    const title = '<img src=x onerror=alert(1)>';
    p.context.fallbackTitle = title;
    p.run('openCreateSessionModal(new Date("2026-01-02T10:00Z"), null, "fallback-id", fallbackTitle)');
    const chip = p.elements.get('task_chip_container').children.at(-1);
    assert.equal(chip.children[0].textContent, `✓ ${title}`);
    assert.doesNotMatch(chip.innerHTML, /<img/);
});

test('a delayed delete lookup cannot replace a newer occurrence target', async () => {
    const lookup = deferred();
    const deleted = [];
    const p = sessionPage({ get: () => lookup.promise, delete: async url => deleted.push(url) });
    const old = p.run('promptDeleteSession("session-1")');
    p.context.allSessions.push({ id: 'virt:other-id:20260101T100000Z', task_id: 'other-id', is_virtual: true });
    await p.run('promptDeleteSession("virt:other-id:20260101T100000Z")');
    lookup.resolve([{ id: 'missing-id', title: 'Old target', is_recurring: true }]);
    await old;
    await p.run('confirmRecurringDelete("all")');
    assert.deepEqual(deleted, ['/sessions/virt%3Aother-id%3A20260101T100000Z?scope=all']);
});

for (const cancel of ['closeRecurringDeleteModal()', 'closeSessionModal()']) {
    test(`canceling a pending delete via ${cancel} ignores its late lookup`, async () => {
        const lookup = deferred();
        const deleted = [];
        const p = sessionPage({ get: () => lookup.promise, delete: async url => deleted.push(url) });
        p.elements.get('recurring_delete_modal').classList.add('hidden');
        const action = p.run('promptDeleteSession("session-1")');
        p.run(cancel);
        lookup.resolve([{ id: 'missing-id', title: 'Canceled task', is_recurring: true }]);
        await action;
        assert.equal(p.elements.get('recurring_delete_modal').classList.contains('hidden'), true);
        await p.run('confirmRecurringDelete("all")');
        assert.deepEqual(deleted, []);
    });
}

for (const kind of ['unknown', 'materialized', 'virtual', 'ordinary']) {
    test(`keyboard Delete uses recurrence protection for ${kind} sessions`, async () => {
        const deleted = [];
        let lookups = 0;
        let confirmations = 0;
        let recover = false;
        const p = sessionPage({
            get: async () => {
                lookups++;
                if (kind === 'unknown' && !recover) throw Error('metadata offline');
                return [{ id: 'missing-id', title: 'Task', is_recurring: kind !== 'ordinary' }];
            },
            delete: async url => deleted.push(url)
        });
        p.load('vim_engine.js');
        p.context.showCustomConfirm = async () => { confirmations++; return true; };
        p.elements.get('recurring_delete_modal').classList.add('hidden');
        if (kind === 'materialized') p.context.allSessions[0].series_task_id = 'missing-id';
        if (kind === 'virtual') p.context.allSessions[0].id = 'virt:missing-id:20260101T100000Z';
        p.run('cursorStart = new Date("2026-01-01T10:15Z")');

        await p.run('handleDeleteUnderCursor()');
        if (kind === 'unknown') {
            assert.equal(lookups, 1);
            assert.equal(confirmations, 0);
            assert.deepEqual(deleted, []);
            assert.match(p.alerts[0], /recurrence.*retry/i);
            recover = true;
            await p.run('handleDeleteUnderCursor()');
        }
        if (kind === 'ordinary') {
            assert.equal(confirmations, 1);
            assert.deepEqual(deleted, ['/sessions/session-1?scope=only_this']);
        } else {
            assert.equal(confirmations, 0);
            assert.deepEqual(deleted, []);
            assert.equal(p.elements.get('recurring_delete_modal').classList.contains('hidden'), false);
            await p.run('confirmRecurringDelete("following")');
            const id = kind === 'virtual' ? 'virt%3Amissing-id%3A20260101T100000Z' : 'session-1';
            assert.deepEqual(deleted, [`/sessions/${id}?scope=following`]);
            if (kind !== 'unknown') assert.equal(lookups, 0, 'series identity needs no metadata lookup');
        }
    });
}

test('successfully empty metadata is cached instead of repeatedly loaded', async () => {
    let reads = 0;
    const p = page({ get: async () => { reads++; return []; } });
    await p.run('fetchAllTasksRegistry()');
    await p.run('fetchAllTasksRegistry()');
    assert.equal(reads, 1);
});

test('overlapping loads share a request, and invalidation supersedes an older response', async () => {
    const old = deferred();
    const newer = deferred();
    let reads = 0;
    const p = page({ get: () => (++reads === 1 ? old.promise : newer.promise) });
    const first = p.run('fetchAllTasksRegistry()');
    const duplicate = p.run('fetchAllTasksRegistry(true)');
    assert.equal(reads, 1);
    p.run('taskKnowledge.invalidate()');
    const afterWrite = p.run('fetchAllTasksRegistry()');
    newer.resolve([{ id: 'task-1', title: 'Renamed' }]);
    await afterWrite;
    old.resolve([{ id: 'task-1', title: 'Old name' }]);
    await Promise.all([first, duplicate]);
    assert.equal(p.run('taskKnowledge.get("task-1").title'), 'Renamed');
    assert.equal(p.run('taskKnowledge.state().status'), 'fresh');
});

test('invalidation alone during an in-flight load obtains post-mutation metadata', async () => {
    const old = deferred();
    let reads = 0;
    const p = page({ get: async () => (++reads === 1 ? old.promise : [{ id: 'task-1', title: 'After mutation' }]) });
    const loading = p.run('fetchAllTasksRegistry()');
    assert.equal(p.run('taskKnowledge.state().loading'), true);
    p.run('taskKnowledge.invalidate()');
    old.resolve([{ id: 'task-1', title: 'Before mutation' }]);
    await loading;
    assert.equal(p.run('taskKnowledge.get("task-1").title'), 'After mutation');
    assert.equal(reads, 2);
});

test('title-only calendar-drop and attachment fallbacks do not pretend to be a loaded registry', async () => {
    const p = page({ get: async () => { throw Error('offline'); } });
    p.load('utils.js');
    p.load('dashboard.js');
    p.load('calendar.js');
    await p.run('resolveCalendarDropTask("missing-id", "Dragged task")');
    assert.equal(p.run('taskKnowledge.state().status'), 'failed');
    assert.equal(p.run('taskKnowledge.values().length'), 0);
    assert.equal(p.run('taskKnowledge.get("missing-id").title'), 'Dragged task');
    p.elements.set('session_modal_task_id', p.element());
    p.run('attachTaskById("missing-id", true)');
    assert.equal(p.elements.get('session_modal_task_id').value, 'missing-id');
    const event = p.run('formatCalEventFromSession({id: "session-1", task_id: "missing-id"})');
    assert.equal(event.title, 'Dragged task');
});

test('failed cold loads are unavailable; refresh retry keeps last-known metadata and clears the notice', async () => {
    let fail = true;
    const p = page({ get: async () => {
        if (fail) throw Error('offline');
        return [{ id: 'task-1', title: 'Last known' }];
    } });
    assert.equal(p.run('taskKnowledge.state().status'), 'unloaded');
    await p.run('fetchAllTasksRegistry()');
    assert.equal(p.run('taskKnowledge.state().status'), 'failed');
    assert.match(p.elements.get('task_metadata_notice').children[0].textContent, /unavailable/i);
    fail = false;
    await p.elements.get('task_metadata_notice').children[1].click();
    assert.equal(p.run('taskKnowledge.state().status'), 'fresh');
    assert.equal(p.elements.has('task_metadata_notice'), false);
    fail = true;
    await p.run('taskKnowledge.refresh()');
    assert.equal(p.run('taskKnowledge.state().status'), 'stale');
    assert.equal(p.run('taskKnowledge.get("task-1").title'), 'Last known');
    assert.match(p.elements.get('task_metadata_notice').children[0].textContent, /stale/i);
    fail = false;
    await p.elements.get('task_metadata_notice').children[1].click();
    assert.equal(p.elements.has('task_metadata_notice'), false);
});

function workflowPage(title = 'Original', acceptedChanges = {}) {
    let rows = [{ id: 'task-1', title, status: 'To Do', estimated_minutes: 15 }];
    let failBoard = false;
    let failRegistry = false;
    const writes = [];
    const p = page({
        async get(url) {
            if (failRegistry && url === '/api/tasks?status=all') throw Error('metadata offline');
            if (url === '/api/tasks/statuses') {
                if (failBoard) throw Error('board offline');
                return [{ id: 'status-1', name: 'To Do' }];
            }
            if (url.startsWith('/api/tasks?')) return rows.map(t => ({ ...t }));
            if (url === '/api/tasks/task-1') return { ...rows[0] };
            if (url === '/api/tasks/task-1/tree') return { ...rows[0], subtasks: [] };
            if (url === '/api/tasks/task-1/stats') return { task: { ...rows[0] }, total_sessions: 0, logged_hours: 0, scheduled_hours: 0, progress_pct: 0, sessions: [] };
            if (url === '/rating-definitions?target_type=task') return [];
            if (url.startsWith('/api/ai/drafts/')) throw Error('draft cards offline');
            if (url.startsWith('/sessions?')) return [{ id: 'session-1', task_id: 'task-1', start_time: '2026-01-01T09:00:00Z', end_time: '2026-01-01T09:15:00Z' }];
            throw Error(`Unexpected GET ${url}`);
        },
        async put(url, payload) {
            writes.push(url);
            rows = rows.map(t => t.id === 'task-1' ? { ...t, ...payload } : t);
            return rows[0];
        },
        async post(url, payload) {
            writes.push(url);
            if (url.startsWith('/api/ai/drafts/')) {
                const title = url.endsWith('/undo') || url.endsWith('/drafts/undo') ? 'Original' : 'AI renamed';
                rows = rows.map(t => ({ ...t, title, ...acceptedChanges }));
                return { completion_policies: [] };
            }
            const task = { id: 'task-2', ...payload };
            rows.push(task);
            return task;
        },
        async delete(url) { writes.push(url); rows = rows.filter(t => !url.endsWith(t.id)); }
    });
    for (const id of ['task_card_list', 'kanban_columns_container', 'task_suggestions_dropdown', 'session_modal_task_search',
        'modal_input_title', 'edit_task_id', 'task_modal', 'session_modal_notes', 'session_modal_start', 'session_modal_end']) {
        p.elements.set(id, p.element());
    }
    p.elements.get('session_modal_notes').value = 'Unsaved notes';
    p.elements.get('session_modal_start').value = '2026-01-01T10:00';
    p.elements.get('session_modal_end').value = '2026-01-01T10:45';
    for (const file of ['utils.js', 'calendar.js', 'sidebar_totals.js', 'kanban.js', 'task_modal.js']) p.load(file);
    p.context.showCustomConfirm = async () => true;
    let rendered = [];
    p.context.calendar = {
        view: { type: 'timeGridDay', activeStart: new Date('2026-01-01'), activeEnd: new Date('2026-01-02') },
        unselect() {},
        refetchEvents() { return p.context.fetchCalendarEvents({ start: this.view.activeStart, end: this.view.activeEnd }, events => { rendered = events; }, err => { throw err; }); }
    };
    p.run('var activeTasks = [], allSessions = []');
    return { ...p, writes, rendered: () => rendered, failBoard: val => { failBoard = val; },
        failRegistry: val => { failRegistry = val; } };
}

// A bounded select double: unlike plain objects, an absent option cannot retain a value.
// This covers option selection semantics, not a browser/manual acceptance check.
function taskSelect() {
    let markup = '';
    let options = [];
    let selectedIndex = -1;
    return {
        get innerHTML() { return markup; },
        set innerHTML(value) {
            markup = value;
            options = [...value.matchAll(/<option value="([^"]*)">([^]*?)<\/option>/g)]
                .map(match => ({ value: match[1], textContent: match[2] }));
            selectedIndex = options.length ? 0 : -1;
        },
        get options() { return options; },
        get selectedIndex() { return selectedIndex; },
        get value() { return options[selectedIndex]?.value || ''; },
        set value(value) { selectedIndex = options.findIndex(option => option.value === value); }
    };
}

for (const missing of ['completed', 'filtered', 'unavailable']) {
    test(`AI refresh preserves an excluded (${missing}) unsaved timer selection through Start`, async () => {
        const p = workflowPage('Original', { status: 'Done' });
        p.load('ai_drafts.js');
        p.load('timer_control.js');
        const select = taskSelect();
        p.elements.set('timer_task_select', select);
        await p.run('taskKnowledge.refresh()');
        select.value = 'task-1';
        assert.equal(select.value, 'task-1');
        const get = p.context.api.get;
        p.context.api.get = async url => {
            if (missing === 'unavailable' && url === '/api/tasks?status=all') return [];
            if (missing !== 'completed' && url.startsWith('/api/tasks?status=all&sort=')) return [];
            if (url === '/timer/status') return null;
            return get(url);
        };
        const card = p.context.aiBuildDraftBatchNode({ id: 'batch-1', status: 'pending', items: [] });
        await card.children.flatMap(n => n.children).find(n => n.textContent === 'Accept').click();
        assert.equal(select.value, 'task-1', 'refresh must not detach an unsaved timer task');
        const post = p.context.api.post;
        let started;
        p.context.api.post = async (url, payload) => {
            if (url === '/timer/start') { started = payload; return {}; }
            return post(url, payload);
        };
        await p.run('toggleTimer()');
        assert.equal(started.task_id, 'task-1');
        // Explicit user detach must remain possible.
        select.value = '';
        await p.run('toggleTimer()');
        assert.equal(started.task_id, null);
        assert.equal(p.writes.length, 1, 'only one AI acceptance write');
    });
}

test('task rename/create/delete updates calendar, sidebar, kanban and visible attachment suggestions', async () => {
    const p = workflowPage();
    await p.run('fetchAllTasksRegistry()');
    p.run('renderTaskSuggestions("")');
    p.elements.get('edit_task_id').value = 'task-1';
    p.elements.get('modal_input_title').value = 'Renamed';
    await p.run('saveTask()');
    assert.match(p.elements.get('task_suggestions_dropdown').innerHTML, /Renamed/);
    assert.match(p.elements.get('task_card_list').innerHTML, /Renamed/);
    assert.match(p.elements.get('kanban_columns_container').innerHTML, /Renamed/);
    assert.equal(p.rendered()[0].title, 'Renamed');
    p.elements.get('edit_task_id').value = '';
    p.elements.get('modal_input_title').value = 'New task';
    await p.run('saveTask()');
    assert.match(p.elements.get('task_suggestions_dropdown').innerHTML, /New task/);
    p.elements.get('edit_task_id').value = 'task-1';
    await p.run('deleteTask()');
    assert.doesNotMatch(p.elements.get('task_suggestions_dropdown').innerHTML, /Renamed/);
    assert.doesNotMatch(p.elements.get('task_card_list').innerHTML, /Renamed/);
    assert.doesNotMatch(p.elements.get('kanban_columns_container').innerHTML, /Renamed/);
    assert.equal(p.rendered()[0].title, 'Session');
    assert.equal(p.elements.get('session_modal_notes').value, 'Unsaved notes');
    assert.equal(p.elements.get('session_modal_start').value, '2026-01-01T10:00');
    assert.equal(p.elements.get('session_modal_end').value, '2026-01-01T10:45');
    assert.deepEqual(p.alerts, []);
});

test('the selected revision task display refreshes without replacing unsaved review or rating inputs', async () => {
    const p = workflowPage();
    p.load('ratings_config.js');
    p.load('task_inspector.js');
    for (const id of ['task_inspector_body', 'inspect_task_title', 'inspect_task_desc', 'inspect_task_status_badge',
        'task_rev_difficulty', 'task_rev_went_well', 'task_rev_blockers', 'task_rev_takeaways', 'task_custom_ratings_container']) {
        p.elements.set(id, p.element());
    }
    await p.run('loadTaskInspectorStats("task-1")');
    p.elements.get('task_rev_went_well').value = 'Unsaved review';
    p.elements.get('task_custom_ratings_container').innerHTML = 'Unsaved rating';
    p.elements.get('edit_task_id').value = 'task-1';
    p.elements.get('modal_input_title').value = 'Selected task renamed';
    await p.run('saveTask()');
    assert.equal(p.elements.get('inspect_task_title').innerText, 'Selected task renamed');
    assert.equal(p.elements.get('task_rev_went_well').value, 'Unsaved review');
    assert.equal(p.elements.get('task_custom_ratings_container').innerHTML, 'Unsaved rating');
});

for (const replacementFails of [false, true]) {
    test(`AI refresh during task selection ${replacementFails ? 'blocks Save until retry' : 'saves only the selected task review'}`, async () => {
        const p = workflowPage();
        p.load('ratings_config.js');
        p.load('task_inspector.js');
        p.load('ai_drafts.js');
        for (const id of ['task_inspector_body', 'inspect_task_title', 'inspect_task_desc', 'inspect_task_status_badge',
            'task_rev_difficulty', 'task_rev_went_well', 'task_rev_blockers', 'task_rev_takeaways', 'task_custom_ratings_container']) {
            p.elements.set(id, p.element());
        }
        const old = deferred();
        const get = p.context.api.get;
        let reads = 0;
        let fail = replacementFails;
        p.context.api.get = async url => {
            if (url === '/api/tasks/task-2/stats') {
                if (++reads === 1) return old.promise;
                if (fail) throw Error('replacement stats offline');
                return { task: { id: 'task-2', title: 'Task B', status: 'To Do' }, sessions: [],
                    task_review: { difficulty: 4, what_went_well: 'B review', blockers: 'B blocker', key_takeaways: 'B lesson' } };
            }
            if (url === '/api/tasks/task-1/stats') return { task: { id: 'task-1', title: 'Task A', status: 'To Do' },
                sessions: [], task_review: { difficulty: 2, what_went_well: 'A review' } };
            return get(url);
        };
        const saved = [];
        const post = p.context.api.post;
        p.context.api.post = async (url, payload) => {
            if (url === '/api/task-reviews') { saved.push(payload); return {}; }
            return post(url, payload);
        };
        await p.run('loadTaskInspectorStats("task-1")');
        const selecting = p.run('loadTaskInspectorStats("task-2")');
        const card = p.context.aiBuildDraftBatchNode({ id: 'batch-1', status: 'pending', items: [] });
        await card.children.flatMap(n => n.children).find(n => n.textContent === 'Accept').click();
        old.resolve({ task: { id: 'task-2', title: 'Old B', status: 'To Do' }, sessions: [],
            task_review: { difficulty: 1, what_went_well: 'Stale B review' } });
        await selecting;
        if (replacementFails) {
            await p.run('saveTaskReviewForm()');
            assert.equal(saved.length, 0);
            assert.ok(p.elements.has('task_metadata_notice'));
            fail = false;
            await p.elements.get('task_metadata_notice').children[1].click();
        }
        assert.equal(p.elements.get('inspect_task_title').innerText, 'Task B');
        assert.equal(p.elements.get('task_rev_went_well').value, 'B review');
        assert.equal(p.elements.get('task_rev_blockers').value, 'B blocker');
        assert.equal(p.elements.get('task_rev_takeaways').value, 'B lesson');
        await p.run('saveTaskReviewForm()');
        assert.equal(saved.length, 1);
        assert.equal(saved[0].task_id, 'task-2');
        assert.equal(saved[0].what_went_well, 'B review');
        assert.equal(saved[0].difficulty, 4);
        assert.equal(p.writes.length, 1, 'only one AI acceptance');
    });
}

for (const nextTask of ['task-2', 'task-3']) {
    test(`late rating definitions cannot replace initialized review inputs for ${nextTask}`, async () => {
        const p = workflowPage();
        p.load('ratings_config.js');
        p.load('task_inspector.js');
        for (const id of ['task_inspector_body', 'inspect_task_title', 'inspect_task_desc', 'inspect_task_status_badge',
            'task_rev_difficulty', 'task_rev_went_well', 'task_rev_blockers', 'task_rev_takeaways', 'task_custom_ratings_container']) {
            p.elements.set(id, p.element());
        }
        const definitions = deferred();
        const started = deferred();
        const defs = [{ id: 'rating-1', name: 'Quality', min_score: 1, max_score: 5 }];
        let statsReads = 0;
        let ratingReads = 0;
        let saves = 0;
        p.context.api.get = async url => {
            if (url.startsWith('/api/tasks/') && url.endsWith('/stats')) {
                const taskId = url.split('/')[3];
                const latest = ++statsReads > 1;
                return { task: { id: taskId, title: taskId, status: 'To Do' }, sessions: [],
                    task_review: { difficulty: 3, what_went_well: latest ? 'Current review' : 'Old review' },
                    custom_ratings: [{ rating_definition_id: 'rating-1', score: latest ? 5 : 2 }] };
            }
            if (url === '/rating-definitions?target_type=task') {
                if (++ratingReads === 1) { started.resolve(); return definitions.promise; }
                return defs;
            }
            throw Error(`Unexpected GET ${url}`);
        };
        p.context.api.post = async () => { saves++; return {}; };
        const oldSelection = p.run('loadTaskInspectorStats("task-2")');
        await started.promise;
        await p.run('saveTaskReviewForm()');
        assert.equal(saves, 0, 'Save is blocked until review and rating inputs are ready');
        await p.run(`loadTaskInspectorStats("${nextTask}")`);
        p.elements.get('task_rev_went_well').value = 'Unsaved current review';
        const currentRatings = p.elements.get('task_custom_ratings_container').innerHTML;
        assert.match(currentRatings, /value="5"/);
        definitions.resolve(defs);
        await oldSelection;
        assert.equal(p.elements.get('task_rev_went_well').value, 'Unsaved current review');
        assert.equal(p.elements.get('task_custom_ratings_container').innerHTML, currentRatings);
        assert.equal(p.elements.get('task_inspector_body').classList.contains('hidden'), false);
    });
}

test('a superseded inspector failure cannot mark the newly selected task stale', async () => {
    const p = workflowPage();
    p.load('ratings_config.js');
    p.load('task_inspector.js');
    for (const id of ['task_inspector_body', 'inspect_task_title', 'inspect_task_desc', 'inspect_task_status_badge',
        'task_rev_difficulty', 'task_rev_went_well', 'task_rev_blockers', 'task_rev_takeaways']) {
        p.elements.set(id, p.element());
    }
    await p.run('loadTaskInspectorStats("task-1")');
    const old = deferred();
    const started = deferred();
    const get = p.context.api.get;
    p.context.api.get = async url => {
        if (url === '/api/tasks/task-1/stats') { started.resolve(); return old.promise; }
        if (url === '/api/tasks/task-2/stats') return { task: { id: 'task-2', title: 'Current task', status: 'To Do' }, sessions: [] };
        return get(url);
    };
    const refreshing = p.run('taskKnowledge.refresh()');
    await started.promise;
    await p.run('loadTaskInspectorStats("task-2")');
    old.reject(Error('superseded task unavailable'));
    await refreshing;
    assert.equal(p.elements.get('inspect_task_title').innerText, 'Current task');
    assert.equal(p.elements.has('task_metadata_notice'), false);
});

test('transient metadata recovery updates attachment labels before clearing the stale notice', async () => {
    const p = workflowPage();
    await p.run('taskKnowledge.refresh()');
    p.run('renderTaskSuggestions("")');
    const get = p.context.api.get;
    let failed = false;
    p.context.api.get = async url => {
        if (url === '/api/tasks?status=all' && !failed) { failed = true; throw Error('transient metadata failure'); }
        return get(url);
    };
    p.elements.get('edit_task_id').value = 'task-1';
    p.elements.get('modal_input_title').value = 'Recovered name';
    await p.run('saveTask()');
    assert.equal(p.run('taskKnowledge.state().status'), 'fresh');
    assert.equal(p.elements.has('task_metadata_notice'), false);
    assert.match(p.elements.get('task_suggestions_dropdown').innerHTML, /Recovered name/);
});

test('opening the task editor after a failed registry refresh cannot restore stale properties', async () => {
    const p = workflowPage();
    await p.run('taskKnowledge.refresh()');
    p.failRegistry(true);
    p.elements.get('edit_task_id').value = 'task-1';
    p.elements.get('modal_input_title').value = 'Already saved';
    await p.run('saveTask()');
    assert.equal(p.run('taskKnowledge.get("task-1").title'), 'Original');
    await p.run('openEditTaskModal("task-1")');
    assert.equal(p.elements.get('modal_input_title').value, 'Already saved');
    assert.equal(p.writes.length, 1);
});

test('an older calendar request settles without replacing newer post-mutation events', async () => {
    const p = workflowPage();
    await p.run('taskKnowledge.refresh()');
    const old = deferred();
    const get = p.context.api.get;
    let hold = true;
    p.context.api.get = url => {
        if (hold && url.startsWith('/sessions?')) { hold = false; return old.promise; }
        return get(url);
    };
    let settled = false;
    let oldResult;
    const loading = p.context.fetchCalendarEvents({ start: new Date('2026-01-01'), end: new Date('2026-01-02') },
        result => { settled = true; oldResult = result; }, () => { settled = true; });
    await Promise.resolve();
    p.elements.get('edit_task_id').value = 'task-1';
    p.elements.get('modal_input_title').value = 'Newest name';
    await p.run('saveTask()');
    old.resolve([{ id: 'old-session', task_id: 'task-1' }]);
    await loading;
    assert.equal(settled, true);
    assert.equal(oldResult[0].id, 'session-1');
    assert.equal(oldResult[0].title, 'Newest name');
    assert.equal(p.rendered()[0].id, 'session-1');
});

test('a saved task remains successful when a view fails; retry refreshes without another write', async () => {
    const p = workflowPage();
    await p.run('taskKnowledge.refresh()');
    const oldBoard = p.elements.get('kanban_columns_container').innerHTML;
    p.failBoard(true);
    p.elements.get('edit_task_id').value = 'task-1';
    p.elements.get('modal_input_title').value = 'Saved name';
    await p.run('saveTask()');
    assert.deepEqual(p.alerts, []);
    assert.equal(p.writes.length, 1);
    assert.equal(p.rendered()[0].title, 'Saved name');
    assert.equal(p.elements.get('kanban_columns_container').innerHTML, oldBoard);
    assert.ok(p.elements.has('task_metadata_notice'));
    p.failBoard(false);
    await p.elements.get('task_metadata_notice').children[1].click();
    assert.equal(p.writes.length, 1);
    assert.match(p.elements.get('kanban_columns_container').innerHTML, /Saved name/);
    assert.equal(p.elements.has('task_metadata_notice'), false);
});

test('inspector display refresh preserves unsaved properties, including after subtask completion', async () => {
    const p = workflowPage();
    p.load('subtasks.js');
    for (const id of ['inspector_task_id', 'inspector_edit_title', 'inspector_edit_desc', 'inspector_edit_tags', 'detail_task_title_header']) {
        p.elements.set(id, p.element());
    }
    p.elements.get('inspector_task_id').value = 'task-1';
    p.elements.get('inspector_edit_title').value = 'Unsaved inspector title';
    p.elements.get('inspector_edit_desc').value = 'Unsaved description';
    await p.run('taskKnowledge.refresh()');
    assert.equal(p.elements.get('inspector_edit_title').value, 'Unsaved inspector title');
    assert.equal(p.elements.get('inspector_edit_desc').value, 'Unsaved description');
    assert.equal(p.elements.get('detail_task_title_header').innerText, 'Original');
    await p.run('toggleSubtaskCompletion("task-1", "To Do")');
    assert.equal(p.run('taskKnowledge.get("task-1").status'), 'Done');
    assert.equal(p.elements.get('inspector_edit_title').value, 'Unsaved inspector title');
});

for (const view of ['task_card_list', 'kanban_columns_container', 'task_suggestions_dropdown',
    'timer_task_select', 'task_quick_chips_bar', 'task_inspector_dropdown', 'subtasks_tree_container',
    'parent_task_banner', 'task_breadcrumbs', 'weekly_totals_list', 'breakdown_filter_chip']) {
    test(`AI Accept keeps hostile task text inert in ${view}`, async () => {
        const title = '\"><img src=x onerror=alert`title`>';
        const description = '<svg onload=alert`description`> & **literal text** [link](javascript:alert`link`)';
        const p = workflowPage('Original', { title, description, priority: '<img src=x onerror=alert`priority`>',
            category: '<svg onload=alert`category`>', assigned_date: '<svg onload=alert`date`>',
            color: '#123456" onpointerenter="alert`color`' });
        p.load('ai_drafts.js');
        p.load('ratings_config.js');
        p.load('task_inspector.js');
        p.load('subtasks.js');
        for (const id of ['task_quick_chips_bar', 'task_inspector_dropdown', 'task_inspector_search',
            'task_inspector_body', 'inspect_task_title', 'inspect_task_desc', 'inspect_task_status_badge',
            'task_rev_difficulty', 'task_rev_went_well', 'task_rev_blockers', 'task_rev_takeaways',
            'subtasks_tree_container', 'inspector_task_id', 'parent_task_banner', 'task_breadcrumbs',
            'weekly_totals_list', 'breakdown_filter_chip']) p.elements.set(id, p.element());
        p.elements.set('timer_task_select', taskSelect());
        p.elements.get('inspector_task_id').value = 'task-1';
        let parses = 0;
        p.context.marked = { parse() { parses++; return '<img src=x onerror=alert`markdown`>'; } };
        const get = p.context.api.get;
        p.context.api.get = async url => {
            if (url === '/api/tasks/task-1/tree') {
                const task = await get('/api/tasks/task-1');
                return { ...task, parent_id: 'task-1', subtasks: [{ ...task, id: 'child-1', subtasks: [] }] };
            }
            return get(url);
        };
        await p.run('taskKnowledge.refresh();');
        p.run('renderTaskSuggestions(""); renderTaskInspectorSuggestions(""); toggleBreakdownFilter("task", "task-1")');
        const card = p.context.aiBuildDraftBatchNode({ id: 'batch-1', status: 'pending', items: [] });
        await card.children.flatMap(n => n.children).find(n => n.textContent === 'Accept').click();
        const markup = p.elements.get(view).innerHTML;
        assert.doesNotMatch(markup, /<(?:img|svg)\b/i, 'model text must not become markup');
        assert.doesNotMatch(markup, /" onpointerenter="/, 'color text must not create an event attribute');
        assert.match(markup, /&lt;img src=x onerror=alert`title`&gt;/, 'task title remains visible as text');
        if (view === 'task_card_list') assert.match(markup, /data-task-title="&quot;&gt;&lt;img/);
        assert.equal(parses, 0, 'task previews must not interpret model text as Markdown/HTML');
        assert.equal(p.writes.length, 1);
        assert.deepEqual(p.alerts, []);
    });
}

for (const linked of [true, false]) {
    test(`AI Accept keeps calendar event text inert (${linked ? 'linked task' : 'direct session'})`, async () => {
        let accepted = false;
        let writes = 0;
        const title = '<img src=x onerror=alert`calendar-title`>';
        const notes = '<svg onload=alert`calendar-notes`>';
        const tags = '<img src=x onerror=alert`calendar-tags`>';
        const p = page({
            async get(url) {
                if (url.startsWith('/api/tasks?')) return [{ id: 'task-1', title: accepted ? title : 'Original', status: 'To Do' }];
                if (url.startsWith('/sessions?')) return [{ id: 'session-1', task_id: linked ? 'task-1' : null,
                    start_time: '2026-01-01T10:00:00Z', end_time: '2026-01-01T10:30:00Z',
                    notes: accepted ? notes : '', tags: accepted ? tags : '' }];
                throw Error('draft cards offline');
            },
            async post() { writes++; accepted = true; return { completion_policies: [] }; }
        });
        p.elements.set('calendar', p.element());
        p.context.URLSearchParams = URLSearchParams;
        p.context.location = { search: '' };
        p.context.getUserSettings = () => ({ defaultView: 'timeGridDay', slotDuration: 15 });
        p.context.setupModalKeyboardListeners = () => {};
        p.context.setupVimKeyboardListeners = () => {};
        p.context.applyUserSettings = async () => {};
        let ready;
        p.context.document.addEventListener = (name, callback) => { if (name === 'DOMContentLoaded') ready = callback; };
        let markup;
        let calendarOptions;
        p.context.FullCalendar = { Calendar: class {
            constructor(element, options) {
                calendarOptions = options;
                this.view = { type: 'timeGridDay', activeStart: new Date('2026-01-01'), activeEnd: new Date('2026-01-02') };
            }
            render() {}
            refetchEvents() {
                return calendarOptions.events({ start: this.view.activeStart, end: this.view.activeEnd }, events => {
                    markup = events.map(event => calendarOptions.eventContent({ event, view: this.view }).html).join('');
                }, error => { throw error; });
            }
        } };
        for (const file of ['utils.js', 'calendar.js', 'sidebar_totals.js', 'dashboard.js']) p.load(file);
        await ready();
        p.load('ai_drafts.js');
        const card = p.context.aiBuildDraftBatchNode({ id: 'batch-1', status: 'pending', items: [] });
        await card.children.flatMap(n => n.children).find(n => n.textContent === 'Accept').click();
        assert.doesNotMatch(markup, /<(?:img|svg)\b/i);
        assert.match(markup, /&lt;svg onload=alert`calendar-notes`&gt;/);
        assert.match(markup, /&lt;img src=x onerror=alert`calendar-tags`&gt;/);
        if (linked) assert.match(markup, /&lt;img src=x onerror=alert`calendar-title`&gt;/);
        assert.equal(writes, 1);
    });
}

test('AI Accept keeps session notes and tags inert in refreshed task histories and breakdowns', async () => {
    const p = workflowPage();
    p.load('ai_drafts.js');
    p.load('ratings_config.js');
    p.load('task_inspector.js');
    p.load('subtasks.js');
    for (const id of ['task_inspector_body', 'inspect_task_title', 'inspect_task_desc', 'inspect_task_status_badge',
        'task_rev_difficulty', 'task_rev_went_well', 'task_rev_blockers', 'task_rev_takeaways',
        'inspect_task_sessions_list', 'detail_task_sessions_list', 'inspector_task_id', 'activity_totals_list']) {
        p.elements.set(id, p.element());
    }
    p.elements.get('activity_totals_list').insertAdjacentHTML = () => {};
    p.elements.get('inspector_task_id').value = 'task-1';
    const get = p.context.api.get;
    const notes = '<svg onload=alert`notes`>';
    const tags = '#tag\');alert`tag`;//';
    p.context.api.get = async url => {
        const result = await get(url);
        if (url.startsWith('/sessions?')) return result.map(row => ({ ...row, notes, tags }));
        if (url.endsWith('/stats')) return { ...result, sessions: [{ id: 'session-1', notes, tags }] };
        return result;
    };
    await p.run('loadTaskInspectorStats("task-1")');
    const card = p.context.aiBuildDraftBatchNode({ id: 'batch-1', status: 'pending', items: [] });
    await card.children.flatMap(n => n.children).find(n => n.textContent === 'Accept').click();
    for (const id of ['inspect_task_sessions_list', 'detail_task_sessions_list']) {
        assert.doesNotMatch(p.elements.get(id).innerHTML, /<svg\b/i);
        assert.match(p.elements.get(id).innerHTML, /&lt;svg onload=alert`notes`&gt;/);
    }
    const breakdown = p.elements.get('activity_totals_list').innerHTML;
    assert.match(breakdown, /data-breakdown-tag="#tag&#39;/);
    assert.doesNotMatch(breakdown, /onclick="[^"]*alert/);
    assert.equal(p.writes.length, 1);
});

for (const [status, action, expected] of [
    ['pending', 'Accept', 'AI renamed'], ['applied', 'Undo', 'Original'], ['undone', 'Reapply', 'AI renamed']
]) {
    test(`AI ${action} refreshes task views even when draft-card refresh fails`, async () => {
        const p = workflowPage(action === 'Undo' ? 'AI renamed' : 'Original');
        p.load('ai_drafts.js');
        await p.run('taskKnowledge.refresh()');
        p.run('renderTaskSuggestions("")');
        const card = p.context.aiBuildDraftBatchNode({ id: 'batch-1', status, items: [] });
        const button = card.children.flatMap(n => n.children).find(n => n.textContent === action);
        assert.ok(button);
        await button.click();
        assert.equal(p.writes.length, 1);
        assert.equal(p.rendered()[0].title, expected);
        assert.match(p.elements.get('task_card_list').innerHTML, new RegExp(expected));
        assert.match(p.elements.get('kanban_columns_container').innerHTML, new RegExp(expected));
        assert.match(p.elements.get('task_suggestions_dropdown').innerHTML, new RegExp(expected));
        assert.deepEqual(p.alerts, []);
    });
    test(`AI ${action} remains saved after metadata failure, and retry never repeats its write`, async () => {
        const p = workflowPage(action === 'Undo' ? 'AI renamed' : 'Original');
        p.load('ai_drafts.js');
        await p.run('taskKnowledge.refresh()');
        p.failRegistry(true);
        const card = p.context.aiBuildDraftBatchNode({ id: 'batch-1', status, items: [] });
        const button = card.children.flatMap(n => n.children).find(n => n.textContent === action);
        await button.click();
        assert.equal(p.run('taskKnowledge.state().status'), 'stale');
        assert.ok(p.elements.has('task_metadata_notice'));
        assert.deepEqual(p.alerts, []);
        assert.equal(p.writes.length, 1);
        p.failRegistry(false);
        await p.elements.get('task_metadata_notice').children[1].click();
        assert.equal(p.rendered()[0].title, expected);
        assert.equal(p.writes.length, 1);
        assert.equal(p.elements.has('task_metadata_notice'), false);
    });
}
