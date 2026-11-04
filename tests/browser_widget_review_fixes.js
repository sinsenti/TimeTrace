/* Populated native review regressions. Real query/widget HTTP; only the held reply and catalog are controlled. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const p = await context.newPage(), checks = [], failures = [], errors = [], traffic = [], charts = [];
    const check = (condition, message) => { (condition ? checks : failures).push(message); };
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (new URL(r.url()).origin === baseURL) traffic.push({ path: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON() }); });
    const request = async (method, path, data) => {
        const r = await context.request[method](baseURL + path, { data });
        if (!r.ok()) throw Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
        return r.status() === 204 ? null : r.json();
    };
    const ready = async () => {
        await p.waitForFunction(() => currentDashboardData !== null);
        await p.waitForFunction(() => !document.querySelector('#widget_grid [aria-busy="true"]'));
    };
    const snapshot = id => p.evaluate(id => {
        const chart = dashboardCharts[id];
        return { labels: [...chart.data.labels], datasets: chart.data.datasets.map(d => ({ label: d.label, data: [...d.data], stack: d.stack })),
            xStacked: chart.options.scales.x.stacked, yStacked: chart.options.scales.y.stacked, legend: chart.options.plugins.legend.display };
    }, id);
    let dashboard, release;
    const tasks = [], sessions = [];
    try {
        for (const category of ['Alpha', 'Beta']) tasks.push(await request('post', '/api/tasks', { title: 'Review ' + category, category }));
        for (const day of ['2024-02-25', '2024-02-26']) for (const task of tasks) {
            sessions.push(await request('post', '/sessions', { task_id: task.id, start_time: day + 'T12:00:00Z', end_time: day + 'T13:00:00Z', notes: 'review repair' }));
        }
        dashboard = await request('post', '/api/dashboards', { name: 'Review repair populated' });
        await p.goto(baseURL + '/stats'); await ready();
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click(); await ready();
        await p.getByRole('button', { name: '+ Add Widget', exact: true }).click();
        await p.locator('#wb_title').fill('Native stacked day category');
        await p.locator('#wb_group_by_1').selectOption('day');
        await p.locator('#wb_group_by_2').selectOption('category');
        await p.locator('#wb_chart').selectOption('stacked_bar');
        await p.locator('#wb_measure').selectOption('session_count');
        await p.locator('#wb_sort').selectOption('dimension_asc');
        const saved = p.waitForResponse(r => r.url().endsWith(`/api/dashboards/${dashboard.id}/widgets`) && r.request().method() === 'POST');
        await p.locator('#wb_submit').click(); const widget = await (await saved).json();
        await p.locator('#widget_builder_modal').waitFor({ state: 'hidden' }); await ready();
        const actual = await snapshot(widget.id); charts.push(actual);
        check(JSON.stringify(actual.labels) === JSON.stringify(['Feb 25', 'Feb 26']), 'Stacked chart has one x slot per distinct primary key');
        check(actual.datasets.length === 2 && actual.datasets.every(d => JSON.stringify(d.data) === '[1,1]'), 'Actual populated Chart has two secondary datasets with exact authoritative cells');
        check(actual.xStacked && actual.yStacked && actual.legend, 'Actual stacked axes and meaningful series legend enabled');
        await p.getByRole('button', { name: 'Edit this widget: Native stacked day category', exact: true }).click();
        check(await p.locator('#wb_chart').inputValue() === 'stacked_bar' && await p.locator('#wb_group_by_2').inputValue() === 'category', 'Native Save/reopen retains stacked query');
        await p.locator('#wb_filter_field').selectOption('notes');
        await p.locator('#wb_filter_op').selectOption('contains');
        await p.locator('#wb_filter_value').fill('["review repair"]');
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click();
        await p.locator('#wb_preview_result table').waitFor();
        const beforeRemove = traffic.length;
        await p.locator('#wb_filter_first').getByRole('button', { name: 'Remove filter', exact: true }).click();
        check((await p.locator('#wb_preview_result').textContent()).includes('Inputs changed') && await p.locator('#wb_preview_result table').count() === 0, 'First Remove immediately clears stale preview with explicit outdated message');
        check(traffic.length === beforeRemove, 'First Remove performs no implicit query or widget write');
        await p.locator('#wb_filter_field').selectOption('notes'); await p.locator('#wb_filter_value').fill('["review repair"]');
        let enter;
        const entered = new Promise(r => enter = r), held = new Promise(r => release = r);
        await context.route('**/analytics/query', async route => { const response = await route.fetch(); enter(); await held; await route.fulfill({ response }); });
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click(); await entered;
        await p.locator('#wb_filter_first').getByRole('button', { name: 'Remove filter', exact: true }).click();
        const reply = p.waitForResponse(r => r.url().endsWith('/analytics/query'));
        release(); await reply; await context.unroute('**/analytics/query');
        check(await p.locator('#wb_preview_result table').count() === 0, 'Held pre-Remove response cannot repopulate cleared preview (existing snapshot control)');
        check((await p.locator('#wb_preview_result').textContent()).includes('Inputs changed'), 'Held pre-Remove response retains explicit outdated status');
        await p.locator('#wb_group_by_1').selectOption('hour_of_day'); await p.locator('#wb_group_by_2').selectOption('task');
        await p.locator('#wb_fill_gaps').check();
        await p.locator('#wb_filter_field').selectOption('notes'); await p.locator('#wb_filter_op').selectOption('contains'); await p.locator('#wb_filter_value').fill('["review repair", "00123", 0, false]');
        const beforeGuard = traffic.length;
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click();
        await p.locator('#wb_submit').click();
        check(traffic.length === beforeGuard && (await p.locator('#wb_error').textContent()).includes('Fill empty buckets'), 'Unsupported two-dimensional time fill blocked locally before Preview and Save');
        check(await p.locator('#wb_fill_gaps').isChecked() && await p.locator('#wb_group_by_2').inputValue() === 'task' && await p.locator('#wb_filter_value').inputValue() === '["review repair", "00123", 0, false]', 'Validation retains checkbox, dimensions and exact typed filter draft');
        check(await p.evaluate(() => hasSettingsDrafts(['widget_builder_modal'])), 'Rejected draft remains dirty');
        await p.locator('#wb_title').press('Escape');
        check((await request('get', `/api/dashboards/${dashboard.id}`)).widgets[0].spec.query.group_by.join() === 'day,category', 'Rejected Save never overwrites saved widget');
        check(errors.length === 0, `No pageerrors: ${JSON.stringify(errors)}`);
        return { checks, failures, errors, charts, traffic, verdict: failures.length ? 'RED' : 'PASS' };
    } finally {
        if (release) release();
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        for (const session of sessions) await request('delete', '/sessions/' + session.id);
        for (const task of tasks) await request('delete', '/api/tasks/' + task.id);
        await context.close();
    }
};
