/* Isolated native Chromium probe. Real writes/readbacks; only deliberate HTTP holds/failures and catalog are fake.
 * Public feature handlers, real form events and keyboard activation; no provider calls. */
async (page, baseURL) => {
    const results=[];
    const check=(ok,message)=>{if(!ok) throw Error(message);};
    const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
    const waitSignal=async promise=>{
        let timer;
        try {await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Held HTTP boundary not reached')),15000);})]);}
        finally {clearTimeout(timer);}
    };
    const makePage=async()=>{
        const c=await page.context().browser().newContext(),p=await c.newPage(),dialogs=[],errors=[],writes=[],reads=[];
        p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
        p.on('pageerror',e=>errors.push(e.message));
        p.on('request',r=>{const item={method:r.method(),url:r.url(),body:r.postData()};(r.method()==='GET'?reads:writes).push(item);});
        return {c,p,dialogs,errors,writes,reads};
    };
    const keyboardSettings=async(p,dialogs)=>{
        const before=dialogs.length,url=p.url();
        // Modal overlays pointer access. Focus the actual link, then send a genuine Enter key.
        const link=p.getByRole('link',{name:'Settings',exact:true});await link.focus();
        check(await link.evaluate(el=>document.activeElement===el),'Actual Settings link must be the key target');
        await link.evaluate(el=>el.addEventListener('keydown',event=>{el.dataset.lastKey=event.key;},{once:true}));
        await p.keyboard.press('Enter');
        check(await link.getAttribute('data-last-key')==='Enter','Settings link received the actual Enter key');
        check(dialogs.length===before+1&&dialogs.at(-1)==='Leave this page and discard unsaved changes?'&&p.url()===url,'Retained draft must show actual discard confirmation and cancel departure');
    };
    const day=async(p,date)=>{
        await p.locator('#day_review_date_input').fill(date);await p.locator('#day_review_date_input').dispatchEvent('change');
        await p.waitForFunction(date=>dayReviewDate===date&&dayReviewTextReady&&dayReviewRatingsReady&&!dayReviewLoading,date);
    };
    const frame=async p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    for(const edit of ['notes','time','tags']) {
        const {c,p,dialogs,errors,writes}=await makePage();let task;
        try {
            task=await(await c.request.post(`${baseURL}/api/tasks`,{data:{title:'Synthetic suspended attachment',tags:'#original'}})).json();
            await p.goto(`${baseURL}/dashboard`);await p.waitForSelector('.fc-timegrid-slot');
            await p.evaluate(id=>createPlanningSession(id),task.id);
            const original=await p.evaluate(()=>({notes:document.getElementById('session_modal_notes').value,start:document.getElementById('session_modal_start').value,tags:[...currentTagChips],task:document.getElementById('session_modal_task_id').value}));
            if(edit==='notes') await p.locator('#session_modal_notes').fill('Synthetic retained Notes');
            if(edit==='time') await p.locator('#session_modal_start').fill('2026-10-01T09:45');
            if(edit==='tags') {await p.locator('#session_modal_tags_input').fill('#retained');await p.locator('#session_modal_tags_input').press('Enter');}
            const retained=await p.evaluate(()=>({notes:document.getElementById('session_modal_notes').value,start:document.getElementById('session_modal_start').value,tags:[...currentTagChips]}));
            if(edit==='notes') {await p.locator('#session_modal_task_search').focus();await p.keyboard.press('+');}
            else await p.locator('#session_modal button[onclick="openTaskModalFromSessionModal()"] ').click();
            await p.locator('#task_modal').waitFor({state:'visible'});
            check(await p.locator('#modal_input_title').inputValue()==='','Task initially clean');
            await keyboardSettings(p,dialogs);
            await p.locator('#task_modal button[onclick="closeTaskModal()"] ').last().click();
            await p.locator('#session_modal').waitFor({state:'visible'});
            const resumed=await p.evaluate(()=>({notes:document.getElementById('session_modal_notes').value,start:document.getElementById('session_modal_start').value,tags:[...currentTagChips]}));
            check(JSON.stringify(resumed)===JSON.stringify(retained),'Nested Cancel must resume every retained field');
            check(await p.locator('#session_modal_task_id').inputValue()===original.task,'Cancel must preserve original attachment');
            await keyboardSettings(p,dialogs);
            await p.evaluate(original=>{document.getElementById('session_modal_notes').value=original.notes;document.getElementById('session_modal_start').value=original.start;setTagChips(original.tags.join(' '));},original);
            check(await p.evaluate(()=>followSettingsLink({})),'Reverted suspended/resumed Session is clean');
            await p.locator('#session_modal_notes').fill('Explicit discard');
            await p.locator('#session_modal button[onclick="closeSessionModal()"] ').last().click();
            check(await p.evaluate(()=>followSettingsLink({})),'Explicit Session Cancel discards retained owner');
            check(!writes.filter(w=>!w.url.endsWith('/idle/toggle')).length&&!errors.length,'Canceled handoff performs no domain writes/errors');
            results.push({case:`Session ${edit}-only +Task`,entry:edit==='notes'?'real + key in task search':'actual +Task button',original,retained,resumed,dialogs,writes,errors});
        } finally {if(task) await c.request.delete(`${baseURL}/api/tasks/${task.id}`);await c.close();}
    }
    for(const failRefresh of [false,true]) {
        const {c,p,dialogs,errors,writes}=await makePage(),held=deferred(),started=deferred();let task,holding=false;
        try {
            await p.goto(`${baseURL}/dashboard`);await p.waitForSelector('.fc-timegrid-slot');
            await p.evaluate(()=>openCreateSessionModal(new Date('2026-10-01T10:00:00'),new Date('2026-10-01T10:30:00')));
            await p.locator('#session_modal_notes').fill('Retained through refresh');
            await p.locator('#session_modal_tags_input').fill('#sessiontag');await p.locator('#session_modal_tags_input').press('Enter');
            await p.locator('#session_modal button[onclick="openTaskModalFromSessionModal()"] ').click();
            await p.locator('#modal_input_title').fill('Synthetic nested saved task');await p.locator('#modal_input_tags').fill('#tasktag');
            await c.route(url=>url.pathname==='/api/tasks',async r=>{
                if(r.request().method()==='POST') {const response=await r.fetch();task=await response.json();holding=true;return r.fulfill({response});}
                if(!holding) return r.continue();started.resolve();await held.promise;
                return failRefresh?r.fulfill({status:503,json:{detail:'Synthetic held metadata failure'}}):r.continue();
            });
            await p.evaluate(()=>{window.transitionSave=saveTask();});await waitSignal(started.promise);
            check(await p.locator('#task_modal').isHidden()&&await p.locator('#session_modal').isHidden(),'Both forms hidden during metadata refresh');
            await keyboardSettings(p,dialogs);held.resolve();await p.evaluate(async()=>{await window.transitionSave;return true;});
            await p.locator('#session_modal').waitFor({state:'visible'});
            check(await p.locator('#session_modal_notes').inputValue()==='Retained through refresh','Notes retained on resumption');
            check(await p.locator('#session_modal_start').inputValue()==='2026-10-01T10:00'&&await p.locator('#session_modal_end').inputValue()==='2026-10-01T10:30','Times retained');
            check(await p.evaluate(()=>currentTagChips.join(' '))==='#sessiontag','Task tags must not replace Session draft tags');
            check(await p.locator('#session_modal_task_id').inputValue()===task.id,'New task explicitly attached');
            await keyboardSettings(p,dialogs);
            const readbackResponse=await c.request.get(`${baseURL}/api/tasks/${task.id}`),readback=await readbackResponse.json();
            const taskWrites=writes.filter(w=>new URL(w.url).pathname==='/api/tasks');
            check(taskWrites.length===1,`One Task POST: ${JSON.stringify(taskWrites)}`);
            const submitted=JSON.parse(taskWrites[0].body);
            check(submitted.title==='Synthetic nested saved task'&&submitted.tags==='#tasktag',`Exact Task title/tags POST: ${JSON.stringify(submitted)}`);
            check(readbackResponse.ok()&&readback.id===task.id&&readback.title===submitted.title&&readback.tags===submitted.tags,`Real Task identity/title/tags readback: ${JSON.stringify({failRefresh,status:readbackResponse.status(),task,readback,writes})}`);
            check(writes.filter(w=>new URL(w.url).pathname==='/api/tasks').length===1&&!writes.some(w=>new URL(w.url).pathname==='/sessions'),'Exactly one Task write and no Session write');
            await p.locator('#session_modal button[onclick="closeSessionModal()"] ').last().click();
            check(await p.evaluate(()=>followSettingsLink({}))&&!errors.length,'Explicit discard cleans owner, no page errors');
            results.push({case:failRefresh?'nested Save metadata 503':'nested Save held metadata',readback,dialogs,writes,errors,fakes:failRefresh?'metadata GET hold/503':'metadata GET hold only'});
        } finally {held.resolve();if(task) await c.request.delete(`${baseURL}/api/tasks/${task.id}`);await c.close();}
    }
    for(const entry of ['create','edit']) {
        const {c,p,errors,writes}=await makePage();let task;
        try {
            if(entry==='edit') task=await(await c.request.post(`${baseURL}/api/tasks`,{data:{title:'Synthetic focus lifecycle',tags:'#original'}})).json();
            await p.goto(`${baseURL}/dashboard`);await p.waitForSelector('.fc-timegrid-slot');
            // Deterministic browser timer boundary, not a readiness sleep or disabled CSS.
            await p.clock.install();
            const open=()=>p.evaluate(async task=>{if(task) await openEditTaskModal(task.id);else openNewTaskModal();},task);
            const phases=[];
            for(const phase of ['interaction','close','reopen']) {
                await open();
                check(await p.locator('#modal_input_title').evaluate(el=>document.activeElement===el),'Normal Task initial focus is title');
                if(phase==='close') await p.evaluate(()=>closeTaskModal());
                if(phase==='reopen') {await p.evaluate(()=>closeTaskModal());await open();}
                const target=phase==='close'?p.getByRole('link',{name:'Settings',exact:true}):p.locator('#modal_input_tags');
                await target.focus();
                if(phase!=='close') await target.fill('#typed');
                await p.clock.runFor(100);
                check(await target.evaluate(el=>document.activeElement===el),`Task ${entry} must not steal focus after ${phase}`);
                if(phase!=='close') {
                    await p.keyboard.type('more');
                    check(await p.locator('#modal_input_tags').inputValue()==='#typedmore','Subsequent keyboard input stays in Tags');
                    check(await p.locator('#modal_input_title').inputValue()===(task?task.title:''),'No selected-title replacement');
                }
                phases.push(phase);await p.evaluate(()=>closeTaskModal());
            }
            check(!writes.some(w=>!w.url.endsWith('/idle/toggle'))&&!errors.length,'Focus/Cancel causes no domain writes or pageerrors');
            results.push({case:`Task ${entry} focus lifecycle`,phases,writes,errors,fakes:'browser clock advanced100ms after interaction/close/reopen; catalog'});
        }finally {if(task) await c.request.delete(`${baseURL}/api/tasks/${task.id}`);await c.close();}
    }
    for(const action of ['saveDayReviewForm','dismissDayReview']) for(const edit of ['notes','rating']) {
        const {c,p,dialogs,errors,writes,reads}=await makePage(),held=deferred(),committed=deferred();
        const dateA='2026-09-01',dateB='2026-09-02';let released=false;
        try {
            // Explicit synthetic setup keeps each test independent even though Day has no delete API.
            for(const date_str of [dateA,dateB]) await c.request.post(`${baseURL}/revision/day-review`,{data:{date_str,rating:3,notes:'',highlights:'',friction:'',review_skipped:false}});
            await p.goto(`${baseURL}/revision#day`);await day(p,dateA);
            if(edit==='notes') await p.locator('#day_form_notes').fill('X');else await p.locator('#day_form_rating').selectOption('5');
            await c.route('**/revision/day-review',async r=>{
                const response=await r.fetch();committed.resolve();await held.promise;await r.fulfill({response});
            });
            await p.evaluate(action=>{window.transitionSave=window[action]();},action);
            if(action==='dismissDayReview') await p.locator('#confirm_modal_proceed_btn').click();
            await waitSignal(committed.promise);
            const readback=await(await c.request.get(`${baseURL}/revision/day-summary?date_str=${dateA}`)).json();
            check(readback.day_review[edit] === (edit==='notes'?'X':5)&&readback.day_review.review_skipped===(action==='dismissDayReview'),'A actually committed correct text/grade/action');
            await day(p,dateB);
            if(edit==='notes') await p.locator('#day_form_notes').fill('X');else await p.locator('#day_form_rating').selectOption('5');
            const before=reads.filter(r=>r.url.includes('/revision/day-summary')).length;
            // Deliberately fail any unwanted stale refresh, so it cannot mask the false-clean guard defect.
            await c.route('**/revision/day-summary?**',r=>released?r.fulfill({status:503,json:{detail:'Unwanted stale refresh'}}):r.continue());
            released=true;held.resolve();await p.evaluate(async()=>{await window.transitionSave;return true;});await frame(p);
            await keyboardSettings(p,dialogs);
            check(await p.locator(`#day_form_${edit}`).inputValue()===(edit==='notes'?'X':'5'),'B retains matching payload draft');
            check(reads.filter(r=>r.url.includes('/revision/day-summary')).length===before,'Stale A response cannot refresh B');
            check(writes.length===1&&!errors.length,'One A write, no stale rating writes/pageerrors');
            results.push({case:`late ${action} B ${edit}`,readback:readback.day_review,dialogs,writes,errors,staleRefreshes:0,fakes:'hold real A POST response; unwanted refresh would get 503'});
        } finally {held.resolve();await c.close();}
    }
    for(const phase of ['day POST','rating POST']) {
        const {c,p,dialogs,errors,writes,reads}=await makePage(),held=deferred(),started=deferred(),defs=[];
        const dateA='2026-09-03',dateB='2026-09-04';
        try {
            for(const name of ['one','two']) defs.push(await(await c.request.post(`${baseURL}/rating-definitions`,{data:{name:`Synthetic Day transition ${name}`,target_type:'day',min_score:1,max_score:5}})).json());
            await p.goto(`${baseURL}/revision#day`);await day(p,dateA);
            for(const def of defs) await p.locator(`#rating_range_input_${def.id}`).evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
            await c.route(phase==='day POST'?'**/revision/day-review':'**/rating-entries',async r=>{
                if(phase==='rating POST'&&r.request().postDataJSON().rating_definition_id!==defs[0].id) return r.continue();
                const response=await r.fetch();started.resolve();await held.promise;await r.fulfill({response});
            });
            await p.evaluate(()=>{window.transitionSave=saveDayReviewForm();});await waitSignal(started.promise);
            await day(p,dateB);
            for(const def of defs) await p.locator(`#rating_range_input_${def.id}`).evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});
            const before=reads.filter(r=>r.url.includes('/revision/day-summary')).length;
            held.resolve();await p.evaluate(async()=>{await window.transitionSave;return true;});await frame(p);await keyboardSettings(p,dialogs);
            const ratingWrites=writes.filter(w=>new URL(w.url).pathname==='/rating-entries');
            check(ratingWrites.length===(phase==='day POST'?0:1)&&ratingWrites.every(w=>JSON.parse(w.body).target_id===dateA&&JSON.parse(w.body).score===5),'No B controls or later stale cards may post to A');
            check(reads.filter(r=>r.url.includes('/revision/day-summary')).length===before&&!errors.length,'Pending rating completion cannot refresh B');
            const persisted=await(await c.request.get(`${baseURL}/rating-entries?target_type=day&target_id=${dateA}`)).json();
            results.push({case:`Day Save changed editor during ${phase}`,ratingWrites,persisted,dialogs,errors,fakes:'hold real committed response only'});
        } finally {held.resolve();for(const def of defs) await c.request.delete(`${baseURL}/rating-definitions/${def.id}`);await c.close();}
    }
    return results;
};
