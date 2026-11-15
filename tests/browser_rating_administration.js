/* Authored for the current post-15 candidate; unrun until the parent native guard. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    const origin = new URL(baseURL).origin;
    await context.addInitScript(({origin}) => {
        if (location.protocol !== 'http:' || location.origin !== origin) return;
        localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false, enableVimMotions:false}));
    }, {origin});
    const p = await context.newPage();
    const failures = [], requests = [], errors = [];
    let createdId = null;
    p.on('pageerror', error => errors.push(error.message));
    p.on('request', request => { if (['POST','PUT','DELETE'].includes(request.method())) requests.push({url:new URL(request.url()).pathname, method:request.method()}); });
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const api = async (url, options = {}) => {
        const response = await p.request.fetch(baseURL + url, options);
        check(response.ok(), `${options.method || 'GET'} ${url}: ${response.status()}`);
        return response.status() === 204 ? null : response.json();
    };
    const name = 'Synthetic <img src=x onerror="window.ratingExecuted=true">';
    const definition = await api('/rating-definitions', {method:'POST', data:{name, target_type:'day', min_score:-10, max_score:0, is_required:true, description:'Literal <svg onload="window.ratingExecuted=true">'}});
    try {
        await p.goto(baseURL + '/revision#ratings');
        await p.getByRole('button', {name: new RegExp('Synthetic <img')}).waitFor();
        check(!await p.evaluate(() => window.ratingExecuted), 'Definition name executed');
        check(await p.locator('#rating_defs_card_list img, #rating_defs_card_list svg').count() === 0, 'Definition text produced markup');
        await p.locator('.rating-admin-card').filter({hasText:name}).click();
        check(await p.locator('#modal_rating_max').inputValue() === '0', 'Zero upper bound lost');
        await p.locator('#modal_rating_name').fill('Cancelled edit');
        await p.keyboard.press('Escape');
        check((await api('/rating-definitions')).find(d => d.id === definition.id).name === name, 'Escape wrote');
        await p.locator('#ai_launcher_btn').click();
        await p.locator('#ai_drawer.ai-drawer-open').waitFor();
        await p.locator('#rating_defs_new_btn').click();
        await p.keyboard.press('Escape');
        await p.locator('#rating_def_modal').waitFor({state:'hidden'});
        check((await p.locator('#ai_drawer').getAttribute('class')).includes('ai-drawer-open'), 'Rating Escape closed underlying Assistant');
        check(await p.locator('#rating_defs_new_btn').evaluate(el => el === document.activeElement), 'Rating Escape lost launcher focus');
        await p.locator('#ai_drawer_close_btn').click();
        await p.locator('#rating_defs_new_btn').click();
        await p.locator('#modal_rating_name').fill('Native negative-to-zero');
        await p.locator('#modal_rating_min').fill('-10');
        await p.locator('#modal_rating_max').fill('0');
        await p.locator('#modal_rating_target_type').selectOption('task');
        await p.locator('#modal_rating_desc').fill('Created through native controls');
        await p.keyboard.press('Control+Enter');
        await p.locator('#rating_def_modal').waitFor({state:'hidden'});
        await p.getByRole('button', {name:/Native negative-to-zero/}).waitFor();
        const created = (await api('/rating-definitions')).find(d => d.name === 'Native negative-to-zero');
        createdId = created.id;
        check(created.min_score === -10 && created.max_score === 0 && created.target_type === 'task', 'Native CRUD bounds/context mismatch');
        check(await p.locator('#rating_defs_new_btn').evaluate(el => el === document.activeElement), 'Successful Save lost stable focus after list replacement');
        await p.getByRole('button', {name:/Native negative-to-zero/}).click();
        await p.locator('#modal_rating_desc').fill('Edited through native controls');
        await p.locator('#modal_rating_save_btn').click();
        await p.locator('#rating_def_modal').waitFor({state:'hidden'});
        await p.waitForFunction(() => !document.getElementById('rating_defs_card_list').matches('[aria-busy="true"]'));
        check(await p.locator('#rating_defs_new_btn').evaluate(el => el === document.activeElement), 'Edit Save lost stable focus after replacing its launcher');
        check((await api('/rating-definitions')).find(d => d.id === created.id).description === 'Edited through native controls', 'Native edit not persisted');
        await p.getByRole('button', {name:/Native negative-to-zero/}).click();
        await p.locator('#modal_rating_delete_btn').click();
        await p.keyboard.press('Escape');
        check((await api('/rating-definitions')).some(d => d.id === created.id), 'Confirmation Escape deleted');
        await p.locator('#modal_rating_delete_btn').click();
        await p.locator('#confirm_modal_proceed_btn').click();
        await p.locator('#rating_def_modal').waitFor({state:'hidden'});
        check(!(await api('/rating-definitions')).some(d => d.id === created.id), 'Confirmed deletion did not remove row');
        const samples = [];
        for (const theme of ['refined','stone','porcelain','dark']) {
            for (const width of [320,375,768,1280]) {
                await p.setViewportSize({width, height:900});
                await p.evaluate(theme => {
                    setAppearancePreference('appearance', theme === 'dark' ? 'dark' : 'light');
                    if (theme !== 'dark') setAppearancePreference('lightTheme', theme);
                }, theme);
                await p.locator('#rating_defs_new_btn').click();
                const sample = await p.evaluate(() => {
                    const rgb = color => (color.match(/[\d.]+/g) || []).slice(0,3).map(Number);
                    const luminance = color => rgb(color).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((n,v,i) => n+v*[.2126,.7152,.0722][i],0);
                    const contrast = (a,b) => {const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
                    const backdrop = el => { while(el) { const color = getComputedStyle(el).backgroundColor; if(color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color; el=el.parentElement; } return 'rgb(255,255,255)'; };
                    const modal = document.querySelector('.rating-admin-dialog');
                    const rect = modal.getBoundingClientRect();
                    const text = [...modal.querySelectorAll('h3,label,input:not([type=hidden]):not([type=checkbox]),select,button,small,p')].filter(el => el.getClientRects().length).map(el => ({id:el.id || el.tagName, ratio:contrast(getComputedStyle(el).color, backdrop(el))}));
                    const controls = [...modal.querySelectorAll('input:not([type=hidden]):not([type=checkbox]),select')].map(el => ({id:el.id, ratio:contrast(getComputedStyle(el).borderTopColor, backdrop(el))}));
                    return {rect:{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom},text,controls,overflow:document.documentElement.scrollWidth > innerWidth};
                });
                samples.push({theme,width,...sample});
                check(sample.rect.x >= 0 && sample.rect.right <= width && sample.rect.y >= 0 && sample.rect.bottom <= 900, `Modal outside viewport ${theme}/${width}`);
                check(!sample.overflow, `Page overflow ${theme}/${width}`);
                for (const item of sample.text) if (item.ratio < 4.5) failures.push({theme,width,...item});
                for (const item of sample.controls) if (item.ratio < 3) failures.push({theme,width,control:true,...item});
                await p.locator('#modal_rating_name').focus();
                await p.keyboard.press('Shift+Tab');
                check(await p.locator('[aria-label="Close rating scale"]').evaluate(el => el === document.activeElement), 'Reverse Tab trap missing');
                await p.keyboard.press('Shift+Tab');
                check(await p.locator('#modal_rating_save_btn').evaluate(el => el === document.activeElement), 'Tab escaped rating dialog');
                await p.keyboard.press('Escape');
            }
        }
        check(failures.length === 0, `Contrast failures ${JSON.stringify(failures)}`);
        check(errors.length === 0, `Page errors: ${errors.join('; ')}`);
        return {requests, errors, samples, contrastFailures:failures, nativeCRUD:true, literalCards:true, keyboard:true};
    } finally {
        await api(`/rating-definitions/${definition.id}`, {method:'DELETE'});
        if (createdId && (await api('/rating-definitions')).some(d => d.id === createdId)) await api(`/rating-definitions/${createdId}`, {method:'DELETE'});
        await context.close();
    }
}
