/* Additional native ownership/long-text checks; real APIs plus explicitly held HTTP only. */
async (page, baseURL) => {
    const results = [], errors = [], layering = [];
    const check = (ok,message) => {if(!ok)throw Error(message);results.push(message);};
    const longText = '<script>window.exportExecuted=true</script>\n' + 'unbroken-literal-'.repeat(1500);
    for (const timezoneId of ['America/New_York','Pacific/Kiritimati']) {
        const context = await page.context().browser().newContext({timezoneId,viewport:{width:390,height:900}});
        await context.addInitScript(ownedOrigin => {
            if (location.origin !== ownedOrigin) return;
            localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false}));
        }, new URL(baseURL).origin);
        const p = await context.newPage(); p.on('pageerror',e=>errors.push(e.message));
        try {
            const response = await context.request.post(baseURL+'/api/tasks',{data:{title:'Literal export long text '+timezoneId,description:longText}});
            check(response.ok(),'Real API creates synthetic long-text task');
            const task = await response.json();
            await p.goto(baseURL+'/dashboard?date=2026-11-10&view=timeGridThreeDay'); await p.waitForSelector('.fc-timegrid-slot');
            const open = async()=>{await p.locator('button[onclick="openExportModal()"]').click();};
            const ready = async()=>p.waitForFunction(()=>!document.getElementById('export_download').disabled);
            const ownsHit = async (fieldId, modalId, message) => {
                const observed = await p.evaluate(({fieldId,modalId})=>{
                    const field=document.getElementById(fieldId),modal=document.getElementById(modalId);
                    const rect=field.getBoundingClientRect();
                    const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
                    return {fieldId,modalId,modalZ:getComputedStyle(modal).zIndex,
                        exportZ:getComputedStyle(document.getElementById('export_modal')).zIndex,
                        hitId:hit?.id || hit?.tagName,ownsHit:!!hit && modal.contains(hit)};
                },{fieldId,modalId});
                layering.push(observed);check(observed.ownsHit,message);
            };
            await open(); await ready();
            const initial = await p.locator('#export_preview').inputValue();
            const generated = initial.match(/generated_at: (\d{4}-\d{2}-\d{2})/)[1];
            const tomorrow = new Date(generated+'T00:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
            check(initial.includes('## Tomorrow ('+tomorrow.toISOString().slice(0,10)+')'), `${timezoneId}: agenda date anchors remain UTC, not browser Today`);
            check((await p.locator('#export_caveat').textContent()).includes('UTC date anchors with server-local display'),`${timezoneId}: local display caveat is explicit`);
            let release,entered;
            const held = new Promise(r=>release=r), boundary = new Promise(r=>entered=r);
            await context.route('**/api/agenda/export?mode=tasks_short', async route=>{entered();await held;await route.fulfill({contentType:'text/markdown',body:'# Obsolete scope preview'});});
            await p.locator('#export_mode_select').selectOption('tasks_short');await boundary;
            await p.locator('#export_mode_select').selectOption('tasks_full'); await ready();
            check((await p.locator('#export_preview').inputValue()).includes(longText),'Real generated long Markdown remains literal in textarea');
            const current = await p.locator('#export_preview').inputValue();
            const oldReply = p.waitForResponse('**/api/agenda/export?mode=tasks_short');release();await oldReply;await p.evaluate(()=>new Promise(requestAnimationFrame));
            check(await p.locator('#export_preview').inputValue() === current,'Late successful response from old scope cannot replace current Markdown');
            check(await p.locator('#export_preview script').count() === 0 && !await p.evaluate(()=>window.exportExecuted),'Long script-like Markdown never executes');
            await context.unroute('**/api/agenda/export?mode=tasks_short');
            for (const theme of ['refined','stone','porcelain','dark']) {
                await p.evaluate(theme=>{if(theme==='dark')setAppearancePreference('appearance','dark');else{setAppearancePreference('lightTheme',theme);setAppearancePreference('appearance','light');}},theme);
                const layout = await p.evaluate(()=>({width:document.documentElement.scrollWidth,preview:document.getElementById('export_preview').value}));
                check(layout.width<=390 && layout.preview===current,`Long inert Markdown retains content and avoids page overflow in ${theme}`);
            }
            await p.keyboard.press('Escape');
            await p.locator('button[onclick="createPlanningSession()"]').click();
            await p.locator('#session_modal_notes').fill('Retained Session draft\n'+timezoneId);
            await p.locator('#session_modal_notes').focus();
            // Public nested-opening contract; this is deliberately separate from the
            // real sidebar interrupted-read gesture below.
            await p.evaluate(()=>openExportModal()); await ready();
            await ownsHit('export_mode_select','export_modal','Programmatic Export over Session owns the actual pointer hit');
            await p.keyboard.press('Escape');
            check(await p.locator('#session_modal_notes').evaluate(el=>document.activeElement===el),'Closing Export over Session returns focus to connected Notes, not a hidden control');
            check(await p.locator('#session_modal_notes').inputValue()==='Retained Session draft\n'+timezoneId,'Nested Export retains the Session draft');
            await p.keyboard.press('Escape');
            // Real capture-phase Escape dispatcher must choose Export above Assistant.
            await p.evaluate(()=>openAiDrawer());
            await p.locator('#ai_composer_input').fill('Retained Assistant draft');
            await p.locator('#ai_composer_input').focus();
            await p.evaluate(()=>openExportModal()); await ready();
            await ownsHit('export_mode_select','export_modal','Focused Export above Assistant owns the actual pointer hit');
            await p.keyboard.press('Escape');
            check(await p.locator('#export_modal').getAttribute('aria-hidden')==='true','Escape closes Export above Assistant');
            check(await p.locator('#ai_drawer').evaluate(el=>el.classList.contains('ai-drawer-open')),'Export Escape preserves Assistant drawer');
            check(await p.locator('#ai_composer_input').inputValue()==='Retained Assistant draft','Export Escape preserves Assistant draft');
            check(await p.locator('#ai_composer_input').evaluate(el=>document.activeElement===el),'Export Escape restores Assistant launcher');
            await p.keyboard.press('Escape');
            // Actual sidebar Edit gesture starts a delayed missing/stale-metadata GET.
            // Invalidation is an explicit fixture through the public metadata boundary;
            // both dialog openings and Escape use their production user-facing callers.
            const editButton=p.locator(`#task_card_list [data-task-id="${task.id}"]`).getByRole('button',{name:'Edit',exact:true});
            await editButton.waitFor();
            await p.evaluate(()=>taskKnowledge.invalidate());
            let finishTask,beginTask,finishExport,beginExport;
            const taskWait=new Promise(r=>finishTask=r),taskStarted=new Promise(r=>beginTask=r);
            const exportWait=new Promise(r=>finishExport=r),exportStarted=new Promise(r=>beginExport=r);
            await context.route(`**/api/tasks/${task.id}`,async route=>{beginTask();await taskWait;await route.continue();});
            let once=true;
            await context.route('**/api/agenda/export?*',async route=>{if(once){once=false;beginExport();await exportWait;}await route.continue();});
            await editButton.click();await taskStarted;
            check(await p.locator('#task_modal').evaluate(el=>el.classList.contains('hidden')),'Sidebar Edit leaves Calendar usable while task lookup is pending');
            await open();await exportStarted;
            await ownsHit('export_mode_select','export_modal','Export opened during sidebar lookup owns the actual pointer hit');
            finishTask();
            await p.locator('#task_modal:not(.hidden)').waitFor();
            await p.waitForFunction(()=>document.activeElement===document.getElementById('modal_input_title'));
            await ownsHit('modal_input_title','task_modal','Delayed real Task editor owns the actual pointer hit above Export');
            await p.locator('#modal_input_title').click();
            await p.locator('#modal_input_title').fill('Newer Task draft');
            const late=p.waitForResponse(r=>r.url().includes('/api/agenda/export'));finishExport();await late;await p.evaluate(()=>new Promise(requestAnimationFrame));
            check(await p.locator('#modal_input_title').evaluate(el=>document.activeElement===el),'Late Export read cannot steal focus from newer Task owner');
            check(await p.locator('#modal_input_title').inputValue()==='Newer Task draft','Newer Task title remains untouched');
            await ownsHit('modal_input_title','task_modal','Late Export reply keeps Task visibly above the preview');
            await p.keyboard.press('Escape');
            check(await p.locator('#task_modal').evaluate(el=>el.classList.contains('hidden')),'Escape targets newer Task owner above Export');
            check(await p.locator('#modal_input_title').inputValue()==='Newer Task draft','Task close retains its unsaved title without writing it');
            check(await p.locator('#export_modal').getAttribute('aria-hidden')==='false','Newer Task Escape does not close Export underneath');
            check(await p.locator('#export_mode_select').evaluate(el=>document.activeElement===el),'Task Escape returns focus to visible Export');
            await ownsHit('export_mode_select','export_modal','Task Escape returns actual pointer ownership to Export');
            await p.keyboard.press('Escape');
            check(await p.locator('#export_modal').getAttribute('aria-hidden')==='true','Next Escape closes the visible Export');
            await context.unroute(`**/api/tasks/${task.id}`);
            await context.unroute('**/api/agenda/export?*');
        } finally {await context.close();}
    }
    check(errors.length===0,'Ownership/long-text native checks have no page errors');
    return {results,errors,layering,fakes:['provider catalog','obsolete tasks_short successful HTTP reply','public task metadata invalidation','held real sidebar Task lookup and Export read'],limits:['NY/Kiritimati browser zones; server-local timezone policy also characterized separately in pytest','No OS clipboard or physical touch certification']};
}
