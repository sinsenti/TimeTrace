async (page, baseURL) => {
    const checks = [], errors = [], writes = [];
    const check = (name, ok, details) => checks.push({name, ok, details});
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push({method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON()});
    });
    await page.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, enableVimMotions: false})));
    const stamp = `04-nested-${Date.now()}`;
    const snapshot = () => page.evaluate(() => ({
        notes: document.getElementById('session_modal_notes').value,
        tags: JSON.stringify(currentTagChips), typedTag: document.getElementById('session_modal_tags_input').value,
        start: document.getElementById('session_modal_start').value, end: document.getElementById('session_modal_end').value
    }));
    for (const focus of ['planning', 'assistant']) for (const standalone of ['cancel', 'save']) for (const failedRead of [false, true]) {
        const name = `${focus}/${standalone}/${failedRead ? 'failed' : 'normal'}-read`;
        await page.goto(`${baseURL}/dashboard`);
        await page.waitForSelector('.fc-timegrid-slot');
        await page.getByRole('button', {name: '+ Session', exact: true}).click();
        await page.locator('#session_modal_notes').fill(`Retained multiline\n${name}`);
        await page.locator('#session_modal_tags_input').fill('session_tag');
        await page.locator('#session_modal_tags_input').press('Enter');
        await page.locator('#session_modal_tags_input').fill('unsubmitted_tag');
        const before = await snapshot();
        const sessionNode = await page.locator('#session_modal').elementHandle();
        const notesNode = await page.locator('#session_modal_notes').elementHandle();
        await page.locator('#session_modal_new_task_btn').click();
        const title = `${stamp} ${name} P`;
        await page.locator('#modal_input_title').fill(title);
        let release, started;
        const held = new Promise(resolve => { release = resolve; });
        const seen = new Promise(resolve => { started = resolve; });
        const routeRead = async route => {
            started(); await held;
            return failedRead ? route.fulfill({status: 503, json: {detail: 'Synthetic metadata read failure'}}) : route.continue();
        };
        await page.route('**/api/tasks?status=all', routeRead);
        const writeStart = writes.length;
        await page.locator('#task_save_btn').click();
        await seen;
        const rows = await (await page.request.get(`${baseURL}/api/tasks?status=all`)).json();
        const parent = rows.find(row => row.title === title);
        check(`${name}: real P acknowledged once before held read`, !!parent && writes.slice(writeStart).filter(w => w.path === '/api/tasks').length === 1, parent);
        check(`${name}: P attached and retained Session resumed before held read`, await page.locator('#session_modal_task_id').inputValue() === parent?.id && await page.locator('#session_modal').isVisible() && await page.evaluate(() => suspendedSessionModal === null));
        // Explicit public focus callers, not pointer clicks through a visible Session overlay.
        let target;
        if (focus === 'planning') {
            target = page.locator('#planning_task_search');
            await target.evaluate(el => { el.value = 'New planning focus'; el.focus(); });
        } else {
            await page.evaluate(() => openAiDrawer());
            target = page.locator('#ai_composer_input');
            await target.fill('Retained unsent Assistant draft');
        }
        release();
        await page.waitForFunction(() => !document.getElementById('task_save_btn').disabled);
        await page.unroute('**/api/tasks?status=all', routeRead);
        check(`${name}: metadata completion retains newer focus`, await target.evaluate(el => el === document.activeElement));
        check(`${name}: same Session DOM and draft retained`, JSON.stringify(await snapshot()) === JSON.stringify(before) && await sessionNode.evaluate(el => el === document.getElementById('session_modal')) && await notesNode.evaluate(el => el === document.getElementById('session_modal_notes')));
        check(`${name}: completed P delivered and suspension consumed`, await page.locator('#session_modal_task_id').inputValue() === parent?.id && await page.evaluate(() => suspendedSessionModal === null), {taskId: await page.locator('#session_modal_task_id').inputValue(), parentId: parent?.id});
        // ACK-time handoff now resumes Session before refresh. Explicitly cancel that visible
        // owner before a native standalone launch; E2's stranded hidden owner cannot be canceled this way.
        if (focus === 'assistant') await page.evaluate(() => closeAiDrawer());
        if (await page.locator('#session_modal').isVisible()) await page.locator('#session_modal [aria-label="Close Session"]').click();
        await page.getByRole('button', {name: '+ Task', exact: true}).click();
        await page.locator('#modal_input_title').fill(`${stamp} ${name} Q`);
        if (standalone === 'cancel') await page.locator('#modal_input_title').press('Escape');
        else {
            await page.locator('#task_save_btn').click();
            await page.waitForFunction(() => document.getElementById('task_modal').classList.contains('hidden') && !document.getElementById('task_save_btn').disabled);
        }
        check(`${name}: standalone cannot resume old Session or attach Q`, await page.locator('#session_modal').isHidden() && await page.locator('#session_modal_task_id').inputValue() === parent?.id && await page.evaluate(() => suspendedSessionModal === null), {taskId: await page.locator('#session_modal_task_id').inputValue()});
        const finalRows = await (await page.request.get(`${baseURL}/api/tasks?status=all`)).json();
        check(`${name}: no ACK replay; only explicit Q saves`, finalRows.filter(row => row.title === title).length === 1 && finalRows.filter(row => row.title === `${stamp} ${name} Q`).length === (standalone === 'save' ? 1 : 0) && writes.slice(writeStart).filter(w => w.path === '/api/tasks').length === (standalone === 'save' ? 2 : 1));
    }
    for (const supersede of ['before-ACK', 'during-read']) for (const failedRead of [false, true]) {
        const name = `new-owner/${supersede}/${failedRead ? 'failed' : 'normal'}-read`;
        await page.goto(`${baseURL}/dashboard`);
        await page.waitForSelector('.fc-timegrid-slot');
        await page.getByRole('button', {name: '+ Session', exact: true}).click();
        await page.locator('#session_modal_notes').fill('Old Session draft');
        await page.locator('#session_modal_new_task_btn').click();
        const title = `${stamp} ${name} P`;
        await page.locator('#modal_input_title').fill(title);
        let releaseParent, parentStarted, releaseRead, readStarted;
        const parentHeld = new Promise(resolve => { releaseParent = resolve; });
        const parentSeen = new Promise(resolve => { parentStarted = resolve; });
        const readHeld = new Promise(resolve => { releaseRead = resolve; });
        const readSeen = new Promise(resolve => { readStarted = resolve; });
        const parentRoute = async route => {
            if (route.request().method() === 'POST') { parentStarted(); await parentHeld; }
            return route.continue();
        };
        const readRoute = async route => {
            readStarted(); await readHeld;
            return failedRead ? route.fulfill({status: 503, json: {detail: 'Synthetic metadata failure'}}) : route.continue();
        };
        await page.route('**/api/tasks', parentRoute);
        await page.route('**/api/tasks?status=all', readRoute);
        await page.locator('#task_save_btn').click();
        await parentSeen;
        const newOwner = async () => {
            // Explicit public initializer supersedes an existing modal owner; not a pointer
            // gesture through the Task/returned Session overlay, and no helper replacement.
            await page.evaluate(() => createPlanningSession());
            await page.locator('#session_modal_notes').fill(`New owner ${name}`);
            await page.locator('#session_modal_tags_input').fill('new_owner_tag');
            await page.locator('#session_modal_tags_input').press('Enter');
            await page.locator('#session_modal_tags_input').fill('new_owner_typed_tag');
            await page.locator('#session_modal_notes').focus();
        };
        if (supersede === 'before-ACK') await newOwner();
        releaseParent(); await readSeen;
        if (supersede === 'during-read') await newOwner();
        const before = await snapshot();
        releaseRead();
        await page.waitForFunction(() => !document.getElementById('task_save_btn').disabled);
        await page.unroute('**/api/tasks', parentRoute);
        await page.unroute('**/api/tasks?status=all', readRoute);
        check(`${name}: new Session not overwritten or attached`, JSON.stringify(await snapshot()) === JSON.stringify(before) && await page.locator('#session_modal_task_id').inputValue() === '' && await page.locator('#session_modal_notes').evaluate(el => el === document.activeElement) && await page.evaluate(() => suspendedSessionModal === null));
        await page.locator('#session_modal [aria-label="Close Session"]').click();
        await page.getByRole('button', {name: '+ Task', exact: true}).click();
        await page.locator('#modal_input_title').fill(`${stamp} ${name} Q`);
        await page.locator('#task_save_btn').click();
        await page.waitForFunction(() => document.getElementById('task_modal').classList.contains('hidden') && !document.getElementById('task_save_btn').disabled);
        const rows = await (await page.request.get(`${baseURL}/api/tasks?status=all`)).json();
        check(`${name}: standalone Q cannot inherit old suspension`, await page.locator('#session_modal').isHidden() && await page.locator('#session_modal_task_id').inputValue() === '' && rows.filter(row => row.title === title).length === 1 && rows.filter(row => row.title === `${stamp} ${name} Q`).length === 1);
    }
    check('no Session autosave', !writes.some(write => write.path === '/sessions'));
    check('no unexpected pageerrors', errors.length === 0, errors);
    if (checks.some(check => !check.ok)) throw Error(JSON.stringify({checks, errors, writes}));
    return {checks, errors, writes, boundaries: 'Native nested launch/Task Save, real P/Q writes and public readbacks. Planning focus and Assistant opener are explicit public callers, not background pointer actions. ACK-time resumed Session explicitly canceled before native standalone Task launch. Only held/failed metadata and runner catalog faked; no helper injection/provider calls.'};
}
