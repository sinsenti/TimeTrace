/* Manual scoped dirty navigation, self-link and independent behavior/provider save boundaries. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    const p = await context.newPage();
    const errors = [], dialogs = [], writes = [];
    let accept = false, provider;
    p.on('pageerror', error => errors.push(error.message));
    p.on('dialog', async dialog => {dialogs.push(dialog.message()); if (accept) await dialog.accept(); else await dialog.dismiss();});
    const original = await (await context.request.get(`${baseURL}/api/ai/settings`)).json();
    const go = async () => {
        const loaded = p.waitForResponse(response => response.url() === `${baseURL}/api/ai/settings` && response.request().method() === 'GET');
        await p.goto(`${baseURL}/settings/ai`); await loaded;
        await p.waitForFunction(() => document.getElementById('ai_setting_scheduling_window_days').value !== '');
    };
    const departure = async (dirty, leave = false) => {
        const count = dialogs.length, beforeWrites = writes.length;
        accept = leave;
        await p.getByRole('link',{name:'Calendar',exact:true}).click();
        if (!dirty || leave) await p.waitForURL('**/dashboard**');
        else if (!p.url().endsWith('/settings/ai')) throw Error('Canceled dirty navigation left page');
        if (dialogs.length !== count + (dirty ? 1 : 0)) throw Error(`Unexpected navigation dialogs: ${JSON.stringify(dialogs)}`);
        if (writes.length !== beforeWrites) throw Error('Departure autosaved');
    };
    try {
        await context.route('**/api/ai/providers/catalog', route => route.fulfill({json:{}}));
        await go();
        p.on('request', request => {if (request.method() !== 'GET') writes.push(request.url());});
        const input = p.locator('#ai_setting_custom_instructions');
        await input.fill('Unsaved synthetic standing instructions');
        const documents = []; p.on('request', request => {if (request.resourceType() === 'document') documents.push(request.url());});
        await p.getByRole('link',{name:'Settings',exact:true}).click();
        if (documents.length || dialogs.length || await input.inputValue() !== 'Unsaved synthetic standing instructions') throw Error('Settings self-link reloaded or prompted');
        await departure(true);
        if (await input.inputValue() !== 'Unsaved synthetic standing instructions' || writes.length) throw Error('Canceled departure changed draft');
        await departure(true,true);
        await go();
        await input.fill('Revert me'); await input.fill(original.custom_instructions || '');
        await departure(false);
        await go();
        await input.fill('Saved synthetic behavior');
        await p.locator('#ai_provider_new_btn').click();
        await p.locator('#ai_provider_form_name').fill('Unsaved synthetic provider');
        await p.locator('#ai_settings_save_btn').click();
        await p.waitForFunction(() => document.getElementById('ai_settings_save_status').textContent === 'Saved.');
        await departure(true); // saving behavior did not clear provider draft
        await p.locator('#ai_provider_cancel_btn').click();
        await departure(false); // successful behavior save + provider Cancel are clean
        await go();
        await input.fill('Behavior remains unsaved during provider save');
        await p.locator('#ai_provider_new_btn').click();
        await p.locator('#ai_provider_form_name').fill('Saved synthetic navigation provider');
        await p.locator('#ai_provider_form_provider').selectOption('ollama');
        await p.locator('#ai_provider_form_model').fill('synthetic-no-inference');
        await p.locator('#ai_provider_form_base_url').fill('http://127.0.0.1:9');
        const created = p.waitForResponse(response => response.url() === `${baseURL}/api/ai/providers` && response.request().method() === 'POST');
        await p.locator('#ai_provider_save_btn').click();
        provider = await (await created).json();
        await p.waitForFunction(() => document.getElementById('ai_provider_form_section').classList.contains('hidden'));
        await departure(true); // provider save must not clear behavior edits
        await context.route('**/api/ai/settings', route => route.request().method() === 'PUT' ? route.fulfill({status:503,json:{detail:'Synthetic save failure'}}) : route.continue());
        await p.locator('#ai_settings_save_btn').click();
        await p.waitForFunction(() => document.getElementById('ai_settings_save_status').textContent.startsWith('Failed to save:'));
        await departure(true);
        await input.fill('Saved synthetic behavior');
        await departure(false);
        if (errors.length) throw Error(JSON.stringify(errors));
        return {self:'no reload/prompt',departure:'cancel + explicit leave + clean + reverted + saved + failed-save',independentOwners:true,dialogs,writes,errors,fakes:['catalog','one failed behavior PUT']};
    } finally {
        if (provider?.id) await context.request.delete(`${baseURL}/api/ai/providers/${provider.id}`);
        await context.request.put(`${baseURL}/api/ai/settings`,{data:original});
        await context.close();
    }
};
