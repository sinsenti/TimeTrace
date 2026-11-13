// Prepared native probe only. The caller supplies a fresh isolated daemon/profile.
// Successful fixture and status writes use the real API. No launch or cleanup is performed here.
async (page, baseURL) => {
    const origin = new URL(baseURL);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.port === '8002' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
        throw Error('Use an explicit non-8002 loopback scratch origin');
    }
    baseURL = origin.origin;
    const results = [], writes = [], errors = [], measurements = [];
    const check = (ok, message) => { if (!ok) throw Error(message); results.push(message); };
    const stamp = `08-composition-${Date.now()}`;
    const request = async (method, path, data) => {
        const response = await page.request[method](baseURL + path, data === undefined ? {} : {data});
        if (!response.ok()) throw Error(`${method} ${path}: ${response.status()}`);
        return response.status() === 204 ? null : response.json();
    };
    await request('get', '/api/tasks/statuses'); // Preserve existing seed-on-empty API behavior.
    const existing = await request('get', '/api/tasks/statuses');
    const position = Math.max(...existing.map(row => row.position), -1) + 1;
    const a = await request('post', '/api/tasks/statuses', {name: `${stamp} A`, position, color: '#ffffff'});
    const hidden = await request('post', '/api/tasks/statuses', {name: `${stamp} Hidden`, position: position + 1, is_hide_by_default: true});
    const c = await request('post', '/api/tasks/statuses', {name: `${stamp} C`, position: position + 2});
    const task = await request('post', '/api/tasks', {title: `${stamp} persisted task`, status: a.name, tags: '#original'});
    await request('post', '/api/tasks', {title: `${stamp} hidden task`, status: hidden.name});
    const unknown = await request('post', '/api/tasks', {title: `${stamp} unknown task`, status: `${stamp} missing definition`});
    await page.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, enableVimMotions: false, taskView: 'kanban'})));
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', r => {
        if (['POST', 'PUT', 'DELETE'].includes(r.method())) writes.push({path: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON()});
    });
    await page.goto(`${baseURL}/tasks`);
    await page.locator(`.kanban-col[data-status-id="${a.id}"]`).waitFor();
    check(await page.locator(`.kanban-col[data-status-id="${hidden.id}"]`).count() === 0, 'Hidden definition is absent from the visible board');

    // Exercise the real Sortable callback seam after a native DOM move; no private renderer.
    await page.evaluate(async ({a, c}) => {
        const container = document.getElementById('kanban_columns_container');
        const first = container.querySelector(`[data-status-id="${a}"]`);
        const moved = container.querySelector(`[data-status-id="${c}"]`);
        container.insertBefore(moved, first);
        await sortableColumnInstance.option('onEnd')({item: moved});
    }, {a: a.id, c: c.id});
    await page.waitForFunction(() => !statusOrderLocked());
    const ordered = await request('get', '/api/tasks/statuses');
    check(JSON.stringify(ordered.slice(-3).map(row => row.id)) === JSON.stringify([c.id, hidden.id, a.id]), 'Real board reorder preserves the hidden definition slot');
    check(new Set(ordered.map(row => row.position)).size === ordered.length, 'Real API order has no duplicate positions');

    await page.locator('#task_view_selector').selectOption('grouped');
    await page.locator('#tasks_search').fill(stamp);
    await page.locator(`.grouped-task[data-task-id="${task.id}"]`).waitFor();
    check(await page.locator(`.grouped-task[data-task-id="${unknown.id}"]`).count() === 1, 'Grouped retains unknown-status tasks under the active search');
    check((await page.locator('.grouped-summary').textContent()).includes('1 task in hidden statuses excluded'), 'Grouped reports the hidden matching task');
    await page.locator('#status_manager_entry').click();
    const statusRow = page.locator(`.status-manager-row[data-status-id="${a.id}"]`);
    const beforeViewport = page.viewportSize();
    await page.setViewportSize({width: 390, height: 900});
    await page.waitForFunction(() => {
        const fields = document.querySelector('#status_manager_list .status-fields');
        return fields && getComputedStyle(fields).gridTemplateColumns.trim().split(/\s+/).length === 3;
    });
    const narrow = await page.locator('#status_manager_modal .status-panel').evaluate(panel => {
        const rect = element => { const r = element.getBoundingClientRect(); return {left: r.left, right: r.right, width: r.width}; };
        return {viewport: innerWidth, panel: {...rect(panel), scroll: panel.scrollWidth, client: panel.clientWidth, padding: getComputedStyle(panel).paddingLeft},
            rows: Array.from(panel.querySelectorAll('.status-manager-row')).map(row => {
                const fields = row.querySelector('.status-fields');
                const labels = Array.from(fields.querySelectorAll('label'));
                return {...rect(row), scroll: row.scrollWidth, client: row.clientWidth,
                    columns: getComputedStyle(fields).gridTemplateColumns.trim().split(/\s+/),
                    nameSpan: [getComputedStyle(labels[0]).gridColumnStart, getComputedStyle(labels[0]).gridColumnEnd],
                    colorSpan: [getComputedStyle(labels[1]).gridColumnStart, getComputedStyle(labels[1]).gridColumnEnd],
                    controls: Array.from(row.querySelectorAll('input, button')).filter(control => control.getClientRects().length).map(rect)};
            })};
    });
    measurements.push({case: '390px computed status grid and overflow', ...narrow});
    check(narrow.viewport === 390 && narrow.panel.padding === '12px', '390px uses the computed scoped narrow panel rule');
    check(narrow.rows.length > 0 && narrow.rows.every(row => row.columns.length === 3 && row.columns.every(column => Number.isFinite(parseFloat(column)) && parseFloat(column) > 0)), '390px computes three finite status grid columns');
    check(narrow.rows.every(row => JSON.stringify(row.nameSpan) === '["1","-1"]' && JSON.stringify(row.colorSpan) === '["1","-1"]'), '390px Name and Color each span the full computed grid');
    check(narrow.panel.left >= 0 && narrow.panel.right <= 390 && narrow.panel.scroll <= narrow.panel.client + 1, '390px status panel fits the viewport without horizontal overflow');
    check(narrow.rows.every(row => row.scroll <= row.client + 1 && row.left >= narrow.panel.left && row.right <= narrow.panel.right && row.controls.every(control => control.left >= row.left && control.right <= row.right + 1)), '390px rows and input/action controls remain inside their wrapped row');
    if (beforeViewport) await page.setViewportSize(beforeViewport);
    let hold = false, releaseRead, startedRead;
    const released = new Promise(resolve => { releaseRead = resolve; });
    const started = new Promise(resolve => { startedRead = resolve; });
    await page.route(`**/api/tasks/statuses/${a.id}`, async route => {
        if (route.request().method() !== 'PUT') return route.continue();
        const response = await route.fetch();
        hold = true;
        return route.fulfill({response});
    });
    await page.route('**/api/tasks/statuses', async route => {
        if (hold && route.request().method() === 'GET') { startedRead(); await released; }
        return route.continue();
    });
    await statusRow.getByRole('textbox', {name: 'Name', exact: true}).fill(`${stamp} renamed A`);
    await statusRow.getByRole('button', {name: 'Save', exact: true}).click();
    await started;
    await statusRow.getByRole('textbox', {name: 'Name', exact: true}).press('Escape');
    await page.locator(`.grouped-task[data-task-id="${task.id}"]`).getByRole('button', {name: 'Edit', exact: true}).click();
    await page.locator('#modal_input_title').fill(`${stamp} unsaved title`);
    await page.locator('#modal_input_tags').fill('#unsaved');
    await page.locator('#task_child_title').fill(`${stamp} unsaved child`);
    const snapshot = () => page.evaluate(() => Object.fromEntries(['modal_input_title', 'modal_input_tags', 'task_child_title', 'modal_input_status'].map(id => [id, document.getElementById(id).value])));
    const before = await snapshot();
    const mutationCount = writes.length;
    hold = false; releaseRead();
    await page.waitForFunction(name => Array.from(document.getElementById('modal_input_status').options).some(option => option.value === name), `${stamp} renamed A`);
    await page.waitForFunction(() => taskKnowledge.state().status === 'fresh' && !taskKnowledge.state().loading);
    check(JSON.stringify(await snapshot()) === JSON.stringify(before), 'Grouped status ACK refresh retains task properties, queued child draft and exact old status choice');
    check(writes.length === mutationCount, 'Late metadata adoption does not synthesize task or child writes');
    check(await page.locator('#task_view_selector').inputValue() === 'grouped' && await page.locator('#tasks_search').inputValue() === stamp, 'Status refresh preserves Grouped selection and search');
    check(await page.locator(`.grouped-task[data-task-id="${unknown.id}"]`).count() === 1, 'Status refresh retains the unknown Grouped row');
    const savedTask = await request('get', `/api/tasks/${task.id}`);
    check(savedTask.title === task.title && savedTask.status === a.name && savedTask.status_id === a.id, 'Real task readback retains loose text/FK semantics and excludes unsaved drafts');
    await page.locator('#task_child_title').press('Escape');
    await page.unroute('**/api/tasks/statuses');
    await page.unroute(`**/api/tasks/statuses/${a.id}`);

    // Dedicated details own their initialized property and child drafts. They have no status manager
    // or cross-tab definition refresh contract on this two-view base: assert preservation only.
    await page.goto(`${baseURL}/task-inspector/${task.id}`);
    await page.locator('#inspector_edit_title').waitFor({state: 'visible'});
    await page.waitForFunction(() => !document.getElementById('task_properties_editor').disabled);
    await page.locator('#inspector_edit_title').fill(`${stamp} retained property title`);
    await page.locator('#inspector_edit_tags').fill('#retained_property');
    check(await page.locator('#inspector_edit_status').inputValue() === a.name, 'Dedicated detail keeps the custom stored-status fallback');
    await page.locator('#detail_add_subtask_btn').click();
    await page.locator('#modal_subtask_title').fill(`${stamp} retained child title`);
    await page.locator('#modal_subtask_tags').fill('#retained_child');
    await page.locator('#modal_subtask_status').selectOption('Done');
    const detailSnapshot = () => page.evaluate(() => Object.fromEntries(['inspector_edit_title', 'inspector_edit_tags', 'inspector_edit_status', 'modal_subtask_title', 'modal_subtask_tags', 'modal_subtask_status'].map(id => [id, document.getElementById(id).value])));
    const detailBefore = await detailSnapshot();
    const canonicalChild = await request('post', '/api/tasks', {title: `${stamp} server child`, parent_id: task.id});
    const beforeRetry = writes.length;
    const responseRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/tasks/${task.id}/tree` && response.ok());
    await page.locator('#subtask_modal').getByRole('button', {name: 'Retry refresh', exact: true}).click();
    await responseRead;
    await page.locator('#subtasks_tree_container').getByText(canonicalChild.title, {exact: true}).waitFor();
    await page.waitForFunction(() => !taskKnowledge.state().loading);
    check(JSON.stringify(await detailSnapshot()) === JSON.stringify(detailBefore), 'Read-only detail retry retains parent properties and child status choice');
    check(writes.length === beforeRetry, 'Detail retry performs no task, child or status writes');
    check(errors.length === 0, `No pageerrors: ${errors.join('; ')}`);
    return {results, writes, measurements, fakeBoundaries: ['held real post-status-ACK GET only'], limits: ['UNRUN authored probe', 'Sortable callback seam is not physical pointer/touch drag', 'Outline combined-source acceptance pending', 'No dedicated-page cross-tab status definition refresh asserted', 'Human visual/accessibility acceptance remains separate']};
}
