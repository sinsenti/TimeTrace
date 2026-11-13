/* Manual Chromium acceptance probe. Synthetic scratch data and explicit HTTP fault seams only. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({viewport: {width: 1440, height: 1000}});
    const p = await context.newPage(), results = [], errors = [], writes = [], layouts = [];
    const origin = new URL(baseURL).origin;
    const faultEvents = [];
    const faultBoundaries = [
        {name: 'rejected-child', method: 'POST', path: '/api/tasks', status: 400, phase: 'shared-child-retry', maximum: 1, successfulMutation: false},
        {name: 'concurrent-timer-status', method: 'GET', path: '/timer/status', status: 200, phase: 'timer-preflight-only', successfulMutation: false},
        {name: 'failed-task-read', method: 'GET', path: '/api/tasks', query: '?status=all', status: 500, phase: 'refresh-recovery-only', successfulMutation: false}
    ];
    const atOrigin = request => new URL(request.url()).origin === origin;
    const atEndpoint = (request, method, path) => atOrigin(request) && request.method() === method && new URL(request.url()).pathname === path;
    const fault = (name, request) => faultEvents.push({name, method: request.method(), path: new URL(request.url()).pathname, query: new URL(request.url()).search});
    const check = (ok, message) => { if (!ok) throw Error(message); results.push(message); };
    const post = async (path, data) => {
        const response = await context.request.post(baseURL + path, {data});
        if (!response.ok()) throw Error(`${path}: ${response.status()} ${await response.text()}`);
        return response.json();
    };
    const rows = async () => (await context.request.get(baseURL + '/api/tasks?status=all')).json();
    const stamp = `06-${Date.now()}`;
    await context.addInitScript(expectedOrigin => {
        if (!['http:', 'https:'].includes(location.protocol) || location.origin !== expectedOrigin) return;
        localStorage.setItem('timetrace_user_settings', localStorage.getItem('timetrace_user_settings') || JSON.stringify({taskView: 'grouped', appearance: 'light', lightTheme: 'refined', idleDetectorEnabled: false, enableVimMotions: false, colorSeed: 42}));
    }, origin);
    p.on('pageerror', error => errors.push(error.message));
    p.on('dialog', dialog => dialog.accept());
    p.on('request', request => {
        if (atOrigin(request) && !['GET', 'HEAD'].includes(request.method())) writes.push({path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON()});
    });
    const parent = await post('/api/tasks', {title: `${stamp} Parent`, tags: '#grouped', estimated_minutes: 45, attachments: 'https://example.invalid/reference'});
    const child = await post('/api/tasks', {title: `${stamp} Child <img src=x onerror=window.groupedExecuted=1>`, parent_id: parent.id, description: 'Long '.repeat(80)});
    const other = await post('/api/tasks', {title: `${stamp} Other`});
    for (let index = 0; index < 24; index++) await post('/api/tasks', {title: `${stamp} List ${index} ${index === 0 ? 'LongUnbrokenTitle'.repeat(20) : ''}`});
    try {
        await p.goto(baseURL + '/tasks');
        await p.waitForSelector('.grouped-task');
        await p.waitForFunction(() => taskKnowledge.state().status === 'fresh');
        const childRow = p.locator(`[data-task-id="${child.id}"]`);
        check(await childRow.count() === 1, 'Grouped child is assigned once');
        check(await p.locator('.grouped-task').count() >= 27, 'Long grouped list remains fully available');
        check((await childRow.textContent()).includes('Subtask of ' + parent.title), 'Hierarchy parent label retained');
        check(await childRow.locator('img').count() === 0, 'Untrusted row title remains literal');
        await p.locator('#tasks_search').fill('Child');
        check(await p.locator('.grouped-task').count() === 1, 'Search keeps matching child with filtered-parent context');
        check((await childRow.textContent()).includes(parent.title), 'Filtered parent context remains visible');
        await p.locator('#tasks_search').fill('');
        await p.locator('#tasks_search').fill('No matching task marker 06');
        check(await p.locator('.grouped-task').count() === 0 && await p.getByText('No matching tasks', {exact: true}).count() > 0, 'Empty search has a legible empty state');
        await p.locator('#tasks_search').fill('');
        const filterWrites = writes.length;
        await p.getByRole('button', {name: 'Filter', exact: true}).click();
        await p.locator('#filter_input_query').fill(`${stamp} Other`);
        await p.getByRole('button', {name: /^Apply Filter/}).click();
        await p.waitForFunction(() => document.querySelectorAll('.grouped-task').length === 1);
        check(await p.locator(`[data-task-id="${other.id}"]`).count() === 1, 'Existing Filter Apply renders Grouped rows');
        await p.locator('.custom-filter-trigger-btn').click();
        await p.getByRole('button', {name: 'Clear Filter', exact: true}).click();
        await p.waitForFunction(() => document.querySelectorAll('.grouped-task').length >= 3);
        check(writes.length === filterWrites, 'Existing Filter Clear rereads without task writes');
        await p.locator('#task_view_selector').selectOption('kanban');
        await p.waitForSelector('.kanban-col');
        await p.locator('#task_view_selector').selectOption('grouped');
        await p.reload();
        await p.waitForSelector('.grouped-task');
        check(await p.locator('#task_view_selector').inputValue() === 'grouped', 'Grouped preference survives reload');
        await p.goto(baseURL + '/task-inspector/' + parent.id);
        await p.waitForSelector('#detail_task_title_header');
        await p.goto(baseURL + '/tasks');
        await p.waitForSelector('.grouped-task');
        check(await p.locator('#task_view_selector').inputValue() === 'grouped', 'Grouped preference survives dedicated-details navigation');
        check(await p.evaluate(() => getUserSettings().colorSeed) === 42, 'Unrelated appearance preference retained');

        // Shared Task editor: cancellation and acknowledged parent/child retry.
        await p.locator(`[data-task-id="${parent.id}"]`).getByRole('button', {name: 'Edit', exact: true}).click();
        await p.locator('#modal_input_title').fill('Canceled edit');
        const canceledWrites = writes.length;
        await p.locator('#modal_input_title').press('Escape');
        check(writes.length === canceledWrites, 'Task Escape cancels without writes');
        check(await p.locator('#tasks_heading').evaluate(el => document.activeElement === el), 'Task cancellation returns focus to stable heading');
        await p.getByRole('button', {name: '+ Create Task', exact: true}).click();
        await p.locator('#modal_input_title').fill(`${stamp} Queue parent #effective [30m]`);
        await p.locator('#task_child_title').fill(`${stamp} First`);
        await p.locator('#task_child_title').press('Enter');
        await p.locator('#task_child_title').fill(`${stamp} Second`);
        let rejectChild = true;
        await p.route('**/api/tasks', async route => {
            if (atEndpoint(route.request(), 'POST', '/api/tasks') && route.request().postDataJSON().title === `${stamp} Second` && rejectChild) {
                fault('rejected-child', route.request());
                rejectChild = false;
                return route.fulfill({status: 400, json: {detail: 'Synthetic child rejection'}});
            }
            return route.continue();
        });
        await p.locator('#task_save_btn').click();
        await p.waitForFunction(() => document.getElementById('task_save_feedback').textContent.includes('Retry'));
        check(await p.locator('#modal_input_title').isDisabled(), 'Partial child failure retains and locks acknowledged parent');
        await p.locator('#task_save_btn').click();
        await p.waitForFunction(() => document.getElementById('task_modal').classList.contains('hidden'));
        const saved = await rows();
        const queuedParents = saved.filter(row => row.title === `${stamp} Queue parent`);
        check(queuedParents.length === 1, 'Authoritative readback acknowledges exactly one parsed queue parent');
        const queuedParent = queuedParents[0];
        const children = saved.filter(row => row.parent_id === queuedParent.id);
        check(children.length === 2 && children.filter(row => row.title === `${stamp} First`).length === 1 && children.filter(row => row.title === `${stamp} Second`).length === 1 && children.every(row => row.tags.includes('#effective')), 'Authoritative readback acknowledges each child once with effective parent tags');
        const attempted = title => writes.filter(write => write.path === '/api/tasks' && write.method === 'POST' && write.body?.title === title).length;
        check(attempted(`${stamp} Queue parent #effective [30m]`) === 1, 'Request attempts: parent exactly once, using original syntax-bearing title');
        check(attempted(`${stamp} First`) === 1, 'Request attempts: First child exactly once');
        check(attempted(`${stamp} Second`) === 2 && faultEvents.filter(event => event.name === 'rejected-child').length === 1, 'Request attempts: Second child twice, one declared400 and one real retry');

        // Shared Session → nested Task → return retains the original initialized draft.
        await p.locator(`[data-task-id="${parent.id}"]`).getByRole('button', {name: 'Schedule / Timer', exact: true}).click();
        await p.waitForSelector('#session_modal:not(.hidden)');
        await p.locator('#session_modal_notes').fill('Retain this Session draft');
        const before = await p.evaluate(() => ['session_modal_start', 'session_modal_end', 'session_modal_notes'].map(id => document.getElementById(id).value));
        const beforeNested = writes.length;
        await p.locator('#session_modal_new_task_btn').click();
        await p.locator('#modal_input_title').fill('Nested canceled task');
        await p.locator('#modal_input_title').press('Escape');
        check(await p.locator('#session_modal').isVisible(), 'Nested Task Cancel resumes Session');
        check(JSON.stringify(before) === JSON.stringify(await p.evaluate(() => ['session_modal_start', 'session_modal_end', 'session_modal_notes'].map(id => document.getElementById(id).value))), 'Session draft survives nested Task Cancel');
        check(writes.length === beforeNested, 'Nested cancellation makes no writes');
        await p.locator('#session_modal_start').fill('2099-01-01T10:00');
        await p.locator('#session_modal_end').fill('2099-01-01T10:30');
        await p.locator('#session_modal_save_btn').click();
        await p.waitForFunction(() => document.getElementById('session_modal').classList.contains('hidden'));
        check(await p.locator('#tasks_heading').evaluate(el => document.activeElement === el), 'Session Save returns focus to persistent heading');
        check(writes.filter(write => write.path === '/sessions' && write.method === 'POST').length === 1, 'Explicit Session Save sends one shared session write');

        await p.locator(`[data-task-id="${parent.id}"]`).getByRole('button', {name: 'Edit', exact: true}).click();
        await p.locator('#modal_input_status').selectOption('Done');
        await p.locator('#task_save_btn').click();
        await p.waitForSelector('#completion_policy_modal:not(.hidden)');
        const clears = writes.filter(write => write.path.includes('clear-scheduled-sessions')).length;
        await p.getByRole('button', {name: 'Keep them', exact: true}).click();
        check(writes.filter(write => write.path.includes('clear-scheduled-sessions')).length === clears, 'Completion prompt Keep makes no schedule-clear write');
        check((await (await context.request.get(baseURL + '/sessions')).json()).some(session => session.task_id === parent.id), 'Completion Keep preserves scheduled session');

        // Controlled status seam: existing Timer preflight rejects a concurrent timer.
        let statusReads = 0;
        await p.route('**/timer/status', route => {
            if (!atEndpoint(route.request(), 'GET', '/timer/status')) return route.continue();
            fault('concurrent-timer-status', route.request());
            statusReads++;
            return route.fulfill({json: {is_running: true, is_frozen_idle: false, pending_idle_gap: null, task_id: 'synthetic-active', start_time: '2020-01-01T00:00:00Z', elapsed_seconds: 1}});
        });
        await p.locator(`[data-task-id="${other.id}"]`).getByRole('button', {name: 'Schedule / Timer', exact: true}).click();
        await p.locator('#session_modal_notes').fill('Timer rejected draft');
        const timerWrites = writes.filter(write => write.path === '/timer/start').length;
        await p.locator('#session_modal_start_now_btn').click();
        await p.waitForFunction(() => document.getElementById('session_modal_feedback').textContent.includes('not started'));
        check(statusReads > 0 && writes.filter(write => write.path === '/timer/start').length === timerWrites, 'Timer Now performs status preflight and sends no start over existing timer');
        check(await p.locator('#session_modal_notes').inputValue() === 'Timer rejected draft', 'Rejected timer retains Session draft');
        await p.locator('#session_modal_notes').press('Escape');
        await p.unroute('**/timer/status');

        // A failed display read retains rows and read-only Retry refresh never replays saves.
        let failRead = true;
        await p.route('**/api/tasks?*', route => {
            if (!failRead || !atEndpoint(route.request(), 'GET', '/api/tasks') || new URL(route.request().url()).search !== '?status=all') return route.continue();
            fault('failed-task-read', route.request());
            return route.fulfill({status: 500, json: {detail: 'Synthetic read failure'}});
        });
        const writeCount = writes.length;
        await p.evaluate(() => taskKnowledge.refresh());
        check(await p.locator(`[data-task-id="${other.id}"]`).count() === 1, 'Failed read retains last-known Grouped rows');
        failRead = false;
        await p.getByRole('button', {name: 'Retry refresh', exact: true}).click();
        await p.waitForFunction(() => !document.getElementById('task_metadata_notice'));
        check(writes.length === writeCount, 'Retry refresh only reads');
        await p.unroute('**/api/tasks?*');

        // Grouped row uses the shared Task delete confirmation and domain contract.
        const deleteAttemptsBefore = writes.filter(write => write.method === 'DELETE').length;
        await p.locator(`[data-task-id="${other.id}"]`).getByRole('button', {name: 'Edit', exact: true}).click();
        await p.locator('#modal_delete_btn').click();
        await p.waitForSelector('#custom_confirm_modal:not(.hidden)');
        await p.locator('#confirm_modal_cancel_btn').click();
        await p.waitForFunction(() => document.getElementById('custom_confirm_modal').classList.contains('hidden'));
        check(writes.filter(write => write.method === 'DELETE').length === deleteAttemptsBefore && await p.locator(`[data-task-id="${other.id}"]`).count() === 1, 'Delete confirmation Cancel sends no DELETE and retains Grouped row');
        await p.locator('#modal_delete_btn').click();
        await p.waitForSelector('#custom_confirm_modal:not(.hidden)');
        await p.locator('#confirm_modal_proceed_btn').click();
        await p.waitForFunction(taskId => document.getElementById('task_modal').classList.contains('hidden') && !document.querySelector(`[data-task-id="${taskId}"]`), other.id);
        check(writes.filter(write => write.method === 'DELETE' && write.path === `/api/tasks/${other.id}`).length === 1 && writes.filter(write => write.method === 'DELETE').length === deleteAttemptsBefore + 1, 'Confirmed delete attempts exactly one DELETE for the owned task');
        check(!(await rows()).some(row => row.id === other.id), 'Public task readback acknowledges owned task deletion');
        check(await p.locator('#tasks_heading').evaluate(el => document.activeElement === el), 'Shared Task Delete restores stable heading focus');
        check((await (await context.request.get(baseURL + '/sessions')).json()).some(session => session.task_id === parent.id), 'Deleting other task preserves scheduled parent Session');

        for (const width of [390, 768, 1024, 1440]) {
            await p.setViewportSize({width, height: 1000});
            for (const [appearance, theme] of [['light', 'refined'], ['light', 'stone'], ['light', 'porcelain'], ['dark', 'midnight'], ['dark', 'nord'], ['dark', 'dracula'], ['dark', 'cyberpunk'], ['dark', 'monokai']]) {
                await p.evaluate(({appearance, theme}) => {
                    const settings = getUserSettings();
                    settings.appearance = appearance;
                    if (appearance === 'light') settings.lightTheme = theme; else settings.theme = theme;
                    saveUserSettings(settings); return applyUserSettings();
                }, {appearance, theme});
                await p.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || !Number.isFinite(animation.effect?.getComputedTiming().endTime)), null, {timeout: 2000});
                const layout = await p.evaluate(() => {
                    const rgb = value => {
                        const match = value.match(/^rgba?\(([^)]+)\)$/);
                        if (!match) return null;
                        const channels = match[1].split(',').map(Number);
                        return channels.length >= 3 && (channels.length === 3 || channels[3] === 1) ? channels.slice(0, 3) : null;
                    };
                    const luminance = color => color.map(channel => {
                        const value = channel / 255;
                        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
                    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
                    const sample = (selector, inherited) => {
                        const element = document.querySelector(selector);
                        if (!element) return {selector, inherited, missing: true};
                        const foreground = rgb(getComputedStyle(element).color);
                        let background = null, opaque = true;
                        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
                            const style = getComputedStyle(ancestor);
                            if (Number(style.opacity) !== 1 || style.backgroundImage !== 'none') opaque = false;
                            if (!background) {
                                const candidate = rgb(style.backgroundColor);
                                if (candidate) background = candidate;
                                else if (!['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor)) opaque = false;
                            }
                        }
                        if (!opaque || !foreground || !background) return {selector, inherited, opaque: false, foreground, background};
                        const first = luminance(foreground), second = luminance(background);
                        return {selector, inherited, opaque: true, foreground, background, ratio: (Math.max(first, second) + .05) / (Math.min(first, second) + .05), threshold: 4.5};
                    };
                    const contrast = ['.grouped-summary', '.grouped-status h2', '.grouped-task-title', '.grouped-task-copy p', '.grouped-metadata span', '.grouped-task-actions button'].map(selector => sample(selector, false));
                    const inheritedContrast = ['#tasks_tools p', '#tasks_tools button', '.app-navigation a'].map(selector => sample(selector, true));
                    const container = document.getElementById('kanban_columns_container');
                    const bounds = container.getBoundingClientRect();
                    const descendants = [...container.querySelectorAll('.grouped-task-copy, .grouped-task-copy *, .grouped-task-actions, .grouped-task-actions *')];
                    const overflowingDescendants = descendants.filter(element => {
                        const rects = [...element.getClientRects()];
                        return rects.some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1) ||
                            (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1);
                    }).map(element => ({tag: element.tagName, className: element.className, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth}));
                    return {width: innerWidth, page: document.documentElement.scrollWidth,
                        container: {scrollWidth: container.scrollWidth, clientWidth: container.clientWidth}, overflowingDescendants,
                        rows: [...document.querySelectorAll('.grouped-task')].every(el => el.getBoundingClientRect().right <= innerWidth + 1),
                        buttons: [...document.querySelectorAll('.grouped-task button')].every(el => el.getBoundingClientRect().height >= 44),
                        contrast, inheritedContrast,
                        inheritedContrastFailures: inheritedContrast.filter(item => !item.missing && (!item.opaque || item.ratio < item.threshold))};
                });
                layouts.push({appearance, theme, ...layout});
                check(layout.page <= layout.width + 1 && layout.container.scrollWidth <= layout.container.clientWidth + 1 && layout.overflowingDescendants.length === 0 && layout.rows && layout.buttons, `${width}/${appearance}/${theme}: document/container/descendant bounds and touch-size controls ${JSON.stringify({page: layout.page, width: layout.width, container: layout.container, overflowingDescendants: layout.overflowingDescendants, rows: layout.rows, buttons: layout.buttons})}`);
                const contrastFailures = layout.contrast.filter(item => !item.opaque || item.ratio < item.threshold);
                check(contrastFailures.length === 0, `${width}/${appearance}/${theme}: six first-match Grouped opaque text contrast samples >=4.5 ${JSON.stringify(contrastFailures)}`);
            }
        }
        check(errors.length === 0, 'No page errors in Grouped workflows');
        return {results, errors, writes, layouts, faultBoundaries: faultBoundaries.map(boundary => ({...boundary, calls: faultEvents.filter(event => event.name === boundary.name).length})), faultEvents};
    } finally {
        await context.close();
    }
};
