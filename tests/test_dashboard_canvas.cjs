const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');

class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.className = ''; this.dataset = {}; this.attributes = {}; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    replaceWith(child) { const i = this.parentNode.children.indexOf(this); this.parentNode.children[i] = child; child.parentNode = this.parentNode; }
    set innerHTML(value) { assert.equal(value, ''); this.children = []; this._text = ''; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return (this._text || '') + this.children.map(c => c.textContent).join(' '); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    get classList() { return { add: c => this.className += ' ' + c, toggle: () => {} }; }
    focus() { this.focused = true; }
    getContext() { return { canvas: this }; }
}
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const spec = { mode: 'structured', query: { source: 'sessions', measure: 'session_count', chart: 'tile' } };
const result = total => ({ columns: [{ unit: 'count' }], rows: [], total, meta: {} });
function dashboard(id, widgets = []) { return { id, name: id, slug: id, is_seeded: false, widgets }; }
function widget(id, dashboardId = 'one') { return { id, dashboard_id: dashboardId, title: id, width: 'half', spec }; }
function browser(handler, storage = new Map()) {
    const elements = Object.fromEntries(['widget_grid', 'dashboard_tabs', 'dashboard_notice', 'legacy_notice', 'reset_dashboard_btn', 'dashboard_title'].map(id => [id, new Element()]));
    const requests = [], alerts = [], prompts = [];
    const context = vm.createContext({
        document: { createElement: tag => new Element(tag), getElementById: id => elements[id] || null, addEventListener() {} },
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
        fetch: async (url, options) => {
            const body = options.body ? JSON.parse(options.body) : null;
            requests.push({ url, method: options.method, body });
            const value = await handler(url, options.method, body);
            return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => structuredClone(value) };
        },
        console: { error() {}, info() {} }, prompt: () => prompts.shift(), confirm: () => true, alert: text => alerts.push(text),
        getQueryContext: () => ({ timezone: 'UTC', first_day_of_week: 1 }), applyChartAppearance() {}
    });
    for (const file of ['api_client.js', 'dashboards.js']) vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), context);
    const run = code => vm.runInContext(code, context);
    const buttons = (root = elements.widget_grid) => root.children.flatMap(c => [c, ...buttons(c)]).filter(c => c.tagName === 'button');
    return { run, elements, storage, requests, alerts, prompts, buttons, context };
}

test('tile cards use the shared content band and canvas rows stretch without fixed row heights', () => {
    const b = browser(async () => []);
    const card = b.run("renderTileWidget({ title: 'Tasks', seed_key: 'total_sessions', spec: { mode: 'structured', query: {} } }, { columns: [{ unit: 'count' }], rows: [], total: 4 }, { widgets: [], results: {} }, { accent: 'emerald', badge: 'SESSIONS' })");
    assert.match(card.children[0].className, /widget-tile-content/);
    assert.match(card.children[0].children[0].className, /widget-tile-label/);
    assert.equal(card.children[0].children[0].textContent, 'SESSIONS');
    const css = fs.readFileSync(path.join(__dirname, '../src/timetrace/interfaces/api/static/css/dashboard_canvas.css'), 'utf8');
    const template = fs.readFileSync(path.join(__dirname, '../src/timetrace/interfaces/api/templates/stats.html'), 'utf8');
    assert.match(css, /\.canvas-grid\s*\{[^}]*align-items:\s*stretch/s);
    assert.match(css, /\.widget-card\s*\{[^}]*align-self:\s*stretch/s);
    assert.match(css, /\.widget-tile-label\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(css, /\.canvas-tab\[aria-current="page"\]\s*\{[^}]*color:\s*var\(--text-main\)[^}]*background:\s*var\(--bg-card\)/s);
    assert.doesNotMatch(css, /grid-auto-rows\s*:/);
    assert.match(template, /dashboard_canvas\.css\?v=ui-review2-1/);
    assert.match(template, /dashboards\.js\?v=ui-review2-1/);
});

test('selected dashboard tab uses a neutral themed active class and preserves the saved name', () => {
    const b = browser(async () => []);
    b.run("dashboardList = [{id:'overview', name:'Overview'}, {id:'custom', name:'Custom Report'}]; currentDashboardId = 'overview'; renderDashboardTabs()");
    const [selected, other] = b.elements.dashboard_tabs.children;
    assert.match(selected.className, /canvas-tab-active/);
    assert.equal(selected.textContent, 'Overview');
    assert.equal(selected.attributes['aria-current'], 'page');
    assert.doesNotMatch(selected.className, /purple/);
    assert.equal(other.textContent, 'Custom Report');
    assert.equal(other.attributes['aria-current'], 'false');
});

test('cards load independently and Retry reads only the failed card with query context', async () => {
    const held = deferred(); let fails = true;
    const one = dashboard('one', [widget('healthy'), { ...widget('broken'), spec: { ...spec, query: { ...spec.query, measure: 'sum_duration' } } }]);
    const b = browser(async (url, method, body) => {
        if (url === '/api/dashboards') return [one];
        if (url === '/api/dashboards/one') return one;
        if (url.endsWith('/data')) return { dashboard: one, widgets: one.widgets, results: { healthy: result(3) }, sql_results: {}, errors: { broken: 'Unavailable' } };
        if (body.query.measure === 'session_count') return held.promise;
        if (fails) throw Error('Unavailable');
        return result(8);
    });
    await b.run('loadDashboards()'); await tick();
    assert.match(b.elements.widget_grid.textContent, /Loading/);
    assert.match(b.elements.widget_grid.textContent, /Unavailable/);
    assert.ok(b.buttons().find(c => c.textContent === 'Retry'));
    held.resolve(result(3)); await tick();
    assert.match(b.elements.widget_grid.textContent, /3/);
    fails = false;
    b.buttons().find(c => c.textContent === 'Retry').onclick(); await tick();
    assert.match(b.elements.widget_grid.textContent, /8/);
    assert.equal(b.requests.filter(r => r.body?.query?.measure === 'session_count').length, 1);
    assert.equal(b.requests.filter(r => r.body?.query?.measure === 'sum_duration').length, 2);
    assert.equal(b.requests.at(-1).body.timezone, 'UTC');
    assert.equal(b.requests.at(-1).body.first_day_of_week, 1);
});

test('named create/rename/reorder/remove persist through public callers and reload', async () => {
    const rows = new Map([['one', dashboard('one')]]);
    const b = browser(async (url, method, body) => {
        const parts = url.split('/'); const id = parts[3], row = rows.get(id);
        if (url === '/analytics/query') return result(2);
        if (url === '/api/dashboards') {
            if (method === 'POST') { const created = dashboard('named', [widget('a', 'named'), widget('b', 'named')]); created.name = body.name; rows.set('named', created); return created; }
            return [...rows.values()];
        }
        if (method === 'PUT') { row.name = body.name; return row; }
        if (parts.at(-1) === 'reorder') { row.widgets = body.widget_ids.map(id => row.widgets.find(w => w.id === id)); return row.widgets; }
        if (method === 'DELETE') { row.widgets = row.widgets.filter(w => w.id !== parts.at(-1)); return null; }
        return row;
    });
    await b.run('loadDashboards()'); b.prompts.push('My board'); await b.run('createDashboard()'); await tick();
    assert.equal(b.run('getCurrentDashboardId()'), 'named');
    b.prompts.push('Renamed'); await b.run('renameDashboard()');
    await b.run("moveWidget('b', -1)"); await tick();
    await b.run('reloadCurrentDashboard()'); await tick();
    assert.equal(b.run("getWidgetById('b').title"), 'b');
    assert.deepEqual(b.elements.widget_grid.children.map(c => c.dataset.widgetId), ['b', 'a']);
    await b.run("deleteWidget('a')"); await tick();
    await b.run('loadDashboards()'); await tick();
    assert.deepEqual(b.elements.widget_grid.children.map(c => c.dataset.widgetId), ['b']);
    assert.equal(rows.get('named').name, 'Renamed');
});

test('acknowledged create followed by failed list read stays Saved and refresh retry does not create again', async () => {
    let saved = false, failRead = false;
    const b = browser(async (url, method) => {
        if (url === '/api/dashboards' && method === 'POST') { saved = true; failRead = true; return dashboard('created'); }
        if (url === '/api/dashboards') { if (failRead) throw Error('Offline'); return saved ? [dashboard('one'), dashboard('created')] : [dashboard('one')]; }
        if (url === '/analytics/query') return result(1);
        return saved ? dashboard('created') : dashboard('one', [widget('stale')]);
    });
    await b.run('loadDashboards()'); b.prompts.push('Created'); await b.run('createDashboard()');
    assert.deepEqual(b.alerts, []);
    assert.equal(b.run("getWidgetById('stale')"), null);
    assert.doesNotMatch(b.elements.widget_grid.textContent, /stale/);
    assert.match(b.elements.dashboard_notice.textContent, /Saved/);
    assert.match(b.elements.dashboard_notice.textContent, /refresh/i);
    failRead = false;
    const retry = b.buttons(b.elements.dashboard_notice).find(c => c.textContent === 'Retry refresh');
    assert.ok(retry); await retry.onclick(); await tick();
    assert.equal(b.run('getCurrentDashboardId()'), 'created');
    assert.equal(b.requests.filter(r => r.method === 'POST' && r.url === '/api/dashboards').length, 1);
});

test('late dashboard detail and widget results cannot replace a newer selection or removed widget', async () => {
    const detail = deferred(), query = deferred(); let removed = false;
    const b = browser(async (url, method) => {
        if (url === '/api/dashboards') return [dashboard('one'), dashboard('two')];
        if (url === '/api/dashboards/one') return detail.promise;
        if (url === '/api/dashboards/two') return dashboard('two', removed ? [] : [widget('late', 'two')]);
        if (url === '/analytics/query') return query.promise;
        if (method === 'DELETE') { removed = true; return null; }
        throw Error(url);
    });
    const initial = b.run('loadDashboards()'); await tick();
    await b.run("switchDashboard('two')"); await tick();
    await b.run("deleteWidget('late')"); await tick();
    query.resolve(result(999)); detail.resolve(dashboard('one', [widget('old')])); await initial; await tick();
    assert.equal(b.run('getCurrentDashboardId()'), 'two');
    assert.equal(b.run("getWidgetById('late')"), null);
    assert.match(b.elements.widget_grid.textContent, /no widgets/);
    assert.doesNotMatch(b.elements.widget_grid.textContent, /999|old/);
});

test('partial legacy handoff preserves source and acknowledgements across reload without replay', async () => {
    const source = JSON.stringify([{ title: 'Imported', query: spec.query }, { title: 'Uncertain', query: spec.query }, { invalid: true }]);
    const storage = new Map([['tt_custom_widgets_v1', source]]); const imported = [];
    const handler = async (url, method, body) => {
        if (url === '/api/dashboards') return [dashboard('one')];
        if (method === 'POST' && url.endsWith('/widgets')) {
            imported.push(body.title);
            if (body.title === 'Uncertain') throw Error('Connection lost');
            return widget('legacy-' + imported.length);
        }
        return dashboard('one');
    };
    const b = browser(handler, storage); await b.run('loadDashboards()');
    assert.equal(storage.get('tt_custom_widgets_v1'), source);
    assert.match(b.elements.legacy_notice.textContent, /uncertain/i);
    const reload = browser(handler, storage); await reload.run('loadDashboards()');
    assert.deepEqual(imported, ['Imported', 'Uncertain']);
    assert.match(reload.elements.legacy_notice.textContent, /source|original/i);
    assert.ok(reload.buttons(reload.elements.legacy_notice).find(c => /Retry uncertain/.test(c.textContent)));
});

test('successful legacy import is archived once and malformed sources never disappear', async () => {
    for (const raw of ['{bad', '{}', JSON.stringify([{ title: '<literal>', query: spec.query }])]) {
        const storage = new Map([['tt_custom_widgets_v1', raw]]); let writes = 0;
        const handler = async (url, method) => {
            if (url === '/api/dashboards') return [dashboard('one')];
            if (method === 'POST') { writes++; return widget('imported'); }
            return dashboard('one');
        };
        await browser(handler, storage).run('loadDashboards()');
        await browser(handler, storage).run('loadDashboards()');
        const valid = raw.startsWith('[');
        assert.equal(writes, valid ? 1 : 0);
        assert.equal(storage.get(valid ? 'tt_custom_widgets_v1_migrated' : 'tt_custom_widgets_v1'), raw);
    }
});

test('explicit legacy retry skips acknowledged successes and completes only remaining items', async () => {
    const source = JSON.stringify([{ title: 'First', query: spec.query }, { title: 'Second', query: spec.query }]);
    const storage = new Map([['tt_custom_widgets_v1', source]]); const writes = []; let fail = true;
    const b = browser(async (url, method, body) => {
        if (url === '/api/dashboards') return [dashboard('one')];
        if (method === 'POST') {
            writes.push(body.title);
            if (body.title === 'Second' && fail) throw Error('Rejected');
            return widget('imported');
        }
        return dashboard('one');
    }, storage);
    await b.run('loadDashboards()'); fail = false;
    await b.buttons(b.elements.legacy_notice).find(c => c.textContent === 'Retry uncertain import').onclick();
    assert.deepEqual(writes, ['First', 'Second', 'Second']);
    assert.equal(storage.get('tt_custom_widgets_v1'), undefined);
    assert.equal(storage.get('tt_custom_widgets_v1_migrated'), source);
});

test('refresh/context ownership rejects old results even for the same dashboard and widget', async () => {
    const held = deferred(); let count = 0;
    const b = browser(async url => {
        if (url === '/api/dashboards') return [dashboard('one')];
        if (url === '/api/dashboards/one') return dashboard('one', [widget('same')]);
        return ++count === 1 ? held.promise : result(7);
    });
    await b.run('loadDashboards()'); await b.run('reloadCurrentDashboard()'); await tick();
    held.resolve(result(999)); await tick();
    assert.match(b.elements.widget_grid.textContent, /7/);
    assert.doesNotMatch(b.elements.widget_grid.textContent, /999/);
});

test('SQL cards use the existing SQL contract and isolate a disabled SQL error', async () => {
    const sql = { sql: 'SELECT 1 AS number', chart: 'table' };
    const b = browser(async (url) => {
        if (url === '/api/dashboards') return [dashboard('one')];
        if (url === '/api/dashboards/one') return dashboard('one', [widget('healthy'), { ...widget('sql'), spec: { mode: 'sql', sql } }]);
        if (url === '/analytics/sql') throw Error('SQL widgets disabled');
        return result(4);
    });
    await b.run('loadDashboards()'); await tick();
    assert.match(b.elements.widget_grid.textContent, /4/);
    assert.match(b.elements.widget_grid.textContent, /SQL widgets disabled/);
    assert.deepEqual(b.requests.find(r => r.url === '/analytics/sql').body, sql);
});

test('acknowledged rename/reset/delete followed by failed refresh never replay writes', async () => {
    for (const action of ['renameDashboard()', 'resetDashboard()', 'deleteDashboard()']) {
        const one = { ...dashboard('one'), is_seeded: true }; let fail = false;
        const b = browser(async (url, method) => {
            if (method !== 'GET') { fail = true; return one; }
            if (fail) throw Error('Read unavailable');
            return url === '/api/dashboards' ? [one] : one;
        });
        await b.run('loadDashboards()'); b.prompts.push('Renamed'); await b.run(action);
        assert.match(b.elements.dashboard_notice.textContent, /Saved/);
        assert.deepEqual(b.alerts, []);
        fail = false;
        await b.buttons(b.elements.dashboard_notice).find(c => c.textContent === 'Retry refresh').onclick();
        assert.equal(b.requests.filter(r => r.method !== 'GET').length, 1);
    }
});

test('an old list refresh cannot steal a selection made while it was pending', async () => {
    const held = deferred(); let count = 0;
    const b = browser(async url => {
        if (url === '/api/dashboards') return ++count === 1 ? [dashboard('one'), dashboard('two')] : held.promise;
        return dashboard(url.split('/').at(-1));
    });
    await b.run('loadDashboards()');
    const pending = b.run('loadDashboards()'); await tick();
    await b.run("switchDashboard('two')");
    held.resolve([dashboard('one')]); await pending;
    assert.equal(b.run('getCurrentDashboardId()'), 'two');
    assert.equal(b.elements.dashboard_title.textContent, 'two');
});

test('a changed query context cannot accept a held result from the previous context', async () => {
    const held = deferred(); let count = 0;
    const b = browser(async url => {
        if (url === '/api/dashboards') return [dashboard('one')];
        if (url === '/api/dashboards/one') return dashboard('one', [widget('context')]);
        return ++count === 1 ? held.promise : result(7);
    });
    await b.run('loadDashboards()');
    b.context.getQueryContext = () => ({ timezone: 'Europe/Warsaw', first_day_of_week: 0 });
    held.resolve(result(999)); await tick();
    assert.doesNotMatch(b.elements.widget_grid.textContent, /999/);
    assert.match(b.elements.widget_grid.textContent, /7/);
    assert.equal(b.requests.at(-1).body.timezone, 'Europe/Warsaw');
    assert.equal(b.requests.at(-1).body.first_day_of_week, 0);
});

test('chart rendering failure is isolated and disposed charts never survive removal or selection', async () => {
    let broken = true, removed = false; const charts = [];
    const b = browser(async (url, method) => {
        if (url === '/api/dashboards') return [dashboard('one'), dashboard('two')];
        if (method === 'DELETE') { removed = true; return null; }
        if (url === '/api/dashboards/one') return dashboard('one', removed ? [] : [widget('tile'), { ...widget('chart'), spec: { ...spec, query: { ...spec.query, chart: 'bar' } } }]);
        if (url === '/api/dashboards/two') return dashboard('two');
        return result(5);
    });
    b.context.chartAppearanceColors = () => ({ ticks: '#fff', grid: '#111', legend: '#fff' });
    b.context.Chart = class {
        constructor() { if (broken) throw Error('Chart renderer unavailable'); this.destroyed = false; charts.push(this); }
        destroy() { this.destroyed = true; }
    };
    await b.run('loadDashboards()'); await tick();
    assert.match(b.elements.widget_grid.textContent, /Could not display/);
    assert.match(b.elements.widget_grid.textContent, /5/);
    broken = false; b.buttons().find(c => c.textContent === 'Retry').onclick(); await tick();
    assert.equal(charts.length, 1);
    await b.run("deleteWidget('chart')");
    assert.equal(charts[0].destroyed, true);
    await b.run("switchDashboard('two')");
    assert.equal(b.run("getWidgetById('chart')"), null);
});

test('pending duplicate dashboard creation is ignored; rejected writes expose read-only recovery', async () => {
    const held = deferred(); let reject = false;
    const b = browser(async (url, method) => {
        if (method === 'POST') { if (reject) throw Error('No acknowledgement'); return held.promise; }
        return url === '/api/dashboards' ? [dashboard('one')] : dashboard('one');
    });
    await b.run('loadDashboards()'); b.prompts.push('One create', 'Another create');
    const pending = b.run('createDashboard()'); await tick();
    await b.run('createDashboard()');
    assert.match(b.elements.dashboard_notice.textContent, /Saving/);
    held.resolve(dashboard('created')); await pending;
    assert.equal(b.requests.filter(r => r.method === 'POST').length, 1);
    reject = true; await b.run('createDashboard()');
    assert.match(b.elements.dashboard_notice.textContent, /not acknowledged/);
    assert.doesNotMatch(b.elements.dashboard_notice.textContent, /Saved/);
    await b.buttons(b.elements.dashboard_notice).find(c => c.textContent === 'Retry refresh').onclick();
    assert.equal(b.requests.filter(r => r.method === 'POST').length, 2);
});

test('a read racing a pending remove is refreshed after acknowledgement without repeating the remove', async () => {
    const held = deferred(); let removed = false;
    const b = browser(async (url, method) => {
        if (method === 'DELETE') { await held.promise; removed = true; return null; }
        if (url === '/api/dashboards') return [dashboard('one')];
        if (url === '/api/dashboards/one') return dashboard('one', removed ? [] : [widget('remove')]);
        return result(1);
    });
    await b.run('loadDashboards()'); await tick();
    const removing = b.run("deleteWidget('remove')"); await tick();
    await b.run('reloadCurrentDashboard()');
    held.resolve(); await removing; await tick();
    assert.equal(b.run("getWidgetById('remove')"), null);
    assert.equal(b.requests.filter(r => r.method === 'DELETE').length, 1);
});

test('an acknowledged reset invalidates removed widgets even when list refresh fails', async () => {
    const query = deferred(); let reset = false;
    const one = { ...dashboard('one', [widget('old-seed')]), is_seeded: true };
    const b = browser(async (url, method) => {
        if (method === 'POST' && url.endsWith('/reset')) { reset = true; return { ...one, widgets: [widget('new-seed')] }; }
        if (url === '/api/dashboards') { if (reset) throw Error('Read offline'); return [one]; }
        if (url === '/api/dashboards/one') return one;
        return query.promise;
    });
    await b.run('loadDashboards()'); await b.run('resetDashboard()');
    query.resolve(result(999)); await tick();
    assert.equal(b.run("getWidgetById('old-seed')"), null);
    assert.doesNotMatch(b.elements.widget_grid.textContent, /999|old-seed/);
    assert.match(b.elements.dashboard_notice.textContent, /Saved/);
});

test('obsolete failed-dashboard Retry cannot clear the selected dashboard, including a queued old handler', async () => {
    const one = dashboard('one'), two = dashboard('two', [widget('healthy', 'two')]);
    const b = browser(async url => {
        if (url === '/api/dashboards') return [one, two];
        if (url === '/api/dashboards/one') throw Error('Detail unavailable');
        if (url === '/api/dashboards/two') return two;
        return result(7);
    });
    await b.run('loadDashboards()');
    const noticeRetry = b.buttons(b.elements.dashboard_notice).find(c => c.textContent === 'Retry refresh').onclick;
    const canvasRetry = b.buttons().find(c => c.textContent === 'Retry refresh').onclick;
    await b.buttons(b.elements.dashboard_tabs).find(c => c.textContent === 'two').onclick(); await tick();
    const card = b.elements.widget_grid.children[0], requestCount = b.requests.length;
    await noticeRetry(); await canvasRetry(); await tick();
    assert.equal(b.run("getWidgetById('healthy')?.title"), 'healthy');
    assert.equal(b.elements.widget_grid.children[0], card);
    assert.equal(b.elements.dashboard_title.textContent, 'two');
    assert.equal(b.requests.length, requestCount, 'obsolete retries issue no reads or queries');
    assert.equal(b.elements.dashboard_notice.textContent, '', 'obsolete detail error is cleared');
});

test('same-dashboard Retry recovers once, clears its notice and ignores previously queued handlers', async () => {
    let fail = true;
    const b = browser(async url => {
        if (url === '/api/dashboards') return [dashboard('one')];
        if (url === '/api/dashboards/one') {
            if (fail) throw Error('Detail offline');
            return dashboard('one', [widget('recovered')]);
        }
        return result(4);
    });
    await b.run('loadDashboards()');
    const retry = b.buttons(b.elements.dashboard_notice).find(c => c.textContent === 'Retry refresh').onclick;
    const queuedCanvasRetry = b.buttons().find(c => c.textContent === 'Retry refresh').onclick;
    fail = false; await retry(); await tick();
    assert.equal(b.run("getWidgetById('recovered').title"), 'recovered');
    assert.equal(b.elements.dashboard_notice.textContent, '');
    const requests = b.requests.length, card = b.elements.widget_grid.children[0];
    await retry(); await queuedCanvasRetry(); await tick();
    assert.equal(b.requests.length, requests);
    assert.equal(b.elements.widget_grid.children[0], card);
});

test('pending create retains Saving through detail failure, selection and Retry, then Saved without stealing selection', async () => {
    const held = deferred(); let fail = true, created = false;
    const b = browser(async (url, method) => {
        if (method === 'POST') { await held.promise; created = true; return dashboard('created'); }
        if (url === '/api/dashboards') return [dashboard('one'), dashboard('two'), ...(created ? [dashboard('created')] : [])];
        if (url === '/api/dashboards/two' && fail) throw Error('Detail offline');
        return dashboard(url.split('/').at(-1));
    });
    await b.run('loadDashboards()'); b.prompts.push('Created');
    const creating = b.run('createDashboard()'); await tick();
    await b.buttons(b.elements.dashboard_tabs).find(c => c.textContent === 'two').onclick();
    assert.match(b.elements.dashboard_notice.textContent, /Saving/);
    await b.buttons(b.elements.dashboard_tabs).find(c => c.textContent === 'one').onclick();
    assert.equal(b.elements.dashboard_notice.textContent, 'Saving…');
    await b.buttons(b.elements.dashboard_tabs).find(c => c.textContent === 'two').onclick();
    fail = false;
    await b.buttons(b.elements.dashboard_notice).find(c => c.textContent === 'Retry refresh').onclick();
    assert.equal(b.elements.dashboard_notice.textContent, 'Saving…');
    held.resolve(); await creating;
    assert.equal(b.run('getCurrentDashboardId()'), 'two');
    assert.equal(b.elements.dashboard_notice.textContent, 'Saved. ');
    assert.equal(b.requests.filter(r => r.method === 'POST').length, 1);
});

test('detail recovery preserves an unacknowledged-write read-only recovery notice', async () => {
    let fail = false;
    const b = browser(async (url, method) => {
        if (method === 'POST') throw Error('Write acknowledgement lost');
        if (url === '/api/dashboards') return [dashboard('one')];
        if (fail) throw Error('Detail offline');
        return dashboard('one');
    });
    await b.run('loadDashboards()'); b.prompts.push('Uncertain'); await b.run('createDashboard()');
    fail = true; await b.run('reloadCurrentDashboard()');
    fail = false;
    await b.buttons(b.elements.dashboard_notice).find(c => c.textContent === 'Retry refresh').onclick();
    assert.match(b.elements.dashboard_notice.textContent, /not acknowledged/);
    await b.buttons(b.elements.dashboard_notice).find(c => c.textContent === 'Retry refresh').onclick();
    assert.equal(b.requests.filter(r => r.method === 'POST').length, 1);
});

test('an older failed detail read cannot overwrite a newer successful read of the same dashboard', async () => {
    const held = deferred(); let reads = 0;
    const b = browser(async url => {
        if (url === '/api/dashboards') return [dashboard('one')];
        if (url === '/api/dashboards/one') {
            if (++reads === 1) { await held.promise; throw Error('Old read failed'); }
            return dashboard('one', [widget('current')]);
        }
        return result(6);
    });
    const initial = b.run('loadDashboards()'); await tick();
    await b.run('reloadCurrentDashboard()'); await tick();
    const card = b.elements.widget_grid.children[0];
    held.resolve(); await initial; await tick();
    assert.equal(b.run("getWidgetById('current').title"), 'current');
    assert.equal(b.elements.widget_grid.children[0], card);
    assert.equal(b.elements.dashboard_notice.textContent, '');
});
