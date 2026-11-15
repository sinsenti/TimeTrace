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
        const el = {id, children: [], appendChild(child) {this.children.push(child);}, setAttribute() {}, remove() {}, value: '', innerHTML: '', className: '',
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
    let resolve, reject;
    let held = new Promise((yes, no) => { resolve = yes; reject = no; });
    const requests = [], errors = [];
    const c = {MutationObserver: class {constructor(fn) {observers.push(fn);} observe() {}}, console: {error(...args) {errors.push(args.map(String).join(' '));}}, document: {createElement: () => node('inert-' + nodes.size), body: {appendChild(el) {nodes.set(el.id, el);}}, getElementById: id => nodes.get(id) || null,
        addEventListener: (name, fn) => {if (!events.has(name)) events.set(name, []); events.get(name).push(fn);}},
        window: {addEventListener() {}, history: {pushState() {}}, location: {hash: '#sessions'}},
        getUserSettings: () => ({enableSessionReview: true}), escapeHtml: x => String(x ?? ''),
        api: {get: url => {
            requests.push(url);
            if (url.endsWith('/stats')) return Promise.resolve({task: captured[0], sessions: [],
                task_review: {difficulty: 3, blockers: 'saved blockers'}, custom_ratings: []});
            return held;
        }},
        renderCustomRatingsInputs: async () => {},
        loadAllSessionsReview() {}, localDayToday: () => '', loadRatingDefinitionsList() {}};
    vm.createContext(c);
    for (const file of ['task_knowledge.js', 'task_inspector.js', 'revision_nav.js'])
        vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), c, {filename: file});
    events.get('DOMContentLoaded').forEach(fn => fn());
    c.switchRevisionTab('task_inspector');
    const search = nodes.get('task_inspector_search'), dropdown = nodes.get('task_inspector_dropdown');
    function event(name, value = search.value) {
        search.value = value;
        if (name === 'onfocus') c.document.activeElement = search;
        vm.runInContext(`(function(){${handlers[name]}}).call(document.getElementById('task_inspector_search'))`, c);
    }
    return {c, nodes, requests, errors, search, dropdown, event,
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
    assert.equal(h.nodes.get('task_inspector_body').classList.contains('hidden'), false);
    h.nodes.get('task_rev_blockers').value = 'unsaved blockers';
    h.event('onfocus'); h.event('oninput', 'Rating18');
    await h.release();
    await h.c.refreshTaskInspectorKnowledge();
    matching(h);
    assert.equal(h.nodes.get('inspect_task_title').innerText, 'Rating18 synthetic task');
    assert.equal(h.nodes.get('task_rev_blockers').value, 'unsaved blockers');
    assert.deepEqual(h.errors, []);
    assert.equal(h.nodes.get('task_inspector_body').classList.contains('hidden'), false);
    assert.ok(h.requests.filter(url => url.endsWith('/stats')).length >= 2, 'successful selected-task refresh ran');
});
