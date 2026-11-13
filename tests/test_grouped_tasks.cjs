const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');

function page(respond = async () => []) {
    const elements = new Map();
    for (const id of ['task_view_selector', 'task_view_notice', 'tasks_search', 'kanban_columns_container', 'tasks_heading', 'tasks_workspace']) {
        elements.set(id, {id, value: '', textContent: '', innerHTML: '', className: '', isConnected: true,
            classList: {add() {}, remove() {}}, setAttribute(name, value) { this[name] = value; },
            contains() { return false; }, focus() { document.activeElement = this; }});
    }
    const document = {getElementById: id => elements.get(id), addEventListener() {}, querySelectorAll: () => [], activeElement: null};
    let settings = {taskView: 'grouped', theme: 'nord', colorSeed: 42};
    const requests = [], results = [];
    const context = vm.createContext({document, console: {error() {}}, Date, encodeURIComponent,
        getUserSettings: () => settings, saveUserSettings: value => { settings = value; },
        taskKnowledge: {state: () => ({generation: 0}), get: () => null, viewResult: (...args) => results.push(args)},
        api: {get: async url => { requests.push(url); return respond(url); }},
        escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])),
        formatMinutesToDuration: value => `${value || 0}m`, getTaskDateBadge: () => null,
        matchesCustomFilter: task => task.tags !== '#exclude'});
    context.window = context;
    for (const file of ['kanban.js', 'grouped_tasks.js']) {
        if (fs.existsSync(path.join(js, file))) vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), context);
    }
    vm.runInContext('setupTaskViewSelector()', context);
    return {elements, context, requests, results, run: code => vm.runInContext(code, context), settings: () => settings};
}

test('Grouped selection renders ordered status groups exactly once, including unknown statuses and hierarchy', async () => {
    const p = page(async url => url.includes('statuses') ? [
        {id: 'a', name: 'Todo', position: 0}, {id: 'b', name: 'Doing', position: 1},
        {id: 'c', name: 'Hidden', position: 2, is_hide_by_default: true}
    ] : [
        {id: 'parent', title: 'Parent', status: 'Todo', tags: '#exclude'},
        {id: 'child-id', parent_id: 'parent', title: '<Child>', status: 'Todo', status_id: 'b', estimated_minutes: 30},
        {id: 'orphan', title: 'Unknown row', status: 'Deleted'}, {id: 'hidden', title: 'Secret row', status_id: 'c'}
    ]);
    await p.run('loadKanbanBoard()');
    const html = p.elements.get('kanban_columns_container').innerHTML;
    assert.equal(p.elements.get('kanban_columns_container').className, 'grouped-task-list');
    assert.equal((html.match(/data-task-id="child-id"/g) || []).length, 1);
    assert.match(html, /Subtask of Parent/);
    assert.match(html, /&lt;Child&gt;/);
    assert.match(html, /Unknown status/);
    assert.match(html, /1 task.*hidden status/i);
    assert.doesNotMatch(html, /Secret row/);
    assert.ok(html.indexOf('Todo') < html.indexOf('Doing'));
    assert.match(html, /openGroupedTaskEdit\('child-id'\)/);
    assert.match(html, /openGroupedTaskSchedule\('child-id'\)/);
    p.run('selectTaskView("kanban")');
    assert.equal(p.settings().theme, 'nord');
    assert.equal(p.settings().colorSeed, 42);
    assert.match(p.elements.get('kanban_columns_container').innerHTML, /kanban-col/);
});

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
}

test('overlapping reads retain newer Grouped rows and current search, stale failures cannot mark the view failed', async () => {
    const old = deferred(); let count = 0;
    const p = page(async url => {
        if (url.includes('statuses')) return ++count === 1 ? old.promise : [{id: 'a', name: 'Todo'}];
        return [{id: 'fresh', title: 'Current needle', status: 'Todo'}];
    });
    const first = p.run('loadKanbanBoard()');
    p.elements.get('tasks_search').value = 'needle';
    await p.run('loadKanbanBoard()');
    const current = p.elements.get('kanban_columns_container').innerHTML;
    old.reject(Error('Old read failed'));
    assert.equal(await first, null);
    assert.equal(p.elements.get('kanban_columns_container').innerHTML, current);
    assert.match(current, /Current needle/);
    assert.deepEqual(p.results, [['kanban', true]]);
});

test('failed refresh retains last-known rows and retry only reads, including initial loading state', async () => {
    let failed = false;
    const p = page(async url => {
        if (failed) throw Error('Offline');
        return url.includes('statuses') ? [{id: 'a', name: 'Todo'}] : [{id: 'one', title: 'Retained row', status: 'Todo'}];
    });
    const pending = p.run('loadKanbanBoard()');
    assert.equal(p.elements.get('tasks_workspace')['aria-busy'], 'true');
    assert.match(p.elements.get('kanban_columns_container').textContent, /Loading/);
    await pending;
    const current = p.elements.get('kanban_columns_container').innerHTML;
    failed = true;
    assert.equal(await p.run('loadKanbanBoard()'), false);
    assert.equal(p.elements.get('kanban_columns_container').innerHTML, current);
    assert.equal(p.elements.get('tasks_workspace')['aria-busy'], 'false');
    failed = false;
    assert.equal(await p.run('loadKanbanBoard()'), true);
    assert.deepEqual(p.results, [['kanban', true], ['kanban', false], ['kanban', true]]);
    assert.ok(p.requests.every(url => url.startsWith('/api/tasks')));
});

test('switching to Grouped destroys drag controllers and restores focus before replaced rows disappear', () => {
    const p = page(); let destroyed = 0;
    p.context.drag = {destroy() { destroyed++; }};
    p.run('sortableCardInstances = [drag]; sortableColumnInstance = drag');
    p.elements.get('kanban_columns_container').contains = () => true;
    p.run('selectTaskView("grouped")');
    assert.equal(destroyed, 2);
    assert.equal(p.context.document.activeElement.id, 'tasks_heading');
    assert.equal(p.elements.get('task_view_notice').textContent, '');
    p.run('setupTaskViewSelector()');
    assert.equal(p.elements.get('task_view_selector').value, 'grouped');
    p.run('selectTaskView("outline")');
    assert.match(p.elements.get('task_view_notice').textContent, /not available.*Kanban/);
});
