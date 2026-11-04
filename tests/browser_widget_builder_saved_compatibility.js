/* Saved input compatibility via explicit capability/detail HTTP fixtures; writes/readbacks real. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1024, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const p = await context.newPage(), checks = [], errors = [];
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    p.on('pageerror', e => errors.push(e.message));
    const request = async (method, path, data) => {
        const r = await context.request[method](baseURL + path, { data });
        if (!r.ok()) throw Error(`${path}: ${r.status()} ${await r.text()}`);
        return r.status() === 204 ? null : r.json();
    };
    let dashboard;
    try {
        dashboard = await request('post', '/api/dashboards', { name: 'Saved compatibility 12' });
        const widget = await request('post', `/api/dashboards/${dashboard.id}/widgets`, { title: 'Saved compatibility widget', width: 'full', spec: { mode: 'structured', query: {
            source: 'sessions', measure: 'sum_duration', group_by: ['task', 'tag'], filters: [{ field: 'notes', op: 'contains', values: ['literal, comma'] }],
            date_range: { preset: 'custom', start_date: '2024-02-28', end_date: '2024-02-29' }, chart: 'stacked_bar', sort: 'dimension_desc', limit: 19, fill_gaps: false, tag_attribution: 'split_evenly'
        } } });
        await context.route('**/analytics/capabilities', async route => {
            const response = await route.fetch(), data = await response.json();
            const sessions = data.sources.find(s => s.source === 'sessions');
            sessions.measures = sessions.measures.filter(m => m.value !== 'sum_duration');
            sessions.dimensions = sessions.dimensions.filter(d => d.value !== 'task');
            sessions.filter_fields = sessions.filter_fields.filter(f => f.value !== 'notes');
            await route.fulfill({ response, json: data });
        });
        await p.goto(baseURL + '/stats'); await p.waitForFunction(() => currentDashboardData !== null);
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click();
        await p.getByRole('button', { name: 'Edit this widget: Saved compatibility widget', exact: true }).click(); await p.locator('#widget_builder_modal:not(.hidden)').waitFor();
        check(await p.locator('#wb_measure').inputValue() === 'sum_duration' && await p.locator('#wb_group_by_1').inputValue() === 'task' && await p.locator('#wb_filter_field').inputValue() === 'notes', 'Unavailable saved selections remain explicit rather than defaulting');
        check(await p.locator('#wb_measure option:checked').textContent().then(t => t.includes('unavailable')), 'Unavailable picker explains retained saved value');
        await p.locator('#wb_title').fill('Retained saved definition');
        const savedResponse = p.waitForResponse(r => r.url().endsWith(`/widgets/${widget.id}`) && r.request().method() === 'PUT');
        await p.locator('#wb_submit').click(); const saved = await (await savedResponse).json();
        check(JSON.stringify(saved.spec.query) === JSON.stringify(widget.spec.query), 'Explicit Save roundtrips unavailable-in-capabilities values without truncation');
        await p.waitForFunction(() => document.getElementById('widget_builder_modal').classList.contains('hidden'));
        await p.waitForFunction(() => currentDashboardData !== null);
        let invalid = false;
        await context.route(`**/api/dashboards/${dashboard.id}`, async route => {
            const response = await route.fetch(), data = await response.json();
            if (invalid) data.widgets[0].spec.query.date_range.start_date = 'not-a-date';
            else data.widgets[0].spec = null;
            await route.fulfill({ response, json: data });
        });
        await p.locator('.canvas-actions').getByRole('button', { name: 'Refresh', exact: true }).click(); await p.waitForFunction(() => currentDashboardData !== null);
        await p.getByRole('button', { name: 'Edit this widget: Retained saved definition', exact: true }).click();
        check(await p.locator('#wb_submit').isDisabled() && await p.locator('#wb_error').textContent().then(t => t.includes('has not been changed')), 'Unreadable saved spec blocks destructive default overwrite');
        await p.locator('#wb_title').press('Escape');
        invalid = true;
        await p.locator('.canvas-actions').getByRole('button', { name: 'Refresh', exact: true }).click(); await p.waitForFunction(() => currentDashboardData !== null);
        await p.getByRole('button', { name: 'Edit this widget: Retained saved definition', exact: true }).click();
        check(await p.locator('#wb_range_start').inputValue() === 'not-a-date', 'Malformed saved date is retained as editable text, not erased by native date input');
        await p.locator('#wb_submit').click();
        check(await p.locator('#wb_error').textContent().then(t => t.includes('YYYY-MM-DD')), 'Malformed saved date produces useful local validation without a write');
        await p.locator('#wb_range_start').press('Escape');
        check((await request('get', `/api/dashboards/${dashboard.id}`)).widgets[0].spec.query.date_range.start_date === '2024-02-28', 'Unreadable/invalid fixtures never change the real persisted query');
        check(errors.length === 0, `No pageerrors: ${JSON.stringify(errors)}`);
        return { checks, errors, fakeBoundaries: ['provider catalog', 'capability selections omitted', 'detail spec null or invalid date; real stored widget unaffected'] };
    } finally {
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        await context.close();
    }
};
