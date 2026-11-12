/* Manual SQL-on probe with the separately approved native SQL-pane Settings caller.
 * Requires a NEW explicitly approved private daemon and guards on every context/page/API call.
 * Corrected fixture composition only: no native success or feature acceptance claimed by this file.
 */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    const p = await context.newPage();
    const checks = [], failures = [], errors = [], journal = [], requests = [], profiles = [], datasets = [], holds = [], unrun = [];
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const sql = "SELECT NULL AS x13, 0 AS y13 UNION ALL SELECT 'second', 2.5 UNION ALL SELECT 'third', 1";
    const spec = { mode: 'sql', sql: { sql, limit: 2, chart: 'bar', label_column: 'x13', value_column: 'y13' } };
    const evidence = { nonce, sql, spec, checks, failures, errors, journal, requests, profiles, datasets, holds, unrun,
        fakeBoundaries: ['catalog metadata fixture allowed only in guarded runner if used; actual usage captured separately', 'explicit preview response transport holds/aborts only; actual body unchanged'],
        limits: ['Synthetic private data only; no host-file/DoS/provider probes', 'Chromium keyboard/geometry and sampled contrast, not physical touch or accessibility certification', 'Current reviewed Timer-B/date parent; this SQL probe is not Timer startup certification', 'Original Settings UNRUN/capture/sequence limits remain historical; this new caller requires actual native proof'] };
    const check = (ok, name, data = null) => { checks.push({ name, passed: !!ok, data }); if (!ok) throw Error(name); };
    p.on('pageerror', e => errors.push(e.stack || e.message));
    const acceptDialog = d => d.accept();
    p.on('dialog', acceptDialog);
    p.on('request', r => { if (new URL(r.url()).origin === baseURL) requests.push({ path: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON() }); });
    await context.addInitScript(origin => {
        if (location.origin !== origin) return;
        if (!localStorage.getItem('timetrace_user_settings')) localStorage.setItem('timetrace_user_settings', JSON.stringify({ appearance: 'light', lightTheme: 'refined', idleDetectorEnabled: false }));
    }, baseURL);
    const api = async (method, path, body, status = 200) => {
        const response = await context.request.fetch(baseURL + path, { method, ...(body === undefined ? {} : { data: body }) });
        const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
        journal.push({ method, path, body, status: response.status(), response: data });
        check(response.status() === status, `Real API ${method} ${path}: ${status}`, data);
        return data;
    };
    const ready = async () => { await p.waitForFunction(() => currentDashboardData !== null); await p.waitForFunction(() => !document.querySelector('#widget_grid [aria-busy="true"]')); };
    const fields = () => p.evaluate(() => Object.fromEntries(['wb_title', 'wb_width', 'wb_mode', 'wb_sql', 'wb_sql_limit', 'wb_sql_chart', 'wb_sql_label_column', 'wb_sql_value_column'].map(id => [id, document.getElementById(id).value])));
    const previewFields = () => p.evaluate(() => ({
        visible: document.getElementById('wb_sql_preview').getClientRects().length > 0,
        columns: Array.from(document.querySelectorAll('#wb_sql_preview_head th')).map(el => el.textContent),
        rows: Array.from(document.querySelectorAll('#wb_sql_preview_body tr')).map(tr => Array.from(tr.cells).map(td => td.textContent)),
        meta: document.getElementById('wb_sql_meta').textContent
    }));
    const cancel = async () => { await p.locator('#widget_builder_modal').getByRole('button', { name: 'Cancel', exact: true }).click(); };
    let dashboard, widget, sibling;
    const detail = () => api('GET', `/api/dashboards/${dashboard.id}`);
    const row = async id => (await detail()).widgets.find(w => w.id === id);
    const open = async title => { await p.getByRole('button', { name: `Edit this widget: ${title}`, exact: true }).click(); await p.locator('#wb_sql').waitFor({ state: 'visible' }); };
    const preview = async () => {
        const response = p.waitForResponse(r => new URL(r.url()).pathname === '/analytics/sql' && r.request().method() === 'POST');
        await p.locator('#wb_sql').press('Control+Enter');
        const r = await response; const data = await r.json(); journal.push({ phase: 'nativePreview', request: r.request().postDataJSON(), status: r.status(), response: data });
        return { status: r.status(), data, request: r.request().postDataJSON() };
    };
    const holdNext = async reject => {
        let release, entered, rejectStart, finished;
        const gate = new Promise(r => release = r), start = new Promise((resolve, reject) => { entered = resolve; rejectStart = reject; });
        const done = new Promise(r => finished = r);
        let used = false, failure = null;
        const handler = async route => {
            if (used) return route.continue();
            used = true;
            try {
                const response = await route.fetch(); const actual = await response.json();
                const receipt = { phase: reject ? 'rejectedAutomaticPreviewTransport' : 'heldAutomaticPreviewTransport', request: route.request().postDataJSON(), status: response.status(), actual, released: false };
                holds.push(receipt); entered(receipt); await gate;
                receipt.released = true;
                if (reject) await route.abort('failed'); else await route.fulfill({ response });
            } catch (error) { failure = error; rejectStart(error); }
            finally { finished(); }
        };
        await context.route('**/analytics/sql', handler);
        return { start, release, finish: async () => {
            release(); await done; await context.unroute('**/analytics/sql', handler);
            if (failure) throw failure;
        } };
    };
    const chartSnapshot = id => p.evaluate(id => {
        const card = document.querySelector(`[data-widget-id="${id}"]`), c = dashboardCharts[id];
        return { id, text: card?.textContent, table: card ? Array.from(card.querySelectorAll('tbody tr')).map(tr => Array.from(tr.cells).map(td => td.textContent)) : [],
            chart: c ? { type: c.config.type, labels: c.data.labels, datasets: c.data.datasets.map(d => ({ label: d.label, data: d.data })) } : null };
    }, id);
    try {
        const caps = await api('GET', '/analytics/capabilities'); check(caps.sql_enabled === true, 'Actual capabilities enable SQL', caps);
        const schema = await api('GET', '/analytics/sql/schema'); evidence.schema = schema;
        const tables = schema.tables.map(t => t.name).sort();
        check(JSON.stringify(tables) === JSON.stringify(['dayreview', 'habit', 'habitgoalhistory', 'habitlog', 'ratingdefinition', 'ratingentry', 'recurrenceexception', 'session', 'task', 'taskreview', 'taskstatus'].sort()), 'Actual schema is exactly the existing analytics allowlist', tables);
        const baseline = await api('GET', '/api/dashboards'); evidence.baseline = baseline;
        check(baseline.find(d => d.slug === 'overview')?.widget_count === 9, 'Stats FIRST left Overview nine-widget baseline');
        dashboard = await api('POST', '/api/dashboards', { name: `SQL13-native-${nonce}` }, 201); evidence.dashboardId = dashboard.id;
        widget = await api('POST', `/api/dashboards/${dashboard.id}/widgets`, { title: `SQL13 bar ${nonce}`, width: 'full', spec }, 201); evidence.widgetId = widget.id;
        check(widget.spec.sql.label_column === 'x13' && widget.spec.sql.value_column === 'y13' && widget.spec.sql.sql === sql, 'Real Create normalized spec retains exact SQL and columns', widget);
        check(JSON.stringify((await row(widget.id)).spec) === JSON.stringify(widget.spec), 'Independent GET confirms saved full SQL spec');
        sibling = await api('POST', `/api/dashboards/${dashboard.id}/widgets`, { title: `SQL13 structured ${nonce}`, spec: { mode: 'structured', query: { source: 'tasks', measure: 'task_count', chart: 'tile' } } }, 201);
        evidence.siblingId = sibling.id;
        await p.goto(baseURL + '/stats'); await ready();
        await p.locator('#dashboard_tabs').getByRole('button', { name: dashboard.name, exact: true }).click(); await ready();
        await p.reload(); await ready();
        check(await p.locator(`[data-widget-id="${widget.id}"]`).count() === 1, 'Actual saved SQL card survives browser reload');
        for (const reject of [false, true]) {
            const held = await holdNext(reject); await open(widget.title); const actual = await held.start;
            check(actual.status === 200 && actual.actual.columns.join() === 'x13,y13', 'Automatic preview fetched real sandbox before transport hold', actual);
            const before = await fields(); check(before.wb_sql_label_column === 'x13' && before.wb_sql_value_column === 'y13', 'Saved metadata columns ready before preview delivery', before);
            const title = `${reject ? 'Rejected' : 'Held'} title ${nonce}`;
            await p.locator('#wb_title').fill(title);
            const start = requests.length;
            const ack = p.waitForResponse(r => r.url().endsWith(`/widgets/${widget.id}`) && r.request().method() === 'PUT');
            await p.locator('#wb_title').press('Control+Enter');
            const response = await ack; const saved = await response.json();
            journal.push({ phase: 'G1-fullspecSaveBeforePreviewRelease', transport: reject ? 'abort-after-ACK' : 'hold', status: response.status(), request: response.request().postDataJSON(), response: saved });
            check(response.status() === 200 && !actual.released, 'Real Save ACK while automatic preview transport still held', saved);
            const puts = requests.slice(start).filter(r => r.method === 'PUT');
            check(puts.length === 1 && puts[0].body.spec.sql.sql === sql && puts[0].body.spec.sql.label_column === 'x13' && puts[0].body.spec.sql.value_column === 'y13', 'Exactly one public full-spec PUT preserves SQL and both columns', puts);
            await p.waitForFunction(() => document.getElementById('widget_builder_modal').classList.contains('hidden'));
            const readback = await row(widget.id); check(readback.title === title && readback.spec.sql.label_column === 'x13' && readback.spec.sql.value_column === 'y13', 'Fresh public GET confirms G1 title and columns', readback);
            await held.finish(); widget = readback; await ready(); await p.reload(); await ready();
            await open(widget.title); await p.waitForFunction(() => document.getElementById('wb_sql_meta').textContent.includes('row(s)'));
            const reopened = await fields(); check(reopened.wb_title === title && reopened.wb_sql_label_column === 'x13' && reopened.wb_sql_value_column === 'y13', 'Reload and real Edit reopen retain G1 field values', reopened);
            await cancel();
        }
        // G3: identity changes invalidate A; actual bad SQL rejects only the preview/Save.
        await open(widget.title); await p.locator('#wb_sql_preview').waitFor({ state: 'visible' });
        const editStart = requests.length;
        await p.locator('#wb_sql').fill('SELECT absent13 FROM task'); await p.locator('#wb_sql_limit').fill('1'); await p.locator('#wb_sql_chart').selectOption('line');
        check(!await p.locator('#wb_sql_preview').isVisible() && (await p.locator('#wb_sql_meta').textContent()).includes('Inputs changed'), 'SQL/limit/chart edits hide A and mark preview stale');
        check(!requests.slice(editStart).some(r => r.path === '/analytics/sql' || ['PUT', 'DELETE'].includes(r.method)), 'Editing SQL/limit/chart triggers no implicit read or write', requests.slice(editStart));
        const bad = await preview(); check(bad.status === 400 && bad.data.detail === 'Unknown column. Check the schema reference in the SQL editor.', 'Actual B preview returns safe SQL400', bad);
        await p.getByText('Preview unavailable. Your inputs are retained; run preview again to retry.', { exact: true }).waitFor();
        check(!await p.locator('#wb_sql_preview').isVisible() && (await fields()).wb_sql === 'SELECT absent13 FROM task', 'Failed B retains input and does not present old output as current');
        const oldRow = await row(widget.id);
        const rejected = p.waitForResponse(r => r.url().endsWith(`/widgets/${widget.id}`) && r.request().method() === 'PUT');
        await p.locator('#wb_submit').click(); const rejectedResponse = await rejected;
        journal.push({ phase: 'actualInvalidSQLSave', status: rejectedResponse.status(), request: rejectedResponse.request().postDataJSON(), response: await rejectedResponse.json() });
        check(rejectedResponse.status() === 400 && JSON.stringify(await row(widget.id)) === JSON.stringify(oldRow), 'Real invalid full-spec Save400 leaves public row unchanged');
        const retryStart = requests.length; await p.locator('#wb_sql').fill(sql); await p.locator('#wb_sql_limit').fill('2');
        const retry = await preview(); check(retry.status === 200 && retry.data.rows[0][0] === null && retry.data.rows[0][1] === 0 && retry.data.rows[1][1] === 2.5, 'Explicit read-only Retry recovers actual null/zero/2.5 data', retry);
        check(requests.slice(retryStart).filter(r => r.path === '/analytics/sql').length === 1 && !requests.slice(retryStart).some(r => r.method === 'PUT'), 'Preview retry reads once and never replays failed Save', requests.slice(retryStart));
        await cancel();
        // Distinct old data tests late-owner rejection. The later Remove is a separate post-delivery control.
        const obsoleteSpec = { mode: 'sql', sql: { sql: "SELECT 'obsolete-owner-native13' AS old_x13, 913 AS old_y13", limit: 2, chart: 'bar', label_column: 'old_x13', value_column: 'old_y13' } };
        const doomed = await api('POST', `/api/dashboards/${dashboard.id}/widgets`, { title: `SQL13 removable ${nonce}`, spec: obsoleteSpec }, 201); evidence.deletedWidgetId = doomed.id;
        await p.reload(); await ready();
        const old = await holdNext(false); await open(doomed.title); const oldActual = await old.start;
        check(oldActual.status === 200 && oldActual.actual.columns.join() === 'old_x13,old_y13' && JSON.stringify(oldActual.actual.rows) === JSON.stringify([['obsolete-owner-native13', 913]]), 'Held old owner response has distinguishable real SQL columns and rows', oldActual);
        await p.locator('#wb_sql').press('Escape');
        await open(widget.title); await p.locator('#wb_sql_preview').waitFor({ state: 'visible' });
        await p.locator('#wb_title').fill(`New owner ${nonce}`);
        await p.locator('#wb_sql_label_column').selectOption('y13'); await p.locator('#wb_sql_value_column').selectOption('x13');
        const newer = await fields(), newerPreview = await previewFields();
        check(newer.wb_sql_label_column === 'y13' && newer.wb_sql_value_column === 'x13' && newerPreview.visible && newerPreview.columns.join() === 'x13,y13', 'New owner has distinct dirty selections and observed preview provenance', { newer, newerPreview });
        const delivered = p.waitForResponse(r => new URL(r.url()).pathname === '/analytics/sql' && r.request().method() === 'POST' && r.request().postDataJSON()?.sql === obsoleteSpec.sql.sql);
        await old.finish(); const oldResponse = await delivered, oldBody = await oldResponse.json(), completionError = await oldResponse.finished();
        journal.push({ phase: 'old-owner-real-response-delivered', request: oldResponse.request().postDataJSON(), status: oldResponse.status(), response: oldBody, completionError: completionError ? String(completionError) : null });
        check(oldResponse.status() === 200 && completionError === null && JSON.stringify(oldBody) === JSON.stringify(oldActual.actual), 'Original held response fully delivered unchanged before late-owner assertion', oldBody);
        await p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
        check(JSON.stringify(await fields()) === JSON.stringify(newer) && JSON.stringify(await previewFields()) === JSON.stringify(newerPreview), 'Completed distinct old response cannot replace reopened owner fields or preview provenance', { newer, newerPreview });
        await cancel();
        const removed = p.waitForResponse(r => r.url().endsWith(`/widgets/${doomed.id}`) && r.request().method() === 'DELETE');
        await p.getByRole('button', { name: `Remove this widget: ${doomed.title}`, exact: true }).click();
        check((await removed).status() === 204, 'Actual public caller removes own SQL widget'); await ready();
        check(!(await detail()).widgets.some(w => w.id === doomed.id), 'Fresh GET proves own removed SQL widget absent');
        // G4: real tiny query truncation plus actual Chart.js data, not warning-only evidence.
        const actualResult = await api('POST', '/analytics/sql', spec.sql); evidence.realTruncation = actualResult;
        check(actualResult.truncated === true && actualResult.row_count === 2 && JSON.stringify(actualResult.rows) === JSON.stringify([[null, 0], ['second', 2.5]]) && actualResult.warnings.includes('Result truncated to 2 rows.'), 'Actual sandbox returns tiny limit2of3 truncation/warning and exact rows', actualResult);
        for (const chart of ['table', 'bar', 'line', 'doughnut']) {
            widget = await api('PUT', `/api/dashboards/${dashboard.id}/widgets/${widget.id}`, { title: `SQL13 ${chart} ${nonce}`, width: 'full', spec: { mode: 'sql', sql: { ...spec.sql, chart } } });
            await p.reload(); await ready(); const sample = await chartSnapshot(widget.id); datasets.push(sample);
            check(sample.text.includes('Showing the first 2 rows.') && sample.text.includes('Result truncated to 2 rows.'), `Actual ${chart} card retains real truncation feedback with data`, sample);
            if (chart === 'table') check(JSON.stringify(sample.table) === JSON.stringify([['', '0'], ['second', '2.5']]), 'Actual SQL table retains null-label/zero/fraction rows', sample);
            else check(sample.chart?.type === chart && JSON.stringify(sample.chart.labels) === JSON.stringify(['', 'second']) && JSON.stringify(sample.chart.datasets[0].data) === JSON.stringify([0, 2.5]), `Actual Chart.js ${chart} retains exact null-label/zero/fraction dataset`, sample);
        }
        await open(widget.title); await p.locator('#wb_sql_preview').waitFor({ state: 'visible' });
        const options = await p.locator('#wb_sql_chart option').evaluateAll(nodes => nodes.map(n => n.value)); check(options.join() === 'table,bar,line,doughnut', 'Native SQL chart picker has only shipped table/bar/line/doughnut', options);
        const keyStart = requests.length; await p.locator('#wb_sql').press('End'); const sqlBefore = await p.locator('#wb_sql').inputValue(); await p.locator('#wb_sql').press('Enter');
        const enterEffects = requests.slice(keyStart).filter(r => r.path === '/analytics/sql' || (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && r.path.startsWith('/api/dashboards')));
        check((await p.locator('#wb_sql').inputValue()).length === sqlBefore.length + 1 && enterEffects.length === 0, 'Ordinary SQL Enter inserts newline without Preview or Save', { relevantRequests: enterEffects });
        const keyboard = await preview(); check(keyboard.status === 200 && !requests.slice(keyStart).some(r => r.method === 'PUT'), 'SQL CtrlEnter previews only, never saves');
        await cancel();
        // A long inert literal produces real result text and pane overflow without executable HTML.
        const literal = '<img src=x onerror="window.sql13Executed=true">' + 'SQL13-long-label-'.repeat(12);
        const pads = Array.from({ length: 24 }, (_, i) => `, ${i} AS pad13_${i}`).join('');
        const values = Array.from({ length: 24 }, (_, i) => `, ${i}`).join('');
        const longSQL = `SELECT '${literal.replaceAll("'", "''")}' AS x13, 0 AS y13${pads} UNION ALL SELECT 'second', 2.5${values} UNION ALL SELECT 'third', 1${values}`;
        // Commit the SQL change by moving to title BEFORE preview; blur must not invalidate the measured result.
        await open(widget.title); await p.locator('#wb_sql').fill(longSQL);
        await p.locator('#wb_title').fill('<literal> ' + 'SQL13LongTitle'.repeat(10));
        await preview(); await p.locator('#wb_sql_preview').waitFor({ state: 'visible' });
        for (const theme of ['refined', 'stone', 'porcelain', 'dark']) {
            await p.evaluate(theme => { if (theme === 'dark') setAppearancePreference('appearance', 'dark'); else { setAppearancePreference('appearance', 'light'); setAppearancePreference('lightTheme', theme); } }, theme);
            for (const width of [390, 768, 1024, 1440]) {
                await p.setViewportSize({ width, height: 1000 }); await p.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
                const measured = await p.evaluate(() => {
                    const modal = document.getElementById('widget_builder_modal'), dialog = modal.querySelector('.wb-dialog'), pane = document.getElementById('wb_pane_sql'), preview = document.getElementById('wb_sql_preview');
                    const b = document.getElementById('wb_submit'), q = document.getElementById('wb_sql');
                    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height }; };
                    return { documentOverflow: document.documentElement.scrollWidth > innerWidth, dialog: rect(dialog), pane: rect(pane), sql: rect(q), save: rect(b), previewScrollWidth: preview.scrollWidth, previewClientWidth: preview.clientWidth,
                        previewOverflowX: getComputedStyle(preview).overflowX, text: preview.textContent, injectedElements: preview.querySelectorAll('img,script').length, executed: window.sql13Executed === true,
                        title: document.getElementById('wb_title').value, color: getComputedStyle(q).color, background: getComputedStyle(q).backgroundColor,
                        fieldLabels: ['wb_sql', 'wb_sql_limit', 'wb_sql_chart', 'wb_sql_label_column', 'wb_sql_value_column'].map(id => ({ id, label: modal.querySelector(`label[for="${id}"]`)?.textContent })), meta: document.getElementById('wb_sql_meta').textContent,
                        help: document.getElementById('wb_sql_resources').textContent };
                });
                const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
                const a = luminance(measured.color), b = luminance(measured.background); measured.contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
                profiles.push({ theme, width, ...measured });
                check(!measured.documentOverflow && measured.dialog.x >= 0 && measured.dialog.right <= width + 1 && measured.save.width >= 32 && measured.save.height >= 32, `Bounded SQL pane and native controls ${theme}/${width}`, measured);
                check(measured.previewScrollWidth > measured.previewClientWidth && ['auto', 'scroll'].includes(measured.previewOverflowX) && measured.injectedElements === 0 && !measured.executed && measured.text.includes(literal), `SQL preview scrolls horizontally and long label stays inert ${theme}/${width}`);
                check(measured.contrast >= 4.5 && measured.fieldLabels.every(v => !!v.label) && measured.help.includes('first 20'), `SQL sampled contrast/field labels/resource provenance ${theme}/${width}`, measured.contrast);
            }
        }
        await p.setViewportSize({ width: 1440, height: 1000 });
        // Native Tab wrapping uses actual surviving elements, not injected implementation.
        const first = p.getByRole('button', { name: 'Close widget editor', exact: true }), last = p.locator('#wb_submit');
        await first.focus(); await p.keyboard.press('Shift+Tab'); check(await last.evaluate(el => el === document.activeElement), 'Native ShiftTab wraps to last modal field');
        await p.keyboard.press('Tab'); check(await first.evaluate(el => el === document.activeElement), 'Native Tab wraps back to first modal field');
        // New owner-approved entry, not a forced click through the modal or a handler callback.
        const settingsLink = p.locator('#wb_sql_settings_link');
        check(await settingsLink.isVisible() && await settingsLink.getAttribute('href') === '/settings', 'Approved SQL-pane Settings link is natively reachable');
        await p.locator('#wb_title').fill(`Departure draft ${nonce}`);
        await p.locator('#wb_width').selectOption('half');
        await p.locator('#wb_sql_limit').fill('3');
        await p.locator('#wb_sql_chart').selectOption('bar');
        const departurePreview = await preview();
        const departureColumns = ['x13', 'y13', ...Array.from({ length: 24 }, (_, i) => `pad13_${i}`)];
        const departurePads = Array.from({ length: 24 }, (_, i) => i);
        const departureRows = [[literal, 0, ...departurePads], ['second', 2.5, ...departurePads], ['third', 1, ...departurePads]];
        check(departurePreview.status === 200 && departurePreview.request?.sql === longSQL && departurePreview.request.limit === 3 && departurePreview.request.chart === 'bar' &&
            JSON.stringify(departurePreview.data.columns) === JSON.stringify(departureColumns) && JSON.stringify(departurePreview.data.rows) === JSON.stringify(departureRows) &&
            departurePreview.data.row_count === 3 && departurePreview.data.truncated === false && JSON.stringify(departurePreview.data.warnings) === '[]',
        'Departure preview succeeds for the exact final SQL, limit, chart and three-row result', departurePreview);
        evidence.departurePreview = departurePreview;
        const departureDOM = { sql: longSQL, columns: departureColumns, rows: departureRows.map(row => row.map(String)), meta: `3 row(s) in ${departurePreview.data.elapsed_ms}ms` };
        await p.waitForFunction(expected => {
            const preview = document.getElementById('wb_sql_preview');
            const columns = Array.from(document.querySelectorAll('#wb_sql_preview_head th')).map(el => el.textContent);
            const rows = Array.from(document.querySelectorAll('#wb_sql_preview_body tr')).map(tr => Array.from(tr.cells).map(td => td.textContent));
            return preview.getClientRects().length > 0 && JSON.stringify(columns) === JSON.stringify(expected.columns) && JSON.stringify(rows) === JSON.stringify(expected.rows) &&
                document.getElementById('wb_sql_meta').textContent === expected.meta && document.getElementById('wb_error').classList.contains('hidden') &&
                document.getElementById('wb_sql').value === expected.sql && document.getElementById('wb_sql_limit').value === '3' && document.getElementById('wb_sql_chart').value === 'bar';
        }, departureDOM);
        const renderedDeparturePreview = await previewFields();
        check(renderedDeparturePreview.visible && JSON.stringify(renderedDeparturePreview.columns) === JSON.stringify(departureDOM.columns) &&
            JSON.stringify(renderedDeparturePreview.rows) === JSON.stringify(departureDOM.rows) && renderedDeparturePreview.meta === departureDOM.meta,
        'Departure current preview is successfully rendered before cancellation', renderedDeparturePreview);
        await p.locator('#wb_sql_label_column').selectOption('y13');
        await p.locator('#wb_sql_value_column').selectOption('x13');
        const departureBefore = { fields: await fields(), preview: await previewFields(), url: p.url() };
        evidence.settingsDeparture = { approvedSpec: 'specs/sql-widget-settings-departure.md', before: departureBefore, attempts: [] };
        p.off('dialog', acceptDialog); // Earlier own Remove confirmation is distinct from Cancel here.
        for (const activation of ['pointer', 'keyboard']) {
            if (activation === 'keyboard') {
                const order = await p.locator('#widget_builder_modal').evaluate(modal => Array.from(modal.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]'))
                    .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length)
                    .map(el => el.id || el.getAttribute('aria-label') || el.tagName));
                const index = order.indexOf('wb_sql_settings_link');
                check(index > 0 && order[0] === 'Close widget editor', 'Native Settings keyboard path has an observed tab order', order);
                await first.focus();
                for (let i = 0; i < index; i++) await p.keyboard.press('Tab');
                check(await settingsLink.evaluate(el => el === document.activeElement), 'Native Tab traversal reaches SQL Settings link');
            }
            const requestStart = requests.length;
            // Subscribe BEFORE actual input; dismiss the browser's real dialog, never auto-accept it.
            const [dialog] = await Promise.all([
                p.waitForEvent('dialog').then(async d => { const value = { type: d.type(), message: d.message() }; await d.dismiss(); return value; }),
                activation === 'pointer' ? settingsLink.click() : settingsLink.press('Enter')
            ]);
            const after = { fields: await fields(), preview: await previewFields(), url: p.url() };
            const mutations = requests.slice(requestStart).filter(r => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && r.path.startsWith('/api/dashboards'));
            const attempt = { activation, dialog, after, mutations };
            evidence.settingsDeparture.attempts.push(attempt);
            check(dialog.type === 'confirm' && dialog.message === 'Leave this page and discard unsaved changes?', `Actual Settings ${activation} caller opens existing dirty confirmation`, dialog);
            check(JSON.stringify(after) === JSON.stringify(departureBefore) && await p.locator('#widget_builder_modal').isVisible(), `Native Settings ${activation} Cancel retains SQL draft and preview`, attempt);
            check(mutations.length === 0, `Native Settings ${activation} Cancel makes no persistence write`, mutations);
        }
        await p.locator('#wb_sql').press('Escape');
        check(await p.locator('#widget_builder_modal').evaluate(el => el.classList.contains('hidden')) && await p.evaluate(() => !!document.activeElement.closest('.canvas-widget-controls, .canvas-actions')), 'Native Escape closes SQL editor and restores surviving launcher focus');
        check(errors.length === 0, 'No uncaught SQL native page errors', errors);
        evidence.finalReadback = await detail(); evidence.verdict = unrun.length ? 'PASS_SCOPED_WITH_UNRUN' : 'PASS';
    } catch (error) {
        failures.push({ message: error.message, stack: error.stack }); evidence.verdict = 'FAIL';
        evidence.failureURL = p.url(); evidence.failureFields = await fields().catch(e => ({ inspectionError: e.message }));
        evidence.failureText = await p.locator('body').textContent().catch(e => e.message);
    } finally { await context.close(); }
    return evidence;
};
