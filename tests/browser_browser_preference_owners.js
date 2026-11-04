async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    await context.addInitScript(({expectedOrigin}) => {
        if (location.origin !== expectedOrigin) return;
        localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false}));
    }, {expectedOrigin: new URL(baseURL).origin});
    const p = await context.newPage();
    const checks = [], writes = [], errors = [];
    const check = (condition, text) => { if (!condition) throw Error(text); checks.push(text); };
    p.on('pageerror', error => errors.push(error.message));
    let settings = await (await context.request.get(baseURL + '/api/ai/settings')).json();
    let rejectBehavior = false;
    let providers = [];
    await p.route('**/api/ai/settings', async route => {
        if (route.request().method() === 'PUT') {
            writes.push('behavior');
            if (rejectBehavior) return route.fulfill({status: 503, json: {detail: 'Synthetic behavior failure'}});
            settings = {...settings, ...route.request().postDataJSON()};
        }
        await route.fulfill({json: settings});
    });
    await p.route('**/api/ai/providers', async route => {
        if (route.request().method() === 'POST') {
            writes.push('provider');
            const provider = {...route.request().postDataJSON(), id: '01900000-0000-7000-8000-000000000019', is_active: false, api_key_set: false};
            providers.push(provider);
            return route.fulfill({json: provider});
        }
        await route.fulfill({json: providers});
    });
    await p.goto(baseURL + '/settings/ai');
    await p.waitForFunction(() => aiBehaviorReady && browserSettingsBaseline !== null);
    check(await p.locator('#settings_ai_category').isVisible(), 'old AI entry opens AI category');
    await p.locator('#ai_setting_custom_instructions').fill('Synthetic instruction draft');
    await p.locator('[data-category=browser]').click();
    await p.locator('#setting_calendar_density').selectOption('56');
    await p.locator('[data-category=providers]').click();
    await p.locator('#ai_provider_new_btn').click();
    await p.locator('#ai_provider_form_name').fill('Synthetic independent provider');
    await p.locator('#ai_provider_form_model').fill('synthetic-no-inference');
    await p.locator('#ai_provider_cancel_btn').click();
    check(!await p.evaluate(() => hasSettingsDrafts(['ai_provider_form_section'])), 'existing provider Cancel discards only provider owner');
    check(await p.evaluate(() => hasSettingsDrafts(['settings_modal']) && hasSettingsDrafts(['ai_behavior_settings'])), 'provider Cancel retains Browser and AI drafts');
    await p.locator('#ai_provider_new_btn').click();
    await p.locator('#ai_provider_form_name').fill('Synthetic saved provider');
    await p.locator('#ai_provider_form_model').fill('synthetic-no-inference');
    await p.locator('#ai_provider_save_btn').click();
    await p.waitForFunction(() => document.getElementById('ai_provider_form_section').classList.contains('hidden'));
    check(writes.join() === 'provider' && providers[0].name === 'Synthetic saved provider', 'provider Save writes only fake provider owner');
    check(await p.evaluate(() => hasSettingsDrafts(['settings_modal']) && hasSettingsDrafts(['ai_behavior_settings'])), 'provider Save retains Browser and AI drafts');
    await p.locator('[data-category=ai]').click();
    rejectBehavior = true;
    await p.locator('#ai_settings_save_btn').click();
    await p.waitForFunction(() => document.getElementById('ai_settings_save_status').textContent.startsWith('Failed to save'));
    check(await p.evaluate(() => hasSettingsDrafts(['settings_modal']) && hasSettingsDrafts(['ai_behavior_settings'])), 'failed AI Save retains its owner and Browser draft');
    rejectBehavior = false;
    await p.locator('#ai_settings_save_btn').click();
    await p.waitForFunction(() => document.getElementById('ai_settings_save_status').textContent === 'Saved.');
    check(!await p.evaluate(() => hasSettingsDrafts(['ai_behavior_settings'])), 'successful fake AI Save checkpoints only AI fields');
    check(await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), 'AI Save retains hidden Browser draft');
    check(await p.evaluate(() => getUserSettings().calendarDensity) === 88, 'AI/provider Save did not persist staged Browser density');
    await p.locator('[data-category=browser]').click();
    await p.locator('#browser_save').click();
    await p.waitForFunction(() => document.getElementById('browser_save_status').textContent === 'Browser preferences saved.');
    check(await p.evaluate(() => getUserSettings().calendarDensity) === 56 && settings.custom_instructions === 'Synthetic instruction draft', 'explicit saves independently retain both owners');
    check(writes.join() === 'provider,behavior,behavior' && errors.length === 0, 'only explicit fake writes; no pageerrors');
    await context.close();
    return {checks, writes, fakeBoundaries: ['AI behavior GET/PUT', 'provider CRUD GET/POST', 'provider catalog'], noProviderExecution: true};
};
