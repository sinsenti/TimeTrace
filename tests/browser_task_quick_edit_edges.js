async (page, baseURL) => {
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    const errors = [], results = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => { if (!localStorage.getItem('timetrace_user_settings')) localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, enableVimMotions: false})); });
    await page.goto(`${baseURL}/dashboard`);
    await page.waitForSelector('.fc-timegrid-slot');
    const stamp = `04-edge-${Date.now()}`;
    let releaseParse, parseStarted;
    const started = new Promise(resolve => { parseStarted = resolve; });
    const held = new Promise(resolve => { releaseParse = resolve; });
    await page.route('**/api/ai/quick-add/parse', async route => {
        parseStarted(); await held;
        return route.fulfill({json: {tier: 2, fields: {title: 'Late stale extraction'}}});
    });
    await page.evaluate(() => openNewTaskModal());
    await page.locator('#ai_quickadd_input').fill('Synthetic tomorrow');
    await page.locator('#ai_quickadd_input').press('Enter');
    await started;
    await page.locator('#ai_quickadd_input').press('Escape');
    await page.evaluate(() => openNewTaskModal());
    await page.locator('#modal_input_title').fill('Human reopened owner');
    releaseParse();
    await page.waitForResponse('**/api/ai/quick-add/parse');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert(await page.locator('#modal_input_title').inputValue() === 'Human reopened owner', 'Late extraction ignored after reopen');
    await page.locator('#modal_input_title').press('Escape');
    results.push('late Parse after cancel/reopen ignored');
    await page.unroute('**/api/ai/quick-add/parse');
    await page.route('**/api/ai/quick-add/parse', route => route.fulfill({status: 502, json: {detail: 'Synthetic parse error'}}));
    await page.evaluate(() => openNewTaskModal());
    await page.locator('#ai_quickadd_input').fill('Synthetic tomorrow');
    await page.locator('#ai_quickadd_input').press('Enter');
    await page.waitForFunction(() => document.getElementById('ai_quickadd_hint').textContent.includes('Parse failed'));
    assert(await page.locator('#ai_quickadd_parse_btn').isEnabled(), 'Parse error leaves retry available');
    await page.locator('#ai_quickadd_input').press('Escape');

    let rejectChild = true, failMetadata = true;
    const taskWrites = [];
    await page.route('**/api/tasks', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = route.request().postDataJSON(); taskWrites.push(body);
        if (rejectChild && body.title === `${stamp} Second`) {
            rejectChild = false;
            return route.fulfill({status: 400, json: {detail: 'Synthetic nested child rejection'}});
        }
        return route.continue();
    });
    await page.route('**/api/tasks?status=all', route => {
        if (failMetadata && taskWrites.length >= 3) {
            failMetadata = false;
            return route.fulfill({status: 503, json: {detail: 'Synthetic metadata failure after mutation'}});
        }
        return route.continue();
    });
    await page.evaluate(() => openCreateSessionModal(new Date(2026, 10, 4, 10), new Date(2026, 10, 4, 11)));
    await page.locator('#session_modal_notes').fill('Nested retained note');
    await page.locator('#session_modal_tags_input').fill('#session-owner');
    await page.locator('#session_modal_tags_input').press('Enter');
    const tags = await page.evaluate(() => JSON.stringify(currentTagChips));
    const start = await page.locator('#session_modal_start').inputValue();
    await page.evaluate(() => openTaskModalFromSessionModal());
    await page.locator('#modal_input_title').fill(`${stamp} Parent #nested`);
    await page.locator('#task_child_title').fill(`${stamp} First`);
    await page.locator('#task_child_title').press('Enter');
    await page.locator('#task_child_title').fill(`${stamp} Second`);
    await page.locator('#task_save_btn').click();
    await page.waitForFunction(() => document.getElementById('task_save_feedback').textContent.includes('Retry saves only'));
    await page.waitForFunction(() => !document.getElementById('task_save_btn').disabled);
    assert(await page.locator('#session_modal').evaluate(el => el.classList.contains('hidden') && el.dataset.settingsDraftRetained === 'true'), 'Session stays suspended throughout partial work');
    assert(await page.evaluate(() => hasSettingsDrafts(['session_modal'])), 'Suspended Session draft remains owned');
    assert(await page.locator('#session_modal_notes').inputValue() === 'Nested retained note', 'Session note retained through metadata failure');
    await page.locator('#task_save_btn').click();
    await page.waitForFunction(() => !document.getElementById('session_modal').classList.contains('hidden'));
    assert(taskWrites.length === 4, 'Nested retry writes only rejected child');
    assert(await page.locator('#session_modal_start').inputValue() === start, 'Nested Session time unchanged');
    assert(await page.locator('#session_modal_notes').inputValue() === 'Nested retained note', 'Nested Session note unchanged');
    assert(await page.evaluate(() => JSON.stringify(currentTagChips)) === tags, 'Session tags unchanged by child retry');
    const parentId = await page.locator('#session_modal_task_id').inputValue();
    const rows = (await (await page.request.get(`${baseURL}/api/tasks?status=all`)).json()).filter(t => t.id === parentId || t.parent_id === parentId);
    assert(rows.length === 3 && rows.every(t => t.tags === '#nested'), 'Nested saved rows authoritative readback');
    results.push({nestedPartial: rows.map(t => ({id: t.id, parent_id: t.parent_id, title: t.title})), taskWrites});
    await page.evaluate(() => closeSessionModal());
    rejectChild = true;
    await page.evaluate(() => openCreateSessionModal(new Date(2026, 10, 5, 10), new Date(2026, 10, 5, 11)));
    await page.locator('#session_modal_notes').fill('Session kept through explicit child discard');
    await page.evaluate(() => openTaskModalFromSessionModal());
    await page.locator('#modal_input_title').fill(`${stamp} Discard parent`);
    await page.locator('#task_child_title').fill(`${stamp} Saved before discard`);
    await page.locator('#task_child_title').press('Enter');
    await page.locator('#task_child_title').fill(`${stamp} Second`);
    await page.locator('#task_save_btn').click();
    await page.waitForFunction(() => document.getElementById('task_save_feedback').textContent.includes('Retry saves only') && !document.getElementById('task_save_btn').disabled);
    const beforeDiscard = taskWrites.length;
    let discardMessage = '';
    page.once('dialog', async dialog => { discardMessage = dialog.message(); await dialog.accept(); });
    await page.locator('#task_child_title').press('Escape');
    await page.waitForFunction(() => !document.getElementById('session_modal').classList.contains('hidden'));
    assert(discardMessage.includes('will remain saved'), 'Explicit partial discard explains persisted rows');
    assert(taskWrites.length === beforeDiscard, 'Discard never retries child or parent');
    assert(await page.locator('#session_modal_notes').inputValue() === 'Session kept through explicit child discard', 'Session draft survives explicit discard');
    const discardParentId = await page.locator('#session_modal_task_id').inputValue();
    const discardRows = (await (await page.request.get(`${baseURL}/api/tasks?status=all`)).json()).filter(t => t.id === discardParentId || t.parent_id === discardParentId);
    assert(discardRows.length === 2, 'Explicit discard keeps parent and successful child only');
    results.push({explicitDiscard: discardMessage, rows: discardRows.map(t => t.id)});
    await page.evaluate(() => closeSessionModal());
    await page.goto(`${baseURL}/tasks`);
    await page.waitForSelector('.kanban-card');
    assert(await page.locator('#task_view_selector').inputValue() === 'kanban', 'Fresh view is Kanban');
    await page.locator('#task_view_selector').selectOption('outline');
    await page.reload();
    await page.waitForSelector('.kanban-card');
    assert(await page.locator('#task_view_selector').inputValue() === 'outline', 'Valid preference retained across reload');
    assert((await page.locator('#task_view_notice').textContent()).includes('Showing Kanban'), 'Incremental optional layout honestly disclosed');
    await page.locator('#task_view_selector').selectOption('kanban');
    await page.locator('#tasks_search').fill(`${stamp} First`);
    assert(await page.locator('.kanban-card').count() === 1, 'Board search narrows tasks');
    assert((await page.locator('.kanban-card').textContent()).includes('Subtask of'), 'Board retains hierarchy label');
    await page.locator('#tasks_search').fill('');
    const samples = [];
    for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({width, height: 1000});
        for (const theme of ['refined', 'stone', 'porcelain', 'dark']) {
            await page.evaluate(theme => {
                if (theme === 'dark') setAppearancePreference('appearance', 'dark');
                else { setAppearancePreference('appearance', 'light'); setAppearancePreference('lightTheme', theme); }
            }, theme);
            if ((width === 390 || width === 1440) && ['refined', 'dark'].includes(theme)) await page.screenshot({path: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-04/kanban-${width}-${theme}.png`});
            await page.evaluate(() => {
                openNewTaskModal();
            }, theme);
            await page.locator('#modal_input_title').fill('Long synthetic title with untrusted <script>literal text</script>');
            await page.locator('#task_child_title').fill('A long synthetic subtask title that should wrap without clipping controls');
            await page.locator('#task_child_title').press('Enter');
            // Finite rendering readiness; not arbitrary sleeps or all-frame certification.
            await page.evaluate(async () => {
                for (let batch = 0; batch < 8; batch++) {
                    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
                    const live = document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime));
                    if (!live.length) return;
                    await Promise.race([Promise.all(live.map(a => a.finished.catch(() => {}))), new Promise((_, reject) => setTimeout(() => reject(Error('Animation readiness timeout')), 2000))]);
                }
                throw Error('Animations did not settle');
            });
            const sample = await page.evaluate(() => {
                const dialog = document.querySelector('#task_modal > div').getBoundingClientRect();
                const rgb = s => { const n = s.match(/[\d.]+/g).map(Number); return [n[0], n[1], n[2], n[3] ?? 1]; };
                const blend = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
                const lum = c => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
                const contrast = ['#modal_task_title', '#task_child_queue span', '#task_save_btn', '#task_child_title', '#ai_quickadd_parse_btn'].map(selector => {
                    const el = document.querySelector(selector), style = getComputedStyle(el), ancestors = [];
                    for (let n = el; n; n = n.parentElement) ancestors.unshift(n);
                    const bg = ancestors.reduce((b, n) => blend(rgb(getComputedStyle(n).backgroundColor), b), [255, 255, 255, 1]);
                    const fg = blend(rgb(style.color), bg);
                    return {selector, ratio: (Math.max(lum(fg), lum(bg)) + .05) / (Math.min(lum(fg), lum(bg)) + .05)};
                });
                return {dialog: {left: dialog.left, right: dialog.right, top: dialog.top, bottom: dialog.bottom, width: dialog.width}, overflow: document.documentElement.scrollWidth - innerWidth, contrast};
            });
            assert(sample.dialog.left >= 0 && sample.dialog.right <= width && sample.dialog.top >= 0 && sample.dialog.bottom <= 1000, `Dialog outside viewport ${width}/${theme}`);
            assert(sample.overflow === 0, `Body horizontal overflow ${width}/${theme}`);
            assert(sample.contrast.every(s => s.ratio >= 4.5), `Sampled task-editor contrast ${width}/${theme}: ${JSON.stringify(sample.contrast)}`);
            samples.push({width, theme, ...sample});
            if (width === 390 || width === 1440) await page.screenshot({path: `/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-04/task-editor-${width}-${theme}.png`});
            await page.locator('#task_child_title').press('Escape');
        }
    }
    assert(errors.length === 0, `Unexpected page errors: ${errors.join('; ')}`);
    return {results, samples, errors, fakeBoundaries: 'held/failed Parse HTTP; one rejected child; one failed registry read; default catalog fake. Other task writes/reads real. Contrast samples only, known shared auto-blue4.33 and dark AI3.98986 remain outside these samples.'};
}
