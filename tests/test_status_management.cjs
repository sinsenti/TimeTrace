const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');

function page(respond) {
    const elements = new Map(), events = new Map();
    const document = {activeElement: null,
        addEventListener(name, handler) { const list = events.get(name) || []; list.push(handler); events.set(name, list); },
        removeEventListener(name, handler) {events.set(name, (events.get(name) || []).filter(fn => fn !== handler));}, getElementById: id => elements.get(id), querySelectorAll: () => [], createElement: tag => element(tag)};
    function element(tag = 'div') {
        const classes = new Set();
        const el = {tagName: tag.toUpperCase(), children: [], listeners: {}, dataset: {}, value: '', checked: false, hidden: false, disabled: false, isConnected: true, textContent: '',
            classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
                toggle(x, force) {
                    const on = force === undefined ? !classes.has(x) : Boolean(force);
                    on ? classes.add(x) : classes.delete(x);
                    return on;
                }},
            setAttribute(key, value) { if (key === 'class') value.split(' ').forEach(x => classes.add(x)); else if (key === 'data-status-id') this.dataset.statusId = value; else if (key === 'hidden') this.hidden = true; else this[key] = value; if (key === 'id') elements.set(value, this); },
            appendChild(child) { child.remove(); this.children.push(child); child.parent = this; child.isConnected = true; return child; },
            replaceChildren(...children) { this.children.forEach(child => { child.parent = null; child.isConnected = false; }); this.children = []; children.forEach(child => this.appendChild(child)); },
            prepend(child) { child.remove(); this.children.unshift(child); child.parent = this; },
            remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; this.isConnected = false; },
            contains(target) { return target === this || this.children.some(x => x.contains(target)); },
            closest(selector) { return this.classList.contains(selector.slice(1)) ? this : this.parent?.closest(selector); },
            querySelectorAll(selector) { const all = this.children.flatMap(x => [x, ...x.querySelectorAll('*')]); return selector === '*' ? all : all.filter(x => selector.split(',').some(s => s.trim().startsWith('.') ? x.classList.contains(s.trim().slice(1)) : s.trim().startsWith('#') ? x.id === s.trim().slice(1) : x.tagName === s.trim().toUpperCase())); },
            querySelector(selector) { return this.querySelectorAll(selector)[0]; },
            addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
            removeEventListener(name, fn) {this.listeners[name] = (this.listeners[name] || []).filter(handler => handler !== fn);},
            click() {for (const handler of [...(this.listeners.click || [])]) handler({target: this});},
            focus() { document.activeElement = this; }, getClientRects() { return [1]; }};
        return el;
    }
    document.body = element('body');
    for (const id of ['status_manager_modal', 'status_manager_list', 'status_manager_feedback', 'status_order_retry', 'status_board_feedback', 'status_board_order_retry', 'status_manager_entry', 'status_add_entry', 'add_status_modal', 'modal_new_status_name', 'modal_new_status_color', 'new_status_color_hex', 'status_add_feedback', 'status_add_retry', 'status_add_save', 'custom_confirm_modal']) {
        const el = element(id.startsWith('modal_new_') ? 'input' : id.includes('retry') || id.includes('entry') || id.includes('save') ? 'button' : 'div'); el.setAttribute('id', id);
    }
    for (const id of ['status_manager_modal', 'add_status_modal', 'custom_confirm_modal']) elements.get(id).classList.add('hidden');
    elements.get('status_manager_modal').appendChild(elements.get('status_manager_list'));
    for (const id of ['modal_new_status_name', 'modal_new_status_color', 'status_add_feedback', 'status_add_retry', 'status_add_save']) elements.get('add_status_modal').appendChild(elements.get(id));
    const requests = [], errors = [];
    const context = vm.createContext({document, console: {error(...args) { errors.push(args); }}, window: {}, setTimeout, clearTimeout, URL, fetch: async (url, options) => {
        const request = {url, method: options.method, body: options.body && JSON.parse(options.body)}; requests.push(request);
        const result = await respond(request);
        if (result.error) throw Error(result.error);
        return {status: result.status || 200, ok: !result.status || result.status < 400, headers: {get: () => 'application/json'}, json: async () => result.body};
    }});
    context.window = context;
    const run = source => vm.runInContext(source, context);
    for (const file of ['api_client.js', 'task_knowledge.js', 'settings.js', 'kanban.js']) run(fs.readFileSync(path.join(js, file), 'utf8'));
    return {run, elements, requests, element, errors,
        key(key, shiftKey = false) {
            const event = {key, shiftKey, target: document.activeElement, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {this.stopped = true;}};
            for (const handler of [...(events.get('keydown') || [])]) {handler(event); if (event.stopped) break;}
        }, row: id => elements.get(`status_draft_${id}`)};
}
const status = (id, name = id) => ({id, name, color: '#ffffff', position: 0, is_hide_by_default: false, is_completed: false, is_scheduled_trigger: false});
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {resolve, promise}; };
const fields = row => row.querySelectorAll('input');

test('status drafts require Save; saving B and Cancel retain independent A edits and literal/raw values', async () => {
    let rows = [status('a'), status('b')];
    const p = page(async r => {
        if (r.method === 'PUT') { rows = rows.map(st => st.id === r.url.split('/').at(-1) ? {...st, ...r.body} : st); return {body: rows.find(st => st.id === 'b')}; }
        return {body: r.url.includes('statuses') ? rows : []};
    });
    p.run('openStatusManagerModal()'); await tick();
    fields(p.row('a'))[0].value = '<img onerror="bad()">A';
    fields(p.row('b'))[0].value = 'B saved';
    fields(p.row('b'))[1].value = 'rebeccapurple';
    assert.equal(p.requests.filter(r => r.method !== 'GET').length, 0);
    await p.run("saveStatusRow('b')");
    assert.equal(fields(p.row('a'))[0].value, '<img onerror="bad()">A');
    assert.equal(fields(p.row('b'))[1].value, 'rebeccapurple');
    assert.equal(p.run("hasSettingsDrafts(['status_draft_a'])"), true);
    p.run("cancelStatusRow('a')");
    assert.equal(fields(p.row('a'))[0].value, 'a');
    assert.equal(p.requests.filter(r => r.method !== 'GET').length, 1);
});

test('create adopts canonical ID before GET failure; refresh retry cannot replay POST and concurrent input stays dirty', async () => {
    const held = deferred(); let failRead = false, rows = [];
    const p = page(async r => {
        if (r.method === 'POST') { await held.promise; rows = [status('canonical-id', r.body.name)]; failRead = true; return {body: rows[0]}; }
        if (r.method === 'PUT') return {body: {...rows[0], ...r.body}};
        if (r.url.includes('statuses') && failRead) return {status: 503, body: {detail: 'Read unavailable'}};
        return {body: r.url.includes('statuses') ? rows : []};
    });
    p.run('openAddStatusModal()'); p.elements.get('modal_new_status_name').value = 'Submitted';
    const saving = p.run('saveNewStatusFromModal()');
    p.elements.get('modal_new_status_name').value = 'Concurrent draft';
    await p.run('saveNewStatusFromModal()');
    held.resolve(); await saving;
    assert.match(p.elements.get('status_add_feedback').textContent, /Saved.*refresh unavailable/s);
    assert.equal(p.elements.get('status_add_save').disabled, true);
    assert.equal(p.elements.get('modal_new_status_name').value, 'Concurrent draft');
    assert.equal(p.run("hasSettingsDrafts(['add_status_modal'])"), true);
    failRead = false; await p.run('refreshStatusManagement(statusManagerOwner, addStatusOwner)');
    assert.equal(p.requests.filter(r => r.method === 'POST').length, 1);
    await p.run('saveNewStatusFromModal()');
    assert.equal(p.requests.filter(r => r.method === 'POST').length, 1);
    assert.equal(p.requests.find(r => r.method === 'PUT').url, '/api/tasks/statuses/canonical-id');
});

test('rejected row save retains draft and requires a read-only verification before explicit retry', async () => {
    let rejected = true;
    const p = page(async r => r.method === 'PUT' && rejected ? {status: 400, body: {detail: 'Synthetic rejected write'}} : {body: r.url.includes('statuses') ? (r.method === 'PUT' ? {...status('a'), ...r.body} : [status('a')]) : []});
    p.run('openStatusManagerModal()'); await tick(); fields(p.row('a'))[0].value = 'Retained';
    await p.run("saveStatusRow('a')");
    assert.equal(fields(p.row('a'))[0].value, 'Retained');
    await p.run("saveStatusRow('a')");
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 1);
    rejected = false; await p.run("refreshStatusManagement(statusManagerOwner, statusManagerOwner.rows.get('a'))");
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 1);
    await p.run("saveStatusRow('a')");
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 2);
});

test('late create acknowledgement cannot close or focus a newer Add owner', async () => {
    const held = deferred();
    const p = page(async r => r.method === 'POST' ? (await held.promise, {body: status('saved-old', r.body.name)}) : {body: []});
    p.run('openAddStatusModal()'); p.elements.get('modal_new_status_name').value = 'Old owner';
    const save = p.run('saveNewStatusFromModal()');
    p.run('closeAddStatusModal(); openAddStatusModal()');
    p.elements.get('modal_new_status_name').value = 'New owner';
    held.resolve(); await save;
    assert.equal(p.elements.get('modal_new_status_name').value, 'New owner');
    assert.equal(p.elements.get('add_status_modal').classList.contains('hidden'), false);
    assert.equal(p.elements.get('status_add_save').disabled, false);
});

test('a stale prewrite status read cannot overwrite an acknowledged row', async () => {
    const held = deferred(); let reads = 0, row = status('a');
    const p = page(async r => {
        if (r.method === 'PUT') { row = {...row, ...r.body}; return {body: row}; }
        if (r.url.includes('statuses')) { reads++; if (reads === 2) return held.promise; return {body: [row]}; }
        return {body: []};
    });
    p.run('openStatusManagerModal()'); await tick();
    const old = p.run('refreshStatusManagement()');
    fields(p.row('a'))[0].value = 'Acknowledged'; await p.run("saveStatusRow('a')");
    held.resolve({body: [status('a', 'Stale')]}); await old;
    assert.equal(fields(p.row('a'))[0].value, 'Acknowledged');
});

test('partial order retries only unacknowledged positions after verification without discarding row drafts', async () => {
    let reject = true, rows = [status('a'), {...status('b'), position: 1}, {...status('c'), position: 2}];
    const p = page(async r => {
        if (r.method === 'PUT') {
            if (r.url.endsWith('/a') && reject) return {status: 400, body: {detail: 'Synthetic reorder rejection'}};
            const id = r.url.split('/').at(-1); rows = rows.map(st => st.id === id ? {...st, ...r.body} : st);
            return {body: rows.find(st => st.id === id)};
        }
        return {body: r.url.includes('statuses') ? rows.slice().sort((a,b) => a.position - b.position) : []};
    });
    p.run('openStatusManagerModal()'); await tick(); fields(p.row('c'))[0].value = 'Retain C';
    await p.run("saveStatusOrder(['b', 'a', 'c'])");
    assert.equal(p.elements.get('status_order_retry').hidden, false);
    assert.equal(fields(p.row('c'))[0].value, 'Retain C');
    reject = false; await p.run('continueStatusOrder()');
    assert.deepEqual(p.requests.filter(r => r.method === 'PUT').map(r => r.url.split('/').at(-1)), ['b', 'a', 'a', 'c']);
    assert.equal(fields(p.row('c'))[0].value, 'Retain C');
});

test('manager dismissal removes draft ownership and reopening never duplicates status rows', async () => {
    const p = page(async r => ({body: r.url.includes('statuses') ? [status('a')] : []}));
    p.run('openStatusManagerModal()'); await tick(); fields(p.row('a'))[0].value = 'Discard me';
    assert.equal(p.run("hasSettingsDrafts(['status_draft_a'])"), true);
    p.run('closeStatusManagerModal()');
    assert.equal(p.run("hasSettingsDrafts(['status_draft_a'])"), false);
    p.run('openStatusManagerModal()'); await tick();
    assert.equal(p.elements.get('status_manager_list').children.length, 1);
    assert.equal(fields(p.row('a'))[0].value, 'a');
});

test('a rejected older create cannot lock or replace a newer Add owner', async () => {
    const held = deferred();
    const p = page(async r => r.method === 'POST' ? held.promise : {body: []});
    p.run('openAddStatusModal()'); p.elements.get('modal_new_status_name').value = 'Old';
    const save = p.run('saveNewStatusFromModal()'); p.run('closeAddStatusModal(); openAddStatusModal()');
    p.elements.get('modal_new_status_name').value = 'New';
    held.resolve({status: 400, body: {detail: 'Old rejected'}}); await save;
    assert.equal(p.elements.get('modal_new_status_name').value, 'New');
    assert.equal(p.elements.get('status_add_save').disabled, false);
    assert.equal(p.elements.get('status_add_feedback').textContent, '');
});

test('read refresh checkpoints adopted clean fields without clearing another dirty field', async () => {
    let row = status('a');
    const p = page(async r => ({body: r.url.includes('statuses') ? [row] : []}));
    p.run('openStatusManagerModal()'); await tick();
    row = {...row, color: '#000000'}; await p.run('refreshStatusManagement()');
    assert.equal(fields(p.row('a'))[1].value, '#000000');
    assert.equal(p.run("hasSettingsDrafts(['status_draft_a'])"), false);
    fields(p.row('a'))[0].value = 'Unsubmitted name';
    row = {...row, is_completed: true}; await p.run('refreshStatusManagement()');
    assert.equal(fields(p.row('a'))[0].value, 'Unsubmitted name');
    assert.equal(p.run("hasSettingsDrafts(['status_draft_a'])"), true);
});

test('acknowledged order plus failed GET stays read-only across manager and board until verified server order is adopted', async () => {
    let failRead = false, rows = [status('a'), {...status('b'), position: 1}];
    const p = page(async r => {
        if (r.method === 'PUT') {
            failRead = true;
            const id = r.url.split('/').at(-1);
            rows = rows.map(st => st.id === id ? {...st, ...r.body} : st);
            return {body: rows.find(st => st.id === id)};
        }
        if (r.url.includes('statuses') && failRead) return {status: 503, body: {detail: 'Saved order refresh unavailable'}};
        return {body: r.url.includes('statuses') ? rows.slice().sort((a,b) => a.position-b.position) : []};
    });
    p.run('openStatusManagerModal()'); await tick();
    fields(p.row('a'))[0].value = 'Independent name';
    fields(p.row('a'))[1].value = 'rebeccapurple';
    fields(p.row('a'))[2].checked = true;
    await p.run("saveStatusOrder(['b', 'a'])");
    assert.match(p.elements.get('status_manager_feedback').textContent, /Order saved.*Retry refresh/s);
    assert.equal(p.row('a').querySelectorAll('button').find(b => b.textContent === 'Move down').disabled, true);
    assert.equal(p.row('a').querySelectorAll('button').find(b => b.textContent === 'Save').disabled, false);
    await p.run("moveStatusRow('a', 1); saveStatusOrder(['a', 'b']); saveBoardStatusOrder(['a', 'b'])");
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 2, 'Failed display read cannot allow another order mutation');
    await p.run('continueStatusOrder()');
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 2, 'Failed retry reads only');
    failRead = false; await p.run('continueStatusOrder()');
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 2, 'Successful verification never replays ACKs');
    assert.deepEqual(p.elements.get('status_manager_list').children.map(row => row.dataset.statusId), ['b', 'a']);
    assert.equal(fields(p.row('a'))[0].value, 'Independent name');
    assert.equal(fields(p.row('a'))[1].value, 'rebeccapurple');
    assert.equal(fields(p.row('a'))[2].checked, true);
    assert.equal(p.run("hasSettingsDrafts(['status_draft_a'])"), true);
    await p.run("moveStatusRow('a', -1)");
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 4, 'Next human move is legitimate after adoption');
});

test('prewrite and during-write GETs cannot unlock order, including after manager dismissal', async () => {
    const old = deferred(), during = deferred(), put = deferred(); let reads = 0, writes = 0;
    const rows = [status('a'), {...status('b'), position: 1}];
    const p = page(async r => {
        if (r.method === 'PUT') { if (++writes === 1) await put.promise; return {body: {...rows[0], ...r.body}}; }
        if (r.url.includes('statuses')) {
            if (++reads === 2) return old.promise;
            if (reads === 3) return during.promise;
            if (reads > 3) return {status: 503, body: {detail: 'Verification unavailable'}};
            return {body: rows};
        }
        return {body: []};
    });
    p.run('openStatusManagerModal()'); await tick();
    const prewrite = p.run('refreshStatusManagement()');
    const saving = p.run("saveBoardStatusOrder(['b', 'a'])");
    const duringWrite = p.run('refreshStatusManagement()');
    put.resolve(); await saving;
    old.resolve({body: rows}); during.resolve({body: rows}); await prewrite; await duringWrite;
    await p.run("saveStatusOrder(['a', 'b']); saveBoardStatusOrder(['a', 'b'])");
    assert.equal(writes, 2);
    p.run('closeStatusManagerModal(); openStatusManagerModal()'); await tick();
    await p.run("saveStatusOrder(['a', 'b'])");
    assert.equal(writes, 2, 'Reopening cannot discard the verification lock');
});

test('partial order with failed verification keeps ACK journal through read-only retry and manager dismissal', async () => {
    let reject = true, failRead = false;
    const rows = [status('a'), {...status('b'), position: 1}, {...status('c'), position: 2}];
    const p = page(async r => {
        if (r.method === 'PUT') {
            if (r.url.endsWith('/a') && reject) { failRead = true; return {status: 400, body: {detail: 'Rejected position'}}; }
            return {body: {...status(r.url.split('/').at(-1)), ...r.body}};
        }
        if (r.url.includes('statuses') && failRead) return {status: 503, body: {detail: 'Verification failed'}};
        return {body: r.url.includes('statuses') ? rows : []};
    });
    p.run('openStatusManagerModal()'); await tick();
    await p.run("saveStatusOrder(['b', 'a', 'c'])");
    await p.run("saveBoardStatusOrder(['a', 'b', 'c']); continueStatusOrder()");
    assert.deepEqual(p.requests.filter(r => r.method === 'PUT').map(r => r.url.split('/').at(-1)), ['b', 'a']);
    p.run('closeStatusManagerModal()');
    reject = false; failRead = false;
    await p.run('continueStatusOrder(statusBoardOrder)');
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 2, 'Verification after dismissal is read-only');
    await p.run("saveBoardStatusOrder(['a', 'b', 'c'])");
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 2, 'Verified partial journal still blocks new orders');
    await p.run('continueStatusOrder(statusBoardOrder)');
    assert.deepEqual(p.requests.filter(r => r.method === 'PUT').map(r => r.url.split('/').at(-1)), ['b', 'a', 'a', 'c']);
});

test('board reorder preserves hidden status slots and string identifiers', async () => {
    const rows = [status('019b1111-1111-7111-8111-111111111111', 'First'), {...status('019b1111-1111-7111-8111-222222222222', 'Hidden'), position: 1, is_hide_by_default: true}, {...status('019b1111-1111-7111-8111-333333333333', 'Last'), position: 2}];
    const p = page(async r => ({body: r.method === 'PUT' ? {...rows.find(st => r.url.endsWith(st.id)), ...r.body} : r.url.includes('statuses') ? rows : []}));
    p.run(`allStatuses = ${JSON.stringify(rows)}`);
    await p.run(`saveBoardStatusOrder(['${rows[2].id}', '${rows[0].id}'])`);
    assert.deepEqual(p.requests.filter(r => r.method === 'PUT').map(r => [r.url.split('/').at(-1), r.body.position]), [[rows[2].id, 0], [rows[1].id, 1], [rows[0].id, 2]]);
});

test('malformed status refresh retains the last known rows and unsaved drafts', async () => {
    let malformed = false;
    const p = page(async r => ({body: r.url.includes('statuses') ? malformed ? {detail: 'not rows'} : [status('a')] : []}));
    p.run('openStatusManagerModal()'); await tick();
    fields(p.row('a'))[0].value = 'Unsaved'; malformed = true;
    assert.equal(await p.run('refreshStatusManagement()'), false);
    assert.equal(p.run('Array.isArray(allStatuses)'), true);
    assert.equal(fields(p.row('a'))[0].value, 'Unsaved');
});

test('status choices preserve exact live selections in every Tasks editor without writes', () => {
    const p = page(async () => ({body: []}));
    for (const [id, value] of [['modal_input_status', 'Deleted'], ['inspector_edit_status', ''], ['modal_subtask_status', '<dirty>']]) {
        const select = p.element('select'); select.value = value; p.elements.set(id, select);
    }
    p.run(`refreshStatusChoices([{id:'019b1111-1111-7111-8111-111111111111', name:'New custom'}])`);
    for (const [id, value] of [['modal_input_status', 'Deleted'], ['inspector_edit_status', ''], ['modal_subtask_status', '<dirty>']]) {
        assert.equal(p.elements.get(id).value, value);
        assert.deepEqual(p.elements.get(id).children.map(option => option.value), ['New custom', value]);
    }
    assert.equal(p.requests.length, 0);
});

test('status ACK refresh uses the real Grouped dispatcher and metadata refresh while retaining task selections and drafts', async () => {
    const id = '019b1111-1111-7111-8111-111111111111';
    let rows = [status(id, 'Original')];
    const tasks = [{id: '019b1111-1111-7111-8111-222222222222', title: 'Needle retained', status: 'Deleted'}, {id: '019b1111-1111-7111-8111-333333333333', title: 'Other', status: 'Original', status_id: id}];
    const p = page(async r => {
        if (r.method === 'PUT') { rows = [{...rows[0], ...r.body}]; return {body: rows[0]}; }
        return {body: r.url.includes('statuses') ? rows : tasks};
    });
    for (const name of ['kanban_columns_container', 'tasks_workspace', 'tasks_search', 'modal_input_status']) p.elements.set(name, p.element(name === 'modal_input_status' ? 'select' : 'div'));
    p.elements.get('tasks_search').value = 'needle';
    p.elements.get('modal_input_status').value = 'Unsubmitted custom draft';
    p.run(`function escapeHtml(value) {return String(value ?? '').replaceAll('<', '&lt;');} function formatMinutesToDuration(value) {return String(value || 0);} function getTaskDateBadge() {return null;}`);
    p.run(fs.readFileSync(path.join(js, 'grouped_tasks.js'), 'utf8'));
    p.run("selectedTaskView = 'grouped'; openStatusManagerModal()"); await tick();
    fields(p.row(id))[0].value = 'Renamed';
    await p.run(`saveStatusRow('${id}')`);
    assert.deepEqual(p.errors, []);
    const html = p.elements.get('kanban_columns_container').innerHTML;
    assert.equal(p.elements.get('kanban_columns_container').className, 'grouped-task-list');
    assert.match(html, /Renamed/); assert.match(html, /Unknown status/); assert.match(html, /Needle retained/); assert.doesNotMatch(html, />Other</);
    assert.equal(p.elements.get('tasks_search').value, 'needle');
    assert.equal(p.elements.get('modal_input_status').value, 'Unsubmitted custom draft');
    assert.equal(p.run(`taskKnowledge.get('${tasks[0].id}').title`), 'Needle retained');
    assert.equal(p.requests.filter(r => r.method !== 'GET').length, 1);
});

test('UUID status deletion Cancel and stale confirmation send no DELETE; rejected delete retains drafts', async () => {
    const id = '019b1111-1111-7111-8111-111111111111';
    const p = page(async r => r.method === 'DELETE' ? {status: 400, body: {detail: 'Rejected delete'}} : {body: r.url.includes('statuses') ? [status(id, 'Keep')] : []});
    p.run('openStatusManagerModal()'); await tick();
    p.run('async function showCustomConfirm() {return false;}');
    await p.run(`deleteStatusRow('${id}')`);
    assert.equal(p.requests.filter(r => r.method === 'DELETE').length, 0);
    p.run('window.confirmationResult = null; function showCustomConfirm() {return confirmationResult;}');
    // Pass the held promise through the real confirmation caller, then replace its owner.
    p.run('window.confirmationResult = new Promise(resolve => window.finishConfirmation = resolve)');
    const pending = p.run(`deleteStatusRow('${id}')`);
    p.run('closeStatusManagerModal(); openStatusManagerModal()'); await tick();
    p.run('finishConfirmation(true)'); await pending;
    assert.equal(p.requests.filter(r => r.method === 'DELETE').length, 0);
    fields(p.row(id))[0].value = 'Retained after failure';
    p.run('async function showCustomConfirm() {return true;}');
    await p.run(`deleteStatusRow('${id}')`);
    assert.equal(p.requests.filter(r => r.method === 'DELETE').length, 1);
    assert.equal(fields(p.row(id))[0].value, 'Retained after failure');
    assert.match(p.row(id).querySelector('p').textContent, /Save not confirmed/);
});

test('status ACK refresh runs real detail-tree refresh and preserves initialized task properties and child drafts', async () => {
    const id = '019b1111-1111-7111-8111-111111111111', taskId = '019b1111-1111-7111-8111-222222222222';
    let rows = [status(id, 'Original')];
    const tree = {id: taskId, title: 'Persisted parent', description: 'Saved notes', status: 'Original', subtasks: []};
    const p = page(async r => {
        if (r.method === 'PUT') {rows = [{...rows[0], ...r.body}]; return {body: rows[0]};}
        return {body: r.url.includes('statuses') ? rows : r.url.endsWith('/tree') ? tree : r.url.endsWith('/stats') ? {sessions: []} : [tree]};
    });
    for (const name of ['inspector_task_id', 'task_properties_editor', 'inspector_edit_title', 'inspector_edit_desc', 'inspector_edit_status', 'subtask_modal', 'modal_subtask_title', 'modal_subtask_status']) {
        const el = p.element(name.includes('_status') ? 'select' : 'input'); el.setAttribute('id', name);
    }
    const propertyRoot = p.elements.get('task_properties_editor');
    for (const name of ['inspector_edit_title', 'inspector_edit_desc', 'inspector_edit_status']) propertyRoot.appendChild(p.elements.get(name));
    for (const name of ['modal_subtask_title', 'modal_subtask_status']) p.elements.get('subtask_modal').appendChild(p.elements.get(name));
    p.elements.get('inspector_task_id').value = taskId;
    p.run(fs.readFileSync(path.join(js, 'subtasks.js'), 'utf8'));
    assert.equal(await p.run('loadTaskDetailTree()'), true);
    const notes = p.elements.get('inspector_edit_desc'); notes.value = 'Retained parent notes';
    p.elements.get('modal_subtask_title').value = 'Retained child';
    p.elements.get('modal_subtask_status').value = 'Unsubmitted child status';
    p.run('openStatusManagerModal()'); await tick();
    fields(p.row(id))[0].value = 'Renamed';
    const readsBefore = p.requests.filter(r => r.url.endsWith('/tree')).length;
    await p.run(`saveStatusRow('${id}')`);
    assert.ok(p.requests.filter(r => r.url.endsWith('/tree')).length > readsBefore);
    assert.equal(p.elements.get('inspector_edit_desc'), notes);
    assert.equal(notes.value, 'Retained parent notes');
    assert.equal(p.elements.get('inspector_edit_status').value, 'Original');
    assert.equal(p.elements.get('modal_subtask_title').value, 'Retained child');
    assert.equal(p.elements.get('modal_subtask_status').value, 'Unsubmitted child status');
    assert.equal(p.run("hasSettingsDrafts(['task_properties_editor'])"), true);
    assert.equal(p.requests.filter(r => r.method !== 'GET').length, 1);
});

test('row Save checkpoints only submitted values and retains typing during the acknowledgement', async () => {
    const id = '019b1111-1111-7111-8111-111111111111', ack = deferred(); let row = status(id, 'Original');
    const p = page(async r => {
        if (r.method === 'PUT') {await ack.promise; row = {...row, ...r.body}; return {body: row};}
        return {body: r.url.includes('statuses') ? [row] : []};
    });
    p.run('openStatusManagerModal()'); await tick();
    fields(p.row(id))[0].value = 'Submitted';
    const saving = p.run(`saveStatusRow('${id}')`);
    fields(p.row(id))[0].value = 'Typed during save';
    await p.run(`saveStatusRow('${id}')`);
    ack.resolve(); await saving;
    assert.equal(fields(p.row(id))[0].value, 'Typed during save');
    assert.equal(p.run(`hasSettingsDrafts(['status_draft_${id}'])`), true);
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 1);
    p.run(`cancelStatusRow('${id}')`);
    assert.equal(fields(p.row(id))[0].value, 'Submitted');
});

test('actual board Sortable callback shares the order journal and keeps hidden slots', async () => {
    const a = '019b1111-1111-7111-8111-111111111111', h = '019b1111-1111-7111-8111-222222222222', b = '019b1111-1111-7111-8111-333333333333';
    let rows = [status(a), {...status(h), position: 1, is_hide_by_default: true}, {...status(b), position: 2}];
    const p = page(async r => {
        if (r.method === 'PUT') { rows = rows.map(row => r.url.endsWith(row.id) ? {...row, ...r.body} : row); return {body: rows.find(row => r.url.endsWith(row.id))}; }
        return {body: r.url.includes('statuses') ? rows : []};
    });
    const container = p.element(); p.elements.set('kanban_columns_container', container);
    for (const id of [b, a]) { const col = p.element(); col.classList.add('kanban-col'); col.getAttribute = () => id; container.appendChild(col); }
    p.run(fs.readFileSync(path.join(js, 'grouped_tasks.js'), 'utf8'));
    p.run(`selectedTaskView = 'grouped'; function escapeHtml(value) {return String(value);}`);
    p.run(`allStatuses = ${JSON.stringify(rows)}; var capturedSorts = []; var Sortable = {create(root, options) {capturedSorts.push(options); return {option(){}, destroy(){}};}}; initKanbanDragAndDrop()`);
    await p.run('capturedSorts[0].onEnd()');
    assert.deepEqual(p.requests.filter(r => r.method === 'PUT').map(r => [r.url.split('/').at(-1), r.body.position]), [[b, 0], [h, 1], [a, 2]]);
    assert.equal(p.run('statusOrderLocked()'), false);
});

test('returning to the original row value after authoritative refresh remains a draft against the new server baseline', async () => {
    let row = status('019b1111-1111-7111-8111-111111111111', 'A');
    const p = page(async r => ({body: r.url.includes('statuses') ? [row] : []}));
    p.run('openStatusManagerModal()'); await tick(); fields(p.row(row.id))[0].value = 'B';
    row = {...row, name: 'C'}; await p.run('refreshStatusManagement()');
    fields(p.row(row.id))[0].value = 'A';
    assert.equal(p.run(`hasSettingsDrafts(['status_draft_${row.id}'])`), true);
});

test('late post-ACK verification cannot write feedback or retry controls into a newer standalone Add owner', async () => {
    const read = deferred(); let held = false;
    const p = page(async r => {
        if (r.method === 'POST') {held = true; return {body: status('019b1111-1111-7111-8111-111111111111', r.body.name)};}
        if (held && r.url.includes('statuses')) return read.promise;
        return {body: []};
    });
    p.run('openAddStatusModal()'); p.elements.get('modal_new_status_name').value = 'Old';
    const saving = p.run('saveNewStatusFromModal()'); await tick();
    p.run('closeAddStatusModal(); openAddStatusModal()'); p.elements.get('modal_new_status_name').value = 'New';
    held = false; read.resolve({body: []}); await saving;
    assert.equal(p.elements.get('status_add_feedback').textContent, '');
    assert.equal(p.elements.get('status_add_retry').hidden, true);
    assert.equal(p.elements.get('modal_new_status_name').value, 'New');
});

test('board read rejects null metadata rather than clearing the last known status snapshot', async () => {
    const p = page(async r => ({body: r.url.includes('statuses') ? null : []}));
    p.run(`allStatuses = [${JSON.stringify(status('019b1111-1111-7111-8111-111111111111', 'Retained'))}]`);
    assert.equal(await p.run('loadKanbanBoard()'), false);
    assert.equal(p.run('allStatuses[0].name'), 'Retained');
});

test('failed status-manager read recovers the initial board without stale repaint or draft loss', async () => {
    const initialStatuses = deferred(), initialTasks = deferred();
    const recoveryStatuses = deferred(), recoveryTasks = deferred();
    let statusReads = 0, taskReads = 0;
    const p = page(async r => {
        if (r.url === '/api/tasks/statuses') {
            statusReads++;
            if (statusReads === 1) return initialStatuses.promise;
            if (statusReads === 2) return {status: 503, body: {detail: 'Manager refresh unavailable'}};
            if (statusReads === 3) return recoveryStatuses.promise;
            assert.fail(`unexpected status read ${statusReads}`);
        }
        if (r.url.startsWith('/api/tasks?')) {
            taskReads++;
            if (taskReads === 1) return initialTasks.promise;
            if (taskReads === 2) return recoveryTasks.promise;
            assert.fail(`unexpected task read ${taskReads}`);
        }
        assert.fail(`unexpected request ${r.method} ${r.url}`);
    });
    const board = p.element();
    p.elements.set('kanban_columns_container', board);
    p.elements.set('tasks_workspace', p.element());
    for (const id of ['modal_input_status', 'inspector_edit_status', 'modal_subtask_status']) {
        const select = p.element('select');
        select.value = 'Unsubmitted task status';
        p.elements.set(id, select);
    }
    p.run('function escapeHtml(value) {return String(value);}');
    p.run(`allStatuses = [${JSON.stringify(status('seed', 'Seed'))}]`);

    const initialBoard = p.run('loadKanbanBoard()');
    await tick();
    p.run('openStatusManagerModal()');
    fields(p.row('seed'))[0].value = 'Unsaved status name';
    await tick();
    assert.equal(statusReads, 3, 'the failed manager read immediately starts a read-only board recovery');

    initialStatuses.resolve({body: [status('stale', 'Stale status')]});
    await tick();
    assert.equal(taskReads, 1);
    recoveryStatuses.resolve({body: [status('fresh', 'Fresh status')]});
    await tick();
    assert.equal(taskReads, 2);
    recoveryTasks.resolve({body: []});
    await tick(); await tick();
    assert.match(board.innerHTML || '', /Fresh status/, JSON.stringify({statusReads, taskReads, requests: p.requests, errors: p.errors.map(args => String(args.at(-1)))}));
    assert.doesNotMatch(board.innerHTML, /Stale status/);

    initialTasks.resolve({body: []});
    assert.equal(await initialBoard, null, 'the superseded initial read is discarded');
    assert.match(board.innerHTML, /Fresh status/, 'late initial completion cannot repaint stale columns');
    assert.equal(fields(p.row('seed'))[0].value, 'Unsaved status name');
    for (const id of ['modal_input_status', 'inspector_edit_status', 'modal_subtask_status']) {
        assert.equal(p.elements.get(id).value, 'Unsubmitted task status');
    }
    assert.equal(p.requests.filter(r => r.method !== 'GET').length, 0, 'recovery never replays or invents a mutation');
});

test('confirmed deletion of an unacknowledged order row cannot strand the remaining order journal', async () => {
    const a = '019b1111-1111-7111-8111-111111111111', b = '019b1111-1111-7111-8111-222222222222', c = '019b1111-1111-7111-8111-333333333333';
    let rows = [status(a), {...status(b), position: 1}, {...status(c), position: 2}];
    const p = page(async r => {
        if (r.method === 'DELETE') {rows = rows.filter(row => !r.url.endsWith(row.id)); return {status: 204};}
        if (r.method === 'PUT') return r.url.endsWith(b) ? {status: 404, body: {detail: 'Missing'}} : {body: {...rows.find(row => r.url.endsWith(row.id)), ...r.body}};
        return {body: r.url.includes('statuses') ? rows : []};
    });
    p.run('async function showCustomConfirm() {return true;} openStatusManagerModal()'); await tick();
    await p.run(`saveStatusOrder(['${a}', '${b}', '${c}'])`);
    await p.run(`deleteStatusRow('${b}')`);
    await p.run('continueStatusOrder()');
    assert.deepEqual(p.requests.filter(r => r.method === 'PUT').map(r => r.url.split('/').at(-1)), [a, b, c]);
    assert.equal(p.run('statusOrderLocked()'), false);
});

test('a during-write read cannot unlock an uncertain row Save before post-result verification', async () => {
    const id = '019b1111-1111-7111-8111-111111111111', write = deferred(), read = deferred(); let held = false;
    const p = page(async r => r.method === 'PUT' ? write.promise : r.url.includes('statuses') ? held ? read.promise : {body: [status(id)]} : {body: []});
    p.run('openStatusManagerModal()'); await tick(); fields(p.row(id))[0].value = 'Draft';
    const saving = p.run(`saveStatusRow('${id}')`); await tick();
    held = true; const refreshing = p.run('refreshStatusManagement()'); await tick();
    write.resolve({error: 'Response lost'}); await saving;
    assert.equal(p.run(`statusManagerOwner.rows.get('${id}').readOnly`), true);
    read.resolve({body: [status(id)]}); await refreshing;
    assert.equal(p.run(`statusManagerOwner.rows.get('${id}').readOnly`), true);
    await p.run(`saveStatusRow('${id}')`);
    assert.equal(p.requests.filter(r => r.method === 'PUT').length, 1);
    held = false; await p.run('refreshStatusManagement()');
    assert.equal(p.run(`statusManagerOwner.rows.get('${id}').readOnly`), false);
});

test('narrow status grid wins the stylesheet cascade and permits fields to shrink', () => {
    const css = fs.readFileSync(path.join(js, '../css/status_management.css'), 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{[^{}]*grid-template-columns:\s*([^;}]+)/g)];
    assert.equal(rules.length, 2);
    const specificity = rule => (rule[1].match(/\.[\w-]+/g) || []).length;
    const winner = specificity(rules[1]) >= specificity(rules[0]) ? rules[1] : rules[0];
    assert.doesNotMatch(winner[2], /minmax\(\d+px/, 'The active narrow grid cannot retain desktop pixel minima');
});

test('real status Delete confirmation owns Cancel focus, Tab loop, Enter cancellation and return focus', async () => {
    const id = '019b1111-1111-7111-8111-111111111111';
    const p = page(async r => ({body: r.url.includes('statuses') ? [status(id)] : []}));
    const modal = p.elements.get('custom_confirm_modal');
    for (const name of ['confirm_modal_title', 'confirm_modal_message', 'confirm_modal_cancel_btn', 'confirm_modal_proceed_btn']) {
        const el = p.element(name.endsWith('_btn') ? 'button' : 'p'); el.setAttribute('id', name); modal.appendChild(el);
    }
    p.run('var localStorage = {getItem() {return null;}}; window.addEventListener = function() {};');
    p.run(fs.readFileSync(path.join(js, 'utils.js'), 'utf8'));
    p.run('openStatusManagerModal()'); await tick();
    const launcher = p.row(id).querySelectorAll('button').find(button => button.textContent === 'Delete');
    launcher.focus(); const deleting = p.run(`deleteStatusRow('${id}')`);
    assert.equal(p.run('document.activeElement.id'), 'confirm_modal_cancel_btn');
    p.key('Tab', true); assert.equal(p.run('document.activeElement.id'), 'confirm_modal_proceed_btn');
    p.key('Tab'); assert.equal(p.run('document.activeElement.id'), 'confirm_modal_cancel_btn');
    p.key('Enter'); await deleting;
    assert.equal(p.requests.filter(r => r.method === 'DELETE').length, 0);
    assert.equal(p.run('document.activeElement'), launcher);
    assert.equal(launcher.disabled, false);
    const escaping = p.run(`deleteStatusRow('${id}')`); p.key('Escape'); await escaping;
    assert.equal(p.requests.filter(r => r.method === 'DELETE').length, 0);
    assert.equal(p.run('document.activeElement'), launcher);
    const confirming = p.run("showCustomConfirm('Confirm', 'Confirm')");
    p.elements.get('confirm_modal_proceed_btn').focus(); p.key('Enter');
    assert.equal(await confirming, true);
    const defaultEnter = p.run("showCustomConfirm('Default', 'Default')");
    p.elements.get('status_manager_entry').focus(); p.key('Enter');
    assert.equal(await defaultEnter, true);
});
