async (page, baseURL) => {
    const assert = (condition, message) => {if (!condition) throw Error(message);};
    const context = await page.context().browser().newContext({viewport:{width:1440,height:900}});
    await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false})));
    await context.route('**/api/ai/conversations', route => route.fulfill({json:[{id:'conversation-a',title:'<literal conversation>'},{id:'conversation-b',title:'Other'}]}));
    await context.route('**/api/ai/conversations/conversation-a', route => route.fulfill({json:{messages:[],instruction_proposals:[]}}));
    const p = await context.newPage();
    try {
        await p.goto(baseURL+'/dashboard');
        assert(await p.locator('#ai_drawer').getAttribute('inert') !== null, 'closed drawer must be inert');
        await p.locator('#ai_launcher_btn').click();
        await p.locator('#ai_composer_input').waitFor({state:'visible'});
        assert(!await p.locator('#ai_conversation_select').isVisible(), 'history must be on demand');
        assert(!await p.locator('#ai_quick_actions').isVisible(), 'insights and presets must be on demand');
        await p.locator('#ai_history_toggle_btn').click();
        assert(await p.locator('#ai_conversation_select').isVisible(), 'history available');
        assert(await p.locator('#ai_delete_conversation_btn').isVisible(), 'delete available');
        await p.locator('#ai_history_toggle_btn').click();
        const input=p.locator('#ai_composer_input');
        await input.fill('first'); await input.press('Shift+Enter'); await input.press('x');
        assert(await input.inputValue()==='first\nx','Shift Enter inserts newline');
        let sent;
        await context.route('**/api/ai/conversations/*/messages', async route => {
            sent=route.request().postDataJSON();
            await route.fulfill({contentType:'text/event-stream',body:'event: message_start\ndata: {}\n\nevent: token\ndata: {"text":"<img src=x onerror=alert(1)>"}\n\nevent: message_end\ndata: {"content":"<img src=x onerror=alert(1)>"}\n\n'});
        });
        await input.press('Enter');
        await p.waitForFunction(() => !aiStreamInFlight);
        assert(sent.text==='first\nx','Enter sends actual composer');
        assert(await p.locator('#ai_thread img').count()===0,'model text inert');
        assert(await input.inputValue()==='','successful send consumes submitted input');
        await input.fill('button send'); await p.locator('#ai_composer_send').click();
        await p.waitForFunction(() => !aiStreamInFlight);
        assert(sent.text==='button send','button does not send MouseEvent');
        await p.evaluate(() => {window.originalCalendar=document.getElementById('calendar'); window.originalParent=originalCalendar.parentNode; window.originalDate=calendar.getDate().getTime(); window.originalView=calendar.view.type; window.originalControls=[...document.querySelectorAll('.planning-header > .calendar-tools, .planning-header > .calendar-panel-controls, .planning-header > #breakdown_filter_chip')].map(node=>({node,parent:node.parentNode,next:node.nextSibling}));});
        await p.locator('#ai_fullscreen_toggle_btn').click();
        assert(await p.evaluate(() => originalCalendar===document.querySelector('#ai_drawer_calendar_pane #calendar')), 'fullscreen uses real Calendar node');
        assert(await p.locator('#ai_drawer_calendar_pane #btn_view_day').isVisible(), 'real Calendar view toolbar must remain usable in fullscreen');
        await p.locator('#ai_drawer_calendar_pane #btn_view_day').click();
        assert(await p.evaluate(() => calendar.view.type==='timeGridDay'), 'real toolbar changes existing Calendar view');
        await p.locator('#ai_drawer_calendar_pane button[title="Next"]').click();
        assert(await p.evaluate(() => calendar.getDate().getTime()!==originalDate), 'real toolbar changes date');
        await p.locator('#ai_drawer_calendar_pane button').filter({hasText:'+ Session'}).click();
        await p.locator('#session_modal').waitFor({state:'visible'});
        await p.keyboard.press('Escape');
        assert(await p.locator('#session_modal').evaluate(el=>el.classList.contains('hidden')), 'Escape closes Session first');
        assert(await p.evaluate(()=>isAiDrawerOpen() && isAiFullscreenActive() && originalCalendar.parentNode.id==='ai_drawer_calendar_pane'), 'Escape retains Assistant and Calendar');
        await p.evaluate(() => {window.originalDate=calendar.getDate().getTime();window.originalView=calendar.view.type;});
        await p.keyboard.press('Escape');
        assert(await p.evaluate(() => originalControls.every(({node,parent,next})=>node.parentNode===parent && node.nextSibling===next)), 'toolbar and filter chip exact parents and sibling order restored');
        assert(await p.evaluate(() => originalCalendar.parentNode===originalParent && calendar.getDate().getTime()===originalDate && calendar.view.type===originalView), 'Calendar restored with view/date');
        assert(await p.locator('#ai_launcher_btn').evaluate(el=>el===document.activeElement),'close restores focus');
        return {chatFirst:true,enter:true,inertText:true,calendarIdentity:true};
    } finally {await context.close();}
}
