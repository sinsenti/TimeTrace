async (page, baseURL) => {
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    const checks = [], errors = [], writes = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => {
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push({url: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON()});
    });
    await page.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, enableVimMotions: false})));
    const stamp = `04-repair-${Date.now()}`;
    const list = async () => (await page.request.get(`${baseURL}/api/tasks?status=all`)).json();
    const check = (name, ok, details) => checks.push({name, ok, details});
    await page.goto(`${baseURL}/dashboard`);
    await page.waitForSelector('.fc-timegrid-slot');
    let releaseParent, parentStarted;
    const started = new Promise(resolve => { parentStarted = resolve; });
    const held = new Promise(resolve => { releaseParent = resolve; });
    let rejectChild = true;
    await page.route('**/api/tasks', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = route.request().postDataJSON();
        if (body.title === `${stamp} Color`) { parentStarted(); await held; }
        if (body.title === `${stamp} Second` && rejectChild) return route.fulfill({status: 400, json: {detail: 'Synthetic second-child rejection'}});
        return route.continue();
    });
    const launcher = page.getByRole('button', {name: '+ Task', exact: true});
    await launcher.click();
    await page.locator('#modal_input_title').fill(`${stamp} Color`);
    await page.locator('#modal_input_color_mode').selectOption('custom');
    await page.locator('#swatch_list button').nth(1).click();
    const color = await page.locator('#modal_input_color').inputValue();
    const display = await page.locator('#custom_color_hex').innerText();
    const selection = await page.locator('#swatch_list button').evaluateAll(els => els.map(el => el.className).join('|'));
    const clickPreset = async () => {
        const box = await page.locator('#swatch_list button').first().boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    const other = await page.locator('#swatch_list button').first().getAttribute('onclick');
    const otherHex = other.match(/'([^']+)'/)[1];
    await page.locator('#task_child_title').fill(`${stamp} First`);
    await page.locator('#task_child_title').press('Enter');
    await page.locator('#task_child_title').fill(`${stamp} Second`);
    await page.locator('#task_save_btn').click();
    await started;
    check('pending swatches disabled', await page.locator('#swatch_list button').evaluateAll(els => els.length > 0 && els.every(el => el.disabled)));
    await clickPreset();
    check('pending native palette click immutable', await page.locator('#modal_input_color').inputValue() === color);
    // Handler dispatch is a separate public-caller bypass check, not a native click claim.
    await page.evaluate(hex => selectSwatch(hex), otherHex);
    check('pending public selectSwatch refuses edit', await page.locator('#modal_input_color').inputValue() === color);
    releaseParent();
    await page.waitForFunction(() => document.getElementById('task_save_feedback').textContent.includes('Retry saves only') && !document.getElementById('task_save_btn').disabled);
    check('partial swatches disabled', await page.locator('#swatch_list button').evaluateAll(els => els.every(el => el.disabled)));
    // Physical pointer dispatch targets the same preset, including when natively disabled.
    await clickPreset();
    await page.evaluate(hex => selectSwatch(hex), otherHex);
    check('partial color and display immutable', await page.locator('#modal_input_color').inputValue() === color && await page.locator('#custom_color_hex').innerText() === display && await page.locator('#swatch_list button').evaluateAll(els => els.map(el => el.className).join('|')) === selection);
    const parent = (await list()).find(row => row.title === `${stamp} Color`);
    check('parent receipt color persisted', parent?.color === color, parent);
    const beforeRetry = writes.length;
    rejectChild = false;
    await page.locator('#task_save_btn').click();
    await page.waitForFunction(() => document.getElementById('task_modal').classList.contains('hidden') && !document.getElementById('task_save_btn').disabled);
    const rows = (await list()).filter(row => row.id === parent.id || row.parent_id === parent.id);
    check('retry only rejected child, no parent update/duplicate child', writes.length === beforeRetry + 1 && writes.at(-1).body.title === `${stamp} Second` && rows.length === 3 && rows.find(row => row.id === parent.id).color === color, rows);
    await launcher.click();
    await page.locator('#modal_input_color_mode').selectOption('custom');
    check('new editor unlocks swatches', await page.locator('#swatch_list button').evaluateAll(els => els.every(el => !el.disabled)));
    await page.locator('#swatch_list button').first().click();
    check('fresh custom color works', await page.locator('#modal_input_color').inputValue() === otherHex);
    await page.locator('#modal_input_title').press('Escape');
    check('normal Cancel restores connected launcher', await launcher.evaluate(el => el === document.activeElement));
    await page.evaluate(id => openEditTaskModal(id), parent.id);
    await page.locator('#swatch_list button').first().click();
    await page.locator('#task_save_btn').click();
    await page.waitForFunction(() => document.getElementById('task_modal').classList.contains('hidden') && !document.getElementById('task_save_btn').disabled);
    check('ordinary edit color persists', (await list()).find(row => row.id === parent.id).color === otherHex);
    await page.unroute('**/api/tasks');

    for (const owner of ['session', 'planning', 'assistant', 'ordinary', 'disposed', 'nested', 'nested-new-session']) {
        // Fresh page avoids previous-owner residue; all writes are synthetic public CRUD.
        await page.goto(`${baseURL}/dashboard`);
        await page.waitForSelector('.fc-timegrid-slot');
        let releaseRead, readStarted;
        const readHeld = new Promise(resolve => { releaseRead = resolve; });
        const readSeen = new Promise(resolve => { readStarted = resolve; });
        if (owner.startsWith('nested')) {
            await page.getByRole('button', {name: '+ Session', exact: true}).click();
            await page.locator('#session_modal_notes').fill('Retained nested draft');
            await page.locator('#session_modal_new_task_btn').click();
        } else await page.getByRole('button', {name: '+ Task', exact: true}).click();
        await page.locator('#modal_input_title').fill(`${stamp} Focus ${owner}`);
        await page.route('**/api/tasks?status=all', async route => { readStarted(); await readHeld; return route.continue(); });
        await page.locator('#task_save_btn').click();
        await readSeen;
        assert(await page.locator('#task_modal').evaluate(el => el.classList.contains('hidden')), 'Real ACK hides Task before metadata');
        let target;
        if (owner === 'session' || owner === 'nested-new-session') {
            await page.getByRole('button', {name: '+ Session', exact: true}).click();
            await page.locator('#session_modal_notes').fill('New Session owner');
            target = page.locator('#session_modal_notes');
            await target.focus();
        } else if (owner === 'planning') {
            target = page.locator('#planning_task_search');
            await target.fill('New planning focus');
        } else if (owner === 'assistant') {
            await page.evaluate(() => openAiDrawer());
            target = page.locator('#ai_composer_input');
            await target.fill('Unsent new assistant draft');
        } else if (owner === 'disposed') {
            await page.getByRole('button', {name: '+ Task', exact: true}).evaluate(el => el.remove());
        }
        releaseRead();
        await page.waitForFunction(() => !document.getElementById('task_save_btn').disabled);
        if (target) {
            check(`late read yields to ${owner}`, await target.evaluate(el => el === document.activeElement), await page.evaluate(() => ({id: document.activeElement.id, text: document.activeElement.textContent})));
            if (owner.includes('session')) check(`${owner} draft retained`, await target.inputValue() === 'New Session owner' && !await page.locator('#session_modal_task_id').inputValue());
        } else if (owner === 'ordinary') check('ordinary connected launcher restored', await page.getByRole('button', {name: '+ Task', exact: true}).evaluate(el => el === document.activeElement));
        else if (owner === 'nested') check('nested Session resumes correct DOM/focus/attachment', await page.locator('#session_modal_new_task_btn').evaluate(el => el === document.activeElement) && await page.locator('#session_modal_notes').inputValue() === 'Retained nested draft' && !!await page.locator('#session_modal_task_id').inputValue());
        else check('disposed launcher tolerated', await page.locator('#task_modal').evaluate(el => el.classList.contains('hidden')));
        await page.unroute('**/api/tasks?status=all');
    }
    assert(errors.length === 0, `Unexpected page errors ${JSON.stringify(errors)}`);
    assert(checks.every(check => check.ok), `Review-fix checks: ${JSON.stringify(checks)}`);
    return {checks, errors, writes, boundaries: 'real Task writes/public readbacks; held parent/metadata and rejected child only; public handler bypass labeled separately; native palette and launchers, no helpers replaced; catalog fake; no providers'};
}
