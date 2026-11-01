/* Manual drawer drafts via fake conversation/detail/PATCH/SSE HTTP boundaries, never inference. */
async (page, baseURL) => {
    const context=await page.context().browser().newContext(),p=await context.newPage();
    const dialogs=[],writes=[],errors=[],results=[];
    let failPatch=true, title='Synthetic proposed task',holdSend=false,releaseSend,sendStarted;
    const held=new Promise(r=>releaseSend=r),started=new Promise(r=>sendStarted=r);
    p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});p.on('pageerror',e=>errors.push(e.message));
    const proposal={id:'synthetic-standing',status:'pending',proposed_instruction:'Original standing proposal'};
    const batch=()=>({id:'synthetic-batch',status:'pending',summary:'Synthetic draft fixture',items:[{id:'synthetic-item',status:'pending',op:'create_task',entity_type:'task',proposed:{title},baseline:{}}]});
    const departure=async()=>{const before=dialogs.length,count=writes.length;await p.getByRole('link',{name:'Settings',exact:true}).dispatchEvent('click');if(dialogs.length!==before+1 || !p.url().endsWith('/tasks') || writes.length!==count) throw Error('Drawer draft left or auto-wrote');};
    try {
        await context.route('**/api/ai/providers/catalog',r=>r.fulfill({json:{}}));
        await context.route('**/api/ai/conversations',r=>r.fulfill({json:[{id:'synthetic-conversation',title:'Synthetic drawer fixture'}]}));
        await context.route('**/api/ai/conversations/synthetic-conversation',r=>r.fulfill({json:{messages:[{role:'assistant',content:'Synthetic draft fixture',draft_batch_id:'synthetic-batch'}],instruction_proposals:[proposal]}}));
        await context.route('**/api/ai/drafts/batches/synthetic-batch',r=>r.fulfill({json:batch()}));
        await context.route('**/api/ai/drafts/items/synthetic-item',r=>{
            if(failPatch) return r.fulfill({status:503,json:{detail:'Synthetic PATCH failure'}});
            title=r.request().postDataJSON().proposed.title;return r.fulfill({json:{}});
        });
        await context.route('**/api/ai/conversations/synthetic-conversation/messages',async r=>{
            sendStarted();if(holdSend) await held;
            await r.fulfill({status:503,json:{detail:'Synthetic stream failure; no provider call'}});
        });
        await p.goto(`${baseURL}/tasks`);
        await p.getByRole('button',{name:'Assistant',exact:true}).click();
        await p.locator('.ai-instruction-proposal-editor').fill('Changed standing proposal');await p.locator('#ai_drawer_close_btn').click();await departure();
        await p.getByRole('button',{name:'Assistant',exact:true}).click();await p.locator('.ai-instruction-proposal-editor').fill(proposal.proposed_instruction);
        await p.locator('.ai-draft-item').getByRole('button',{name:'Edit',exact:true}).click();
        const editor=p.locator('.ai-inline-edit-box'), input=editor.locator('input').first();
        await input.fill('Changed inline task proposal');await p.locator('#ai_drawer_close_btn').click();await departure();
        p.on('request',r=>{if(r.method()!=='GET') writes.push(r.url());});
        await p.getByRole('button',{name:'Assistant',exact:true}).click();
        await editor.getByRole('button',{name:'Save',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.ai-inline-edit-box').textContent.includes('Save failed:'));
        await p.locator('#ai_drawer_close_btn').click();await departure();
        failPatch=false;await p.getByRole('button',{name:'Assistant',exact:true}).click();
        await editor.getByRole('button',{name:'Save',exact:true}).click();await editor.waitFor({state:'detached'});
        await p.locator('#ai_drawer_close_btn').click();
        const count=dialogs.length;await p.getByRole('link',{name:'Settings',exact:true}).click();await p.waitForURL('**/settings/ai');if(dialogs.length!==count) throw Error('Successful PATCH still dirty');
        results.push('Standing proposal/inline draft stay guarded after drawer closure; failed PATCH dirty; successful PATCH clean');
        await p.goto(`${baseURL}/tasks`);await p.getByRole('button',{name:'Assistant',exact:true}).click();await p.locator('.ai-instruction-proposal-editor').waitFor();
        await p.locator('#ai_composer_input').fill('Unsent synthetic message');await p.locator('#ai_drawer_close_btn').click();await departure();
        await p.getByRole('button',{name:'Assistant',exact:true}).click();holdSend=true;
        await p.locator('#ai_composer_input').press('Enter');await started;
        await p.locator('#ai_composer_input').fill('New composer draft while send held');releaseSend();
        await p.waitForFunction(()=>!aiStreamInFlight);
        if(await p.locator('#ai_composer_input').inputValue()!=='New composer draft while send held') throw Error('Concurrent composer text lost');
        await p.locator('#ai_drawer_close_btn').click();await departure();
        await p.getByRole('button',{name:'Assistant',exact:true}).click();await p.locator('#ai_composer_input').fill('Failed synthetic send restored');
        await p.locator('#ai_composer_input').press('Enter');await p.waitForFunction(()=>!aiStreamInFlight && document.getElementById('ai_composer_input').value==='Failed synthetic send restored');
        await p.locator('#ai_drawer_close_btn').click();await departure();
        results.push('Composer unsent/closed/failed stream/concurrently typed message protected');
        if(errors.length) throw Error(errors.join('; '));
        return {results,dialogs,writes,errors,fakes:['conversation/detail/proposal/batch/PATCH and two HTTP 503 message streams; zero inference']};
    } finally {releaseSend();await context.close();}
};
