/* Authored native acceptance probe. Run only against an explicitly isolated disposable daemon.
 * Uses visible controls and API readbacks; routes inject only declared synthetic faults. */
async (page, baseURL) => {
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    const origin=new URL(baseURL).origin,results=[],writes=[],errors=[];
    check(new URL(baseURL).protocol==='http:','Use the declared isolated HTTP daemon');
    const context=await page.context().browser().newContext();
    await context.addInitScript(({origin})=>{
        if(location.origin!==origin||location.protocol!=='http:')return;
        const key='timetrace_user_settings';
        localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)||'{}'),enableSessionReview:true,enableVimMotions:false,idleDetectorEnabled:false}));
    },{origin});
    const p=await context.newPage();
    p.on('pageerror',error=>errors.push(error.message));
    p.on('request',request=>{if(['POST','PUT','DELETE'].includes(request.method()))writes.push({method:request.method(),url:new URL(request.url()).pathname,body:request.postDataJSON()});});
    const post=async(url,body)=>{const response=await p.request.post(`${baseURL}${url}`,{data:body});check(response.ok(),`Fixture ${url}: ${response.status()}`);return response.json();};
    const get=async url=>{const response=await p.request.get(`${baseURL}${url}`);check(response.ok(),`Read ${url}: ${response.status()}`);return response.json();};
    const modal=()=>p.locator('#session_review_modal');
    const rating=index=>p.locator('#session_custom_ratings_container .custom-rating-input').nth(index);
    const ready=async()=>{await modal().waitFor({state:'visible'});await p.locator('#session_rev_modal_notes').waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('#session_review_modal button[onclick="saveSessionReviewModal()"]')?.disabled);};
    const save=()=>modal().getByRole('button',{name:/^Save/}).click();
    const open=async title=>{await p.locator('#session_rev_search').fill(title);await p.locator('#sessions_review_list button').filter({hasText:title}).first().click();await ready();};
    const close=async()=>{await modal().getByRole('button',{name:/^Cancel/}).click();await modal().waitFor({state:'hidden'});};
    const confirm=async()=>{await p.locator('#confirm_modal_proceed_btn').focus();await p.keyboard.press('Enter');};
    const preferences=async change=>{await p.getByRole('button',{name:'Preferences',exact:true}).click();await change();await p.locator('#settings_modal').getByRole('button',{name:/^Save/}).click();await p.locator('#settings_modal').waitFor({state:'hidden'});};
    let releaseHeld=null;
    try {
        const task=await post('/api/tasks',{title:'Session proof task',requires_session_review:false,status:'in_progress'});
        const one=await post('/rating-definitions',{name:'Session zero scale',target_type:'session',min_score:0,max_score:4,is_required:true});
        const two=await post('/rating-definitions',{name:'Session alternate scale',target_type:'session',min_score:2,max_score:8});
        const dayDef=await post('/rating-definitions',{name:'Independent day scale',target_type:'day',min_score:1,max_score:5});
        const date='2026-10-11',historyDate='2026-10-12';
        for(const day of [date,historyDate])await post('/revision/day-review',{date_str:day,rating:3,notes:`Baseline ${day}`});
        const a=await post('/sessions',{start_time:`${date}T10:00:00Z`,end_time:`${date}T11:00:00Z`,task_id:task.id,tags:'#proof',notes:'Session proof A'});
        const b=await post('/sessions',{start_time:`${date}T12:00:00Z`,end_time:`${date}T13:00:00Z`,notes:'Session proof B'});
        const future=await post('/sessions',{start_time:'2035-01-01T10:00:00Z',end_time:'2035-01-01T11:00:00Z',task_id:task.id,notes:'Unrelated schedule'});
        await post('/rating-entries',{rating_definition_id:one.id,target_type:'session',target_id:a.id,score:0,dismissed:false});
        const hostile='<img src=x onerror="window.sessionProofExecuted=true">';
        const hostileSession=await post('/sessions',{start_time:`${date}T14:00:00Z`,end_time:`${date}T15:00:00Z`,tags:hostile,notes:hostile});
        await p.goto(`${baseURL}/revision#sessions`);await p.locator('#sessions_review_list button').first().waitFor();
        await preferences(()=>p.locator('#setting_enable_session_review').uncheck());await p.goto(`${baseURL}/revision#sessions`);
        check(await p.locator('#rev_tab_sessions').isHidden(),'disabled direct hash opens Day');check(await p.locator('#rev_tab_btn_sessions').isHidden(),'session visibility preference retained');
        await preferences(()=>p.locator('#setting_enable_session_review').check());await p.locator('#rev_tab_btn_sessions').click();
        await p.locator('#session_rev_search').fill('<img');check((await p.locator('#sessions_review_list').innerText()).includes(hostile),'hostile notes/tags literal');
        check(await p.locator('#sessions_review_list img').count()===0,'hostile markup inert');check(await p.evaluate(()=>window.sessionProofExecuted!==true),'no hostile execution');
        results.push('visibility preference/direct hash and hostile literal text');
        await p.locator('#session_rev_search').fill('Session proof');
        await p.getByRole('button',{name:'Reviewed',exact:true}).click();check(await p.locator('#sessions_review_list').innerText().then(t=>t.includes('Session proof task')),'reviewed task session visible');
        await p.getByRole('button',{name:'Exempt',exact:true}).click();check(await p.locator('#sessions_review_list').innerText().then(t=>t.includes('Session proof task')),'same session also exempt');
        await p.getByRole('button',{name:'All sessions',exact:true}).click();
        results.push('Reviewed and Exempt have independent memberships');
        await p.locator('#session_rev_search').fill('Session proof B');const quickStart=writes.length;const quickRefreshed=p.waitForResponse(response=>response.url().endsWith('/rating-entries?target_type=session&target_id=all'));await p.locator('#sessions_review_list article').filter({hasText:'Session proof B'}).getByRole('button',{name:'Exempt session',exact:true}).click();
        await quickRefreshed;
        check((await get(`/sessions/${b.id}`)).review_skipped===true,'quick session exemption persisted');check(writes.slice(quickStart).length===1&&writes[quickStart].method==='PUT'&&JSON.stringify(writes[quickStart].body)==='{"review_skipped":true}','quick action sends only session exemption PUT');
        results.push('Quick exemption preserves ratings and writes only session exemption');
        // Actual Day Recorded sessions action opens the same inspector, retaining day/history drafts.
        await p.goto(`${baseURL}/revision#day`);await p.locator('#day_review_date_input').fill(date);await p.locator('#day_review_date_input').dispatchEvent('change');
        const main=p.locator(`#day_editor_${date}`);await main.locator('[data-day="notes"]').fill('Independent main draft');
        await p.getByRole('button',{name:'Show history',exact:true}).click();await p.locator('#day_history_grid button').filter({hasText:historyDate}).click();
        const history=p.locator(`#day_editor_${historyDate}`);await history.locator('[data-day="notes"]').fill('Independent history draft');
        await main.locator('[data-action="activity"]').click();await main.locator('[data-day="breakdown"] button').filter({hasText:'#proof'}).click();
        await main.locator('[data-day="sessions"] button').filter({hasText:'Session proof task'}).click();await ready();
        await p.locator('#session_rev_modal_tags').fill('#proof #saved');await p.locator('#session_rev_modal_notes').fill('Submitted session\nsecond line');
        await rating(0).focus();await p.keyboard.press('Home');await rating(1).focus();await p.keyboard.press('End');
        await p.locator('#session_custom_ratings_container [id^="dismiss_btn_"]').first().click();check(await rating(0).isDisabled(),'required rating dismissal allowed');
        await p.locator('#session_custom_ratings_container [id^="dismiss_btn_"]').first().click();check(await rating(0).isEnabled(),'required rating undismiss independent');
        await save();await modal().waitFor({state:'hidden'});
        check(await p.evaluate(()=>document.activeElement?.matches('.day-session-row,#day_review_date_input')),'Day Save restores visible origin or date after evidence rerender');
        check(await main.locator('[data-day="notes"]').inputValue()==='Independent main draft','main draft retained');check(await history.locator('[data-day="notes"]').inputValue()==='Independent history draft','history draft retained');
        let persisted=await get(`/sessions/${a.id}`);check(persisted.notes==='Submitted session\nsecond line','multiline session saved');
        let ratings=await get(`/rating-entries?target_type=session&target_id=${a.id}`);check(ratings.find(e=>e.rating_definition_id===one.id).score===0,'zero saved');check(ratings.find(e=>e.rating_definition_id===two.id).score===8,'nondefault upper bound saved');
        check((await get(`/api/tasks/${task.id}`)).status===task.status,'review does not complete task');check((await get(`/sessions/${future.id}`)).start_time.startsWith('2035-01-01T10:00:00'),'schedule unchanged');
        results.push('Day evidence caller, multiline/zero/nondefault ratings, independent day drafts and no collateral task/schedule writes');
        await p.goto(`${baseURL}/revision#sessions`);await open('Session proof B');
        // Hold one initial definitions response and cancel before it hydrates.
        await close();let releaseDefinitions;const definitionsHeld=new Promise(resolve=>releaseDefinitions=resolve);let holdingDefinitions=true;
        await p.route('**/rating-definitions?target_type=session',async route=>{if(holdingDefinitions){holdingDefinitions=false;await definitionsHeld;}await route.continue();});
        await p.locator('#session_rev_search').fill('Session proof B');await p.locator('#sessions_review_list button').filter({hasText:'Session proof B'}).first().click();
        await p.locator('#session_rev_modal_notes').waitFor({state:'visible'});check(await p.locator('#session_rev_save').isDisabled(),'Save blocked while ratings pending');
        const beforeCancel=writes.length;await close();releaseDefinitions();await p.unroute('**/rating-definitions?target_type=session');await open('Session proof task');
        check(await p.locator('#session_rev_modal_id').inputValue()===a.id,'late definitions did not replace new owner');check(writes.length===beforeCancel,'canceled initialization writes nothing');await close();await open('Session proof B');
        results.push('held definition initialization cancel/supersession');
        // A held PUT proves immutable capture and keeps later same-owner edits dirty.
        let heldResolve;const held=new Promise(resolve=>heldResolve=resolve);
        await p.route(`**/sessions/${b.id}`,async route=>{
            if(route.request().method()!=='PUT')return route.continue();await held;await route.continue();
        });
        releaseHeld=heldResolve;await p.locator('#session_rev_modal_notes').fill('Frozen submission');await rating(0).focus();await p.keyboard.press('Home');
        const before=writes.length;await save();await p.waitForFunction(()=>document.querySelector('#session_review_modal button[onclick="saveSessionReviewModal()"]')?.disabled);
        await p.locator('#session_rev_modal_notes').fill('Newer draft');await rating(0).focus();await p.keyboard.press('End');
        const rated=p.waitForResponse(response=>response.url().endsWith('/rating-entries')&&response.request().method()==='POST');heldResolve();releaseHeld=null;await rated;
        check(await modal().isVisible(),'newer draft keeps modal open');check(await p.locator('#session_rev_modal_notes').inputValue()==='Newer draft','newer text retained');
        const captured=writes.slice(before).find(w=>w.url==='/rating-entries'&&w.body.rating_definition_id===one.id);check(captured?.body.score===0,'rating snapshot before PUT');
        await p.locator('#session_rev_save').waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('#session_rev_save').disabled);await p.unroute(`**/sessions/${b.id}`);await close();results.push('Immutable submission and retained later edits');
        // Failure after text/first rating acknowledgement: retry only second rating.
        await open('Frozen submission');await p.locator('#session_rev_modal_notes').fill('Partial save text');await rating(0).focus();await p.keyboard.press('ArrowRight');await rating(1).focus();await p.keyboard.press('Home');
        let fail=true;await p.route('**/rating-entries',async route=>{
            const body=route.request().postDataJSON();if(route.request().method()==='POST'&&body.rating_definition_id===two.id&&fail){fail=false;return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Synthetic second rating failure"}'});}return route.continue();
        });
        const partialStart=writes.length;await save();await p.locator('#session_rev_modal_status').filter({hasText:/save failed|acknowledgement was lost/i}).waitFor();
        const retryStart=writes.length;await save();await modal().waitFor({state:'hidden'});const retried=writes.slice(retryStart);
        check(retried.length===1&&retried[0].method==='POST'&&retried[0].body.rating_definition_id===two.id,'only unfinished rating retried');
        check(writes.slice(partialStart,retryStart).filter(w=>w.method==='PUT').length===1,'text PUT acknowledged');await p.unroute('**/rating-entries');results.push('Partial save retry request counts');
        // An acknowledged save with failed list refresh offers read-only recovery.
        let failRefresh=true;await p.route('**/sessions',async route=>{if(route.request().method()==='GET'&&failRefresh)return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Synthetic refresh failure"}'});return route.continue();});
        await open('Partial save text');await p.locator('#session_rev_modal_notes').fill('Refresh saved');await save();
        await p.locator('#session_rev_modal_status').filter({hasText:/saved.*refresh.*fail/i}).waitFor();const refreshCount=writes.length;failRefresh=false;await p.locator('#session_rev_refresh').click();
        await close();await p.locator('#session_rev_search').fill('Refresh saved');await p.locator('#sessions_review_list button').filter({hasText:'Refresh saved'}).waitFor();check(writes.length===refreshCount,'read-only recovery sends no mutation');await p.unroute('**/sessions');results.push('saved mutation refresh-only retry');
        // Native reset and deletion cancellation are zero-write actions.
        await open('Refresh saved');let actionStart=writes.length;
        for(const name of [/Reset/,/Delete/]){
            await modal().getByRole('button',{name}).click();
            check(await p.locator('#confirm_modal_cancel_btn').evaluate(el=>el===document.activeElement),'confirmation receives focus');
            await p.keyboard.press('Shift+Tab');check(await p.locator('#confirm_modal_proceed_btn').evaluate(el=>el===document.activeElement),'reverse Tab reaches Confirm');
            await p.keyboard.press('Tab');check(await p.locator('#confirm_modal_cancel_btn').evaluate(el=>el===document.activeElement),'Tab wraps within confirmation');
            await p.keyboard.press('Enter');check(await modal().isVisible(),'focused Cancel Enter retains session editor');
            check(writes.length===actionStart,'focused Cancel Enter writes nothing');
            await modal().getByRole('button',{name}).click();await p.keyboard.press('Escape');check(await modal().isVisible(),'confirmation Escape retains session editor');
            check(await modal().evaluate(el=>el===document.activeElement||el.contains(document.activeElement)),'confirmation restores session focus');
            check(writes.length===actionStart,'confirmation cancel writes nothing');
        }
        let resetFailure=true;await p.route(`**/sessions/${b.id}`,async route=>{if(route.request().method()==='PUT'&&resetFailure){resetFailure=false;return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Synthetic partial reset failure"}'});}return route.continue();});
        await modal().getByRole('button',{name:/Reset/}).click();await confirm();await p.locator('#session_rev_modal_status').filter({hasText:/reset incomplete/i}).waitFor();
        const resetRetry=writes.length;await modal().getByRole('button',{name:/Reset/}).click();await confirm();await modal().waitFor({state:'hidden'});
        check(writes.slice(resetRetry).length===1&&writes[resetRetry].method==='PUT','partial Reset retry sends unfinished PUT only');await p.unroute(`**/sessions/${b.id}`);
        check((await get(`/rating-entries?target_type=session&target_id=${b.id}`)).length===0,'reset target ratings removed');check((await get(`/rating-entries?target_type=session&target_id=${a.id}`)).length===2,'other ratings retained');
        await open('Refresh saved');await modal().getByRole('button',{name:/Delete/}).click();await confirm();await modal().waitFor({state:'hidden'});check((await p.request.get(`${baseURL}/sessions/${b.id}`)).status()===404,'target deleted');check((await get(`/sessions/${a.id}`)).id===a.id,'other session retained');results.push('Confirmed reset/delete exact scope and canceled actions');
        // Acknowledged text followed by a late failed rating refreshes persisted evidence after Close/new owner.
        for(const replace of [false,true]){
            const c=await post('/sessions',{start_time:`${date}T16:00:00Z`,end_time:`${date}T17:00:00Z`,notes:`Late partial ${replace}`});
            await p.goto(`${baseURL}/revision#sessions`);await open(`Late partial ${replace}`);
            let releaseFailure,entered;const failureHeld=new Promise(resolve=>releaseFailure=resolve),ratingEntered=new Promise(resolve=>entered=resolve);
            releaseHeld=releaseFailure;await p.route('**/rating-entries',async route=>{
                const request=route.request();if(request.method()==='POST'&&request.postDataJSON().target_id===c.id){entered();await failureHeld;return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"Synthetic late rating failure"}'});}return route.continue();
            });
            const acknowledged=`Acknowledged late text ${replace}`;await p.locator('#session_rev_modal_notes').fill(acknowledged);await save();await ratingEntered;
            check((await get(`/sessions/${c.id}`)).notes===acknowledged,'text PUT is persisted before late rating failure');
            await close();if(replace){await open('Submitted session');await p.locator('#session_rev_modal_notes').fill('New owner retained draft');}
            const writeCount=writes.length,refreshed=p.waitForResponse(response=>new URL(response.url()).pathname==='/sessions'&&response.request().method()==='GET');releaseFailure();releaseHeld=null;await refreshed;
            check(writes.length===writeCount,'late rating failure sends no further writes');
            if(replace){check(await p.locator('#session_rev_modal_notes').inputValue()==='New owner retained draft','new owner draft retained');await close();}
            await p.locator('#session_rev_search').fill(acknowledged);await p.locator('#sessions_review_list button').filter({hasText:acknowledged}).waitFor();await p.unroute('**/rating-entries');
        }
        results.push('Late partial Save acknowledgement refreshes evidence after Close/new owner');
        // Responsive and actual computed grade colors remain native evidence, never fixture assertions.
        const themeEvidence=[];
        for(const lightTheme of ['refined','stone','porcelain']){await p.locator('#appearance_light_theme').selectOption(lightTheme);await open('Submitted session');themeEvidence.push(await p.locator('.session-review-dialog').evaluate(el=>({appearance:document.documentElement.dataset.appearance,theme:document.documentElement.dataset.lightTheme,color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor})));await close();}
        for(const theme of ['midnight','nord','dracula','cyberpunk','monokai']){await preferences(async()=>{await p.locator('#setting_appearance').selectOption('dark');await p.locator('#setting_theme').selectOption(theme);});await open('Submitted session');themeEvidence.push(await p.locator('.session-review-dialog').evaluate(el=>({appearance:document.documentElement.dataset.appearance,theme:document.documentElement.dataset.theme,color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor})));await close();}
        await open('Submitted session');
        const colors=[];for(let value=0;value<=4;value++){
            await rating(0).focus();await p.keyboard.press('Home');for(let i=0;i<value;i++)await p.keyboard.press('ArrowRight');
            colors.push(await p.locator('#session_custom_ratings_container [id^="score_label_"]').first().evaluate(el=>getComputedStyle(el).color));
        }check(new Set(colors).size===5,'five distinct computed grades');
        await p.setViewportSize({width:375,height:720});check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
        await p.locator('#session_rev_modal_notes').focus();await p.keyboard.press('End');await p.keyboard.press('Enter');await p.keyboard.type('Native newline');check((await p.locator('#session_rev_modal_notes').inputValue()).includes('\nNative newline'),'Enter inserts newline');
        await p.keyboard.press('Control+Enter');await modal().waitFor({state:'hidden'});check((await get(`/sessions/${a.id}`)).notes.endsWith('Native newline'),'Ctrl+Enter saves current session only');
        await open('Native newline');await p.locator('#session_rev_modal_notes').fill('Canceled draft');actionStart=writes.length;await p.keyboard.press('Escape');await modal().waitFor({state:'hidden'});check(writes.length===actionStart,'Escape writes nothing');
        check(await p.evaluate(()=>document.activeElement?.matches('.session-review-open,#session_rev_search')),'focus restored to row or search');
        check(errors.length===0,`Page errors: ${errors.join('; ')}`);
        return {results,writes,errors,themeEvidence,gradeColors:colors,fixtureIds:{task:task.id,one:one.id,two:two.id,day:dayDef.id,a:a.id,b:b.id,future:future.id,hostileSession:hostileSession.id},limits:['Authored probe must be executed and its selectors/results reviewed before claiming native proof.','Physical touch, screen reader, other engines and measured contrast require separate acceptance.']};
    } finally {if(releaseHeld)releaseHeld();await context.close();}
};
