/* Real projected occurrences/FullCalendar events and HTTP readbacks. Gestures use public
 * handlers; scope buttons/Escape are native. Deliberate range/metadata failures only are fake. */
async (page, baseURL) => {
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    const context=await page.context().browser().newContext({timezoneId:'UTC'});
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    const p=await context.newPage(),writes=[],dialogs=[],errors=[],results=[];
    p.on('request',r=>{if(['POST','PUT','DELETE'].includes(r.method()))writes.push({method:r.method(),url:r.url(),body:r.postData()});});
    p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
    p.on('pageerror',e=>errors.push(e.message));
    const request=async(method,path,data)=>{const r=await context.request[method](`${baseURL}${path}`,data===undefined?{}:{data});check(r.ok(),`${method} ${path}: ${r.status()} ${await r.text()}`);return r.status()===204?null:r.json();};
    const task=await request('post','/api/tasks',{title:`Synthetic recurring Session ${Date.now()}`,is_recurring:true,recurrence_rule:'daily',recurrence_dtstart:'2030-06-01T23:45:00Z',recurrence_duration_minutes:45,recurrence_timezone:'UTC',estimated_minutes:123});
    const history=await request('post','/sessions',{task_id:task.id,start_time:'2000-01-01T23:45:00Z',end_time:'2000-01-02T00:30:00Z',notes:'Synthetic logged history'});
    const rows=()=>request('get','/sessions?start=2030-06-01T00:00:00Z&end=2030-06-05T00:00:00Z');
    const resize=async(id,minutes)=>{
        await p.evaluate(({id,minutes})=>{
            const event=calendar.getEventById(id);if(!event)throw Error('Expected displayed occurrence');
            window.resizedEvent=event;window.resizeDone=false;window.resizeReverted=0;
            event.setEnd(new Date(event.start.getTime()+minutes*60000));
            handleCalendarEventUpdate(event,'resize',{revert(){window.resizeReverted++;}}).then(()=>{window.resizeDone=true;});
        },{id,minutes});
    };
    const done=()=>p.waitForFunction(()=>window.resizeDone);
    const onlyWrites=()=>writes.filter(w=>w.url.includes('/sessions/'));
    try {
        await p.goto(`${baseURL}/dashboard?date=2030-06-01&view=timeGridThreeDay`);await p.waitForSelector('.fc-timegrid-slot');
        const initial=(await rows()).filter(s=>s.task_id===task.id);check(initial.length===4,'Real range projects four occurrences');
        const first=initial[0].id;
        await p.waitForFunction(id=>Boolean(calendar.getEventById(id)),first);
        await p.evaluate(id=>openEditSessionModal(id),first);
        await resize(first,60);await p.locator('#recurring_resize_modal').waitFor({state:'visible'});
        await p.keyboard.press('Escape');await done();
        check(await p.evaluate(()=>window.resizeReverted)===1 && onlyWrites().length===0,'Resize Escape resolves Cancel and performs no writes');
        check(await p.locator('#session_modal').isVisible(),'Scope Escape leaves underlying Session open');
        await p.keyboard.press('Escape');
        results.push({case:'native scope Escape resolves cancel, underlying editor retained'});

        await p.route('**/sessions?*',route=>route.fulfill({status:503,json:{detail:'Synthetic range read failure after materialization'}}));
        await resize(first,60);await p.locator('#recurring_resize_only_btn').click();await done();
        await p.locator('#task_metadata_notice').waitFor({state:'visible'});
        const materializedId=await p.evaluate(()=>window.resizedEvent.id);
        check(materializedId!==first&&!materializedId.startsWith('virt:'),'Real FullCalendar Event adopts returned UUID before failed refresh');
        const materialized=await request('get',`/sessions/${materializedId}`);
        check(materialized.duration_seconds===3600 && materialized.task_id===task.id,'Occurrence-only resize saved authoritative row');
        const beforeRetry=onlyWrites().length;
        await p.unroute('**/sessions?*');
        await p.locator('#task_metadata_notice button').click();
        await p.waitForFunction(()=>!document.getElementById('task_metadata_notice'));
        check(onlyWrites().length===beforeRetry,'Retry refresh never repeats virtual PUT');
        check(await p.evaluate(id=>Boolean(calendar.getEventById(id)),materializedId),'Real identity survives successful range recovery');
        results.push({case:'materialized identity + failed range + read-only retry',first,materializedId,materialized});

        const second=initial[1].id;
        await resize(second,75);await p.locator('#recurring_resize_all_btn').click();await done();
        const updatedTask=await request('get',`/api/tasks/${task.id}`);
        check(updatedTask.estimated_minutes===123 && updatedTask.recurrence_duration_minutes===75,'All-future resize changes series duration, never task estimate');
        results.push({case:'all-future resize preserves task estimate',updatedTask});

        await p.evaluate(id=>promptDeleteSession(id),first===materializedId?first:materializedId);
        await p.locator('#recurring_delete_modal').waitFor({state:'visible'});
        const beforeCancel=onlyWrites().length;await p.keyboard.press('Escape');
        check(onlyWrites().length===beforeCancel,'Delete scope Cancel performs no writes');
        await p.evaluate(id=>promptDeleteSession(id),materializedId);
        await p.locator('#recurring_delete_modal button[onclick="confirmRecurringDelete(\'only_this\')"]').click();
        await p.waitForFunction(id=>!allSessions.some(s=>s.id===id),materializedId);
        await request('put',`/api/tasks/${task.id}`,{description:'Unrelated edit after skip'});
        check(!(await rows()).some(s=>s.id===first || s.id===materializedId),'Skipped materialized occurrence is never resurrected by task edit');
        results.push({case:'Delete Cancel + only-this skip + unrelated task edit'});

        const remaining=(await rows()).filter(s=>s.task_id===task.id);
        await p.evaluate(id=>promptDeleteSession(id),remaining.at(-1).id);
        await p.locator('#recurring_delete_modal button[onclick="confirmRecurringDelete(\'following\')"]').click();
        await p.waitForFunction(()=>document.getElementById('recurring_delete_modal').classList.contains('hidden'));
        check((await request('get',`/sessions/${history.id}`)).notes==='Synthetic logged history','Following delete preserves logged history');
        await p.evaluate(id=>promptDeleteSession(id),remaining[0].id);
        await p.locator('#recurring_delete_modal button[onclick="confirmRecurringDelete(\'all\')"]').click();
        await p.waitForFunction(()=>document.getElementById('recurring_delete_modal').classList.contains('hidden'));
        // Wait for the committed series state rather than just the synchronously closed scope popup.
        await p.waitForFunction(id=>!taskKnowledge.get(id)?.is_recurring,task.id);
        check((await rows()).filter(s=>s.task_id===task.id).length===0,'All delete stops future projections');
        check((await request('get',`/sessions/${history.id}`)).notes==='Synthetic logged history','All delete preserves logged history');
        results.push({case:'following/all scopes preserve logged history',historyId:history.id});
        check(errors.length===0,`No page errors: ${errors}`);
        return {results,writes,dialogs,errors,fakes:['range read 503 after materialization','catalog'],limits:['Move/resize use public FullCalendar handler, not physical drag gesture','Unknown recurrence retries covered separately in Node suite']};
    } finally {await context.close();}
}
