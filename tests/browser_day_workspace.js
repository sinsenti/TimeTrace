/* Native Chromium acceptance on a disposable daemon. Public controls and API readbacks.
 * Only explicit HTTP holds/failures are fake. No provider calls or task-completion writes. */
async (page, baseURL) => {
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    const results=[], writes=[], errors=[];
    const origin=new URL(baseURL).origin;
    check(new URL(baseURL).protocol==='http:','Disposable base URL must use declared HTTP origin');
    const context=await page.context().browser().newContext();
    await context.addInitScript(({origin})=>{
        // about:blank and every other origin return before touching browser storage.
        if(location.protocol!=='http:'||location.origin!==origin)return;
        const key='timetrace_user_settings';
        const existing=JSON.parse(localStorage.getItem(key)||'{}');
        localStorage.setItem(key,JSON.stringify({...existing,idleDetectorEnabled:false,enableVimMotions:false}));
    },{origin});
    const p=await context.newPage();
    p.on('pageerror',error=>errors.push(error.message));
    p.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))writes.push({url:request.url(),body:request.postDataJSON()});});
    const days=['2026-10-11','2026-10-12','2026-10-13'];
    const defs=[];
    const post=async(url,body)=>{
        const response=await p.request.post(`${baseURL}${url}`,{data:body});
        check(response.ok(),`Fixture POST ${url}: ${response.status()}`);return response.json();
    };
    const ready=async date=>p.waitForFunction(date=>{
        const editor=dayEditors.get(date);return editor?.textReady&&editor.ratingsReady&&!editor.loading;
    },date);
    const main=async date=>{await p.locator('#day_review_date_input').fill(date);await p.locator('#day_review_date_input').dispatchEvent('change');await ready(date);};
    const root=date=>p.locator(`#day_editor_${date}`);
    const notes=date=>root(date).locator('[data-day="notes"]');
    const score=(date,index=0)=>root(date).locator('.custom-rating-input').nth(index);
    const setScore=async(date,index,value)=>{await score(date,index).focus();await p.keyboard.press('Home');for(let i=1;i<value;i++)await p.keyboard.press('ArrowRight');};
    try {
        for(const name of ['Workspace scale one','Workspace scale two']) defs.push(await post('/rating-definitions',{name,target_type:'day',min_score:1,max_score:5,is_required:true}));
        for(const date of days) await post('/revision/day-review',{date_str:date,rating:3,notes:`Baseline ${date}`});
        for(const date of days) for(const def of defs) await post('/rating-entries',{rating_definition_id:def.id,target_type:'day',target_id:date,score:3,dismissed:false});
        await post('/sessions',{start_time:`${days[0]}T10:00:00`,end_time:`${days[0]}T11:00:00`,tags:'#one #shared',notes:'Workspace direct one'});
        await post('/sessions',{start_time:`${days[0]}T12:00:00`,end_time:`${days[0]}T13:00:00`,tags:'#two #shared',notes:'Workspace direct two'});
        await p.goto(`${baseURL}/revision`);await p.waitForFunction(()=>dayReviewEditor?.ratingsReady&&!dayReviewEditor.loading);
        check(await p.locator('#day_history_panel').isHidden(),'history initially closed');
        check(await p.locator('#rev_tab_day').isVisible(),'Day default');results.push('default Day and closed bottom history');
        await main(days[0]);await notes(days[0]).fill('A independent draft');await setScore(days[0],0,1);
        await p.getByRole('button',{name:'Show history',exact:true}).click();
        await p.locator('#day_history_grid button').filter({hasText:days[1]}).click();await ready(days[1]);
        await notes(days[1]).fill('B independent draft');await setScore(days[1],0,5);
        await root(days[1]).locator('[id^="dismiss_btn_"]').first().click();
        const ids=await p.locator('.custom-rating-input').evaluateAll(inputs=>inputs.map(input=>input.id));
        check(new Set(ids).size===ids.length,'unique rating IDs');
        check(await score(days[0]).isEnabled()&&await score(days[1]).isDisabled(),'independent dismiss state');
        await p.getByRole('button',{name:'Hide history',exact:true}).click();
        check(await root(days[1]).isHidden(),'history editor hidden');
        await p.getByRole('button',{name:'Show history',exact:true}).click();
        check(await notes(days[1]).inputValue()==='B independent draft','hidden draft retained');
        await p.locator('#day_history_grid button').filter({hasText:days[2]}).click();await ready(days[2]);
        check(await root(days[1]).isHidden(),'at most one historical editor');
        await p.locator('#day_history_grid button').filter({hasText:days[1]}).click();await ready(days[1]);
        check(await notes(days[1]).inputValue()==='B independent draft','switched draft retained');
        await root(days[1]).getByRole('button',{name:'Use as main day'}).click();await ready(days[1]);
        check(await p.locator('#day_main_editor > article').count()===1,'one main editor');
        check(await p.locator('#day_history_grid button').filter({hasText:days[1]}).count()===0,'main excluded from history');
        check(await notes(days[1]).inputValue()==='B independent draft','promotion retained owner');
        await main(days[0]);check(await notes(days[0]).inputValue()==='A independent draft','visited main draft retained');
        await main(days[1]);
        await root(days[1]).getByRole('button',{name:'Save day review',exact:true}).click();
        await p.waitForFunction(date=>!dayEditors.get(date).saving,days[1]);
        let other=await (await p.request.get(`${baseURL}/revision/day-summary?date_str=${days[1]}`)).json();
        check(other.day_review.notes==='B independent draft'&&other.custom_ratings.find(entry=>entry.rating_definition_id===defs[0].id).dismissed===true,'B exact target saved with its own dismissal');
        await notes(days[1]).fill('B dismissed text');
        await root(days[1]).getByRole('button',{name:'Dismiss day',exact:true}).click();await p.locator('#confirm_modal_proceed_btn').click();
        await p.waitForFunction(date=>!dayEditors.get(date).saving,days[1]);
        other=await (await p.request.get(`${baseURL}/revision/day-summary?date_str=${days[1]}`)).json();
        check(other.day_review.review_skipped&&other.day_review.notes==='B dismissed text','Dismiss owns B text only');
        await notes(days[1]).fill('Discard only B');const discardStart=writes.length;
        await root(days[1]).getByRole('button',{name:'Discard drafts',exact:true}).click();await p.locator('#confirm_modal_proceed_btn').click();
        await p.waitForFunction(date=>dayEditors.get(date).root.querySelector('[data-day="status"]').textContent.startsWith('Drafts discarded'),days[1]);
        check(await notes(days[1]).inputValue()==='B dismissed text'&&writes.length===discardStart,'Discard restores own baseline without writes');
        await main(days[0]);check(await notes(days[0]).inputValue()==='A independent draft','B Save/Dismiss/Discard retain A');
        results.push('two-day IDs/dismissals, exact B Save/Dismiss/Discard and hide/switch/promote ownership');
        await root(days[0]).getByRole('button',{name:'#one 1h',exact:true}).click();
        check((await root(days[0]).locator('[data-day="session-count"]').textContent()).replace(/\s/g,'').includes('1/2'),'matching/full session denominator');
        await root(days[0]).getByRole('button',{name:'Tasks',exact:true}).click();
        check((await root(days[0]).locator('[data-day="filter-label"]').textContent()).includes('#one'),'group retains chip');
        await root(days[0]).getByRole('button',{name:'Open in Calendar',exact:true}).click();await p.waitForURL('**/dashboard?**');
        await p.waitForFunction(()=>!document.getElementById('breakdown_filter_chip').classList.contains('hidden'));
        check((await p.locator('#breakdown_filter_chip').textContent()).includes('#one'),'Calendar persistent tag chip');
        const handoff=new URL(p.url());check(handoff.searchParams.get('date')===days[0]&&handoff.searchParams.get('tag')==='#one','date/tag handoff');
        results.push('full denominator, persistent chip and actual Calendar tag handoff');
        await p.waitForLoadState('networkidle');
        await p.goto(`${baseURL}/revision`);await main(days[0]);
        await notes(days[0]).fill('A submitted');await setScore(days[0],0,2);await setScore(days[0],1,4);
        const bBeforePartial=await (await p.request.get(`${baseURL}/revision/day-summary?date_str=${days[1]}`)).json();
        const bStable=summary=>JSON.stringify([summary.day_review,summary.custom_ratings]);
        let fail=true;
        await p.route('**/rating-entries',async route=>{
            const body=route.request().postDataJSON();
            if(route.request().method()==='POST'&&body.rating_definition_id===defs[1].id&&body.target_id===days[0]&&fail){fail=false;await route.fulfill({status:400,contentType:'application/json',body:'{"detail":"Controlled second-rating failure"}'});}
            else await route.continue();
        });
        let checkpoint=writes.length;
        await root(days[0]).getByRole('button',{name:'Save day review',exact:true}).click();
        await p.waitForFunction(date=>dayEditors.get(date).root.querySelector('[data-day="status"]').textContent.includes('Save incomplete'),days[0]);
        let saved=await (await p.request.get(`${baseURL}/revision/day-summary?date_str=${days[0]}`)).json();
        check(saved.day_review.notes==='A submitted'&&saved.custom_ratings.find(e=>e.rating_definition_id===defs[0].id).score===2,'partial ACKs persisted');
        const afterFirstB=await (await p.request.get(`${baseURL}/revision/day-summary?date_str=${days[1]}`)).json();
        check(bStable(afterFirstB)===bStable(bBeforePartial),'B persisted review and ratings untouched during partial A Save');
        const aEntry=saved.custom_ratings.find(entry=>entry.rating_definition_id===defs[0].id);
        const bEntry=afterFirstB.custom_ratings.find(entry=>entry.rating_definition_id===defs[0].id);
        check(aEntry.target_id===days[0]&&aEntry.score===2&&!aEntry.dismissed&&bEntry.target_id===days[1]&&bEntry.score===0&&bEntry.dismissed,'actual same-definition two-day scores and opposite dismissal');
        check(writes.slice(checkpoint).filter(write=>write.url.endsWith('/revision/day-review')).length===1,'first attempt has exactly one A review POST');
        const firstWrites=writes.slice(checkpoint).filter(w=>w.url.endsWith('/rating-entries'));
        check(firstWrites.length===2,'first attempt sends two target ratings');
        checkpoint=writes.length;await root(days[0]).getByRole('button',{name:'Save day review',exact:true}).click();
        await p.waitForFunction(date=>!dayEditors.get(date).saving&&dayEditors.get(date).root.querySelector('[data-day="status"]').textContent.startsWith('Saved'),days[0]);
        const retry=writes.slice(checkpoint);check(retry.length===1&&retry[0].body.rating_definition_id===defs[1].id,'retry only failed rating');
        const afterRetryB=await (await p.request.get(`${baseURL}/revision/day-summary?date_str=${days[1]}`)).json();
        check(bStable(afterRetryB)===bStable(bBeforePartial),'B persisted review and ratings untouched during A retry');
        saved=await (await p.request.get(`${baseURL}/revision/day-summary?date_str=${days[0]}`)).json();
        check(saved.custom_ratings.find(entry=>entry.rating_definition_id===defs[1].id).score===4,'failed second rating persisted on retry');
        results.push('partial day/first-rating ACK and retry unfinished second entry only; B persisted values unchanged');
        let release,entered;const held=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>entered=resolve);
        const heldHandler=async route=>{if(route.request().method()==='POST'){entered();await held;}await route.continue();};
        await p.route('**/revision/day-review',heldHandler);
        await notes(days[0]).fill('A captured before hold');checkpoint=writes.length;
        await root(days[0]).getByRole('button',{name:'Save day review',exact:true}).click();
        let timer;try{await Promise.race([seen,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Held day POST not reached')),15000);})]);}finally{clearTimeout(timer);}
        await root(days[0]).getByRole('button',{name:'Save day review',exact:true}).click();
        await notes(days[0]).fill('A concurrent later draft');await main(days[1]);await notes(days[1]).fill('B while A pending');
        release();await p.waitForFunction(date=>!dayEditors.get(date).saving,days[0]);await p.unroute('**/revision/day-review',heldHandler);
        check(await notes(days[1]).inputValue()==='B while A pending','A ACK never cleans/replaces B');
        check(writes.slice(checkpoint).filter(write=>write.url.endsWith('/revision/day-review')).length===1,'pending double activation guarded');
        saved=await (await p.request.get(`${baseURL}/revision/day-summary?date_str=${days[0]}`)).json();
        check(saved.day_review.notes==='A captured before hold','held write captured original A');
        await main(days[0]);check(await notes(days[0]).inputValue()==='A concurrent later draft','held ACK retains concurrent A draft');
        results.push('held A ACK, pending duplicate guard and concurrent A/hidden B ownership');
        await notes(days[0]).fill('ordinary');const before=writes.length;
        await notes(days[0]).focus();await p.keyboard.press('End');await p.keyboard.press('Enter');await p.keyboard.type('line');
        check((await notes(days[0]).inputValue()).includes('\nline')&&writes.length===before,'ordinary Enter edits text only');
        await p.keyboard.press('Control+Enter');await p.waitForFunction(date=>!dayEditors.get(date).saving,days[0]);
        check(writes.slice(before).filter(w=>w.url.endsWith('/revision/day-review')).length===1,'CtrlEnter one own form');
        results.push('Enter and CtrlEnter public keyboard behavior');
        await main(days[0]);
        await root(days[0]).getByRole('button',{name:'Activity',exact:true}).click();
        await root(days[0]).locator('.day-breakdown-row').filter({hasText:'#one'}).click();
        if(await p.locator('#day_history_panel').isHidden())await p.getByRole('button',{name:'Show history',exact:true}).click();
        await p.locator('#day_history_grid button').filter({hasText:days[1]}).click();await ready(days[1]);
        const presentationStart=writes.length;
        const draftSnapshot=await p.evaluate(days=>days.slice(0,2).map(date=>{
            const editor=dayEditors.get(date);return {date,notes:editor.root.querySelector('[data-day="notes"]').value,
                ratings:Array.from(editor.root.querySelectorAll('.custom-rating-input'),input=>[input.id,input.value,input.disabled])};
        }),days);
        const layouts=[],contrasts=[];
        const profiles=[...['refined','stone','porcelain'].map(lightTheme=>({appearance:'light',lightTheme,theme:'midnight'})),
            ...['midnight','nord','dracula','cyberpunk','monokai'].map(theme=>({appearance:'dark',lightTheme:'refined',theme}))];
        for(const width of [390,768,1024,1440])for(const profile of profiles){
            await p.setViewportSize({width,height:1000});
            await p.evaluate(profile=>{const settings={...getUserSettings(),...profile};saveUserSettings(settings);applyAppearance(settings);},profile);
            await p.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'||animation.effect.getTiming().iterations===Infinity));
            await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            const sample=await p.evaluate(({days,width,profile})=>{
                const visible=element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden';
                const rect=element=>{const box=element.getBoundingClientRect();return {left:box.left,right:box.right,width:box.width,height:box.height};};
                const roots=days.slice(0,2).map(date=>document.getElementById(`day_editor_${date}`));
                const bounds=[];
                const controls=[];
                for(const root of roots){
                    const outer=rect(root);
                    if(outer.left < -1||outer.right > innerWidth+1)bounds.push({id:root.id,...outer,reason:'editor viewport'});
                    for(const element of root.querySelectorAll('*'))if(visible(element)){
                        const box=rect(element);
                        if(box.left<outer.left-1||box.right>outer.right+1)bounds.push({id:element.id||element.tagName,...box,reason:'editor descendant'});
                    }
                    for(const element of root.querySelectorAll('button,input,select,textarea'))if(visible(element)){
                        controls.push({id:element.id,action:element.dataset.action||'',breakdown:element.classList.contains('day-breakdown-row'),...rect(element)});
                    }
                }
                const parse=color=>{
                    const match=color.match(/^rgba?\(([^)]+)\)$/);
                    if(!match)return null;
                    const values=match[1].split(/[, /]+/).filter(Boolean).map(Number);
                    return values.length===3?[...values,1]:values;
                };
                const luminance=rgb=>rgb.slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((total,value,index)=>total+value*[.2126,.7152,.0722][index],0);
                const contrastSamples=[];
                const categories=[['heading','.day-editor h2'],['body','.day-evidence-summary [data-day="total"]'],['status','[data-day="status"]'],
                    ['chip','[data-day="filter-label"]'],['rating-label','[id^="score_label_"]'],['button','.day-editor [data-action="save"]']];
                for(const [category,selector] of categories){
                    const element=Array.from(document.querySelectorAll(selector)).find(visible);
                    if(!element){contrastSamples.push({category,error:'No visible first-match sample'});continue;}
                    const color=getComputedStyle(element).color,foreground=parse(color);
                    let remaining=1,background=[0,0,0],unresolved=null;
                    for(let ancestor=element;ancestor&&remaining>0;ancestor=ancestor.parentElement){
                        const style=getComputedStyle(ancestor),layer=parse(style.backgroundColor);
                        if(Number(style.opacity)!==1||style.backgroundImage!=='none'||!layer){unresolved='Opacity/image/non-RGB background excluded';break;}
                        background=background.map((value,index)=>value+layer[index]*layer[3]*remaining);
                        remaining*=1-layer[3];
                    }
                    if(!foreground||foreground[3]!==1||remaining>0||unresolved){contrastSamples.push({category,selector,color,error:unresolved||'Foreground/background not opaque resolved RGB'});continue;}
                    const a=luminance(foreground),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
                    contrastSamples.push({category,selector,text:element.textContent.trim().slice(0,100),foreground:foreground.slice(0,3),background,ratio,threshold:4.5});
                }
                return {width,profile,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,bounds,controls,contrastSamples,
                    activeTheme:document.documentElement.dataset.theme,visibleRoots:roots.map(root=>({id:root.id,visible:visible(root),...rect(root)}))};
            },{days,width,profile});
            layouts.push({...sample,contrastSamples:undefined});contrasts.push({width,profile,samples:sample.contrastSamples});
            check(sample.documentWidth<=sample.viewport+1,`Document overflow at ${width}/${JSON.stringify(profile)}: ${JSON.stringify(sample)}`);
            check(sample.visibleRoots.every(root=>root.visible),'Both main A and expanded B visible during presentation');
            check(sample.bounds.length===0,`Editor/descendant overflow: ${JSON.stringify(sample)}`);
            check(sample.controls.filter(control=>control.breakdown).every(control=>control.height>=44&&control.width>=44),`Applicable larger breakdown targets at least44px: ${JSON.stringify(sample.controls.filter(control=>control.breakdown))}`);
            check(sample.contrastSamples.length===6&&sample.contrastSamples.every(item=>!item.error&&item.ratio>=item.threshold),`Contrast sample failure: ${JSON.stringify(sample.contrastSamples)}`);
            check(sample.activeTheme===(profile.appearance==='light'?'light':profile.theme),'Requested theme actually applied');
        }
        const afterPresentation=await p.evaluate(days=>days.slice(0,2).map(date=>{
            const editor=dayEditors.get(date);return {date,notes:editor.root.querySelector('[data-day="notes"]').value,
                ratings:Array.from(editor.root.querySelectorAll('.custom-rating-input'),input=>[input.id,input.value,input.disabled])};
        }),days);
        check(JSON.stringify(afterPresentation)===JSON.stringify(draftSnapshot),'Presentation changes retain both date drafts');
        check(writes.length===presentationStart,'Presentation phase has no domain/config writes');
        results.push('32 presentation combinations: four widths × eight themes; bounded first-match contrast, descendant bounds and larger breakdown targets');
        check(errors.length===0,`page errors: ${errors}`);
        return {results,resultGroupCount:results.length,layouts,contrasts,errors,writes,limits:['Controlled second-rating HTTP failure','Native browser must be invoked by caller; function alone is not execution evidence','Contrast samples cover six first-visible matches per combination, not every element/state; opacity/images/non-RGB backgrounds are rejected in sampled elements', '44px assertion applies to larger breakdown rows; dimensions of all visible controls are recorded, general buttons retain36px minimum', 'Focus rings, hover, disabled range tracks, all-frame transitions, physical touch, screen-reader and other engines are not certified', 'Task/Session Inspector native compatibility remains a separate gap; shared ratings unit callers pass']};
    } finally {
        for(const def of defs)await p.request.delete(`${baseURL}/rating-definitions/${def.id}`);
        await context.close();
    }
}
