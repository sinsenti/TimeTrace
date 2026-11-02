/* Manual Settings-link guard at existing task-detail and task/session editor callers. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    const p = await context.newPage();
    const errors = [], writes = [], dialogs = [];
    let phase = 'detail startup';
    p.on('request', request => {
        if (request.method() !== 'GET') writes.push({phase,method:request.method(),url:request.url(),body:request.postData()});
    });
    p.on('pageerror', error => errors.push(error.message));
    p.on('dialog', async dialog => {dialogs.push(dialog.message()); await dialog.dismiss();});
    let task;
    try {
        await context.route('**/api/ai/providers/catalog', route => route.fulfill({json:{}}));
        const response = await context.request.post(`${baseURL}/api/tasks`,{data:{title:'Synthetic Settings departure task',description:'Original synthetic description',tags:'#synthetic'}});
        if (!response.ok()) throw Error(`Task fixture: ${response.status()}`);
        task = await response.json();
        await p.goto(`${baseURL}/task-inspector/${task.id}`);
        await p.waitForFunction(title => document.getElementById('inspector_edit_title').value === title,task.title);
        phase = 'detail draft';
        await p.locator('#inspector_edit_desc').fill('Unsaved synthetic detail');
        await p.locator('#inspector_edit_attachments').fill('https://example.invalid/synthetic-draft');
        phase = 'detail departure';
        await p.getByRole('link',{name:'Settings',exact:true}).click();
        if (await p.locator('#inspector_edit_desc').inputValue() !== 'Unsaved synthetic detail' || await p.locator('#inspector_edit_attachments').inputValue() !== 'https://example.invalid/synthetic-draft' || dialogs.length !== 1) throw Error('Detail draft lost/unprotected');
        await p.locator('#inspector_edit_desc').fill(task.description);
        await p.locator('#inspector_edit_attachments').fill('');
        await p.getByRole('link',{name:'Settings',exact:true}).click();
        await p.waitForURL('**/settings/ai');
        if (dialogs.length !== 1) throw Error('Reverted detail was still dirty');
        phase = 'tasks startup';
        await p.goto(`${baseURL}/tasks`);
        await p.getByRole('button',{name:'+ Create Task',exact:true}).click();
        await p.locator('#modal_input_title').fill('Unsaved synthetic task title');
        // Modal covers the navbar; dispatch the real link event to exercise its guarded caller.
        phase = 'task modal departure';
        await p.getByRole('link',{name:'Settings',exact:true}).dispatchEvent('click');
        if (await p.locator('#modal_input_title').inputValue() !== 'Unsaved synthetic task title' || dialogs.length !== 2) throw Error('Task modal draft unprotected');
        await p.evaluate(() => closeTaskModal());
        phase = 'dashboard startup';
        await p.goto(`${baseURL}/dashboard`);
        await p.waitForSelector('.fc-timegrid-slot');
        // Observe the existing startup preference reconciliation, before testing departure.
        await p.waitForFunction(() => idleDetectionEnabled === getUserSettings().idleDetectorEnabled);
        phase = 'session draft';
        const initialSession = await p.evaluate(id => {
            createPlanningSession(id);
            return {note:document.getElementById('session_modal_notes').value,currentTask:document.getElementById('session_modal_task_id').value,
                activeElement:document.activeElement?.id,modalHidden:document.getElementById('session_modal').classList.contains('hidden')};
        },task.id);
        await p.locator('#session_modal_notes').fill('Unsaved synthetic session note');
        const attached = await p.locator('#session_modal_task_id').inputValue();
        const sessionState = () => p.evaluate(() => ({
            note:document.getElementById('session_modal_notes').value,currentTask:document.getElementById('session_modal_task_id').value,
            activeElement:document.activeElement?.id,search:document.getElementById('session_modal_task_search').value,
            modalHidden:document.getElementById('session_modal').classList.contains('hidden'),url:location.href
        }));
        const beforeDispatch = await sessionState();
        phase = 'session departure';
        await p.getByRole('link',{name:'Settings',exact:true}).dispatchEvent('click');
        const afterDispatch = await sessionState();
        const sessionDiagnostic = {expectedNote:'Unsaved synthetic session note',expectedTask:task.id,attached,initialSession,beforeDispatch,afterDispatch,dialogCount:dialogs.length,messages:[...dialogs],url:p.url()};
        if (afterDispatch.note !== 'Unsaved synthetic session note' || afterDispatch.currentTask !== attached || attached !== task.id || dialogs.length !== 3 || beforeDispatch.activeElement !== 'session_modal_notes' || afterDispatch.activeElement !== beforeDispatch.activeElement) throw Error('Session note/attachment/focus draft unprotected '+JSON.stringify(sessionDiagnostic));
        await p.evaluate(() => closeSessionModal());
        phase = 'Preferences draft';
        await p.getByRole('button',{name:'Preferences',exact:true}).click();
        await p.locator('#setting_light_theme').selectOption('stone');
        phase = 'Preferences departure';
        await p.getByRole('link',{name:'Open AI Settings',exact:true}).click();
        if (dialogs.length !== 4 || await p.locator('#setting_light_theme').inputValue() !== 'stone') throw Error('Preferences Settings departure unprotected');
        const isStartupConfig = w => w.phase === 'dashboard startup' && w.method === 'POST' &&
            new URL(w.url).pathname === '/idle/toggle' && w.body === JSON.stringify({enabled:true});
        const startupConfigWrites = writes.filter(isStartupConfig);
        const unexpectedWrites = writes.filter(w => !isStartupConfig(w));
        const departureWrites = writes.filter(w => w.phase.endsWith('departure'));
        if (unexpectedWrites.length || departureWrites.length || errors.length) throw Error(JSON.stringify({writes,unexpectedWrites,departureWrites,errors}));
        return {callers:['task detail + reverted','task modal','session note + task attachment','Preferences Open AI Settings'],sessionDiagnostic,dialogs,writes,startupConfigWrites,unexpectedWrites,departureWrites,errors};
    } finally {
        if (task) await context.request.delete(`${baseURL}/api/tasks/${task.id}`);
        await context.close();
    }
};
