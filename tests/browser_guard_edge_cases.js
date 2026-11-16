/* Manual native-runner regression: synthetic public API data; only instruction HTTP and deliberate 503s are fake.
 * No provider Test/activation/inference. Each case owns a fresh browser context. */
async (page, baseURL) => {
    const results=[];
    const check=(ok,message)=>{if(!ok) throw Error(message);};
    const makePage=async()=>{
        const c=await page.context().browser().newContext(),p=await c.newPage(),dialogs=[],errors=[],writes=[];
        p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
        p.on('pageerror',e=>errors.push(e.message));
        p.on('request',r=>{if(r.method()!=='GET') writes.push({method:r.method(),url:r.url(),body:r.postData()});});
        return {c,p,dialogs,errors,writes};
    };
    const guarded=async(p,dialogs)=>{
        const before=dialogs.length,url=p.url();
        await p.getByRole('link',{name:'Settings',exact:true}).dispatchEvent('click');
        check(dialogs.length===before+1 && p.url()===url,'Canceled Settings departure must guard and stay');
    };
    for(const conflict of [false,true]) {
        const {c,p,dialogs,errors,writes}=await makePage();let accepted=false;
        const proposal={id:'synthetic-edge',status:'pending',proposed_instruction:'C',before_instructions:'A',after_instructions:'C'};
        try {
            const settings=await(await c.request.get(`${baseURL}/api/ai/settings`)).json();
            await c.route('**/api/ai/settings',r=>r.fulfill({json:{...settings,custom_instructions:accepted?'C':'A'}}));
            await c.route('**/api/ai/conversations',r=>r.fulfill({json:[{id:'synthetic-edge',title:'Synthetic'}]}));
            await c.route('**/api/ai/conversations/synthetic-edge',r=>r.fulfill({json:{messages:[],instruction_proposals:[proposal]}}));
            await c.route('**/api/ai/instruction-proposals/synthetic-edge/accept',r=>{
                accepted=true;return conflict ? r.fulfill({status:409,json:{detail:'Settings conflict'}}) : r.fulfill({json:{settings:{...settings,custom_instructions:'C'},proposal:{...proposal,status:'accepted'}}});
            });
            await p.goto(`${baseURL}/settings/ai`);await p.waitForFunction(()=>aiBehaviorReady);
            await p.locator('#ai_setting_custom_instructions').fill('B');
            await p.getByRole('button',{name:'Assistant',exact:true}).click();
            await p.getByRole('button',{name:'Save to custom instructions',exact:true}).click();
            await p.waitForFunction(conflict=>document.querySelector('.ai-instruction-proposal')?.textContent.includes(conflict?'Settings changed since this proposal':'Saved to custom instructions.'),conflict);
            await p.locator('#ai_drawer_close_btn').click();
            check(await p.locator('#ai_setting_custom_instructions').inputValue()==='B','Live B must survive authoritative C');
            await p.locator('#ai_setting_custom_instructions').fill('A');
            await p.getByRole('link',{name:'Calendar',exact:true}).click();
            check(dialogs.length===1 && p.url().endsWith('/settings/ai'),'Obsolete A must guard');
            await p.locator('#ai_setting_custom_instructions').fill('C');
            await p.getByRole('link',{name:'Calendar',exact:true}).click();await p.waitForURL('**/dashboard**');
            check(dialogs.length===1 && errors.length===0,'Authoritative C must be clean');
            check(writes.filter(w=>!w.url.endsWith('/idle/toggle')).length===1,'Only fake explicit accept may write');
            results.push({case:conflict?'instruction conflict C':'instruction accept C',dialogs,errors,writes,fakes:'settings A/C, conversation/proposal and accept/409 only'});
        } finally {await c.close();}
    }
    for(const fail of [false,true]) {
        const {c,p,dialogs,errors,writes}=await makePage();let task,release,entered,first=true;
        const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
        try {
            task=await(await c.request.post(`${baseURL}/api/tasks`,{data:{title:'Synthetic unknown detail',description:'Persisted description',estimated_minutes:45}})).json();
            await c.route(`**/api/tasks/${task.id}/tree`,async r=>{
                if(!first) return r.continue();entered();await held;
                return fail ? r.fulfill({status:503,json:{detail:'Synthetic tree failure'}}) : r.continue();
            });
            await p.goto(`${baseURL}/task-inspector/${task.id}`);await started;
            check(await p.locator('#inspector_edit_desc').isDisabled() && await p.locator('#inspector_save_btn').isDisabled(),'Unknown fields and Save must be gated before response');
            await p.evaluate(()=>saveInspectorTaskProperties());
            check(!writes.length,'Unknown keyboard/caller Save cannot write');release();
            if(fail) {
                await p.getByRole('button',{name:'Retry refresh',exact:true}).waitFor();
                check(await p.locator('#inspector_edit_desc').isDisabled(),'503 must leave fields gated');
                first=false;await p.getByRole('button',{name:'Retry refresh',exact:true}).click();
            }
            await p.waitForFunction(()=>!document.getElementById('task_properties_editor').disabled);
            check(await p.locator('#inspector_edit_desc').inputValue()==='Persisted description','Retry first success must initialize');
            await p.locator('#inspector_edit_desc').fill('Retained detail draft');await guarded(p,dialogs);
            first=false;await p.evaluate(()=>loadTaskDetailTree(true));
            check(await p.locator('#inspector_edit_desc').inputValue()==='Retained detail draft','Refresh must keep initialized draft');
            await p.locator('#inspector_edit_desc').fill('Persisted description');
            check(await p.evaluate(()=>followSettingsLink({})),'Reverted detail clean');
            await p.locator('#inspector_edit_desc').fill('Explicitly saved description');
            await p.locator('#inspector_save_btn').click();await p.waitForURL('**/tasks');
            const saved=await(await c.request.get(`${baseURL}/api/tasks/${task.id}`)).json();
            check(saved.description==='Explicitly saved description' && saved.estimated_minutes===45,'Save only after initialized fields; no unloaded defaults');
            check(writes.length===1 && errors.length===0,'One explicit task write only');
            results.push({case:fail?'tree 503 + usable retry':'held tree',saved,dialogs,writes,errors});
        } finally {release();if(task) await c.request.delete(`${baseURL}/api/tasks/${task.id}`);await c.close();}
    }
    for(const edit of ['notes','rating']) {
        const {c,p,dialogs,errors,writes}=await makePage();
        try {
            await p.goto(`${baseURL}/revision#day`);await p.waitForFunction(()=>dayReviewTextReady && dayReviewRatingsReady && !dayReviewLoading);
            const selector=`#day_form_${edit}`,original=await p.locator(selector).inputValue();
            const draft=edit==='notes' ? original+' Synthetic retained notes' : original==='5'?'4':'5';
            if(edit==='notes') await p.locator(selector).fill(draft);else await p.locator(selector).selectOption(draft);
            await p.locator('#rev_tab_btn_overview').click();await guarded(p,dialogs);
            await p.goBack();await p.waitForURL('**/revision#day');
            await p.waitForFunction(()=>!dayReviewLoading);
            check(await p.locator(selector).inputValue()===draft,'Hidden tab must retain its draft');
            if(edit==='notes') await p.locator(selector).fill(original);else await p.locator(selector).selectOption(original);
            await p.locator('#rev_tab_btn_overview').click();
            await p.getByRole('link',{name:'Settings',exact:true}).click();await p.waitForURL('**/settings/ai');
            check(dialogs.length===1 && !writes.length && !errors.length,'Reverted hidden editor clean; no writes');
            results.push({case:`hidden Day ${edit}`,dialogs,writes,errors});
        } finally {await c.close();}
    }
    for(const kind of ['task','session']) {
        const {c,p,dialogs,errors,writes}=await makePage();let task,session,release,entered,fail=true;
        const definitions=[],held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
        try {
            task=await(await c.request.post(`${baseURL}/api/tasks`,{data:{title:'Synthetic partial review',estimated_minutes:30}})).json();
            session=await(await c.request.post(`${baseURL}/sessions`,{data:{task_id:task.id,start_time:'2026-10-01T10:00:00Z',end_time:'2026-10-01T10:30:00Z',notes:'Original session'}})).json();
            // Keep the task form mounted when opening session review, to detect cross-form rating POSTs.
            for(const target of (kind==='session'?['task','session']:['task'])) {
                for(const name of ['one','two']) definitions.push(await(await c.request.post(`${baseURL}/rating-definitions`,{data:{name:`Synthetic ${target} ${name}`,target_type:target,min_score:1,max_score:5}})).json());
            }
            const own=definitions.filter(d=>d.target_type===kind);
            const ratingInput = definition => kind==='task'
                ? taskReview.locator(`[data-rating-def-id="${definition.id}"] .custom-rating-input`)
                : p.locator(`#rating_range_input_${definition.id}`);
            await c.route('**/rating-entries',async r=>{
                if(r.request().method()!=='POST' || r.request().postDataJSON().rating_definition_id!==own[1].id || !fail) return r.continue();
                entered();await held;await r.fulfill({status:503,json:{detail:'Synthetic second rating failure'}});
            });
            await p.goto(`${baseURL}/revision#tasks`);
            await p.locator('#task_quick_chips_bar button').filter({hasText:task.title}).click();
            const taskReview = p.locator('#revision_task_postmortem');
            const taskReviewField = name => taskReview.locator(`[data-task-review="${name}"]`);
            await p.waitForFunction(()=>{
                const root=document.getElementById('revision_task_postmortem');
                const save=root?.querySelector('[data-task-review="save"]');
                return root && root.getAttribute('aria-busy')!=='true' && save && !save.disabled;
            });
            if(kind==='session') {
                await p.locator('#inspect_task_sessions_list > div').first().click();
                await p.locator('#session_review_modal').waitFor({state:'visible'});
            }
            const text=kind==='task' ? taskReviewField('what_went_well') : p.locator('#session_rev_modal_notes');
            const failureStatus=kind==='task'
                ? taskReview.locator('[data-task-review="status"]')
                : p.locator('#session_rev_modal_status');
            await text.fill('Submitted persisted review');
            for(const d of own) await ratingInput(d).evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
            if(kind==='task') await taskReview.locator('[data-task-review="save"]').click();
            else await p.locator('#session_review_modal button[onclick="saveSessionReviewModal()"] ').click();
            await started;
            const readURL=kind==='task'?`/api/task-reviews/${task.id}`:`/sessions/${session.id}`;
            const persisted=await(await c.request.get(baseURL+readURL)).json();
            check(persisted[kind==='task'?'what_went_well':'notes']==='Submitted persisted review','First write must actually persist before ratings');
            await text.fill('Typed during pending rating');await guarded(p,dialogs);release();
            await p.waitForFunction(({kind})=>{
                const status=kind==='task'
                    ? document.querySelector('#revision_task_postmortem [data-task-review="status"]')?.textContent
                    : document.getElementById('session_rev_modal_status')?.textContent;
                return kind==='task'
                    ? status?.startsWith('Save incomplete. Successful writes are retained;')
                    : status?.includes('Ratings save failed or its acknowledgement was lost: Synthetic second rating failure');
            },{kind});
            const observedFailureStatus=await failureStatus.textContent();
            check(await text.inputValue()==='Typed during pending rating','Partial failure must retain concurrent typing');
            await text.fill('Submitted persisted review');
            await ratingInput(own[1]).evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}));});
            check(await p.evaluate(()=>followSettingsLink({})),'Persisted text and first successful rating clean after failed-rating reversion');
            await ratingInput(own[1]).evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
            await guarded(p,dialogs);fail=false;
            if(kind==='task') await taskReview.locator('[data-task-review="save"]').click();
            else await p.locator('#session_review_modal button[onclick="saveSessionReviewModal()"] ').click();
            await p.waitForFunction(kind=>kind==='task'
                ? !hasSettingsDrafts(['revision_task_postmortem','revision_task_postmortem_ratings'])
                : document.getElementById('session_review_modal').classList.contains('hidden'),kind);
            const ratings=await(await c.request.get(`${baseURL}/rating-entries?target_type=${kind}&target_id=${kind==='task'?task.id:session.id}`)).json();
            check(ratings.length===2 && ratings.every(r=>r.score===5),'Retry must persist both own ratings');
            const ratingWrites=writes.filter(w=>new URL(w.url).pathname==='/rating-entries');
            check(ratingWrites.length===4 && ratingWrites.every(w=>JSON.parse(w.body).target_type===kind),'No other form or target may be submitted');
            const taskAfter=await(await c.request.get(`${baseURL}/api/tasks/${task.id}`)).json();
            check(taskAfter.status===task.status && taskAfter.estimated_minutes===30,'Review must not complete task or change estimate');
            await p.getByRole('link',{name:'Settings',exact:true}).click();await p.waitForURL('**/settings/ai');
            check(errors.length===0,'The declared synthetic 503 is shown in the review status; no unexpected page errors');
            results.push({case:`${kind} partial review + retry`,persisted,ratings,dialogs,writes,visibleFailureStatus:observedFailureStatus,errors,fakes:'second rating POST 503 only; text/first rating/retry persisted and read via real API'});
        } finally {
            release();for(const d of definitions) await c.request.delete(`${baseURL}/rating-definitions/${d.id}`);
            if(session) await c.request.delete(`${baseURL}/sessions/${session.id}`);
            if(task) await c.request.delete(`${baseURL}/api/tasks/${task.id}`);await c.close();
        }
    }
    return results;
};
