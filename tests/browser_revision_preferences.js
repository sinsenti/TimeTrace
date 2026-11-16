/* Manual real day editor/rating regression through Preferences Save and Settings departure. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    const p = await context.newPage();
    const errors = [], writes = [];
    p.on('pageerror', error => errors.push(error.message));
    let definition;
    try {
        await context.route('**/api/ai/providers/catalog', route => route.fulfill({json:{}}));
        const response = await context.request.post(`${baseURL}/rating-definitions`,{data:{name:'Synthetic day reflection',target_type:'day',min_score:1,max_score:5}});
        if (!response.ok()) throw Error(`Rating fixture: ${response.status()}`);
        definition = await response.json();
        await p.goto(`${baseURL}/revision#day`);
        const range = p.locator(`#rating_range_input_${definition.id}`);
        await range.waitFor();
        await p.locator('#day_form_notes').fill('Unsaved synthetic reflection');
        await p.locator('#day_form_rating').selectOption('5');
        await range.evaluate(input => {input.value = '4'; input.dispatchEvent(new Event('input',{bubbles:true}));});
        await p.locator(`#dismiss_btn_${definition.id}`).click();
        p.on('request', request => {if (request.method() !== 'GET') writes.push(request.url());});
        await p.getByRole('button',{name:'Preferences',exact:true}).click();
        await p.locator('#setting_appearance').selectOption('dark');
        await p.locator('#setting_light_theme').selectOption('stone');
        await p.locator('#settings_modal button[onclick="saveSettingsFromModal()"] ').click();
        await p.waitForFunction(() => document.getElementById('settings_modal').classList.contains('hidden'));
        // Wait for actual outstanding summary/rating reads, not a token-only helper invocation.
        await p.evaluate(() => new Promise(resolve => setTimeout(resolve,250)));
        const assertDraft = async () => {
            if (await p.locator('#day_form_notes').inputValue() !== 'Unsaved synthetic reflection' ||
                await p.locator('#day_form_rating').inputValue() !== '5' || await range.inputValue() !== '4' ||
                !await range.isDisabled() || await p.locator(`#dismiss_btn_${definition.id}`).innerText() !== 'Undismiss') throw Error('Revision text/rating/dismissal draft was replaced');
        };
        await assertDraft();
        const preferenceConfigWrites = writes.filter(url => new URL(url).pathname === '/idle/toggle');
        const domainWrites = writes.filter(url => new URL(url).pathname !== '/idle/toggle');
        if (domainWrites.length) throw Error(`Preferences mutated task/review/rating data: ${domainWrites}`);
        const afterPreferencesWrites = writes.length;
        p.once('dialog', dialog => dialog.dismiss());
        await p.getByRole('link',{name:'Settings',exact:true}).click();
        await assertDraft();
        if (!p.url().includes('/revision')) throw Error('Canceled departure navigated');
        if (writes.length !== afterPreferencesWrites) throw Error(`Canceled navigation sent writes: ${writes.slice(afterPreferencesWrites)}`);
        p.once('dialog', dialog => dialog.accept());
        await p.getByRole('link',{name:'Settings',exact:true}).click();
        await p.waitForURL('**/settings/ai');
        if (writes.length !== afterPreferencesWrites || errors.length) throw Error(JSON.stringify({writes,errors}));
        return {preferencesSave:'text + grade + custom score + dismissal retained',navigation:'cancel retains drafts, explicit leave navigates',domainWrites,navigationWrites:[],preferenceConfigWrites,errors};
    } finally {
        if (definition) await context.request.delete(`${baseURL}/rating-definitions/${definition.id}`);
        await context.close();
    }
};
