const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const captured = require('./fixtures/task-search-response64.json');
const js = path.join(__dirname, '../src/timetrace/interfaces/api/static/js');
const template = fs.readFileSync(path.join(js, '../../templates/revision.html'), 'utf8');
const input = template.match(/<input id="task_inspector_search"[^>]+>/)[0];
const handlers = Object.fromEntries(['onfocus', 'oninput'].map(name => [name, input.match(new RegExp(`${name}="([^"]+)"`))[1]]));

function setup() {
    const nodes = new Map(), events = new Map(), observers = [];
    function node(id) {
        const classes = new Set(['task_inspector_dropdown', 'rev_tab_task_inspector'].includes(id) ? ['hidden'] : []);
        const listeners = new Map();
        const el = {id, dataset: {}, children: [], appendChild(child) {this.children.push(child);}, setAttribute() {}, remove() {}, value: '', innerHTML: '', className: '',
            classList: {contains: x => classes.has(x), add: x => classes.add(x), remove: x => classes.delete(x)},
            addEventListener: (name, fn) => listeners.set(name, fn),
            emit: (name, extra = {}) => listeners.get(name)?.({preventDefault() {}, ...extra}),
            contains: target => target === el || (id === 'task_inspector_combobox' && target === nodes.get('task_inspector_search')),
            querySelectorAll: () => [...el.innerHTML.matchAll(/onclick="selectTaskInspectorById\('([^']+)'\)"/g)].map(match => ({
                classList: {add() {}, remove() {}}, click() { c.selectTaskInspectorById(match[1]); }
            }))};
        nodes.set(id, el);
        return el;
    }
    for (const id of ['task_inspector_search', 'task_inspector_dropdown', 'task_quick_chips_bar',
        'task_inspector_combobox', 'rev_tab_task_inspector', 'inspect_task_title', 'inspect_task_desc',
        'inspect_task_status_badge', 'task_inspector_body', 'task_rev_difficulty', 'task_rev_went_well',
        'task_rev_blockers', 'task_rev_takeaways']) node(id);
    // Mirror the shared post-mortem partial: production discovers controls by scoped data attributes.
    const review = node('revision_task_postmortem');
    const reviewFields = Object.fromEntries(Object.entries({difficulty: 'task_rev_difficulty',
        what_went_well: 'task_rev_went_well', blockers: 'task_rev_blockers', key_takeaways: 'task_rev_takeaways'})
        .map(([name, id]) => [name, nodes.get(id)]));
    for (const name of ['fields', 'save', 'discard', 'retry', 'status'])
        reviewFields[name] = node(`revision_task_postmortem_${name}`);
    reviewFields.ratings = node('task_custom_ratings_container');
    for (const [name, field] of Object.entries(reviewFields)) field.dataset.taskReview = name;
    review.querySelector = selector => reviewFields[selector.match(/data-task-review="([^"]+)"/)?.[1]] || null;
    review.contains = target => target === review || Object.values(reviewFields).includes(target);
    reviewFields.ratings.querySelectorAll = () => []; // Synthetic task has no rating definitions.
    let resolve, reject;
    let held = new Promise((yes, no) => { resolve = yes; reject = no; });
    const requests = [], errors = [];
    const c = {MutationObserver: class {constructor(fn) {observers.push(fn);} observe() {}}, console: {error(...args) {errors.push(args.map(String).join(' '));}}, document: {createElement: () => node('inert-' + nodes.size), body: {appendChild(el) {nodes.set(el.id, el);}}, getElementById: id => nodes.get(id) || null,
        addEventListener: (name, fn) => {if (!events.has(name)) events.set(name, []); events.get(name).push(fn);}},
        window: {addEventListener() {}, history: {pushState() {}}, location: {hash: '#sessions'}},
        getUserSettings: () => ({enableSessionReview: true}), escapeHtml: x => String(x ?? ''),
        api: {get: url => {
            requests.push(url);
            if (url.startsWith('/rating-definitions')) return Promise.resolve([]);
            if (url.endsWith('/stats')) return Promise.resolve({task: captured[0], sessions: [],
                task_review: {difficulty: 3, blockers: 'saved blockers'}, custom_ratings: []});
            return held;
        }},
        loadAllSessionsReview() {}, localDayToday: () => '', loadRatingDefinitionsList() {}};
    vm.createContext(c);
    for (const file of ['task_knowledge.js', 'ratings_config.js', 'task_postmortem.js', 'task_inspector.js', 'revision_nav.js'])
        vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), c, {filename: file});
    events.get('DOMContentLoaded').forEach(fn => fn());
    c.switchRevisionTab('task_inspector');
    const search = nodes.get('task_inspector_search'), dropdown = nodes.get('task_inspector_dropdown');
    function event(name, value = search.value) {
        search.value = value;
        if (name === 'onfocus') c.document.activeElement = search;
        vm.runInContext(`(function(){${handlers[name]}}).call(document.getElementById('task_inspector_search'))`, c);
    }
    return {c, nodes, requests, errors, search, dropdown, review, event,
        tabLeave() {c.switchRevisionTab('ratings_config'); observers.forEach(fn => fn());},
        clickOutside() {events.get('click').forEach(fn => fn({target: {}}));},
        async release(body = captured) {resolve(body); await vm.runInContext('taskKnowledge.load()', c); await Promise.resolve();},
        async fail() {reject(new Error('inert metadata failure')); await vm.runInContext('taskKnowledge.load()', c); await Promise.resolve();},
        retry() {held = Promise.resolve(captured); return c.loadTaskInspectorRegistry();}};
}

function matching(h) {
    assert.equal(h.dropdown.classList.contains('hidden'), false, 'matching suggestions must be visible');
    assert.ok(h.dropdown.innerHTML.includes('Rating18 synthetic task'));
}

test('cold focus and typed search become selectable after captured metadata arrives', async () => {
    const h = setup();
    h.event('onfocus'); h.event('oninput', 'Rating18 synthetic task');
    assert.equal(h.dropdown.classList.contains('hidden'), true);
    await h.release(); matching(h);
    assert.deepEqual(h.requests, ['/api/tasks?status=all']);
});

test('Revision task quick-select uses neutral chips, a stored-color accent, safe labels, and selected state', async () => {
    const h = setup();
    const taskId = '0195e535-0000-7000-8000-00000000000a';
    await h.release([{id:taskId,title:'<img src=x onerror=boom>',status:'Doing <b>work</b>',color:'#18a26a'}]);
    h.c.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    h.c.getTaskColor = task => task.color;
    h.c.renderTaskQuickChipsBar();
    const bar = h.nodes.get('task_quick_chips_bar');
    assert.match(bar.innerHTML, /class="task-quick-chip"/);
    assert.match(bar.innerHTML, /selectTaskInspectorById\('0195e535-0000-7000-8000-00000000000a'\)/);
    assert.match(bar.innerHTML, /--task-chip-color:#18a26a/);
    assert.doesNotMatch(bar.innerHTML, /background-color:/);
    assert.match(bar.innerHTML, /&lt;img/); assert.doesNotMatch(bar.innerHTML, /<img/);
    assert.match(bar.innerHTML, /aria-pressed="false"/);
    await h.c.selectTaskInspectorById(taskId);
    assert.match(bar.innerHTML, /aria-pressed="true"/);
});

for (const cancel of ['Escape', 'outside click', 'blur', 'tab leave']) {
    test(`pending metadata respects ${cancel} dismissal`, async () => {
        const h = setup(); h.event('onfocus'); h.event('oninput', 'Rating18');
        if (cancel === 'Escape') h.search.emit('keydown', {key: 'Escape'});
        if (cancel === 'outside click') h.clickOutside();
        if (cancel === 'blur') {h.search.emit('blur'); h.c.document.activeElement = null;}
        if (cancel === 'tab leave') {h.tabLeave(); h.c.switchRevisionTab('task_inspector');}
        await h.release();
        assert.equal(h.dropdown.classList.contains('hidden'), true);
    });
}

test('pending search uses latest query, then ordinary input and keyboard selection work', async () => {
    const h = setup(); h.event('onfocus'); h.event('oninput', 'Rating18');
    h.event('oninput', 'unmatched title'); await h.release();
    assert.equal(h.dropdown.classList.contains('hidden'), true);
    h.event('oninput', 'Rating18'); matching(h);
    h.search.emit('keydown', {key: 'ArrowDown'});
    h.search.emit('keydown', {key: 'Enter'});
    await new Promise(setImmediate);
    assert.equal(h.dropdown.classList.contains('hidden'), true);
    assert.equal(h.search.value, 'Rating18 synthetic task');
    await h.c.refreshTaskInspectorKnowledge();
    assert.equal(h.dropdown.classList.contains('hidden'), true);
});

test('failed cold metadata can recover through read-only retry while search remains active', async () => {
    const h = setup(); h.event('onfocus'); h.event('oninput', 'Rating18');
    await h.fail();
    assert.equal(h.dropdown.classList.contains('hidden'), true);
    await h.retry(); matching(h);
    assert.deepEqual(h.requests, ['/api/tasks?status=all', '/api/tasks?status=all']);
});

test('successful empty metadata leaves search hidden and primed focus still works', async () => {
    const empty = setup(); empty.event('onfocus'); await empty.release([]);
    assert.equal(empty.dropdown.classList.contains('hidden'), true);
    const primed = setup(); await primed.release();
    primed.event('onfocus'); primed.event('oninput', 'Rating18'); matching(primed);
    primed.search.emit('keydown', {key: 'Escape'});
    await primed.c.refreshTaskInspectorKnowledge();
    assert.equal(primed.dropdown.classList.contains('hidden'), true);
    primed.event('oninput', 'Rating18'); matching(primed);
});


test('registry arrival successfully refreshes selected task statistics without replacing its review draft', async () => {
    const h = setup();
    h.c.selectTaskInspectorById(captured[0].id);
    await new Promise(setImmediate);
    assert.deepEqual(h.errors, []);
    assert.equal(h.nodes.get('inspect_task_title').innerText, 'Rating18 synthetic task');
    assert.equal(h.nodes.get('task_rev_blockers').value, 'saved blockers');
    assert.equal(h.review.taskPostmortem.ready, true, 'actual controller and rating renderer initialized');
    assert.equal(h.nodes.get('task_inspector_body').classList.contains('hidden'), false);
    h.nodes.get('task_rev_blockers').value = 'unsaved blockers';
    h.event('onfocus'); h.event('oninput', 'Rating18');
    await h.release();
    await h.c.refreshTaskInspectorKnowledge();
    matching(h);
    assert.equal(h.nodes.get('inspect_task_title').innerText, 'Rating18 synthetic task');
    assert.equal(h.nodes.get('task_rev_blockers').value, 'unsaved blockers');
    assert.equal(h.review.taskPostmortem.ready, true, 'refresh completed through the actual review controller');
    assert.deepEqual(h.errors, []);
    assert.equal(h.nodes.get('task_inspector_body').classList.contains('hidden'), false);
    assert.ok(h.requests.filter(url => url.endsWith('/stats')).length >= 2, 'successful selected-task refresh ran');
});
