const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const tick = () => new Promise(resolve => setImmediate(resolve));

function element(tag = 'div') {
    const classes = new Set(), children = [], listeners = {};
    let text = '';
    return {
        tagName: tag.toUpperCase(), children, listeners, dataset: {}, style: {}, disabled: false,
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name)
        },
        set className(value) { value.split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); },
        get className() { return Array.from(classes).join(' '); },
        get childNodes() { return children; },
        get textContent() { return text + children.map(child => child.textContent).join(''); },
        set textContent(value) { text = String(value); children.splice(0); },
        appendChild(child) {
            if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
            children.push(child); child.parentNode = this; return child;
        },
        replaceWith(next) {
            const index = this.parentNode.children.indexOf(this);
            this.parentNode.children.splice(index, 1, next);
            next.parentNode = this.parentNode;
        },
        addEventListener(name, handler) { (listeners[name] ||= []).push(handler); },
        setAttribute(name, value) { this[name] = value; },
        remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); },
        querySelectorAll(selector) {
            const descendants = children.flatMap(child => [child, ...child.querySelectorAll(selector)]);
            return descendants.filter(child => selector.split(',').some(part => {
                const query = part.trim();
                if (query === '.ai-item-checkbox:checked') return child.classList.contains('ai-item-checkbox') && child.checked;
                if (query.startsWith('.')) return child.classList.contains(query.slice(1));
                if (query === 'button') return child.tagName === 'BUTTON';
                if (['input', 'select', 'option', 'textarea'].includes(query)) return child.tagName.toLowerCase() === query;
                return false;
            }));
        },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    };
}

function response(value, status = 200) {
    return {
        ok: status < 400,
        status,
        headers: {get: () => 'application/json'},
        async json() { return value; }
    };
}

function setup(respond) {
    const root = element(), requests = [], reads = [];
    const context = vm.createContext({
        URL, URLSearchParams, console: {error() {}, warn() {}}, CSS: {escape: value => value},
        alert() {}, window: {}, document: {
            createElement: tag => element(tag),
            addEventListener() {},
            querySelectorAll(selector) {
                return [root, ...root.children.flatMap(child => [child, ...child.querySelectorAll('*')])]
                    .filter(node => selector.startsWith('[data-batch-id=') && node.classList.contains('ai-draft-batch') && node.dataset.batchId === selector.match(/"([^"]+)"/)[1]);
            },
            getElementById() { return null; }
        },
        fetch: async (url, options) => {
            requests.push({url, options});
            if ((options.method || 'GET') === 'GET') reads.push(url);
            return respond(url, options);
        }
    });
    vm.runInContext(fs.readFileSync(path.join(js, 'api_client.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(js, 'ai_drafts.js'), 'utf8'), context);
    context.taskKnowledge = {changed: async () => { reads.push('/taskKnowledge.changed'); }};
    context.loadAiDraftOverlay = async () => { reads.push('/overlay'); };
    context.refreshAiStatusBadge = async () => { reads.push('/badge'); };
    return {context, root, requests, reads};
}

test('accept shows partial results even when batch detail cannot refresh', async () => {
    let detailFails = true;
    const batch = {id: 'batch-uuid', status: 'pending', items: [
        {id: 'item-applied', entity_type: 'task', op: 'create', status: 'pending', proposed: {title: 'Saved proposal'}},
        {id: 'item-conflict', entity_type: 'task', op: 'create', status: 'pending', proposed: {title: 'Conflicted proposal'}}
    ]};
    const b = setup((url, options) => {
        if (url.endsWith('/accept')) return Promise.resolve(response({
            batch_id: batch.id, batch_status: 'partially_applied', completion_policies: [],
            items: [
                {item_id: 'item-applied', status: 'applied', applied_entity_id: 'entity-uuid'},
                {item_id: 'item-conflict', status: 'conflict', error: 'The task changed after proposal.'}
            ]
        }));
        if (url.endsWith(`/batches/${batch.id}`)) {
            return detailFails ? Promise.resolve(response({detail: 'Synthetic detail read failure'}, 503)) : Promise.resolve(response({...batch, status: 'partially_applied'}));
        }
        return Promise.resolve(response([]));
    });
    const card = b.context.aiBuildDraftBatchNode(batch);
    b.root.appendChild(card);
    const accept = card.querySelectorAll('button').find(button => button.textContent === 'Accept');

    await accept.listeners.click[0]();

    const resultText = b.root.textContent;
    assert.match(resultText, /item-applied/);
    assert.match(resultText, /item-conflict/);
    assert.match(resultText, /applied/i);
    assert.match(resultText, /entity-uuid/);
    assert.match(resultText, /conflict/i);
    assert.match(resultText, /task changed after proposal/);
    assert.ok(b.reads.includes('/taskKnowledge.changed'));
    assert.ok(b.reads.includes('/overlay'));
    assert.ok(b.reads.includes('/badge'));
    assert.match(resultText, /Retry/i);
    assert.equal(b.requests.filter(request => request.url.endsWith('/accept')).length, 1);

    detailFails = false;
    const retry = b.root.querySelectorAll('button').find(button => /retry/i.test(button.textContent));
    await retry.listeners.click[0]();
    assert.equal(b.requests.filter(request => request.url.endsWith('/accept')).length, 1);
    assert.equal(b.requests.filter(request => request.options.method === 'POST').length, 1);
    assert.ok(b.requests.some(request => request.url.endsWith(`/batches/${batch.id}`) && request.options.method === 'GET'));
});

test('failed Calendar overlay read marks the existing refresh-only task notice stale', async () => {
    const b = setup(() => Promise.resolve(response({detail: 'Overlay unavailable'}, 503)));
    const failures = [];
    b.context.taskKnowledge.viewResult = (view, succeeded) => failures.push([view, succeeded]);
    vm.runInContext(fs.readFileSync(path.join(js, 'ai_draft_overlay.js'), 'utf8'), b.context);
    let failed = null;
    b.context.aiDraftOverlayEventSourceFn(
        {start: {toISOString: () => '2026-11-15T00:00:00.000Z'}, end: {toISOString: () => '2026-11-16T00:00:00.000Z'}},
        () => assert.fail('failed overlay cannot report an empty success'),
        error => { failed = error; }
    );
    await tick();
    await tick();
    assert.ok(failed);
    assert.deepEqual(failures, [['draft-overlay', false]]);
    assert.equal(b.requests.length, 1);
    assert.equal(b.requests[0].options.method, 'GET');
});

test('unconfirmed Accept offers a read-only review before another submission is enabled', async () => {
    const batch = {id: 'uncertain-batch', status: 'pending', items: [{
        id: 'uncertain-item', entity_type: 'task', op: 'create', status: 'pending', proposed: {title: 'Review me'}
    }]};
    const b = setup(url => url.endsWith('/accept')
        ? Promise.resolve(response({detail: 'Transport failed after submission'}, 503))
        : Promise.resolve(response(batch)));
    const card = b.context.aiBuildDraftBatchNode(batch);
    b.root.appendChild(card);
    const accept = card.querySelectorAll('button').find(button => button.textContent === 'Accept');
    await accept.listeners.click[0]();
    assert.match(b.root.textContent, /could not be confirmed/i);
    assert.equal(accept.disabled, true);
    assert.equal(b.requests.filter(request => request.url.endsWith('/accept')).length, 1);
    const retry = card.querySelectorAll('button').find(button => button.textContent === 'Retry refresh');
    await retry.listeners.click[0]();
    assert.equal(b.requests.filter(request => request.options.method === 'POST').length, 1);
    assert.equal(b.requests.at(-1).options.method, 'GET');
    assert.equal(b.root.children[0].querySelectorAll('button').find(button => button.textContent === 'Accept').disabled, false);
});

test('a held Accept cannot submit twice and acknowledged read recovery never posts again', async () => {
    let resolveAccept, detailFails = true;
    const accept = new Promise(resolve => { resolveAccept = resolve; });
    const batch = {id: 'one-write-batch', status: 'pending', items: [{id: 'one-item', entity_type: 'task', status: 'pending', proposed: {title: 'One'}}]};
    const b = setup((url) => {
        if (url.endsWith('/accept')) return accept;
        if (url.endsWith(`/batches/${batch.id}`)) return Promise.resolve(detailFails
            ? response({detail: 'Read unavailable'}, 503) : response({...batch, status: 'applied'}));
        return Promise.resolve(response([]));
    });
    const card = b.context.aiBuildDraftBatchNode(batch);
    b.root.appendChild(card);
    const acceptButton = card.querySelectorAll('button').find(button => button.textContent === 'Accept');
    const first = acceptButton.listeners.click[0]();
    const second = acceptButton.listeners.click[0]();
    await tick();
    assert.equal(b.requests.filter(request => request.url.endsWith('/accept')).length, 1);
    assert.equal(acceptButton.disabled, true);
    resolveAccept(response({batch_id: batch.id, batch_status: 'applied', items: [{item_id: 'x', status: 'applied'}]}));
    await Promise.all([first, second]);
    assert.equal(b.requests.filter(request => request.url.endsWith('/accept')).length, 1);
    detailFails = false;
    const retry = b.root.querySelectorAll('button').find(button => button.textContent === 'Retry refresh');
    await retry.listeners.click[0]();
    assert.equal(b.requests.filter(request => request.options.method === 'POST').length, 1);
    assert.equal(b.requests.filter(request => request.options.method === 'GET').length, 2);
});

test('all completion policies remain individually reviewable without clearing sessions', async () => {
    const batch = {id: 'policy-batch', status: 'pending', items: [{id: 'policy-item', entity_type: 'task', status: 'pending', proposed: {title: 'Policy'}}]};
    const policies = [
        {task_id: 'task-a', task_title: 'Task A', scheduled_sessions: [{id: 'session-a'}]},
        {task_id: 'task-b', task_title: 'Task B', scheduled_sessions: [{id: 'session-b'}]},
        {task_id: 'task-c', task_title: 'Task C', scheduled_sessions: [{id: 'session-c'}]}
    ];
    const b = setup(url => {
        if (url.endsWith('/accept')) return Promise.resolve(response({batch_id: batch.id, batch_status: 'applied', items: [], completion_policies: policies}));
        if (url.endsWith(`/batches/${batch.id}`)) return Promise.resolve(response({...batch, status: 'applied'}));
        return Promise.resolve(response([]));
    });
    const modal = element();
    modal.classList.add('hidden');
    b.context.document.getElementById = id => id === 'completion_policy_modal' ? modal : null;
    const shown = [];
    b.context.window.handleCompletionPolicy = ({completion_policy: policy}) => {
        shown.push(policy.task_id);
        modal.classList.remove('hidden');
    };
    const card = b.context.aiBuildDraftBatchNode(batch);
    b.root.appendChild(card);
    await card.querySelectorAll('button').find(button => button.textContent === 'Accept').listeners.click[0]();
    assert.deepEqual(shown, ['task-a']);

    let current = b.root.children[0];
    const reviews = () => current.querySelectorAll('button').filter(button => button.textContent === 'Review scheduled sessions');
    assert.equal(reviews().length, 2);
    assert.match(current.textContent, /Task B/);
    assert.match(current.textContent, /Task C/);
    modal.classList.add('hidden');
    await reviews()[0].listeners.click[0]();
    assert.deepEqual(shown, ['task-a', 'task-b']);
    modal.classList.add('hidden');
    await reviews()[1].listeners.click[0]();
    assert.deepEqual(shown, ['task-a', 'task-b', 'task-c']);
    assert.deepEqual(b.requests.filter(request => request.options.method === 'POST').map(request => request.url), [
        `/api/ai/drafts/batches/${batch.id}/accept`
    ]);
    const later = {task_id: 'task-d', task_title: 'Task D', scheduled_sessions: []};
    modal.classList.remove('hidden');
    b.context.aiHandleCompletionPolicies([later], current);
    assert.deepEqual(shown, ['task-a', 'task-b', 'task-c'], 'an existing prompt is not replaced');
    const laterReview = reviews().find(button => button.parentNode.textContent.includes('Task D'));
    assert.ok(laterReview);
    await laterReview.listeners.click[0]();
    assert.deepEqual(shown, ['task-a', 'task-b', 'task-c'], 'another prompt waits for the open review to close');
    modal.classList.add('hidden');
    await laterReview.listeners.click[0]();
    assert.deepEqual(shown, ['task-a', 'task-b', 'task-c', 'task-d']);
});

test('failed task-option read keeps the proposed attachment and Retry sends GET only', async () => {
    let failTasks = true;
    const b = setup(url => {
        if (url === '/api/tasks') return Promise.resolve(failTasks
            ? response({detail: 'Task list unavailable'}, 503)
            : response([{id: 'other-task', title: 'Other task'}]));
        return Promise.resolve(response([]));
    });
    const item = {id: 'session-proposal', entity_type: 'session', op: 'update', status: 'pending', proposed: {
        task_id: 'missing-task', start_time: '2026-11-15T09:00:00Z', end_time: '2026-11-15T10:00:00Z'
    }};
    const card = b.context.aiBuildDraftBatchNode({id: 'attachment-batch', status: 'pending', items: [item]});
    b.root.appendChild(card);
    card.querySelectorAll('button').find(button => button.textContent === 'Edit').listeners.click[0]();
    await tick();
    let select = card.querySelectorAll('select')[0];
    assert.equal(select.disabled, true);
    assert.equal(select.value, 'missing-task');
    assert.match(card.textContent, /selected task is unchanged/);
    failTasks = false;
    card.querySelectorAll('button').find(button => button.textContent === 'Retry task options').listeners.click[0]();
    await tick();
    select = card.querySelectorAll('select')[0];
    assert.equal(select.disabled, false);
    assert.equal(select.value, 'missing-task');
    assert.ok(select.querySelectorAll('option').some(option => option.value === 'missing-task' && /missing-task/.test(option.textContent)));
    assert.deepEqual(b.requests.map(request => request.options.method), ['GET', 'GET']);
});

test('task options resolving after card reconciliation still initialize the reparented editor', async () => {
    let releaseTasks;
    const tasks = new Promise(resolve => { releaseTasks = resolve; });
    const batch = {id: 'reconciled-options', status: 'pending', items: [{
        id: 'session-item', entity_type: 'session', op: 'update', status: 'pending', proposed: {
            task_id: 'selected-task', start_time: '2026-11-15T09:00:00Z', end_time: '2026-11-15T10:00:00Z'
        }
    }]};
    const b = setup(url => url === '/api/tasks' ? tasks : Promise.resolve(response(batch)));
    const card = b.context.aiBuildDraftBatchNode(batch);
    b.root.appendChild(card);
    card.querySelectorAll('button').find(button => button.textContent === 'Edit').listeners.click[0]();
    await tick();
    const editor = card.querySelector('.ai-inline-edit-box');
    await b.context.aiRefreshCurrentBatchView(batch.id);
    const current = b.root.children[0];
    assert.equal(current.querySelector('.ai-inline-edit-box'), editor);
    releaseTasks(response([{id: 'selected-task', title: 'Selected task'}]));
    await tick();
    await tick();
    const select = current.querySelectorAll('select')[0];
    assert.equal(select.disabled, false);
    assert.equal(select.value, 'selected-task');
    assert.ok(select.querySelectorAll('option').some(option => option.value === 'selected-task'));
});

test('Save failure after successful reconciliation exposes read-only recovery on the live card', async () => {
    let patches = 0;
    const batch = {id: 'reconciled-save', status: 'pending', items: [{
        id: 'task-item', entity_type: 'task', op: 'update', status: 'pending', proposed: {title: 'Original proposal'}
    }]};
    const b = setup((url, options) => {
        if (url.endsWith('/items/task-item')) {
            patches += 1;
            return Promise.resolve(patches === 1 ? response(batch.items[0]) : response({detail: 'Synthetic PATCH failure'}, 503));
        }
        return Promise.resolve(response(batch));
    });
    const card = b.context.aiBuildDraftBatchNode(batch);
    b.root.appendChild(card);
    card.querySelectorAll('button').find(button => button.textContent === 'Edit').listeners.click[0]();
    let editor = card.querySelector('.ai-inline-edit-box');
    editor.querySelector('input').value = 'First saved edit';
    await editor.querySelectorAll('button').find(button => button.textContent === 'Save').listeners.click[0]();
    const liveCard = b.root.children[0];
    editor = liveCard.querySelector('.ai-inline-edit-box');
    assert.ok(editor, 'successful refresh retains the editor node');
    editor.querySelector('input').value = 'Second edit';
    await editor.querySelectorAll('button').find(button => button.textContent === 'Save').listeners.click[0]();
    assert.equal(patches, 2);
    assert.match(liveCard.textContent, /Save failed/);
    assert.match(liveCard.textContent, /Retry refresh/);
    const retry = liveCard.querySelectorAll('button').find(button => button.textContent === 'Retry refresh');
    await retry.listeners.click[0]();
    assert.equal(patches, 2, 'refresh retry never repeats the failed PATCH');
});

test('accepting one proposal keeps another item editor and its selection intact', async () => {
    const batch = {id: 'editor-batch', status: 'pending', items: [
        {id: 'item-a', entity_type: 'task', op: 'create', status: 'pending', proposed: {title: 'A'}},
        {id: 'item-b', entity_type: 'task', op: 'create', status: 'pending', proposed: {title: 'B'}},
        {id: 'item-c', entity_type: 'task', op: 'create', status: 'pending', proposed: {title: 'C'}}
    ]};
    const b = setup((url, options) => {
        if (url.endsWith('/accept')) return Promise.resolve(response({batch_id: batch.id, batch_status: 'partially_applied', items: [{item_id: 'item-b', status: 'applied'}]}));
        if (url.endsWith('/undo')) return Promise.resolve(response({batch_id: batch.id, batch_status: 'undone', items: [{item_id: 'item-b', status: 'undone'}]}));
        if (url.endsWith(`/batches/${batch.id}`)) return Promise.resolve(response({...batch, status: 'partially_applied', items: batch.items.map(item => ({
            ...item, status: item.id === 'item-b' ? 'applied' : 'pending'
        }))}));
        return Promise.resolve(response([]));
    });
    const card = b.context.aiBuildDraftBatchNode(batch);
    b.root.appendChild(card);
    let rowC = card.querySelectorAll('.ai-draft-item').find(row => row.dataset.itemId === 'item-c');
    rowC.querySelectorAll('button').find(button => button.textContent === 'Edit').listeners.click[0]();
    const editor = rowC.querySelector('.ai-inline-edit-box');
    const title = editor.querySelector('input');
    title.value = 'Keep my C edit';
    const checkboxes = card.querySelectorAll('.ai-item-checkbox');
    checkboxes.find(input => input.dataset.itemId === 'item-a').checked = false;
    checkboxes.find(input => input.dataset.itemId === 'item-c').checked = false;

    await card.querySelectorAll('button').find(button => button.textContent === 'Accept').listeners.click[0]();

    const acceptedRequest = b.requests.find(request => request.url.endsWith('/accept'));
    assert.deepEqual(JSON.parse(acceptedRequest.options.body).item_ids, ['item-b']);
    const updated = b.root.children[0];
    rowC = updated.querySelectorAll('.ai-draft-item').find(row => row.dataset.itemId === 'item-c');
    assert.equal(rowC.querySelector('.ai-inline-edit-box'), editor);
    assert.equal(editor.querySelectorAll('input')[0].value, 'Keep my C edit');
    assert.equal(updated.querySelectorAll('.ai-item-checkbox').find(input => input.dataset.itemId === 'item-a').checked, false);
    assert.equal(updated.querySelectorAll('.ai-item-checkbox').find(input => input.dataset.itemId === 'item-c').checked, false);
    await updated.querySelectorAll('button').find(button => button.textContent === 'Undo').listeners.click[0]();
    const undoRequest = b.requests.find(request => request.url.endsWith('/undo'));
    assert.equal(JSON.parse(undoRequest.options.body).item_ids, null, 'Undo remains a batch action over applied items');
});
