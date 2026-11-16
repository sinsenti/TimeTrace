/* Populated real-API -> actual Chart collision regression. Only provider catalog is faked by the runner. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const p = await context.newPage(), checks = [], failures = [], errors = [], traffic = [], snapshots = [], samples = [];
    const check = (condition, message) => { (condition ? checks : failures).push(message); };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const nonce = 'collision-' + require('node:crypto').randomUUID();
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (new URL(r.url()).origin === baseURL) traffic.push({ method: r.method(), path: new URL(r.url()).pathname, body: r.postDataJSON() }); });
    const request = async (method, path, data) => {
        const response = await context.request[method](baseURL + path, { data });
        if (!response.ok()) throw Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
        return response.status() === 204 ? null : response.json();
    };
    const ready = async () => { await p.waitForFunction(() => currentDashboardData !== null); await p.waitForFunction(() => !document.querySelector('#widget_grid [aria-busy="true"]')); };
    const snapshot = id => p.evaluate(id => {
        const chart = dashboardCharts[id];
        return { labels: [...chart.data.labels], datasets: chart.data.datasets.map(d => ({ label: d.label, data: [...d.data], stack: d.stack })), x: chart.options.scales.x.stacked, y: chart.options.scales.y.stacked };
    }, id);
    const readOnly = start => !traffic.slice(start).some(r => ['PUT', 'PATCH', 'DELETE'].includes(r.method) || (r.method === 'POST' && r.path !== '/analytics/query'));
    const contrast = (fg, bg) => {
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    let task, dashboard, overview, seed;
    const sessions = [];
    try {
        task = await request('post', '/api/tasks', { title: nonce, category: '' });
        for (const [task_id, end] of [[null, '13'], [task.id, '14']]) sessions.push(await request('post', '/sessions', { task_id, start_time: '2024-02-26T12:00:00Z', end_time: `2024-02-26T${end}:00:00Z`, notes: nonce }));
        const query = { source: 'sessions', measure: 'sum_duration', group_by: ['day', 'category'], chart: 'stacked_bar', sort: 'dimension_asc', filters: [{ field: 'notes', op: 'eq', values: [nonce] }] };
        const sourceResponse = await request('post', '/analytics/query', { query });
        check(sourceResponse.rows.length === 2 && same(sourceResponse.rows[0].keys, sourceResponse.rows[1].keys) && same(sourceResponse.rows.map(r => r.value).sort(), [1, 2]), 'Real API returns two authoritative duplicate-key cells with durations 1 and 2');
        dashboard = await request('post', '/api/dashboards', { name: nonce });
        const title = '<img src=x onerror=alert(1)> ' + nonce;
        const widget = await request('post', `/api/dashboards/${dashboard.id}/widgets`, { title, spec: { mode: 'structured', query } });
        const savedBefore = await request('get', `/api/dashboards/${dashboard.id}`);
        await p.goto(baseURL + '/stats'); await ready();
        const beforeRender = traffic.length;
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click(); await ready();
        const actual = await snapshot(widget.id); snapshots.push(actual);
        check(same(actual.datasets[0].data, sourceResponse.rows.map(r => r.value)) && actual.labels.length === sourceResponse.rows.length, 'Actual populated Chart retains every source cell, not last-wins pivot');
        check(same(actual.labels, sourceResponse.rows.map((r, i) => `${r.labels.join(' / ')} — row ${i + 1}`)), 'Fallback labels retain full human group labels and explicit source row ordinal');
        const card = p.locator(`[data-widget-id="${widget.id}"]`);
        check((await card.textContent()).includes('Repeated group keys') && (await card.textContent()).includes('separate bars'), 'Visible notice explains why authoritative rows are shown separately');
        check(!actual.x && !actual.y && await card.locator('img').count() === 0, 'Fallback is unstacked and untrusted title remains inert');
        await p.getByRole('button', { name: 'Edit this widget: ' + title, exact: true }).click();
        await p.locator('#widget_builder_modal').waitFor({ state: 'visible' });
        await p.waitForFunction(() => !document.getElementById('wb_submit').disabled);
        check(await p.locator('#wb_chart').inputValue() === 'stacked_bar' && await p.locator('#wb_group_by_2').inputValue() === 'category', 'Public Edit visibly reopens unchanged saved stacked specification');
        await p.locator('#wb_title').focus(); await p.locator('#wb_title').press('Escape');
        check(await p.getByRole('button', { name: 'Edit this widget: ' + title, exact: true }).evaluate(el => el === document.activeElement), 'Cancel restores public Edit launcher focus');
        check(same((await request('get', `/api/dashboards/${dashboard.id}`)).widgets, savedBefore.widgets) && readOnly(beforeRender), 'Render and reopen never normalize or save collision spec');
        for (const theme of ['refined', 'stone', 'porcelain', 'dark']) {
            await p.evaluate(theme => { if (theme === 'dark') setAppearancePreference('appearance', 'dark'); else { setAppearancePreference('appearance', 'light'); setAppearancePreference('lightTheme', theme); } }, theme);
            await p.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
            const measured = await card.evaluate(el => {
                const note = [...el.querySelectorAll('p')].find(p => p.textContent.includes('Repeated group keys'));
                if (!note) return null;
                return { color: getComputedStyle(note).color, background: getComputedStyle(el).backgroundColor, width: note.getBoundingClientRect().width, inert: note.querySelectorAll('a,button,input,img,script').length === 0 };
            });
            samples.push({ theme, ...measured, contrast: measured ? contrast(measured.color, measured.background) : null });
            check(!!measured && measured.inert && measured.width > 0 && samples.at(-1).contrast >= 4.5, `Fallback explanation visible inert and sampled text contrast >=4.5 ${theme}`);
            check(same(await snapshot(widget.id), actual), `Live theme preserves exact collision values ${theme}`);
        }
        check(readOnly(beforeRender) && same((await request('get', `/api/dashboards/${dashboard.id}`)).widgets, savedBefore.widgets), 'Theme changes never write widgets or mutate saved spec');
        // Exercise a real comparison as provided by the API, not an invented alignment oracle.
        // Existing NULL/empty baseline alignment is deliberately NOT repaired here.
        overview = (await request('get', '/api/dashboards')).find(d => d.slug === 'overview');
        seed = (await request('get', `/api/dashboards/${overview.id}`)).widgets.find(w => w.seed_key === 'daily_trend');
        // Calendar comparisons require dense fill, which is unsupported for two dimensions.
        // A separate hour/category widget uses the existing legal keyed comparison contract.
        const compared = { ...query, group_by: ['hour_of_day', 'category'], fill_gaps: false, date_range: { preset: 'custom', start_date: '2024-02-26', end_date: '2024-02-26' }, comparison: { mode: 'custom', start_date: '2024-02-26', end_date: '2024-02-26' } };
        const baselineResponse = await request('post', '/analytics/query', { query: compared });
        const comparisonWidget = await request('post', `/api/dashboards/${dashboard.id}/widgets`, { title: 'Legal collision comparison', spec: { mode: 'structured', query: compared } });
        await p.reload(); await ready();
        const baselineChart = await snapshot(comparisonWidget.id); snapshots.push(baselineChart);
        check(baselineResponse.rows.length === 2 && same(baselineResponse.rows[0].keys, baselineResponse.rows[1].keys), 'Legal real hour/category comparison retains two authoritative collision rows');
        check(same(baselineChart.datasets.map(d => d.data), [baselineResponse.rows.map(r => r.value), baselineResponse.rows.map(r => r.comparison_value)]), 'Real comparison fallback preserves every provided primary and baseline value without asserting backend alignment policy');
        await request('put', `/api/dashboards/${overview.id}/widgets/${seed.id}`, { spec: { mode: 'structured', query } });
        await p.locator('#dashboard_tabs').getByRole('button', { name: overview.name, exact: true }).click(); await ready();
        const seedChart = await snapshot(seed.id); snapshots.push(seedChart);
        const canvas = p.locator(`[data-widget-id="${seed.id}"] canvas`); await canvas.scrollIntoViewIfNeeded();
        // If the old pivot dropped the second source row, capture RED without waiting for a nonexistent bar.
        if (seedChart.labels.length === sourceResponse.rows.length) {
            for (const datasetIndex of [0]) {
                await p.waitForFunction(({ id, datasetIndex }) => {
                    const bar = dashboardCharts[id]?.getDatasetMeta(datasetIndex).data[1];
                    return bar && bar.getProps(['x', 'y'], true).x === bar.x && bar.getProps(['x', 'y'], true).y === bar.y;
                }, { id: seed.id, datasetIndex });
                const point = await p.evaluate(({ id, datasetIndex }) => {
                    const chart = dashboardCharts[id], rect = chart.canvas.getBoundingClientRect(), point = chart.getDatasetMeta(datasetIndex).data[1].getCenterPoint();
                    return { x: rect.left + point.x, y: rect.top + point.y };
                }, { id: seed.id, datasetIndex });
                const inspected = p.waitForRequest(r => new URL(r.url()).pathname === '/revision/day-summary');
                await p.mouse.click(point.x, point.y); const inspection = await inspected;
                check(new URL(inspection.url()).searchParams.get('date_str') === sourceResponse.rows[1].keys[0], `Physical fallback dataset ${datasetIndex} second bar maps to raw source day`);
                await p.locator('#drilldown_title').getByText('Daily Inspection: ' + sourceResponse.rows[1].keys[0], { exact: true }).waitFor();
                check((await p.locator('#drilldown_subtitle').textContent()).includes('2 sessions'), `Real source inspector readback for dataset ${datasetIndex}`);
                await p.getByRole('button', { name: '× Close Inspector', exact: true }).click();
            }
        } else check(false, 'Old pivot has no second source bar to physically inspect');
        check(errors.length === 0, 'No pageerrors');
        return { verdict: failures.length ? 'RED' : 'PASS', checks, failures, errors, sourceResponse, baselineResponse, snapshots, samples, traffic, nonce, fakes: ['provider catalog only'], limits: ['CJS covers exact source-object identity and null/zero/negative baseline cells', 'Backend NULL/empty baseline alignment is characterized, not changed', 'Bounded Chromium/theme samples, not exhaustive a11y or palette certification'] };
    } finally {
        if (seed) await request('put', `/api/dashboards/${overview.id}/widgets/${seed.id}`, { title: seed.title, width: seed.width, spec: seed.spec });
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        for (const session of sessions) await request('delete', '/sessions/' + session.id);
        if (task) await request('delete', '/api/tasks/' + task.id);
        await context.close();
    }
};
