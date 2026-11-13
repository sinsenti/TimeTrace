/* Ticket05 additional native fault/metadata cases; no model/provider calls. */
async (page, baseURL) => {
    const context=await page.context().browser().newContext({viewport:{width:1024,height:1000}}),p=await context.newPage();
    const results=[],errors=[],writes=[],samples=[];
    const check=(ok,name)=>{if(!ok)throw Error(name);results.push(name);};
    const post=async(path,data)=>{const r=await context.request.post(baseURL+path,{data});if(!r.ok())throw Error(await r.text());return r.json();};
    const get=async path=>{const r=await context.request.get(baseURL+path);if(!r.ok())throw Error(await r.text());return r.json();};
    const ready=async()=>p.waitForFunction(()=>!document.getElementById('task_properties_editor').disabled);
    p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
    p.on('request',r=>{if(r.url().startsWith(baseURL)&&!['GET','HEAD'].includes(r.method()))writes.push({url:r.url(),method:r.method(),body:r.postDataJSON()});});
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({appearance:'light',lightTheme:'refined',idleDetectorEnabled:false})));
    const parent=await post('/api/tasks',{title:`05-edge-${Date.now()}`,tags:'#authoritative',category:'',status:'Owner defined',estimated_minutes:-60});
    try {
        await p.goto(`${baseURL}/task-inspector/${parent.id}`);await ready();
        await p.waitForFunction(()=>document.getElementById('detail_task_remaining').textContent==='-1h (over estimate)');
        check(await p.locator('#inspector_edit_category').inputValue()==='','Valid empty category is not replaced by work');
        check(await p.locator('#inspector_edit_status').inputValue()==='Owner defined','Unknown status remains selected without metadata replacement');
        check(await p.locator('#detail_task_progress').textContent()==='N/A','Negative estimate keeps null progress');
        await p.locator('#inspector_edit_desc').fill('Preserved description');await p.locator('#inspector_save_btn').click();
        await p.waitForFunction(()=>document.getElementById('task_properties_status').textContent.includes('Task saved.'));
        const saved=await get(`/api/tasks/${parent.id}`);
        check(saved.status==='Owner defined'&&saved.category===''&&saved.estimated_minutes===-60,'Actual property row retains unknown status, empty category and finite negative estimate');
        let release,started;const held=new Promise(r=>release=r),seen=new Promise(r=>started=r);
        await context.route('**/api/tasks',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();started();await held;await route.fulfill({response});});
        let failed=true;
        await context.route(`**/api/tasks/${parent.id}/stats`,r=>failed?r.fulfill({status:503,json:{detail:'Synthetic stats fault'}}):r.continue());
        await p.getByRole('button',{name:'+ Add Subtask',exact:true}).click();await p.locator('#modal_subtask_title').fill('ACK child [45m]');
        const before=writes.length;await p.locator('#modal_subtask_title').press('Control+Enter');await seen;
        await p.locator('#modal_subtask_title').fill('Concurrent child title');await p.locator('#modal_subtask_title').press('Control+Enter');
        release();await p.waitForFunction(()=>document.getElementById('edit_subtask_id').value!=='');
        const childId=await p.locator('#edit_subtask_id').inputValue();
        check(writes.slice(before).filter(r=>r.method==='POST').length===1,'Pending native child activation sends one POST');
        check(await p.locator('#subtask_modal').isVisible()&&await p.locator('#modal_subtask_title').inputValue()==='Concurrent child title','ACK retains concurrent child draft in same visible editor');
        const canonicalChild=await get(`/api/tasks/${childId}`);
        check(canonicalChild.title==='ACK child'&&canonicalChild.estimated_minutes===45,'Canonical child ID resolves actual title-parsed saved row and 45m estimate before display recovery');
        failed=false;await p.locator('#subtask_modal').getByRole('button',{name:'Retry refresh',exact:true}).click();
        await p.waitForFunction(()=>!document.getElementById('task_metadata_notice')||document.getElementById('task_metadata_notice').classList.contains('hidden'));
        check(writes.slice(before).filter(r=>r.method==='POST').length===1,'Child Retry refresh never replays POST');
        await context.unroute('**/api/tasks');await context.unroute(`**/api/tasks/${parent.id}/stats`);
        await p.locator('#subtask_save_btn:enabled').waitFor({state:'visible'});
        await p.locator('#modal_subtask_title').press('Control+Enter');await p.waitForFunction(()=>document.getElementById('subtask_modal').classList.contains('hidden'));
        const editedChild=await get(`/api/tasks/${childId}`);
        check(editedChild.title==='Concurrent child title'&&editedChild.estimated_minutes===45,'Later explicit Save updates canonical child and retains parsed 45m, not a duplicate create');
        check(writes.slice(before).filter(r=>r.method==='POST').length===1,'Exactly one child create across retained draft save');
        await p.waitForFunction(()=>document.getElementById('subtasks_tree_container').textContent.includes('Concurrent child title'));
        await p.locator('.subtask-node').filter({has:p.getByRole('link',{name:'Concurrent child title',exact:true})}).getByRole('button',{name:'×',exact:true}).click();
        await p.locator('#custom_confirm_modal').getByRole('button',{name:'Confirm',exact:true}).click();
        await p.waitForFunction(()=>!document.getElementById('subtasks_tree_container').textContent.includes('Concurrent child title'));
        check((await get(`/api/tasks/${parent.id}/tree`)).subtasks.length===0,'Confirmed child delete removes only the selected subtree');

        // Unknown/failed registry is read-only, not permission to replace initialized properties.
        await p.locator('#inspector_edit_desc').fill('Draft survives failed metadata and deleted task');
        await context.route('**/api/tasks?status=all',r=>r.fulfill({status:503,json:{detail:'Synthetic registry failure'}}));
        await p.getByRole('main').getByRole('button',{name:'Retry refresh',exact:true}).click();
        await p.locator('#task_metadata_notice').waitFor();
        check(await p.locator('#inspector_edit_desc').inputValue()==='Draft survives failed metadata and deleted task','Failed metadata retains initialized draft and selected fields');
        await context.unroute('**/api/tasks?status=all');
        await context.request.delete(`${baseURL}/api/tasks/${parent.id}`);
        await p.getByRole('main').getByRole('button',{name:'Retry refresh',exact:true}).click();
        await p.waitForFunction(()=>document.getElementById('task_properties_status').textContent.startsWith('Refresh unavailable'));
        check(await p.locator('#inspector_edit_desc').inputValue()==='Draft survives failed metadata and deleted task','Deleted task refresh preserves initialized draft with honest unavailable message');
        const beforeDeleted=writes.length;const deletedTree=p.waitForResponse(r=>r.url().endsWith('/api/tasks/deleted-05-unknown/tree'));await p.goto(`${baseURL}/tasks-detail/deleted-05-unknown`);
        check((await deletedTree).status()===404,'Direct deleted task tree is authoritatively not found');
        await p.waitForFunction(()=>document.getElementById('task_properties_status').textContent.includes('unavailable or deleted'));
        check(await p.locator('#task_properties_editor').evaluate(el=>el.disabled&&el.hasAttribute('disabled'))&&await p.locator('#inspector_save_btn').isDisabled()&&await p.locator('#inspector_edit_title').isDisabled()&&await p.locator('#inspector_save_btn').evaluate(el=>el.matches(':disabled'))&&await p.locator('#inspector_edit_title').evaluate(el=>el.matches(':disabled')),'Direct deleted task alias cannot save unknown default properties');
        check(writes.slice(beforeDeleted).every(r=>new URL(r.url).pathname==='/idle/toggle'),'Deleted direct entry makes no task/session mutation');

        for(const [estimate,recurring] of [[0,false],[60,true]]) {
            const task=await post('/api/tasks',{title:`Unbounded ${estimate} ${Date.now()}`,estimated_minutes:estimate,is_recurring:recurring});
            await p.goto(`${baseURL}/task-inspector/${task.id}`);await ready();await p.waitForFunction(()=>document.getElementById('detail_task_remaining').textContent==='Unbounded');
            check(await p.locator('#detail_task_remaining').textContent()==='Unbounded',`${recurring?'Recurring':'Zero'} estimate is explicitly unbounded`);
            if(recurring)check(await p.locator('#detail_task_est_label').textContent()==='Estimate per occurrence','Recurring estimate labeled per occurrence');
        }
        // Pointer suggestion path and shared Calendar entry use the same literal-tag DOM fix.
        const hostile="#native');globalThis.tagExecuted=1;//";
        const tagged=await post('/sessions',{start_time:'2026-11-04T08:00:00Z',end_time:'2026-11-04T08:30:00Z',tags:hostile});
        await p.goto(`${baseURL}/dashboard?date=2026-11-04`);await p.waitForSelector('.fc-timegrid-slot');
        await p.getByRole('button',{name:'+ Session',exact:true}).click();await p.locator('#session_modal_tags_input').fill('native');
        await p.locator('#tag_suggestions_dropdown .tag-suggestion-item').filter({hasText:hostile}).click();
        check(await p.locator('.tag-chip').textContent()===hostile+'×','Native Calendar pointer suggestion retains hostile literal tag');
        check(await p.evaluate(()=>!globalThis.tagExecuted),'Shared Calendar tag suggestion executes no quoted handler');
        await p.locator('#session_modal_notes').press('Escape');
        check((await get(`/sessions/${tagged.id}`)).tags===hostile,'Calendar Cancel preserves actual stored tag row');
        check(errors.length===0,'No unexpected pageerrors in edge probe');
        return {assertions:results.length,results,errors,writes,samples,fakes:['provider catalog','held real child POST ACK','stats 503','registry 503'],limits:['Native scope intentionally excludes physical gestures/other engines/screen reader']};
    } catch(error){console.log(JSON.stringify({partialResults:results,errors,writes}));throw error;}
    finally{await context.close();}
}
