/* Trusted manual native Chromium probe. Public API synthetic rows; intentional HTTP faults only. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({viewport:{width:1440,height:1000}});
    const p = await context.newPage(), results=[], errors=[], traffic=[], measurements=[];
    const check=(value,message)=>{if(!value) throw Error(message);results.push(message);};
    const write=async(path,data)=>{const r=await context.request.post(baseURL+path,{data});if(!r.ok())throw Error(`POST ${path}: ${r.status()} ${await r.text()}`);return r.json();};
    const get=async path=>{const r=await context.request.get(baseURL+path);if(!r.ok())throw Error(`GET ${path}: ${r.status()}`);return r.json();};
    const ready=async()=>p.waitForFunction(()=>document.getElementById('task_properties_editor')?.disabled===false);
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({appearance:'light',lightTheme:'refined',idleDetectorEnabled:false})));
    p.on('pageerror',e=>errors.push(e.message));
    p.on('dialog',d=>d.accept());
    p.on('request',r=>{if(r.url().startsWith(baseURL)&&!['GET','HEAD'].includes(r.method()))traffic.push({url:r.url(),method:r.method(),body:r.postDataJSON()});});
    const hostile='#<img/src=x/onerror=globalThis.tagExecuted=1>', quoted="#quote');globalThis.tagExecuted=1;//";
    const parent=await write('/api/tasks',{title:`Details ${Date.now()} <img/src=x/onerror=globalThis.titleExecuted=1>`,description:'Persisted description',tags:'#saved',estimated_minutes:60});
    const child=await write('/api/tasks',{title:'Descendant separate history',parent_id:parent.id});
    const past=await write('/sessions',{task_id:parent.id,start_time:'2020-01-01T10:00:00Z',end_time:'2020-01-01T12:00:00Z',notes:'<img src=x onerror=globalThis.noteExecuted=1>',tags:hostile});
    await write('/sessions',{task_id:parent.id,start_time:'2099-01-01T10:00:00Z',end_time:'2099-01-01T10:30:00Z'});
    await write('/sessions',{task_id:child.id,start_time:'2020-01-02T00:00:00Z',end_time:'2020-01-02T10:00:00Z'});
    try {
        await p.goto(`${baseURL}/tasks-detail/${parent.id}`);await ready();
        await p.waitForFunction(()=>document.getElementById('detail_task_tracked').textContent==='2h');
        check((await p.locator('#detail_task_progress').textContent())==='200%','Alias renders progress above 100%');
        check((await p.locator('#detail_task_remaining').textContent()).includes('-1h'),'Remaining retains negative balance');
        check((await p.locator('#detail_task_unscheduled').textContent()).includes('-1.5h'),'Unscheduled separately subtracts scheduled time');
        check((await p.locator('#detail_stats_total_badge').textContent())==='2 sessions','Own history excludes descendant row');
        check(await p.locator('#detail_task_sessions_list img').count()===0,'History notes and tags remain inert text');
        check(await p.locator('#detail_task_title_header img').count()===0,'Task title remains inert text');
        await p.locator('#inspector_edit_desc').fill('Discarded draft');
        await p.getByRole('button',{name:'Cancel property edits',exact:true}).click();
        check(await p.locator('#inspector_edit_desc').inputValue()==='Persisted description','Explicit property Cancel restores initialized persisted fields');
        await p.locator('#inspector_edit_desc').fill('Retained through refresh');
        await p.getByRole('main').getByRole('button',{name:'Retry refresh',exact:true}).click();await ready();
        check(await p.locator('#inspector_edit_desc').inputValue()==='Retained through refresh','Read-only refresh retains initialized description draft');
        let release, observed;const held=new Promise(r=>release=r), seen=new Promise(r=>observed=r);
        await context.route(`**/api/tasks/${parent.id}`,async route=>{
            if(route.request().method()!=='PUT')return route.continue();
            const response=await route.fetch();observed();await held;await route.fulfill({response});
        });
        let failStats=true;
        await context.route(`**/api/tasks/${parent.id}/stats`,route=>failStats?route.fulfill({status:503,json:{detail:'Synthetic follow-up read failure'}}):route.continue());
        const before=traffic.length;
        await p.locator('#inspector_save_btn').click();await seen;
        await p.locator('#inspector_edit_desc').fill('Concurrent notes after submitted snapshot');
        await p.locator('#inspector_edit_desc').press('Control+Enter');
        release();await p.waitForFunction(()=>document.getElementById('task_properties_status').textContent.includes('Task saved. Refresh unavailable'));
        check(traffic.slice(before).filter(r=>r.method==='PUT').length===1,'Pending double activation produces one property PUT');
        check((await get(`/api/tasks/${parent.id}`)).description==='Retained through refresh','Actual saved row equals captured property payload');
        check(await p.locator('#inspector_edit_desc').inputValue()==='Concurrent notes after submitted snapshot','Concurrent notes remain unsaved after ACK + GET failure');
        failStats=false;await p.getByRole('main').getByRole('button',{name:'Retry refresh',exact:true}).click();await p.waitForFunction(()=>document.getElementById('task_properties_status').textContent.startsWith('Properties ready'));
        check(traffic.slice(before).filter(r=>r.method==='PUT').length===1,'Retry refresh does not replay acknowledged property write');
        await context.unroute(`**/api/tasks/${parent.id}`);await context.unroute(`**/api/tasks/${parent.id}/stats`);

        await p.locator('#inspector_edit_tags').fill('#unsaved-parent');
        await p.getByRole('button',{name:'+ Add Subtask',exact:true}).click();
        check(await p.locator('#modal_subtask_tags').inputValue()==='#saved','Child inherits saved parent tags, not unsaved property draft');
        await p.locator('#modal_subtask_title').fill('Cancel child');await p.locator('#modal_subtask_title').press('Escape');
        check((await get(`/api/tasks/${parent.id}/tree`)).subtasks.length===1,'Subtask Cancel creates no row');
        await p.getByRole('button',{name:'+ Add Subtask',exact:true}).click();await p.locator('#modal_subtask_title').fill('Created child [30m]');
        await p.locator('#modal_subtask_title').press('Control+Enter');
        await p.waitForFunction(()=>document.getElementById('subtask_modal').classList.contains('hidden'));
        await p.waitForFunction(()=>document.getElementById('subtasks_tree_container').textContent.includes('Created child'));
        const created=(await get(`/api/tasks/${parent.id}/tree`)).subtasks.find(t=>t.title==='Created child');
        check(created?.estimated_minutes===30&&created.tags==='#saved','Child actual row uses domain title parsing and saved tag inheritance');
        await p.locator('.subtask-node').filter({has:p.getByRole('link',{name:'Created child',exact:true})}).getByRole('button',{name:'Quick Edit',exact:true}).click();
        await p.waitForFunction(()=>!document.getElementById('task_modal').classList.contains('hidden'));
        await p.locator('#modal_input_desc').fill('Shared editor child description');await p.locator('#task_save_btn').click();
        await p.waitForFunction(()=>document.getElementById('task_modal').classList.contains('hidden'));
        check((await get(`/api/tasks/${created.id}`)).description==='Shared editor child description','Quick Edit uses actual shared human task writer');

        await p.locator('#detail_task_sessions_list button').first().click();
        await p.waitForFunction(()=>!document.getElementById('session_modal').classList.contains('hidden'));
        check(await p.locator('#session_modal_notes').inputValue()==='<img src=x onerror=globalThis.noteExecuted=1>','Existing shared Session editor loads actual own history row');
        check(await p.locator('#tag_chips_container img').count()===0,'Stored hostile tag chip is literal, not an element');
        check(await p.locator('.tag-chip').first().textContent()===hostile+'×','Stored hostile tag text is preserved exactly');
        await p.locator('.tag-chip button').first().click();
        await p.locator('#session_modal_tags_input').fill(quoted);await p.locator('#session_modal_tags_input').press('Enter');
        check((await p.locator('.tag-chip').textContent())===quoted+'×','Typed quote-bearing tag remains literal and exact');
        await p.locator('#session_modal_notes').fill('Saved session notes\nsecond line');
        await p.locator('#session_modal_notes').press('Control+Enter');
        await p.waitForFunction(()=>document.getElementById('session_modal').classList.contains('hidden'));
        check((await get(`/sessions/${past.id}`)).notes==='Saved session notes\nsecond line','Actual shared Session controller saves multiline notes');
        check((await get(`/sessions/${past.id}`)).tags===quoted,'Actual saved session retains exact quote-bearing tag');
        check(await p.locator('#detail_session_focus').evaluate(el=>document.activeElement===el),'Session Save restores persistent history focus');
        await p.locator('#detail_task_sessions_list button').first().click();
        await p.locator('.tag-chip button').click();
        await p.locator('#session_modal_tags_input').fill(quoted.slice(1));
        await p.locator('#tag_suggestions_dropdown .tag-suggestion-item').first().waitFor();
        await p.locator('#session_modal_tags_input').press('ArrowDown');await p.locator('#session_modal_tags_input').press('Enter');
        check((await p.locator('.tag-chip').textContent())===quoted+'×','Arrow/Enter selects the exact stored hostile suggestion without inline-JS parsing');
        await p.locator('#session_modal_notes').press('Escape');
        check(await p.locator('#detail_session_focus').evaluate(el=>document.activeElement===el),'Session Cancel restores persistent history focus');
        check(await p.evaluate(()=>!globalThis.tagExecuted&&!globalThis.noteExecuted&&!globalThis.titleExecuted),'No hostile text executed');

        await p.getByRole('button',{name:'Schedule session',exact:true}).click();
        await p.locator('#session_modal_notes').fill('Scheduled from details');
        await p.locator('#session_modal_notes').press('Escape');
        check((await get(`/api/tasks/${parent.id}/stats`)).total_sessions===2,'Schedule Cancel writes no session');
        await p.getByRole('button',{name:'Schedule session',exact:true}).click();
        await p.locator('#session_modal_notes').fill('Scheduled from details');await p.locator('#session_modal_save_btn').click();
        await p.waitForFunction(()=>document.getElementById('session_modal').classList.contains('hidden'));
        check((await get(`/api/tasks/${parent.id}/stats`)).total_sessions===3,'Schedule uses shared Session POST and creates one real linked row');

        for(const appearance of ['refined','stone','porcelain','dark']) for(const width of [390,768,1024,1440]) {
            await p.setViewportSize({width,height:1000});
            await p.evaluate(appearance=>{const settings=getUserSettings();settings.appearance=appearance==='dark'?'dark':'light';settings.lightTheme=appearance==='dark'?'refined':appearance;saveUserSettings(settings);applyAppearance(settings);},appearance);
            await p.waitForTimeout(350);
            const sample=await p.evaluate(()=>{
                const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
                const lum=c=>rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
                const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
                const ids=['detail_task_title_header','detail_task_remaining','detail_task_unscheduled','inspector_edit_desc','inspector_save_btn','task_properties_status'];
                return {overflow:document.documentElement.scrollWidth>innerWidth,samples:ids.map(id=>{const el=document.getElementById(id),style=getComputedStyle(el);let bg=style.backgroundColor,ancestor=el;while(bg==='rgba(0, 0, 0, 0)'&&(ancestor=ancestor.parentElement))bg=getComputedStyle(ancestor).backgroundColor;return {id,foreground:style.color,background:bg,contrast:contrast(style.color,bg)};})};
            });
            measurements.push({appearance,width,...sample});
            check(!sample.overflow,`${appearance}/${width} no page horizontal overflow`);
            check(sample.samples.every(s=>s.contrast>=4.5),`${appearance}/${width} sampled owned text contrast >= 4.5`);
        }
        await p.goto(`${baseURL}/revision`);await p.getByRole('button',{name:'Task Inspector',exact:true}).click();
        await p.locator(`#task_quick_chips_bar button[onclick*="${parent.id}"]`).waitFor();
        await p.locator('#task_inspector_search').fill(parent.title);
        await p.locator(`#task_inspector_dropdown .task-inspect-item[onclick*="${parent.id}"]`).waitFor({state:'visible'});
        await p.locator('#task_inspector_search').press('Enter');
        await p.waitForFunction(()=>!document.getElementById('task_inspector_body').classList.contains('hidden'));
        check((await p.locator('#task_inspector_kpis').textContent()).includes('Unscheduled'),'Inline inspector exposes distinct shared balances');
        check(await p.locator('#inspect_task_details_link').getAttribute('href')===`/task-inspector/${parent.id}`,'Inline details link retains dedicated entry');
        check(await p.locator('#inspect_task_sessions_list > button').count()===3,'Inline history uses own recorded rows');
        await p.locator('#task_rev_takeaways').fill('Review draft remains across metadata retry');
        await p.locator('#rev_tab_task_inspector').getByRole('button',{name:'Retry refresh',exact:true}).click();
        check(await p.locator('#task_rev_takeaways').inputValue()==='Review draft remains across metadata retry','Initialized inline review draft survives refresh');
        check(errors.length===0,'No unexpected browser page errors');
        return {assertions:results.length,results,measurements,errors,parentId:parent.id,childId:created.id,sessionId:past.id,traffic,fakes:['provider catalog','held real property PUT ACK','one stats-read 503'],limits:['No physical touch/drag, screen reader, other engines, zoom or reduced-motion verification','Contrast samples are bounded, not whole accessibility certification']};
    } catch (error) {console.log(JSON.stringify({partialResults:results,measurements,errors,traffic}));throw error;}
    finally {await context.close();}
}
