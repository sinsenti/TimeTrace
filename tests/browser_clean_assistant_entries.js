async (page, baseURL) => {
    const context=await page.context().browser().newContext({viewport:{width:390,height:844}}),p=await context.newPage();
    const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    const task=await(await context.request.post(baseURL+'/api/tasks',{data:{title:'Synthetic Assistant entry'}})).json();
    const paths=['/dashboard','/tasks','/kanban','/tasks-view','/stats','/habits-view','/revision','/settings/ai','/task-inspector/'+task.id,'/tasks-detail/'+task.id];
    const results=[];let conversations=[{id:'old',title:'Original'}],failList=false,writes=[];
    await context.route('**/api/ai/conversations',r=>{
        if(r.request().method()==='GET')return failList?r.fulfill({status:503,json:{detail:'Synthetic history unavailable'}}):r.fulfill({json:conversations});
        writes.push(r.request().method());conversations=[{id:'new',title:'New conversation'},...conversations];return r.fulfill({json:conversations[0]});
    });
    await context.route('**/api/ai/conversations/*',r=>{
        const id=r.request().url().split('/').pop();
        if(r.request().method()==='DELETE'){writes.push('DELETE');conversations=conversations.filter(c=>c.id!==id);return r.fulfill({status:204});}
        if(r.request().method()==='PATCH'){writes.push('PATCH');const c=conversations.find(c=>c.id===id);c.title=r.request().postDataJSON().title;return r.fulfill({json:c});}
        return r.fulfill({json:{messages:[],instruction_proposals:[]}});
    });
    try{
        for(const path of paths){
            await p.goto(baseURL+path);await p.locator('#ai_launcher_btn').waitFor();
            assert(await p.locator('#ai_drawer').getAttribute('inert')!==null,'closed-first '+path);
            await p.locator('#ai_launcher_btn').click();await p.locator('#ai_composer_input').waitFor({state:'visible'});
            await p.locator('#ai_composer_input').fill('Retained unsent <literal>');
            await p.locator('#ai_drawer_close_btn').click();await p.locator('#ai_launcher_btn').click();
            assert(await p.locator('#ai_composer_input').inputValue()==='Retained unsent <literal>','close keeps composer '+path);
            assert(await p.locator('#ai_drawer a[href="/settings/ai"]').count()===1,'current Settings link '+path);
            results.push({path,closedFirst:true,retainedComposer:true});
            await p.locator('#ai_composer_input').fill('');
        }
        await p.goto(baseURL+'/dashboard');await p.locator('#ai_launcher_btn').click();await p.locator('#ai_new_conversation_btn').click();
        await p.waitForFunction(()=>aiCurrentConversationId==='new');
        await p.locator('#ai_history_toggle_btn').click();
        p.once('dialog',d=>d.accept('<literal renamed>'));await p.locator('#ai_rename_conversation_btn').click();
        assert(await p.locator('#ai_conversation_select option:checked').innerText()==='<literal renamed>','rename is literal');
        p.once('dialog',d=>d.accept());await p.locator('#ai_delete_conversation_btn').click();await p.waitForFunction(()=>aiCurrentConversationId==='old');
        assert(writes.join(',')==='POST,PATCH,DELETE','conversation mutations exactly once');
        failList=true;writes=[];await p.reload();await p.locator('#ai_launcher_btn').click();
        await p.waitForFunction(()=>document.getElementById('ai_assistant_notice').textContent.includes('Could not load'));
        await p.locator('#ai_composer_input').fill('Keep on failed history');await p.locator('#ai_composer_input').press('Enter');await p.waitForFunction(()=>!aiStreamInFlight);
        assert(writes.length===0,'failed list never fabricates a new conversation');
        assert(await p.locator('#ai_composer_input').inputValue()==='Keep on failed history','failed list retains composer');
        return {results,conversationCRUD:true,failedListNoWrites:true};
    }finally{await context.request.delete(baseURL+'/api/tasks/'+task.id);await context.close();}
}
