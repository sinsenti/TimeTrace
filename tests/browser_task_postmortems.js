/* Manual native Chromium probe; execute only against the coordinator's isolated disposable daemon.
 * Synthetic fixtures use public HTTP. Faults below are declared HTTP boundaries. No providers.
 * This file is authored acceptance work, not evidence that a browser run has occurred. */
async (page, baseURL) => {
    const origin=new URL(baseURL).origin;
    if(new URL(baseURL).protocol!=='http:' || new URL(baseURL).port==='8002')throw Error('Use the declared disposable HTTP daemon on a non-8002 port');
    const context=await page.context().browser().newContext({viewport:{width:1440,height:1000}});
    const p=await context.newPage(), results=[], errors=[], writes=[], responses=[], measurements=[];
    const check=(value,message)=>{if(!value)throw Error(message);results.push(message);};
    const post=async(path,data)=>{const r=await context.request.post(baseURL+path,{data});if(!r.ok())throw Error(`Fixture POST ${path}: ${r.status()} ${await r.text()}`);return r.json();};
    const get=async path=>{const r=await context.request.get(baseURL+path);if(!r.ok())throw Error(`GET ${path}: ${r.status()} ${await r.text()}`);return r.json();};
    await context.addInitScript(({origin})=>{
        if(location.protocol!=='http:'||location.origin!==origin)return;
        localStorage.setItem('timetrace_user_settings',JSON.stringify({appearance:'light',lightTheme:'refined',idleDetectorEnabled:false,enableVimMotions:false}));
    },{origin});
    let acceptDialog=true;
    p.on('dialog',dialog=>acceptDialog?dialog.accept():dialog.dismiss());
    p.on('pageerror',error=>errors.push(error.message));
    p.on('request',request=>{if(request.url().startsWith(origin)&&!['GET','HEAD'].includes(request.method()))writes.push({url:request.url(),method:request.method(),body:request.postDataJSON()});});
    p.on('response',async response=>{
        if(!response.url().startsWith(origin)||!['/api/task-reviews','/rating-entries'].some(path=>response.url().includes(path)))return;
        let body='UNKNOWN';try{body=await response.json();}catch(_){}
        responses.push({url:response.url(),status:response.status(),body});
    });
    let root=p.locator('#details_task_postmortem');
    const field=name=>root.locator(`[data-task-review="${name}"]`);
    const ready=async()=>field('save').waitFor({state:'visible'}).then(()=>p.waitForFunction(id=>{const button=document.querySelector(`#${id} [data-task-review="save"]`);return button&&!button.disabled;},rootId));
    let rootId='details_task_postmortem';
    const setScore=async(index,score)=>{const input=root.locator('.custom-rating-input').nth(index);await input.focus();await input.press('Home');for(let i=1;i<score;i++)await input.press('ArrowRight');};
    const saved=async()=>p.waitForFunction(id=>document.querySelector(`#${id} [data-task-review="status"]`)?.textContent.includes('saved'),rootId);
    const literal='<img src=x onerror="globalThis.reviewExecuted=1"> Task review literal '+ 'long text '.repeat(30);
    const a=await post('/api/tasks',{title:`Post-mortem A ${Date.now()}`,description:'Persisted task properties',estimated_minutes:60});
    const b=await post('/api/tasks',{title:`Post-mortem B ${Date.now()}`});
    const child=await post('/api/tasks',{title:'Separate descendant evidence',parent_id:a.id});
    await post('/sessions',{task_id:a.id,start_time:'2020-01-01T10:00:00Z',end_time:'2020-01-01T11:00:00Z',notes:'Own past evidence'});
    await post('/sessions',{task_id:a.id,start_time:'2099-01-01T10:00:00Z',end_time:'2099-01-01T11:00:00Z',notes:'Own future evidence'});
    await post('/sessions',{task_id:child.id,start_time:'2020-01-01T10:00:00Z',end_time:'2020-01-01T20:00:00Z'});
    const defs=[];for(const name of ['Task focus <b>literal</b>','Task energy'])defs.push(await post('/rating-definitions',{name,target_type:'task',min_score:1,max_score:5,is_required:true}));
    const before={task:await get(`/api/tasks/${a.id}`),stats:await get(`/api/tasks/${a.id}/stats`),child:await get(`/api/tasks/${child.id}`)};
    try {
        let releaseDefinitions,seenDefinitions;const holdDefinitions=new Promise(resolve=>releaseDefinitions=resolve),observedDefinitions=new Promise(resolve=>seenDefinitions=resolve);
        await context.route('**/rating-definitions?target_type=task',async route=>{seenDefinitions();await holdDefinitions;await route.continue();});
        await p.goto(`${baseURL}/tasks-detail/${a.id}`);await observedDefinitions;
        check(await field('save').isDisabled(),'Dedicated Save remains disabled while task definitions are held');
        releaseDefinitions();await ready();await context.unroute('**/rating-definitions?target_type=task');
        check((await p.locator('#detail_stats_total_badge').textContent())==='2 sessions','Task evidence excludes descendant rows');
        await p.locator('#inspector_edit_desc').fill('Unrelated unsaved property notes');
        await field('what_went_well').fill(literal);await field('key_takeaways').fill('Dedicated review readback');await setScore(0,5);
        await root.locator('[id^="dismiss_btn_"]').nth(1).click();
        await field('save').click();await saved();
        check((await get(`/api/task-reviews/${a.id}`)).what_went_well===literal,'Dedicated Save persists literal review through existing public API');
        const entries=await get(`/rating-entries?target_type=task&target_id=${a.id}`);
        check(entries.find(e=>e.rating_definition_id===defs[0].id)?.score===5,'Task rating score readback matches control');
        check(entries.find(e=>e.rating_definition_id===defs[1].id)?.dismissed===true,'Required rating dismissal retains existing policy');
        check(await p.locator('#inspector_edit_desc').inputValue()==='Unrelated unsaved property notes','Review Save preserves unrelated property draft');
        check(await root.locator('img').count()===0,'Review and rating metadata remain inert');
        await field('key_takeaways').fill('Ctrl Enter review');await field('key_takeaways').press('Control+Enter');await saved();
        check((await get(`/api/task-reviews/${a.id}`)).key_takeaways==='Ctrl Enter review','Dedicated Ctrl Enter saves only review');
        acceptDialog=true;await p.goto(`${baseURL}/revision#tasks`);
        rootId='revision_task_postmortem';root=p.locator('#'+rootId);
        await p.locator('#task_quick_chips_bar button').filter({hasText:a.title}).click();await ready();
        check(await field('what_went_well').inputValue()===literal,'Revision reads dedicated persisted post-mortem');
        await field('blockers').fill('Revision draft retained');acceptDialog=false;
        await p.locator('#task_quick_chips_bar button').filter({hasText:b.title}).click();
        check(await field('blockers').inputValue()==='Revision draft retained','Cancelled task replacement preserves review owner');
        await p.locator('#rev_tab_btn_day').click();await p.locator('#rev_tab_btn_task_inspector').click();
        check(await field('blockers').inputValue()==='Revision draft retained','Hidden Task tab retains initialized draft');
        const beforeDiscard=writes.length;await field('discard').click();
        check(await field('blockers').inputValue()==='Revision draft retained','Cancelled explicit Discard retains task draft');check(writes.length===beforeDiscard,'Cancelled Discard sends no writes');
        acceptDialog=true;await field('discard').click();await ready();
        check(await field('blockers').inputValue()==='','Confirmed Discard reloads persisted review without deletion');
        await field('blockers').fill('Revision saved back');await field('save').click();await saved();
        check((await get(`/api/task-reviews/${a.id}`)).blockers==='Revision saved back','Revision post-mortem Save round trips through public API');
        const ids=await root.locator('.custom-rating-input').evaluateAll(inputs=>inputs.map(input=>input.id));
        check(new Set(ids).size===ids.length&&ids.every(id=>id.includes('revision_task_postmortem_ratings_')),'Rating controls use unique editor-scoped identity');

        let releaseText,seenText;const heldText=new Promise(resolve=>releaseText=resolve),observedText=new Promise(resolve=>seenText=resolve);
        await context.route('**/api/task-reviews',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();seenText();await heldText;await route.fulfill({response});});
        let rejectSecond=true;
        await context.route('**/rating-entries',async route=>{const request=route.request();if(request.method()==='POST'&&request.postDataJSON().rating_definition_id===defs[1].id&&rejectSecond)return route.fulfill({status:503,json:{detail:'Declared synthetic second rating rejection'}});return route.continue();});
        await field('what_went_well').fill('Captured before await');await setScore(0,1);
        await root.locator('[id^="dismiss_btn_"]').nth(1).click();await setScore(1,2);
        const partialStart=writes.length;await field('save').click();await observedText;
        await field('what_went_well').fill('New typing after captured POST');await setScore(1,4);
        releaseText();await p.waitForFunction(()=>document.querySelector('#revision_task_postmortem [data-task-review="status"]').textContent.includes('incomplete'));
        check((await get(`/api/task-reviews/${a.id}`)).what_went_well==='Captured before await','Held accepted text response persisted captured payload');
        check(await field('what_went_well').inputValue()==='New typing after captured POST','Concurrent text remains visible after partial failure');
        const failedBody=writes.slice(partialStart).find(w=>w.url.endsWith('/rating-entries')&&w.body.rating_definition_id===defs[1].id)?.body;
        check(failedBody?.score===2,'Rejected second rating carries captured score from before text await');
        await context.unroute('**/api/task-reviews');rejectSecond=false;
        // Return text to its known ACK to demonstrate deduplication separately from changed work.
        await field('what_went_well').fill('Captured before await');const retryStart=writes.length;
        await field('save').click();await saved();
        check(writes.slice(retryStart).filter(w=>w.url.endsWith('/api/task-reviews')).length===0,'Partial retry skips acknowledged unchanged text');
        check(writes.slice(retryStart).filter(w=>w.body?.rating_definition_id===defs[0].id).length===0,'Partial retry skips acknowledged first rating');
        check(writes.slice(retryStart).some(w=>w.body?.rating_definition_id===defs[1].id&&w.body.score===4),'Partial retry submits remaining changed rating only');
        await context.unroute('**/rating-entries');

        let failRefresh=false;
        await context.route(`**/api/tasks/${a.id}/stats`,route=>failRefresh?route.fulfill({status:503,json:{detail:'Declared synthetic saved-follow-up-read failure'}}):route.continue());
        failRefresh=true;await field('blockers').fill('Accepted before failed refresh');await field('save').click();
        await p.waitForFunction(()=>document.querySelector('#revision_task_postmortem [data-task-review="status"]').textContent.includes('saved; refresh unavailable'));
        const recoveryStart=writes.length;failRefresh=false;await field('retry').click();await ready();
        check(writes.length===recoveryStart,'Accepted-save Retry refresh performs reads only');await context.unroute(`**/api/tasks/${a.id}/stats`);
        const after={task:await get(`/api/tasks/${a.id}`),stats:await get(`/api/tasks/${a.id}/stats`),child:await get(`/api/tasks/${child.id}`)};
        check(JSON.stringify(after.task)===JSON.stringify(before.task),'Review saves never change task status, properties or schedule anchors');
        check(JSON.stringify(after.stats.sessions)===JSON.stringify(before.stats.sessions),'Review saves preserve own recorded past and future sessions');
        check(JSON.stringify(after.child)===JSON.stringify(before.child),'Review saves preserve descendants');
        check((await get(`/rating-entries?target_type=task&target_id=${b.id}`)).length===0,'Unselected task receives no rating writes');
        check(writes.every(w=>w.url.endsWith('/api/task-reviews')||w.url.endsWith('/rating-entries')),'UI review actions issue no task completion, schedule clearing or DELETE requests');

        for(const width of [1440,375])for(const appearance of ['light','dark']){
            await p.setViewportSize({width,height:1000});
            await p.evaluate(({appearance})=>{document.documentElement.setAttribute('data-appearance',appearance);document.documentElement.classList.toggle('dark',appearance==='dark');},{appearance});
            await root.scrollIntoViewIfNeeded();
            const measurement=await root.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,viewport:innerWidth,labels:[...el.querySelectorAll('[id^="score_label_"]')].map(label=>({text:label.textContent,color:getComputedStyle(label).color})),controls:[...el.querySelectorAll('.custom-rating-input')].map(input=>({accent:getComputedStyle(input).accentColor,color:getComputedStyle(input).color}))}));
            measurements.push({width,appearance,...measurement});check(measurement.scroll<=measurement.viewport,`No horizontal overflow at ${width}px in ${appearance}`);
            await field('blockers').focus();await p.keyboard.press('End');await p.keyboard.press('Enter');check((await field('blockers').inputValue()).endsWith('\n'),'Ordinary Enter remains review text');
            const location=p.url();await p.keyboard.press('Escape');check(p.url()===location,'Escape in review text does not navigate');await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');
        }
        check(errors.length===0,'No native page errors');
        return {results,writes,responses,measurements,errors,unrun:['physical touch','screen reader','other browser engines','actual rating-admin consumer add/range/context/delete sequence','delayed Discard and A→B→A native fault sequence','five-band contrast measurement across all values']};
    } finally {await context.close();}
};
