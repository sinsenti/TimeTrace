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
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
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

function workflowPage(title = 'Original') {
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
                rows = rows.map(t => ({ ...t, title }));
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
