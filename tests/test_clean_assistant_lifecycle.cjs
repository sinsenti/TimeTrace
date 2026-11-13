const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const tick = () => new Promise(resolve => setImmediate(resolve));
const held = () => { let resolve; return {promise: new Promise(r => {resolve = r;}), resolve: value => resolve(value)}; };
function element(id = '', tag = 'div') {
    const classes = new Set(), listeners = {}, children = [];
    let text = '';
    return {id, tagName: tag.toUpperCase(), value: '', style: {}, dataset: {}, children, listeners, isConnected: true,
        classList: {add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle(x, on = !classes.has(x)) {on ? classes.add(x) : classes.delete(x); return on;}},
        get childNodes() {return children;}, contains(node) {return this === node || children.some(child => child.contains(node));},
        replaceWith(node) {const parent = this.parentNode; parent.children.splice(parent.children.indexOf(this), 1, node); node.parentNode = parent;},
        get textContent() {return text;}, set textContent(value) {text = value; children.length = 0;},
        set className(value) {value.split(' ').forEach(x => classes.add(x));},
        appendChild(child) {children.push(child); child.parentNode = this; return child;},
        insertBefore(child, before) {const index = children.indexOf(before); children.splice(index < 0 ? children.length : index, 0, child); child.parentNode = this;},
        remove() {if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);},
        focus() {}, setAttribute(key, value) {this[key] = value;}, getAttribute(key) {return this[key];},
        addEventListener(name, fn) {(listeners[name] ||= []).push(fn);}, querySelectorAll(selector) {return children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(child => selector === '*' || selector.split(',').some(part => part.trim().startsWith('.') ? child.classList.contains(part.trim().slice(1)) : child.tagName.toLowerCase() === part.trim()));}, querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    };
}
function browser(respond) {
    const fields = Object.fromEntries(['ai_drawer', 'ai_composer_input', 'ai_composer_send', 'ai_composer_cancel', 'ai_thread', 'ai_assistant_notice', 'ai_launcher_badge', 'ai_conversation_select', 'ai_drawer_body', 'ai_batches_list', 'ai_drafts_panel', 'ai_batches_refresh_btn', 'ai_undo_all_btn', 'ai_delete_conversation_btn', 'ai_new_conversation_btn', 'ai_quick_actions', 'ai_weekly_review_ask_btn'].map(id => [id, element(id)]));
    const requests = [], events = {};
    const context = vm.createContext({AbortController, TextDecoder, console: {error() {}}, CSS: {escape: s => s},
        window: {localStorage: {getItem() {return null;}}, addEventListener() {}, confirm() {return false;}},
        document: {activeElement: element('launcher'), body: element(), documentElement: {style: {setProperty() {}}},
            getElementById: id => fields[id] || Object.values(fields).flatMap(root => root.querySelectorAll('*')).find(child => child.id === id) || null, createElement: tag => element('', tag), querySelector() {return null;}, querySelectorAll() {return [];}, addEventListener(name, fn) {(events[name] ||= []).push(fn);}},
        fetch: async (url, options) => {requests.push({url, options}); return respond(url, options);}
    });
    vm.runInContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/settings.js', 'utf8'), context);
    events.DOMContentLoaded = [];
    for (const name of ['api_client', 'task_knowledge', 'ai_assistant', 'ai_drafts']) vm.runInContext(fs.readFileSync(`src/timetrace/interfaces/api/static/js/${name}.js`, 'utf8'), context);
    for (const fn of events.DOMContentLoaded) fn();
    return {fields, requests, context, run: code => vm.runInContext(code, context), click: id => fields[id].listeners.click[0]({type: 'click'}), input(value) {fields.ai_composer_input.value = value; fields.ai_composer_input.listeners.input[0]();}};
}
const response = value => Response.json(value);
function normal(url) {
    if (url === '/api/ai/status') return response({});
    if (url === '/api/ai/conversations') return response([{id: 'conversation'}]);
    if (url === '/api/ai/conversations/conversation') return response({messages: []});
    throw Error(`Unexpected request ${url}`);
}
test('Send button submits composer text and JSON acknowledgment retains newer identical input', async () => {
    const reply = held();
    const b = browser(url => url.endsWith('/messages') ? reply.promise : normal(url));
    b.input('same text');
    const sending = b.click('ai_composer_send');
    await tick();
    assert.equal(JSON.parse(b.requests.find(r => r.url.endsWith('/messages')).options.body).text, 'same text');
    b.input(''); b.input('same text');
    reply.resolve(response({message: {content: '<literal answer>'}}));
    await sending;
    assert.equal(b.fields.ai_composer_input.value, 'same text');
    assert.ok(b.fields.ai_thread.children.some(child => child.textContent === '<literal answer>'));
});
test('IME and Shift Enter do not send; Enter sends through the actual key handler', async () => {
    const b = browser(url => url.endsWith('/messages') ? response({message: {content: 'ok'}}) : normal(url));
    b.input('keyboard');
    const key = b.fields.ai_composer_input.listeners.keydown[0];
    key({key: 'Enter', isComposing: true, preventDefault() {assert.fail('IME consumed');}});
    key({key: 'Enter', shiftKey: true, preventDefault() {assert.fail('newline consumed');}});
    await tick();
    assert.equal(b.requests.filter(r => r.url.endsWith('/messages')).length, 0);
    key({key: 'Enter', preventDefault() {}}); await tick();
    assert.equal(b.requests.filter(r => r.url.endsWith('/messages')).length, 1);
});
test('A valid error-only SSE terminal renders once without a fabricated interruption', async () => {
    const b = browser(url => url.endsWith('/messages') ? new Response('event: error\ndata: {"error":"Synthetic failure"}\n\n', {headers: {'Content-Type': 'text/event-stream'}}) : normal(url));
    b.input('test'); await b.click('ai_composer_send');
    assert.deepEqual(b.fields.ai_thread.children.filter(child => child.classList.contains('ai-msg-error')).map(child => child.textContent), ['Synthetic failure']);
});
test('Stop while initial conversation GET is held sends no message or new conversation after late empty success', async () => {
    const initial = held();
    const b = browser(url => url === '/api/ai/conversations' ? initial.promise : normal(url));
    b.input('retain this');
    const sending = b.click('ai_composer_send'); await tick();
    b.click('ai_composer_cancel');
    initial.resolve(response([])); await sending;
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 0);
    assert.equal(b.fields.ai_composer_input.value, 'retain this');
    assert.match(b.fields.ai_assistant_notice.textContent, /Server work may have persisted/);
});
test('Held old conversation cannot replace a newer selected conversation', async () => {
    const old = held();
    const b = browser(url => url.endsWith('/old') ? old.promise : url.endsWith('/new') ? response({messages: [{role: 'assistant', content: 'new owner'}]}) : normal(url));
    const first = b.run("aiSelectConversation('old')");
    await b.run("aiSelectConversation('new')");
    old.resolve(response({messages: [{role: 'assistant', content: 'stale owner'}]})); await first;
    assert.deepEqual(b.fields.ai_thread.children.map(child => child.textContent), ['new owner']);
});

test('History Refresh retains the live focused card during a successful read', async () => {
    const batch = {id: 'batch', status: 'pending', summary: 'Current proposal', items: []};
    const b = browser(url => url === '/api/ai/drafts/batches?limit=50' ? response([batch]) : url.endsWith('/batches/batch') ? response(batch) : normal(url));
    const card = b.run("aiBuildDraftBatchNode({id: 'batch', status: 'pending', summary: 'Current proposal', items: []})");
    b.fields.ai_batches_list.appendChild(card);
    b.context.document.querySelector = () => card;
    b.context.document.activeElement = card.children[0];
    b.click('ai_batches_refresh_btn'); await tick();
    assert.equal(b.fields.ai_assistant_notice.textContent, '');
    assert.equal(b.fields.ai_batches_list.children[0], card);
    assert.equal(b.context.document.activeElement.parentNode, card);
});

test('Undo-all acknowledgment survives history read failure and Refresh retries only reads', async () => {
    let failHistory = true;
    const b = browser(url => {
        if (url === '/api/ai/drafts/undo') return response({});
        if (url === '/api/tasks?status=all') return response([]);
        if (url === '/api/ai/drafts/batches?limit=50') return failHistory ? Response.json({detail: 'Synthetic read failure'}, {status: 503}) : response([]);
        return normal(url);
    });
    await b.click('ai_undo_all_btn');
    assert.match(b.fields.ai_assistant_notice.textContent, /Undo all saved; history could not refresh/);
    assert.equal(b.requests.filter(request => request.options.method === 'POST').length, 1);
    failHistory = false;
    b.click('ai_batches_refresh_btn'); await tick();
    assert.equal(b.fields.ai_assistant_notice.textContent, 'No proposals or action history yet.');
    assert.equal(b.requests.filter(request => request.options.method === 'POST').length, 1);
});

test('Acknowledged Delete retains instruction edits typed while the actual DELETE callback is pending', async () => {
    const deletion = held();
    const b = browser((url, options) => options.method === 'DELETE' ? deletion.promise : normal(url));
    b.context.window.confirm = () => true;
    await b.run("aiSelectConversation('conversation')");
    b.run("aiAppendInstructionProposal({id:'instruction', status:'pending', proposed_instruction:'Original'})");
    const card = b.fields.ai_thread.children.at(-1), input = card.querySelector('textarea');
    const deleting = b.click('ai_delete_conversation_btn'); await tick();
    input.value = 'Typed during delete';
    deletion.resolve(response({})); await deleting;
    assert.ok(b.fields.ai_thread.children.includes(card));
    assert.equal(input.value, 'Typed during delete');
    assert.match(b.fields.ai_assistant_notice.textContent, /deleted.*edit/i);
    await b.run("aiSelectConversation('new')");
    assert.ok(b.fields.ai_thread.children.includes(card));
    assert.equal(b.requests.filter(r => r.url.endsWith('/new')).length, 0);
});

for (const stage of ['list', 'detail']) for (const fail of [false, true]) test(`Stop releases Send and selection while initial ${stage} GET remains held; stale ${fail ? 'failure' : 'success'} cannot replace newer owner`, async () => {
    const initial = held(), newer = held();
    const b = browser(url => {
        if (url.endsWith('/messages')) return newer.promise;
        if (stage === 'list' && url === '/api/ai/conversations') return initial.promise;
        if (stage === 'detail' && url.endsWith('/conversation')) return initial.promise;
        if (url.endsWith('/new')) return response({messages: [{role:'assistant', content:'new owner'}]});
        return normal(url);
    });
    b.input('old unsent prompt');
    const sending = b.click('ai_composer_send'); await tick();
    b.click('ai_composer_cancel'); await tick();
    // Do not release the original read before verifying recovery and acquiring a newer owner.
    assert.equal(b.fields.ai_composer_send.disabled, false);
    assert.equal(b.fields.ai_composer_input.value, 'old unsent prompt');
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'new'}});
    assert.deepEqual(b.fields.ai_thread.children.map(node => node.textContent), ['new owner']);
    b.input('new prompt');
    const next = b.click('ai_composer_send'); await tick();
    assert.equal(b.fields.ai_composer_send.disabled, true);
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 1);
    initial.resolve(fail ? Response.json({detail:'Synthetic stale read failure'}, {status:503}) : response(stage === 'list' ? [] : {messages:[{role:'assistant',content:'stale owner'}]}));
    await sending; await tick();
    assert.equal(b.fields.ai_composer_send.disabled, true, 'old finally cannot unlock the newer turn');
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 1);
    assert.doesNotMatch(b.fields.ai_assistant_notice.textContent, /Could not load/);
    assert.deepEqual(b.fields.ai_thread.children.map(node => node.textContent), ['new owner', 'new prompt']);
    newer.resolve(response({message:{content:'new reply'}})); await next;
    assert.equal(b.fields.ai_composer_send.disabled, false);
});

for (const fail of [false, true]) test(`Delete ${fail ? 'rejection' : 'ACK'} retains task edits opened after submission and Cancel permits later selection`, async () => {
    const deletion = held();
    const b = browser((url, options) => options.method === 'DELETE' ? deletion.promise : url.endsWith('/new') ? response({messages:[{role:'assistant',content:'next conversation'}]}) : normal(url));
    b.context.window.confirm = () => true;
    await b.run("aiSelectConversation('conversation')");
    b.run("aiAppendChatBatch({id:'batch',status:'pending',items:[{id:'item',entity_type:'task',op:'create',status:'pending',proposed:{title:'Original'}}]})");
    const card = b.fields.ai_thread.children.at(-1);
    const deleting = b.click('ai_delete_conversation_btn'); await tick();
    card.querySelectorAll('button').find(button => button.textContent === 'Edit').listeners.click[0]();
    const editor = card.querySelector('.ai-inline-edit-box'), input = editor.querySelector('input');
    input.value = 'Typed while deleting';
    deletion.resolve(fail ? Response.json({detail:'Synthetic failure'}, {status:503}) : response({})); await deleting;
    assert.ok(b.fields.ai_thread.children.includes(card));
    assert.equal(input.value, 'Typed while deleting');
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'new'}});
    assert.ok(b.fields.ai_thread.children.includes(card));
    editor.querySelectorAll('button').find(button => button.textContent === 'Cancel').listeners.click[0]();
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'new'}});
    assert.deepEqual(b.fields.ai_thread.children.map(node => node.textContent), ['next conversation']);
    assert.equal(b.requests.filter(r => r.options.method === 'DELETE').length, 1);
});

for (const fail of [false, true]) test(`Dirty Delete ${fail ? 'rejection keeps its usable identity' : 'ACK retires its identity'} and Cancel then Send submits once`, async () => {
    const deletion = held();
    let deleted = false;
    const b = browser((url, options) => {
        if (options.method === 'DELETE') return deletion.promise;
        if (url === '/api/ai/conversations') {
            if (options.method === 'POST') return response({id:'created',title:'Fresh conversation'});
            return response(deleted ? [] : [{id:'conversation'}]);
        }
        if (url.endsWith('/messages')) return response({message:{content:'Usable reply'}});
        if (url.endsWith('/created')) return response({messages:[]});
        return normal(url);
    });
    b.context.window.confirm = () => true;
    await b.run("aiSelectConversation('conversation')");
    b.run("aiAppendChatBatch({id:'batch',status:'pending',items:[{id:'item',entity_type:'task',op:'create',status:'pending',proposed:{title:'Original'}}]})");
    const card = b.fields.ai_thread.children.at(-1);
    const deleting = b.click('ai_delete_conversation_btn'); await tick();
    card.querySelectorAll('button').find(button => button.textContent === 'Edit').listeners.click[0]();
    const editor = card.querySelector('.ai-inline-edit-box'), input = editor.querySelector('input');
    input.value = 'Keep my proposal edit'; b.input('Next message');
    deleted = !fail;
    deletion.resolve(fail ? Response.json({detail:'Synthetic failure'}, {status:503}) : response({})); await deleting;
    assert.ok(b.fields.ai_thread.children.includes(card));
    assert.equal(input.value, 'Keep my proposal edit');
    assert.equal(b.fields.ai_composer_input.value, 'Next message');
    assert.equal(b.fields.ai_conversation_select.value, fail ? 'conversation' : '', 'selection never advertises a deleted target');
    editor.querySelectorAll('button').find(button => button.textContent === 'Cancel').listeners.click[0]();
    await b.click('ai_composer_send');
    assert.deepEqual(b.requests.filter(r => r.options.method === 'POST').map(r => r.url), fail ? ['/api/ai/conversations/conversation/messages'] : ['/api/ai/conversations','/api/ai/conversations/created/messages']);
    assert.equal(b.fields.ai_conversation_select.value, fail ? 'conversation' : 'created');
    assert.equal(b.fields.ai_composer_input.value, '');
    assert.ok(b.fields.ai_thread.children.some(node => node.textContent === 'Usable reply'));
    assert.equal(b.requests.filter(r => r.options.method === 'DELETE').length, 1);
});

for (const hasOtherThread of [false, true]) test(`Deleted orphaned edit survives drawer list refresh ${hasOtherThread ? 'with another thread' : 'with empty history'} and refuses Send/New/selection`, async () => {
    const deletion = held(); let deleted = false;
    const b = browser((url, options) => {
        if (options.method === 'DELETE') return deletion.promise;
        if (url === '/api/ai/conversations') return response(deleted ? (hasOtherThread ? [{id:'new'}] : []) : [{id:'conversation'}]);
        if (url.endsWith('/new')) return response({messages:[{role:'assistant',content:'New owner'}]});
        return normal(url);
    });
    b.context.window.confirm = () => true;
    await b.run("aiSelectConversation('conversation')");
    b.run("aiAppendChatBatch({id:'batch',status:'pending',items:[{id:'item',entity_type:'task',op:'create',status:'pending',proposed:{title:'Original'}}]})");
    const card = b.fields.ai_thread.children.at(-1);
    const deleting = b.click('ai_delete_conversation_btn'); await tick();
    card.querySelectorAll('button').find(button => button.textContent === 'Edit').listeners.click[0]();
    const editor = card.querySelector('.ai-inline-edit-box'), input = editor.querySelector('input');
    input.value = 'Orphaned edit'; b.input('Unsent text'); deleted = true;
    deletion.resolve(response({})); await deleting;
    b.run('openAiDrawer()'); await tick();
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'new'}});
    await b.click('ai_new_conversation_btn');
    await b.click('ai_composer_send');
    assert.ok(b.fields.ai_thread.children.includes(card));
    assert.equal(input.value, 'Orphaned edit');
    assert.equal(b.fields.ai_composer_input.value, 'Unsent text');
    assert.equal(b.fields.ai_conversation_select.value, '');
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 0);
    assert.equal(b.requests.filter(r => r.url.endsWith('/new')).length, 0);
    editor.querySelectorAll('button').find(button => button.textContent === 'Cancel').listeners.click[0]();
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'new'}});
    assert.equal(b.fields.ai_conversation_select.value, 'new');
    assert.deepEqual(b.fields.ai_thread.children.map(node => node.textContent), ['New owner']);
    assert.equal(b.fields.ai_composer_input.value, 'Unsent text');
});

test('Canceled Delete sends nothing; a held acknowledged Delete cannot clear a newer selected owner', async () => {
    const deletion = held();
    const b = browser((url, options) => options.method === 'DELETE' ? deletion.promise : url.endsWith('/new') ? response({messages:[{role:'assistant',content:'new owner'}]}) : normal(url));
    await b.run("aiSelectConversation('conversation')");
    await b.click('ai_delete_conversation_btn');
    assert.equal(b.requests.filter(r => r.options.method === 'DELETE').length, 0);
    b.context.window.confirm = () => true;
    const deleting = b.click('ai_delete_conversation_btn'); await tick();
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'new'}});
    deletion.resolve(response({})); await deleting;
    assert.deepEqual(b.fields.ai_thread.children.map(node => node.textContent), ['new owner']);
    assert.equal(b.fields.ai_conversation_select.value, 'new');
});

for (const finishTurn of [false, true]) test(`Pending New ACK cannot select over a newer ${finishTurn ? 'completed' : 'stopped'} turn and selection`, async () => {
    const creation = held(), turn = held();
    const b = browser((url, options) => {
        if (url === '/api/ai/conversations' && options.method === 'POST') return creation.promise;
        if (url.endsWith('/messages')) return turn.promise;
        if (url.endsWith('/new')) return response({messages:[{role:'assistant',content:'new owner'}]});
        return normal(url);
    });
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'conversation'}});
    const creating = b.click('ai_new_conversation_btn'); await tick();
    b.input('newer prompt'); const sending = b.click('ai_composer_send'); await tick();
    if (finishTurn) {turn.resolve(response({message:{content:'completed reply'}})); await sending;}
    else b.click('ai_composer_cancel');
    // A completed turn itself supersedes New, even without changing the selected ID.
    if (!finishTurn) await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'new'}});
    const transcript = b.fields.ai_thread.children.slice();
    creation.resolve(response({id:'created',title:'Acknowledged row'})); await creating;
    assert.deepEqual(b.fields.ai_thread.children, transcript);
    assert.equal(b.fields.ai_conversation_select.value, finishTurn ? 'conversation' : 'new');
    assert.ok(b.fields.ai_conversation_select.children.some(option => option.value === 'created'));
    assert.equal(b.requests.filter(r => r.url.endsWith('/created')).length, 0);
    assert.equal(b.requests.filter(r => r.options.method === 'DELETE').length, 0);
    if (!finishTurn) {turn.resolve(response({message:{content:'stale reply'}})); await sending;}
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 2);
});

test('Stopped initial creation ACK reconciles its row without selecting over refresh/selection or sending', async () => {
    const creation = held(); let reads = 0;
    const b = browser((url, options) => {
        if (url === '/api/ai/conversations') return options.method === 'POST' ? creation.promise : response(reads++ ? [{id:'new'}] : []);
        if (url.endsWith('/new')) return response({messages:[{role:'assistant',content:'refreshed owner'}]});
        return normal(url);
    });
    b.input('keep canceled prompt'); const sending = b.click('ai_composer_send'); await tick();
    b.click('ai_composer_cancel');
    await b.run('aiLoadConversations()');
    assert.equal(b.fields.ai_conversation_select.value, 'new');
    creation.resolve(response({id:'created',title:'Acknowledged row'})); await sending;
    assert.deepEqual(b.fields.ai_thread.children.map(n => n.textContent), ['refreshed owner']);
    assert.equal(b.fields.ai_composer_input.value, 'keep canceled prompt');
    assert.equal(b.requests.filter(r => r.url.endsWith('/messages')).length, 0);
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 1);
    assert.equal(b.requests.filter(r => r.options.method === 'DELETE').length, 0);
});

for (const fail of [false, true]) test(`Held Delete pauses Send, Enter and presets until ${fail ? 'rejection' : 'ACK'} without losing composer input`, async () => {
    const deletion = held();
    const b = browser((url, options) => options.method === 'DELETE' ? deletion.promise : normal(url));
    b.context.window.confirm = () => true;
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'conversation'}});
    b.input('unsent while deleting');
    const deleting = b.click('ai_delete_conversation_btn'); await tick();
    assert.equal(b.fields.ai_composer_send.disabled, true);
    assert.equal(b.fields.ai_weekly_review_ask_btn.disabled, true);
    assert.match(b.fields.ai_assistant_notice.textContent, /delet.*sending.*paused/i);
    await b.click('ai_composer_send');
    b.fields.ai_composer_input.listeners.keydown[0]({key:'Enter',preventDefault(){}});
    await b.context.window.aiRunPresetPrompt('preset while deleting'); await tick();
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 0);
    assert.equal(b.fields.ai_composer_input.value, 'unsent while deleting');
    deletion.resolve(fail ? Response.json({detail:'Synthetic delete failure'}, {status:503}) : response({})); await deleting;
    assert.equal(b.fields.ai_composer_send.disabled, false);
    assert.equal(b.fields.ai_weekly_review_ask_btn.disabled, false);
    assert.equal(b.fields.ai_composer_input.value, 'unsent while deleting');
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 0);
    assert.equal(b.requests.filter(r => r.options.method === 'DELETE').length, 1);
});

for (const fail of [false, true]) test(`Old Delete ${fail ? 'rejection' : 'ACK'} finalizer cannot unlock a newer selected active turn`, async () => {
    const deletion = held(), turn = held();
    const b = browser((url, options) => {
        if (options.method === 'DELETE') return deletion.promise;
        if (url.endsWith('/new')) return response({messages:[{role:'assistant',content:'new owner'}]});
        if (url.endsWith('/messages')) return turn.promise;
        return normal(url);
    });
    b.context.window.confirm = () => true;
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'conversation'}});
    const deleting = b.click('ai_delete_conversation_btn'); await tick();
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'new'}});
    assert.equal(b.fields.ai_composer_send.disabled, false);
    b.input('new prompt'); const sending = b.click('ai_composer_send'); await tick();
    deletion.resolve(fail ? Response.json({detail:'Synthetic delete failure'}, {status:503}) : response({})); await deleting;
    assert.equal(b.fields.ai_composer_send.disabled, true);
    assert.deepEqual(b.fields.ai_thread.children.map(n => n.textContent), ['new owner','new prompt']);
    turn.resolve(response({message:{content:'new reply'}})); await sending;
    assert.equal(b.fields.ai_composer_send.disabled, false);
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 1);
});

test('Canceled Delete keeps sending available and makes no DELETE request', async () => {
    const b = browser(url => url.endsWith('/messages') ? response({message:{content:'normal reply'}}) : normal(url));
    await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'conversation'}});
    await b.click('ai_delete_conversation_btn');
    b.input('normal prompt'); await b.click('ai_composer_send');
    assert.equal(b.requests.filter(r => r.options.method === 'DELETE').length, 0);
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 1);
    assert.ok(b.fields.ai_thread.children.some(n => n.textContent === 'normal reply'));
    assert.equal(b.fields.ai_composer_send.disabled, false);
});


test('First Send joins held New from empty history and submits once after its ACK', async () => {
    const creation = held();
    const b = browser((url, options) => {
        if (url === '/api/ai/conversations') return options.method === 'POST' ? creation.promise : response([]);
        if (url.endsWith('/created')) return response({messages:[]});
        if (url.endsWith('/messages')) return response({message:{content:'First reply'}});
        return normal(url);
    });
    await b.run('aiLoadConversations()');
    const creating = b.click('ai_new_conversation_btn'); await tick();
    b.input('First message'); const sending = b.click('ai_composer_send'); await tick();
    assert.equal(b.requests.filter(r => r.options.method === 'POST').length, 1);
    assert.equal(b.requests.filter(r => r.url.endsWith('/messages')).length, 0);
    creation.resolve(response({id:'created',title:'First chat'})); await Promise.all([creating, sending]);
    const messages = b.requests.filter(r => r.url.endsWith('/messages'));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].url, '/api/ai/conversations/created/messages');
    assert.equal(JSON.parse(messages[0].options.body).text, 'First message');
    assert.equal(b.requests.filter(r => r.url === '/api/ai/conversations' && r.options.method === 'POST').length, 1);
    assert.equal(b.fields.ai_conversation_select.value, 'created');
    assert.equal(b.fields.ai_composer_input.value, '');
    assert.ok(b.fields.ai_thread.children.some(n => n.textContent === 'First reply'));
    assert.ok(!b.fields.ai_thread.children.some(n => /Failed to start/.test(n.textContent)));
});

for (const switchThread of [false, true]) test(`Stopped first Send joined to New cannot resume on late ACK${switchThread ? ' or replace a newer active thread' : ''}`, async () => {
    const creation = held(), newer = held();
    const b = browser((url, options) => {
        if (url === '/api/ai/conversations') return options.method === 'POST' ? creation.promise : response([]);
        if (url.endsWith('/new')) return response({messages:[{role:'assistant',content:'New owner'}]});
        if (url.endsWith('/new/messages')) return newer.promise;
        return normal(url);
    });
    await b.run('aiLoadConversations()');
    const creating = b.click('ai_new_conversation_btn'); await tick();
    b.input('Keep stopped first message'); const sending = b.click('ai_composer_send'); await tick();
    b.click('ai_composer_cancel');
    assert.equal(b.fields.ai_composer_send.disabled, false, 'Stop releases controls while creation is held');
    assert.equal(b.fields.ai_composer_input.value, 'Keep stopped first message');
    let next;
    if (switchThread) {
        await b.fields.ai_conversation_select.listeners.change[0]({target:{value:'new'}});
        b.input('New prompt'); next = b.click('ai_composer_send'); await tick();
        assert.equal(b.fields.ai_composer_send.disabled, true);
    }
    const transcript = b.fields.ai_thread.children.slice();
    creation.resolve(response({id:'created',title:'Late creation'})); await Promise.all([creating, sending]);
    assert.deepEqual(b.fields.ai_thread.children, transcript);
    assert.equal(b.fields.ai_conversation_select.value, switchThread ? 'new' : '');
    assert.equal(b.requests.filter(r => r.url.endsWith('/created')).length, 0);
    assert.equal(b.requests.filter(r => r.url.endsWith('/created/messages')).length, 0);
    assert.equal(b.requests.filter(r => r.options.method === 'DELETE').length, 0);
    assert.ok(b.fields.ai_conversation_select.children.some(option => option.value === 'created'));
    if (switchThread) {
        assert.equal(b.fields.ai_composer_send.disabled, true, 'old creation finalizer cannot release newer Send');
        newer.resolve(response({message:{content:'New reply'}})); await next;
    } else assert.equal(b.fields.ai_composer_input.value, 'Keep stopped first message');
});
