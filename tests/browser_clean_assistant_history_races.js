async (page, baseURL) => {
    const context=await page.context().browser().newContext(),p=await context.newPage();
    const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
    let failList=false,hold=false,release,undo=0,listReads=0;
    const batch={id:'race-batch',status:'pending',summary:'A proposal',items:[{id:'race-item',status:'pending',entity_type:'task',op:'create',ui_kind:'add',proposed:{title:'Original'}}]};
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    await context.route('**/api/ai/conversations',r=>r.fulfill({json:[{id:'race',title:'History races'}]}));
    await context.route('**/api/ai/conversations/race',r=>r.fulfill({json:{messages:[{role:'assistant',content:'A proposal',draft_batch_id:batch.id}],instruction_proposals:[]}}));
    await context.route('**/api/ai/drafts/batches/race-batch',async r=>{if(hold)await new Promise(resolve=>release=resolve);return r.fulfill({json:batch});});
    await context.route('**/api/ai/drafts/batches?limit=50',r=>{listReads++;return failList?r.fulfill({status:503,json:{detail:'Synthetic history failure'}}):r.fulfill({json:[batch]});});
    await context.route('**/api/ai/drafts/undo',r=>{undo++;failList=true;return r.fulfill({json:[]});});
    const stoppedReads = [];
    for (const stage of ['list', 'detail']) {
        const isolated = await page.context().browser().newContext(), view = await isolated.newPage();
        let releaseRead, heldRead = false, writes = 0;
        const pause = async () => {heldRead = true; await new Promise(resolve => {releaseRead = resolve;});};
        await isolated.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false})));
        await isolated.route('**/api/ai/conversations', async route => {
            if (route.request().method() !== 'GET') {writes++; return route.fulfill({status:500,json:{detail:'Unexpected create'}});}
            if (stage === 'list') await pause();
            return route.fulfill({json:[{id:'old',title:'Old'}, {id:'new',title:'New'}]});
        });
        await isolated.route('**/api/ai/conversations/old', async route => {
            if (stage === 'detail') await pause();
            return route.fulfill({json:{messages:[{role:'assistant',content:'Stale read'}]}});
        });
        await isolated.route('**/api/ai/conversations/new', route => route.fulfill({json:{messages:[{role:'assistant',content:'New owner'}]}}));
        await isolated.route('**/api/ai/conversations/*/messages', route => {writes++; return route.fulfill({json:{message:{content:'New reply'}}});});
        try {
            await view.goto(baseURL+'/dashboard'); await view.locator('#ai_launcher_btn').click();
            await view.waitForFunction(() => Boolean(document.querySelector('#ai_composer_input')));
            await view.locator('#ai_composer_input').fill('Old prompt');
            await view.locator('#ai_composer_send').click();
            for (let attempt=0; !heldRead && attempt<100; attempt++) await view.waitForTimeout(10);
            assert(heldRead, stage+' read is held');
            await view.locator('#ai_composer_cancel').click();
            assert(await view.locator('#ai_composer_send').isEnabled(), 'Stop recovers before '+stage+' read is released');
            // Dispatch the actual selection listener, supplying the newer conversation even while
            // the initial list has not populated the native select options.
            await view.evaluate(() => {
                const select=document.querySelector('#ai_conversation_select');
                const option=document.createElement('option'); option.value='new'; option.textContent='New'; select.appendChild(option);
                select.value='new'; select.dispatchEvent(new Event('change'));
            });
            await view.locator('#ai_thread').getByText('New owner',{exact:true}).waitFor();
            await view.locator('#ai_composer_input').fill('New prompt'); await view.locator('#ai_composer_send').click();
            await view.locator('#ai_thread').getByText('New reply',{exact:true}).waitFor();
            releaseRead(); releaseRead=null; await view.waitForTimeout(100);
            assert(await view.locator('#ai_thread').getByText('New owner',{exact:true}).count()===1, 'late '+stage+' read retains newer transcript');
            assert(await view.locator('#ai_thread').getByText('Stale read',{exact:true}).count()===0, 'stale '+stage+' transcript stays fenced');
            assert(writes===1, 'canceled '+stage+' continuation never creates or sends');
            stoppedReads.push(stage);
        } finally {if(releaseRead)releaseRead(); await isolated.close();}
    }
    const mutationOwners = [];
    for (const mutation of ['create', 'delete']) {
        const isolated = await page.context().browser().newContext(), view = await isolated.newPage();
        let releaseMutation, mutationHeld = false, messagePosts = 0, mutationPosts = 0;
        await isolated.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false})));
        await isolated.route('**/api/ai/conversations', async route => {
            if (route.request().method() === 'POST') {
                mutationPosts++; mutationHeld = true;
                await new Promise(resolve => {releaseMutation = resolve;});
                return route.fulfill({json:{id:'created',title:'Acknowledged row'}});
            }
            return route.fulfill({json:[{id:'old',title:'Old'},{id:'new',title:'New'}]});
        });
        await isolated.route('**/api/ai/conversations/old', async route => {
            if (route.request().method() === 'DELETE') {
                mutationPosts++; mutationHeld = true;
                await new Promise(resolve => {releaseMutation = resolve;});
                return route.fulfill({json:{}});
            }
            return route.fulfill({json:{messages:[{role:'assistant',content:'Old owner'}]}});
        });
        await isolated.route('**/api/ai/conversations/new', route => route.fulfill({json:{messages:[{role:'assistant',content:'New owner'}]}}));
        await isolated.route('**/api/ai/conversations/*/messages', route => {
            messagePosts++; return route.fulfill({json:{message:{content:'New reply'}}});
        });
        try {
            await view.goto(baseURL+'/dashboard'); await view.locator('#ai_launcher_btn').click();
            await view.locator('#ai_thread').getByText('Old owner',{exact:true}).waitFor();
            if (mutation === 'delete') view.once('dialog', dialog => dialog.accept());
            await view.locator(mutation === 'create' ? '#ai_new_conversation_btn' : '#ai_delete_conversation_btn').click();
            for (let attempt=0; !mutationHeld && attempt<100; attempt++) await view.waitForTimeout(10);
            assert(mutationHeld, mutation+' request remains held');
            await view.locator('#ai_composer_input').fill('Retained input');
            if (mutation === 'delete') {
                assert(await view.locator('#ai_composer_send').isDisabled(), 'Delete truthfully pauses Send');
                await view.locator('#ai_composer_input').press('Enter');
                await view.evaluate(() => window.aiRunPresetPrompt('Blocked preset'));
                assert(messagePosts===0, 'Enter and presets cannot send against deleting id');
            } else {
                await view.locator('#ai_composer_send').click();
                await view.locator('#ai_thread').getByText('New reply',{exact:true}).waitFor();
            }
            await view.locator('#ai_conversation_select').selectOption('new');
            await view.locator('#ai_thread').getByText('New owner',{exact:true}).waitFor();
            assert(await view.locator('#ai_composer_send').isEnabled(), 'new selected owner can send while old mutation held');
            releaseMutation(); releaseMutation=null; await view.waitForTimeout(100);
            assert(await view.locator('#ai_thread').getByText('New owner',{exact:true}).count()===1, 'late '+mutation+' ACK retains new transcript');
            assert(await view.locator('#ai_conversation_select').inputValue()==='new', 'late '+mutation+' ACK retains new selection');
            assert(mutationPosts===1 && messagePosts===(mutation==='create'?1:0), 'no unwanted create/message POST or mutation replay');
            if (mutation==='delete') assert(await view.locator('#ai_composer_input').inputValue()==='Retained input', 'delete retains unsent composer');
            mutationOwners.push(mutation);
        } finally {if(releaseMutation)releaseMutation(); await isolated.close();}
    }
    const dirtyDeletion = [];
    for (const rejected of [false, true]) {
        const isolated = await page.context().browser().newContext(), view = await isolated.newPage();
        let releaseDeletion, deleting = false, deleted = false, creations = 0, deletes = 0;
        const messages = [];
        await isolated.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false})));
        await isolated.route('**/api/ai/conversations', route => {
            if (route.request().method() === 'POST') {creations++; return route.fulfill({json:{id:'created',title:'Fresh conversation'}});}
            return route.fulfill({json:deleted ? [] : [{id:'old',title:'Old conversation'}]});
        });
        await isolated.route('**/api/ai/conversations/old', async route => {
            if (route.request().method() !== 'DELETE') return route.fulfill({json:{messages:[{role:'assistant',content:'Proposal',draft_batch_id:batch.id}]}});
            deletes++; deleting = true;
            await new Promise(resolve => {releaseDeletion = resolve;});
            deleted = !rejected;
            return rejected ? route.fulfill({status:503,json:{detail:'Synthetic delete failure'}}) : route.fulfill({json:{}});
        });
        await isolated.route('**/api/ai/drafts/batches/race-batch', route => route.fulfill({json:batch}));
        await isolated.route('**/api/ai/conversations/created', route => route.fulfill({json:{messages:[]}}));
        await isolated.route('**/api/ai/conversations/*/messages', route => {
            messages.push({url:route.request().url(),body:route.request().postDataJSON()});
            return route.fulfill({json:{message:{content:'Usable reply'}}});
        });
        try {
            await view.goto(baseURL+'/dashboard'); await view.locator('#ai_launcher_btn').click();
            const card = view.locator('#ai_thread .ai-draft-batch'); await card.waitFor();
            view.once('dialog', dialog => dialog.accept()); await view.locator('#ai_delete_conversation_btn').click();
            for (let attempt=0; !deleting && attempt<100; attempt++) await view.waitForTimeout(10);
            assert(deleting, 'dirty Delete is held');
            await card.getByRole('button',{name:'Edit',exact:true}).click();
            await card.locator('input[type="text"]').first().fill('Retained local edit');
            await view.locator('#ai_composer_input').fill('Next message');
            releaseDeletion(); releaseDeletion=null;
            await view.waitForFunction(rejected => document.querySelector('#ai_assistant_notice').textContent.includes(rejected ? 'Could not confirm deletion' : 'Conversation deleted'), rejected);
            assert(await card.locator('input[type="text"]').first().inputValue()==='Retained local edit', 'DELETE outcome retains dirty proposal');
            assert(await view.locator('#ai_conversation_select').inputValue()===(rejected?'old':''), 'only successful ACK retires deleted selection');
            if (!rejected) {
                await view.locator('#ai_drawer_close_btn').click(); await view.locator('#ai_launcher_btn').click();
                await view.locator('#ai_composer_send').click(); await view.locator('#ai_new_conversation_btn').click();
                assert(await card.locator('input[type="text"]').first().inputValue()==='Retained local edit', 'empty-list refresh and blocked sends retain orphaned edit');
                assert(creations===0 && messages.length===0, 'dirty orphan cannot create or send');
            }
            await card.getByRole('button',{name:'Cancel',exact:true}).click();
            assert(await view.locator('#ai_composer_input').inputValue()==='Next message', 'Cancel retains unsent composer');
            await view.locator('#ai_composer_send').click();
            await view.locator('#ai_thread').getByText('Usable reply',{exact:true}).waitFor();
            assert(deletes===1 && creations===(rejected?0:1) && messages.length===1, 'one delete outcome and one coherent subsequent send');
            assert(messages[0].url.endsWith(rejected?'/old/messages':'/created/messages') && messages[0].body.text==='Next message', 'send targets a usable acknowledged identity');
            assert(await view.locator('#ai_conversation_select').inputValue()===(rejected?'old':'created'), 'subsequent send selects the usable identity');
            dirtyDeletion.push(rejected?'rejected':'acknowledged');
        } finally {if(releaseDeletion)releaseDeletion(); await isolated.close();}
    }
    const joinedCreation = [];
    for (const outcome of ['send', 'stop', 'stop-switch']) {
        const isolated = await page.context().browser().newContext(), view = await isolated.newPage();
        let releaseCreation, creating = false, creations = 0;
        const messages = [];
        await isolated.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false})));
        await isolated.route('**/api/ai/conversations', async route => {
            if (route.request().method() !== 'POST') return route.fulfill({json:[]});
            creations++; creating = true;
            await new Promise(resolve => {releaseCreation = resolve;});
            return route.fulfill({json:{id:'created',title:'First chat'}});
        });
        await isolated.route('**/api/ai/conversations/created', route => route.fulfill({json:{messages:[]}}));
        await isolated.route('**/api/ai/conversations/new', route => route.fulfill({json:{messages:[{role:'assistant',content:'New owner'}]}}));
        await isolated.route('**/api/ai/conversations/*/messages', route => {
            messages.push({url:route.request().url(), body:route.request().postDataJSON()});
            return route.fulfill({json:{message:{content:'First reply'}}});
        });
        try {
            await view.goto(baseURL+'/dashboard'); await view.locator('#ai_launcher_btn').click();
            await view.locator('#ai_thread .ai-thread-empty').waitFor();
            await view.locator('#ai_new_conversation_btn').click();
            for (let attempt=0; !creating && attempt<100; attempt++) await view.waitForTimeout(10);
            assert(creating, 'initial New creation is held');
            await view.locator('#ai_composer_input').fill('First message');
            await view.locator('#ai_composer_send').click();
            await view.waitForTimeout(50);
            assert(creations===1 && messages.length===0, 'Send joins one held creation');
            if (outcome !== 'send') {
                await view.locator('#ai_composer_cancel').click();
                assert(await view.locator('#ai_composer_send').isEnabled(), 'Stop releases joined creation immediately');
                if (outcome === 'stop-switch') {
                    await view.evaluate(() => {
                        const select=document.querySelector('#ai_conversation_select');
                        const option=document.createElement('option'); option.value='new'; option.textContent='New'; select.appendChild(option);
                        select.value='new'; select.dispatchEvent(new Event('change'));
                    });
                    await view.locator('#ai_thread').getByText('New owner',{exact:true}).waitFor();
                }
            }
            releaseCreation(); releaseCreation=null;
            if (outcome === 'send') {
                await view.locator('#ai_thread').getByText('First reply',{exact:true}).waitFor();
                assert(messages.length===1 && messages[0].url.endsWith('/created/messages') && messages[0].body.text==='First message', 'first message submits once to acknowledged conversation');
                assert(await view.locator('#ai_conversation_select').inputValue()==='created', 'joined creation is selected');
                assert(await view.locator('#ai_composer_input').inputValue()==='', 'acknowledged composer is consumed');
            } else {
                await view.waitForTimeout(100);
                assert(messages.length===0, 'stopped joining Send never resumes after ACK');
                assert(await view.locator('#ai_composer_input').inputValue()==='First message', 'stopped joining Send retains composer');
                assert(await view.locator('#ai_conversation_select').inputValue()===(outcome==='stop-switch'?'new':''), 'late joined creation cannot acquire canceled selection');
                if (outcome==='stop-switch') assert(await view.locator('#ai_thread').getByText('New owner',{exact:true}).count()===1, 'late joined ACK retains newer thread');
            }
            assert(creations===1, 'joined creation is never replayed');
            assert(await view.locator('#ai_thread').getByText('Failed to start an assistant conversation.',{exact:true}).count()===0, 'joined ACK has no false failure');
            joinedCreation.push(outcome);
        } finally {if(releaseCreation)releaseCreation(); await isolated.close();}
    }
    try{
        await p.goto(baseURL+'/dashboard');await p.locator('#ai_launcher_btn').click();await p.locator('#ai_thread .ai-draft-batch').waitFor();
        await p.evaluate(()=>window.retainedProposal=document.querySelector('.ai-draft-batch'));
        hold=true;await p.locator('#ai_drafts_toggle_btn').click();await p.waitForFunction(()=>document.querySelector('#ai_assistant_notice').textContent.includes('Loading'));
        await p.waitForTimeout(50);await p.locator('#ai_drafts_toggle_btn').click();hold=false;release();await p.waitForTimeout(100);
        assert(await p.evaluate(()=>retainedProposal===document.querySelector('#ai_thread .ai-draft-batch')),'late hidden history read cannot steal chat card');
        failList=true;await p.locator('#ai_drafts_toggle_btn').click();await p.waitForFunction(()=>document.querySelector('#ai_assistant_notice').textContent.includes('Could not refresh'));
        assert(await p.evaluate(()=>retainedProposal===document.querySelector('#ai_batches_list .ai-draft-batch')),'failed list keeps existing card');
        failList=false;await p.locator('#ai_batches_refresh_btn').click();await p.waitForFunction(()=>!document.querySelector('#ai_assistant_notice').textContent);
        const card=p.locator('#ai_batches_list .ai-draft-batch');await card.getByRole('button',{name:'Edit',exact:true}).click();
        hold=true;await p.locator('#ai_batches_refresh_btn').click();await p.waitForTimeout(50);
        await card.locator('input[type="text"]').first().fill('Typed during refresh');hold=false;release();await p.waitForTimeout(100);
        assert(await card.locator('input[type="text"]').first().inputValue()==='Typed during refresh','concurrent edit not replaced by late detail');
        const before=listReads;await p.locator('#ai_batches_refresh_btn').click();await p.locator('#ai_undo_all_btn').click();
        assert(listReads===before&&undo===0,'dirty Refresh/Undo all refuses with zero HTTP requests');
        await card.getByRole('button',{name:'Cancel',exact:true}).click();await p.locator('#ai_undo_all_btn').click();
        await p.waitForFunction(()=>document.querySelector('#ai_assistant_notice').textContent.includes('Undo all saved; history could not refresh'));
        failList=false;await p.locator('#ai_batches_refresh_btn').click();await p.waitForFunction(()=>!document.querySelector('#ai_assistant_notice').textContent);
        assert(undo===1,'acknowledged Undo all never replayed on read retry');
        return {stoppedReads,mutationOwners,joinedCreation,dirtyDeletion,hiddenReadSafe:true,failedReadRetained:true,concurrentEditSafe:true,dirtyZeroRequests:true,undoACKReadOnlyRecovery:true,undo};
    }finally{if(release)release();await context.close();}
}
