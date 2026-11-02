/* Native Chromium, isolated daemon, synthetic rows. No inference/provider calls. */
async (page, baseURL) => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const context = await page.context().browser().newContext({ timezoneId: 'America/New_York' });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false})));
    const p = await context.newPage();
    const writes = [], errors = [];
    p.on('request', r => { if (['POST', 'PUT', 'DELETE'].includes(r.method())) writes.push({ method: r.method(), url: new URL(r.url()).pathname, body: r.postData() }); });
    p.on('pageerror', e => errors.push(e.message));
    try {
        await p.goto(`${baseURL}/dashboard?date=2026-11-10&view=timeGridThreeDay`);
        await p.waitForSelector('.fc-timegrid-slot');
        await p.evaluate(() => openCreateSessionModal(new Date('2026-11-10T23:45:00'), new Date('2026-11-11T00:30:00')));
        await p.waitForFunction(() => document.activeElement.id === 'session_modal_task_search');
        const notes = p.locator('#session_modal_notes');
        await notes.fill('First line');
        await notes.press('End');
        await notes.press('Enter');
        await p.keyboard.type('Second line');
        check(await notes.inputValue() === 'First line\nSecond line', 'Ordinary Enter inserts a Notes newline without saving');
        check(!writes.some(w => w.url === '/sessions'), 'Notes Enter performs no session write');
        await notes.press('Control+Enter');
        await p.locator('#session_modal').waitFor({ state: 'hidden' });
        const create = writes.filter(w => w.url === '/sessions');
        check(create.length === 1, 'Ctrl+Enter sends one create');
        const savedId = await p.locator('#edit_session_id').inputValue();
        const rows = await (await context.request.get(`${baseURL}/sessions`)).json();
        const row = rows.find(s => s.id === savedId) || rows.filter(s => s.notes === 'First line\nSecond line').at(-1);
        check(row && row.start_time === '2026-11-11T04:45:00+00:00' && row.end_time === '2026-11-11T05:30:00+00:00', 'Overnight local timestamps and multiline Notes read back via real API');
        await p.evaluate(id => openEditSessionModal(id), row.id);
        await p.waitForFunction(() => document.activeElement.id === 'session_modal_notes');
        check(await p.locator('#session_modal_start').inputValue() === '2026-11-10T23:45', 'Edit restores local start day');
        await notes.fill('Canceled change');
        await notes.press('Escape');
        await p.locator('#session_modal').waitFor({ state: 'hidden' });
        const unchanged = await (await context.request.get(`${baseURL}/sessions/${row.id}`)).json();
        check(unchanged.notes === row.notes && writes.filter(w => w.url.startsWith('/sessions')).length === 1, 'Escape cancels without writes');
        check(errors.length === 0, `No page errors: ${errors}`);
        return { checks: ['Notes newline', 'Ctrl+Enter real create/readback', 'overnight New York/UTC roundtrip', 'edit Notes focus', 'Escape no write'], row, writes, errors };
    } finally { await context.close(); }
}
