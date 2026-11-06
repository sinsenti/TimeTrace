async (page, baseURL) => {
    const context = page.context(), assertions = [], writes = [];
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const check = (value, message) => { if (!value) throw Error(message); assertions.push(message); };
    const status = async () => (await context.request.get(baseURL + '/timer/status')).json();
    const rows = async () => (await context.request.get(baseURL + '/sessions')).json();
    page.on('request', request => { if (/\/(timer\/(start|stop|split)|idle\/resolve)$/.test(new URL(request.url()).pathname) && request.method() === 'POST') writes.push(request.url()); });
    const initial = await status(), before = await rows();
    check(Boolean(initial.pending_idle_gap), 'private offline frozen FILE fixture required');
    await page.goto(baseURL + '/dashboard');
    await page.locator('#idle_resolution_modal').waitFor({ state: 'visible' });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/idle/resolve', async route => {
        await held;
        // REAL two commits/file clear happen, but browser never receives their successful response.
        const real = await route.fetch(); check(real.ok(), 'real resolution committed before lost-response fake');
        await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Log interval as break', exact: true }).click();
    await page.waitForFunction(() => timerActionPending);
    await page.evaluate(() => { resolveIdleGap('claim_work'); toggleTimer(); });
    await page.waitForTimeout(3200);
    check(writes.length === 1, 'held write + double activation + late poll send one mutation');
    release();
    await page.waitForFunction(() => timerReceipt?.outcome === 'uncertain' && !timerActionPending);
    check((await rows()).length === before.length + 2, 'real preidle+break rows persisted despite lost response');
    check((await status()).pending_idle_gap === null, 'real file gap cleared despite lost response');
    const journal = await page.evaluate(() => sessionStorage.getItem(timerReceiptKey));
    check(!journal.includes('Before idle') && !journal.includes('#native'), 'receipt excludes notes/tags');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Retry status (read only)', exact: true }).click();
    check(writes.length === 1, 'uncertain read retry never repeats POST');
    for (const path of ['/tasks', '/settings/ai', '/dashboard']) {
        await page.goto(baseURL + path); await page.waitForFunction(() => typeof lastTimerData !== 'undefined' && lastTimerData !== null);
        check(await page.locator('#timer_notice_text').textContent().then(s => s.includes('uncertain')), `unknown outcome retained ${path}`);
        await page.evaluate(() => toggleTimer());
        check(writes.length === 1, `unknown outcome blocks Start ${path}`);
    }
    await page.reload(); await page.waitForFunction(() => typeof lastTimerData !== 'undefined' && lastTimerData !== null);
    check(await page.locator('#toggle_btn').isDisabled(), 'reload retains same-tab safety latch');
    const count = writes.length;
    await page.getByRole('button', { name: 'I checked/corrected this interval', exact: true }).click();
    check(writes.length === count, 'manual verification acknowledgment itself sends zero writes');
    check(await page.evaluate(() => sessionStorage.getItem(timerReceiptKey)) === null, 'manual acknowledgment clears client latch only');
    await page.unroute('**/idle/resolve');
    let failRead = false;
    await page.route('**/timer/status', route => failRead ? route.abort('failed') : route.continue());
    await page.route('**/timer/start', async route => {
        const response = await route.fetch(); check(response.ok(), 'real Start ACK');
        failRead = true; await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Start Timer', exact: true }).click();
    await page.waitForFunction(() => timerReceipt?.outcome === 'acknowledged' && !timerActionPending);
    check((await status()).is_running, 'real timer is running after ACK/read failure');
    check(await page.locator('#timer_notice_text').textContent().then(s => s.includes('acknowledged')), 'ACK not reported as failed mutation');
    await page.evaluate(() => toggleTimer()); check(writes.length === count + 1, 'ACK/read failure blocks another mutation');
    failRead = false;
    await page.getByRole('button', { name: 'Retry status (read only)', exact: true }).click();
    await page.waitForFunction(() => timerReceipt === null);
    check(writes.length === count + 1, 'ACK reconciliation retry is read only');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.waitForFunction(() => !lastTimerData.is_running && !timerActionPending);
    check(writes.length === count + 2, 'new explicit Stop after read reconciliation');
    check((await rows()).length === before.length + 3, 'real Stop adds one row, no replayed recovery');
    return { assertions, writes, real: 'resolution/start/stop/rows/file', fakes: 'held/lost resolution response after real commit, post-ACK status transport failures; provider catalog; no OS idle' };
}
