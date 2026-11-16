// Manual probe: run only against a newly allocated isolated scratch daemon/profile.
// This file does not launch a daemon or browser; all successful writes use the real API.
async (page, baseURL) => {
    const origin = new URL(baseURL);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.port === '8002' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
        throw Error('Use an explicit non-8002 loopback scratch origin');
    }
    baseURL = origin.origin;
    const results = [], traffic = [], acknowledgements = [], errors = [];
    const check = (ok, message) => { if (!ok) throw Error(message); results.push(message); };
    const stamp = `08-order-${Date.now()}`;
    const get = async () => {
        const response = await page.request.get(`${baseURL}/api/tasks/statuses`);
        if (!response.ok()) throw Error(`Status readback HTTP ${response.status()}`);
        return response.json();
    };
    const create = async name => {
        const response = await page.request.post(`${baseURL}/api/tasks/statuses`, {data: {name, position: name.endsWith('A') ? 100 : 101, color: '#ffffff'}});
        if (!response.ok()) throw Error(`Status fixture HTTP ${response.status()}`);
        return response.json();
    };
    const a = await create(`${stamp} A`), b = await create(`${stamp} B`);
    await page.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, enableVimMotions: false, taskView: 'kanban'})));
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/tasks/statuses')) traffic.push({method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON()});
    });
    await page.goto(`${baseURL}/tasks`); await page.waitForSelector('.kanban-col');
    await page.locator('#status_manager_entry').click();
    const row = id => page.locator(`.status-manager-row[data-status-id="${id}"]`);
    await row(b.id).getByRole('textbox', {name: 'Name', exact: true}).fill(`${stamp} saved B`);
    await row(b.id).getByRole('button', {name: 'Save', exact: true}).click();
    await row(b.id).locator('[role=status]').filter({hasText: 'Saved. Status list refreshed.'}).waitFor();
    await row(a.id).getByRole('textbox', {name: 'Name', exact: true}).fill(`${stamp} independent draft`);
    await row(a.id).getByRole('textbox', {name: 'Color', exact: true}).fill('rebeccapurple');
    await row(a.id).getByRole('checkbox', {name: 'Calendar', exact: true}).check();
    let failRead = false, holdOld = true, releaseOld, oldStarted;
    const held = new Promise(resolve => { releaseOld = resolve; });
    const started = new Promise(resolve => { oldStarted = resolve; });
    await page.route('**/api/tasks/statuses', async route => {
        if (route.request().method() === 'GET' && holdOld) {
            holdOld = false; const response = await route.fetch(); oldStarted(); await held; return route.fulfill({response});
        }
        if (route.request().method() === 'GET' && failRead) return route.fulfill({status: 503, json: {detail: 'Explicit order verification GET failure'}});
        return route.continue();
    });
    await page.route('**/api/tasks/statuses/*', async route => {
        if (route.request().method() === 'PUT' && route.request().postDataJSON()?.position !== undefined) {
            const response = await route.fetch();
            if (!response.ok()) throw Error(`Real position PUT HTTP ${response.status()}`);
            acknowledgements.push({id: route.request().url().split('/').at(-1), status: response.status(), body: await response.json()});
            failRead = true; return route.fulfill({response});
        }
        return route.continue();
    });
    await page.evaluate(() => { void refreshStatusManagement(); }); await started;
    const orderWrites = () => traffic.filter(r => r.method === 'PUT' && r.body?.position !== undefined);
    await row(b.id).getByRole('button', {name: 'Move up', exact: true}).click();
    await page.locator('#status_manager_feedback').filter({hasText: 'Order saved. Retry refresh reads only.'}).waitFor();
    const count = orderWrites().length;
    check(count === acknowledgements.length && count > 1, 'Every captured order PUT has a real server ACK before failed verification GET');
    check(await row(a.id).getByRole('button', {name: 'Move up', exact: true}).isDisabled(), 'Manager native Move up is visibly disabled after ACK plus failed GET');
    check(await row(a.id).getByRole('button', {name: 'Move down', exact: true}).isDisabled(), 'Manager native Move down is visibly disabled after ACK plus failed GET');
    check(await page.evaluate(() => sortableColumnInstance.option('disabled') && sortableStatusListInstance.option('disabled')), 'Board and manager Sortable reorder controls are disabled');
    check(await page.locator('.kanban-col-header[aria-disabled="true"]').count() > 0, 'Board headers expose the order verification lock');
    await page.evaluate(() => { void saveBoardStatusOrder(allStatuses.map(st => st.id)); void moveStatusRow(allStatuses[0].id, 1); void saveStatusOrder(allStatuses.map(st => st.id)); });
    check(orderWrites().length === count, 'Both board and manager handler guards refuse new order PUTs');
    releaseOld();
    await page.waitForResponse(response => response.url().endsWith('/api/tasks/statuses') && response.status() === 200);
    await page.evaluate(() => Promise.resolve());
    check(await row(a.id).getByRole('button', {name: 'Move up', exact: true}).isDisabled(), 'Late prewrite GET cannot unlock acknowledged order');
    await page.locator('#status_order_retry').click();
    await page.locator('#status_manager_feedback').filter({hasText: 'Order saved. Retry refresh reads only.'}).waitFor();
    check(orderWrites().length === count, 'Failed explicit Retry refresh is read-only');
    check(await row(a.id).getByRole('button', {name: 'Save', exact: true}).isEnabled(), 'Independent row Save is not frozen by the order lock');
    check(await row(a.id).getByRole('textbox', {name: 'Name', exact: true}).inputValue() === `${stamp} independent draft`, 'Independent name draft survives failed and stale reads');
    check(await row(a.id).getByRole('textbox', {name: 'Color', exact: true}).inputValue() === 'rebeccapurple', 'Independent raw color draft survives');
    check(await row(a.id).getByRole('checkbox', {name: 'Calendar', exact: true}).isChecked(), 'Independent flag draft survives');
    check((await row(b.id).locator('[role=status]').textContent()).includes('Saved.'), 'Order receipt does not erase an independent saved-row notice');
    failRead = false;
    await page.unroute('**/api/tasks/statuses/*');
    await page.locator('#status_order_retry').click();
    await page.waitForFunction(id => !document.querySelector(`.status-manager-row[data-status-id="${id}"] [data-status-order]`).disabled, a.id);
    const verified = await get();
    const adopted = await page.locator('.status-manager-row').evaluateAll(rows => rows.map(row => row.dataset.statusId));
    check(JSON.stringify(adopted) === JSON.stringify(verified.map(st => st.id)), 'Successful current GET adopts actual server order into existing manager nodes');
    const board = await page.locator('.kanban-col').evaluateAll(cols => cols.map(col => col.dataset.statusId));
    check(JSON.stringify(board) === JSON.stringify(verified.filter(st => !st.is_hide_by_default).map(st => st.id)), 'Visible board adopts actual server order before reordering is enabled');
    check(orderWrites().length === count, 'Successful verification performs zero PUTs and never replays ACKs');
    check(await page.evaluate(id => hasSettingsDrafts([`status_draft_${id}`]), a.id), 'Independent draft remains owned after successful verification');
    await row(b.id).getByRole('button', {name: 'Move down', exact: true}).click();
    await page.waitForFunction(() => !statusOrderLocked());
    check(orderWrites().length === count + verified.length, 'Next explicit human move performs one legitimate order sequence');
    const final = await get();
    check(final.findIndex(st => st.id === a.id) < final.findIndex(st => st.id === b.id), 'Independent real API readback confirms the next move');
    await page.locator('#status_manager_modal').getByRole('button', {name: 'Close / discard unsaved drafts', exact: true}).click();
    check(!await page.evaluate(() => sortableColumnInstance.option('disabled')), 'Visible board reorder is reenabled after verified adoption');
    check(errors.length === 0, `No pageerrors: ${errors.join('; ')}`);
    return {results, traffic, acknowledgements, verified, final, fakeBoundaries: ['one held real prewrite GET', 'post-ACK GET 503'], limits: ['Board guard tested through real handler and native disabled state, not a physical drag', 'No physical touch, screen reader or non-Chromium']};
}
