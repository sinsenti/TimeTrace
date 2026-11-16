// Manual probe: run only against a newly allocated isolated scratch daemon/profile.
// This file does not launch a daemon or browser; all successful writes use the real API.
async (page, baseURL) => {
    const origin = new URL(baseURL);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.port === '8002' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
        throw Error('Use an explicit non-8002 loopback scratch origin');
    }
    baseURL = origin.origin;
    const results = [], writes = [], errors = [], measurements = [];
    const check = (ok, message) => { if (!ok) throw Error(message); results.push(message); };
    const stamp = `08-${Date.now()}`;
    await page.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, enableVimMotions: false, taskView: 'kanban'})));
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { if (['POST', 'PUT', 'DELETE'].includes(r.method())) writes.push({url: new URL(r.url()).pathname, method: r.method(), body: r.postDataJSON()}); });
    const get = async path => { const r = await page.request.get(baseURL + path); if (!r.ok()) throw Error(`${path}: ${r.status()}`); return r.json(); };
    const create = async (name, position) => { const r = await page.request.post(`${baseURL}/api/tasks/statuses`, {data: {name, color: '#ffffff', position}}); if (!r.ok()) throw Error(`Fixture ${r.status()}`); return r.json(); };
    const a = await create(`${stamp} A`, 50), b = await create(`${stamp} B`, 51);
    const task = await (await page.request.post(`${baseURL}/api/tasks`, {data: {title: `${stamp} linked task`, status: b.name}})).json();
    const row = id => page.locator(`.status-manager-row[data-status-id="${id}"]`);
    const name = id => row(id).getByRole('textbox', {name: 'Name', exact: true});
    const waitSaved = id => row(id).locator('[role=status]').filter({hasText: 'Saved. Status list refreshed.'}).waitFor();
    await page.goto(`${baseURL}/tasks`); await page.waitForSelector('.kanban-col');
    await page.locator('#status_manager_entry').click();
    await name(a.id).fill(`${stamp} A unsaved`); await name(a.id).press('Tab');
    await page.waitForTimeout(150);
    check(!writes.some(r => r.method === 'PUT'), 'Editing and blur must not write before explicit Save');
    const literal = `${stamp} <img src=x onerror="window.STATUS_XSS=1"> ${'long '.repeat(15)}`;
    await name(b.id).fill(literal);
    await row(b.id).getByRole('textbox', {name: 'Color', exact: true}).fill('#ffffff');
    await row(b.id).getByRole('checkbox', {name: 'Calendar', exact: true}).check();
    await row(b.id).getByRole('button', {name: 'Save', exact: true}).click(); await waitSaved(b.id);
    check(await name(a.id).inputValue() === `${stamp} A unsaved`, 'Saving B retains independent A draft');
    check(await row(b.id).getByRole('button', {name: 'Save', exact: true}).evaluate(el => el === document.activeElement), 'Saved row keeps stable keyboard focus');
    await page.locator(`.kanban-col[data-status-id="${b.id}"] .kanban-card[data-task-id="${task.id}"]`).waitFor({state: 'attached'});
    check(true, 'Kanban refresh keeps renamed-status task in its canonical ID column');
    const readB = (await get('/api/tasks/statuses')).find(st => st.id === b.id);
    check(readB.name === literal && readB.color === '#ffffff' && readB.is_scheduled_trigger, 'Real API readback preserves literal name, custom color and flags');
    check(await page.evaluate(() => !window.STATUS_XSS && !document.querySelector('#status_manager_list img')), 'Status names render inertly');
    check((await get(`/api/tasks/${task.id}`)).status === b.name, 'Renaming status retains loose task status text');
    await row(a.id).getByRole('button', {name: 'Cancel', exact: true}).click();
    check(await name(a.id).inputValue() === a.name, 'Row Cancel discards only its unsaved edits');

    // Rejected update: only HTTP failure is fake; successful retry persists through the real API.
    let rejectUpdate = true;
    await page.route(`**/api/tasks/statuses/${a.id}`, route => route.request().method() === 'PUT' && rejectUpdate
        ? route.fulfill({status: 400, json: {detail: 'Synthetic update rejection'}}) : route.continue());
    await name(a.id).fill(`${stamp} retained rejection`);
    await row(a.id).getByRole('button', {name: 'Save', exact: true}).click();
    await row(a.id).locator('[role=status]').filter({hasText: 'Save not confirmed'}).waitFor();
    check(await name(a.id).inputValue() === `${stamp} retained rejection`, 'Rejected mutation retains fields');
    check(await row(a.id).getByRole('button', {name: 'Save', exact: true}).isDisabled(), 'Unconfirmed write requires read verification');
    rejectUpdate = false;
    await row(a.id).getByRole('button', {name: 'Retry refresh', exact: true}).click();
    await row(a.id).getByRole('button', {name: 'Save', exact: true}).waitFor({state: 'visible'});
    await page.waitForFunction(id => !document.querySelector(`[data-status-id="${id}"].status-manager-row button`).disabled, a.id);
    await row(a.id).getByRole('button', {name: 'Save', exact: true}).click(); await waitSaved(a.id);
    check((await get('/api/tasks/statuses')).some(st => st.name === `${stamp} retained rejection`), 'Explicit retry persists rejected update');
    await page.unroute(`**/api/tasks/statuses/${a.id}`);

    // Captured order, partial acknowledgements, explicit remaining-write retry.
    let rejectOrder = true;
    await page.route(`**/api/tasks/statuses/${b.id}`, route => route.request().method() === 'PUT' && route.request().postDataJSON()?.position !== undefined && rejectOrder
        ? route.fulfill({status: 400, json: {detail: 'Synthetic order rejection'}}) : route.continue());
    const orderStart = writes.length;
    await row(b.id).getByRole('button', {name: 'Move up', exact: true}).click();
    await page.locator('#status_order_retry').waitFor({state: 'visible'});
    const beforeRetry = writes.slice(orderStart).filter(r => r.method === 'PUT');
    check(beforeRetry.length > 1, 'Separate reorder acknowledges earlier positions before failure');
    rejectOrder = false;
    await page.locator('#status_order_retry').click();
    await page.waitForFunction(() => document.getElementById('status_manager_feedback').textContent === 'Order saved.');
    const repeated = writes.slice(orderStart).filter(r => r.method === 'PUT' && r.url === beforeRetry[0].url);
    check(repeated.length === 1, 'Order retry never replays acknowledged positions');
    const ordered = await get('/api/tasks/statuses');
    check(ordered.findIndex(st => st.id === b.id) < ordered.findIndex(st => st.id === a.id), 'Move up order persists via existing position endpoint');
    await page.unroute(`**/api/tasks/statuses/${b.id}`);
    await row(b.id).getByRole('button', {name: 'Move down', exact: true}).click();
    await page.waitForFunction(() => !statusManagerOwner.pendingOrder);
    check((await get('/api/tasks/statuses')).findIndex(st => st.id === a.id) < (await get('/api/tasks/statuses')).findIndex(st => st.id === b.id), 'Move down is a keyboard/touch reorder alternative');
    check(await row(b.id).getByRole('button', {name: 'Move down', exact: true}).evaluate(el => el === document.activeElement), 'Reorder retains focus on the same native button');

    // Create ACK then failed GET: canonical identity must be used for any later edit.
    await page.locator('#status_add_entry').click();
    check(await page.locator('#modal_new_status_name').evaluate(el => el === document.activeElement), 'Add focuses Name synchronously');
    let failRead = false, heldRelease, heldStarted;
    const held = new Promise(resolve => { heldRelease = resolve; });
    const started = new Promise(resolve => { heldStarted = resolve; });
    await page.route('**/api/tasks/statuses', async route => {
        if (route.request().method() === 'POST') {
            heldStarted(); await held;
            const response = await route.fetch(); failRead = true; return route.fulfill({response});
        }
        if (failRead && route.request().method() === 'GET') return route.fulfill({status: 503, json: {detail: 'Synthetic acknowledged-write refresh failure'}});
        return route.continue();
    });
    await page.locator('#modal_new_status_name').fill(`${stamp} created`);
    await page.locator('#status_add_save').click(); await started;
    await page.locator('#modal_new_status_name').fill(`${stamp} concurrent create draft`);
    heldRelease();
    await page.locator('#status_add_feedback').filter({hasText: 'Saved. Display refresh unavailable'}).waitFor();
    check(await page.locator('#status_add_save').isDisabled(), 'Known saved + failed GET is read-only');
    check(await page.locator('#modal_new_status_name').inputValue() === `${stamp} concurrent create draft`, 'Concurrent create input survives ACK and GET failure');
    const postCount = writes.filter(r => r.method === 'POST' && r.url.endsWith('/statuses')).length;
    failRead = false;
    await page.locator('#status_add_retry').click();
    await page.waitForFunction(() => !document.getElementById('status_add_save').disabled);
    check(writes.filter(r => r.method === 'POST' && r.url.endsWith('/statuses')).length === postCount, 'Retry refresh does not replay create');
    await page.unroute('**/api/tasks/statuses');
    await page.locator('#status_add_save').click();
    await page.locator('#status_add_feedback').filter({hasText: 'Saved. Status list refreshed.'}).waitFor();
    const createdRows = (await get('/api/tasks/statuses')).filter(st => st.name.startsWith(`${stamp} concurrent create draft`));
    check(createdRows.length === 1 && writes.filter(r => r.method === 'POST' && r.url.endsWith('/statuses')).length === postCount, 'Later Save edits canonical create ID, never creates twice');
    await page.locator('#modal_new_status_name').press('Escape');
    check(await page.locator('#status_add_entry').evaluate(el => el === document.activeElement), 'Escape restores connected Add launcher');

    // Delete confirmation cancellation, rejection, real in-use deletion and task readback.
    const deleteStart = writes.filter(r => r.method === 'DELETE').length;
    const deleteButton = row(b.id).getByRole('button', {name: 'Delete', exact: true});
    const confirmDialog = page.locator('#custom_confirm_modal');
    const confirmCancel = page.locator('#confirm_modal_cancel_btn');
    const confirmProceed = page.locator('#confirm_modal_proceed_btn');
    await deleteButton.click();
    await confirmDialog.waitFor({state: 'visible'});
    check(await confirmCancel.evaluate(el => el === document.activeElement), 'Delete confirmation initially focuses Cancel');
    await page.keyboard.press('Shift+Tab');
    check(await confirmProceed.evaluate(el => el === document.activeElement), 'Delete confirmation Shift+Tab wraps from Cancel to Confirm');
    await page.keyboard.press('Tab');
    check(await confirmCancel.evaluate(el => el === document.activeElement), 'Delete confirmation Tab wraps from Confirm to Cancel');
    await page.keyboard.press('Enter');
    await confirmDialog.waitFor({state: 'hidden'});
    check(writes.filter(r => r.method === 'DELETE').length === deleteStart, 'Enter on focused Cancel sends no DELETE');
    check(await deleteButton.evaluate(el => el === document.activeElement), 'Enter cancellation returns focus to the same Delete launcher');
    check((await get('/api/tasks/statuses')).some(st => st.id === b.id), 'Enter cancellation retains the real status row');
    await deleteButton.click();
    await confirmDialog.waitFor({state: 'visible'}); await page.keyboard.press('Escape');
    await confirmDialog.waitFor({state: 'hidden'});
    check(writes.filter(r => r.method === 'DELETE').length === deleteStart, 'Confirmation Escape cancels without deletion');
    check(await deleteButton.evaluate(el => el === document.activeElement), 'Escape cancellation returns focus to the same Delete launcher');
    let rejectDelete = true;
    await page.route(`**/api/tasks/statuses/${b.id}`, route => route.request().method() === 'DELETE' && rejectDelete ? route.fulfill({status: 400, json: {detail: 'Synthetic deletion restriction'}}) : route.continue());
    await row(b.id).getByRole('button', {name: 'Delete', exact: true}).click(); await page.locator('#confirm_modal_proceed_btn').click();
    await row(b.id).locator('[role=status]').filter({hasText: 'Save not confirmed'}).waitFor();
    check((await get('/api/tasks/statuses')).some(st => st.id === b.id), 'Server-rejected delete does not erase initial status list');
    rejectDelete = false; await row(b.id).getByRole('button', {name: 'Retry refresh', exact: true}).click();
    await page.waitForFunction(id => !document.querySelector(`[data-status-id="${id}"].status-manager-row button`).disabled, b.id);
    await row(b.id).getByRole('button', {name: 'Delete', exact: true}).click(); await page.locator('#confirm_modal_proceed_btn').click();
    await row(b.id).waitFor({state: 'detached'});
    const deletedTask = await get(`/api/tasks/${task.id}`);
    check(deletedTask.status === b.name && deletedTask.status_id === null, 'Existing in-use deletion keeps task text, clears optional ID, and never reassigns');
    await page.unroute(`**/api/tasks/statuses/${b.id}`);

    // Native Tab containment, themes, responsive geometry and neutral contrast despite white custom color.
    const samplePanel = selector => page.locator(selector).evaluate(el => {
            const rect = el.getBoundingClientRect(), input = el.querySelector('input'), button = el.querySelector('button');
            const contrast = (fg, bg) => {
                const lum = c => c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
                const a = lum(fg), b = lum(bg); return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
            };
            const s = getComputedStyle(el), i = getComputedStyle(input), b = getComputedStyle(button);
            return {x: rect.x, right: rect.right, width: innerWidth, scroll: el.scrollWidth, client: el.clientWidth,
                text: contrast(s.color, s.backgroundColor), input: contrast(i.color, i.backgroundColor), button: contrast(b.color, b.backgroundColor), border: contrast(b.borderTopColor, b.backgroundColor)};
        });
    for (const mode of ['refined', 'stone', 'porcelain', 'dark']) for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({width, height: 900});
        await page.evaluate(mode => { if (mode === 'dark') setAppearancePreference('appearance', 'dark'); else { setAppearancePreference('lightTheme', mode); setAppearancePreference('appearance', 'light'); } }, mode);
        await page.waitForTimeout(250);
        const sample = await samplePanel('#status_manager_modal .status-panel');
        measurements.push({mode, width, ...sample});
        check(sample.x >= 0 && sample.right <= width && sample.scroll <= sample.client + 1, `${mode}/${width}: scoped dialog geometry`);
        check(sample.text >= 4.5 && sample.input >= 4.5 && sample.button >= 4.5 && sample.border >= 3, `${mode}/${width}: scoped text/control contrast`);
        await page.locator('#status_add_entry').click();
        const addSample = await samplePanel('#add_status_modal .status-panel');
        measurements.push({mode, width, dialog: 'add', ...addSample});
        check(addSample.x >= 0 && addSample.right <= width && addSample.scroll <= addSample.client + 1, `${mode}/${width}: Add geometry`);
        check(addSample.text >= 4.5 && addSample.input >= 4.5 && addSample.button >= 4.5 && addSample.border >= 3, `${mode}/${width}: Add text/control contrast`);
        await page.locator('#modal_new_status_name').press('Shift+Tab');
        check(await page.locator('#status_add_save').evaluate(el => el === document.activeElement), `${mode}/${width}: Add reverse Tab wraps`);
        await page.keyboard.press('Tab');
        check(await page.locator('#modal_new_status_name').evaluate(el => el === document.activeElement), `${mode}/${width}: Add forward Tab wraps`);
        await page.keyboard.press('Escape');
    }
    const close = page.locator('#status_manager_modal').getByRole('button', {name: 'Close / discard unsaved drafts', exact: true});
    await close.focus(); await page.keyboard.press('Shift+Tab');
    check(await page.locator('#status_manager_modal').getByRole('button', {name: 'Done / discard unsaved drafts', exact: true}).evaluate(el => el === document.activeElement), 'Shift+Tab contains focus in manager');
    await page.keyboard.press('Escape');
    check(await page.locator('#status_manager_entry').evaluate(el => el === document.activeElement), 'Manager Escape restores stable launcher');
    check(errors.length === 0, `No pageerrors: ${errors.join('; ')}`);
    return {results, measurements, writes, fakeBoundaries: ['update/order/delete rejection', 'held real create response, then GET 503'], limits: ['Physical touch, pointer drag, screen reader, non-Chromium, exhaustive zoom/reduced motion unrun', 'Scoped measurements are not whole-app accessibility certification']};
}
