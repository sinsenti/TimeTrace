/* Compatibility gate: old dd13994 shared utils Escape fails; must rerun after reviewed ticket02 FF. */
async (page, baseURL) => {
    const context=await page.context().browser().newContext();
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    await context.route('**/api/ai/providers/catalog',r=>r.fulfill({json:{}}));
    const p=await context.newPage(),writes=[],errors=[],checks=[];let habit;
    p.on('request',r=>{if(r.method()==='DELETE')writes.push(r.url());});p.on('pageerror',e=>errors.push(e.message));
    const assert=(ok,msg)=>{if(!ok)throw Error(msg);checks.push(msg);};
    try {
        habit=await(await context.request.post(`${baseURL}/habits`,{data:{name:'Confirmation ownership'}})).json();
        await p.goto(`${baseURL}/habits-view`);
        await p.locator(`[data-habit-id="${habit.id}"]`).getByRole('button',{name:'Edit definition',exact:true}).click();
        await p.locator('#modal_habit_name').fill('Unsaved confirmation draft');
        await p.locator('#modal_habit_delete_btn').click();await p.locator('#custom_confirm_modal').waitFor({state:'visible'});
        await p.keyboard.press('Escape');
        assert(await p.locator('#habit_modal').isVisible(),'Escape retains underlying definition editor');
        assert(!(await p.locator('#custom_confirm_modal').isVisible()),'Escape dismisses confirmation only');
        assert(await p.locator('#modal_habit_name').inputValue()==='Unsaved confirmation draft','Escape retains definition draft');
        assert(await p.evaluate(()=>!habitDefinitionOwner.pending),'Escape resolves pending Delete false');
        assert(await p.evaluate(()=>document.activeElement.id==='modal_habit_delete_btn'),'Escape preserves Delete launcher focus');
        assert(writes.length===0,'Escape zero DELETE');
        await p.locator('#modal_habit_delete_btn').click();await p.locator('#confirm_modal_proceed_btn').click();
        await p.waitForFunction(()=>document.getElementById('habit_modal').classList.contains('hidden'));
        assert(!(await(await context.request.get(`${baseURL}/habits`)).json()).some(h=>h.id===habit.id),'subsequent explicit confirmed deletion works');
        assert(writes.length===1&&errors.length===0,'one DELETE and no pageerrors');
        return {checks,writes,errors,fakes:['provider catalog'],dependency:'reviewed ticket02 shared utils Escape deferral'};
    } finally {if(habit)await context.request.delete(`${baseURL}/habits/${habit.id}`);await context.close();}
};
