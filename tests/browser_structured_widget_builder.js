/* Trusted native probe for run-browser-probe.cjs. Only synthetic public API fixtures. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ appearance: 'light', lightTheme: 'refined', idleDetectorEnabled: false, firstDayOfWeek: 0 })));
    const p = await context.newPage(), checks = [], errors = [], traffic = [];
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (new URL(r.url()).origin === baseURL) traffic.push({ path: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON() }); });
    const request = async (method, path, data) => {
        const response = await context.request[method](baseURL + path, { data });
        if (!response.ok()) throw Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
        return response.status() === 204 ? null : response.json();
    };
    const query = {
        source: 'sessions', measure: 'sum_duration', group_by: ['day'],
        filters: [{ field: 'notes', op: 'contains', values: ['builder12'] }, { field: 'duration_seconds', op: 'gte', values: [60] }, { field: 'has_task', op: 'eq', values: [false] }],
        date_range: { preset: 'custom', start_date: '2024-02-28', end_date: '2024-02-29' },
        chart: 'line', tag_attribution: 'split_evenly', sort: 'dimension_asc', limit: 37, fill_gaps: true,
        comparison: { mode: 'same_period_last_year', start_date: null, end_date: null }
    };
    let dashboard, session;
    const ready = () => p.waitForFunction(() => currentDashboardData !== null && !document.querySelector('#widget_grid [aria-busy="true"]'));
    const open = async id => { await p.getByRole('button', { name: `Edit this widget: ${id}`, exact: true }).click(); await p.locator('#widget_builder_modal:not(.hidden)').waitFor(); };
    try {
        session = await request('post', '/sessions', { start_time: '2024-02-29T12:00:00Z', end_time: '2024-02-29T13:00:00Z', notes: 'builder12', tags: '#builder12 #second' });
        dashboard = await request('post', '/api/dashboards', { name: 'Structured builder 12' });
        const widget = await request('post', `/api/dashboards/${dashboard.id}/widgets`, { title: 'Full saved query <literal>', width: 'full', spec: { mode: 'structured', query } });
        await p.goto(baseURL + '/stats'); await ready();
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click(); await ready();
        const before = traffic.filter(r => /\/widgets/.test(r.path) && r.method !== 'GET').length;
        await open(widget.title);
        check(await p.locator('#wb_filters .wb-filter-row').count() === 3, 'Reopen exposes every saved filter, not just the first');
        check(await p.locator('#wb_date_range').inputValue() === 'custom' && await p.locator('#wb_range_start').inputValue() === '2024-02-28', 'Custom local primary dates reopen');
        check(await p.locator('#wb_limit').inputValue() === '37' && await p.locator('#wb_fill_gaps').isChecked(), 'Limit and gap filling reopen');
        await p.locator('#wb_title').fill('Full saved query edited <img src=x onerror=alert(1)>');
        const previewResponse = p.waitForResponse(r => r.url().endsWith('/analytics/query') && r.request().postDataJSON()?.query?.limit === 37);
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click();
        const preview = await (await previewResponse).json();
        await p.locator('#wb_preview_result').waitFor();
        check(preview.rows.some(r => r.value === 1) && preview.comparison.alignment === 'positional', 'Preview executes real query with primary and prior-year baseline');
        check(await p.locator('#wb_preview_result').textContent().then(t => t.includes('Baseline') && t.includes('2023-02-28')), 'Preview shows baseline and backend-resolved dates');
        check(traffic.filter(r => /\/widgets/.test(r.path) && r.method !== 'GET').length === before, 'Open/edit/preview never writes a widget');
        const savedResponse = p.waitForResponse(r => r.url().endsWith(`/widgets/${widget.id}`) && r.request().method() === 'PUT');
        await p.locator('#wb_submit').click();
        const saved = await (await savedResponse).json();
        check(saved.spec.query.filters.length === 3 && saved.spec.query.limit === 37 && saved.spec.query.tag_attribution === 'split_evenly', 'Save retains all filters, ordering options and attribution');
        check(JSON.stringify(saved.spec.query) === JSON.stringify(widget.spec.query), 'Title-only edit preserves full normalized saved query byte-for-byte');
        await p.waitForFunction(() => document.getElementById('widget_builder_modal').classList.contains('hidden')); await ready();
        check(await p.locator(`[data-widget-id="${widget.id}"] canvas`).count() === 1, 'Real Canvas renders saved comparison chart');
        const datasets = await p.evaluate(id => dashboardCharts[id].data.datasets.length, widget.id);
        check(datasets === 2, 'Real Canvas retains primary and ghost comparison datasets');
        await open(saved.title);
        check(await p.locator('#wb_filters .wb-filter-row').count() === 3, 'Saved edit reopens all filter rows');
        await p.locator('#wb_title').fill('Canceled title'); await p.locator('#wb_title').press('Escape');
        check((await request('get', `/api/dashboards/${dashboard.id}`)).widgets[0].title === saved.title, 'Escape Cancel does not write');
        check(await p.evaluate(() => !!document.activeElement.closest('.canvas-widget-controls')), 'Cancel restores invoker focus');
        check(errors.length === 0, `No pageerrors: ${JSON.stringify(errors)}`);
        return { checks, errors, fakeBoundaries: ['provider catalog only; all query/widget/session API traffic real'], traffic };
    } finally {
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        if (session) await request('delete', `/sessions/${session.id}`);
        await context.close();
    }
};
