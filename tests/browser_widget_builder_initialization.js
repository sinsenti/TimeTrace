/* Capability ownership and retained independent SQL entry. SQL HTTP is explicitly faked. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1024, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const p = await context.newPage(), checks = [], alerts = [], errors = [];
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    p.on('dialog', async d => { alerts.push(d.message()); await d.accept(); });
    p.on('pageerror', e => errors.push(e.message));
    const request = async (method, path, data) => {
        const r = await context.request[method](baseURL + path, { data });
        if (!r.ok()) throw Error(`${path}: ${r.status()} ${await r.text()}`);
        return r.status() === 204 ? null : r.json();
    };
    let dashboard, release;
    try {
        dashboard = await request('post', '/api/dashboards', { name: 'Builder initialization 12' });
        const make = title => request('post', `/api/dashboards/${dashboard.id}/widgets`, { title, width: 'half', spec: { mode: 'structured', query: { source: 'sessions', measure: 'session_count', chart: 'tile' } } });
        await make('Initial first'); await make('Initial second');
        const capabilities = await request('get', '/analytics/capabilities');
        check(capabilities.sql_enabled === false, 'Real daemon retains disabled-by-default SQL flag');
        await p.goto(baseURL + '/stats'); await p.waitForFunction(() => currentDashboardData !== null);
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click();
        await p.waitForFunction(() => !document.querySelector('#widget_grid [aria-busy="true"]'));
        await context.route('**/analytics/capabilities', route => route.fulfill({ status: 503, json: { detail: 'Synthetic capability outage' } }));
        const outageAlert = p.waitForEvent('dialog');
        await p.getByRole('button', { name: 'Edit this widget: Initial first', exact: true }).click();
        await outageAlert;
        await p.waitForFunction(() => document.getElementById('widget_builder_modal').classList.contains('hidden'));
        check(await p.locator('#widget_builder_modal').isHidden(), 'Capability failure exposes no editable unknown form');
        await context.unroute('**/analytics/capabilities');
        let enter, calls = 0;
        const entered = new Promise(r => enter = r), held = new Promise(r => release = r);
        await context.route('**/analytics/capabilities', async route => {
            calls++;
            if (calls === 1) { enter(); await held; }
            await route.fulfill({ json: capabilities });
        });
        await p.getByRole('button', { name: 'Edit this widget: Initial first', exact: true }).click(); await entered;
        await p.evaluate(() => closeWidgetBuilder());
        await p.getByRole('button', { name: 'Edit this widget: Initial second', exact: true }).click();
        await p.locator('#widget_builder_modal:not(.hidden)').waitFor(); await p.locator('#wb_title').fill('Second during first capability read');
        release(); await p.waitForResponse(r => r.url().endsWith('/analytics/capabilities'));
        check(await p.locator('#wb_title').inputValue() === 'Second during first capability read', 'Late capability read cannot hydrate or checkpoint a new owner');
        check(await p.evaluate(() => hasSettingsDrafts(['widget_builder_modal'])), 'Current title remains dirty after obsolete capabilities');
        await p.locator('#wb_title').press('Escape');
        check(alerts.length === 1 && alerts[0].includes('Reopen'), 'Capability outage explains explicit reopen retry');
        await context.unroute('**/analytics/capabilities');
        await context.route('**/analytics/capabilities', route => route.fulfill({ json: { ...capabilities, sql_enabled: true } }));
        await context.route('**/analytics/sql/schema', route => route.fulfill({ json: { tables: [{ name: 'session', columns: [{ name: 'duration_seconds' }] }] } }));
        await context.route('**/analytics/sql', route => route.fulfill({ json: { columns: ['label', 'value'], rows: [['<img src=x onerror=alert(1)>', 2]], row_count: 1, elapsed_ms: 1, warnings: [] } }));
        await p.reload(); await p.waitForFunction(() => currentDashboardData !== null);
        await p.getByRole('button', { name: '+ Add Widget', exact: true }).click(); await p.locator('#widget_builder_modal:not(.hidden)').waitFor();
        await p.getByRole('button', { name: 'SQL', exact: true }).click();
        await p.locator('#wb_sql').fill('SELECT 2 AS value'); await p.locator('#wb_title').fill('Independent SQL draft');
        await p.locator('#wb_sql').press('Control+Enter'); await p.locator('#wb_sql_preview:not(.hidden)').waitFor();
        check(await p.locator('#wb_sql_preview img').count() === 0, 'Retained SQL preview renders output inertly');
        check(await p.locator('#wb_title').inputValue() === 'Independent SQL draft' && await p.evaluate(() => hasSettingsDrafts(['widget_builder_modal'])), 'SQL metadata cannot checkpoint the title draft');
        await p.getByRole('button', { name: 'Builder', exact: true }).click();
        await p.getByRole('button', { name: 'SQL', exact: true }).click();
        check(await p.locator('#wb_sql').inputValue() === 'SELECT 2 AS value', 'Independent SQL entry survives switching modes without adopting SQL layout/sandbox');
        await p.locator('#wb_sql').press('Escape');
        check((await request('get', `/api/dashboards/${dashboard.id}`)).widgets.length === 2, 'SQL preview/Cancel never writes or enables SQL on daemon');
        check(errors.length === 0 && alerts.length === 1, `No pageerrors or executable SQL text: ${JSON.stringify(errors)}`);
        return { checks, errors, alerts, fakeBoundaries: ['provider catalog', 'capability failure/held response', 'SQL opt-in capability/schema/preview HTTP only; flag never enabled, no sandbox certification'] };
    } finally {
        if (release) release();
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        await context.close();
    }
};
