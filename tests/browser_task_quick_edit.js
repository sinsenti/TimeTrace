async (page, baseURL) => {
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    const errors = [], writes = [], results = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => {
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method())) writes.push({url: new URL(request.url()).pathname, body: request.postDataJSON()});
    });
    await page.addInitScript(() => { if (!localStorage.getItem('timetrace_user_settings')) localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, enableVimMotions: false})); });
    const list = async () => (await page.request.get(`${baseURL}/api/tasks?status=all`)).json();
    const stamp = `04-${Date.now()}`;
    let rejectChild = true;
    await page.route('**/api/tasks', async route => {
        const body = route.request().postDataJSON();
        if (route.request().method() === 'POST' && body.title === `${stamp} Second` && rejectChild) {
            rejectChild = false;
            return route.fulfill({status: 400, json: {detail: 'Synthetic second-child rejection'}});
        }
        return route.continue();
    });
    await page.goto(`${baseURL}/tasks`);
    await page.waitForSelector('.kanban-col');
    await page.getByRole('button', {name: '+ Create Task', exact: true}).click();
    assert(await page.locator('#modal_input_title').evaluate(el => document.activeElement === el), 'Immediate title focus');
    const beforeCancel = writes.filter(r => r.url === '/api/tasks').length;
    await page.locator('#modal_input_title').fill(`${stamp} Canceled`);
    await page.locator('#task_child_title').fill('Removed child');
    await page.locator('#task_child_title').press('Enter');
    await page.locator('#task_child_queue button').click();
    await page.locator('#task_child_title').fill('Unsubmitted cancel');
    await page.locator('#task_child_title').press('Escape');
    assert(await page.locator('#task_modal').evaluate(el => el.classList.contains('hidden')), 'Escape closed');
    assert(writes.filter(r => r.url === '/api/tasks').length === beforeCancel, 'Cancel made no task writes');

    await page.getByRole('button', {name: '+ Create Task', exact: true}).click();
    await page.locator('#modal_input_title').fill(`${stamp} Parent #effective [45m]`);
    await page.locator('#modal_input_tags').fill('#obsolete');
    await page.locator('#modal_input_category').selectOption('study');
    await page.locator('#task_child_title').fill(`${stamp} First`);
    await page.locator('#task_child_title').press('Enter');
    await page.locator('#task_child_title').fill(`${stamp} Second`);
    await page.locator('#task_save_btn').click();
    await page.waitForFunction(() => document.getElementById('task_save_feedback').textContent.includes('Retry saves only'));
    assert(await page.locator('#modal_input_title').isDisabled(), 'Saved parent locked during retry');
    let rows = (await list()).filter(t => t.title.startsWith(stamp));
    const parent = rows.find(t => t.title === `${stamp} Parent`);
    assert(parent && rows.length === 2, 'Real parent plus first child persisted before retry');
    assert(rows.find(t => t.title.endsWith('First')).parent_id === parent.id, 'Child attached to saved parent');
    await page.locator('#task_save_btn').click();
    await page.waitForFunction(() => document.getElementById('task_modal').classList.contains('hidden'));
    rows = (await list()).filter(t => t.title.startsWith(stamp));
    assert(rows.length === 3 && rows.every(t => t.tags === '#effective' && t.category === 'study'), 'Retry only unsaved; effective inheritance read back');
    const taskWrites = writes.filter(r => r.url === '/api/tasks');
    assert(taskWrites.length === beforeCancel + 4, 'One parent, one first child, rejected second then second retry');
    assert(taskWrites.filter(r => r.body.title === `${stamp} First`).length === 1, 'Successful child never replayed');
    results.push({workflow: 'real queued partial save/retry', parent: parent.id, rows: rows.map(t => ({id: t.id, title: t.title, parent_id: t.parent_id, tags: t.tags, category: t.category}))});

    // HTTP extraction fake is deliberately separate from the fake-model API tests.
    let parseCalls = 0;
    await page.route('**/api/ai/quick-add/parse', route => {
        parseCalls++;
        return route.fulfill({json: {tier: 2, fields: {title: '<img src=x onerror="window.injected=true">', tags: 'synthetic', estimated_duration_minutes: 30}}});
    });
    for (const path of ['/tasks', '/dashboard']) {
        await page.goto(`${baseURL}${path}`);
        await page.waitForFunction(() => typeof openNewTaskModal === 'function');
        if (path === '/tasks') await page.getByRole('button', {name: '+ Create Task', exact: true}).click();
        else await page.evaluate(() => openNewTaskModal());
        const before = (await list()).length;
        const parseBefore = parseCalls;
        await page.locator('#ai_quickadd_input').fill('Synthetic tomorrow at 3pm');
        await page.waitForFunction(() => document.getElementById('ai_quickadd_hint').textContent.includes('AI will parse'));
        assert(parseCalls === parseBefore && (await list()).length === before, 'Classify does not parse/save');
        await page.locator('#ai_quickadd_input').press('Enter');
        await page.waitForFunction(() => document.getElementById('ai_quickadd_hint').textContent.includes('Fields prefilled'));
        assert(parseCalls === parseBefore + 1 && (await list()).length === before, 'Enter Parse did not bubble Save');
        assert(await page.locator('#modal_input_title').inputValue() === '<img src=x onerror="window.injected=true">', 'Untrusted prefill literal');
        assert(!(await page.evaluate(() => window.injected)), 'Untrusted text inert');
        await page.locator('#modal_input_title').fill(`${stamp} Human ${path}`);
        await page.locator('#modal_input_desc').fill('Line one\nLine two');
        await page.locator('#modal_input_desc').press('Control+Enter');
        await page.waitForFunction(() => document.getElementById('task_modal').classList.contains('hidden'));
        const saved = (await list()).find(t => t.title === `${stamp} Human ${path}`);
        assert(saved && saved.description === 'Line one\nLine two', 'Explicit human save persisted edited extraction');
        results.push({workflow: `Quick Add ${path}`, saved: saved.id});
    }

    // Preserve the suspended Session owner through a real parent/child partial save.
    await page.evaluate(() => openCreateSessionModal(new Date(2026, 10, 4, 10), new Date(2026, 10, 4, 11)));
    await page.locator('#session_modal_notes').fill('Synthetic retained Session notes');
    const sessionSnapshot = await page.locator('#session_modal_start').inputValue();
    await page.evaluate(() => openTaskModalFromSessionModal());
    await page.locator('#modal_input_title').fill(`${stamp} Nested`);
    await page.locator('#task_child_title').fill(`${stamp} Nested child`);
    await page.locator('#task_save_btn').click();
    await page.waitForFunction(() => !document.getElementById('session_modal').classList.contains('hidden'));
    assert(await page.locator('#session_modal_notes').inputValue() === 'Synthetic retained Session notes', 'Nested save retained Session notes');
    assert(await page.locator('#session_modal_start').inputValue() === sessionSnapshot, 'Nested save retained Session time');
    const nestedId = await page.locator('#session_modal_task_id').inputValue();
    assert((await list()).some(t => t.id === nestedId && t.title === `${stamp} Nested`), 'Nested save attached real saved parent');
    assert(!writes.some(r => r.url === '/sessions'), 'Task creation never implicitly saves Session');
    await page.evaluate(() => closeSessionModal());
    assert(errors.length === 0, `Unexpected page errors: ${errors.join('; ')}`);
    return {results, parseCalls, writes, errors, boundaries: 'real task HTTP writes/readbacks; synthetic child rejection and Parse HTTP response; actual fake-model tests separate; default catalog fake; no providers'};
}
