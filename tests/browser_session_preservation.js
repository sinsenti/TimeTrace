/* Caller preservation checks: unknown recurrence, real move, task completion policy UI. */
async (page,baseURL)=>{
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    const context=await page.context().browser().newContext({timezoneId:'UTC'});
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    const p=await context.newPage(),writes=[],dialogs=[],errors=[],results=[];
    p.on('request',r=>{if(['POST','PUT','DELETE'].includes(r.method()))writes.push({method:r.method(),path:new URL(r.url()).pathname,body:r.postData()});});
    p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});p.on('pageerror',e=>errors.push(e.message));
    const request=async(method,path,data)=>{const r=await context.request[method](`${baseURL}${path}`,data===undefined?{}:{data});check(r.ok(),`${method} ${path}: ${r.status()}`);return r.status()===204?null:r.json();};
    const session=task_id=>request('post','/sessions',{task_id,start_time:'2030-06-01T13:00:00Z',end_time:'2030-06-01T13:45:00Z',notes:'Synthetic preserved Session'});
    try{
        const task=await request('post','/api/tasks',{title:`Synthetic unknown recurrence ${Date.now()}`});
        const row=await session(task.id);
        await p.goto(`${baseURL}/dashboard?date=2030-06-01&view=timeGridThreeDay`);await p.waitForSelector('.fc-timegrid-slot');
        await p.waitForFunction(id=>Boolean(calendar.getEventById(id)),row.id);
        const metadata='**/api/tasks?status=all';await p.route(metadata,route=>route.fulfill({json:[]}));await p.evaluate(()=>taskKnowledge.changed());
        const before=writes.filter(w=>w.path.startsWith('/sessions')).length;
        await p.evaluate(async id=>{window.reverted=0;const event=calendar.getEventById(id);await handleCalendarEventUpdate(event,'resize',{revert(){window.reverted++;}});},row.id);
        check(await p.evaluate(()=>window.reverted)===1 && writes.filter(w=>w.path.startsWith('/sessions')).length===before,'Unknown recurrence blocks unsafe resize without a write');
        await p.evaluate(id=>promptDeleteSession(id),row.id);
        check(dialogs.some(s=>s.includes('Try Delete again')) && writes.filter(w=>w.path.startsWith('/sessions')).length===before,'Unknown recurrence blocks unsafe deletion with retry message');
        await p.evaluate(async id=>{const event=calendar.getEventById(id);event.setDates(new Date('2030-06-01T15:00Z'),new Date('2030-06-01T15:45Z'));await handleCalendarEventUpdate(event,'move');},row.id);
        check((await request('get',`/sessions/${row.id}`)).start_time==='2030-06-01T15:00:00+00:00','Ordinary move remains available while recurrence metadata is unknown');
        await p.unroute(metadata);await p.evaluate(()=>taskKnowledge.refresh());
        await p.evaluate(async id=>{const event=calendar.getEventById(id);event.setEnd(new Date('2030-06-01T16:00Z'));await handleCalendarEventUpdate(event,'resize');},row.id);
        check((await request('get',`/sessions/${row.id}`)).duration_seconds===3600,'Retry resolves recurrence and saves only the retried resize');
        check(writes.filter(w=>w.path.startsWith('/sessions')).length===before+2,'No blocked action is queued or replayed');
        results.push({case:'unknown resize/delete, available move, explicit resize retry',rowId:row.id,dialogs:[...dialogs]});

        for(const choice of ['keep','selected-own','subtree-only']){
            const parent=await request('post','/api/tasks',{title:`Synthetic completion ${choice} ${Date.now()}`,status:'Scheduled'});
            const child=await request('post','/api/tasks',{title:'Synthetic child',parent_id:parent.id});
            const own=[await session(parent.id),await session(parent.id)],descendant=await session(child.id);
            await p.evaluate(async () => { await taskKnowledge.changed(); return true; });
            await p.evaluate(id=>openEditTaskModal(id),parent.id);
            await p.locator('#modal_input_status').selectOption({label:'Done'});
            await p.locator('#task_modal button[onclick="saveTask()"] ').click();
            await p.locator('#completion_policy_modal').waitFor({state:'visible'});
            const checks=p.locator('.completion_policy_session_checkbox');check(await checks.count()===2,'Completion still prompts for both own sessions');
            if(choice==='keep')await p.locator('#completion_policy_modal button').filter({hasText:'Keep them'}).click();
            else{
                if(choice==='selected-own')await checks.nth(1).uncheck();
                else{await checks.nth(0).uncheck();await checks.nth(1).uncheck();await p.locator('#completion_policy_include_subtasks').check();}
                await p.locator('#completion_policy_modal button[onclick="clearCompletionPolicySessions()"] ').click();
                await p.locator('#completion_policy_modal').waitFor({state:'hidden'});
            }
            const rows=await request('get','/sessions'),ids=new Set(rows.map(s=>s.id));
            check(ids.has(own[0].id)===(choice!=='selected-own') && ids.has(own[1].id) && ids.has(descendant.id)===(choice!=='subtree-only'),'Keep, own selection and subtree-only clear remain independent');
            results.push({case:`completion ${choice}`,own:own.map(s=>s.id),descendant:descendant.id});
        }
        check(errors.length===0,`No page errors: ${errors}`);
        return{results,writes,dialogs,errors,fakes:['empty task metadata for unknown recurrence','catalog'],limits:['Public move/resize handler, no physical drag gesture']};
    }finally{await context.close();}
}
