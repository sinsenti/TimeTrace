async (page, baseURL) => {
    const context=await page.context().browser().newContext({viewport:{width:1440,height:900}}), p=await context.newPage();
    const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
    const writes=[],errors=[];let mode='json', release, entered, slowRelease;
    const proposal={id:'instruction-a',status:'pending',before_instructions:'',proposed_instruction:'<literal instruction>',after_instructions:'<literal instruction>'};
    const batch={id:'batch-a',status:'pending',summary:'<literal batch>',items:[{id:'item-a',status:'pending',entity_type:'task',op:'create',ui_kind:'add',proposed:{title:'<literal task>'}}]};
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    await context.route('**/api/ai/conversations',r=>r.fulfill({json:[{id:'a',title:'<literal a>'},{id:'b',title:'B'},{id:'c',title:'C'}]}));
    await context.route('**/api/ai/conversations/*',async r=>{
        if(r.request().method()==='DELETE')return r.fulfill({status:204});
        if(r.request().url().endsWith('/b'))await new Promise(resolve=>slowRelease=resolve);
        return r.fulfill({json:{messages:[{role:'assistant',content:r.request().url().endsWith('/c')?'C latest':'A ready'}],instruction_proposals:[]}});
    });
    await context.route('**/api/ai/drafts/batches?limit=50',r=>r.fulfill({json:[batch]}));
    await context.route('**/api/ai/drafts/batches/batch-a',r=>r.fulfill({json:batch}));
    await context.route('**/api/ai/conversations/*/messages',async r=>{
        writes.push(r.request().postDataJSON());
        if(mode==='held'){entered();await new Promise(resolve=>release=resolve);try{await r.fulfill({json:{message:{content:'OLD LATE'}}});}catch(_){}return;}
        if(mode==='json')return r.fulfill({json:{conversation:{id:'a'},message:{content:'<literal final>'},draft_batch:batch,instruction_proposal:proposal}});
        if(mode==='http-error')return r.fulfill({status:502,json:{detail:'Synthetic provider unavailable'}});
        if(mode==='sse-error')return r.fulfill({contentType:'text/event-stream',body:'event: token\ndata: {"text":"partial"}\n\nevent: error\ndata: {"message":"Synthetic provider error"}\n\n'});
        return r.fulfill({contentType:'text/event-stream',body:'event: token\ndata: {"text":"partial interrupted"}\n\n'});
    });
    p.on('pageerror',e=>errors.push(e.message));
    try {
        await p.goto(baseURL+'/dashboard');await p.locator('#ai_launcher_btn').click();
        await p.locator('#ai_thread').getByText('A ready',{exact:true}).waitFor();
        const input=p.locator('#ai_composer_input');await input.fill('JSON turn');await input.press('Enter');await p.waitForFunction(()=>!aiStreamInFlight);
        assert(await p.locator('.ai-instruction-proposal').count()===1,'JSON explicit instruction card');
        assert(await p.locator('.ai-draft-batch').count()===1,'JSON draft card');
        await p.locator('.ai-instruction-proposal-editor').fill('Independent instruction edit');
        await p.locator('[data-batch-id="batch-a"]').getByRole('button',{name:'Edit',exact:true}).click();
        await p.locator('[data-batch-id="batch-a"] input[type="text"]').first().fill('Independent task edit');
        await p.evaluate(()=>window.proposalNode=document.querySelector('[data-batch-id="batch-a"]'));
        await p.locator('#ai_drafts_toggle_btn').click();await p.locator('#ai_batches_list .ai-draft-batch').waitFor();
        assert(await p.evaluate(()=>proposalNode===document.querySelector('#ai_batches_list .ai-draft-batch')),'history reuses single real card');
        assert(await p.locator('[data-batch-id="batch-a"]').count()===1,'no duplicate batch owner');
        const beforeRefresh=writes.length;await p.locator('#ai_batches_refresh_btn').click();await p.locator('#ai_undo_all_btn').click();
        assert(writes.length===beforeRefresh,'dirty Refresh/Undo all sends no writes');
        await p.locator('#ai_drafts_toggle_btn').click();
        assert(await p.evaluate(()=>proposalNode===document.querySelector('#ai_thread .ai-draft-batch')),'same card restored to Chat');
        assert(await p.locator('[data-batch-id="batch-a"] input[type="text"]').first().inputValue()==='Independent task edit','moved draft preserved');
        assert(await p.locator('.ai-instruction-proposal-editor').inputValue()==='Independent instruction edit','other approval draft preserved');
        await p.locator('#ai_history_toggle_btn').click();await p.locator('#ai_conversation_select').selectOption('c');
        assert(await p.locator('#ai_conversation_select').inputValue()==='a','dirty proposals block destructive conversation switch');
        // Explicit Cancel ends only the task editor; instruction edit reversion is clean.
        await p.locator('[data-batch-id="batch-a"]').getByRole('button',{name:'Cancel',exact:true}).click();
        await p.locator('.ai-instruction-proposal-editor').fill(proposal.proposed_instruction);
        await p.locator('#ai_conversation_select').selectOption('b');
        await p.waitForFunction(()=>aiCurrentConversationId==='b');
        await p.locator('#ai_conversation_select').selectOption('c');await p.locator('#ai_thread').getByText('C latest',{exact:true}).waitFor();
        slowRelease();await p.waitForTimeout(100);
        assert((await p.locator('#ai_thread').innerText()).includes('C latest') && !(await p.locator('#ai_thread').innerText()).includes('A ready'),'late older read cannot replace selected conversation');
        for(const failure of ['interrupted','sse-error','http-error']){
            mode=failure;await input.fill('retained '+failure);await input.press('Enter');await p.waitForFunction(()=>!aiStreamInFlight);
            assert(await input.inputValue()==='retained '+failure,'failed turn restores submitted composer '+failure);
        }
        assert((await p.locator('#ai_thread').innerText()).includes('Response interrupted'),'missing SSE terminal is an interruption');
        mode='held';let started=new Promise(resolve=>entered=resolve);
        await input.fill('stop this');await input.press('Enter');await started;
        await input.fill('new independent composer');await p.locator('#ai_composer_cancel').click();
        await p.waitForFunction(()=>!aiStreamInFlight);
        assert(await input.inputValue()==='new independent composer','Stop retains concurrent typing');
        release();await p.waitForTimeout(100);
        assert(!(await p.locator('#ai_thread').innerText()).includes('OLD LATE'),'aborted old response stays inert');
        assert((await p.locator('#ai_assistant_notice').innerText()).includes('Server work may have persisted'),'Stop is honest about server persistence');
        started=new Promise(resolve=>entered=resolve);
        await input.fill('identical concurrent draft');await input.press('Enter');await started;
        await input.fill('another edit');await input.fill('identical concurrent draft');release();await p.waitForFunction(()=>!aiStreamInFlight);
        assert(await input.inputValue()==='identical concurrent draft','captured JSON ACK cannot consume newer input even when its text matches the submitted text');
        // Current Settings and ordinary drawer refreshes share the real badge owner.
        const settingsContext=await page.context().browser().newContext(), settingsPage=await settingsContext.newPage();
        const settingsWrites=[];let statusMode='ready', pendingStatus;
        await settingsContext.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
        await settingsContext.route('**/api/ai/**',async route=>{
            const request=route.request(),path=new URL(request.url()).pathname;
            if(request.method()!=='GET'){settingsWrites.push(path);return route.abort();}
            if(path==='/api/ai/status'){
                if(statusMode==='hold'){pendingStatus=route;return;}
                if(statusMode==='fail')return route.fulfill({status:503,json:{detail:'Synthetic status failure'}});
                return route.fulfill({json:{pending_draft_count:9}});
            }
            if(path==='/api/ai/providers')return route.fulfill({json:[]});
            if(path==='/api/ai/settings')return route.fulfill({json:{custom_instructions:'',data_scope:{tasks:true,sessions:true}}});
            if(path==='/api/ai/providers/catalog')return route.fulfill({json:{}});
            return route.abort();
        });
        settingsPage.on('pageerror',error=>errors.push(error.message));
        try{
            await settingsPage.goto(baseURL+'/settings/ai#providers');
            await settingsPage.waitForFunction(()=>aiBehaviorReady);
            statusMode='hold';
            await settingsPage.evaluate(()=>{window.heldSettingsStatus=aiRefreshProviderStatus(true);});
            while(!pendingStatus)await settingsPage.waitForTimeout(10);
            statusMode='ready';await settingsPage.evaluate(()=>refreshAiStatusBadge());
            await pendingStatus.fulfill({status:503,json:{detail:'Synthetic old status failure'}});pendingStatus=null;
            await settingsPage.evaluate(()=>heldSettingsStatus);
            assert(await settingsPage.locator('#ai_launcher_badge').innerText()==='9','latest drawer status owns badge');
            await settingsPage.locator('#ai_provider_status').getByRole('button',{name:'Retry status',exact:true}).click();
            await settingsPage.waitForFunction(()=>document.getElementById('ai_provider_status').textContent==='');
            statusMode='hold';await settingsPage.evaluate(()=>{window.heldSettingsStatus=aiRefreshProviderStatus(true);});
            while(!pendingStatus)await settingsPage.waitForTimeout(10);
            statusMode='fail';await settingsPage.evaluate(()=>refreshAiStatusBadge());
            await pendingStatus.fulfill({json:{pending_draft_count:2}});pendingStatus=null;
            await settingsPage.evaluate(()=>heldSettingsStatus);
            assert(await settingsPage.locator('#ai_launcher_badge').innerText()==='9','late success cannot replace last-known badge after latest failure');
            assert(!(await settingsPage.locator('#ai_provider_status').innerText()).includes('Refreshing'),'Settings refresh always settles');
            assert(settingsWrites.length===0,'status retry never writes provider configuration');
        }finally{if(pendingStatus)await pendingStatus.abort();await settingsContext.close();}
        assert(errors.length===0,'no uncaught browser errors: '+errors.join(','));
        return {json:true,sseError:true,interruption:true,httpError:true,cancelPendingHTTP:true,lateReads:true,singleProposalNode:true,independentEdits:true,identicalConcurrentInputRetained:true,settingsStatusOverlap:true,writes:writes.length,errors};
    }finally{if(release)release();if(slowRelease)slowRelease();await context.close();}
}
