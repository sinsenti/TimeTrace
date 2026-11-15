// Ticket 23's first regression exercises the real instruction card and shared API client.
// Only HTTP is faked; the Save event handler remains production code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
}

function element(tag = 'div') {
    const listeners = new Map(), classes = new Set();
    let text = '', value = '';
    const node = {
        tagName: tag.toUpperCase(), id: '', type: '', disabled: false, rows: 0, maxLength: 0,
        children: [], dataset: {}, parentNode: null,
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
        addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
        querySelectorAll(selector) {
            const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
            return descendants.filter(child => selector === '*' || selector.split(',').some(part => {
                const match = part.trim();
                return match.startsWith('.') ? child.classList.contains(match.slice(1)) : child.tagName.toLowerCase() === match;
            }));
        },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
        replaceWith(other) {
            if (!this.parentNode) return;
            const siblings = this.parentNode.children;
            siblings.splice(siblings.indexOf(this), 1, other);
            other.parentNode = this.parentNode;
        },
        remove() {
            if (!this.parentNode) return;
            this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
            this.parentNode = null;
        },
        focus() { this.focused = true; }, setAttribute(name, value) { this[name] = String(value); },
        classList: {add: (...items) => items.forEach(item => classes.add(item)), remove: (...items) => items.forEach(item => classes.delete(item)), contains: item => classes.has(item)},
        get listeners() { return listeners; },
    };
    Object.defineProperties(node, {
        className: {get: () => [...classes].join(' '), set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(item => classes.add(item)); }},
        textContent: {get: () => text + node.children.map(child => child.textContent).join(''), set: value => { text = String(value); node.children.length = 0; }},
        value: {get: () => value, set: next => { value = String(next); }},
    });
    return node;
}

function response(body, status = 200) {
    return {ok: status < 400, status, statusText: 'Synthetic response', headers: {get: () => 'application/json'}, json: async () => body};
}

function fixture({conflict = false, settingsFailures = 1, acceptFailure = false, proposalReadFailures = 0, proposalReadPromise, acceptPromise, settingsReadPromise} = {}) {
    const notice = element(), thread = element(), requests = [];
    let remainingSettingsFailures = settingsFailures;
    let remainingProposalReadFailures = proposalReadFailures;
    const fields = {ai_assistant_notice: notice, ai_thread: thread};
    const context = vm.createContext({
        console: {error() {}},
        window: {addEventListener() {}},
        CSS: {escape: value => value},
        document: {
            getElementById: id => fields[id] || Object.values(fields).flatMap(root => root.querySelectorAll('*')).find(child => child.id === id) || null,
            createElement: element,
            querySelector(selector) {
                if (selector.includes('.ai-instruction-proposal')) {
                    return thread.children.find(child => child.classList.contains('ai-instruction-proposal')) || null;
                }
                return null;
            },
            querySelectorAll() { return []; },
            addEventListener() {},
        },
        fetch: async (url, options = {}) => {
            const method = options.method || 'GET';
            requests.push({url, method, body: options.body ? JSON.parse(options.body) : null});
            if (method === 'POST' && url.endsWith('/accept') && acceptFailure) {
                throw new Error('Synthetic unknown transport outcome');
            }
            if (method === 'POST' && url.endsWith('/accept') && acceptPromise) return acceptPromise;
            if (method === 'POST' && url.endsWith('/accept') && conflict) {
                return response({detail: 'Settings changed since this proposal was created.'}, 409);
            }
            if (method === 'POST' && url.endsWith('/reject')) {
                return response({proposal: {
                    id: 'proposal-1', status: 'rejected', proposed_instruction: 'Original instruction',
                    before_instructions: 'Before', after_instructions: 'Before\n\nOriginal instruction',
                }});
            }
            if (method === 'POST' && url.endsWith('/accept')) {
                return response({
                    proposal: {id: 'proposal-1', status: 'accepted', proposed_instruction: 'Edited instruction', before_instructions: 'Before', after_instructions: 'Before\n\nEdited instruction'},
                    settings: {custom_instructions: 'Before\n\nEdited instruction'},
                });
            }
            if (method === 'GET' && url === '/api/ai/instruction-proposals/proposal-1' && conflict) {
                return response({
                    id: 'proposal-1', status: 'conflict', proposed_instruction: 'Original instruction',
                    before_instructions: 'Before', after_instructions: 'Before\n\nOriginal instruction',
                });
            }
            if (method === 'GET' && url === '/api/ai/instruction-proposals/proposal-1' && acceptFailure) {
                if (proposalReadPromise) return proposalReadPromise;
                if (remainingProposalReadFailures > 0) {
                    remainingProposalReadFailures -= 1;
                    return response({detail: 'Synthetic status read failure'}, 503);
                }
                return response({
                    id: 'proposal-1', status: 'pending', proposed_instruction: 'Original instruction',
                    before_instructions: 'Before', after_instructions: 'Before\n\nOriginal instruction',
                });
            }
            if (method === 'GET' && url === '/api/ai/settings') {
                if (settingsReadPromise) return settingsReadPromise;
                if (remainingSettingsFailures > 0) {
                    remainingSettingsFailures -= 1;
                    return response({detail: 'Synthetic refresh failure'}, 503);
                }
                return response({custom_instructions: 'Manual Settings edit'});
            }
            throw new Error(`Unexpected fixture request ${method} ${url}`);
        },
    });
    for (const name of ['settings.js', 'api_client.js', 'ai_assistant.js']) {
        vm.runInContext(fs.readFileSync(`src/timetrace/interfaces/api/static/js/${name}`, 'utf8'), context, {filename: name});
    }
    const card = vm.runInContext(`aiBuildInstructionProposalNode({
        id: 'proposal-1', status: 'pending', proposed_instruction: 'Original instruction',
        before_instructions: 'Before', after_instructions: 'Before\\n\\nOriginal instruction'
    }, {onChanged: async () => await api.get('/api/ai/settings')})`, context);
    thread.appendChild(card);
    return {context, requests, card, fields, thread};
}

test('an acknowledged Save stays accepted when the post-ACK refresh callback fails', async () => {
    const b = fixture();
    const save = b.card.querySelectorAll('button').find(button => button.textContent === 'Save to custom instructions');
    assert.ok(save, 'actual instruction card exposes its explicit Save action');
    b.card.querySelector('textarea').value = 'Edited instruction';
    let unhandled = null;
    const capture = error => { unhandled = error; };
    process.on('unhandledRejection', capture);
    try {
        await save.listeners.get('click')[0]({target: save});
        await tick();
    } finally {
        process.removeListener('unhandledRejection', capture);
    }

    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/accept')).length, 1);
    assert.equal(b.requests.find(request => request.method === 'POST' && request.url.endsWith('/accept')).body.instruction, 'Edited instruction');
    assert.equal(b.requests.filter(request => request.method === 'GET' && request.url === '/api/ai/settings').length, 1);
    assert.equal(b.thread.children.length, 1);
    assert.match(b.thread.children[0].textContent, /Saved to custom instructions/);
    const acceptedCard = b.thread.children[0];
    assert.equal(acceptedCard.focused, true, 'focus moves to the accepted card after replacement');
    assert.match(acceptedCard.querySelector('.ai-instruction-proposal-status').textContent, /saved.*refresh.*retry/i);
    const retry = acceptedCard.querySelectorAll('button').find(button => /retry/i.test(button.textContent));
    assert.ok(retry, 'refresh failure offers an explicit read-only retry');
    await retry.listeners.get('click')[0]({target: retry});
    assert.equal(b.requests.filter(request => request.method === 'GET' && request.url === '/api/ai/settings').length, 2);
    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/accept')).length, 1);
    assert.equal(unhandled, null, 'post-ACK refresh rejection is contained as a read failure, not leaked as an unhandled callback error');
});

test('a conflict read restores terminal status and its retry cannot accept again', async () => {
    const b = fixture({conflict: true, settingsFailures: 1});
    const input = b.card.querySelector('textarea');
    input.value = 'Edited text to keep for review';
    const save = b.card.querySelectorAll('button').find(button => button.textContent === 'Save to custom instructions');
    await save.listeners.get('click')[0]({target: save});

    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/accept')).length, 1);
    assert.equal(b.requests.filter(request => request.method === 'GET' && request.url === '/api/ai/instruction-proposals/proposal-1').length, 1);
    const conflictCard = b.thread.children[0];
    assert.match(conflictCard.textContent, /cannot be saved/i);
    assert.equal(conflictCard.querySelector('textarea').value, 'Edited text to keep for review');
    assert.equal(conflictCard.querySelector('textarea').readOnly, true, 'terminal conflict keeps the reviewed text copyable without creating an unresolvable new edit');
    assert.equal(b.context.aiCanChangeConversation(), true);
    assert.equal(conflictCard.querySelectorAll('button').some(button => button.textContent === 'Save to custom instructions'), false);
    assert.ok(conflictCard.querySelectorAll('a').some(link => link.textContent === 'Open AI settings'));
    const retry = conflictCard.querySelectorAll('button').find(button => /retry/i.test(button.textContent));
    assert.ok(retry, 'failed Settings reconciliation offers a read-only retry');
    await retry.listeners.get('click')[0]({target: retry});

    assert.equal(b.requests.filter(request => request.method === 'GET' && request.url === '/api/ai/settings').length, 2);
    assert.equal(b.requests.filter(request => request.method === 'POST').length, 1);
    const resolvedConflictCard = b.thread.children[0];
    assert.match(resolvedConflictCard.textContent, /cannot be saved/i);
    assert.match(resolvedConflictCard.textContent, /Manual Settings edit/);
});

test('conflict review is copyable but read-only while current Settings are loading', async () => {
    const heldSettings = deferred();
    const b = fixture({conflict: true, settingsFailures: 0, settingsReadPromise: heldSettings.promise});
    const input = b.card.querySelector('textarea');
    input.value = 'Keep this conflict text available for copying';
    const save = b.card.querySelectorAll('button').find(button => button.textContent === 'Save to custom instructions');
    const saving = save.listeners.get('click')[0]({target: save});
    await tick();

    const reviewCard = b.thread.children[0];
    const reviewInput = reviewCard.querySelector('textarea');
    assert.equal(reviewInput.value, 'Keep this conflict text available for copying');
    assert.equal(reviewInput.disabled, false);
    assert.equal(reviewInput.readOnly, true);
    assert.equal(b.context.aiCanChangeConversation(), false, 'the pending Settings read keeps this card owner selected');
    heldSettings.resolve(response({custom_instructions: 'Manual Settings edit'}));
    await saving;

    const resolvedCard = b.thread.children[0];
    assert.equal(resolvedCard.querySelector('textarea').value, 'Keep this conflict text available for copying');
    assert.equal(resolvedCard.querySelector('textarea').readOnly, true);
    assert.match(resolvedCard.textContent, /Manual Settings edit/);
    assert.equal(b.context.aiCanChangeConversation(), true, 'terminal read-only conflict no longer owns an in-flight operation');
});

test('an uncertain Save stays locked until a status read confirms pending', async () => {
    const b = fixture({acceptFailure: true, proposalReadFailures: 1});
    const input = b.card.querySelector('textarea');
    input.value = 'Retain this edited instruction';
    const save = b.card.querySelectorAll('button').find(button => button.textContent === 'Save to custom instructions');
    await save.listeners.get('click')[0]({target: save});

    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/accept')).length, 1);
    assert.equal(b.requests.filter(request => request.method === 'GET' && request.url.endsWith('/proposal-1')).length, 1);
    let currentCard = b.thread.children[0];
    assert.match(currentCard.querySelector('.ai-instruction-proposal-status').textContent, /could not confirm/i);
    assert.equal(currentCard.querySelectorAll('button').find(button => button.textContent === 'Save to custom instructions').disabled, true);
    const retry = currentCard.querySelectorAll('button').find(button => /check proposal status/i.test(button.textContent));
    assert.ok(retry);
    await retry.listeners.get('click')[0]({target: retry});

    assert.equal(b.requests.filter(request => request.method === 'GET' && request.url.endsWith('/proposal-1')).length, 2);
    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/accept')).length, 1);
    currentCard = b.thread.children[0];
    assert.equal(currentCard.querySelector('textarea').value, 'Retain this edited instruction');
    assert.equal(currentCard.querySelectorAll('button').find(button => button.textContent === 'Save to custom instructions').disabled, false);
    assert.equal(b.context.aiCanChangeConversation(), false, 'the restored proposal edit remains independently dirty');
});

test('duplicate delivery retains the edited card and exposes a labeled live status', () => {
    const b = fixture();
    const card = b.card, input = card.querySelector('textarea');
    input.value = 'Local draft that must survive duplicate delivery';
    input.listeners.get('input')[0]({target: input});
    b.context.aiAppendInstructionProposal({
        id: 'proposal-1', status: 'pending', proposed_instruction: 'Replacement from duplicate event',
        before_instructions: 'Before', after_instructions: 'Replacement snapshot',
    });

    assert.equal(b.thread.children.length, 1);
    assert.equal(b.thread.children[0], card);
    assert.equal(card.querySelector('textarea'), input);
    assert.equal(input.value, 'Local draft that must survive duplicate delivery');
    const label = card.querySelector('label');
    assert.equal(label.htmlFor, input.id);
    assert.ok(input.id.startsWith(`${card.id}_`));
    assert.equal(card.tabIndex, -1);
    const status = card.querySelector('.ai-instruction-proposal-status');
    assert.equal(status.role, 'status');
    assert.equal(status['aria-live'], 'polite');
    assert.match(card.textContent, /Original proposed result/);
});

test('a late proposal status read cannot replace a card after its conversation owner disappears', async () => {
    let resolveRead;
    const heldRead = new Promise(resolve => { resolveRead = resolve; });
    const b = fixture({acceptFailure: true, proposalReadPromise: heldRead});
    const save = b.card.querySelectorAll('button').find(button => button.textContent === 'Save to custom instructions');
    const saving = save.listeners.get('click')[0]({target: save});
    await tick();
    assert.equal(b.requests.filter(request => request.method === 'GET' && request.url.endsWith('/proposal-1')).length, 1);
    b.card.remove();
    const otherConversation = element('p');
    otherConversation.textContent = 'New conversation owner';
    b.thread.appendChild(otherConversation);
    resolveRead(response({
        id: 'proposal-1', status: 'accepted', proposed_instruction: 'Original instruction',
        before_instructions: 'Before', after_instructions: 'Before\n\nOriginal instruction',
    }));
    await saving;

    assert.deepEqual(b.thread.children.map(child => child.textContent), ['New conversation owner']);
    assert.equal(b.requests.filter(request => request.method === 'GET' && request.url === '/api/ai/settings').length, 0);
    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/accept')).length, 1);
});

test('an unedited instruction card guards conversation change during Save', async () => {
    const write = deferred();
    const b = fixture({acceptPromise: write.promise});
    const save = b.card.querySelectorAll('button').find(button => button.textContent === 'Save to custom instructions');
    const saving = save.listeners.get('click')[0]({target: save});
    await tick();

    assert.equal(b.context.aiCanChangeConversation(), false);
    await save.listeners.get('click')[0]({target: save});
    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/accept')).length, 1);
    write.resolve(response({
        proposal: {id: 'proposal-1', status: 'accepted', proposed_instruction: 'Original instruction', before_instructions: 'Before', after_instructions: 'Before\n\nOriginal instruction'},
        settings: {custom_instructions: 'Before\n\nOriginal instruction'},
    }));
    await saving;

    assert.equal(b.context.aiCanChangeConversation(), true);
    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/accept')).length, 1);
});

test('an acknowledged Dismiss stays dismissed when the post-write refresh fails', async () => {
    const b = fixture();
    const dismiss = b.card.querySelectorAll('button').find(button => button.textContent === 'Dismiss');
    await dismiss.listeners.get('click')[0]({target: dismiss});

    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/reject')).length, 1);
    assert.equal(b.requests.filter(request => request.method === 'POST' && request.url.endsWith('/accept')).length, 0);
    assert.equal(b.requests.filter(request => request.method === 'PUT').length, 0);
    const dismissedCard = b.thread.children[0];
    assert.match(dismissedCard.textContent, /Dismissed; custom instructions were not changed/);
    assert.match(dismissedCard.querySelector('.ai-instruction-proposal-status').textContent, /refresh.*retry/i);
    assert.ok(dismissedCard.querySelectorAll('button').some(button => /retry/i.test(button.textContent)));
});
