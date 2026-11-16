async (page, baseURL) => {
    const context = page.context(), assertions = [], writes = [], errors = [];
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const check = (value, message) => { if (!value) throw Error(message); assertions.push(message); };
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/timer/')) writes.push(request.url()); });
    await page.goto(baseURL + '/dashboard'); await page.waitForSelector('.fc-timegrid-slot');
    await page.waitForFunction(() => typeof lastTimerData !== 'undefined' && lastTimerData !== null);
    check(await page.evaluate(() => Boolean(lastTimerData.pending_idle_gap)), 'real frozen fixture present');
    await page.keyboard.press('Escape');
    await page.locator('button[onclick="createPlanningSession()"]').click();
    await page.locator('#session_modal_notes').fill('Retained Session draft');
    await page.locator('#session_modal_tags_input').fill('#retained');
    await page.evaluate(() => { window.originalSessionDOM = document.getElementById('session_modal'); });
    const sessionFields = await page.evaluate(() => ['session_modal_start', 'session_modal_end'].map(id => document.getElementById(id).value));
    await page.locator('#session_modal_start_now_btn').click();
    await page.locator('#idle_resolution_modal').waitFor({ state: 'visible' });
    check(writes.length === 0, 'Session Timer Now cannot clear real frozen gap');
    await page.keyboard.press('Escape');
    check(await page.locator('#session_modal_notes').inputValue() === 'Retained Session draft', 'recovery closure retains Session notes');
    check(await page.locator('#session_modal').isVisible(), 'blocked Timer Now retains Session editor');
    check(await page.evaluate(() => document.activeElement.id === 'session_modal_start_now_btn'), 'recovery Escape restores Timer Now focus');
    for (const focus of ['input', 'body']) {
        await page.locator('#session_modal_start_now_btn').click();
        await page.locator('#idle_resolution_modal').waitFor({ state: 'visible' });
        await page.waitForFunction(() => !timerActionPending && !sessionModalOwner.pending);
        if (focus === 'input') await page.locator('#idle_retag_input').focus();
        else await page.evaluate(() => { document.body.setAttribute('tabindex', '-1'); document.body.focus(); });
        await page.keyboard.press('Escape');
        check(await page.locator('#idle_resolution_modal').isHidden() && await page.locator('#session_modal').isVisible(), `recovery-only Escape from ${focus}`);
        check(await page.evaluate(() => document.activeElement.id === 'session_modal_start_now_btn'), `Timer Now focus restored from ${focus}`);
    }
    check(await page.evaluate(() => window.originalSessionDOM === document.getElementById('session_modal')), 'same retained Session DOM');
    check(JSON.stringify(await page.evaluate(() => ['session_modal_start', 'session_modal_end'].map(id => document.getElementById(id).value))) === JSON.stringify(sessionFields), 'Session timestamps unchanged');
    check(await page.evaluate(() => currentTagChips.includes('#retained')), 'Session tags retained');
    check(writes.length === 0, 'all recovery closures preserve gap without timer POST');
    await page.locator('#session_modal_notes').press('Escape');
    // New-owner race: hold only status transport, cancel old Session and open a different one.
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/timer/status', async route => { await held; await route.continue(); });
    await page.locator('button[onclick="createPlanningSession()"]').click();
    await page.locator('#session_modal_notes').fill('Old owner');
    await page.locator('#session_modal_start_now_btn').click();
    await page.waitForFunction(() => sessionModalOwner.pending);
    await page.locator('#session_modal_notes').press('Escape');
    await page.locator('button[onclick="createPlanningSession()"]').click();
    await page.locator('#session_modal_notes').fill('New owner');
    release();
    await page.waitForFunction(() => !timerActionPending);
    check(writes.length === 0, 'old owner continuation performs no timer write');
    check(await page.locator('#session_modal').isVisible() && await page.locator('#session_modal_notes').inputValue() === 'New owner', 'old owner cannot close or replace new Session');
    check(errors.length === 0, 'no pageerrors');
    return { assertions, writes, errors, real: 'frozen status/file and shipped Session/Calendar handlers', fake: 'held status HTTP, provider catalog, offline private freeze; no OS idle' };
}
