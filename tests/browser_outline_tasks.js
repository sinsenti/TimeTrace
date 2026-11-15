/* Manual native probe. Run only through the reviewed isolated-daemon/browser guard. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({viewport: {width: 1440, height: 1000}});
    const p = await context.newPage(), results = [], errors = [], writes = [], layouts = [], faultEvents = [];
    const origin = new URL(baseURL).origin;
    const faultBoundaries = [
        {name: 'held-tree', method: 'GET', path: '/api/tasks/{parent}/tree', maximum: 1, delivery: 'held original real response'},
        {name: 'held-delete', method: 'DELETE', path: '/api/tasks/{disposable}', maximum: 1, delivery: 'held original real mutation ACK'},
        {name: 'held-save', method: 'PUT', path: '/api/tasks/{parent}', maximum: 1, delivery: 'held original real mutation ACK'},
        {name: 'failed-stats', method: 'GET', path: '/api/tasks/{parent}/stats', maximum: 1, status: 503, successfulMutation: false}
    ];
    const check = (ok, message) => { if (!ok) throw Error(message); results.push(message); };
    const get = async path => { const response = await context.request.get(baseURL + path); if (!response.ok()) throw Error(`${path}: ${response.status()}`); return response.json(); };
    const post = async (path, data) => { const response = await context.request.post(baseURL + path, {data}); if (!response.ok()) throw Error(`${path}: ${response.status()} ${await response.text()}`); return response.json(); };
    const held = () => { let resolve; const promise = new Promise(yes => resolve = yes); return {promise, resolve}; };
    const heldDelivery = name => {
        let finish;
        const completed = new Promise(resolve => finish = resolve);
        return {
            run: async deliver => {
                try { await deliver(); finish({}); }
                catch (error) { finish({error}); throw error; }
            },
            wait: async (timeoutMs = 10000) => {
                let timer;
                try {
                    const outcome = await Promise.race([completed, new Promise((resolve, reject) => {
                        timer = setTimeout(() => reject(Error(`${name}: held delivery timed out after ${timeoutMs}ms`)), timeoutMs);
                    })]);
                    if ('error' in outcome) throw Error(`${name}: held delivery rejected`, {cause: outcome.error});
                } finally { clearTimeout(timer); }
            }
        };
    };
    const stamp = `07-${Date.now()}`;
    const parent = await post('/api/tasks', {title: `${stamp} Parent`, tags: '#outline', estimated_minutes: 30});
    const child = await post('/api/tasks', {title: `${stamp} Child <img src=x onerror=window.outlineExecuted=1>`, parent_id: parent.id});
    const grandchild = await post('/api/tasks', {title: `${stamp} Grandchild ${'LongTitle'.repeat(70)}`, parent_id: child.id});
    const other = await post('/api/tasks', {title: `${stamp} Other`});
    const now = Date.now();
    const own = await post('/sessions', {task_id: parent.id, start_time: new Date(now - 7200000).toISOString(), end_time: new Date(now - 3600000).toISOString(), notes: `${stamp} Own history`});
    await post('/sessions', {task_id: child.id, start_time: new Date(now - 10800000).toISOString(), end_time: new Date(now - 7200000).toISOString(), notes: `${stamp} Child-only history`});
    const future = await post('/sessions', {task_id: parent.id, start_time: new Date(now + 86400000).toISOString(), end_time: new Date(now + 88200000).toISOString(), notes: `${stamp} Future row`});
    await context.addInitScript(expectedOrigin => {
        if (!['http:', 'https:'].includes(location.protocol) || location.origin !== expectedOrigin) return;
        if (!localStorage.getItem('timetrace_user_settings')) localStorage.setItem('timetrace_user_settings', JSON.stringify({taskView: 'invalid-view', theme: 'nord', colorSeed: 42, idleDetectorEnabled: false, enableVimMotions: false}));
    }, origin);
    p.on('pageerror', error => errors.push(error.message));
    let acceptDeparture = true;
    p.on('dialog', dialog => acceptDeparture ? dialog.accept() : dialog.dismiss());
    p.on('request', request => {
        if (new URL(request.url()).origin === origin && !['GET', 'HEAD'].includes(request.method())) writes.push({method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON()});
    });
    const select = async task => {
        await p.locator(`[data-outline-select="${task.id}"]`).click();
        await p.waitForFunction(id => document.getElementById('inspector_task_id').value === id && !document.getElementById('task_properties_editor').disabled, task.id);
    };
    try {
        await p.goto(baseURL + '/tasks'); await p.waitForSelector('.kanban-col');
        check(await p.locator('#task_view_selector').inputValue() === 'kanban', 'Invalid preference defaults only task view to Kanban');
        await p.locator('#task_view_selector').selectOption('outline'); await p.waitForSelector('[data-outline-select]');
        const settings = await p.evaluate(() => JSON.parse(localStorage.getItem('timetrace_user_settings')));
        check(settings.taskView === 'outline' && settings.colorSeed === 42 && settings.theme === 'nord', 'Outline writes only its browser preference');
        await p.reload(); await p.waitForSelector('[data-outline-select]');
        check(await p.locator('#task_view_selector').inputValue() === 'outline', 'Outline preference survives reload');
        await select(parent);
        check(await p.locator('#detail_task_sessions_list').getByText(`${stamp} Own history`, {exact: true}).count() === 1, 'Inline history includes own recorded row');
        check(!(await p.locator('#detail_task_sessions_list').textContent()).includes('Child-only history'), 'Descendant history stays separate');
        const stats = await get(`/api/tasks/${parent.id}/stats`);
        check((await p.locator('#detail_stat_logged').textContent()).trim() === `${stats.logged_hours}h`, 'Inline accounting reads shared server total');
        check(stats.progress_pct > 100 && stats.remaining_hours < 0, 'Overspent accounting retains negative balance and progress over 100');
        const beforeFilter = writes.length;
        await p.locator('#inspector_edit_title').fill(`${stamp} Retained draft`);
        await p.locator('#tasks_search').fill('Grandchild');
        check(await p.locator(`[data-task-id="${parent.id}"] > .outline-row > .outline-context`).count() === 1, 'Filtered grandchild retains parent own-row context');
        check(await p.locator(`[data-task-id="${child.id}"] > .outline-row > .outline-context`).count() === 1, 'Filtered grandchild retains child own-row context');
        check(await p.locator(`[data-task-id="${grandchild.id}"] > .outline-row > .outline-context`).count() === 0, 'Matching grandchild has no ancestor-context label');
        for (const task of [parent, child, grandchild]) {
            check(await p.locator(`[data-task-id="${task.id}"] > .outline-row`).count() === 1, 'Each retained task has exactly one own row');
        }
        check(await p.locator('#kanban_columns_container .outline-row').count() === 3, 'Filtered outline contains exactly the ancestor chain');
        check(await p.locator(`[data-task-id="${other.id}"]`).count() === 0, 'Unrelated task is absent from filtered outline');
        await p.locator('#tasks_search').fill('No matching Outline task');
        check((await p.locator('#outline_selection_notice').textContent()).includes('outside'), 'Filtered selection is retained with explicit notice');
        await p.locator('#task_view_selector').selectOption('grouped');
        check(await p.locator('#outline_inspector').evaluate(el => el.hidden && el.inert), 'Off-view inspector is hidden and inert');
        await p.locator('#task_view_selector').selectOption('outline');
        check(await p.locator('#inspector_edit_title').inputValue() === `${stamp} Retained draft`, 'Returning to Outline restores the same draft');
        check(writes.length === beforeFilter, 'Search and view changes do not write tasks');
        await p.locator('#tasks_search').fill('');
        acceptDeparture = false; await p.locator(`[data-outline-select="${other.id}"]`).click();
        check(await p.locator('#inspector_task_id').inputValue() === parent.id, 'Canceled selection keeps task identity');
        check(await p.locator('#inspector_edit_title').inputValue() === `${stamp} Retained draft`, 'Canceled selection retains live draft');
        await p.getByRole('button', {name: 'Cancel property edits', exact: true}).click();
        check(await p.locator('#inspector_edit_title').inputValue() === parent.title, 'Explicit property Cancel restores canonical fields without writes');
        acceptDeparture = true;
        for (const activation of ['click', 'Enter']) {
            await p.locator('#inspector_edit_title').fill(`${stamp} ${activation} departure draft`);
            await p.locator('#task_view_selector').selectOption('kanban');
            const card = p.locator(`.kanban-card[data-task-id="${other.id}"]`);
            await card.focus();
            const beforeDeparture = writes.length;
            acceptDeparture = false;
            if (activation === 'click') await card.click(); else await card.press('Enter');
            check(new URL(p.url()).pathname === '/tasks', `${activation}: declined departure stays on Tasks`);
            check(await p.locator('#inspector_edit_title').inputValue() === `${stamp} ${activation} departure draft`, `${activation}: declined departure keeps hidden draft`);
            check(await p.evaluate(id => document.activeElement?.dataset.taskId === id, other.id), `${activation}: declined departure retains card focus`);
            check(writes.length === beforeDeparture, `${activation}: declined departure performs no writes`);
            acceptDeparture = true;
            if (activation === 'click') await card.click(); else await card.press('Enter');
            await p.waitForURL(baseURL + `/task-inspector/${other.id}`);
            await p.waitForFunction(() => !document.getElementById('task_properties_editor').disabled);
            check(writes.length === beforeDeparture, `${activation}: accepted discard navigates without writes`);
            check((await get(`/api/tasks/${parent.id}`)).title === parent.title, `${activation}: discarded draft never persisted`);
            await p.goto(baseURL + '/tasks'); await p.waitForSelector('.kanban-card');
            await p.locator('#task_view_selector').selectOption('outline'); await select(parent);
        }
        await p.locator('#inspector_edit_title').fill(`${stamp} Saved parent`);
        await p.locator('#inspector_save_btn').click();
        await p.waitForFunction(() => !document.getElementById('inspector_save_btn').disabled);
        check((await get(`/api/tasks/${parent.id}`)).title === `${stamp} Saved parent`, 'Explicit Save persists through public readback');
        await p.locator('#detail_add_subtask_btn').click(); await p.locator('#modal_subtask_title').fill(`${stamp} Inline child`);
        await p.locator('#subtask_save_btn').click(); await p.waitForSelector('#subtask_modal.hidden', {state: 'attached'});
        check((await get(`/api/tasks/${parent.id}/tree`)).subtasks.some(row => row.title === `${stamp} Inline child`), 'Shared child creation persists once');
        await p.locator('#detail_task_sessions_list button').first().click();
        await p.waitForSelector('#session_modal:not(.hidden)');
        const editingSession = await p.locator('#edit_session_id').inputValue();
        const sessionBeforeCancel = await get(`/sessions/${editingSession}`);
        const sessionDraft = `${stamp} Retained Session draft`;
        await p.locator('#session_modal_notes').fill(sessionDraft);
        await p.locator('#session_modal').getByRole('button', {name: /^Cancel/}).click();
        check((await get(`/sessions/${editingSession}`)).notes === sessionBeforeCancel.notes, 'Session Cancel performs no mutation');

        const started = held(), release = held(); let heldOnce = false;
        const treeDelivery = heldDelivery('held-tree');
        const treeHandler = async route => {
            if (heldOnce) return route.continue(); heldOnce = true;
            return treeDelivery.run(async () => {
                const response = await route.fetch(); faultEvents.push({name: 'held-tree', status: response.status()}); started.resolve();
                await release.promise; await route.fulfill({response});
            });
        };
        await p.route(`**/api/tasks/${parent.id}/tree`, treeHandler);
        await select(other); await p.locator(`[data-outline-select="${parent.id}"]`).click(); await started.promise;
        await select(child); await select(parent); release.resolve();
        await treeDelivery.wait();
        await p.unroute(`**/api/tasks/${parent.id}/tree`, treeHandler);
        check(await p.locator('#inspector_task_id').inputValue() === parent.id, 'A-B-A real held tree cannot replace current selection');
        check(await p.locator('#inspector_edit_title').inputValue() === `${stamp} Saved parent`, 'Current A properties survive stale A response');

        const ackStarted = held(), ackRelease = held(); let heldSave = false, failStats = false;
        const saveDelivery = heldDelivery('held-save');
        const saveHandler = async route => {
            if (route.request().method() !== 'PUT' || heldSave) return route.continue(); heldSave = true;
            return saveDelivery.run(async () => {
                const response = await route.fetch(); faultEvents.push({name: 'held-delete', method: 'DELETE', path: '/api/tasks/{disposable}', maximum: 1, delivery: 'held original real mutation ACK'},
            {name: 'held-save', status: response.status()}); ackStarted.resolve();
                await ackRelease.promise; await route.fulfill({response});
            });
        };
        await p.route(`**/api/tasks/${parent.id}`, saveHandler);
        await p.route(`**/api/tasks/${parent.id}/stats`, async route => {
            if (!failStats) return route.continue(); failStats = false; faultEvents.push({name: 'failed-stats', status: 503});
            await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({detail: 'Declared synthetic stats outage'})});
        });
        await p.locator('#inspector_edit_title').fill(`${stamp} ACK parent`); await p.locator('#inspector_save_btn').click(); await ackStarted.promise;
        await p.locator('#inspector_edit_title').fill(`${stamp} Later draft`);
        await p.locator(`[data-outline-select="${other.id}"]`).click();
        check(await p.locator('#inspector_task_id').inputValue() === parent.id, 'Pending real write refuses selection change');
        failStats = true; ackRelease.resolve(); await saveDelivery.wait(); await p.waitForFunction(() => !document.getElementById('inspector_save_btn').disabled);
        check(await p.locator('#inspector_edit_title').inputValue() === `${stamp} Later draft`, 'Late ACK keeps concurrently typed draft');
        check((await get(`/api/tasks/${parent.id}`)).title === `${stamp} ACK parent`, 'Held write persisted exactly its submitted value');
        const writesAfterAck = writes.length;
        await p.getByRole('button', {name: 'Retry refresh', exact: true}).first().click();
        await p.waitForFunction(() => document.getElementById('task_properties_status').textContent.includes('Properties ready'));
        check(writes.length === writesAfterAck, 'Retry after ACK plus failed follow-up performs reads only');
        await p.getByRole('button', {name: 'Cancel property edits', exact: true}).click();
        await p.unroute(`**/api/tasks/${parent.id}`, saveHandler); await p.unroute(`**/api/tasks/${parent.id}/stats`);
        await p.locator('#inspector_edit_status').selectOption('Done'); await p.locator('#inspector_save_btn').click();
        await p.waitForSelector('#completion_policy_modal:not(.hidden)');
        await p.locator('#completion_policy_modal').getByRole('button', {name: 'Keep them', exact: true}).click();
        check((await get(`/sessions/${future.id}`)).id === future.id, 'Completion Keep preserves future recorded row');
        await p.waitForFunction(() => !document.getElementById('inspector_save_btn').disabled);

        const disposable = await post('/api/tasks', {title: `${stamp} Delete Cancel owner`});
        await p.evaluate(() => taskKnowledge.changed());
        await select(disposable);
        await p.locator('#inspector_edit_title').fill(`${stamp} Delete pending draft`);
        const deleteStarted = held(), deleteRelease = held(); let heldDelete = false;
        const deleteDelivery = heldDelivery('held-delete');
        const deleteHandler = async route => {
            if (route.request().method() !== 'DELETE' || heldDelete) return route.continue(); heldDelete = true;
            return deleteDelivery.run(async () => {
                const response = await route.fetch(); faultEvents.push({name: 'held-delete', status: response.status()}); deleteStarted.resolve();
                await deleteRelease.promise; await route.fulfill({response});
            });
        };
        await p.route(`**/api/tasks/${disposable.id}`, deleteHandler);
        const beforeDelete = writes.length;
        await p.getByRole('button', {name: 'Delete Task', exact: true}).click();
        await p.locator('#confirm_modal_proceed_btn').click(); await deleteStarted.promise;
        check(await p.locator('#inspector_cancel_btn').isDisabled(), 'Pending DELETE disables property Cancel');
        // Native DOM click and keyboard activation on the actual disabled button cannot discard.
        await p.locator('#inspector_cancel_btn').evaluate(button => button.click());
        await p.locator('#inspector_cancel_btn').press('Enter');
        check(await p.locator('#inspector_edit_title').inputValue() === `${stamp} Delete pending draft`, 'Pending DELETE Cancel click/Enter retains draft and owner');
        await p.locator(`[data-outline-select="${other.id}"]`).click();
        check(await p.locator('#inspector_task_id').inputValue() === disposable.id, 'Pending DELETE blocks newer selection');
        deleteRelease.resolve(); await deleteDelivery.wait();
        await p.waitForFunction(() => document.getElementById('inspector_task_id').value === '' && document.getElementById('task_properties_editor').disabled);
        check(await p.evaluate(() => document.activeElement?.id === 'tasks_heading'), 'Successful DELETE ACK clears selected editor and focuses Tasks');
        check(writes.length === beforeDelete + 1 && writes.at(-1).method === 'DELETE', 'Cancel and selection attempts add no mutation to the sole DELETE');
        check((await context.request.get(baseURL + `/api/tasks/${disposable.id}`)).status() === 404, 'Deleted task absence verified through public API');
        await p.unroute(`**/api/tasks/${disposable.id}`, deleteHandler);
        await select(parent);

        for (const width of [1440, 768, 390]) {
            await p.setViewportSize({width, height: 1000});
            const layout = await p.evaluate(() => ({width: innerWidth, document: document.documentElement.scrollWidth,
                workspace: document.getElementById('tasks_workspace').getBoundingClientRect().toJSON(),
                inspector: document.getElementById('outline_inspector').getBoundingClientRect().toJSON(),
                save: document.getElementById('inspector_save_btn').getBoundingClientRect().toJSON()}));
            layouts.push(layout); check(layout.document <= width + 1, `Outline wraps at ${width}px`);
        }
        check(await p.locator('.outline-task-list img').count() === 0 && !await p.evaluate(() => window.outlineExecuted), 'Untrusted hierarchy text remains inert');
        await p.setViewportSize({width: 1440, height: 1000});
        await p.getByRole('button', {name: 'Close inspector', exact: true}).click();
        check(new URL(p.url()).pathname === '/tasks' && await p.locator('#inspector_task_id').inputValue() === '', 'Inline Close stays on Tasks and clears only selection');
        await p.goto(baseURL + `/task-inspector/${child.id}`);
        await p.waitForFunction(() => !document.getElementById('task_properties_editor').disabled);
        check((await p.locator('#detail_task_sessions_list').textContent()).includes('Child-only history'), 'Dedicated route still uses own recorded history');
        check(errors.length === 0, 'No browser page errors');
        return {results, errors, writes, layouts, faultBoundaries, faultEvents, fixtures: {parent, child, grandchild, other, own, future, disposable},
            gaps: ['Probe authored before native review; execution and presentation/contrast samples remain separate.', 'Physical touch, screen readers, other engines, completion Clear/subtree independence, full queued-child fault retry and real idle/frozen Timer closure remain separate.']};
    } finally { await context.close(); }
};
