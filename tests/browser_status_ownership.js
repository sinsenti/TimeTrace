// Manual probe: run only against a newly allocated isolated scratch daemon/profile.
// This file does not launch a daemon or browser; all successful writes use the real API.
async (page, baseURL) => {
    const origin = new URL(baseURL);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.port === '8002' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
        throw Error('Use an explicit non-8002 loopback scratch origin');
    }
    baseURL = origin.origin;
    const results = [], writes = [], errors = [];
    const check = (ok, message) => { if (!ok) throw Error(message); results.push(message); };
    const stamp = `08-owners-${Date.now()}`;
    await page.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, enableVimMotions: false, taskView: 'kanban'})));
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { if (['POST', 'PUT', 'DELETE'].includes(r.method())) writes.push({path: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON()}); });
    await page.goto(`${baseURL}/tasks`); await page.waitForSelector('.kanban-col');
    await page.locator('#status_manager_entry').click(); await page.locator('#status_add_entry').click();
    let reject = true;
    await page.route('**/api/tasks/statuses', route => route.request().method() === 'POST' && reject
        ? route.fulfill({status: 400, json: {detail: 'Synthetic create rejection'}}) : route.continue());
    await page.locator('#modal_new_status_name').fill(`${stamp} rejected`); await page.locator('#status_add_save').click();
    await page.locator('#status_add_feedback').filter({hasText: 'Save not confirmed'}).waitFor();
    check(await page.locator('#modal_new_status_name').inputValue() === `${stamp} rejected`, 'Failed create retains draft');
    check(await page.locator('#status_add_save').isDisabled(), 'Rejected create locks mutation until explicit verification');
    reject = false; const beforeVerify = writes.length;
    await page.locator('#status_add_retry').click(); await page.waitForFunction(() => !document.getElementById('status_add_save').disabled);
    check(writes.length === beforeVerify, 'Create verification performs reads only');
    await page.locator('#status_add_save').click();
    await page.locator('#status_add_feedback').filter({hasText: 'Saved. Status list refreshed.'}).waitFor();
    let rows = await (await page.request.get(`${baseURL}/api/tasks/statuses`)).json();
    check(rows.filter(st => st.name === `${stamp} rejected`).length === 1, 'Explicit create retry persists exactly one real row after rejection');
    await page.locator('#modal_new_status_name').press('Escape'); await page.unroute('**/api/tasks/statuses');

    // Native pending create A -> Escape -> new create B; old ACK cannot consume B's baseline/focus.
    await page.locator('#status_add_entry').click();
    let release, started;
    const held = new Promise(resolve => { release = resolve; }), start = new Promise(resolve => { started = resolve; });
    await page.route('**/api/tasks/statuses', async route => {
        if (route.request().method() === 'POST') { started(); await held; }
        return route.continue();
    });
    await page.locator('#modal_new_status_name').fill(`${stamp} old owner`); await page.locator('#status_add_save').click(); await start;
    await page.locator('#modal_new_status_name').press('Escape'); await page.locator('#status_add_entry').click();
    await page.locator('#modal_new_status_name').fill(`${stamp} new owner`);
    await page.locator('#modal_new_status_color').focus();
    release();
    await page.waitForResponse(r => r.url().endsWith('/api/tasks/statuses') && r.request().method() === 'POST');
    await page.waitForFunction(() => !taskKnowledge.state().loading);
    check(await page.locator('#modal_new_status_name').inputValue() === `${stamp} new owner`, 'Late create ACK leaves newer Add draft intact');
    check(await page.locator('#modal_new_status_color').evaluate(el => el === document.activeElement), 'Late create ACK cannot steal newer focus');
    check(await page.evaluate(() => hasSettingsDrafts(['add_status_modal'])), 'Late old writer cannot checkpoint newer Add owner');
    await page.locator('#modal_new_status_name').press('Escape'); await page.unroute('**/api/tasks/statuses');

    // Commit a real create but deliberately lose its response: uncertain is not failed or idempotent.
    await page.locator('#status_add_entry').click();
    await page.route('**/api/tasks/statuses', async route => {
        if (route.request().method() === 'POST') { await route.fetch(); return route.abort('connectionfailed'); }
        return route.continue();
    });
    await page.locator('#modal_new_status_name').fill(`${stamp} response lost`); await page.locator('#status_add_save').click();
    await page.locator('#status_add_feedback').filter({hasText: 'Save not confirmed'}).waitFor();
    const lostPostCount = writes.filter(r => r.method === 'POST' && r.path.endsWith('/statuses')).length;
    await page.locator('#status_add_retry').click(); await page.waitForFunction(() => !document.getElementById('status_add_save').disabled);
    rows = await (await page.request.get(`${baseURL}/api/tasks/statuses`)).json();
    check(rows.filter(st => st.name === `${stamp} response lost`).length === 1, 'Lost real POST response is verified as persisted through a separate read');
    check(writes.filter(r => r.method === 'POST' && r.path.endsWith('/statuses')).length === lostPostCount, 'Uncertain create verification never replays POST');
    check((await page.locator('#status_add_feedback').textContent()).includes('not confirmed'), 'Read verification does not falsely claim receipt or transport idempotency');
    await page.locator('#modal_new_status_name').press('Escape'); await page.unroute('**/api/tasks/statuses');

    // Hold the first post-ACK display read, dismiss statuses, open a real Task draft, then release.
    rows = await (await page.request.get(`${baseURL}/api/tasks/statuses`)).json();
    const selected = rows.find(st => st.name === `${stamp} rejected`);
    const row = page.locator(`.status-manager-row[data-status-id="${selected.id}"]`);
    let holdReads = false, readRelease, readStarted;
    const readHeld = new Promise(resolve => { readRelease = resolve; }), readStart = new Promise(resolve => { readStarted = resolve; });
    await page.route(`**/api/tasks/statuses/${selected.id}`, async route => {
        if (route.request().method() === 'PUT') { const response = await route.fetch(); holdReads = true; return route.fulfill({response}); }
        return route.continue();
    });
    await page.route('**/api/tasks/statuses', async route => { if (route.request().method() === 'GET' && holdReads) { readStarted(); await readHeld; } return route.continue(); });
    await row.getByRole('textbox', {name: 'Name', exact: true}).fill(`${stamp} saved while task opens`);
    await row.getByRole('button', {name: 'Save', exact: true}).click(); await readStart;
    await row.getByRole('textbox', {name: 'Name', exact: true}).press('Escape');
    await page.getByRole('button', {name: '+ Create Task', exact: true}).click();
    await page.locator('#modal_input_title').fill(`${stamp} unsaved Task title`);
    await page.locator('#modal_input_tags').fill('#unsaved_tag');
    await page.locator('#task_child_title').fill('unsaved child');
    const beforeTask = await page.evaluate(() => ({title: document.getElementById('modal_input_title').value, tags: document.getElementById('modal_input_tags').value, child: document.getElementById('task_child_title').value, status: document.getElementById('modal_input_status').value}));
    holdReads = false; readRelease();
    await page.waitForFunction(() => taskKnowledge.state().status === 'fresh' && !taskKnowledge.state().loading);
    await page.waitForFunction(() => Array.from(document.getElementById('modal_input_status').options).some(o => o.textContent.includes('saved while task opens')));
    const afterTask = await page.evaluate(() => ({title: document.getElementById('modal_input_title').value, tags: document.getElementById('modal_input_tags').value, child: document.getElementById('task_child_title').value, status: document.getElementById('modal_input_status').value}));
    check(JSON.stringify(beforeTask) === JSON.stringify(afterTask), 'Late saved-status metadata refresh retains open Task title/tags/child/status draft');
    check(await page.locator('#task_child_title').evaluate(el => el === document.activeElement), 'Late status refresh leaves Task typing focus intact');
    await page.locator('#task_child_title').press('Escape');
    await page.unroute('**/api/tasks/statuses'); await page.unroute(`**/api/tasks/statuses/${selected.id}`);
    await page.locator('#status_manager_entry').click();
    check(await page.locator(`.status-manager-row[data-status-id="${selected.id}"]`).count() === 1, 'Manager reopen has one row per canonical status');
    await page.locator('#status_manager_modal').getByRole('button', {name: 'Close / discard unsaved drafts', exact: true}).click();
    check(!await page.evaluate(() => hasSettingsDrafts([...settingsDrafts.keys()].filter(id => typeof id === 'string' && id.startsWith('status_draft_')))), 'Closed status drafts are no longer shared departure owners');
    check(errors.length === 0, `No pageerrors: ${errors.join('; ')}`);
    return {results, writes, fakeBoundaries: ['create 400 rejection', 'held real create and metadata responses', 'real committed create response deliberately aborted'], limits: ['Tasks page has no Session editor; Calendar Session flows are outside this probe', 'No physical touch/pointer drag/screen-reader/other browser engine']};
}
