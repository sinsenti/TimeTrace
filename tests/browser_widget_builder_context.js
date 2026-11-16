/* Native opening/selection and query-context ownership; held real reads, no provider calls. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1024, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const p = await context.newPage(), checks = [], errors = [], alerts = [], writes = [];
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', async d => { alerts.push(d.message()); await d.accept(); });
    p.on('request', r => { if (/\/widgets/.test(r.url()) && r.method() === 'PUT') writes.push(r.postDataJSON()); });
    const request = async (method, path, data) => {
        const r = await context.request[method](baseURL + path, { data });
        if (!r.ok()) throw Error(`${path}: ${r.status()} ${await r.text()}`);
        return r.status() === 204 ? null : r.json();
    };
    const dashboards = []; let release;
    try {
        for (const name of ['Opening A', 'Opening B']) {
            const d = await request('post', '/api/dashboards', { name }); dashboards.push(d);
            await request('post', `/api/dashboards/${d.id}/widgets`, { title: name, width: 'half', spec: { mode: 'structured', query: { source: 'tasks', measure: 'task_count', chart: 'tile' } } });
        }
        await p.goto(baseURL + '/stats'); await p.waitForFunction(() => currentDashboardData !== null);
        await p.locator('#dashboard_tabs').getByRole('button', { name: 'Opening A', exact: true }).click();
        let enter;
        const held = new Promise(r => release = r), entered = new Promise(r => enter = r);
        await context.route('**/analytics/capabilities', async route => { const response = await route.fetch(); enter(); await held; await route.fulfill({ response }); });
        await p.getByRole('button', { name: 'Edit this widget: Opening A', exact: true }).click(); await entered;
        await p.locator('#dashboard_tabs').getByRole('button', { name: 'Opening B', exact: true }).click();
        release(); await p.waitForResponse(r => r.url().endsWith('/analytics/capabilities'));
        await p.evaluate(() => new Promise(requestAnimationFrame));
        check(await p.locator('#widget_builder_modal').isHidden(), 'Late capabilities cannot open an editor after dashboard selection changed');
        await p.getByRole('button', { name: 'Edit this widget: Opening B', exact: true }).click();
        await p.locator('#wb_title').fill('Draft on B');
        let enterPreview;
        const previewHeld = new Promise(r => release = r), previewEntered = new Promise(r => enterPreview = r);
        await context.route('**/analytics/query', async route => { const response = await route.fetch(); enterPreview(); await previewHeld; await route.fulfill({ response }); });
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click(); await previewEntered;
        await p.evaluate(() => { const s = getUserSettings(); s.firstDayOfWeek = s.firstDayOfWeek === 0 ? 1 : 0; saveUserSettings(s); });
        release(); await p.waitForResponse(r => r.url().endsWith('/analytics/query'));
        await p.locator('#wb_preview_result').getByText('Query context changed. Run query preview to update the result.', { exact: true }).waitFor();
        check(await p.locator('#wb_title').inputValue() === 'Draft on B', 'Changed-context preview is not applied and retains concurrent title');
        await context.unroute('**/analytics/query');
        // Script the existing public selection caller: the overlay intentionally blocks pointers outside it.
        await p.evaluate(id => switchDashboard(id), dashboards[0].id);
        await p.evaluate(() => submitWidgetBuilder());
        check(writes.length === 0 && await p.locator('#wb_error').textContent().then(t => t.includes('Dashboard selection changed')), 'Stale editor Save is blocked before any mutation when selection changes');
        await p.locator('#wb_title').press('Escape');
        check(errors.length === 0, `No pageerrors: ${JSON.stringify(errors)}`);
        return { checks, errors, alerts, fakeBoundaries: ['provider catalog', 'held real capability/query responses; scripted existing selection caller'] };
    } finally {
        if (release) release();
        for (const d of dashboards) await request('delete', `/api/dashboards/${d.id}`);
        await context.close();
    }
};
