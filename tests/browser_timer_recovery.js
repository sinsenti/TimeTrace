async (page, baseURL) => {
    const context = page.context();
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({ idleDetectorEnabled: false })));
    const errors = [], writes = [], samples = [], assertions = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET') writes.push({ method: request.method(), path: new URL(request.url()).pathname }); });
    const check = (value, message) => { if (!value) throw Error(message); assertions.push(message); };
    const luminance = rgb => {
        const c = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
        return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
    };
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const get = async path => { const r = await context.request.get(baseURL + path); check(r.ok(), `GET ${path}`); return r.json(); };
    const initial = await get('/timer/status');
    let taskId, running = initial.is_running;
    if (!initial.pending_idle_gap && !running) {
        const response = await context.request.post(baseURL + '/api/tasks', { data: { title: 'Timer <img src=x onerror=alert(1)> ' + 'long literal '.repeat(12) } });
        check(response.ok(), 'synthetic task created'); taskId = (await response.json()).id;
        const start = await context.request.post(baseURL + '/timer/start', { data: { task_id: taskId, tags: '#timer', notes: 'Synthetic work', mode: 'pomodoro', target_minutes: 25 } });
        check(start.ok(), 'real timer started'); running = true;
    } else taskId = initial.task_id || initial.pending_idle_gap?.task_id;
    const paths = ['/dashboard', '/tasks', '/kanban', '/tasks-view', '/stats', '/habits-view', '/revision', '/settings/ai', '/settings', '/settings?category=providers', `/task-inspector/${taskId}`, `/tasks-detail/${taskId}`];
    const frozen = Boolean(initial.pending_idle_gap);
    const startRows = await get('/sessions');
    for (const path of paths) {
        await page.goto(baseURL + path);
        await page.waitForFunction(() => typeof lastTimerData !== 'undefined' && lastTimerData !== null);
        check(await page.locator('script[src^="/static/js/timer_control.js"]').count() === 1, `one controller ${path}`);
        check(await page.locator('#idle_resolution_modal').count() === 1, `one recovery partial ${path}`);
        const state = await page.evaluate(() => ({ running: lastTimerData.is_running, gap: lastTimerData.pending_idle_gap, mode: lastTimerData.mode, target: lastTimerData.target_minutes }));
        check(state.running === !frozen, `real state retained ${path}`);
        check(state.mode === 'pomodoro' && state.target === 25, `mode and target retained ${path}`);
        if (frozen) {
            check(state.gap.idle_start === initial.pending_idle_gap.idle_start && state.gap.idle_end === initial.pending_idle_gap.idle_end, `captured interval unchanged ${path}`);
            await page.locator('#idle_resolution_modal').waitFor({ state: 'visible' });
            check(await page.evaluate(() => document.getElementById('idle_resolution_modal').parentElement === document.body), `modal outside header ${path}`);
            await page.keyboard.press('Escape');
            check(await page.locator('#idle_resolution_modal').isHidden(), `Escape closes recovery ${path}`);
            await page.locator('#timer_recovery_open').click();
        }
        if (path === '/tasks' || path === '/settings/ai') {
            let polls = 0;
            const listener = request => { if (new URL(request.url()).pathname === '/timer/status') polls++; };
            page.on('request', listener); await page.waitForTimeout(3250); page.off('request', listener);
            check(polls === 1, `one poll interval ${path}: ${polls}`);
        }
    }
    await page.goto(baseURL + '/tasks');
    await page.waitForFunction(() => typeof lastTimerData !== 'undefined' && lastTimerData !== null);
    await page.goto(baseURL + '/dashboard'); await page.goBack(); await page.goForward();
    await page.waitForFunction(() => typeof lastTimerData !== 'undefined' && lastTimerData !== null);
    check((await get('/timer/status')).is_running === !frozen, 'Back/Forward retained timer');
    for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ['refined', 'stone', 'porcelain', 'dark']) {
            await page.evaluate(theme => {
                setAppearancePreference('lightTheme', theme === 'dark' ? 'refined' : theme);
                setAppearancePreference('appearance', theme === 'dark' ? 'dark' : 'light');
                if (lastTimerData.pending_idle_gap) openIdleResolution();
            }, theme);
            await page.waitForTimeout(150);
            const sample = await page.evaluate(frozen => {
                const root = document.querySelector(frozen ? '.timer-recovery-card' : '#active_timer_pill');
                const r = root.getBoundingClientRect();
                const color = getComputedStyle(root);
                const input = document.querySelector(frozen ? '#idle_retag_input' : '#timer_task_select');
                const c = getComputedStyle(input);
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight,
                    fg: color.color, bg: color.backgroundColor, border: c.borderColor, controlBg: c.backgroundColor,
                    imageCount: root.querySelectorAll('img').length,
                    controlsInside: [...root.querySelectorAll('button, input, textarea, select')].every(el => { const c = el.getBoundingClientRect(); return c.left >= r.left && c.right <= r.right + 1 && c.top >= r.top && c.bottom <= r.bottom + 1; }) };
            }, frozen);
            check(sample.left >= 0 && sample.right <= width + 1 && sample.top >= 0 && sample.bottom <= 900, `timer bounds ${width}/${theme}`);
            check(sample.imageCount === 0, `inert timer text ${width}/${theme}`);
            check(sample.controlsInside, `timer controls inside surface ${width}/${theme}`);
            sample.textContrast = contrast(sample.fg, sample.bg);
            sample.controlContrast = contrast(sample.border, sample.controlBg);
            check(sample.textContrast >= 4.5, `timer text contrast ${width}/${theme}: ${sample.textContrast}`);
            check(sample.controlContrast >= 3, `timer control contrast ${width}/${theme}: ${sample.controlContrast}`);
            samples.push({ width, theme, ...sample });
        }
    }
    check((await get('/sessions')).length === startRows.length, 'navigation/theme create no premature Session rows');
    if (frozen) {
        await page.locator('#idle_retag_input').fill('#retag-native');
        await page.locator('#idle_retag_notes').fill('Native retag <script>literal</script>');
        // Tab containment and explicit closure/reopening retain typed recovery fields.
        await page.locator('#idle_resolution_title').focus(); await page.keyboard.press('Shift+Tab');
        check(await page.evaluate(() => document.activeElement.closest('#idle_resolution_modal') !== null), 'Shift+Tab contained');
        await page.keyboard.press('Tab');
        check(await page.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Close idle recovery'), 'Tab wraps to first control');
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => document.activeElement.id === 'timer_recovery_open' || document.activeElement.isConnected), 'Escape focus connected');
        await page.locator('#timer_recovery_open').click();
        check(await page.locator('#idle_retag_input').inputValue() === '#retag-native', 'retag draft retained after Escape');
        const choice = process.env.TIMER_CHOICE || 're_tag';
        const labels = { break: 'Log interval as break', claim_work: 'Claim interval as work', skip: 'Discard idle interval only', re_tag: 'Log re-tagged interval' };
        await page.getByRole('button', { name: labels[choice], exact: true }).click();
        await page.waitForFunction(() => lastTimerData && !lastTimerData.pending_idle_gap);
        const final = await get('/timer/status');
        check(!final.is_running && !final.is_frozen_idle && final.pending_idle_gap === null, 'real resolution clears gap without auto resume');
        const rows = await get('/sessions');
        const added = rows.filter(row => !startRows.some(old => old.id === row.id));
        check(added.length === (choice === 'skip' ? 1 : 2), `real ${choice} row cardinality`);
        check(added.some(row => row.duration_seconds === 120 && row.notes === 'Before idle'), 'positive pre-idle row persisted');
        if (choice !== 'skip') {
            const row = added.find(row => row.duration_seconds === 600);
            check(Boolean(row) && row.task_id === taskId, 'real captured 600s gap row/task persisted');
            const tags = { break: '#break', claim_work: '#native', re_tag: '#retag-native' };
            check(row.tags === tags[choice], `real ${choice} tags persisted`);
            if (choice === 're_tag') check(row.notes === 'Native retag <script>literal</script>', 'retag notes persisted literally');
        }
        check(writes.filter(write => write.path === '/idle/resolve').length === 1, 'one public resolution POST');
    } else {
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        await page.waitForFunction(() => lastTimerData && !lastTimerData.is_running);
        check((await get('/sessions')).length === startRows.length + 1, 'real Stop logs exactly one session');
    }
    check(errors.length === 0, 'no pageerrors');
    return { assertions, samples, writes, errors, frozen, realAPI: true, fake: 'provider catalog; synthetic offline freeze fixture, no OS idle' };
}
