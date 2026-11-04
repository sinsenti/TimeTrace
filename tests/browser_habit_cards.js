/* Native UI + real habit API/readbacks; only deliberate failure/held HTTP and provider catalog are faked. */
async (page, baseURL) => {
    const context=await page.context().browser().newContext({timezoneId:'Pacific/Kiritimati',viewport:{width:1024,height:900}});
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    const p=await context.newPage(), errors=[], writes=[], fixtures=[], checks=[];
    const assert=(ok,message)=>{if(!ok) throw Error(message);checks.push(message);};
    p.on('pageerror',e=>errors.push(e.message));
    p.on('request',r=>{if(['POST','PUT','DELETE','PATCH'].includes(r.method())) writes.push({url:r.url(),body:r.postData()});});
    let dialogs=0;
    p.on('dialog',async d=>{dialogs++;await d.dismiss();});
    const create=async data=>{const r=await context.request.post(`${baseURL}/habits`,{data});if(!r.ok())throw Error(`fixture ${r.status()}`);const h=await r.json();fixtures.push(h);return h;};
    const read=async id=>(await(await context.request.get(`${baseURL}/habits/${id}/stats`)).json());
    const card=id=>p.locator(`[data-habit-id="${id}"]`);
    const settled=async()=>p.waitForFunction(()=>![...habitEntryDrafts.values()].some(d=>d.pending));
    try {
        await context.route('**/api/ai/providers/catalog',r=>r.fulfill({json:{}}));
        // Start on genuinely empty scratch storage.
        await p.goto(`${baseURL}/habits-view`);
        await p.getByText('No habits yet. Choose + New Habit to start.',{exact:true}).waitFor();
        const a=await create({name:'Numeric <img src=x onerror="window.habitXss=1"> '+ 'long '.repeat(15),habit_type:'numeric',target_value:0,unit:'pages <b>literal</b>',frequency:'Custom cadence',reminder_time:'Custom reminder',color:'#ffffff'});
        const b=await create({name:'Checkmark B',habit_type:'boolean'});
        await p.reload();await card(a.id).waitFor();
        const date=await p.evaluate(()=>habitLocalDate());
        assert(date===await p.evaluate(()=>new Intl.DateTimeFormat('en-CA').format(new Date())),'browser-local date, nonUTC context');
        assert(await p.evaluate(()=>!window.habitXss),'untrusted name/unit inert');
        let count=writes.length;
        await card(a.id).getByRole('spinbutton').fill('3');
        assert(writes.length===count,'typing zero POSTs');
        await card(a.id).getByRole('button',{name:'Cancel',exact:true}).click();
        assert(writes.length===count,'Cancel zero POSTs');
        await card(a.id).getByRole('spinbutton').fill('-3');
        await card(a.id).getByText('Negative amounts are clamped to zero.',{exact:true}).waitFor();
        assert(await card(a.id).getByRole('spinbutton').inputValue()==='0','visible negative clamp');
        await card(a.id).getByRole('button',{name:'Save',exact:true}).click();await settled();
        let stats=await read(a.id);
        assert(stats.history.some(l=>l.date===date&&l.value===0&&l.status==='pending'),'real POST numeric zero persists Pending at zero target');
        assert((await read(b.id)).summary.total_logs===0,'other habit unchanged');
        assert(writes.length===count+1,'explicit Save one POST');
        // Date/week navigation retains independent owners and does not write.
        await card(a.id).getByRole('spinbutton').fill('7');
        await card(b.id).getByRole('button',{name:'Failed',exact:true}).click();
        const bDate=await card(b.id).locator('time').getAttribute('datetime'); count=writes.length;
        await card(a.id).getByRole('button',{name:'Previous week',exact:true}).click();
        assert(await card(b.id).locator('time').getAttribute('datetime')===bDate,'B navigation independent');
        await p.locator('#tab_btn_reminders').click();await p.locator('#tab_btn_matrix').click();
        await card(a.id).getByRole('button',{name:'Today',exact:true}).click();
        assert(await card(a.id).getByRole('spinbutton').inputValue()==='7','date/view navigation retains A draft');
        await p.evaluate(()=>setAppearancePreference('appearance','dark'));
        assert(await card(a.id).getByRole('spinbutton').inputValue()==='7','theme retains draft');
        await p.getByRole('link',{name:'Settings',exact:true}).dispatchEvent('click');
        assert(dialogs===1&&p.url().endsWith('/habits-view'),'Settings warns and canceled departure retains hidden/visible drafts');
        assert(writes.length===count,'navigation/theme/Settings zero writes');
        await card(a.id).getByRole('button',{name:'Cancel',exact:true}).click();
        await card(b.id).getByRole('button',{name:'Save',exact:true}).click();await settled();
        assert((await read(b.id)).history.some(l=>l.status==='failed'),'explicit Failed choice saved');
        for(const [choice,status] of [['Done','completed'],['Skipped','skipped']]) {
            await card(b.id).getByRole('button',{name:choice,exact:true}).click();
            await card(b.id).getByRole('button',{name:'Save',exact:true}).click();await settled();
            const result=await read(b.id);assert(result.summary.total_logs===1&&result.history[0].status===status,`${choice} sequential upsert one row`);
        }
        // Confirm cancel versus actual selected-date Clear.
        count=writes.length;
        await card(a.id).getByRole('button',{name:'Clear',exact:true}).click();
        await p.locator('#confirm_modal_cancel_btn').click();await settled();
        assert(writes.length===count,'Clear confirmation cancel zero POSTs');
        await card(a.id).getByRole('button',{name:'Clear',exact:true}).click();
        await p.locator('#confirm_modal_proceed_btn').click();await settled();
        assert(!(await read(a.id)).history.some(l=>l.date===date),'Clear erases only selected day');
        assert((await read(b.id)).summary.total_logs===1,'Clear retains other habit');
        // Rejected write retains draft; successful write with failed refresh offers read-only retry.
        await context.route(`**/habits/${a.id}/log`,r=>r.fulfill({status:503,json:{detail:'Synthetic rejected log'}}));
        await card(a.id).getByRole('spinbutton').fill('4');
        await card(a.id).getByRole('button',{name:'Save',exact:true}).click();await settled();
        assert(await card(a.id).getByRole('spinbutton').inputValue()==='4','failed write retains draft');
        await context.unroute(`**/habits/${a.id}/log`);
        await context.route('**/habits',r=>r.request().method()==='GET' ? r.fulfill({status:503,json:{detail:'Synthetic failed refresh'}}) : r.continue());
        count=writes.length;
        await card(a.id).getByRole('button',{name:'Save',exact:true}).click();await settled();
        await p.locator('#habit_retry_load').waitFor({state:'visible'});
        assert((await read(a.id)).history.some(l=>l.date===date&&l.value===4),'ACK persists despite read failure');
        await context.unroute('**/habits');
        await p.locator('#habit_retry_load').click();await p.locator('#habit_retry_load').waitFor({state:'hidden'});
        assert(writes.length===count+1,'refresh retry no POST replay');
        // A held real write captures date/value while concurrent edits remain dirty.
        let release,entered;const hold=new Promise(r=>release=r),started=new Promise(r=>entered=r);
        await context.route(`**/habits/${a.id}/log`,async r=>{entered();await hold;await r.continue();});
        await card(a.id).getByRole('spinbutton').fill('5');
        await card(a.id).getByRole('button',{name:'Save',exact:true}).click();await started;
        await card(a.id).getByRole('button',{name:'Saving…',exact:true}).dispatchEvent('click'); // Deliberately bypass disabled actionability to test the handler guard.
        await card(a.id).getByRole('spinbutton').fill('6');
        release();await settled();await context.unroute(`**/habits/${a.id}/log`);
        assert((await read(a.id)).history.some(l=>l.date===date&&l.value===5),'held Save persists captured value');
        assert(await card(a.id).getByRole('spinbutton').inputValue()==='6','concurrent edit retained after ACK');
        await card(a.id).getByRole('button',{name:'Cancel',exact:true}).click();
        assert(await card(a.id).getByRole('spinbutton').inputValue()==='5','Cancel restores acknowledged value');
        // Existing freeform definition metadata, target changes and chart/goal inspector retained.
        await card(a.id).getByRole('button',{name:'Edit definition',exact:true}).click();
        assert(await p.locator('#modal_habit_target').inputValue()==='0','zero target editor retained');
        assert(await p.locator('#modal_habit_frequency').inputValue()==='Custom cadence'&&await p.locator('#modal_habit_reminder').inputValue()==='Custom reminder','freeform definition metadata retained');
        await p.locator('#modal_habit_target').fill('10');
        await p.locator('#habit_modal button[onclick="saveHabit()"]').click();
        await p.locator('#habit_modal').waitFor({state:'hidden'});
        assert((await read(a.id)).history.some(l=>l.date===date&&l.value===5&&l.status==='completed'),'target update does not rewrite history');
        await p.locator('#tab_btn_charts').click();
        await p.getByRole('button',{name:'Deselect All',exact:true}).click();
        await p.locator('#habit_inspector_chips button').filter({hasText:a.name}).click();
        await p.waitForFunction(()=>Object.values(habitCharts).length===3);
        assert(await p.locator('#goal_progression_card').isVisible(),'goal progression and inspector retained');
        await p.locator('#tab_btn_matrix').click();
        // Outside loaded history remains unknown, but explicit Save yields a retained known receipt.
        await p.evaluate(id=>{const view=habitCardView(id);view.offset=-80;view.date=habitCardDates(view).at(-1).date;renderHabitCards();},a.id);
        await card(a.id).getByText(/Outside loaded history/).waitFor();
        assert(await card(a.id).getByRole('button',{name:'Clear',exact:true}).isDisabled(),'unknown older date cannot Clear');
        const oldDate=await card(a.id).locator('time').getAttribute('datetime');
        await card(a.id).getByRole('spinbutton').fill('0');await card(a.id).getByRole('button',{name:'Save',exact:true}).click();await settled();
        assert(!(await card(a.id).getByRole('button',{name:'Clear',exact:true}).isDisabled()),'old-date acknowledged record retained after limited GET');
        assert((await read(a.id)).history.some(l=>l.date===oldDate&&l.status==='pending'),'old-date real readback retained');
        await card(a.id).getByRole('button',{name:'Today',exact:true}).click();
        // Sample responsive/theme geometry, text contrast and focus (not whole-app a11y certification).
        const samples=[];
        for(const width of [390,768,1024,1440]) for(const appearance of ['refined','stone','porcelain','dark']) {
            await p.setViewportSize({width,height:900});
            await p.evaluate(choice=>{setAppearancePreference('appearance',choice==='dark'?'dark':'light');if(choice!=='dark')setAppearancePreference('lightTheme',choice);},appearance);
            await p.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
            const sample=await p.evaluate(()=>{
                const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
                const lum=s=>rgb(s).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
                const el=document.querySelector('.habit-compact-card button'),style=getComputedStyle(el),a=lum(style.color),b=lum(style.backgroundColor);
                return {navWidth:document.querySelector('.app-navigation nav').clientWidth,navScrollWidth:document.querySelector('.app-navigation nav').scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
            });
            samples.push({width,appearance,...sample});assert(width<=800 ? sample.navWidth>=width-32 : sample.navScrollWidth<=sample.navWidth+1,`navigation not squeezed ${width}/${appearance}`);assert(!sample.overflow,`no horizontal page overflow ${width}/${appearance}`);assert(sample.contrast>=4.5,`sample control text contrast ${width}/${appearance}`);
        }
        await card(b.id).getByRole('button',{name:'Done',exact:true}).focus();await p.keyboard.press('Space');
        assert(await p.evaluate(()=>document.activeElement?.textContent==='Done'),'choice keyboard focus restored');
        await p.screenshot({path:'/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-10/habits-1440-dark.png',fullPage:true});
        await p.setViewportSize({width:390,height:900});await p.evaluate(()=>setAppearancePreference('appearance','light'));
        await p.screenshot({path:'/home/user/.local/state/timetrace-ui-redesign/evidence/ticket-10/habits-390-light.png',fullPage:true});
        assert(errors.length===0,'no browser page errors');
        return {checks,errors,writes,samples,timezone:'Pacific/Kiritimati',fakes:['provider catalog','one rejected log POST','one failed list refresh','held real log request'],limits:['physical touch','screen readers','other browser engines','exhaustive contrast/a11y','lost response ambiguity/cross-tab concurrency']};
    } finally {
        for(const h of fixtures) await context.request.delete(`${baseURL}/habits/${h.id}`);
        await context.close();
    }
};
