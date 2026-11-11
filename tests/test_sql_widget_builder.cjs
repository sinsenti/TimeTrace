const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const tick = () => new Promise(setImmediate);
const deferred = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};

// Owned DOM adapter: actual template descendants, native select selectedness and bubbling.
// No builder, draft, save or preview business handlers are replaced.
function browser(preview) {
    let context;
    const events = new Map();
    const document = { activeElement: null };
    class Element {
        constructor(tag) {
            this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
            this.dataset = {}; this.listeners = {}; this.type = ''; this.disabled = false;
            this.id = ''; this.className = ''; this._value = ''; this._text = '';
        }
        get classList() {
            const el = this;
            return {
                contains: c => el.className.split(/\s+/).includes(c),
                add: (...cs) => { el.className = [...new Set([...el.className.split(/\s+/), ...cs])].join(' '); },
                remove: (...cs) => { el.className = el.className.split(/\s+/).filter(c => !cs.includes(c)).join(' '); },
                toggle(c, on = !this.contains(c)) { on ? this.add(c) : this.remove(c); }
            };
        }
        appendChild(child) {
            const hasSelection = this.tagName === 'SELECT' && this.options.some(o => o.selected);
            this.children.push(child); child.parentNode = this;
            if (this.tagName === 'SELECT') {
                if (!hasSelection && !child.selected) child.selected = true;
                if (child.selected) this.options.forEach(o => { if (o !== child) o.selected = false; });
            }
            return child;
        }
        get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
        get value() { return this.tagName === 'SELECT' ? this.options.find(o => o.selected)?.value || '' : this._value; }
        set value(value) {
            if (this.tagName === 'SELECT') this.options.forEach(o => { o.selected = o.value === String(value); });
            else this._value = String(value);
        }
        set innerHTML(value) { assert.equal(value, '', 'adapter only supports clearing HTML'); this.children = []; this._text = ''; }
        get textContent() { return this._text + this.children.map(c => c.textContent).join(' '); }
        set textContent(value) { this._text = String(value); this.children = []; }
        get innerText() { return this.textContent; }
        set innerText(value) { this.textContent = value; }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return this.attributes[name] ?? null; }
        contains(el) { return this === el || this.children.some(c => c.contains(el)); }
        get isConnected() { return document.body.contains(this); }
        getClientRects() { return this.classList.contains('hidden') ? [] : (this.parentNode ? this.parentNode.getClientRects() : [{}]); }
        focus() { document.activeElement = this; }
        getContext() { return { canvas: this }; }
        replaceWith(el) {
            const index = this.parentNode.children.indexOf(this);
            this.parentNode.children[index] = el; el.parentNode = this.parentNode;
        }
        addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
        dispatchEvent(event) {
            event.target ||= this;
            this.listeners[event.type]?.forEach(fn => fn(event));
            const inline = this.attributes['on' + event.type];
            if (inline) vm.runInContext(inline, context);
            if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event);
        }
        querySelectorAll(selector) {
            const descendants = this.children.flatMap(c => [c, ...c.querySelectorAll('*')]);
            return descendants.filter(el => selector.split(',').some(s => {
                s = s.trim();
                if (s === '*') return true;
                if (s.includes(' ')) {
                    const [ancestor, child] = s.split(/\s+/, 2);
                    return el.matches(child) && descendants.some(a => a.matches(ancestor) && a !== el && a.contains(el));
                }
                return el.matches(s);
            }));
        }
        matches(s) {
            if (s.includes(':not')) return !this.disabled && this.matches(s.split(':')[0]);
            if (s.startsWith('#')) return this.id === s.slice(1);
            if (s.startsWith('.')) return this.classList.contains(s.slice(1));
            if (s === '[data-widget-id]') return !!this.dataset.widgetId;
            return this.tagName.toLowerCase() === s;
        }
        querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    }
    document.body = new Element('body'); document.activeElement = document.body;
    document.documentElement = new Element('html');
    document.createElement = tag => new Element(tag);
    document.querySelectorAll = s => document.body.querySelectorAll(s);
    document.querySelector = s => document.body.querySelector(s);
    document.getElementById = id => document.querySelector('#' + id);
    document.addEventListener = (name, fn) => { (events.get(name) || events.set(name, []).get(name)).push(fn); };
    const template = fs.readFileSync(path.join(js, '../../templates/components/widget_builder_modal.html'), 'utf8');
    const stack = [document.body];
    for (const [token] of template.matchAll(/<!--[^]*?-->|<\/?[a-z][^>]*>|[^<]+/gi)) {
        if (token.startsWith('<!--') || !token.startsWith('<')) continue;
        if (token.startsWith('</')) { stack.pop(); continue; }
        const tag = token.match(/^<(\w+)/)[1].toLowerCase();
        const el = new Element(tag);
        for (const [, name, value] of token.matchAll(/([\w-]+)="([^"]*)"/g)) {
            el.setAttribute(name, value);
            if (['id', 'class', 'type', 'value'].includes(name)) el[name === 'class' ? 'className' : name] = value;
        }
        el.selected = /\sselected(?:\s|>)/.test(token);
        stack.at(-1).appendChild(el);
        if (!['input', 'br', 'hr'].includes(tag)) stack.push(el);
    }
    for (const id of ['widget_grid', 'dashboard_tabs', 'dashboard_notice', 'legacy_notice', 'reset_dashboard_btn', 'dashboard_title']) {
        const el = new Element('div'); el.id = id; document.body.appendChild(el);
    }
    const boardId = '00000000-0000-7000-8000-000000000013';
    const widgetId = '00000000-0000-7000-8000-000000000014';
    let saved = { id: widgetId, dashboard_id: boardId, title: 'Saved SQL', width: 'half', spec: {
        mode: 'sql', sql: { sql: 'SELECT title, 3 AS amount FROM task', limit: 200, chart: 'bar', label_column: 'title', value_column: 'amount' }
    } };
    const board = () => ({ id: boardId, name: 'Synthetic board', slug: 'synthetic', widgets: [saved] });
    const requests = [], fixtureErrors = [], charts = [], alerts = [];
    let sqlCalls = 0;
    const responseA = { columns: ['title', 'amount'], rows: [['A', 3]], row_count: 1, truncated: false, elapsed_ms: 7, warnings: [] };
    const storage = new Map();
    context = vm.createContext({ document, Intl, Event, console, setTimeout, clearTimeout,
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
        window: { addEventListener() {}, location: { href: 'http://synthetic/stats' } },
        getComputedStyle: () => ({ getPropertyValue: () => '#777777' }),
        alert: message => alerts.push(message), confirm: () => true,
        Chart: class { constructor(canvas, config) { charts.push(config); } destroy() {} },
        fetch: async (url, options) => {
            const body = options.body ? JSON.parse(options.body) : null;
            requests.push({ url, method: options.method, body });
            let result;
            if (url === '/analytics/capabilities') result = { sql_enabled: true, sources: [{ source: 'tasks', measures: [{ value: 'task_count', label: 'Tasks' }], dimensions: [], filter_fields: [] }] };
            else if (url === '/analytics/sql/schema') result = { tables: [{ name: 'task', columns: [{ name: 'title' }] }] };
            else if (url === '/analytics/sql') result = ++sqlCalls === 1 ? responseA : await preview(body, sqlCalls - 1);
            else if (url === '/api/dashboards') result = [board()];
            else if (url === `/api/dashboards/${boardId}`) result = board();
            else if (url === `/api/dashboards/${boardId}/widgets/${widgetId}` && options.method === 'PUT') {
                saved = { ...saved, ...body }; result = saved;
            } else {
                fixtureErrors.push(`${options.method} ${url}`);
                throw Error('Unexpected fixture request: ' + url);
            }
            return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => structuredClone(result) };
        }
    });
    for (const file of ['api_client.js', 'settings.js', 'dashboards.js', 'widget_builder.js']) {
        vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), context, { filename: file });
    }
    const run = code => vm.runInContext(code, context);
    return { run, document, requests, responseA, charts, alerts, boardId, widgetId,
        el: id => document.getElementById(id),
        async load() { await run('loadDashboards()'); await tick(); run('setupWidgetBuilderKeyboard()'); this.check(); },
        async open() { await run(`openWidgetEditor('${boardId}', '${widgetId}')`); await tick(); this.check(); },
        check() { assert.deepEqual(fixtureErrors, []); assert.deepEqual(alerts, []); },
        change(id, value, type = 'input') { const el = this.el(id); el.value = value; el.dispatchEvent({ type, bubbles: true }); },
        writes() { return requests.filter(r => r.url.includes('/widgets') && ['PUT', 'POST'].includes(r.method)); }
    };
}

for (const rejected of [false, true]) test(`G1 saved SQL columns survive title Save with ${rejected ? 'rejected' : 'held'} automatic preview`, async t => {
    const held = deferred();
    const b = browser(() => held.promise);
    t.after(async () => { held.resolve(b.responseA); await tick(); });
    await b.load(); await b.open();
    if (rejected) { held.resolve(Promise.reject(Error('Synthetic preview unavailable'))); await tick(); }
    b.change('wb_title', 'Title-only edit');
    assert.equal(b.el('wb_submit').disabled, false, 'faithfully initialized saved editor allows title Save');
    await b.run('submitWidgetBuilder()'); b.check();
    const write = b.writes()[0];
    assert.ok(write, 'explicit Save writes once');
    assert.equal(b.writes().length, 1);
    assert.equal(write.body.title, 'Title-only edit');
    assert.equal(write.body.spec.sql.sql, 'SELECT title, 3 AS amount FROM task');
    assert.deepEqual([write.body.spec.sql.label_column, write.body.spec.sql.value_column], ['title', 'amount']);
});

function honestPreview(b) {
    return b.el('wb_sql_preview').classList.contains('hidden') ||
        /outdated|stale|inputs changed|run.*preview.*update|previous result/i.test(b.el('wb_pane_sql').textContent);
}

for (const [field, value, event] of [
    ['wb_sql', 'SELECT title, 4 AS amount FROM task', 'input'],
    ['wb_sql_limit', '10', 'input'],
    ['wb_sql_chart', 'line', 'change']
]) test(`G3 ${field} edit marks completed SQL preview outdated before another read`, async () => {
    const b = browser(async () => b.responseA);
    await b.load(); await b.open();
    assert.equal(b.el('wb_sql_preview').classList.contains('hidden'), false);
    assert.match(b.el('wb_sql_meta').textContent, /1 row\(s\) in 7ms/);
    const reads = b.requests.length;
    b.change(field, value, event); b.check();
    assert.equal(b.el(field).value, value);
    assert.equal(b.requests.length, reads, 'editing must not trigger implicit reads or writes');
    assert.equal(b.writes().length, 0);
    assert.equal(honestPreview(b), true, 'old A table/meta must be hidden or explicitly outdated for changed SQL draft');
});

test('G3 failed SQL preview B cannot leave A looking current; B draft is retained', async () => {
    let fail = false;
    const b = browser(async () => { if (fail) throw Error('Synthetic B rejected'); return b.responseA; });
    await b.load(); await b.open();
    b.change('wb_sql', 'SELECT title, 4 AS amount FROM task'); fail = true;
    await b.run('wbRunSqlPreview()'); b.check();
    assert.match(b.el('wb_error').textContent, /Synthetic B rejected/);
    assert.equal(b.el('wb_sql').value, 'SELECT title, 4 AS amount FROM task');
    assert.equal(b.writes().length, 0);
    assert.equal(honestPreview(b), true, 'failed B must hide or label previous A table, not leave it current-looking');
});

test('control: older SQL response cannot replace a newer preview or a reopened owner', async () => {
    const old = deferred(); let hold = false;
    const b = browser(async () => hold ? old.promise : { ...b.responseA, rows: [['newer', 4]] });
    await b.load(); await b.open(); hold = true;
    const pending = b.run('wbRunSqlPreview()'); await tick(); hold = false;
    await b.run('wbRunSqlPreview()');
    b.run('closeWidgetBuilder()'); await b.open();
    b.change('wb_title', 'New owner draft');
    old.resolve({ ...b.responseA, rows: [['obsolete', 999]] }); await pending; b.check();
    assert.doesNotMatch(b.el('wb_sql_preview_body').textContent, /obsolete|999/);
    assert.match(b.el('wb_sql_preview_body').textContent, /newer/);
    assert.equal(b.el('wb_title').value, 'New owner draft');
    assert.equal(b.writes().length, 0);
});

test('control: preview metadata preserves concurrent column choices and title drafts', async () => {
    const held = deferred(); let hold = false;
    const b = browser(async () => hold ? held.promise : b.responseA);
    await b.load(); await b.open(); hold = true;
    const pending = b.run('wbRunSqlPreview()'); await tick();
    b.change('wb_sql_label_column', 'amount', 'change');
    b.change('wb_sql_value_column', 'title', 'change');
    b.change('wb_title', 'Concurrent title draft');
    held.resolve(b.responseA); await pending; b.check();
    assert.equal(b.el('wb_sql_label_column').value, 'amount');
    assert.equal(b.el('wb_sql_value_column').value, 'title');
    assert.equal(b.el('wb_title').value, 'Concurrent title draft');
    assert.equal(b.run("hasSettingsDrafts(['widget_builder_modal'])"), true);
    assert.equal(b.writes().length, 0);
});
