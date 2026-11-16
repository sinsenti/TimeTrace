/* Manual existing Habit/widget/Add Status form ownership; optional SQL preview is an HTTP fake. */
async (page, baseURL) => {
    const context=await page.context().browser().newContext(),p=await context.newPage();
    const dialogs=[],writes=[],errors=[],results=[];let habit,dashboard;
    p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});p.on('pageerror',e=>errors.push(e.message));
    const departure=async dirty=>{
        const before=dialogs.length, count=writes.length;
        await p.getByRole('link',{name:'Settings',exact:true}).dispatchEvent('click');
        if(dirty) {if(dialogs.length!==before+1 || p.url().endsWith('/settings/ai')) throw Error('Dirty editor left without protection');}
        else {await p.waitForURL('**/settings/ai');if(dialogs.length!==before) throw Error('Clean editor warned');}
        if(writes.length!==count) throw Error('Settings departure auto-wrote');
    };
    try {
        await context.route('**/api/ai/providers/catalog',r=>r.fulfill({json:{}}));
        habit=await(await context.request.post(`${baseURL}/habits`,{data:{name:'Synthetic owner habit',habit_type:'numeric',target_value:3}})).json();
        await p.goto(`${baseURL}/habits-view`);await p.getByText(habit.name,{exact:true}).first().waitFor();
        p.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method()) && !/\/data$|\/analytics\//.test(r.url())) writes.push(r.url());});
        await p.getByRole('button',{name:'+ New Habit',exact:true}).click();
        await p.locator('#modal_habit_name').fill('Draft new Habit');await departure(true);
        await p.locator('#habit_modal button[onclick="closeHabitModal()"] ').first().click();await departure(false);
        await p.goto(`${baseURL}/habits-view`);await p.getByText(habit.name,{exact:true}).first().waitFor();
        await p.locator(`[onclick="openEditHabitModal('${habit.id}')"]`).first().click();
        await p.locator('#modal_habit_name').fill('Draft changed Habit');await departure(true);
        await p.locator('#modal_habit_name').fill(habit.name);await departure(false);
        await p.goto(`${baseURL}/habits-view`);await p.getByText(habit.name,{exact:true}).first().waitFor();
        await p.locator(`[onclick="openEditHabitModal('${habit.id}')"]`).first().click();
        await p.locator('#modal_habit_name').fill('Saved synthetic owner habit');
        const saved=p.waitForResponse(r=>r.url().endsWith(`/habits/${habit.id}`)&&r.request().method()==='PUT');
        await p.locator('#habit_modal button[onclick="saveHabit()"] ').click();if(!(await saved).ok()) throw Error('Habit save failed');
        await p.waitForFunction(()=>document.getElementById('habit_modal').classList.contains('hidden'));await departure(false);
        if((await(await context.request.get(`${baseURL}/habits`)).json()).find(h=>h.id===habit.id)?.name!=='Saved synthetic owner habit') throw Error('Habit not persisted');
        results.push('Habit new/edit cancel/revert/real Save');
        dashboard=await(await context.request.post(`${baseURL}/api/dashboards`,{data:{name:'Synthetic draft ownership dashboard'}})).json();
        let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
        await context.route('**/analytics/capabilities',async r=>{entered();await held;const response=await r.fetch();const json=await response.json();await r.fulfill({json:{...json,sql_enabled:true}});});
        await context.route('**/analytics/sql/schema',r=>r.fulfill({json:{tables:[]}}));
        await context.route('**/analytics/sql',r=>r.fulfill({json:{columns:['amount'],rows:[[1]],row_count:1,elapsed_ms:1}}));
        await p.goto(`${baseURL}/stats`);await p.getByRole('button',{name:dashboard.name,exact:true}).click();
        await p.getByRole('button',{name:'+ Add Widget',exact:true}).click();await started;
        if(await p.locator('#widget_builder_modal').isVisible()) throw Error('Uninitialized builder became editable before capabilities');
        release();await p.locator('#wb_title').waitFor();
        await p.locator('#wb_title').fill('Unsaved structured title');await departure(true);
        await p.locator('#wb_title').fill('');
        await p.locator('#widget_builder_modal').getByRole('button',{name:'Cancel',exact:true}).click();
        await p.getByRole('button',{name:'+ Add Widget',exact:true}).click();
        await p.locator('#wb_title').fill('Saved synthetic widget');
        const widgetSaved=p.waitForResponse(r=>r.url().endsWith(`/api/dashboards/${dashboard.id}/widgets`) && r.request().method()==='POST');
        await p.locator('#wb_submit').click();if(!(await widgetSaved).ok()) throw Error('Real widget Save failed');
        await p.waitForFunction(()=>document.getElementById('widget_builder_modal').classList.contains('hidden'));
        await departure(false);
        const detail=await(await context.request.get(`${baseURL}/api/dashboards/${dashboard.id}`)).json();
        if(!detail.widgets.some(w=>w.title==='Saved synthetic widget')) throw Error('Widget not persisted');
        await p.goto(`${baseURL}/stats`);await p.getByRole('button',{name:dashboard.name,exact:true}).click();
        await p.getByRole('button',{name:'+ Add Widget',exact:true}).click();await p.locator('#wb_tab_sql').click();
        await p.locator('#wb_sql').fill('SELECT 1 AS amount');await p.locator('#wb_title').fill('Unsaved SQL title');
        await p.locator('button[onclick="wbRunSqlPreview()"] ').click();await p.locator('#wb_sql_preview').waitFor();await departure(true);
        await p.locator('#widget_builder_modal').getByRole('button',{name:'Cancel',exact:true}).click();await departure(false);
        results.push('Widget held capabilities/structured canceled departure/real Save/SQL fake preview dirty departure/Cancel');
        await p.goto(`${baseURL}/tasks`);await p.locator('button[onclick="openStatusManagerModal()"] ').click();
        await p.locator('button[onclick="openAddStatusModal()"] ').click();await p.locator('#modal_new_status_name').fill('Unsaved status');
        await departure(true);await p.locator('#add_status_modal button[onclick="closeAddStatusModal()"] ').first().click();
        await departure(false);results.push('Add Status dirty cancel + Cancel clean');
        if(errors.length) throw Error(errors.join('; '));
        return {results,dialogs,writes,errors,fakes:['SQL enabled capability flag + schema + SELECT preview; no SQL backend execution'],realWrites:'Habit PUT and structured widget POST only'};
    } finally {
        if(habit?.id) await context.request.delete(`${baseURL}/habits/${habit.id}`);
        if(dashboard?.id) await context.request.delete(`${baseURL}/api/dashboards/${dashboard.id}`);
        await context.close();
    }
};
