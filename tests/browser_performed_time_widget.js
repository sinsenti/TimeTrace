/* Trusted native probe for run-browser-probe.cjs. Synthetic public API data only. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
        if (location.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
            localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false }));
        }
    });
    const p = await context.newPage(), checks = [], errors = [], traffic = [];
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (new URL(r.url()).origin === baseURL) traffic.push({ path: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON() }); });
    const request = async (method, path, data) => {
        const response = await context.request[method](baseURL + path, { data });
        if (!response.ok()) throw Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
        return response.status() === 204 ? null : response.json();
    };
    const ready = () => p.waitForFunction(() => currentDashboardData !== null && !document.querySelector('#widget_grid [aria-busy="true"]'));
    const mutations = () => traffic.filter(r => /\/widgets/.test(r.path) && r.method !== 'GET');
    let dashboard, existing;
    const sessions = [];
    try {
        const boards = await request('get', '/api/dashboards');
        const overview = boards.find(b => b.slug === 'overview');
        check(!!overview, 'Fresh native database seeds Overview');
        const seeded = await request('get', `/api/dashboards/${overview.id}`);
        check(seeded.widgets.length === 10 && seeded.widgets.some(w => w.seed_key === 'performed_time_by_day'), 'Fresh Overview contains ten widgets including performed time');
        check(seeded.widgets.find(w => w.seed_key === 'total_time').title === 'Recorded session time', 'Fresh recorded metric has accurate default title');
        const now = new Date();
        const pastDay = days => { const value = new Date(now); value.setUTCDate(value.getUTCDate() - days); value.setUTCHours(12, 0, 0, 0); return value; };
        const closedSession = async (start, minutes, notes) => {
            const row = await request('post', '/sessions', { start_time: start.toISOString(),
                end_time: new Date(start.getTime() + minutes * 60000).toISOString(), notes, tags: '#performed14 #shared14' });
            sessions.push(row); return row;
        };
        await closedSession(pastDay(2), 90, 'Synthetic performed14 primary');
        await closedSession(pastDay(16), 30, 'Synthetic performed14 baseline');
        await closedSession(new Date(now.getTime() + 3600000), 240, 'Synthetic performed14 future');
        await closedSession(new Date(now.getTime() - 1800000), 60, 'Synthetic performed14 straddling');
        const open = await closedSession(pastDay(1), 60, 'Synthetic performed14 open');
        await request('put', `/sessions/${open.id}`, { end_time: null });
        const recorded = await request('post', '/analytics/query', { query: seeded.widgets.find(w => w.seed_key === 'total_time').spec.query });
        check(recorded.total === 8, 'Original recorded-time query includes all eight stored hours, including future/open/straddling controls');
        existing = await request('post', '/api/dashboards', { name: 'Existing nine widgets 14' });
        const originals = seeded.widgets.filter(w => w.seed_key !== 'performed_time_by_day');
        for (const [index, widget] of originals.entries()) {
            await request('post', `/api/dashboards/${existing.id}/widgets`, {
                title: index === 0 ? 'My recorded <literal> custom title' : widget.title,
                width: widget.width, spec: widget.spec
            });
        }
        const existingBefore = await request('get', `/api/dashboards/${existing.id}`);
        check(existingBefore.widgets.length === 9, 'Synthetic existing dashboard starts with original nine query definitions');
        dashboard = await request('post', '/api/dashboards', { name: 'Performed recreation 14' });
        await p.goto(baseURL + '/stats'); await ready();
        await p.locator('#dashboard_tabs').getByRole('button', { name: existing.name, exact: true }).click(); await ready();
        check(await p.locator('#widget_grid [data-widget-id]').count() === 9, 'Existing nine-widget dashboard renders without preset insertion');
        await p.reload(); await ready();
        const existingAfter = await request('get', `/api/dashboards/${existing.id}`);
        check(JSON.stringify(existingAfter.widgets) === JSON.stringify(existingBefore.widgets), 'Existing nine widgets, exact stored queries and custom names survive reload');
        check((await request('get', '/api/dashboards')).find(b => b.id === existing.id).widget_count === 9, 'Existing dashboard remains nine on list read');
        await p.locator('#dashboard_tabs').getByRole('button', { name: overview.name, exact: true }).click(); await ready();
        const performedSeed = seeded.widgets.find(w => w.seed_key === 'performed_time_by_day');
        p.once('dialog', dialog => dialog.accept());
        const deleteResponse = p.waitForResponse(r => r.url().endsWith(`/widgets/${performedSeed.id}`) && r.request().method() === 'DELETE');
        await p.getByRole('button', { name: `Remove this widget: ${performedSeed.title}`, exact: true }).click();
        check((await deleteResponse).status() === 204, 'Owner-confirmed removal deletes performed seed');
        await p.waitForFunction(id => !currentDashboardData.widgets.some(w => w.id === id), performedSeed.id); await ready();
        await p.reload(); await ready();
        const afterDelete = await request('get', `/api/dashboards/${overview.id}`);
        check(afterDelete.widgets.length === 9 && !afterDelete.widgets.some(w => w.seed_key === 'performed_time_by_day'), 'Removed performed seed stays absent after browser reload/detail read');
        check((await request('get', '/api/dashboards')).find(b => b.id === overview.id).widget_count === 9, 'Deleted performed seed is not restored by dashboard list');
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click(); await ready();
        const launcher = p.getByRole('button', { name: 'Performed time preset', exact: true });
        const before = mutations().length, requestsBeforePreset = traffic.length;
        await launcher.click(); await p.locator('#widget_builder_modal:not(.hidden)').waitFor();
        for (const [id, expected] of Object.entries({ wb_title: 'Performed time by day', wb_source: 'sessions',
            wb_measure: 'sum_duration', wb_group_by_1: 'day', wb_chart: 'line', wb_date_range: 'last_14_days',
            wb_filter_field: 'session_time_relative', wb_filter_op: 'eq', wb_comparison: 'previous_period', wb_sort: 'dimension_asc' })) {
            check(await p.locator('#' + id).inputValue() === expected, `Preset hydrates ${id}`);
        }
        check(await p.locator('#wb_fill_gaps').isChecked(), 'Preset enables gap filling');
        check(!traffic.slice(requestsBeforePreset).some(r => r.path === '/analytics/query'), 'Opening preset never auto-previews');
        await p.locator('#wb_title').fill('Canceled performed title');
        await p.locator('#wb_title').press('Escape');
        check(mutations().length === before, 'Preset open/edit/Escape Cancel has no writes');
        check(await p.evaluate(() => document.activeElement.textContent.includes('Performed time preset')), 'Cancel restores preset launcher focus');
        check((await request('get', `/api/dashboards/${dashboard.id}`)).widgets.length === 0, 'Cancel leaves named dashboard empty');
        await launcher.click(); await p.locator('#widget_builder_modal:not(.hidden)').waitFor();
        await p.locator('#wb_title').fill('Performed <literal> custom title');
        const createResponse = p.waitForResponse(r => r.url().endsWith(`/api/dashboards/${dashboard.id}/widgets`) && r.request().method() === 'POST');
        await p.locator('#wb_submit').click();
        const saved = await (await createResponse).json();
        check(saved.spec.query.filters[0].field === 'session_time_relative' && saved.spec.query.filters[0].values[0] === 'past', 'Explicit Save persists past-only filter');
        check(saved.spec.query.comparison.mode === 'previous_period', 'Explicit Save persists previous-period baseline');
        await p.waitForFunction(() => document.getElementById('widget_builder_modal').classList.contains('hidden')); await ready();
        check(await p.locator(`[data-widget-id="${saved.id}"] canvas`).count() === 1, 'Canvas renders saved performed line');
        check(await p.evaluate(id => dashboardCharts[id].data.datasets.length === 2, saved.id), 'Canvas renders primary and comparison datasets');
        const series = await p.evaluate(id => dashboardCharts[id].data.datasets.map(dataset => dataset.data), saved.id);
        check(series[0].reduce((sum, value) => sum + (value || 0), 0) === 1.5, 'Real performed chart shows only ninety primary minutes');
        check(series[1].reduce((sum, value) => sum + (value || 0), 0) === 0.5, 'Real comparison chart shows thirty previous-period minutes');
        await p.getByRole('button', { name: `Edit this widget: ${saved.title}`, exact: true }).click();
        await p.locator('#widget_builder_modal:not(.hidden)').waitFor();
        check(await p.locator('#wb_title').inputValue() === saved.title, 'Custom literal title reopens safely');
        check(await p.locator('#wb_filter_value').inputValue() === '["past"]', 'Stored filter remains editable');
        await p.locator('#wb_width').selectOption('full');
        const updateResponse = p.waitForResponse(r => r.url().endsWith(`/widgets/${saved.id}`) && r.request().method() === 'PUT');
        await p.locator('#wb_submit').click(); const updated = await (await updateResponse).json();
        check(JSON.stringify(updated.spec.query) === JSON.stringify(saved.spec.query), 'Width-only edit preserves performed query exactly');
        await p.waitForFunction(() => document.getElementById('widget_builder_modal').classList.contains('hidden')); await ready();
        await p.setViewportSize({ width: 390, height: 844 });
        check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow performed canvas has no horizontal overflow');
        check(errors.length === 0, `No pageerrors: ${JSON.stringify(errors)}`);
        return { checks, errors, traffic, fakeBoundaries: ['provider catalog only; all dashboard/query traffic real'], manualGaps: ['physical touch', 'screen reader', 'other browser engines', 'human acceptance'] };
    } finally {
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        if (existing) await request('delete', `/api/dashboards/${existing.id}`);
        for (const session of sessions) await request('delete', `/sessions/${session.id}`);
        await context.close();
    }
};
