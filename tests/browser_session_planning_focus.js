/* Native planning Schedule lifecycle; real sidebar replacement and public row readbacks. */
async (page, baseURL) => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const context = await page.context().browser().newContext({ timezoneId: 'America/New_York' });
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false})));
    const p = await context.newPage(), writes = [], errors = [], dialogs = [], results = [];
    p.on('request', r => {
        if (['POST','PUT','DELETE'].includes(r.method())) writes.push({method:r.method(),path:new URL(r.url()).pathname,body:r.postData()});
    });
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
    const request = async (method, path, data) => {
        const res = await context.request[method](`${baseURL}${path}`, data === undefined ? {} : {data});
        check(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`);
        return res.json();
    };
    const task = await request('post', '/api/tasks', {title:`Synthetic planning focus ${Date.now()}`,estimated_minutes:30,tags:'#planning'});
    const launcher = () => p.getByRole('button',{name:`Schedule ${task.title}`,exact:true});
    const open = async () => {
        await launcher().waitFor({state:'visible'});
        await launcher().focus();
        await launcher().evaluate(el => { window.planningFocusLauncher = el; });
        await launcher().press('Enter');
        await p.locator('#session_modal').waitFor({state:'visible'});
        await p.waitForFunction(() => document.activeElement.id === 'session_modal_task_search');
        check(await p.locator('#session_modal_task_id').inputValue() === task.id,'Native Schedule attaches the chosen task');
    };
    const posts = () => writes.filter(w => w.method === 'POST' && w.path === '/sessions');
    const save = () => p.locator('#session_modal_notes').press('Control+Enter');
    try {
        await p.goto(`${baseURL}/dashboard?date=2026-11-10&view=timeGridThreeDay`);
        await p.waitForSelector('.fc-timegrid-slot');
        await open();
        await p.locator('#session_modal_notes').fill('Canceled planning draft');
        const beforeCancel = writes.length;
        await p.keyboard.press('Escape');
        await p.locator('#session_modal').waitFor({state:'hidden'});
        check(await p.evaluate(() => window.planningFocusLauncher.isConnected && document.activeElement === window.planningFocusLauncher),'Cancel restores the exact connected Schedule button');
        check(writes.length === beforeCancel,'Cancel sends no write');
        results.push({case:'native Schedule Cancel',noWrites:true,exactConnectedLauncher:true});

        await open();
        const notes = 'Native planning Save\nPreserve usable focus';
        await p.locator('#session_modal_notes').fill(notes);
        const beforeSave = posts().length;
        await save();
        await p.locator('#session_modal').waitFor({state:'hidden'});
        await p.waitForFunction(() => !window.planningFocusLauncher.isConnected);
        const id = await p.locator('#edit_session_id').inputValue();
        const row = await request('get', `/sessions/${id}`);
        check(posts().length === beforeSave + 1,'Clean native Save sends one Session POST');
        const payload = JSON.parse(posts().at(-1).body);
        check(payload.task_id === task.id && payload.notes === notes && row.task_id === task.id && row.notes === notes,'Real payload and authoritative row retain task and multiline Notes');
        const focus = await p.evaluate(() => ({active:document.activeElement.id,connected:document.activeElement.isConnected,oldLauncherConnected:window.planningFocusLauncher.isConnected,tabIndex:document.activeElement.tabIndex}));
        check(focus.active === 'calendar' && focus.connected && focus.tabIndex === -1,`After ACTUAL sidebar replacement focus remains usable: ${JSON.stringify({focus,id,row,payload})}`);
        // A real subsequent keyboard action can traverse from the stable planning region.
        await p.keyboard.press('Tab');
        check(await p.evaluate(() => document.activeElement !== document.body),'Stable Calendar fallback permits subsequent keyboard navigation');
        results.push({case:'native Schedule Save after actual sidebar replacement',id,row,payload,focus});

        await open();
        await p.locator('#session_modal_notes').fill('Rejected planning Notes');
        await p.route('**/sessions', route => route.request().method() === 'POST' ? route.fulfill({status:400,json:{detail:'Synthetic planning rejection'}}) : route.continue());
        await save();
        await p.waitForFunction(() => !document.getElementById('session_modal_save_btn').disabled);
        check(await p.evaluate(() => !document.getElementById('session_modal').classList.contains('hidden') && document.activeElement.id === 'session_modal_notes' && window.planningFocusLauncher.isConnected),'Rejected Save retains Notes focus, open modal and connected launcher');
        check(await p.locator('#session_modal_notes').inputValue() === 'Rejected planning Notes','Rejected Save retains exact draft');
        await p.unroute('**/sessions');
        await p.keyboard.press('Escape');
        check(await p.evaluate(() => document.activeElement === window.planningFocusLauncher),'Cancel after rejected Save restores connected launcher');
        results.push({case:'planning rejected Save retains draft and focus',dialogs:[...dialogs]});

        await open();
        await p.locator('#session_modal_notes').fill('Submitted planning Notes');
        let release, started;
        const held = new Promise(r => { release = r; }), boundary = new Promise(r => { started = r; });
        await p.route('**/sessions', async route => { if (route.request().method() === 'POST') { started(); await held; } await route.continue(); });
        await save(); await boundary;
        await p.locator('#session_modal_notes').fill('Concurrent planning Notes');
        release();
        await p.waitForFunction(() => document.getElementById('session_modal_feedback').textContent.includes('New edits'));
        await p.waitForFunction(() => !window.planningFocusLauncher.isConnected);
        check(await p.evaluate(() => !document.getElementById('session_modal').classList.contains('hidden') && document.activeElement.id === 'session_modal_notes' && hasSettingsDrafts(['session_modal'])),'Concurrent dirty Save retains modal focus even after actual sidebar replacement');
        const concurrentId = await p.locator('#edit_session_id').inputValue();
        const concurrentRow = await request('get', `/sessions/${concurrentId}`);
        check(concurrentRow.notes === 'Submitted planning Notes' && await p.locator('#session_modal_notes').inputValue() === 'Concurrent planning Notes','Acknowledged write does not consume concurrent draft');
        await p.unroute('**/sessions');
        await p.keyboard.press('Escape');
        check(await p.evaluate(() => document.activeElement.id === 'calendar'),'Cancel after disposed launcher uses stable Calendar');
        results.push({case:'planning concurrent dirty Save retains modal focus',id:concurrentId,row:concurrentRow});
        check(errors.length === 0,`No pageerrors: ${errors}`);
        return {task,results,writes,dialogs,errors,fakes:['catalog','one rejected Session POST','held real Session POST']};
    } finally {
        await context.close();
    }
}
