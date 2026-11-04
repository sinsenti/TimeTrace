/* Native expressiveness, failure recovery and sampled presentation. Synthetic API rows only. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const p = await context.newPage(), checks = [], errors = [], measurements = [], dialogs = [];
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
    const request = async (method, path, data) => {
        const r = await context.request[method](baseURL + path, { data });
        if (!r.ok()) throw Error(`${path}: ${r.status()} ${await r.text()}`);
        return r.status() === 204 ? null : r.json();
    };
    const ready = () => p.waitForFunction(() => currentDashboardData !== null && !document.querySelector('#widget_grid [aria-busy="true"]'));
    let dashboard;
    try {
        dashboard = await request('post', '/api/dashboards', { name: 'Builder controls 12' });
        await p.goto(baseURL + '/stats'); await ready();
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click(); await ready();
        await p.getByRole('button', { name: '+ Add Widget', exact: true }).click();
        await p.locator('#widget_builder_modal:not(.hidden)').waitFor();
        const capabilities = await request('get', '/analytics/capabilities');
        const values = selector => p.locator(selector).evaluate(el => Array.from(el.options).map(o => o.value));
        check(JSON.stringify(await values('#wb_source')) === JSON.stringify(capabilities.sources.map(s => s.source)), 'All published sources are reachable');
        for (const source of capabilities.sources) {
            await p.locator('#wb_source').selectOption(source.source);
            check(JSON.stringify(await values('#wb_measure')) === JSON.stringify(source.measures.map(m => m.value)), `${source.source}: all published measures`);
            check(JSON.stringify((await values('#wb_group_by_1')).filter(Boolean)) === JSON.stringify(source.dimensions.map(d => d.value)), `${source.source}: all published dimensions`);
            check(JSON.stringify((await values('#wb_filter_field')).filter(Boolean)) === JSON.stringify(source.filter_fields.map(f => f.value)), `${source.source}: all published filter fields`);
        }
        check((await values('#wb_chart')).includes('stacked_bar'), 'Stacked bar remains available');
        check((await values('#wb_filter_op')).length === 11, 'Every published filter operator remains reachable');
        await p.locator('#wb_source').selectOption('sessions');
        await p.locator('#wb_title').fill('Controls <img src=x onerror=alert(1)>');
        await p.locator('#wb_measure').selectOption('session_count');
        await p.locator('#wb_chart').selectOption('table');
        await p.locator('#wb_group_by_1').selectOption('tag');
        await p.locator('#wb_group_by_2').selectOption('task');
        await p.locator('#wb_sort').selectOption('dimension_desc');
        await p.locator('#wb_limit').fill('83');
        await p.locator('#wb_date_range').selectOption('custom');
        await p.locator('#wb_range_start').fill('2024-02-28'); await p.locator('#wb_range_end').fill('2024-02-29');
        await p.locator('#wb_comparison').selectOption('custom');
        await p.locator('#wb_comparison_start').fill('2023-02-27'); await p.locator('#wb_comparison_end').fill('2023-02-28');
        await p.locator('#wb_filter_field').selectOption('task'); await p.locator('#wb_filter_op').selectOption('in');
        await p.locator('#wb_filter_value').fill('["01900000-0000-7000-8000-000000000123", "00123"]');
        await p.getByRole('button', { name: '+ Add filter', exact: true }).click();
        const extra = p.locator('#wb_filters_extra .wb-filter-row');
        await extra.locator('select').nth(0).selectOption('duration_seconds'); await extra.locator('select').nth(1).selectOption('gte');
        await extra.locator('input').fill('[60]');
        check(await p.evaluate(() => hasSettingsDrafts(['widget_builder_modal'])), 'Filter arrays participate in shared Settings departure ownership');
        await context.route('**/analytics/query', route => route.fulfill({ status: 503, json: { detail: 'Preview failure <img src=x onerror=alert(1)>' } }));
        await p.evaluate(() => { window.beforePreviewCanvas = currentDashboardData; });
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click();
        await p.locator('#wb_error').getByText('Preview failure <img src=x onerror=alert(1)>', { exact: true }).waitFor();
        check(await p.evaluate(() => currentDashboardData === window.beforePreviewCanvas) && await p.locator('#wb_limit').inputValue() === '83', 'Preview outage retains inputs and healthy Canvas identity');
        check(await p.locator('#wb_error img').count() === 0 && dialogs.length === 0, 'Backend errors render as inert text');
        await context.unroute('**/analytics/query');
        await context.route(`**/api/dashboards/${dashboard.id}/widgets`, route => route.fulfill({ status: 400, json: { detail: 'Synthetic validation rejection' } }));
        await p.locator('#wb_submit').click(); await p.locator('#wb_error').getByText('Synthetic validation rejection', { exact: true }).waitFor();
        check(await p.locator('#widget_builder_modal').isVisible() && await p.evaluate(() => hasSettingsDrafts(['widget_builder_modal'])), 'Rejected Save keeps editable dirty draft');
        check((await request('get', `/api/dashboards/${dashboard.id}`)).widgets.length === 0, 'Rejected Save persists no widget');
        await context.unroute(`**/api/dashboards/${dashboard.id}/widgets`);
        const savedResponse = p.waitForResponse(r => r.url().endsWith(`/api/dashboards/${dashboard.id}/widgets`) && r.request().method() === 'POST');
        await p.locator('#wb_title').press('Control+Enter'); const saved = await (await savedResponse).json();
        await p.waitForFunction(() => document.getElementById('widget_builder_modal').classList.contains('hidden')); await ready();
        const q = saved.spec.query;
        check(q.filters.length === 2 && q.filters[0].values[1] === '00123' && q.filters[1].values[0] === 60, 'Native array editing saves exact ID strings and typed numeric filters');
        check(q.group_by.join() === 'tag,task' && q.sort === 'dimension_desc' && q.limit === 83 && q.tag_attribution === 'fan_out', 'Two dimensions, explicit sort/limit and fan-out default persist');
        check(q.comparison.mode === 'custom' && q.comparison.start_date === '2023-02-27', 'Custom baseline remains per-widget');
        await p.getByRole('button', { name: `Edit this widget: ${saved.title}`, exact: true }).click();
        await p.locator('#wb_filters_extra button').click();
        await p.locator('#wb_filter_field').selectOption('');
        check(await p.evaluate(() => hasSettingsDrafts(['widget_builder_modal'])), 'Removing filter rows cannot silently consume dirty ownership');
        const long = '<script>alert(1)</script>' + ' Long query title'.repeat(30);
        await p.locator('#wb_title').fill(long);
        for (const lightTheme of ['refined', 'stone', 'porcelain']) for (const appearance of ['light', 'dark']) for (const width of [390, 768, 1024, 1440]) {
            await p.setViewportSize({ width, height: 1000 });
            await p.evaluate(({ lightTheme, appearance }) => { setAppearancePreference('lightTheme', lightTheme); setAppearancePreference('appearance', appearance); }, { lightTheme, appearance });
            const sample = await p.evaluate(() => {
                const dialog = document.querySelector('.wb-dialog'), input = document.getElementById('wb_title'), label = document.querySelector('label[for="wb_title"]'), submit = document.getElementById('wb_submit');
                const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
                const luminance = value => rgb(value).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
                const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
                const d = dialog.getBoundingClientRect(), style = getComputedStyle(dialog), l = getComputedStyle(label), s = getComputedStyle(submit), i = getComputedStyle(input);
                return { fits: d.left >= 0 && d.right <= innerWidth && d.height <= innerHeight && dialog.scrollWidth <= dialog.clientWidth, label: contrast(l.color, style.backgroundColor), primary: contrast(s.color, s.backgroundColor), border: contrast(i.borderColor, i.backgroundColor), title: input.value };
            });
            measurements.push({ lightTheme, appearance, width, ...sample });
            if (lightTheme === 'refined' && appearance === 'light' && width === 390) await p.screenshot({ path: '/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-12/builder-light-390.png' });
            check(sample.fits && sample.label >= 4.5 && sample.primary >= 4.5 && sample.border >= 3 && sample.title === long, `${lightTheme}/${appearance}/${width}: bounded layout/text/control contrast and theme-retained draft`);
        }
        await p.locator('#wb_submit').focus(); await p.locator('#wb_submit').press('Tab');
        check(await p.getByRole('button', { name: 'Close widget editor', exact: true }).evaluate(el => el === document.activeElement), 'Tab wraps within editor');
        await p.getByRole('button', { name: 'Close widget editor', exact: true }).press('Shift+Tab');
        check(await p.locator('#wb_submit').evaluate(el => el === document.activeElement), 'Shift+Tab wraps within editor');
        await p.screenshot({ path: '/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-12/builder-dark-1440.png' });
        // The modal correctly blocks background pointers. Exercise the real departure
        // anchor/guard explicitly, not a physical pointer or keyboard navigation claim.
        await p.getByRole('link', { name: 'Settings', exact: true }).evaluate(el => el.click());
        check(new URL(p.url()).pathname === '/stats' && await p.locator('#wb_title').inputValue() === long && dialogs.some(text => text.includes('discard unsaved')), 'Scripted Settings anchor cancellation preserves exact draft/URL through the real guard');
        await p.locator('#wb_title').press('Escape');
        check((await request('get', `/api/dashboards/${dashboard.id}`)).widgets[0].spec.query.filters.length === 2, 'Canceled row removal and long title never write');
        check(errors.length === 0 && dialogs.every(text => text.includes('discard unsaved')), `No pageerrors or executable text dialogs: ${JSON.stringify(errors)}`);
        return { checks, errors, measurements, fakeBoundaries: ['provider catalog', 'explicit query 503', 'explicit widget POST 400; subsequent Save/query/readbacks real'] };
    } finally {
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        await context.close();
    }
};
