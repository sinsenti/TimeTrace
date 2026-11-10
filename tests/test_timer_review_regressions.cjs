const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const web = path.resolve(__dirname, '../src/timetrace/interfaces/api');
const read = name => fs.readFileSync(path.join(web, name), 'utf8');
const tick = () => new Promise(setImmediate);
const deferred = () => {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return {promise, resolve};
};
const stopped = () => ({is_running: false, is_frozen_idle: false, idle_detection_enabled: false, pending_idle_gap: null});
const frozen = () => ({...stopped(), is_frozen_idle: true, pending_idle_gap: {
    idle_start: '2026-11-01T10:02:00+00:00', idle_end: '2026-11-01T10:12:00+00:00', idle_seconds: 600,
    task_id: '01a1b22e-f818-70a6-a51c-e3f583bdec4b', tags: '#original', notes: 'Before idle',
    saved_session: {start_time: '2026-11-01T10:00:00+00:00', end_time: '2026-11-01T10:02:00+00:00',
        task_id: '01a1b22e-f818-70a6-a51c-e3f583bdec4b', tags: '#original', notes: 'Before idle'}
}});

// Local DOM/event/HTTP/storage adapters only. No controller, Save, close, draft-registry or
// checkpoint implementation is replaced. The recovery owner is NEVER registered by this fixture.
class FixtureEvent {
    constructor(type, options = {}) {
        Object.assign(this, {type, bubbles: false, cancelable: false, defaultPrevented: false,
            eventPhase: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false}, options);
    }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
    stopImmediatePropagation() { this.immediate = true; this.stopped = true; }
    composedPath() { return [...this.path]; }
}

function dom() {
    let document, context;
    const trace = [];
    class Node {
        constructor(tag = '', id = '') {
            Object.assign(this, {tagName: tag.toUpperCase(), id, parentNode: null, children: [], dataset: {},
                attributes: {}, listeners: [], value: '', checked: false, disabled: false, textContent: '',
                style: {setProperty() {}}, type: tag === 'input' ? 'text' : tag === 'select' ? 'select-one' : tag});
            const classes = new Set();
            Object.defineProperty(this, 'className', {get: () => [...classes].join(' '),
                set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); }});
            this.classList = {contains: c => classes.has(c), add: (...cs) => cs.forEach(c => classes.add(c)),
                remove: (...cs) => cs.forEach(c => classes.delete(c)),
                toggle(c, force = !classes.has(c)) { force ? classes.add(c) : classes.delete(c); return force; }};
        }
        get isConnected() { return this === document || Boolean(this.parentNode?.isConnected); }
        get offsetParent() {
            for (let el = this; el; el = el.parentNode) if (el.classList.contains('hidden')) return null;
            return this.isConnected ? this.parentNode : null;
        }
        append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
        appendChild(node) {
            if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
            node.parentNode = this;
            this.children.push(node);
            return node;
        }
        contains(node) { for (; node; node = node.parentNode) if (node === this) return true; return false; }
        setAttribute(name, value) {
            this.attributes[name] = String(value);
            if (name === 'class') this.className = value;
            else if (['id', 'type', 'value'].includes(name)) this[name] = String(value);
            else if (name === 'checked' || name === 'disabled') this[name] = true;
            else if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
        }
        getAttribute(name) { return this.attributes[name] ?? null; }
        matches(selector) {
            let s = selector.trim();
            if (s.startsWith('#')) return this.id === s.slice(1);
            const enabled = /:not\((?::disabled|\[disabled\])\)/.test(s);
            s = s.replace(/:not\((?::disabled|\[disabled\])\)/g, '');
            if (enabled && this.disabled) return false;
            const attr = s.match(/\[([\w-]+)\]$/);
            if (attr) { if (this.getAttribute(attr[1]) === null) return false; s = s.slice(0, attr.index); }
            assert.match(s, /^[a-z]*$/i, `unsupported DOM selector: ${selector}`);
            return !s || this.tagName.toLowerCase() === s;
        }
        querySelectorAll(selector) {
            return this.children.flatMap(child => [child, ...child.descendants()])
                .filter(child => selector.split(',').some(s => child.matches(s)));
        }
        descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        addEventListener(type, fn, options = false) {
            const capture = typeof options === 'boolean' ? options : Boolean(options.capture);
            if (!this.listeners.some(l => l.type === type && l.fn === fn && l.capture === capture)) {
                this.listeners.push({type, fn, capture, once: Boolean(options.once)});
            }
        }
        removeEventListener(type, fn, options = false) {
            const capture = typeof options === 'boolean' ? options : Boolean(options.capture);
            this.listeners = this.listeners.filter(l => !(l.type === type && l.fn === fn && l.capture === capture));
        }
        dispatchEvent(event) {
            const ancestry = [];
            for (let node = this; node; node = node.parentNode) ancestry.push(node);
            event.path = ancestry; event.target = this;
            const invoke = (node, capture, phase) => {
                event.currentTarget = node; event.eventPhase = phase;
                for (const listener of [...node.listeners]) {
                    if (listener.type !== event.type || listener.capture !== capture || !node.listeners.includes(listener)) continue;
                    trace.push(`${node.id || node.tagName}:${capture ? 'capture' : 'bubble'}:${event.type}`);
                    if (listener.once) node.removeEventListener(listener.type, listener.fn, capture);
                    listener.fn.call(node, event);
                    if (event.immediate) return;
                }
                const inline = !capture && node.getAttribute(`on${event.type}`);
                if (inline && !event.immediate) {
                    const handler = vm.runInContext(`(function(event) { ${inline} })`, context);
                    if (handler.call(node, event) === false) event.preventDefault();
                }
            };
            for (const node of ancestry.slice(1).reverse()) {
                invoke(node, true, 1);
                // stopPropagation leaves other listeners on THIS node intact, including window capture.
                if (event.stopped) break;
            }
            if (!event.stopped) {
                invoke(this, true, 2);
                if (!event.immediate) invoke(this, false, 2);
                if (event.bubbles && !event.stopped) for (const node of ancestry.slice(1)) {
                    invoke(node, false, 3);
                    if (event.stopped) break;
                }
            }
            event.currentTarget = null; event.eventPhase = 0;
            return !event.defaultPrevented;
        }
        focus() { if (!this.disabled && this.offsetParent !== null) document.activeElement = this; }
        blur() { if (document.activeElement === this) document.activeElement = document.body; }
        click() {
            if (this.disabled) return;
            this.focus();
            return this.dispatchEvent(new FixtureEvent('click', {bubbles: true, cancelable: true}));
        }
    }
    const window = new Node('window', 'window');
    document = new Node('document', 'document'); window.append(document);
    document.documentElement = new Node('html'); document.append(document.documentElement);
    document.body = new Node('body'); document.documentElement.append(document.body);
    document.activeElement = document.body;
    document.getElementById = id => document.descendants().find(node => node.id === id) || null;
    document.createElement = tag => new Node(tag);
    function parse(html) {
        const root = new Node('div'), stack = [root];
        // These fragments have only structural Jinja directives (no DOM-producing JS).
        html = html.replace(/{%[^]*?%}/g, '');
        for (const [text] of html.matchAll(/<!--[^]*?-->|<\/?[a-z][^>]*>|[^<]+/gi)) {
            if (text.startsWith('<!--')) continue;
            if (!text.startsWith('<')) { stack.at(-1).textContent += text; continue; }
            if (text.startsWith('</')) { stack.pop(); continue; }
            const tag = text.match(/^<(\w+)/)[1].toLowerCase(), node = new Node(tag);
            for (const [, name, quoted, bare] of text.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)"|=([^\s>]+))?/g)) {
                node.setAttribute(name, quoted ?? bare ?? '');
            }
            stack.at(-1).append(node);
            if (!['input', 'br', 'hr', 'link', 'meta'].includes(tag)) stack.push(node);
        }
        document.body.append(...[...root.children]);
    }
    return {window, document, Node, trace, parse, bind: value => { context = value; }};
}

async function page(t) {
    const d = dom();
    for (const name of ['navbar', 'idle_resolution_modal', 'settings_modal', 'confirm_modal']) {
        d.parse(read(`templates/components/${name}.html`));
    }
    // Use the actual Dashboard secondary-timer fragment, not invented switch controls.
    const dashboard = read('templates/dashboard.html');
    const toolbar = dashboard.match(/<div id="active_timer_pill"[^]*?<\/div>/);
    assert.ok(toolbar, 'actual Dashboard timer toolbar exists'); d.parse(toolbar[0]);
    const local = new Map([['timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, unknown: 'retain me'})]]);
    const session = new Map(), storageWrites = [], writes = [], reads = [], confirmations = [], errors = [], unexpected = [], intervals = [];
    const storage = (map, kind) => ({getItem: key => map.get(key) ?? null,
        setItem(key, value) { storageWrites.push({kind, key, value: String(value)}); map.set(key, String(value)); },
        removeItem(key) { storageWrites.push({kind, key, remove: true}); map.delete(key); }});
    const p = {...d, local, session, storageWrites, writes, reads, confirmations, errors, unexpected, intervals,
        status: stopped(), nextStatusGate: null, postGate: null};
    d.window.location = {href: 'http://unit.invalid/dashboard'};
    d.window.confirm = message => { confirmations.push(message); return false; };
    const context = vm.createContext({document: d.document, window: d.window, URL, Intl, Date, Event: FixtureEvent,
        console: {error: (...args) => errors.push(args.map(String).join(' '))},
        localStorage: storage(local, 'local'), sessionStorage: storage(session, 'session'),
        setInterval: fn => { intervals.push(fn); return intervals.length; },
        setTimeout: fn => { queueMicrotask(fn); return 1; },
        alert: message => unexpected.push(`alert: ${message}`),
        fetch: async (url, config) => {
            const method = config.method || 'GET';
            const response = data => ({ok: true, status: 200, headers: {get: () => 'application/json'}, json: async () => structuredClone(data)});
            if (method === 'GET') {
                reads.push(url);
                if (url === '/sessions') return response([]);
                if (url === '/timer/status') {
                    const data = structuredClone(p.status), gate = p.nextStatusGate;
                    p.nextStatusGate = null;
                    if (gate) await gate.promise;
                    return response(data);
                }
            } else {
                const body = JSON.parse(config.body || 'null'); writes.push({method, url, body});
                if (method === 'POST' && url === '/idle/toggle') {
                    p.status.idle_detection_enabled = body.enabled;
                    return response({idle_detection_enabled: body.enabled});
                }
                if (method === 'POST' && url === '/idle/resolve') {
                    if (p.postGate) await p.postGate.promise;
                    p.status = stopped();
                    return response({status: 'success', option_applied: body.option});
                }
            }
            unexpected.push(`${method} ${url}`);
            throw Error(`unexpected fake HTTP boundary: ${method} ${url}`);
        }});
    d.bind(context);
    p.run = code => vm.runInContext(code, context);
    // Exact relative registration order on Dashboard; entire scripts, no extracted handlers.
    for (const file of ['api_client.js', 'utils.js', 'timer_control.js', 'settings.js']) {
        vm.runInContext(read(`static/js/${file}`), context, {filename: file});
    }
    p.el = id => { const node = d.document.getElementById(id); assert.ok(node, `actual template #${id}`); return node; };
    p.hidden = id => p.el(id).classList.contains('hidden');
    p.key = (target, key, options = {}) => {
        const event = new FixtureEvent('keydown', {bubbles: true, cancelable: true, key, ...options});
        target.dispatchEvent(event); return event;
    };
    p.button = (id, onclick) => {
        const node = p.el(id).descendants().find(node => node.getAttribute('onclick') === onclick);
        assert.ok(node, `actual #${id} button ${onclick}`); return node;
    };
    p.pollGap = async () => { p.status = frozen(); await intervals[0](); };
    p.fields = () => [p.el('idle_retag_input').value, p.el('idle_retag_notes').value];
    p.type = (tags, notes) => {
        for (const [id, value] of [['idle_retag_input', tags], ['idle_retag_notes', notes]]) {
            const field = p.el(id); field.focus(); field.value = value;
            field.dispatchEvent(new FixtureEvent('input', {bubbles: true}));
        }
    };
    p.depart = () => p.run('followSettingsLink({})');
    p.dirty = () => p.run('hasSettingsDrafts()');
    p.observe = label => t.diagnostic(JSON.stringify({label, fields: p.fields(), dirty: p.dirty(),
        focus: d.document.activeElement.id || d.document.activeElement.tagName,
        recoveryHidden: p.hidden('idle_resolution_modal'), recurringHidden: p.hidden('recurring_delete_modal'),
        writes, storageWrites, confirmations, trace: d.trace.filter(item => item.endsWith(':keydown'))}));
    t.after(() => { assert.deepEqual(unexpected, [], 'no unsupported boundary/setup seam'); assert.deepEqual(errors, [], 'no swallowed source errors'); });
    d.document.dispatchEvent(new FixtureEvent('DOMContentLoaded', {bubbles: true}));
    await tick();
    assert.equal(intervals.length, 1);
    assert.equal(p.hidden('idle_resolution_modal'), true);
    assert.equal(p.hidden('settings_modal'), true);
    assert.deepEqual(writes, [], 'owner B: initial render never writes HTTP');
    storageWrites.length = 0; // exclude presentation's legacy slot-duration storage, not a tested action
    return p;
}

function openPreferences(p) {
    const button = p.document.descendants().find(node => node.getAttribute('onclick') === 'openSettingsModal()');
    assert.ok(button, 'real navbar Preferences launcher'); button.click();
    assert.equal(p.hidden('settings_modal'), false);
    p.el('setting_first_day').value = '0';
    p.el('setting_idle_detector').checked = true;
    assert.equal(p.dirty(), true, 'actual Preferences owner was initialized and is dirty');
}

async function recurringWithIncomingGap(p) {
    await p.run('promptDeleteSession("virt:01a1b22e-f818-70a6-a51c-e3f583bdec4b:20261101T100000")');
    assert.equal(p.hidden('recurring_delete_modal'), false, 'actual utils recurring prompt opens');
    const cancel = p.button('recurring_delete_modal', 'closeRecurringDeleteModal()');
    // The helper does not choose initial focus; model the user focusing its actual Close button.
    cancel.focus(); assert.equal(p.document.activeElement, cancel);
    await p.pollGap();
    return cancel;
}

test('C01 event adapter honors ancestry, phases, preventDefault and both propagation stops', () => {
    const d = dom(), field = new d.Node('textarea'), modal = new d.Node('section');
    d.document.body.append(modal); modal.append(field);
    const calls = [];
    for (const [node, name] of [[d.window, 'window'], [d.document, 'document'], [modal, 'modal'], [field, 'target']]) {
        node.addEventListener('keydown', e => calls.push(`${name}:${e.eventPhase}:capture`), true);
        node.addEventListener('keydown', e => calls.push(`${name}:${e.eventPhase}:bubble`));
    }
    field.dispatchEvent(new FixtureEvent('keydown', {bubbles: true}));
    assert.deepEqual(calls, ['window:1:capture', 'document:1:capture', 'modal:1:capture', 'target:2:capture',
        'target:2:bubble', 'modal:3:bubble', 'document:3:bubble', 'window:3:bubble']);
    calls.length = 0;
    modal.addEventListener('keydown', e => { e.preventDefault(); e.stopPropagation(); });
    modal.addEventListener('keydown', () => calls.push('same-node-after-stop'));
    const stoppedEvent = new FixtureEvent('keydown', {bubbles: true, cancelable: true});
    assert.equal(field.dispatchEvent(stoppedEvent), false);
    assert.equal(stoppedEvent.defaultPrevented, true);
    assert.equal(calls.at(-1), 'same-node-after-stop');
    assert.equal(calls.includes('document:3:bubble'), false);
    calls.length = 0;
    d.window.addEventListener('keydown', e => e.stopImmediatePropagation(), true);
    d.window.addEventListener('keydown', () => calls.push('forbidden'), true);
    field.dispatchEvent(new FixtureEvent('keydown', {bubbles: true}));
    assert.deepEqual(calls, ['window:1:capture']);
});

test('C02 ordinary Preferences-owned Ctrl+Enter explicitly saves browser fields and idle once', async t => {
    const p = await page(t); openPreferences(p);
    p.el('setting_first_day').focus();
    p.key(p.el('setting_first_day'), 'Enter', {ctrlKey: true}); await tick();
    assert.equal(JSON.parse(p.local.get('timetrace_user_settings')).firstDayOfWeek, 0);
    assert.equal(JSON.parse(p.local.get('timetrace_user_settings')).unknown, 'retain me');
    assert.equal(p.storageWrites.filter(write => write.key === 'timetrace_user_settings').length, 1);
    assert.deepEqual(p.writes, [{method: 'POST', url: '/idle/toggle', body: {enabled: true}}]);
    assert.equal(p.hidden('settings_modal'), true);
    assert.equal(p.dirty(), false);
});

test('R01 P1 Recovery Notes Ctrl+Enter must not save underlying dirty legacy Preferences', async t => {
    const p = await page(t); openPreferences(p);
    const before = p.local.get('timetrace_user_settings');
    await p.pollGap(); p.type('#retag', 'Recovery Notes\nnot a Preferences Save');
    assert.equal(p.hidden('settings_modal'), false);
    p.key(p.el('idle_retag_notes'), 'Enter', {ctrlKey: true}); await tick();
    p.observe('R01 first action result');
    assert.deepEqual({http: p.writes, storage: p.storageWrites}, {http: [], storage: []}, 'INTENDED RED R01: Recovery typing cannot save/toggle another owner');
    assert.equal(p.local.get('timetrace_user_settings'), before);
    assert.equal(p.el('setting_first_day').value, '0');
    assert.equal(p.el('setting_idle_detector').checked, true);
    assert.equal(p.hidden('settings_modal'), false);
    assert.equal(p.dirty(), true);
});

test('R02 P2 incoming Recovery must retain focus in the higher actual recurring-delete prompt', async t => {
    const p = await page(t), cancel = await recurringWithIncomingGap(p);
    p.observe('R02 first incoming poll');
    assert.equal(p.document.activeElement === cancel, true, 'INTENDED RED R02: higher z100 recurring-delete keeps its actual focus');
    assert.deepEqual(p.writes, []);
});

test('R03 P2 Escape cancels actual recurring-delete before closing Recovery; never DELETE/resolve/Start', async t => {
    const p = await page(t); await recurringWithIncomingGap(p);
    const recoveryWasOpen = !p.hidden('idle_resolution_modal');
    t.diagnostic(JSON.stringify({label: 'R03 pre-Escape visibility', recoveryWasOpen}));
    p.key(p.document.activeElement, 'Escape');
    p.observe('R03 first Escape result');
    assert.equal(p.hidden('recurring_delete_modal'), true, 'INTENDED RED R03: visible higher deletion prompt is canceled first');
    if (recoveryWasOpen) {
        assert.equal(p.hidden('idle_resolution_modal'), false);
    } else {
        assert.equal(p.hidden('timer_recovery_notice'), false);
        assert.equal(p.hidden('timer_recovery_open'), false);
        const launcher = p.el('timer_recovery_open');
        assert.notEqual(launcher.offsetParent, null);
        assert.equal(launcher.disabled, false);
        launcher.click();
        assert.equal(p.hidden('idle_resolution_modal'), false);
    }
    assert.deepEqual(p.writes, []);
    await p.run('confirmRecurringDelete("only_this")');
    assert.deepEqual(p.writes, [], 'Escape cleared the actual pending delete target');
});

test('C03 Recovery without confirmation owns Escape and restores the actual Review launcher', async t => {
    const p = await page(t), launcher = p.el('timer_recovery_open');
    p.status = frozen();
    // First read opens it; Close and explicit Review exercise both real template handlers.
    await p.intervals[0]();
    p.button('idle_resolution_modal', 'closeIdleResolution()').click();
    launcher.click();
    assert.equal(p.document.activeElement.id, 'idle_resolution_title');
    p.type('#retained', 'Escape retains this');
    const event = p.key(p.el('idle_retag_notes'), 'Escape');
    assert.equal(event.defaultPrevented, true);
    assert.equal(p.hidden('idle_resolution_modal'), true);
    assert.equal(p.document.activeElement, launcher);
    assert.deepEqual(p.fields(), ['#retained', 'Escape retains this']);
    assert.deepEqual(p.writes, []);
});

for (const kind of ['resize', 'custom']) test(`C04-${kind} actual higher confirmation consumes Escape before Recovery`, async t => {
    const p = await page(t); await p.pollGap();
    const pending = p.run(kind === 'resize' ? 'showRecurringResizeScopePrompt()' : 'showCustomConfirm("Delete", "Synthetic confirmation")');
    const cancel = p.el(kind === 'resize' ? 'recurring_resize_cancel_btn' : 'confirm_modal_cancel_btn');
    cancel.focus();
    p.key(cancel, 'Escape');
    assert.equal(await pending, kind === 'resize' ? null : false);
    assert.equal(p.hidden(kind === 'resize' ? 'recurring_resize_modal' : 'custom_confirm_modal'), true);
    assert.equal(p.hidden('idle_resolution_modal'), false);
    assert.deepEqual(p.writes, []);
});

for (const close of ['Close', 'Escape']) {
    test(`R04-${close} P2 hidden retained Recovery fields must remain visible to shared hasSettingsDrafts`, async t => {
        const p = await page(t); await p.pollGap();
        assert.equal(p.dirty(), false, 'opening clean recovery is not a draft');
        p.type('#draft', 'Unsubmitted recovery');
        if (close === 'Close') p.button('idle_resolution_modal', 'closeIdleResolution()').click();
        else p.key(p.el('idle_retag_notes'), 'Escape');
        assert.equal(p.hidden('idle_resolution_modal'), true);
        assert.deepEqual(p.fields(), ['#draft', 'Unsubmitted recovery']);
        assert.deepEqual(p.writes, []);
        p.observe(`R04-${close} hidden owner`);
        assert.equal(p.dirty(), true, `INTENDED RED R04-${close}: hidden retained retag fields need real owner registration`);
        assert.equal(p.depart(), false);
        assert.equal(p.confirmations.length, 1);
        assert.deepEqual(p.fields(), ['#draft', 'Unsubmitted recovery']);
    });
    test(`R05-${close} P2 actual Settings departure Cancel must protect the retained Recovery draft`, async t => {
        const p = await page(t); await p.pollGap(); p.type('#draft', 'Cancel departure retains me');
        if (close === 'Close') p.button('idle_resolution_modal', 'closeIdleResolution()').click();
        else p.key(p.el('idle_retag_notes'), 'Escape');
        const allowed = p.depart();
        p.observe(`R05-${close} first Settings departure`);
        assert.equal(allowed, false, `INTENDED RED R05-${close}: actual shared Settings caller must ask before leaving`);
        assert.equal(p.confirmations.length, 1);
        assert.deepEqual(p.fields(), ['#draft', 'Cancel departure retains me']);
        assert.deepEqual(p.writes, []);
        assert.equal(p.window.location.href, 'http://unit.invalid/dashboard');
    });
}

for (const stage of ['preflight', 'POST']) test(`R06-${stage} P2 ACK checkpoints captured retag only; newer enabled-input edits stay guarded`, async t => {
    const p = await page(t); await p.pollGap(); p.type('#submitted', 'Submitted Notes');
    const preflight = deferred(), ack = deferred(); p.postGate = ack;
    if (stage === 'preflight') p.nextStatusGate = preflight;
    p.button('idle_resolution_modal', "resolveIdleGap('re_tag')").click(); await tick();
    assert.equal(p.el('idle_retag_input').disabled, false);
    assert.equal(p.el('idle_retag_notes').disabled, false);
    assert.equal(p.button('idle_resolution_modal', "resolveIdleGap('re_tag')").disabled, true);
    assert.equal(p.writes.length, stage === 'preflight' ? 0 : 1);
    p.type('#newer', `Newer during ${stage}`);
    if (stage === 'preflight') { preflight.resolve(); await tick(); }
    assert.deepEqual(p.writes, [{method: 'POST', url: '/idle/resolve', body: {
        option: 're_tag', new_tags: '#submitted', new_notes: 'Submitted Notes'}}], 'payload was captured before either hold');
    ack.resolve(); await tick();
    assert.equal(p.hidden('idle_resolution_modal'), true);
    assert.deepEqual(p.fields(), ['#newer', `Newer during ${stage}`]);
    p.observe(`R06-${stage} first ACK result`);
    assert.equal(p.dirty(), true, `INTENDED RED R06-${stage}: ACK must not consume newer enabled-input edits`);
    assert.equal(p.depart(), false);
    p.type('#submitted', 'Submitted Notes');
    assert.equal(p.dirty(), false, 'ACK baseline is submitted fields, not current DOM or original empty fields');
    p.type('', '');
    assert.equal(p.dirty(), true, 'returning to old pre-submission baseline is now a new draft');
    assert.equal(p.writes.length, 1);
});

test('C05 clean Recovery, read-only Retry and untouched Close do not manufacture dirty state or writes', async t => {
    const p = await page(t); await p.pollGap();
    assert.equal(p.dirty(), false);
    p.button('idle_resolution_modal', 'retryTimerRead()').click(); await tick();
    p.button('idle_resolution_modal', 'closeIdleResolution()').click();
    await p.run('retryTimerRead()');
    assert.equal(p.hidden('idle_resolution_modal'), true, 'same dismissed gap is not reopened by Retry');
    assert.deepEqual(p.fields(), ['', '']);
    assert.equal(p.dirty(), false);
    assert.equal(p.depart(), true);
    assert.deepEqual(p.confirmations, []);
    assert.deepEqual(p.writes, []);
    assert.deepEqual(p.storageWrites, []);
});

test('C06 explicit retag ACK submits once, stays stopped and Retry never replays that write', async t => {
    const p = await page(t); await p.pollGap(); p.type('#submitted', 'Submitted Notes');
    p.button('idle_resolution_modal', "resolveIdleGap('re_tag')").click(); await tick();
    assert.deepEqual(p.writes, [{method: 'POST', url: '/idle/resolve', body: {
        option: 're_tag', new_tags: '#submitted', new_notes: 'Submitted Notes'}}]);
    assert.equal(p.hidden('idle_resolution_modal'), true);
    assert.equal(p.status.is_running, false);
    await p.run('retryTimerRead()');
    assert.equal(p.writes.length, 1);
    assert.equal(p.dirty(), false);
    assert.equal(p.depart(), true);
    assert.deepEqual(p.confirmations, []);
    // Clean-after-ACK alone is not registration proof: R04/R05/R06 independently require that owner.
});

// Same public modal/poll seam as C04, but confirmation is already open when Recovery arrives.
// These adapters do not replace confirmation, focus, Escape, timer or draft implementations.
for (const kind of ['custom', 'resize']) test(`R07-${kind} incoming Recovery yields focus and Escape to an existing higher confirmation`, async t => {
    const p = await page(t);
    const modal = kind === 'resize' ? 'recurring_resize_modal' : 'custom_confirm_modal';
    const pending = p.run(kind === 'resize' ? 'showRecurringResizeScopePrompt()' : 'showCustomConfirm("Delete Session Log", "Delete this scheduled session?")');
    assert.equal(p.hidden(modal), false);
    const cancel = p.el(kind === 'resize' ? 'recurring_resize_cancel_btn' : 'confirm_modal_cancel_btn');
    cancel.focus();
    assert.equal(p.document.activeElement, cancel);
    await p.pollGap();
    p.observe(`R07-${kind} incoming Recovery while confirmation is open`);
    assert.equal(p.document.activeElement === cancel, true, `INTENDED RED R07-${kind}: incoming Recovery cannot take focus from higher confirmation`);
    assert.equal(p.hidden('idle_resolution_modal'), false, 'Recovery may open below the higher prompt');
    const event = p.key(cancel, 'Escape');
    assert.equal(await pending, kind === 'resize' ? null : false);
    assert.equal(event.defaultPrevented, true);
    assert.equal(p.hidden(modal), true, 'only the higher confirmation is canceled');
    assert.equal(p.hidden('idle_resolution_modal'), false, 'same Escape cannot dismiss Recovery as well');
    assert.deepEqual(p.writes, [], 'no deletion, resolution, timer or idle write');
    assert.deepEqual(p.storageWrites, [], 'no Preferences persistence');
});
