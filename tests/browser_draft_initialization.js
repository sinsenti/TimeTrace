/* Manual async-read and alternate day writer probe. Synthetic isolated daemon only. */
async (page, baseURL) => {
    const results = [];
    for (const fail of [false, true]) {
        const context = await page.context().browser().newContext(), p = await context.newPage();
        const dialogs = [], writes = [], errors = [];
        let release, entered;
        const held = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
        p.on('dialog', async d => {dialogs.push(d.message()); await d.dismiss();});
        p.on('pageerror', e => errors.push(e.message));
        try {
            await context.route('**/api/ai/providers/catalog', r => r.fulfill({json:{}}));
            await context.route('**/rating-definitions?target_type=day', async r => {
                entered(); await held;
                if (fail) await r.fulfill({status:503,json:{detail:'Synthetic held definitions failure'}});
                else await r.continue();
            });
            await p.goto(`${baseURL}/revision#day`); await started;
            await p.locator('#day_form_notes').fill('Typed during held definitions');
            await p.locator('#day_form_rating').selectOption('5');
            p.on('request', r => {if (r.method() !== 'GET') writes.push(r.url());});
            release();
            await p.waitForFunction(failed => failed ? document.getElementById('day_form_save_btn').innerText.includes('Load failed') : dayReviewRatingsReady, fail);
            await p.getByRole('link',{name:'Settings',exact:true}).click();
            if (!p.url().includes('/revision') || dialogs.length !== 1 || await p.locator('#day_form_notes').inputValue() !== 'Typed during held definitions' || await p.locator('#day_form_rating').inputValue() !== '5' || writes.length) throw Error(JSON.stringify({fail,dialogs,writes}));
            if(errors.length) throw Error(errors.join('; '));
            results.push({read:fail ? 'held 503' : 'held success',dialogs,writes,errors});
        } finally {release(); await context.close();}
    }
    const context = await page.context().browser().newContext(), p = await context.newPage();
    const dialogs = [], writes = [], errors = []; let definition;
    p.on('dialog', async d => {dialogs.push(d.message()); await d.dismiss();});
    p.on('pageerror', e => errors.push(e.message));
    try {
        await context.route('**/api/ai/providers/catalog', r => r.fulfill({json:{}}));
        const created = await context.request.post(`${baseURL}/rating-definitions`,{data:{name:'Synthetic Dismiss ownership',target_type:'day',min_score:1,max_score:5}});
        if(!created.ok()) throw Error(`Definition fixture ${created.status()}`);
        definition = await created.json();
        await p.goto(`${baseURL}/revision#day`);
        const range = p.locator(`#rating_range_input_${definition.id}`); await range.waitFor();
        const originalScore = await range.inputValue();
        await p.locator('#day_form_notes').fill('Synthetic persisted Dismiss text');
        await p.locator('#day_form_rating').selectOption('4');
        await range.evaluate(el => {el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});
        let failSummary = false;
        await context.route('**/revision/day-summary?*', r => failSummary ? r.fulfill({status:503,json:{detail:'Synthetic summary refresh failure'}}) : r.continue());
        p.on('request', r => {if(r.method() !== 'GET') writes.push({url:r.url(),body:r.postDataJSON()});});
        const saved = p.waitForResponse(r => r.url().endsWith('/revision/day-review') && r.request().method()==='POST');
        await p.locator('button[onclick="dismissDayReview()"]').click();
        failSummary = true;
        await p.locator('#confirm_modal_proceed_btn').click();
        if(!(await saved).ok()) throw Error('Real Dismiss failed');
        await p.waitForFunction(() => document.getElementById('day_form_save_btn').innerText.includes('Load failed'));
        const date = await p.locator('#day_review_date_input').inputValue();
        const server = await (await context.request.get(`${baseURL}/revision/day-summary?date_str=${date}`)).json();
        if(server.day_review.notes !== 'Synthetic persisted Dismiss text' || server.day_review.rating !== 4 || !server.day_review.review_skipped) throw Error('Dismiss not persisted by real API');
        await p.getByRole('link',{name:'Settings',exact:true}).click();
        if(dialogs.length !== 1 || await range.inputValue() !== '5') throw Error('Pending rating was cleaned');
        await range.evaluate((el, value) => {el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}, originalScore);
        await p.getByRole('link',{name:'Settings',exact:true}).click(); await p.waitForURL('**/settings/ai');
        if(dialogs.length !== 1 || writes.length !== 1 || errors.length) throw Error(JSON.stringify({dialogs,writes,errors}));
        results.push({dismiss:'real POST persisted text/grade/skipped; failed refresh cleans text only',pendingRating:'guarded then clean on reversion',writes,dialogs,errors});
    } finally {if(definition) await context.request.delete(`${baseURL}/rating-definitions/${definition.id}`); await context.close();}
    return results;
};
