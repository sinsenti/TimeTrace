/* Manual AI HTTP fixtures only: no inference, Test, activation, keys or providers. */
async (page, baseURL) => {
    const results=[];
    for(const fail of [false,true]) {
        const context=await page.context().browser().newContext(), p=await context.newPage();
        const dialogs=[],writes=[],errors=[];let release,entered,retry=false;
        const held=new Promise(r=>release=r), started=new Promise(r=>entered=r);
        p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});p.on('pageerror',e=>errors.push(e.message));
        try {
            await context.route('**/api/ai/providers/catalog',r=>r.fulfill({json:{}}));
            await context.route('**/api/ai/settings',async r=>{
                if(r.request().method()!=='GET') return r.continue();
                entered();await held;
                if(fail && !retry) await r.fulfill({status:503,json:{detail:'Synthetic initial settings read failure'}});
                else await r.continue();
            });
            await p.goto(`${baseURL}/settings/ai`);await started;
            await p.locator('#ai_setting_custom_instructions').fill('Draft during settings GET');
            await p.locator('#ai_setting_preferred_tags').fill('synthetic-draft');
            p.on('request',r=>{if(r.method()!=='GET') writes.push(r.url());});release();
            await p.waitForFunction(failed=>failed ? document.getElementById('ai_settings_save_status').textContent.includes('Could not load') : aiBehaviorReady,fail);
            await p.getByRole('link',{name:'Calendar',exact:true}).click();
            if(dialogs.length!==1 || !p.url().endsWith('/settings/ai') || await p.locator('#ai_setting_custom_instructions').inputValue()!=='Draft during settings GET' || writes.length) throw Error(JSON.stringify({fail,dialogs,writes}));
            if(fail) {
                await p.locator('#ai_settings_save_btn').click();
                await p.waitForFunction(()=>!aiBehaviorLoading);
                if(writes.length) throw Error('Unknown settings Save wrote defaults');
                retry=true;await p.getByRole('button',{name:'Retry load',exact:true}).click();
                await p.waitForFunction(()=>aiBehaviorReady);
                if(await p.locator('#ai_setting_custom_instructions').inputValue()!=='Draft during settings GET') throw Error('Retry absorbed draft');
            }
            const persisted=await (await context.request.get(`${baseURL}/api/ai/settings`)).json();
            await p.locator('#ai_setting_custom_instructions').fill(persisted.custom_instructions || '');
            await p.locator('#ai_setting_preferred_tags').fill((persisted.preferred_tags || []).join(', '));
            await p.getByRole('link',{name:'Calendar',exact:true}).click();await p.waitForURL('**/dashboard**');
            if(dialogs.length!==1 || writes.length || errors.length) throw Error(JSON.stringify({dialogs,writes,errors}));
            results.push({initialRead:fail?'held 503 + retry':'held success',drafts:'preserved; server-value reversion clean',dialogs,writes,errors});
        } finally {release();await context.close();}
    }
    for(const mode of ['clean','other-owners','instruction-draft','conflict']) {
        const context=await page.context().browser().newContext(),p=await context.newPage();
        const dialogs=[],writes=[],errors=[];p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});p.on('pageerror',e=>errors.push(e.message));
        const proposal={id:'synthetic-proposal',status:'pending',proposed_instruction:'Accepted synthetic standing instruction',before_instructions:'',after_instructions:'Accepted synthetic standing instruction'};
        const settings=await(await context.request.get(`${baseURL}/api/ai/settings`)).json();
        try {
            await context.route('**/api/ai/providers/catalog',r=>r.fulfill({json:{}}));
            await context.route('**/api/ai/conversations',r=>r.fulfill({json:[{id:'synthetic-conversation',title:'Synthetic fixture'}]}));
            await context.route('**/api/ai/conversations/synthetic-conversation',r=>r.fulfill({json:{messages:[],instruction_proposals:[proposal]}}));
            await context.route('**/api/ai/instruction-proposals/synthetic-proposal/accept',r=>mode==='conflict' ? r.fulfill({status:409,json:{detail:'Settings changed; conflict'}}) : r.fulfill({json:{settings:{...settings,custom_instructions:proposal.after_instructions},proposal:{...proposal,status:'accepted'}}}));
            await p.goto(`${baseURL}/settings/ai`);await p.waitForFunction(()=>aiBehaviorReady);
            if(mode==='other-owners') {
                await p.locator('#ai_setting_preferred_tags').fill('other-behavior-draft');
                await p.locator('#ai_provider_new_btn').click();await p.locator('#ai_provider_form_name').fill('Draft provider');
            }
            if(mode==='instruction-draft'||mode==='conflict') await p.locator('#ai_setting_custom_instructions').fill('Keep my unsaved instruction draft');
            p.on('request',r=>{if(r.method()!=='GET') writes.push(r.url());});
            await p.getByRole('button',{name:'Assistant',exact:true}).click();
            await p.getByRole('button',{name:'Save to custom instructions',exact:true}).click();
            await p.waitForFunction(conflict=>document.querySelector('.ai-instruction-proposal')?.textContent.includes(conflict?'Settings changed since this proposal':'Saved to custom instructions.'),mode==='conflict');
            await p.locator('#ai_drawer_close_btn').click();
            const expected=(mode==='instruction-draft'||mode==='conflict')?'Keep my unsaved instruction draft':proposal.after_instructions;
            if(await p.locator('#ai_setting_custom_instructions').inputValue()!==expected) throw Error(`Instruction ownership ${mode}`);
            await p.getByRole('link',{name:'Calendar',exact:true}).click();
            if(mode==='clean') {await p.waitForURL('**/dashboard**');if(dialogs.length) throw Error('Persisted acceptance stayed dirty');}
            else if(dialogs.length!==1 || !p.url().endsWith('/settings/ai')) throw Error(`Other draft not protected ${mode}`);
            if(writes.length!==1 || errors.length) throw Error(JSON.stringify({mode,writes,errors}));
            results.push({mode,instructions:expected,dialogs,writes,errors,fixture:'fake conversation/proposal accept or 409; real settings GET'});
        } finally {await context.close();}
    }
    return results;
};
