/* Manual default-off probe on the reviewed Timer-B/date parent.
 * Requires NEW isolated daemon/storage and pre-navigation/context/API guards; source is not execution proof.
 */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1024, height: 1000 } });
    const p = await context.newPage(), checks = [], failures = [], errors = [], journal = [], requests = [];
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const sqlSpec = { mode: 'sql', sql: { sql: "SELECT NULL AS x13, 0 AS y13 UNION ALL SELECT 'second', 2.5 UNION ALL SELECT 'third', 1", limit: 2, chart: 'bar', label_column: 'x13', value_column: 'y13' } };
    const check = (ok, name, data = null) => { checks.push({ name, passed: !!ok, data }); if (!ok) throw Error(name); };
    const api = async (method, path, body, status = 200) => {
        const r = await context.request.fetch(baseURL + path, { method, ...(body === undefined ? {} : { data: body }) });
        const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
        journal.push({ method, path, body, status: r.status(), response: data }); check(r.status() === status, `Real OFF ${method} ${path}: ${status}`, data); return data;
    };
    await context.addInitScript(origin => { if (location.origin === origin && !localStorage.getItem('timetrace_user_settings')) localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false, appearance: 'light', lightTheme: 'refined' })); }, baseURL);
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (new URL(r.url()).origin === baseURL) requests.push({ path: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON() }); });
    const ready = () => p.waitForFunction(() => currentDashboardData !== null && !document.querySelector('#widget_grid [aria-busy="true"]'));
    const evidence = { nonce, checks, failures, errors, journal, requests, fakeBoundaries: ['catalog metadata fixture allowed only in guarded runner if used; actual usage captured separately'], limits: ['No fabricated saved SQL history on OFF; disabled-saved-SQL-editor path is not provisioned/tested', 'Fresh OFF UI exposes structured Save only; SQL tab hidden, not a fake disabled SQL Save'] };
    try {
        const caps = await api('GET', '/analytics/capabilities'); check(caps.sql_enabled === false, 'Actual OFF capabilities report SQL false', caps);
        const denied = await api('GET', '/analytics/sql/schema', undefined, 400); check(denied.detail.includes('SQL widgets are disabled.'), 'Actual OFF schema denial honestly explains disabled SQL', denied);
        await api('POST', '/analytics/sql', sqlSpec.sql, 400);
        const baseline = await api('GET', '/api/dashboards'); evidence.baseline = baseline;
        check(baseline.length === 1 && baseline[0].widget_count === 9, 'Fresh independent OFF Overview has nine structured widgets', baseline);
        const dashboard = await api('POST', '/api/dashboards', { name: `SQL13-off-${nonce}` }, 201); evidence.dashboardId = dashboard.id;
        await api('POST', `/api/dashboards/${dashboard.id}/widgets`, { title: `SQL denied ${nonce}`, spec: sqlSpec }, 400);
        check((await api('GET', `/api/dashboards/${dashboard.id}`)).widgets.length === 0, 'OFF SQL Create400 persists no widget');
        const widget = await api('POST', `/api/dashboards/${dashboard.id}/widgets`, { title: `OFF structured ${nonce}`, spec: { mode: 'structured', query: { source: 'tasks', measure: 'task_count', chart: 'tile' } } }, 201); evidence.widgetId = widget.id;
        await api('PUT', `/api/dashboards/${dashboard.id}/widgets/${widget.id}`, { title: `Rejected replacement ${nonce}`, width: 'full', spec: sqlSpec }, 400);
        const after = await api('GET', `/api/dashboards/${dashboard.id}`);
        check(after.widgets.length === 1 && JSON.stringify(after.widgets[0]) === JSON.stringify(widget), 'OFF full-spec SQL Save400 leaves structured row/count/spec/title unchanged', after);
        const data = await api('POST', '/analytics/query', { query: widget.spec.query, timezone: 'UTC', first_day_of_week: 1 });
        check(data.row_count === 1 && data.rows[0].value === 0, 'OFF structured query remains healthy actual zero task count', data);
        await p.goto(baseURL + '/stats'); await ready();
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click(); await ready();
        await p.getByRole('button', { name: `Edit this widget: ${widget.title}`, exact: true }).click();
        await p.locator('#wb_title').waitFor({ state: 'visible' });
        check(!await p.locator('#wb_tab_sql').isVisible() && await p.locator('#wb_mode').inputValue() === 'structured' && !await p.locator('#wb_pane_sql').isVisible(), 'Fresh OFF native UI offers no SQL mode or SQL Save', { sqlTabVisible: await p.locator('#wb_tab_sql').isVisible(), mode: await p.locator('#wb_mode').inputValue() });
        const title = `OFF structured saved ${nonce}`; await p.locator('#wb_title').fill(title);
        const saved = p.waitForResponse(r => r.url().endsWith(`/widgets/${widget.id}`) && r.request().method() === 'PUT');
        await p.locator('#wb_submit').click(); const ack = await saved;
        journal.push({ phase: 'OFF-native-structured-Save', status: ack.status(), request: ack.request().postDataJSON(), response: await ack.json() });
        check(ack.status() === 200, 'OFF real native structured fullspec Save succeeds'); await ready(); await p.reload(); await ready();
        const readback = await api('GET', `/api/dashboards/${dashboard.id}`);
        check(readback.widgets[0].title === title && readback.widgets[0].spec.mode === 'structured' && readback.widgets.every(w => w.spec.mode !== 'sql'), 'OFF independent GET/reload preserves structured Save and no SQL history', readback); evidence.finalReadback = readback;
        check(errors.length === 0, 'No uncaught OFF native page errors', errors); evidence.verdict = 'PASS';
    } catch (error) { failures.push({ message: error.message, stack: error.stack }); evidence.verdict = 'FAIL'; }
    finally { await context.close(); }
    return evidence;
};
