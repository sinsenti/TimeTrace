/* Current post-15 caller acceptance, authored but not executed before parent native approval.
 * Real daemon writes/readbacks. Only the declared one-shot rating rejection is synthetic. */
async (page, baseURL) => {
    const check = (ok, message) => {if (!ok) throw Error(message);};
    const context = await page.context().browser().newContext(), origin = new URL(baseURL).origin;
    await context.addInitScript(({origin}) => {
        if (location.protocol !== 'http:' || location.origin !== origin) return;
        localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false,enableVimMotions:false,enableSessionReview:true}));
    }, {origin});
    const p = await context.newPage(), definitions = [], errors = [], readbacks = [], samples = [], writes = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => {if (['POST','PUT','DELETE'].includes(r.method())) writes.push({url:r.url(),body:r.postDataJSON()});});
    const api = async (url, method='GET', data) => {
        const r = await p.request.fetch(baseURL+url,{method,data});
        check(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
        return r.status() === 204 ? null : r.json();
    };
    const dates = ['2026-10-11','2026-10-12'];
    const root = date => p.locator(`#day_editor_${date}`);
    const ready = date => p.waitForFunction(date => {const e=dayEditors.get(date);return e?.ratingsReady&&!e.loading;}, date);
    const score = date => root(date).locator('.custom-rating-input').first();
    const setScoreInput = async (input, value) => {
        if (await input.getAttribute('type') === 'range') {
            const minimum = Number(await input.getAttribute('min'));
            const maximum = Number(await input.getAttribute('max'));
            check(Number.isInteger(value) && value >= minimum && value <= maximum, 'Requested slider score is in bounds');
            check(value - minimum <= 100, 'Bounded slider keyboard traversal');
            await input.focus(); await input.press('Home');
            for (let step = minimum; step < value; step++) await input.press('ArrowRight');
        } else {
            await input.fill(String(value));
        }
        check(await input.inputValue() === String(value), `Actual score control reached ${value}`);
    };
    const setScore = (date, value) => setScoreInput(score(date), value);
    const main = async date => {await p.locator('#day_review_date_input').fill(date);await p.locator('#day_review_date_input').dispatchEvent('change');await ready(date);};
    let task, session;
    try {
        for (const type of ['day','session','task']) definitions.push(await api('/rating-definitions','POST',{name:`Rating18 ${type}`,target_type:type,min_score:0,max_score:10,is_required:true}));
        const dayDef = definitions[0];
        task = await api('/api/tasks','POST',{title:'Rating18 synthetic task'});
        session = await api('/sessions','POST',{task_id:task.id,start_time:'2026-10-11T12:00:00Z',end_time:'2026-10-11T13:00:00Z',notes:'Rating18 synthetic session',review_skipped:true});
        for (const date of dates) await api('/revision/day-review','POST',{date_str:date,rating:3,notes:`Baseline ${date}`});
        await p.goto(baseURL+'/revision#sessions');
        const sessionCard = () => p.locator('#sessions_review_list .rev-card').filter({hasText:'Rating18 synthetic session'});
        await sessionCard().click();
        const sessionScore = p.locator('#session_custom_ratings_container .custom-rating-input');
        await setScoreInput(sessionScore, 0);
        await p.locator('#session_review_modal').getByRole('button',{name:/^Save /}).click();await p.locator('#session_review_modal').waitFor({state:'hidden'});
        let entry = (await api(`/rating-entries?target_type=session&target_id=${session.id}`))[0];check(entry.score===0&&!entry.dismissed,'Session zero score');
        for (const dismissed of [true,false]) {
            await sessionCard().click();await p.locator('#session_custom_ratings_container [id^="dismiss_btn_"]').click();
            await p.locator('#session_review_modal').getByRole('button',{name:/^Save /}).click();await p.locator('#session_review_modal').waitFor({state:'hidden'});
            check((await api(`/rating-entries?target_type=session&target_id=${session.id}`))[0].dismissed===dismissed,'Session dismissal/undismissal');
        }
        check((await api(`/sessions/${session.id}`)).review_skipped===true,'Session exemption retained');
        await p.locator('#rev_tab_btn_task_inspector').click();
        await p.locator('#task_inspector_search').fill(task.title);
        await p.locator('#task_inspector_dropdown .task-inspect-item').filter({hasText:task.title}).click();
        await setScoreInput(p.locator('#task_custom_ratings_container .custom-rating-input'), 10);
        await p.locator('#task_rev_takeaways').fill('Rating18 preserved task draft');
        await p.getByRole('button',{name:'Save Task Review',exact:true}).click();
        await p.waitForFunction(()=>!hasSettingsDrafts(['task_inspector_body']));
        const taskAfter = await api(`/api/tasks/${task.id}`);
        check(taskAfter.status===task.status,'Task review retained status');
        check((await api(`/sessions/${session.id}`)).start_time===session.start_time,'Task review retained schedule');
        readbacks.push({task:taskAfter.id,status:taskAfter.status,session:session.id,exempt:true});
        await p.locator('#task_rev_takeaways').fill('Independent task draft');
        await p.locator('#rev_tab_btn_day').click();await main(dates[0]);
        await root(dates[0]).locator('[data-day="notes"]').fill('Main retained draft');await setScore(dates[0],9);
        await p.getByRole('button',{name:'Show history',exact:true}).click();
        for (const [index,color] of ['red','orange','amber','lime','emerald'].entries()) {
            const date=`2026-10-0${index+1}`;
            await api('/revision/day-review','POST',{date_str:date,rating:index+1});
        }
        await p.getByRole('button',{name:'Hide history',exact:true}).click();
        await p.getByRole('button',{name:'Show history',exact:true}).click();
        for (const [index,color] of ['red','orange','amber','lime','emerald'].entries()) {
            const badge=p.locator('#day_history_grid button').filter({hasText:`2026-10-0${index+1}`}).locator('span').nth(1);
            await badge.waitFor();check((await badge.getAttribute('class')).includes(`bg-${color}-900`),'History grade badge');
        }
        await p.locator('#day_history_grid button').filter({hasText:dates[1]}).click();await ready(dates[1]);
        await root(dates[1]).locator('[data-day="notes"]').fill('Historical retained draft');await setScore(dates[1],2);
        await root(dates[1]).locator('[id^="dismiss_btn_"]').first().click();
        const ids = await p.locator('.custom-rating-input').evaluateAll(xs=>xs.map(x=>x.id));check(new Set(ids).size===ids.length,'Unique simultaneous controls');
        await p.locator('#rev_tab_btn_ratings_config').click();
        await p.locator('#rating_defs_new_btn').click();await p.locator('#modal_rating_name').fill('Rating18 added while drafts exist');
        await p.locator('#modal_rating_target_type').selectOption('day');
        await p.locator('#modal_rating_min').fill('-10');await p.locator('#modal_rating_max').fill('0');
        await p.locator('#modal_rating_save_btn').click();await p.locator('#rating_def_modal').waitFor({state:'hidden'});
        const added=(await api('/rating-definitions')).find(d=>d.name==='Rating18 added while drafts exist');
        check(added?.min_score===-10&&added?.max_score===0,'Native creation during retained drafts');definitions.push(added);
        await p.locator('.rating-admin-card').filter({hasText:'Rating18 day'}).click();
        await p.locator('#modal_rating_max').fill('5');await p.locator('#modal_rating_save_btn').click();await p.locator('#rating_def_modal').waitFor({state:'hidden'});
        await p.locator('#rev_tab_btn_day').click();
        await root(dates[0]).getByRole('button',{name:'Refresh / retry load',exact:true}).click();await ready(dates[0]);
        check(await score(dates[0]).inputValue()==='9'&&await score(dates[0]).getAttribute('type')==='number','Out-of-range raw draft retained');
        await root(dates[1]).getByRole('button',{name:'Refresh / retry load',exact:true}).click();await ready(dates[1]);
        check(await score(dates[1]).isDisabled(),'Independent historical dismissal retained');
        const beforeInvalid=writes.length;
        p.once('dialog',d=>d.accept());await root(dates[0]).getByRole('button',{name:'Save day review',exact:true}).click();
        check(writes.length===beforeInvalid,'Invalid raw draft blocked before write');
        await setScore(dates[0],0);
        let reject=true;
        await p.route('**/rating-entries',async route=>{
            if(route.request().method()==='POST'&&route.request().postDataJSON().target_id===dates[0]&&reject){reject=false;return route.fulfill({status:400,json:{detail:'Declared one-shot rating rejection'}});}
            return route.continue();
        });
        await root(dates[0]).getByRole('button',{name:'Save day review',exact:true}).click();
        await root(dates[0]).locator('[data-day="status"]').filter({hasText:'Save incomplete'}).waitFor();
        await root(dates[0]).getByRole('button',{name:'Save day review',exact:true}).click();
        await root(dates[0]).locator('[data-day="status"]').filter({hasText:'Saved submitted'}).waitFor();
        entry=(await api(`/rating-entries?target_type=day&target_id=${dates[0]}`)).find(e=>e.rating_definition_id===dayDef.id);
        check(entry.score===0&&!entry.dismissed,'Main exact target zero score persisted');
        check(await root(dates[1]).locator('[data-day="notes"]').inputValue()==='Historical retained draft','Historical draft untouched by partial Save');
        for (const appearance of ['light','dark']) {
            await p.evaluate(value=>setAppearancePreference('appearance',value),appearance);
            for (const [value,color] of [[0,'red'],[1,'orange'],[2,'amber'],[3,'lime'],[4,'emerald']]) {
                await setScore(dates[0],value);
                const sample=await score(dates[0]).evaluate(el=>({accent:getComputedStyle(el).accentColor,color:getComputedStyle(el.parentElement).color,classes:el.parentElement.className}));
                check(sample.classes.includes(`text-${color}-400`)&&sample.accent===sample.color,'Actual Day slider grade inheritance');samples.push({appearance,value,...sample});
                await root(dates[0]).locator('[data-day="rating"]').selectOption(String(value+1));
            }
        }
        await p.locator('#rev_tab_btn_ratings_config').click();await p.locator('.rating-admin-card').filter({hasText:'Rating18 day'}).click();
        await p.locator('#modal_rating_target_type').selectOption('task');await p.locator('#modal_rating_save_btn').click();await p.locator('#rating_def_modal').waitFor({state:'hidden'});
        await p.locator('#rev_tab_btn_day').click();await root(dates[0]).getByRole('button',{name:'Refresh / retry load',exact:true}).click();await ready(dates[0]);
        check(await root(dates[0]).locator('[data-rating-unavailable="true"]').count()===1,'Moved context retains unavailable dirty card');
        await p.locator('#rev_tab_btn_ratings_config').click();await p.locator('.rating-admin-card').filter({hasText:'Rating18 day'}).click();
        await p.locator('#modal_rating_delete_btn').click();await p.locator('#confirm_modal_proceed_btn').click();await p.locator('#rating_def_modal').waitFor({state:'hidden'});
        await p.locator('#rev_tab_btn_day').click();await root(dates[0]).getByRole('button',{name:'Refresh / retry load',exact:true}).click();await ready(dates[0]);
        check(await root(dates[0]).locator('[data-rating-unavailable="true"]').count()===1,'Deleted definition retains dirty card');
        await root(dates[0]).getByRole('button',{name:'Discard drafts',exact:true}).click();await p.locator('#confirm_modal_proceed_btn').click();
        await root(dates[0]).locator('[data-day="status"]').filter({hasText:'Drafts discarded'}).waitFor();
        check(await root(dates[0]).locator('[data-rating-unavailable="true"]').count()===0,'Explicit Discard removes deleted draft');
        await p.locator('#rev_tab_btn_task_inspector').click();check(await p.locator('#task_rev_takeaways').inputValue()==='Independent task draft','Admin retained unrelated Task draft');
        check(errors.length===0,errors.join('; '));
        return {readbacks,samples,writes,errors,fakes:['One declared rating-entry rejection'],unrun:['Physical touch and screen reader acceptance']};
    } finally {
        await p.unroute('**/rating-entries');
        const current = await api('/rating-definitions');
        for(const d of definitions) if(current.some(x=>x.id===d.id)) await api(`/rating-definitions/${d.id}`,'DELETE');
        if(session) await api(`/sessions/${session.id}`,'DELETE');
        if(task) await api(`/api/tasks/${task.id}`,'DELETE');
        await context.close();
    }
};
