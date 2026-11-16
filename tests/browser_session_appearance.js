/* Sampled Session text contrast, theme/draft retention and narrow/short viewport geometry.
 * Measurements are bounded samples, not whole-app accessibility certification. */
async (page,baseURL)=>{
    const context=await page.context().browser().newContext({viewport:{width:390,height:620},reducedMotion:'reduce'});
    await context.addInitScript(()=>localStorage.setItem('timetrace_user_settings',JSON.stringify({idleDetectorEnabled:false})));
    const p=await context.newPage(),samples=[];
    try{
        await p.goto(`${baseURL}/dashboard`);await p.waitForSelector('.fc-timegrid-slot');
        await p.locator('button[onclick="createPlanningSession()"] ').click();
        await p.locator('#session_modal_notes').fill('Long synthetic Notes\n'+'Literal <img src=x onerror=alert(1)> text '.repeat(15));
        for(const mode of ['refined','stone','porcelain','dark']){
            await p.evaluate(mode=>{if(mode==='dark')setAppearancePreference('appearance','dark');else{setAppearancePreference('lightTheme',mode);setAppearancePreference('appearance','light');}},mode);
            // Let finite CSS transitions settle, but never wait on infinite activity animations.
            await p.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
            const sample=await p.evaluate(()=>{
                const rgba=s=>{const n=s.match(/[\d.]+/g).map(Number);return[n[0],n[1],n[2],n.length>3?n[3]:1];};
                const over=(fg,bg)=>{const a=fg[3]+bg[3]*(1-fg[3]);return [...fg.slice(0,3).map((n,i)=>(n*fg[3]+bg[i]*bg[3]*(1-fg[3]))/a),a];};
                const background=el=>{const own=rgba(getComputedStyle(el).backgroundColor);return own[3]>=1?own:over(own,el.parentElement?background(el.parentElement):[255,255,255,1]);};
                const lum=c=>c.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
                const items=[...document.querySelectorAll('#session_modal label, #session_modal_notes, #session_modal_save_btn, #session_modal_new_task_btn, #session_modal_duration_badge')].map(el=>{
                    const bg=background(el),fg=over(rgba(getComputedStyle(el).color),bg),a=lum(fg),b=lum(bg);
                    return {target:el.id||el.getAttribute('for'),contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),foreground:fg,background:bg};
                });
                const panel=document.querySelector('#session_modal > div'),rect=panel.getBoundingClientRect();
                return{items,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},scrollable:panel.scrollHeight>=panel.clientHeight,notes:document.getElementById('session_modal_notes').value};
            });
            if(!sample.notes.includes('<img src=x onerror=alert(1)>')||sample.rect.x<8||sample.rect.y<8||sample.rect.x+sample.rect.width>382||sample.rect.y+sample.rect.height>612)throw Error(`Theme/draft/narrow-height retention failed: ${mode}`);
            samples.push({mode,...sample});
        }
        return{samples,below45:samples.flatMap(s=>s.items.filter(i=>i.contrast<4.5).map(i=>({mode:s.mode,...i}))),limits:['Text/control samples only','No physical touch, screen-reader, other engine or whole-a11y certification']};
    }finally{await context.close();}
}
