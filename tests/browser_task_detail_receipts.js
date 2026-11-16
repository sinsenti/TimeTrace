/* Native canonical Task receipts: title-parser outputs, concurrent edits and ABA intent. */
async (page, baseURL) => {
    const context=await page.context().browser().newContext({viewport:{width:1024,height:1000}}),p=await context.newPage();
    const results=[],errors=[],writes=[];
    const check=(ok,label)=>{if(!ok)throw Error(label);results.push(label);};
    const get=async path=>(await context.request.get(baseURL+path)).json();
    const task=await (await context.request.post(baseURL+'/api/tasks',{data:{title:`05-receipts-${Date.now()}`,estimated_minutes:60}})).json();
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().startsWith(baseURL)&&['PUT','POST'].includes(r.method()))writes.push({method:r.method(),path:new URL(r.url()).pathname,body:r.postDataJSON()});});
    try {
        await p.goto(`${baseURL}/task-inspector/${task.id}`);await p.waitForFunction(()=>!document.getElementById('task_properties_editor').disabled);
        for(const aba of [false,true]) {
            let release,started;const held=new Promise(r=>release=r),seen=new Promise(r=>started=r);
            await context.route('**/api/tasks',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();started();await held;await route.fulfill({response});});
            await p.getByRole('button',{name:'+ Add Subtask',exact:true}).click();await p.locator('#modal_subtask_title').fill(`Receipt ${aba} [45m]`);
            const before=writes.length;await p.locator('#modal_subtask_title').press('Control+Enter');await seen;
            if(aba){await p.locator('#modal_subtask_est').fill('16m');await p.locator('#modal_subtask_est').fill('15m');}
            else await p.locator('#modal_subtask_title').fill('Concurrent new child title');
            release();await p.waitForFunction(()=>!!document.getElementById('edit_subtask_id').value);
            const childId=await p.locator('#edit_subtask_id').inputValue();
            check((await get(`/api/tasks/${childId}`)).estimated_minutes===45,'Canonical child receipt is actually persisted at 45 minutes');
            check(await p.locator('#modal_subtask_est').inputValue()===(aba?'15m':'45m'),aba?'Explicit ABA estimate intent remains editable instead of canonical overwrite':'Untouched estimate adopts canonical parsed 45m despite concurrent title');
            check(await p.evaluate(()=>hasSettingsDrafts(['subtask_modal'])),'Concurrent draft remains guarded against canonical saved baseline');
            await context.unroute('**/api/tasks');
            await p.locator('#subtask_save_btn:enabled').waitFor({state:'visible'});
            await p.locator('#modal_subtask_title').press('Control+Enter');await p.waitForFunction(()=>document.getElementById('subtask_modal').classList.contains('hidden'));
            const saved=await get(`/api/tasks/${childId}`);
            check(saved.estimated_minutes===(aba?15:45),'Subsequent explicit PUT retains 45m or intentionally saves the ABA 15m draft');
            check(writes.slice(before).filter(w=>w.method==='POST').length===1&&writes.slice(before).some(w=>w.method==='PUT'&&w.path===`/api/tasks/${childId}`),'Retained child Save updates canonical ID without duplicate creation');
        }
        let release,started;const held=new Promise(r=>release=r),seen=new Promise(r=>started=r);
        await context.route(`**/api/tasks/${task.id}`,async route=>{if(route.request().method()!=='PUT')return route.continue();const response=await route.fetch();started();await held;await route.fulfill({response});});
        await p.locator('#inspector_edit_title').fill('Canonical property title [45m] #canonical');
        await p.locator('#inspector_save_btn').click();await seen;await p.locator('#inspector_edit_tags').fill('#concurrent');release();
        await p.waitForFunction(()=>document.getElementById('task_properties_status').textContent.includes('Task saved.'));
        const saved=await get(`/api/tasks/${task.id}`);
        check(saved.title==='Canonical property title'&&saved.estimated_minutes===45&&saved.tags==='#canonical','Actual property API receipt contains domain-parsed canonical fields');
        check(await p.locator('#inspector_edit_title').inputValue()===saved.title&&await p.locator('#inspector_edit_est').inputValue()==='45m','Clean property fields adopt canonical title and estimate');
        check(await p.locator('#inspector_edit_tags').inputValue()==='#concurrent'&&await p.evaluate(()=>hasSettingsDrafts(['task_properties_editor'])),'Concurrent tags stay dirty against persisted canonical tags');
        await p.locator('#inspector_edit_tags').fill('#canonical');
        check(!await p.evaluate(()=>hasSettingsDrafts(['task_properties_editor'])),'Reverting only concurrent field to canonical ACK value clears its dirty state');
        check(errors.length===0,'No unexpected pageerrors');
        return {assertions:results.length,results,errors,writes,fakes:['provider catalog','held real child/property ACK'],limits:['No physical gestures/other engines/screen reader']};
    } catch(error){console.log(JSON.stringify({partialResults:results,errors,writes}));throw error;}
    finally{await context.close();}
}
