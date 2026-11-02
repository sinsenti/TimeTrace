const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');

function editor(respond) {
    const elements = new Map();
    function element(tagName = 'DIV') {
        const classes = new Set();
        return {tagName, value: '', textContent: '', innerText: '', children: [], dataset: {}, disabled: false,
            classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x)},
            appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; },
            addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }, listeners: {},
            querySelectorAll() { return []; }, focus() { document.activeElement = this; }, select() {}, setAttribute() {}};
    }
    const domReady = [];
    const document = {getElementById: id => elements.get(id), createElement: element, activeElement: null,
        addEventListener(name, fn) { if (name === 'DOMContentLoaded') domReady.push(fn); }};
    const html = fs.readFileSync(path.join(js, '../../templates/components/task_modal.html'), 'utf8');
    for (const [, tag, id] of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) elements.set(id, {...element(tag.toUpperCase()), id});
    elements.get('task_modal').classList.add('hidden');
    const requests = [], alerts = [];
    const context = vm.createContext({document, console, alert: x => alerts.push(x), confirm: () => true,
        setTimeout, clearTimeout, formatMinutesToDuration: n => `${n}m`, parseDurationToMinutes: () => 15,
        parseFlexibleDateInput: () => null, defaultPalette: [],
        taskKnowledge: {changed: async () => {}, get: () => null, state: () => ({status: 'failed'})},
        fetch: async (url, options) => {
            const request = {url, method: options.method, body: options.body && JSON.parse(options.body)};
            requests.push(request);
            const result = await respond(request);
            return {status: result.status || 200, ok: !result.status || result.status < 400,
                headers: {get: () => 'application/json'}, json: async () => result.body};
        }});
    context.window = context;
    for (const file of ['api_client.js', 'task_modal.js', 'ai_quickadd.js']) vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), context);
    domReady.forEach(fn => fn());
    const run = text => vm.runInContext(text, context);
    const set = (id, value) => { elements.get(id).value = value; };
    return {context, elements, requests, alerts, run, set};
}

test('quick-edit saves parent and pending children, then retries only the rejected child', async () => {
    let rejectSecond = true;
    const p = editor(async request => {
        if (request.body.parent_id && request.body.title === 'Second' && rejectSecond) return {status: 400, body: {detail: 'Synthetic rejection'}};
        if (!request.body.parent_id) return {body: {id: 'parent-id', title: 'Parent', tags: '#effective', category: 'study'}};
        return {body: {id: request.body.title, ...request.body}};
    });
    p.run('openNewTaskModal()');
    p.set('modal_input_title', 'Parent #effective');
    p.set('task_child_title', 'First'); p.run('queueTaskChild()');
    p.set('task_child_title', 'Second');
    await p.run('saveTask()');
    assert.equal(p.requests.length, 3);
    assert.match(p.elements.get('task_save_feedback').textContent, /Parent saved.*1.*2.*Retry/s);
    assert.equal(p.elements.get('task_modal').classList.contains('hidden'), false);
    assert.deepEqual(p.requests.slice(1).map(r => [r.body.parent_id, r.body.tags, r.body.category]),
        [['parent-id', '#effective', 'study'], ['parent-id', '#effective', 'study']]);
    rejectSecond = false;
    await p.run('saveTask()');
    assert.equal(p.requests.length, 4);
    assert.equal(p.requests[3].body.title, 'Second');
    assert.equal(p.elements.get('task_modal').classList.contains('hidden'), true);
});


function enter(p, id) {
    const target = p.elements.get(id);
    target.focus();
    const event = {key: 'Enter', defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }};
    for (const handler of target.listeners.keydown || []) handler(event);
    if (!event.stopped) for (const handler of p.elements.get('task_modal').listeners.keydown || []) handler(event);
}
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {resolve, promise}; }

test('Quick Add Enter parses and prefills editable text without bubbling into human Save', async () => {
    const p = editor(async () => ({body: {tier: 2, fields: {title: '<img src=x onerror=bad()>', tags: 'synthetic'}}}));
    p.run('openNewTaskModal()');
    p.set('ai_quickadd_input', 'Synthetic tomorrow');
    enter(p, 'ai_quickadd_input');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(p.requests.map(r => r.url), ['/api/ai/quick-add/parse']);
    assert.equal(p.elements.get('modal_input_title').value, '<img src=x onerror=bad()>');
    p.set('modal_input_title', 'Human revision');
    await p.run('saveTask()');
    assert.equal(p.requests.at(-1).body.title, 'Human revision');
});

test('late Parse after typing or cancel/reopen cannot overwrite the current form', async () => {
    for (const transition of ['input', 'reopen']) {
        const pending = deferred();
        const p = editor(async () => pending.promise);
        p.run('openNewTaskModal()');
        p.set('ai_quickadd_input', 'Old tomorrow');
        const parsing = p.run('aiQuickAddParse()');
        if (transition === 'reopen') p.run('closeTaskModal(); openNewTaskModal()');
        else {
            p.set('ai_quickadd_input', 'New text');
            p.elements.get('ai_quickadd_input').listeners.input.forEach(fn => fn());
        }
        p.set('modal_input_title', 'Keep human text');
        pending.resolve({body: {tier: 2, fields: {title: 'Late old title'}}});
        await parsing;
        assert.equal(p.elements.get('modal_input_title').value, 'Keep human text');
        p.run('closeTaskModal()');
    }
});

test('successful save followed by a failed metadata read is not offered as unsaved work', async () => {
    const p = editor(async r => ({body: {id: 'saved', ...r.body}}));
    p.context.taskKnowledge.changed = async () => { throw Error('Synthetic read failure'); };
    p.run('openNewTaskModal()'); p.set('modal_input_title', 'Saved once');
    await p.run('saveTask()');
    assert.equal(p.requests.length, 1);
    assert.equal(p.elements.get('task_modal').classList.contains('hidden'), true);
    assert.equal(p.alerts.length, 0);
    p.run('openNewTaskModal()'); p.set('modal_input_title', 'Next task');
    await p.run('saveTask()');
    assert.equal(p.requests.length, 2);
});

test('queued child Enter and remove/cancel do not write parent or children', () => {
    const p = editor(async () => { throw Error('Unexpected write'); });
    p.run('openNewTaskModal()'); p.set('modal_input_title', 'Never saved');
    p.set('task_child_title', '<script>inert</script>'); enter(p, 'task_child_title');
    const list = p.elements.get('task_child_queue');
    assert.equal(list.children[0].children[0].textContent, '<script>inert</script> — Not saved');
    list.children[0].children[1].listeners.click[0]();
    assert.equal(list.children.length, 0);
    p.set('task_child_title', 'Pending'); p.run('queueTaskChild(); closeTaskModal(); openNewTaskModal()');
    assert.equal(list.children.length, 0);
    assert.equal(p.requests.length, 0);
});

test('Ctrl+Enter from description saves, while ordinary Enter remains multiline', async () => {
    const p = editor(async r => ({body: {id: 'saved', ...r.body}}));
    p.run('openNewTaskModal()'); p.set('modal_input_title', 'Keyboard task');
    enter(p, 'modal_input_desc');
    assert.equal(p.requests.length, 0);
    const event = {key: 'Enter', ctrlKey: true, preventDefault() {}, stopPropagation() {}};
    p.elements.get('task_modal').listeners.keydown[0](event);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.requests.length, 1);
});

test('Tasks adopts valid view preferences without resetting neighbors and searches Kanban titles', () => {
    const p = editor(async () => ({body: []}));
    const storage = new Map([['timetrace_user_settings', JSON.stringify({taskView: 'outline', colorSeed: 42, theme: 'nord'})]]);
    p.context.localStorage = {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value)};
    p.context.document.documentElement = {dataset: {}};
    for (const id of ['task_view_selector', 'task_view_notice', 'tasks_search']) {
        p.elements.set(id, {value: '', textContent: '', classList: {add() {}, remove() {}}});
    }
    for (const file of ['settings.js', 'kanban.js']) vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), p.context);
    p.run('setupTaskViewSelector()');
    assert.equal(p.elements.get('task_view_selector').value, 'outline');
    assert.match(p.elements.get('task_view_notice').textContent, /Kanban/);
    p.run('selectTaskView("kanban")');
    const adopted = JSON.parse(storage.get('timetrace_user_settings'));
    assert.equal(adopted.taskView, 'kanban');
    assert.equal(adopted.colorSeed, 42);
    assert.equal(adopted.theme, 'nord');
    p.set('tasks_search', 'needle');
    p.context.example = {id: 'one', title: 'Needle task', tags: ''};
    assert.equal(p.run('matchesKanbanSearch(example)'), true);
    p.context.example.title = 'Other task';
    assert.equal(p.run('matchesKanbanSearch(example)'), false);
});

test('late classification cannot replace an explicit Parse result or a reopened editor hint', async () => {
    const pending = deferred();
    const p = editor(async r => r.url.endsWith('classify') ? pending.promise : {body: {tier: 2, fields: {title: 'Parsed current'}}});
    p.run('openNewTaskModal()'); p.set('ai_quickadd_input', 'Synthetic tomorrow');
    const classification = p.run('aiQuickAddClassify("Synthetic tomorrow")');
    await p.run('aiQuickAddParse()');
    pending.resolve({body: {tier: 1}});
    await classification;
    assert.match(p.elements.get('ai_quickadd_hint').textContent, /Fields prefilled/);
    p.run('closeTaskModal(); openNewTaskModal()');
    assert.equal(p.elements.get('ai_quickadd_hint').textContent, '');
});

test('Parse cannot overwrite human fields changed while extraction was pending', async () => {
    const pending = deferred();
    const p = editor(async () => pending.promise);
    p.run('openNewTaskModal()'); p.set('ai_quickadd_input', 'Synthetic tomorrow');
    const parsing = p.run('aiQuickAddParse()');
    p.set('modal_input_tags', '#human');
    pending.resolve({body: {tier: 2, fields: {title: 'Late', tags: 'model'}}});
    await parsing;
    assert.equal(p.elements.get('modal_input_tags').value, '#human');
    assert.equal(p.elements.get('modal_input_title').value, '');
    assert.match(p.elements.get('ai_quickadd_hint').textContent, /Your edits were kept/);
});

test('double Save while the parent request is pending does not duplicate writes', async () => {
    const pending = deferred();
    const p = editor(async () => pending.promise);
    p.run('openNewTaskModal()'); p.set('modal_input_title', 'Pending task');
    const saving = p.run('saveTask()');
    await p.run('saveTask()');
    assert.equal(p.requests.length, 1);
    pending.resolve({body: {id: 'one', title: 'Pending task'}});
    await saving;
});

test('out-of-order edit loading cannot replace a newer task editor', async () => {
    const pending = deferred();
    const p = editor(async () => pending.promise);
    const opening = p.run('openEditTaskModal("old-id")');
    p.run('openNewTaskModal()'); p.set('modal_input_title', 'New owner');
    pending.resolve({body: {id: 'old-id', title: 'Old title'}});
    await opening;
    assert.equal(p.elements.get('modal_input_title').value, 'New owner');
    assert.equal(p.elements.get('edit_task_id').value, '');
});

test('quick-edit forwards the saved completion policy without silently clearing sessions', async () => {
    const p = editor(async r => ({body: r.method === 'GET'
        ? {id: 'parent', title: 'Scheduled task', status: 'Scheduled'}
        : {id: 'parent', title: 'Completed task', completion_policy: {reason: 'completed', task_id: 'parent', scheduled_sessions: [], subtask_scheduled_count: 0}}}));
    const classes = new Set(['hidden']);
    const policyModal = {classList: {add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c)}};
    p.elements.set('completion_policy_modal', policyModal);
    vm.runInContext(fs.readFileSync(path.join(js, 'completion_policy.js'), 'utf8'), p.context);
    await p.run('openEditTaskModal("parent")');
    p.set('modal_input_status', 'Done');
    await p.run('saveTask()');
    assert.equal(classes.has('hidden'), false);
    assert.deepEqual(p.requests.map(r => r.url), ['/api/tasks/parent', '/api/tasks/parent']);
    assert.equal(p.requests[1].method, 'PUT');
});

test('explicit Save supersedes an outstanding Parse before its mutation receipt arrives', async () => {
    const parsing = deferred(), saving = deferred();
    const p = editor(async r => r.url.endsWith('/parse') ? parsing.promise : saving.promise);
    p.run('openNewTaskModal()'); p.set('modal_input_title', 'Human saving'); p.set('ai_quickadd_input', 'Synthetic tomorrow');
    const parsed = p.run('aiQuickAddParse()');
    const saved = p.run('saveTask()');
    parsing.resolve({body: {tier: 2, fields: {title: 'Late model title'}}});
    await parsed;
    assert.equal(p.elements.get('modal_input_title').value, 'Human saving');
    saving.resolve({body: {id: 'saved', title: 'Human saving'}});
    await saved;
});

test('queued child inherits an authoritative empty parent category, not the form selection', async () => {
    const p = editor(async r => ({body: r.body.parent_id
        ? {id: 'child', ...r.body}
        : {id: 'parent', title: 'Saved parent', tags: '#saved', category: ''}}));
    p.run('openNewTaskModal()');
    p.set('modal_input_title', 'Parent');
    p.set('modal_input_category', 'study');
    p.set('task_child_title', 'Child');
    await p.run('saveTask()');
    assert.equal(p.requests[0].body.category, 'study');
    assert.equal(p.requests[1].body.category, '');
});
