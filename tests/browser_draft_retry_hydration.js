/* Manual retry/late metadata ownership checks on the isolated daemon; SQL is HTTP-faked. */
async (page, baseURL) => {
    const results=[];
    {
        const context=await page.context().browser().newContext(),p=await context.newPage();
        let definition,failSummary=false,holdRatings=false,release,entered;
        const held=new Promise(r=>release=r),started=new Promise(r=>entered=r),dialogs=[],writes=[],errors=[];
        p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});p.on('pageerror',e=>errors.push(e.message));
        try {
            definition=await(await context.request.post(`${baseURL}/rating-definitions`,{data:{name:'Synthetic retry ownership',target_type:'day',min_score:1,max_score:5}})).json();
            await context.route('**/api/ai/providers/catalog',r=>r.fulfill({json:{}}));
            await context.route('**/revision/day-summary?*',r=>failSummary?r.fulfill({status:503,json:{detail:'Synthetic retry summary failure'}}):r.continue());
            await context.route('**/rating-definitions?target_type=day',async r=>{if(holdRatings){entered();await held;}await r.continue();});
            await p.goto(`${baseURL}/revision#day`);const range=p.locator(`#rating_range_input_${definition.id}`);await range.waitFor();
            const original=await range.inputValue();
            p.on('request',r=>{if(r.method()!=='GET') writes.push(r.url());});
            await range.evaluate(el=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
            await p.locator('#day_form_notes').fill('Draft retained through summary failure and retry');
            failSummary=true;await p.locator('#day_review_date_input').dispatchEvent('change');
            await p.waitForFunction(()=>document.getElementById('day_form_save_btn').innerText.includes('Load failed'));
            failSummary=false;await p.locator('#day_form_save_btn').click();
            await p.waitForFunction(()=>!dayReviewLoading && !dayReviewReadFailed);
            if(await range.inputValue()!=='5'||await p.locator('#day_form_notes').inputValue()!=='Draft retained through summary failure and retry') throw Error('Retry replaced an initialized draft');
            await p.getByRole('link',{name:'Settings',exact:true}).click();if(dialogs.length!==1) throw Error('Retry absorbed draft baseline');
            const summary=await(await context.request.get(`${baseURL}/revision/day-summary?date_str=${await p.locator('#day_review_date_input').inputValue()}`)).json();
            await p.locator('#day_form_notes').fill(summary.day_review?.notes || '');
            await range.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},original);
            holdRatings=true;await p.locator('#day_review_date_input').dispatchEvent('change');await started;
            await range.evaluate(el=>{el.value='4';el.dispatchEvent(new Event('input',{bubbles:true}));});release();
            await p.waitForFunction(()=>!dayReviewLoading);
            if(await range.inputValue()!=='4') throw Error('Held same-owner metadata replaced rating input');
            await p.getByRole('link',{name:'Settings',exact:true}).click();
            if(dialogs.length!==2||writes.length||errors.length) throw Error(JSON.stringify({dialogs,writes,errors}));
            results.push({day:'failed refresh + Save retry preserves text/rating; held same-owner definitions preserve intervening rating',dialogs,writes,errors});
        } finally {release();if(definition?.id) await context.request.delete(`${baseURL}/rating-definitions/${definition.id}`);await context.close();}
    }
    {
        const context=await page.context().browser().newContext(),p=await context.newPage();let dashboard,release,entered,hold=false,failCaps=true;
        const held=new Promise(r=>release=r),started=new Promise(r=>entered=r),dialogs=[],errors=[];
        p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});p.on('pageerror',e=>errors.push(e.message));
        try {
            dashboard=await(await context.request.post(`${baseURL}/api/dashboards`,{data:{name:'Synthetic SQL hydration dashboard'}})).json();
            const widget={id:'synthetic-sql-widget',dashboard_id:dashboard.id,title:'Saved synthetic SQL',width:'half',spec:{mode:'sql',sql:{sql:'SELECT 1 AS amount',limit:200,chart:'bar',label_column:'amount',value_column:'amount'}}};
            await context.route('**/api/ai/providers/catalog',r=>r.fulfill({json:{}}));
            await context.route(`**/api/dashboards/${dashboard.id}/data`,r=>r.fulfill({json:{dashboard,widgets:[widget],results:{},sql_results:{},errors:{[widget.id]:'Synthetic saved SQL fixture; backend not invoked'}}}));
            await context.route('**/analytics/capabilities',async r=>{if(failCaps)return r.fulfill({status:503,json:{detail:'Synthetic capability failure'}});const response=await r.fetch();await r.fulfill({json:{...await response.json(),sql_enabled:true}});});
            await context.route('**/analytics/sql/schema',r=>r.fulfill({json:{tables:[]}}));
            await context.route('**/analytics/sql',async r=>{if(hold){entered();await held;}await r.fulfill({json:{columns:['amount'],rows:[[1]],row_count:1,elapsed_ms:hold?2:1}});});
            await p.goto(`${baseURL}/stats`);await p.getByRole('button',{name:dashboard.name,exact:true}).click();
            await p.getByRole('button',{name:'+ Add Widget',exact:true}).click();
            await p.waitForFunction(()=>document.getElementById('widget_builder_modal').classList.contains('hidden'));
            if(!dialogs.some(message=>message.includes('Reopen the builder to retry'))) throw Error('Missing capability retry notice');
            failCaps=false;
            await p.locator('#widget_grid').getByRole('button',{name:'Edit',exact:true}).click();
            await p.waitForFunction(()=>document.getElementById('wb_sql_label_column').value==='amount');
            await p.locator('#wb_title').fill('Unsaved SQL title during repeated metadata');hold=true;
            await p.locator('button[onclick="wbRunSqlPreview()"] ').click();await started;release();
            await p.waitForFunction(()=>document.getElementById('wb_sql_meta').textContent.includes('2ms'));
            if(await p.locator('#wb_sql_label_column').inputValue()!=='amount'||await p.locator('#wb_sql_value_column').inputValue()!=='amount'||await p.locator('#wb_title').inputValue()!=='Unsaved SQL title during repeated metadata') throw Error('SQL metadata replaced saved selections or title draft');
            await p.getByRole('link',{name:'Settings',exact:true}).dispatchEvent('click');
            if(dialogs.length!==2 || !p.url().endsWith('/stats')) throw Error('SQL metadata absorbed title');
            await p.locator('#wb_title').fill(widget.title);await p.getByRole('link',{name:'Settings',exact:true}).dispatchEvent('click');await p.waitForURL('**/settings/ai');
            if(dialogs.length!==2||errors.length) throw Error(JSON.stringify({dialogs,errors}));
            results.push({sql:'failed capabilities + reopen; saved columns retained across repeated held preview; title remains dirty then reverted clean',dialogs,errors,fakes:'SQL widget data/capability flag/schema/SELECT; no SQL backend execution'});
        } finally {release();if(dashboard?.id) await context.request.delete(`${baseURL}/api/dashboards/${dashboard.id}`);await context.close();}
    }
    return results;
};
