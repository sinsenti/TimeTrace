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
function browser(preview, confirmDecision = () => true, capabilityRead = null) {
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
            if (s === 'a[href]') return this.tagName === 'A' && this.getAttribute('href') !== null;
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
    const confirmations = [];
    const confirmDialog = message => { confirmations.push(message); return confirmDecision(message); };
    context = vm.createContext({ document, Intl, Event, URL, console, setTimeout, clearTimeout,
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
        window: { addEventListener() {}, location: { href: 'http://synthetic/stats' }, confirm: confirmDialog },
        getComputedStyle: () => ({ getPropertyValue: () => '#777777' }),
        alert: message => alerts.push(message), confirm: confirmDialog,
        Chart: class { constructor(canvas, config) { charts.push(config); } destroy() {} },
        fetch: async (url, options) => {
            const body = options.body ? JSON.parse(options.body) : null;
            requests.push({ url, method: options.method, body });
            let result;
            if (url === '/analytics/capabilities') result = capabilityRead ? await capabilityRead() : { sql_enabled: true, sources: [{ source: 'tasks', measures: [{ value: 'task_count', label: 'Tasks' }], dimensions: [], filter_fields: [] }, { source: 'sessions', measures: [{ value: 'sum_duration', label: 'Duration' }], dimensions: [{ value: 'day', label: 'Day' }], filter_fields: [{ value: 'session_time_relative', label: 'Session time', ops: ['eq'], value_type: 'enum', values: [{ value: 'past', label: 'Past' }] }] }] };
            else if (url === '/analytics/sql/schema') result = { tables: [{ name: 'task', columns: [{ name: 'title' }] }] };
            else if (url === '/analytics/sql') result = ++sqlCalls === 1 ? responseA : await preview(body, sqlCalls - 1);
            else if (url === '/api/dashboards') result = [board()];
            else if (url === `/api/dashboards/${boardId}`) result = board();
            else if (url === `/api/dashboards/${boardId}/widgets` && options.method === 'POST') { saved = { ...saved, ...body }; result = saved; }
            else if (url === '/analytics/query') result = { columns: [{ key: 'value', unit: 'hours' }], rows: [], total: 0, meta: {}, warnings: [] };
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
    return { run, document, requests, responseA, charts, alerts, boardId, widgetId, confirmations,
        el: id => document.getElementById(id),
        setSaved: widget => { saved = { ...saved, ...widget }; },
        async load() { await run('loadDashboards()'); await tick(); run('setupWidgetBuilderKeyboard()'); this.check(); },
        async open() { await run(`openWidgetEditor('${boardId}', '${widgetId}')`); await tick(); this.check(); },
        check() { assert.deepEqual(fixtureErrors, []); assert.deepEqual(alerts, []); },
        change(id, value, type = 'input') { const el = this.el(id); el.value = value; el.dispatchEvent({ type, bubbles: true }); },
        writes() { return requests.filter(r => r.url.includes('/widgets') && ['PUT', 'POST'].includes(r.method)); }
    };
}

const preset = { title: 'Performed time by day', width: 'half', query: {
    source: 'sessions', measure: 'sum_duration', group_by: ['day'], chart: 'line', sort: 'dimension_asc',
    fill_gaps: true, limit: 200, date_range: { preset: 'last_14_days', start_date: null, end_date: null },
    tag_attribution: 'fan_out', comparison: { mode: 'previous_period', start_date: null, end_date: null },
    filters: [{ field: 'session_time_relative', op: 'eq', values: ['past'] }]
} };
function setPreset(b) {
    const el = b.document.createElement('script'); el.id = 'performed_time_preset';
    el.textContent = JSON.stringify(preset); b.document.body.appendChild(el);
}

test('performed recreation is an editable unsaved draft; Cancel writes and previews nothing', async () => {
    const b = browser(async () => b.responseA); await b.load(); setPreset(b);
    const before = b.requests.length;
    await b.run('openPerformedTimePreset()');
    for (const [field, value] of Object.entries({ wb_title: preset.title, wb_source: 'sessions',
        wb_measure: 'sum_duration', wb_group_by_1: 'day', wb_chart: 'line', wb_date_range: 'last_14_days',
        wb_filter_field: 'session_time_relative', wb_filter_op: 'eq', wb_filter_value: '["past"]',
        wb_comparison: 'previous_period', wb_sort: 'dimension_asc', wb_tag_attribution: 'fan_out' })) {
        assert.equal(b.el(field).value, value, field);
    }
    assert.equal(b.el('wb_fill_gaps').checked, true);
    b.change('wb_title', 'My performed work');
    b.run('closeWidgetBuilder()');
    assert.equal(b.writes().length, 0);
    assert.equal(b.requests.slice(before).some(r => r.url === '/analytics/query'), false);
    assert.equal(b.el('widget_builder_modal').classList.contains('hidden'), true);
});

test('performed recreation Save, edit and reopen retain full query and custom title', async () => {
    const b = browser(async () => b.responseA); await b.load(); setPreset(b);
    await b.run('openPerformedTimePreset()'); b.change('wb_title', 'My performed work');
    await b.run('submitWidgetBuilder()'); await tick();
    assert.equal(b.writes().length, 1);
    const created = b.writes()[0];
    assert.equal(created.method, 'POST'); assert.equal(created.body.title, 'My performed work');
    assert.deepEqual(created.body.spec.query, preset.query);
    await b.open(); assert.equal(b.el('wb_title').value, 'My performed work');
    assert.equal(b.el('wb_filter_value').value, '["past"]');
    b.change('wb_width', 'full', 'change'); await b.run('submitWidgetBuilder()'); await tick();
    await b.open(); assert.equal(b.el('wb_width').value, 'full');
    assert.deepEqual(b.writes()[1].body.spec.query, preset.query);
});

test('capability failure leaves performed preset unsaved and builder closed', async () => {
    const b = browser(async () => b.responseA, () => true, async () => { throw Error('offline'); });
    setPreset(b); await b.run('openPerformedTimePreset()');
    assert.equal(b.el('widget_builder_modal').classList.contains('hidden'), true);
    assert.match(b.alerts[0], /capabilities/); assert.equal(b.writes().length, 0);
});

test('late preset capabilities cannot reopen after Cancel or dashboard selection changes', async () => {
    for (const cancel of [true, false]) {
        const held = deferred(); const b = browser(async () => b.responseA, () => true, () => held.promise);
        setPreset(b); const pending = b.run('openPerformedTimePreset()'); await tick();
        if (cancel) b.run('closeWidgetBuilder()'); else b.run("currentDashboardId = 'different-dashboard'");
        held.resolve({ sql_enabled: false, sources: [] }); await pending;
        assert.equal(b.el('widget_builder_modal').classList.contains('hidden'), true);
        assert.equal(b.writes().length, 0);
    }
});

test('old seed labels are aliases only; custom seed and unseeded titles survive', async () => {
    for (const [seed_key, title, expected] of [
        ['total_time', 'Total Time Logged', 'Recorded session time'],
        ['total_sessions', 'Logged Sessions', 'Recorded sessions'],
        ['total_time', 'My work budget', 'My work budget'],
        [null, 'Total Time Logged', 'Total Time Logged']
    ]) {
        const b = browser(async () => b.responseA);
        b.setSaved({ seed_key, title, spec: { mode: 'structured', query: { source: 'sessions', measure: 'sum_duration', chart: 'tile' } } });
        await b.load();
        assert.match(b.el('widget_grid').textContent, new RegExp(expected));
        await b.open(); assert.equal(b.el('wb_title').value, title, 'stored editable title remains unchanged');
        assert.equal(b.writes().length, 0);
    }
});

test('existing SQL editor remains SQL with its saved columns after preset Cancel', async () => {
    const b = browser(async () => b.responseA); await b.load(); setPreset(b);
    await b.run('openPerformedTimePreset()'); b.run('closeWidgetBuilder()'); await b.open();
    assert.equal(b.el('wb_sql').value, 'SELECT title, 3 AS amount FROM task');
    assert.equal(b.el('wb_sql_label_column').value, 'title');
    assert.equal(b.el('wb_pane_sql').classList.contains('hidden'), false);
    assert.equal(b.writes().length, 0);
});

test('recorded scope explanation follows unchanged query scope and preserves customized seed queries', async () => {
    const original = { source: 'sessions', measure: 'sum_duration', chart: 'tile', group_by: [], filters: [],
        date_range: { preset: 'all_time' } };
    const explanation = 'Includes past and future recorded rows, not only performed work.';
    for (const [label, changes, shouldExplain] of [
        ['original', {}, true],
        ['past-only', { filters: [{ field: 'session_time_relative', op: 'eq', values: ['past'] }] }, false],
        ['future-only', { filters: [{ field: 'session_time_relative', op: 'eq', values: ['future'] }] }, false],
        ['different source', { source: 'tasks', measure: 'task_count' }, false],
        ['past range', { date_range: { preset: 'yesterday' } }, false],
        ['different measure', { measure: 'avg_session_length' }, false]
    ]) {
        const b = browser(async () => b.responseA);
        const query = { ...original, ...changes }, title = `Custom ${label} metric`;
        b.setSaved({ seed_key: 'total_time', title, spec: { mode: 'structured', query } });
        await b.load();
        assert.equal(b.el('widget_grid').textContent.includes(explanation), shouldExplain, label);
        assert.ok(b.el('widget_grid').textContent.includes(title), 'custom title remains intact');
        await b.open();
        assert.equal(b.el('wb_source').value, query.source);
        assert.equal(b.el('wb_measure').value, query.measure);
        assert.equal(b.el('wb_date_range').value, query.date_range.preset);
        if (query.filters.length) assert.equal(b.el('wb_filter_value').value, JSON.stringify(query.filters[0].values));
        assert.equal(b.writes().length, 0, 'render/open never rewrites the customized query');
    }
});
