/* Native caller regression: held/failed HTTP boundaries, real persisted widget writes. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1024, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const p = await context.newPage(), checks = [], errors = [], writes = [];
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (/\/widgets\//.test(r.url()) && r.method() === 'PUT') writes.push(r.postDataJSON()); });
    const request = async (method, path, data) => {
        const r = await context.request[method](baseURL + path, { data });
        if (!r.ok()) throw Error(`${path}: ${r.status()} ${await r.text()}`);
        return r.status() === 204 ? null : r.json();
    };
    let dashboard, release;
    try {
        dashboard = await request('post', '/api/dashboards', { name: 'Builder lifecycle 12' });
        const widget = await request('post', `/api/dashboards/${dashboard.id}/widgets`, { title: 'Lifecycle widget', width: 'half', spec: { mode: 'structured', query: { source: 'tasks', measure: 'task_count', chart: 'tile' } } });
        await p.goto(baseURL + '/stats'); await p.waitForFunction(() => currentDashboardData !== null);
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click();
        await p.getByRole('button', { name: 'Edit this widget: Lifecycle widget', exact: true }).click();
        await p.locator('#wb_title').fill('Acknowledged title');
        let enter;
        const started = new Promise(r => enter = r), held = new Promise(r => release = r);
        await context.route(`**/widgets/${widget.id}`, async route => { const response = await route.fetch(); enter(); await held; await route.fulfill({ response }); });
        await p.locator('#wb_submit').click(); await started;
        check(await p.locator('#wb_submit').isDisabled(), 'Pending Save disables double activation');
        await p.evaluate(() => submitWidgetBuilder());
        check(writes.length === 1, 'A repeated public Save while pending does not repeat the write');
        await p.locator('#wb_title').fill('Concurrent unsaved title');
        await context.route(`**/api/dashboards/${dashboard.id}`, route => route.fulfill({ status: 503, json: { detail: 'Synthetic post-ACK read failure' } }));
        release();
        await p.waitForFunction(() => document.getElementById('dashboard_notice').textContent.includes('Saved.'));
        await p.getByText('Failed to load this dashboard.', { exact: true }).waitFor();
        check(await p.locator('#widget_builder_modal').isVisible() && await p.locator('#wb_title').inputValue() === 'Concurrent unsaved title', 'Successful pending Save preserves concurrent editor fields');
        check(await p.evaluate(() => hasSettingsDrafts(['widget_builder_modal'])), 'Only submitted fields checkpoint; concurrent title remains dirty');
        check((await request('get', `/api/dashboards/${dashboard.id}`)).widgets[0].title === 'Acknowledged title', 'Read failure never misreports or replays the acknowledged mutation');
        await context.unroute(`**/api/dashboards/${dashboard.id}`);
        await p.locator('#widget_builder_modal').getByRole('button', { name: 'Cancel', exact: true }).click();
        await p.locator('#dashboard_notice').getByRole('button', { name: 'Retry refresh', exact: true }).click();
        await p.waitForFunction(() => currentDashboardData !== null);
        check(writes.length === 1, 'Canvas Retry refresh performs no widget writes');
        check(errors.length === 0, `No pageerrors: ${JSON.stringify(errors)}`);
        return { checks, errors, writes, fakeBoundaries: ['held real PUT response', 'post-ACK dashboard GET failure', 'provider catalog'] };
    } finally {
        if (release) release();
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        await context.close();
    }
};
