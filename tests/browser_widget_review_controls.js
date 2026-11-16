/* Real comparison/click HTTP. Invalid saved combos require the explicit private-DB legacy fixture manifest. */
async (page, baseURL) => {
    const manifest = JSON.parse(require('node:fs').readFileSync(process.env.TIMETRACE_REVIEW_LEGACY_MANIFEST, 'utf8'));
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const p = await context.newPage(), checks = [], errors = [], traffic = [], charts = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (new URL(r.url()).origin === baseURL) traffic.push({ path: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON() }); });
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    const request = async (method, path, data) => {
        const response = await context.request[method](baseURL + path, { data });
        if (!response.ok()) throw Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
        return response.status() === 204 ? null : response.json();
    };
    const ready = async () => { await p.waitForFunction(() => currentDashboardData !== null); await p.waitForFunction(() => !document.querySelector('#widget_grid [aria-busy="true"]')); };
    const tasks = [], sessions = [];
    let dashboard, overview, seed;
    try {
        for (const category of ['Alpha', 'Beta']) tasks.push(await request('post', '/api/tasks', { title: 'Duplicate human task', category }));
        for (const day of ['2024-02-25', '2024-02-26']) for (const hour of [12, 13]) for (const task of tasks) {
            sessions.push(await request('post', '/sessions', { task_id: task.id, start_time: `${day}T${hour}:00:00Z`, end_time: `${day}T${hour}:30:00Z`, notes: 'review control' }));
        }
        dashboard = await request('get', `/api/dashboards/${manifest.dashboard.id}`);
        check(dashboard.name === manifest.dashboard.name &&
            JSON.stringify(dashboard.widgets.map(w => w.id)) === JSON.stringify(manifest.validAcknowledgements.map(w => w.id)),
        'Exact nonce-owned legacy dashboard/widget identities match the private-DB fixture manifest');
        await p.goto(baseURL + '/stats'); await ready();
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click(); await ready();
        const savedBefore = await request('get', `/api/dashboards/${dashboard.id}`);
        for (const dimension of ['hour_of_day', 'weekday']) {
            await p.getByRole('button', { name: 'Edit this widget: Saved unsupported ' + dimension, exact: true }).click();
            await p.locator('#widget_builder_modal').waitFor({ state: 'visible' });
            await p.waitForFunction(() => !document.getElementById('wb_submit').disabled);
            check(await p.locator('#wb_fill_gaps').isChecked() && await p.locator('#wb_group_by_1').inputValue() === dimension && await p.locator('#wb_group_by_2').inputValue() === 'task', `Saved ${dimension} invalid combo is faithfully hydrated`);
            const before = traffic.length;
            await p.getByRole('button', { name: 'Run query preview', exact: true }).click(); await p.locator('#wb_submit').click();
            check(!traffic.slice(before).some(r => r.path === '/analytics/query' || /\/widgets(?:\/|$)/.test(r.path)), `Saved ${dimension} invalid combo blocked before requests`);
            check((await p.locator('#wb_error').textContent()).includes('Uncheck Fill empty buckets or remove the second'), `Saved ${dimension} has actionable local validation`);
            check(await p.locator('#wb_filter_value').inputValue() === '["review control","00123"]' && await p.locator('#wb_fill_gaps').isChecked(), `Saved ${dimension} filter and fill values retained`);
            await p.locator('#wb_title').press('Escape');
        }
        check(JSON.stringify((await request('get', `/api/dashboards/${dashboard.id}`)).widgets) === JSON.stringify(savedBefore.widgets), 'Unsupported saved drafts are not destructively rewritten');
        await p.getByRole('button', { name: '+ Add Widget', exact: true }).click();
        await p.locator('#wb_title').fill('Real duplicate-label comparison'); await p.locator('#wb_measure').selectOption('session_count');
        await p.locator('#wb_group_by_1').selectOption('hour_of_day'); await p.locator('#wb_group_by_2').selectOption('task');
        await p.locator('#wb_chart').selectOption('stacked_bar'); await p.locator('#wb_sort').selectOption('dimension_asc');
        await p.locator('#wb_date_range').selectOption('custom'); await p.locator('#wb_range_start').fill('2024-02-25'); await p.locator('#wb_range_end').fill('2024-02-26');
        await p.locator('#wb_comparison').selectOption('custom'); await p.locator('#wb_comparison_start').fill('2024-02-25'); await p.locator('#wb_comparison_end').fill('2024-02-26');
        await p.getByRole('button', { name: '+ Add filter', exact: true }).click();
        await p.locator('#wb_filters_extra select').first().selectOption('notes'); await p.locator('#wb_filters_extra select').nth(1).selectOption('contains'); await p.locator('#wb_filters_extra input').fill('["review control"]');
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click(); await p.locator('#wb_preview_result table').waitFor();
        const beforeRemove = traffic.length;
        await p.locator('#wb_filters_extra').getByRole('button', { name: 'Remove filter', exact: true }).click();
        check((await p.locator('#wb_preview_result').textContent()).includes('Inputs changed') && await p.locator('#wb_preview_result table').count() === 0, 'Dynamic Remove retains explicit stale-preview invalidation');
        check(!traffic.slice(beforeRemove).some(r => r.path === '/analytics/query' || /\/widgets(?:\/|$)/.test(r.path)), 'Dynamic Remove performs no implicit query or widget write');
        const saved = p.waitForResponse(r => r.url().endsWith(`/api/dashboards/${dashboard.id}/widgets`) && r.request().method() === 'POST');
        await p.locator('#wb_submit').click(); const comparison = await (await saved).json(); await p.locator('#widget_builder_modal').waitFor({ state: 'hidden' }); await ready();
        const actual = await p.evaluate(id => {
            const chart = dashboardCharts[id];
            return { labels: [...chart.data.labels], datasets: chart.data.datasets.map(d => ({ label: d.label, data: [...d.data], stack: d.stack })), x: chart.options.scales.x.stacked, y: chart.options.scales.y.stacked };
        }, comparison.id); charts.push(actual);
        check(actual.labels.length === 2 && actual.datasets.length === 4, 'Real hour/task result pivots to two slots and four primary/ghost series despite duplicate task labels');
        check(actual.datasets.every(d => JSON.stringify(d.data) === '[2,2]') && actual.x && actual.y, 'All real comparison cell values and stacked axes remain exact');
        check(actual.datasets.filter(d => d.stack === 'primary').length === 2 && actual.datasets.filter(d => d.stack === 'comparison').length === 2, 'Primary and baseline use distinct non-summed stacks');
        await p.getByRole('button', { name: 'Edit this widget: Real duplicate-label comparison', exact: true }).click();
        await p.locator('#widget_builder_modal').waitFor({ state: 'visible' });
        await p.waitForFunction(() => !document.getElementById('wb_submit').disabled);
        check(await p.locator('#wb_comparison').inputValue() === 'custom' && !await p.locator('#wb_fill_gaps').isChecked(), 'Native comparison reopen retains valid non-filled two-dimensional query');
        await p.locator('#wb_title').press('Escape');
        overview = (await request('get', '/api/dashboards')).find(d => d.slug === 'overview');
        seed = (await request('get', `/api/dashboards/${overview.id}`)).widgets.find(w => w.seed_key === 'daily_trend');
        await p.locator('#dashboard_tabs').getByRole('button', { name: overview.name, exact: true }).click(); await ready();
        await p.getByRole('button', { name: 'Edit this widget: ' + seed.title, exact: true }).click();
        await p.locator('#widget_builder_modal').waitFor({ state: 'visible' });
        await p.waitForFunction(() => !document.getElementById('wb_submit').disabled);
        await p.locator('#wb_group_by_2').selectOption('category'); await p.locator('#wb_chart').selectOption('stacked_bar');
        await p.locator('#wb_comparison').selectOption('none'); await p.locator('#wb_fill_gaps').uncheck(); await p.locator('#wb_date_range').selectOption('all_time');
        await p.locator('#wb_sort').selectOption('dimension_asc');
        const edited = p.waitForResponse(r => r.url().endsWith(`/widgets/${seed.id}`) && r.request().method() === 'PUT');
        await p.locator('#wb_submit').click(); check((await edited).ok(), 'Native edited seed saves stacked presentation without reseeding');
        await p.locator('#widget_builder_modal').waitFor({ state: 'hidden' }); await ready();
        const canvas = p.locator(`[data-widget-id="${seed.id}"] canvas`); await canvas.scrollIntoViewIfNeeded();
        await p.waitForFunction(id => {
            const chart = dashboardCharts[id], bar = chart?.getDatasetMeta(0).data[1];
            return bar && bar.getProps(['x', 'y'], true).x === bar.x && bar.getProps(['x', 'y'], true).y === bar.y;
        }, seed.id);
        const point = await p.evaluate(id => {
            const chart = dashboardCharts[id], rect = chart.canvas.getBoundingClientRect(), point = chart.getDatasetMeta(0).data[1].getCenterPoint();
            return { x: rect.left + point.x, y: rect.top + point.y };
        }, seed.id);
        const inspected = p.waitForRequest(r => new URL(r.url()).pathname === '/revision/day-summary');
        await p.mouse.click(point.x, point.y); const inspectionRequest = await inspected;
        check(new URL(inspectionRequest.url()).searchParams.get('date_str') === '2024-02-26', 'Native second-primary seed segment click maps to exact raw day key, not old flat row index');
        await p.locator('#drilldown_title').getByText('Daily Inspection: 2024-02-26', { exact: true }).waitFor();
        check((await p.locator('#drilldown_subtitle').textContent()).includes('4 sessions'), 'Real inspector readback matches clicked day sessions');
        check(errors.length === 0, `No pageerrors: ${JSON.stringify(errors)}`);
        return { checks, errors, traffic, charts };
    } finally {
        if (seed) await request('put', `/api/dashboards/${overview.id}/widgets/${seed.id}`, { title: seed.title, width: seed.width, spec: seed.spec });
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        for (const session of sessions) await request('delete', '/sessions/' + session.id);
        for (const task of tasks) await request('delete', '/api/tasks/' + task.id);
        await context.close();
    }
};
