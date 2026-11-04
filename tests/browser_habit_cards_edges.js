/* Native keyboard and retained-hidden owner regression. Public APIs real except bounded held/error reads/writes. */
async (page, baseURL) => {
    const context=await page.context().browser().newContext({viewport:{width:768,height:900}});
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    await context.route('**/api/ai/providers/catalog',r=>r.fulfill({json:{}}));
    const p=await context.newPage(),errors=[],checks=[],writes=[],ids=[];
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
    let dialogs=0;p.on('dialog',async d=>{dialogs++;await d.dismiss();});
    const assert=(ok,msg)=>{if(!ok)throw Error(msg);checks.push(msg);};
    const settle=()=>p.waitForFunction(()=>![...habitEntryDrafts.values()].some(d=>d.pending));
    try {
        const a=await(await context.request.post(`${baseURL}/habits`,{data:{name:'Keyboard decimal A',habit_type:'numeric',target_value:5,color:'#abc'}})).json();ids.push(a.id);
        await p.goto(`${baseURL}/habits-view`);const card=p.locator(`[data-habit-id="${a.id}"]`);await card.waitFor();
        await card.getByRole('spinbutton').fill('');await card.getByRole('spinbutton').pressSequentially('1.5');
        assert(await card.getByRole('spinbutton').inputValue()==='1.5','native keyboard decimal remains editable');
        // Hidden date draft must remain registered with shared Settings ownership.
        await card.getByRole('button',{name:'Previous week',exact:true}).click();
        await p.locator('#tab_btn_reminders').click();
        const count=writes.length;await p.getByRole('link',{name:'Settings',exact:true}).dispatchEvent('click');
        assert(dialogs===1&&writes.length===count,'offscreen date owner warns without writes');
        await p.locator('#tab_btn_matrix').click();await card.getByRole('button',{name:'Today',exact:true}).click();
        assert(await card.getByRole('spinbutton').inputValue()==='1.5','hidden decimal draft restored');
        await card.getByRole('spinbutton').press('Control+Enter');await settle();
        const history=(await(await context.request.get(`${baseURL}/habits/${a.id}/stats`)).json()).history;
        assert(history.some(l=>l.value===1.5),'Ctrl+Enter real decimal write');
        await card.getByRole('spinbutton').fill('9');await card.getByRole('spinbutton').press('Escape');
        assert(await card.getByRole('spinbutton').inputValue()==='1.5','Escape cancels without save');
        // Definition create/edit/cancel/delete through real controls.
        await p.getByRole('button',{name:'+ New Habit',exact:true}).click();
        await p.locator('#habit_modal button[onclick="saveHabit()"]').focus();await p.keyboard.press('Tab');
        assert(await p.evaluate(()=>document.getElementById('habit_modal').contains(document.activeElement)),'definition Tab focus stays inside modal');
        await p.locator('#modal_habit_name').fill('UI created definition');await p.locator('#habit_modal button[onclick="saveHabit()"] ').click();
        await p.locator('#habit_modal').waitFor({state:'hidden'});
        const created=(await(await context.request.get(`${baseURL}/habits`)).json()).find(h=>h.name==='UI created definition');ids.push(created.id);
        const made=p.locator(`[data-habit-id="${created.id}"]`);await made.waitFor();
        await made.getByRole('button',{name:'Edit definition',exact:true}).click();await p.locator('#modal_habit_name').fill('Canceled rename');
        await p.locator('#modal_habit_name').press('Escape');
        assert((await(await context.request.get(`${baseURL}/habits`)).json()).find(h=>h.id===created.id).name==='UI created definition','definition Cancel retains stored name');
        await made.getByRole('button',{name:'Edit definition',exact:true}).click();await p.locator('#modal_habit_delete_btn').click();
        await p.locator('#confirm_modal_cancel_btn').click();
        assert(await p.locator('#habit_modal').isVisible(),'definition delete cancel retains editor');
        await p.locator('#modal_habit_delete_btn').click();await p.locator('#confirm_modal_proceed_btn').click();
        await made.waitFor({state:'detached'});
        assert(await p.evaluate(()=>document.activeElement.tagName==='BUTTON'&&document.activeElement.textContent.trim()==='+ New Habit'),'definition deletion restores reachable New Habit focus');
        assert(!(await(await context.request.get(`${baseURL}/habits`)).json()).some(h=>h.id===created.id),'definition deletion real API readback');
        await card.getByRole('button',{name:'Edit definition',exact:true}).click();
        await p.locator('#modal_habit_name').fill('Rename only, retained metadata');
        await p.locator('#habit_modal button[onclick="saveHabit()"]').click();await p.locator('#habit_modal').waitFor({state:'hidden'});
        const renamed=(await(await context.request.get(`${baseURL}/habits`)).json()).find(h=>h.id===a.id);
        assert(renamed.color==='#abc'&&renamed.reminder_time===null,'rename preserves original short-hex color and null reminder');
        // Initial failure and held retry: Save is not available until first successful load.
        await context.route('**/habits',r=>r.fulfill({status:503,json:{detail:'Synthetic initial list failure'}}));
        await p.reload();await p.locator('#habit_retry_load').waitFor({state:'visible'});
        assert(await p.locator('.habit-compact-card').count()===0,'failed initial load has no editable unknown rows');
        await context.unroute('**/habits');
        let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
        await context.route('**/habits',async r=>{entered();await held;await r.continue();});
        await p.locator('#habit_retry_load').click();await started;
        assert((await p.locator('#habit_load_status').textContent()).includes('Loading'),'loading state visible during held retry');
        release();await card.waitFor();await context.unroute('**/habits');
        assert(errors.length===0,'no edge workflow pageerrors');
        return {checks,errors,writes,fakes:['provider catalog','initial list 503','held real retry'],limits:['no other engines/physical touch/screen reader certification']};
    } finally {for(const id of ids)await context.request.delete(`${baseURL}/habits/${id}`);await context.close();}
};
