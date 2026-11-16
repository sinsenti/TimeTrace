/* Native stale-request/validation callers. Held responses are explicit HTTP fakes. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 768, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const p = await context.newPage(), checks = [], errors = [];
    const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
    p.on('pageerror', e => errors.push(e.message));
    const request = async (method, path, data) => {
        const r = await context.request[method](baseURL + path, { data });
        if (!r.ok()) throw Error(`${path}: ${r.status()} ${await r.text()}`);
        return r.status() === 204 ? null : r.json();
    };
    let dashboard, release;
    try {
        dashboard = await request('post', '/api/dashboards', { name: 'Builder requests 12' });
        const first = await request('post', `/api/dashboards/${dashboard.id}/widgets`, { title: 'First owner', width: 'half', spec: { mode: 'structured', query: { source: 'sessions', measure: 'session_count', chart: 'tile' } } });
        const second = await request('post', `/api/dashboards/${dashboard.id}/widgets`, { title: 'Second owner', width: 'half', spec: { mode: 'structured', query: { source: 'tasks', measure: 'task_count', chart: 'tile' } } });
        await p.goto(baseURL + '/stats'); await p.waitForFunction(() => currentDashboardData !== null);
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click();
        await p.waitForFunction(() => !document.querySelector('#widget_grid [aria-busy="true"]'));
        await p.getByRole('button', { name: 'Edit this widget: First owner', exact: true }).click();
        let enter;
        const held = new Promise(r => release = r), entered = new Promise(r => enter = r);
        await context.route('**/analytics/query', async route => {
            if (route.request().postDataJSON().query.measure === 'session_count') { const response = await route.fetch(); enter(); await held; await route.fulfill({ response }); }
            else await route.continue();
        });
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click(); await entered;
        await p.locator('#wb_measure').selectOption('sum_duration');
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click();
        await p.locator('#wb_preview_result').getByRole('columnheader', { name: 'Total duration', exact: true }).waitFor();
        release(); await p.waitForResponse(r => r.url().endsWith('/analytics/query') && r.request().postDataJSON().query.measure === 'session_count');
        check(await p.locator('#wb_preview_result').getByRole('columnheader', { name: 'Total duration', exact: true }).count() === 1, 'Late older preview cannot replace the current preview');
        await context.unroute('**/analytics/query');
        await p.locator('#wb_limit').fill('0'); await p.locator('#wb_submit').click();
        check(await p.locator('#wb_error').textContent().then(t => t.includes('1 to 2000')), 'Invalid limit has local useful validation');
        await p.locator('#wb_limit').fill('200');
        await p.locator('#wb_group_by_1').selectOption('day'); await p.locator('#wb_group_by_2').selectOption('day');
        await p.getByRole('button', { name: 'Run query preview', exact: true }).click();
        await p.locator('#wb_error').getByText('group_by dimensions must be distinct', { exact: true }).waitFor();
        check(await p.locator('#wb_group_by_2').inputValue() === 'day', 'Backend validation retains invalid inputs for correction');
        await p.locator('#wb_group_by_2').selectOption(''); await p.locator('#wb_group_by_1').selectOption('');
        await p.locator('#wb_title').fill('Pending first owner');
        let enterSave;
        const saveHeld = new Promise(r => release = r), saveEntered = new Promise(r => enterSave = r);
        await context.route(`**/widgets/${first.id}`, async route => { const response = await route.fetch(); enterSave(); await saveHeld; await route.fulfill({ response }); });
        await p.locator('#wb_submit').click(); await saveEntered;
        await p.locator('#wb_title').press('Escape');
        await p.getByRole('button', { name: 'Edit this widget: Second owner', exact: true }).click();
        await p.locator('#wb_title').fill('Second unsaved draft');
        release(); await p.waitForResponse(r => r.url().endsWith(`/widgets/${first.id}`));
        await p.waitForFunction(() => !document.getElementById('wb_submit').disabled);
        check(await p.locator('#wb_title').inputValue() === 'Second unsaved draft' && await p.locator('#widget_builder_modal').isVisible(), 'Late Save cannot close or checkpoint another widget editor');
        check(await p.evaluate(() => hasSettingsDrafts(['widget_builder_modal'])), 'New owner remains dirty after old Save ACK');
        check((await request('get', `/api/dashboards/${dashboard.id}`)).widgets.find(w => w.id === second.id).title === 'Second owner', 'Old Save never writes the newly selected widget');
        await p.locator('#wb_title').press('Escape');
        await p.getByRole('button', { name: '+ Add Widget', exact: true }).click();
        await p.locator('#wb_title').fill('Saved across context change');
        let enterContext;
        const contextHeld = new Promise(r => release = r), contextEntered = new Promise(r => enterContext = r);
        let creates = 0;
        await context.route(`**/api/dashboards/${dashboard.id}/widgets`, async route => {
            creates++; const response = await route.fetch(); enterContext(); await contextHeld; await route.fulfill({ response });
        });
        await p.locator('#wb_submit').click(); await contextEntered;
        await p.evaluate(() => { const settings = getUserSettings(); settings.firstDayOfWeek = settings.firstDayOfWeek === 0 ? 1 : 0; saveUserSettings(settings); });
        release(); await p.waitForResponse(r => r.url().endsWith(`/api/dashboards/${dashboard.id}/widgets`));
        await p.locator('#wb_error').getByText('Saved. Query context changed while saving.', { exact: false }).waitFor();
        check(await p.locator('#wb_submit').isDisabled() && await p.locator('#wb_title').inputValue() === 'Saved across context change', 'Changed context retains inputs but blocks repeating an acknowledged create');
        await p.evaluate(() => submitWidgetBuilder());
        check(creates === 1 && (await request('get', `/api/dashboards/${dashboard.id}`)).widgets.length === 3, 'Context-change continuation never replays a committed create');
        await p.locator('#wb_title').press('Escape');
        check(errors.length === 0, `No pageerrors: ${JSON.stringify(errors)}`);
        return { checks, errors, fakeBoundaries: ['held real preview/PUT responses', 'provider catalog'] };
    } finally {
        if (release) release();
        if (dashboard) await request('delete', `/api/dashboards/${dashboard.id}`);
        await context.close();
    }
};
