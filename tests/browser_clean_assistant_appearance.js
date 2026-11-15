async (page, baseURL) => {
    const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
    const results=[];
    const batch={id:'appearance-batch',status:'pending',summary:'Proposed task <literal> '+ 'long '.repeat(35),items:[{id:'item-appearance',status:'pending',entity_type:'task',op:'create',ui_kind:'add',proposed:{title:'Long <literal> task',tags:'synthetic'},rationale:'A reason',display_title:'Long <literal> task'}]};
    const proposal={id:'appearance-instruction',status:'pending',before_instructions:'Existing instructions',proposed_instruction:'Proposed <literal> instruction',after_instructions:'Resulting instructions'};
    function inspect(){
        const root=document.querySelector('#ai_drawer_chat_column');
        const rgb=s=>{const m=s.match(/[\d.]+/g);return m ? m.map(Number):[0,0,0,0];};
        const over=(front,back)=>{const a=front[3]??1;return [0,1,2].map(i=>front[i]*a+back[i]*(1-a)).concat(1);};
        function background(el){const layers=[];for(let n=el;n;n=n.parentElement)layers.unshift(rgb(getComputedStyle(n).backgroundColor));return layers.reduce((b,f)=>over(f,b),[255,255,255,1]);}
        const lum=color=>color.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
        const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
        const samples=[],failures=[];
        for(const el of root.querySelectorAll('*')){
            const style=getComputedStyle(el),r=el.getBoundingClientRect();
            if(!r.width||!r.height||style.visibility==='hidden'||el.closest('.hidden'))continue;
            const text=[...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim());
            if(!text && !el.matches('input,textarea,select'))continue;
            const bg=background(el),fg=over(rgb(style.color),bg),ratio=contrast(fg,bg);
            const threshold=parseFloat(style.fontSize)>=24 || parseFloat(style.fontSize)>=18.66 && Number(style.fontWeight)>=700 ? 3:4.5;
            const sample={selector:el.id?'#'+el.id:'.'+String(el.className).split(' ').join('.'),ratio,threshold,disabled:el.disabled===true};samples.push(sample);
            if(ratio<threshold)failures.push(sample);
            if(el.matches('input,textarea') && el.placeholder){const color=over(rgb(getComputedStyle(el,'::placeholder').color),bg),placeholderRatio=contrast(color,bg);if(placeholderRatio<4.5)failures.push({selector:sample.selector+'::placeholder',ratio:placeholderRatio,threshold:4.5});}
        }
        return {samples,failures,overflow:root.scrollWidth>root.clientWidth+1,width:root.getBoundingClientRect().width};
    }
    for(const theme of ['refined','stone','porcelain','dark'])for(const width of [390,768,1024,1440]){
        const context=await page.context().browser().newContext({viewport:{width,height:900}}),p=await context.newPage();
        await context.addInitScript(theme=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false,appearance:theme==='dark'?'dark':'light',lightTheme:theme==='dark'?'refined':theme})),theme);
        await context.route('**/api/ai/conversations',r=>r.fulfill({json:[{id:'appearance',title:'<literal title>'}]}));
        await context.route('**/api/ai/conversations/appearance',r=>r.fulfill({json:{messages:[{role:'user',content:'A user message'},{role:'assistant',content:'Assistant <literal> text',draft_batch_id:batch.id}],instruction_proposals:[proposal]}}));
        await context.route('**/api/ai/drafts/batches/appearance-batch',r=>r.fulfill({json:batch}));
        await context.route('**/api/ai/drafts/batches?limit=50',r=>r.fulfill({json:[batch]}));
        await context.route('**/api/ai/insights/weekly-review/current?*',r=>r.fulfill({json:{start_date:'2026-11-02',end_date:'2026-11-08',timezone:'UTC',logged_total:{total:2},session_count:{total:2},logged_by_day:{rows:[{labels:['Monday'],value:2}]},logged_by_tag:{rows:[{labels:['<literal tag>'],value:2}],meta:{totals_overlap:true}}}}));
        try{
            await p.goto(baseURL+'/dashboard');await p.locator('#ai_launcher_btn').click();await p.locator('.ai-instruction-proposal').waitFor();
            await p.locator('[data-batch-id="appearance-batch"]').getByRole('button',{name:'Edit',exact:true}).click();
            await p.waitForTimeout(220);
            const chat=await p.evaluate(inspect);
            let releasePending, entered;
            const started=new Promise(resolve=>entered=resolve);
            await context.route('**/api/ai/conversations/*/messages',async route=>{
                entered();await new Promise(resolve=>releasePending=resolve);
                return route.fulfill({contentType:'text/event-stream',body:'event: message_start\ndata: {}\n\nevent: token\ndata: {"text":"Partial response"}\n\nevent: error\ndata: {"message":"Synthetic provider error"}\n\n'});
            });
            await p.locator('#ai_composer_input').fill('Error-state sample');await p.locator('#ai_composer_input').press('Enter');await started;
            const pending=await p.evaluate(inspect);releasePending();await p.waitForFunction(()=>!aiStreamInFlight);
            const error=await p.evaluate(inspect);
            await p.locator('#ai_history_toggle_btn').click();const history=await p.evaluate(inspect);await p.locator('#ai_history_toggle_btn').click();
            await p.locator('#ai_insights_toggle_btn').click();await p.locator('#ai_action_weekly_review').click();await p.locator('.ai-weekly-review-card').waitFor();
            const insights=await p.evaluate(inspect);
            await p.locator('#ai_insights_toggle_btn').click();
            await p.locator('#ai_fullscreen_toggle_btn').click();await p.waitForTimeout(100);
            const fullscreen=await p.evaluate(inspect);
            const geometry=await p.evaluate(()=>{const d=document.querySelector('#ai_drawer').getBoundingClientRect(),c=document.querySelector('#ai_drawer_calendar_pane').getBoundingClientRect();return {drawer:{left:d.left,right:d.right,bottom:d.bottom},calendar:{width:c.width,height:c.height},viewport:{width:innerWidth,height:innerHeight}};});
            const failures=[...chat.failures,...pending.failures,...error.failures,...history.failures,...insights.failures,...fullscreen.failures];
            results.push({theme,width,failures,minimum:Math.min(...[chat,pending,error,history,insights,fullscreen].flatMap(x=>x.samples.map(s=>s.ratio))),samples:[chat.samples.length,pending.samples.length,error.samples.length,history.samples.length,insights.samples.length,fullscreen.samples.length],overflow:[chat,history,insights,fullscreen].some(x=>x.overflow),geometry});
            await p.locator('#ai_fullscreen_toggle_btn').click();
            const handle=p.locator('#ai_drawer_resize_handle');await handle.focus();const before=await p.locator('#ai_drawer').evaluate(el=>el.getBoundingClientRect().width);await handle.press('ArrowLeft');const after=await p.locator('#ai_drawer').evaluate(el=>el.getBoundingClientRect().width);assert(after>=before,'keyboard resize grows or clamps');
        }finally{await context.close();}
    }
    // Return all measured failures rather than blanket-waiving any palette.
    return {results,passed:results.every(r=>!r.failures.length&&!r.overflow&&r.geometry.calendar.width>0&&r.geometry.calendar.height>0)};
}
