async (page, baseURL) => {
    const context=await page.context().browser().newContext(),p=await context.newPage();
    const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
    const results=[];
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    await context.route('**/api/ai/conversations',r=>r.fulfill({json:[]}));
    try{
        for(const [path,id,open] of [['/dashboard','custom_filter_modal','openCustomFilterModal()'],['/dashboard','export_modal','openExportModal()'],['/dashboard','task_modal','openNewTaskModal()'],['/revision','rating_def_modal','openNewRatingDefModal()'],['/stats','widget_builder_modal','openWidgetBuilder()']]){
            await p.goto(baseURL+path);await p.locator('#ai_launcher_btn').click();
            if(id==='export_modal')await p.locator('#ai_fullscreen_toggle_btn').click();
            await p.evaluate(code=>eval(code),open);await p.locator('#'+id).waitFor({state:'visible'});
            await p.keyboard.press('Escape');await p.locator('#'+id).waitFor({state:'hidden'});
            assert(await p.evaluate(()=>isAiDrawerOpen()),id+' Escape keeps drawer');
            await p.keyboard.press('Escape');assert(!await p.evaluate(()=>isAiDrawerOpen()),'next Escape closes drawer '+id);
            results.push(id);
        }
        await p.goto(baseURL+'/dashboard');await p.locator('#ai_launcher_btn').click();
        await p.evaluate(()=>{window.confirmResult=null;showCustomConfirm('Synthetic confirmation','Cancel must not write').then(result=>window.confirmResult=result);});
        await p.locator('#custom_confirm_modal').waitFor({state:'visible'});await p.keyboard.press('Escape');
        assert(await p.evaluate(()=>confirmResult===false && isAiDrawerOpen()),'custom confirmation cancels and keeps drawer');
        // Genuine pointer drag, followed by keyboard resize, on the actual handle.
        await p.locator('#ai_drawer').evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished));});
        const handle=p.locator('#ai_drawer_resize_handle');const box=await handle.boundingBox();
        await p.mouse.move(box.x+box.width/2,box.y+100);await p.mouse.down();await p.mouse.move(box.x-48,box.y+100);await p.mouse.up();
        const stored=await p.evaluate(()=>localStorage.getItem('tt_ai_drawer_width_px'));
        assert(Number(stored)>0,'pointer resize persists width');
        await handle.focus();await handle.press('ArrowRight');
        assert(await handle.getAttribute('aria-valuenow')!==null,'keyboard resize announces width');
        return {dialogPrecedence:results,customConfirmCanceled:true,pointerResize:true,keyboardResize:true};
    }finally{await context.close();}
}
