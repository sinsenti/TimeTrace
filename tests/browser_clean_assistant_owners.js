async (page, baseURL) => {
    const context=await page.context().browser().newContext({viewport:{width:1440,height:900}}), p=await context.newPage();
    const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
    const actions=[];let failB=false;
    const batches=['a','b'].map(id=>({id,status:'pending',summary:'<literal proposal '+id+'>',items:[{id:'item-'+id,status:'pending',op:'create',ui_kind:'add',entity_type:'task',proposed:{title:'Task '+id}}]}));
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    await context.route('**/api/ai/drafts/batches?limit=50',r=>r.fulfill({json:batches}));
    await context.route('**/api/ai/drafts/batches/*',r=>failB&&r.request().url().endsWith('/b')?r.fulfill({status:503,json:{detail:'Synthetic saved-card read failure'}}):r.fulfill({json:batches.find(b=>r.request().url().endsWith('/'+b.id))}));
    for(const action of ['accept','undo','reapply'])await context.route('**/api/ai/drafts/batches/b/'+action,r=>{actions.push(action);batches[1].status=action==='undo'?'undone':'applied';batches[1].items[0].status=batches[1].status;return r.fulfill({json:{results:[],completion_policies:[]}});});
    await context.route('**/api/ai/conversations',r=>r.fulfill({json:[]}));
    try {
        await p.goto(baseURL+'/dashboard');await p.locator('#ai_launcher_btn').click();await p.locator('#ai_drafts_toggle_btn').click();
        const cardA=p.locator('#ai_batches_list [data-batch-id="a"]');
        await cardA.getByRole('button',{name:'Edit',exact:true}).click();
        await cardA.locator('input[type="text"]').first().fill('Independent unsaved title');
        await cardA.locator('.ai-item-checkbox').uncheck();
        await p.locator('#ai_batches_list [data-batch-id="b"]').getByRole('button',{name:'Accept',exact:true}).click();
        await p.waitForFunction(()=>document.querySelector('#ai_batches_list [data-batch-id="b"]')?.textContent.includes('Undo'));
        assert(await cardA.locator('input[type="text"]').count()>0,'independent proposal editor must remain mounted after another batch acceptance');
        assert(await cardA.locator('input[type="text"]').first().inputValue()==='Independent unsaved title','independent proposal draft must survive');
        await p.locator('#ai_drafts_toggle_btn').click();await p.locator('#ai_drafts_toggle_btn').click();
        assert(await cardA.locator('input[type="text"]').first().inputValue()==='Independent unsaved title','panel toggling preserves edits');
        for(const action of ['Undo','Reapply']){
            await p.locator('#ai_batches_list [data-batch-id="b"]').getByRole('button',{name:action,exact:true}).click();
            await p.locator('#ai_batches_list [data-batch-id="b"]').getByRole('button',{name:action==='Undo'?'Reapply':'Undo',exact:true}).waitFor();
            assert(await cardA.locator('input[type="text"]').first().inputValue()==='Independent unsaved title','independent A survives '+action);
        }
        // Acknowledged write followed by failed card GET must not replay the write.
        failB=true;await p.locator('#ai_batches_list [data-batch-id="b"]').getByRole('button',{name:'Undo',exact:true}).click();
        await p.waitForFunction(()=>document.querySelector('#ai_batches_list [data-batch-id="b"]')?.textContent.includes('Undo'));
        await p.waitForTimeout(150);failB=false;
        await cardA.getByRole('button',{name:'Cancel',exact:true}).click();await p.locator('#ai_batches_refresh_btn').click();
        await p.locator('#ai_batches_list [data-batch-id="b"]').getByRole('button',{name:'Reapply',exact:true}).waitFor();
        assert(actions.join(',')==='accept,undo,reapply,undo','refresh recovery never repeats acknowledged action');
        assert(!await cardA.locator('.ai-item-checkbox').isChecked(),'selection survives panel toggles and read recovery');
        return {selectionRetained:true,independentDraft:true,panelRetention:true,undoReapply:true,savedReadFailureRecovery:true,actions};
    }finally{await context.close();}
}
