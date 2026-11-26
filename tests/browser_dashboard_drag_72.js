/** Bounded native probe for the external browser runner; never run against personal data.
 * Invoke with (page, baseURL, { expectedDbFile: '/tmp/timetrace-ui72-.../dev.db' }).
 * Creates only its own synthetic dashboard/widgets through public HTTP. No private storage access.
 * Native mouse dragging, keyboard movement, HTTP readback and reload are all required.
 */
async (page, baseURL, { expectedDbFile } = {}) => {
    const check = (ok, message) => { if (!ok) throw Error(message); results.push(message); };
    const results = [], errors = [], writes = [];
    const origin = new URL(baseURL);
    check(['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.protocol === 'http:' &&
        Number(origin.port) > 1024 && origin.port !== '8002' && origin.origin === baseURL,
    'explicit isolated loopback origin required');
    check(/^\/tmp\/timetrace-ui72-[^/]+\/(?:[^/]+\/)*[^/]+\.db$/.test(expectedDbFile || '') &&
        !expectedDbFile.split('/').includes('..'), 'explicit synthetic database path required');
    const browser = page.context().browser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(10000);
    const p = await context.newPage();
    const get = async path => {
        const response = await context.request.get(baseURL + path);
        if (!response.ok()) throw Error(`GET ${path}: ${response.status()}`);
        return response.json();
    };
    const post = async (path, data) => {
        const response = await context.request.post(baseURL + path, { data });
        if (!response.ok()) throw Error(`POST ${path}: ${response.status()}`);
        return response.json();
    };
    const ready = async () => {
        await p.waitForFunction(() => document.querySelectorAll('#widget_grid [data-widget-id]').length === 3 &&
            !document.querySelector('#widget_grid [aria-busy="true"]'));
    };
    const order = async id => (await get(`/api/dashboards/${id}`)).widgets.map(w => w.id);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    let ownedDashboard;
    p.on('pageerror', error => errors.push(error.message));
    p.on('request', request => {
        if (new URL(request.url()).origin === baseURL && request.method() === 'POST' && request.url().endsWith('/reorder')) {
            writes.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
        }
    });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings',
        JSON.stringify({ appearance: 'light', lightTheme: 'refined', idleDetectorEnabled: false })));
    try {
        const health = await get('/health');
        check(health.db_file === expectedDbFile && Number(health.port) === Number(origin.port), 'health matches isolated synthetic database and port');
        const existing = await get('/api/dashboards');
        const untouched = await Promise.all(existing.map(async d => ({ id: d.id, order: await order(d.id) })));
        ownedDashboard = await post('/api/dashboards', { name: 'Synthetic #72 native drag probe' });
        const widgets = [];
        for (const [title, width, chart] of [['Count', 'half', 'tile'], ['Wide table', 'full', 'table'], ['Task count', 'half', 'tile']]) {
            widgets.push(await post(`/api/dashboards/${ownedDashboard.id}/widgets`, {
                title: `Synthetic #72 ${title}`, width,
                spec: { mode: 'structured', query: { source: 'sessions', measure: 'session_count', chart } }
            }));
        }
        await p.goto(baseURL + '/stats');
        await p.locator('#dashboard_tabs').getByRole('button', { name: ownedDashboard.name, exact: true }).click();
        await ready();
        const [a, b, c] = widgets.map(w => w.id);
        const target = p.locator(`[data-widget-id="${a}"]`);
        const handle = p.locator(`[data-widget-id="${c}"] [data-widget-drag-handle]`);
        await handle.scrollIntoViewIfNeeded();
        const sourceBox = await handle.boundingBox(), targetBox = await target.boundingBox();
        check(!!sourceBox && !!targetBox, 'native drag source and target visible');
        const response = p.waitForResponse(r => r.url().endsWith(`/api/dashboards/${ownedDashboard.id}/widgets/reorder`) && r.request().method() === 'POST');
        await p.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
        await p.mouse.down();
        await p.mouse.move(sourceBox.x + sourceBox.width / 2 + 10, sourceBox.y + sourceBox.height / 2, { steps: 4 });
        await p.mouse.move(targetBox.x + 4, targetBox.y + targetBox.height / 2, { steps: 20 });
        // Chromium requires another move after dragenter to deliver dragover.
        await p.mouse.move(targetBox.x + 5, targetBox.y + targetBox.height / 2, { steps: 2 });
        check(await target.getAttribute('data-drop-position') === 'before', 'actual native drag exposes before insertion edge');
        await p.mouse.up();
        check((await response).ok(), 'native drop acknowledged');
        check(same(await order(ownedDashboard.id), [c, a, b]), 'native drop persists complete UUID order');
        await p.reload(); await ready();
        check(same(await p.locator('#widget_grid > [data-widget-id]').evaluateAll(cards => cards.map(el => el.dataset.widgetId)), [c, a, b]), 'saved drag order survives reload');
        check(await p.locator(`[data-widget-id="${b}"]`).evaluate(el => el.classList.contains('md:col-span-4')), 'full-width widget retains its saved width');
        const keyboard = p.locator(`[data-widget-id="${c}"] [data-widget-drag-handle]`);
        await keyboard.focus();
        const keyAck = p.waitForResponse(r => r.url().endsWith('/widgets/reorder') && r.request().method() === 'POST');
        await keyboard.press('ArrowRight'); check((await keyAck).ok(), 'keyboard handle movement acknowledged');
        check(same(await order(ownedDashboard.id), [a, c, b]), 'keyboard moves exactly one position');
        await p.waitForFunction(id => document.activeElement?.closest('[data-widget-id]')?.dataset.widgetId === id, c);
        check(true, 'keyboard focus stays with moved widget');
        await p.setViewportSize({ width: 390, height: 900 });
        await p.reload(); await ready();
        check(same(await p.locator('#widget_grid > [data-widget-id]').evaluateAll(cards => cards.map(el => el.dataset.widgetId)), [a, c, b]), 'narrow grid preserves persisted logical order');
        check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow grid does not overflow');
        for (const row of untouched) check(same(await order(row.id), row.order), 'other dashboard order unchanged');
        check(writes.length === 2 && writes.every(write => write.path.includes(ownedDashboard.id)), 'only two intended reorder writes to the owned dashboard');
        check(errors.length === 0, 'no uncaught page errors');
        return { results, writes, errors, limits: ['Chromium native mouse + keyboard only; physical touch/screen reader and owner visual acceptance remain separate'] };
    } finally {
        // Remove only rows created here. Never reset or seed/delete other dashboards.
        if (ownedDashboard) await context.request.delete(`${baseURL}/api/dashboards/${ownedDashboard.id}`);
        await context.close();
    }
};
