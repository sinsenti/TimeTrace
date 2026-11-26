/* Manual trusted probe for the existing external browser runner; synthetic data only. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    const p = await context.newPage();
    const results = [], errors = [], requests = [], dialogs = [], measurements = [];
    const check = (condition, message) => { if (!condition) throw Error(message); results.push(message); };
    const contrast = (foreground, background) => {
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
            v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
        }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const a = luminance(foreground), b = luminance(background);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    const names = [];
    p.on('dialog', async d => { dialogs.push(d.message()); await d.accept(d.type() === 'prompt' ? names.shift() : undefined); });
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (new URL(r.url()).origin === baseURL) requests.push({ path: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON() }); });
    await context.addInitScript(() => {
        if (!localStorage.getItem('timetrace_user_settings')) localStorage.setItem('timetrace_user_settings', JSON.stringify({ appearance: 'light', lightTheme: 'refined', idleDetectorEnabled: false }));
    });
    const get = async path => { const response = await context.request.get(baseURL + path); if (!response.ok()) throw Error(`GET ${path}: ${response.status()}`); return response.json(); };
    const detail = id => get(`/api/dashboards/${id}`);
    const ready = async () => { await p.waitForFunction(() => currentDashboardData !== null); await p.waitForFunction(() => !document.querySelector('#widget_grid [aria-busy="true"]')); };
    const select = async name => { await p.locator('#dashboard_tabs').getByRole('button', { name, exact: true }).click(); await ready(); };
    const build = async (title, measure, chart = 'tile') => {
        await p.getByRole('button', { name: '+ Add Widget', exact: true }).click();
        await p.locator('#wb_title').fill(title);
        await p.locator('#wb_source').selectOption('sessions');
        await p.locator('#wb_measure').selectOption(measure);
        await p.locator('#wb_chart').selectOption(chart);
        if (chart === 'line') {
            await p.locator('#wb_group_by_1').selectOption('day');
            await p.locator('#wb_date_range').selectOption('last_7_days');
            await p.locator('#wb_comparison').selectOption('previous_period');
        }
        const saved = p.waitForResponse(r => /\/widgets$/.test(r.url()) && r.request().method() === 'POST');
        await p.locator('#wb_submit').click(); check((await saved).ok(), `Builder saves ${title}`);
        await p.waitForFunction(() => document.getElementById('widget_builder_modal').classList.contains('hidden'));
        await ready();
    };
    let named, overview, legacyTarget;
    try {
        await p.goto(baseURL + '/stats'); await ready();
        overview = (await get('/api/dashboards')).find(d => d.slug === 'overview');
        check((await detail(overview.id)).widgets.length === 9, 'Fresh Overview retains nine baseline widgets');
        names.push('Synthetic canvas'); await p.getByRole('button', { name: '+ Dashboard', exact: true }).click();
        await p.waitForFunction(() => document.getElementById('dashboard_title').textContent === 'Synthetic canvas'); await ready();
        named = (await get('/api/dashboards')).find(d => d.name === 'Synthetic canvas');
        check((await detail(named.id)).widgets.length === 0, 'Named dashboard starts empty');
        await build('Synthetic count', 'session_count');
        await build('Synthetic comparison', 'sum_duration', 'line');
        let saved = await detail(named.id); const countId = saved.widgets[0].id, chartId = saved.widgets[1].id;
        await p.getByRole('button', { name: 'Edit this widget: Synthetic count', exact: true }).click();
        await p.locator('#wb_title').fill('Edited <literal> count');
        const edited = p.waitForResponse(r => r.url().endsWith(`/widgets/${countId}`) && r.request().method() === 'PUT');
        await p.locator('#wb_submit').click(); check((await edited).ok(), 'Widget edit acknowledged'); await ready();
        check((await detail(named.id)).widgets[0].title === 'Edited <literal> count', 'Edited title persists literally');
        const beforeOrder = requests.filter(r => r.path === '/analytics/query').length;
        const moveHandle = p.getByRole('button', { name: 'Move widget: Synthetic comparison', exact: true });
        await moveHandle.focus(); await moveHandle.press('ArrowLeft');
        await p.waitForFunction(id => document.querySelector('#widget_grid > [data-widget-id]').dataset.widgetId === id, chartId);
        check(requests.filter(r => r.path === '/analytics/query').length === beforeOrder, 'Reorder does not rerun healthy queries');
        check(await p.evaluate(() => !!document.activeElement.closest('.canvas-widget-controls')), 'Keyboard reorder retains a usable canvas focus target');
        await p.reload(); await ready();
        saved = await detail(named.id);
        check(saved.widgets.map(w => w.id).join() === [chartId, countId].join(), 'Reordered IDs persist after reload');
        check(saved.widgets[0].spec.query.comparison.mode === 'previous_period', 'Comparison specification preserved');
        names.push('Renamed canvas'); await p.locator('.canvas-actions').getByRole('button', { name: 'Rename', exact: true }).click();
        await p.waitForFunction(() => document.getElementById('dashboard_title').textContent === 'Renamed canvas'); await ready();
        check((await detail(named.id)).name === 'Renamed canvas', 'Named rename persists');

        // A failed A read must not leave a retry capable of destroying healthy B.
        const failedDetailPath = `/api/dashboards/${overview.id}`;
        let failDetail = true;
        await context.route(`**${failedDetailPath}`, route => failDetail
            ? route.fulfill({ status: 503, json: { detail: 'Synthetic detail outage' } }) : route.continue());
        await p.locator('#dashboard_tabs').getByRole('button', { name: 'Overview', exact: true }).click();
        await p.locator('#dashboard_notice').getByRole('button', { name: 'Retry refresh', exact: true }).waitFor();
        await p.evaluate(() => {
            window.queuedDetailRetry = document.querySelector('#dashboard_notice button').onclick;
            window.queuedCanvasRetry = document.querySelector('#widget_grid button').onclick;
        });
        await select('Renamed canvas');
        const focusButton = p.getByRole('button', { name: 'Edit this widget: Synthetic comparison', exact: true });
        await focusButton.focus();
        await p.evaluate(id => {
            window.healthyCanvas = { data: currentDashboardData, card: document.querySelector(`[data-widget-id="${id}"]`),
                chart: dashboardCharts[id], focus: document.activeElement };
        }, chartId);
        const healthyTraffic = requests.length;
        const staleVisible = await p.locator('#dashboard_notice').getByRole('button', { name: 'Retry refresh', exact: true }).count();
        if (staleVisible) {
            // On the unfixed source, genuinely activate the surviving stale native UI.
            const staleResponse = p.waitForResponse(r => new URL(r.url()).pathname === failedDetailPath);
            await p.locator('#dashboard_notice').getByRole('button', { name: 'Retry refresh', exact: true }).click();
            await staleResponse;
        }
        await p.evaluate(async () => { await window.queuedDetailRetry(); await window.queuedCanvasRetry(); });
        const staleState = await p.evaluate(() => ({ sameData: currentDashboardData === window.healthyCanvas.data,
            sameCard: document.querySelector(`[data-widget-id="${window.healthyCanvas.card.dataset.widgetId}"]`) === window.healthyCanvas.card,
            sameChart: Object.values(dashboardCharts).includes(window.healthyCanvas.chart),
            sameFocus: document.activeElement === window.healthyCanvas.focus,
            heading: document.getElementById('dashboard_title').textContent, grid: document.getElementById('widget_grid').textContent }));
        check(staleState.sameData && staleState.sameCard && staleState.sameChart && staleState.sameFocus && staleState.heading === 'Renamed canvas',
            `Obsolete Retry preserves B data/card/chart/focus/heading: ${JSON.stringify(staleState)}`);
        check(staleVisible === 0 && await p.locator('#dashboard_notice').textContent() === 'Saved. ', 'Obsolete detail notice clears without losing Saved acknowledgement');
        check(requests.length === healthyTraffic, 'Captured obsolete retry handlers issue no requests, including healthy queries');
        await p.locator('#dashboard_tabs').getByRole('button', { name: 'Overview', exact: true }).click();
        await p.locator('#dashboard_notice').getByRole('button', { name: 'Retry refresh', exact: true }).waitFor();
        failDetail = false;
        const recoveryStart = requests.length;
        await p.locator('#dashboard_notice').getByRole('button', { name: 'Retry refresh', exact: true }).click(); await ready();
        check(await p.locator('#dashboard_title').textContent() === 'Overview' && !(await p.locator('#dashboard_notice').getByRole('button', { name: 'Retry refresh', exact: true }).count()), 'Legitimate same-dashboard Retry recovers and clears its error');
        check(requests.slice(recoveryStart).filter(r => r.path === failedDetailPath).length === 1 && requests.slice(recoveryStart).every(r => r.method === 'GET' || r.path === '/analytics/query'), 'Legitimate Retry performs reads only');
        check(requests.filter(r => r.path === '/analytics/query').every(r => r.body.query && typeof r.body.timezone === 'string' && [0, 1].includes(r.body.first_day_of_week)), 'Real query requests retain saved query and local context payload');
        await context.unroute(`**${failedDetailPath}`);
        await select('Renamed canvas');

        // One failed query and a held sibling: native UI shows each card independently.
        let release, entered;
        const held = new Promise(r => release = r), started = new Promise(r => entered = r);
        let fail = true;
        await context.route('**/analytics/query', async route => {
            const body = route.request().postDataJSON();
            if (body.query.measure === 'session_count') { entered(); await held; await route.continue(); }
            else if (fail) await route.fulfill({ status: 503, json: { detail: 'Synthetic query outage' } });
            else await route.continue();
        });
        await p.locator('.canvas-actions').getByRole('button', { name: 'Refresh', exact: true }).click(); await started;
        await p.getByText('Synthetic query outage', { exact: true }).waitFor();
        check(await p.getByText('Loading…', { exact: true }).isVisible(), 'Held sibling remains independently loading');
        release(); await p.waitForFunction(() => !document.querySelector('#widget_grid [aria-busy="true"]'));
        const healthyRequests = requests.filter(r => r.body?.query?.measure === 'session_count').length;
        fail = false; await p.locator(`[data-widget-id="${chartId}"]`).getByRole('button', { name: 'Retry', exact: true }).click(); await ready();
        check(requests.filter(r => r.body?.query?.measure === 'session_count').length === healthyRequests, 'Retry does not repeat healthy query');
        check(!(await p.getByText('Synthetic query outage', { exact: true }).count()), 'Failed card recovers');
        check(await p.evaluate(() => !!document.activeElement.closest('[data-widget-id]')), 'Retry completion retains focus inside its card');
        await context.unroute('**/analytics/query');

        // A held detail from the old selection may not replace the new dashboard.
        let releaseOld, enteredOld;
        const oldHeld = new Promise(r => releaseOld = r), oldStarted = new Promise(r => enteredOld = r);
        await context.route(`**/api/dashboards/${overview.id}`, async route => { const response = await route.fetch(); enteredOld(); await oldHeld; await route.fulfill({ response }); });
        await p.locator('#dashboard_tabs').getByRole('button', { name: 'Overview', exact: true }).click(); await oldStarted;
        await select('Renamed canvas'); releaseOld();
        await p.waitForResponse(r => r.url().endsWith(`/api/dashboards/${overview.id}`));
        check(await p.locator('#dashboard_title').textContent() === 'Renamed canvas', 'Old dashboard detail cannot replace newer selection');
        await context.unroute(`**/api/dashboards/${overview.id}`);

        const removeCount = p.getByRole('button', { name: 'Remove this widget: Edited <literal> count', exact: true });
        await removeCount.focus(); await removeCount.press('Enter');
        await p.waitForFunction(id => !document.querySelector(`[data-widget-id="${id}"]`), countId);
        check(await p.evaluate(() => !!document.activeElement.closest('.canvas-widget-controls')), 'Keyboard remove restores focus to remaining canvas controls');
        await p.reload(); await ready();
        check((await detail(named.id)).widgets.length === 1 && !await p.locator(`[data-widget-id="${countId}"]`).count(), 'Removed widget never returns on reload');

        // A successful create followed by failed reads is Saved, with a read-only recovery.
        let failList = true;
        await context.route('**/api/dashboards', route => route.request().method() === 'GET' && failList
            ? route.fulfill({ status: 503, json: { detail: 'Synthetic list outage' } }) : route.continue());
        names.push('Saved during outage'); await p.getByRole('button', { name: '+ Dashboard', exact: true }).click();
        await p.getByText('Saved. Could not refresh dashboards.', { exact: true }).waitFor();
        const creates = requests.filter(r => r.path === '/api/dashboards' && r.method === 'POST').length;
        failList = false;
        await p.locator('#dashboard_notice').getByRole('button', { name: 'Retry refresh', exact: true }).click(); await ready();
        check(await p.locator('#dashboard_title').textContent() === 'Saved during outage', 'Acknowledged create stays selected after recovery');
        check(requests.filter(r => r.path === '/api/dashboards' && r.method === 'POST').length === creates, 'Refresh retry never repeats acknowledged create');
        await context.unroute('**/api/dashboards');
        await p.locator('.canvas-actions').getByRole('button', { name: 'Delete', exact: true }).click();
        await p.waitForFunction(() => !dashboardList.some(d => d.name === 'Saved during outage')); await ready();
        check(!(await get('/api/dashboards')).some(d => d.name === 'Saved during outage'), 'Named dashboard delete persists');

        // Existing/deleted seed adoption, then explicit reset only.
        await select('Overview');
        const seed = (await detail(overview.id)).widgets[0];
        await p.getByRole('button', { name: `Edit this widget: ${seed.title}`, exact: true }).click();
        await p.locator('#wb_title').fill('Custom seed title'); await p.locator('#wb_submit').click(); await ready();
        const otherSeed = (await detail(overview.id)).widgets[1];
        await p.getByRole('button', { name: `Remove this widget: ${otherSeed.title}`, exact: true }).click();
        await p.waitForFunction(id => !document.querySelector(`[data-widget-id="${id}"]`), otherSeed.id);
        await p.reload(); await ready();
        const adopted = await detail(overview.id);
        check(adopted.widgets.length === 8 && adopted.widgets.find(w => w.id === seed.id).title === 'Custom seed title', 'Existing custom seed and deleted seed survive adoption');
        await p.getByRole('button', { name: 'Reset to defaults', exact: true }).click(); await ready();
        await p.waitForFunction(() => currentDashboardData && currentDashboardData.widgets.length === 9);
        check((await detail(overview.id)).widgets.length === 9, 'Only explicit reset restores nine defaults');

        // Legacy handoff with acknowledged success and a truly ambiguous lost response.
        legacyTarget = overview.id;
        const source = [{ title: 'Legacy acknowledged', query: { source: 'sessions', measure: 'session_count', chart: 'tile' } },
            { title: 'Legacy uncertain', query: { source: 'sessions', measure: 'session_count', chart: 'tile' } }];
        await p.evaluate(source => localStorage.setItem('tt_custom_widgets_v1', JSON.stringify(source)), source);
        let lost = true;
        await context.route(`**/api/dashboards/${legacyTarget}/widgets`, async route => {
            if (route.request().postDataJSON().title === 'Legacy uncertain' && lost) {
                await route.fetch(); lost = false; await route.abort('failed');
            } else await route.continue();
        });
        await p.reload(); await ready(); await p.getByRole('button', { name: 'I verified this item is saved', exact: true }).waitFor();
        await p.reload(); await ready();
        check((await detail(legacyTarget)).widgets.filter(w => w.title.startsWith('Legacy ')).length === 2, 'Reload never repeats acknowledged or uncertain legacy import');
        check(await p.evaluate(() => !!localStorage.getItem('tt_custom_widgets_v1')), 'Partial legacy source is preserved');
        await p.getByRole('button', { name: 'I verified this item is saved', exact: true }).click(); await ready();
        await p.waitForFunction(() => !localStorage.getItem('tt_custom_widgets_v1'));
        check((await detail(legacyTarget)).widgets.filter(w => w.title.startsWith('Legacy ')).length === 2, 'User-verified lost response completes without duplicates');
        check(await p.evaluate(() => !!localStorage.getItem('tt_custom_widgets_v1_migrated')), 'Legacy original source archived');
        await context.unroute(`**/api/dashboards/${legacyTarget}/widgets`);

        // Existing SQL entry remains optional; this flag/schema/preview is an explicit HTTP fake.
        await context.route('**/analytics/capabilities', async route => { const response = await route.fetch(); await route.fulfill({ json: { ...await response.json(), sql_enabled: true } }); });
        await context.route('**/analytics/sql/schema', route => route.fulfill({ json: { tables: [] } }));
        await context.route('**/analytics/sql', route => route.fulfill({ json: { columns: ['number'], rows: [[1]], row_count: 1, elapsed_ms: 0 } }));
        await p.reload(); await ready(); await p.getByRole('button', { name: '+ Add Widget', exact: true }).click();
        await p.locator('#wb_tab_sql').click(); await p.locator('#wb_sql').fill('SELECT 1 AS number');
        await p.locator('button[onclick="wbRunSqlPreview()"]').click(); await p.locator('#wb_sql_preview').waitFor();
        check(await p.locator('#wb_sql_preview').textContent().then(t => t.includes('number')), 'Optional SQL editor and preview remain reachable (HTTP fake)');
        await p.locator('#widget_builder_modal').getByRole('button', { name: 'Cancel', exact: true }).click();

        await select('Renamed canvas');
        const longTitle = '<literal> ' + 'LongSavedWidgetTitle'.repeat(8);
        await p.getByRole('button', { name: 'Edit this widget: Synthetic comparison', exact: true }).click();
        await p.locator('#wb_title').fill(longTitle);
        const longSaved = p.waitForResponse(r => r.url().endsWith(`/widgets/${chartId}`) && r.request().method() === 'PUT');
        await p.locator('#wb_submit').click(); check((await longSaved).ok(), 'Long literal title is saved'); await ready();
        check((await detail(named.id)).widgets[0].title === longTitle, 'Long literal title reads back unchanged');
        for (const theme of ['refined', 'stone', 'porcelain', 'dark']) {
            await p.evaluate(theme => { if (theme === 'dark') setAppearancePreference('appearance', 'dark'); else { setAppearancePreference('appearance', 'light'); setAppearancePreference('lightTheme', theme); } }, theme);
            for (const width of [390, 768, 1024, 1440]) {
                await p.setViewportSize({ width, height: 1000 });
                await p.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
                const measured = await p.evaluate(() => {
                    const grid = document.getElementById('widget_grid');
                    const button = grid.querySelector('.canvas-widget-controls button:not(:disabled)');
                    const text = document.querySelector('.canvas-description');
                    return { overflow: document.documentElement.scrollWidth > innerWidth, columns: getComputedStyle(grid).gridTemplateColumns,
                        textColor: getComputedStyle(text).color, textBackground: getComputedStyle(document.body).backgroundColor,
                        button: button && { width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height, color: getComputedStyle(button).color, background: getComputedStyle(button.closest('.widget-card')).backgroundColor } };
                });
                measured.textContrast = contrast(measured.textColor, measured.textBackground);
                measured.buttonContrast = contrast(measured.button.color, measured.button.background);
                measurements.push({ theme, width, ...measured });
                check(measured.textContrast >= 4.5 && measured.buttonContrast >= 4.5, `Sample canvas text contrast ${theme}/${width}`);
                check(!measured.overflow, `Canvas no horizontal overflow ${theme}/${width}`);
                check(measured.button?.width >= 32 && measured.button?.height >= 32, `Canvas controls reachable ${theme}/${width}`);
            }
        }
        const importsBeforeInvalid = requests.filter(r => /\/widgets$/.test(r.path) && r.method === 'POST').length;
        await p.evaluate(() => localStorage.setItem('tt_custom_widgets_v1', '{invalid source'));
        await p.reload(); await ready();
        check(await p.evaluate(() => localStorage.getItem('tt_custom_widgets_v1')) === '{invalid source', 'Malformed browser widget source remains intact');
        check(requests.filter(r => /\/widgets$/.test(r.path) && r.method === 'POST').length === importsBeforeInvalid, 'Malformed legacy adoption sends no writes');
        await p.evaluate(() => localStorage.removeItem('tt_custom_widgets_v1'));
        await select('Overview');
        await p.locator('.canvas-actions').getByRole('button', { name: 'Delete', exact: true }).click();
        await p.waitForFunction(id => !dashboardList.some(d => d.id === id), overview.id); await ready();
        await p.reload(); await ready();
        check(!(await get('/api/dashboards')).some(d => d.slug === 'overview'), 'Deleting Overview while a named dashboard remains never reseeds it');
        await p.locator('.canvas-actions').getByRole('button', { name: 'Delete', exact: true }).click();
        await p.waitForFunction(() => currentDashboardData && currentDashboardData.dashboard.slug === 'overview'); await ready();
        check((await get('/api/dashboards')).length === 1 && (await get('/api/dashboards'))[0].widget_count === 9, 'Deleting the last dashboard permits the existing nine-widget seed rule');
        check(errors.length === 0, 'No uncaught page errors');
        return { results, errors, dialogs, measurements, requests, fakes: ['provider catalog', 'one query 503 + held query', 'detail 503 + obsolete native/captured retry', 'held old detail', 'dashboard list 503', 'legacy POST commits then browser response aborts', 'SQL enabled flag/schema/preview (not sandbox certification)'],
            limits: ['No physical touch, screen reader or non-Chromium execution', 'Sample geometry/colors are not whole accessibility certification', 'Backend SQL sandbox is covered separately by pytest'] };
    } finally {
        // Keep the scratch DB inspectable for the parent browser gate; no personal storage.
        await context.close();
    }
};
