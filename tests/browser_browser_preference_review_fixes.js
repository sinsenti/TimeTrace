async (page, baseURL) => {
    const checks = [], failures = [], errors = [], profiles = [];
    const check = (ok, name, actual) => {
        checks.push({name, ok: Boolean(ok), actual});
        if (!ok) failures.push(name);
    };
    const open = async initialIdle => {
        const context = await page.context().browser().newContext();
        const writes = [], idle = [];
        // Every idle POST is transport-faked before navigation, including startup reconciliation.
        await context.route('**/idle/toggle', async route => {
            const request = route.request(), body = request.postDataJSON();
            if (request.method() !== 'POST' || Object.keys(body).join() !== 'enabled' || typeof body.enabled !== 'boolean') {
                throw Error('Unexpected idle transport contract');
            }
            idle.push(body.enabled);
            await route.fulfill(idle.length === 1
                ? {status: 503, json: {detail: 'Synthetic idle rejection'}}
                : {json: {idle_detection_enabled: body.enabled}});
        });
        await context.addInitScript(({expectedOrigin, initialIdle}) => {
            if (location.origin !== expectedOrigin) return;
            if (!localStorage.getItem('timetrace_user_settings')) localStorage.setItem('timetrace_user_settings', JSON.stringify({
                idleDetectorEnabled: initialIdle, calendarDensity: 88, firstDayOfWeek: 1, enableVimMotions: false
            }));
        }, {expectedOrigin: new URL(baseURL).origin, initialIdle});
        const p = await context.newPage();
        p.on('pageerror', error => errors.push({message: error.message, stack: error.stack}));
        p.on('request', request => {
            if (!['GET', 'HEAD'].includes(request.method())) writes.push({url: request.url(), method: request.method(), body: request.postDataJSON()});
        });
        await p.goto(baseURL + '/settings');
        await p.waitForFunction(() => browserSettingsBaseline !== null && aiBehaviorReady);
        return {context, p, writes, idle};
    };
    for (const initialIdle of [false, true]) {
        const {context, p, writes, idle} = await open(initialIdle);
        try {
            const checkbox = p.locator('#setting_idle_detector');
            await checkbox.setChecked(!initialIdle);
            await p.locator('#browser_save').click();
            await p.waitForFunction(() => document.getElementById('browser_save_status').textContent.includes('not confirmed'));
            check(await checkbox.isChecked() === !initialIdle, `failed ${!initialIdle}: visible submitted value retained`);
            check(await p.evaluate(() => getUserSettings().idleDetectorEnabled) === !initialIdle, `failed ${!initialIdle}: browser storage captured submitted value`);
            check(await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), `failed ${!initialIdle}: daemon acknowledgement stays dirty`);
            await checkbox.setChecked(initialIdle);
            await p.locator('#browser_save').click();
            await p.waitForFunction(() => !browserSettingsSaving);
            check(JSON.stringify(idle) === JSON.stringify([!initialIdle, initialIdle]), `reversal ${!initialIdle} to ${initialIdle}: exact submitted POST sequence`, [...idle]);
            check(await p.evaluate(() => getUserSettings().idleDetectorEnabled) === initialIdle, `reversal to ${initialIdle}: storage matches control`);
            check(await checkbox.isChecked() === initialIdle, `reversal to ${initialIdle}: control retained`);
            check(!await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), `reversal to ${initialIdle}: acknowledged owner clean`);
            check((await p.locator('#browser_save_status').textContent()) === 'Browser preferences saved.', `reversal to ${initialIdle}: honest success after ACK`);
            profiles.push({initialIdle, idle: [...idle], writes});
        } finally { await context.close(); }
    }
    const {context, p, writes} = await open(false);
    try {
        await p.locator('[data-category=ai]').click();
        await p.locator('#ai_setting_custom_instructions').fill('Independent unsaved AI text');
        await p.locator('[data-category=browser]').click();
        await p.locator('#setting_calendar_density').selectOption('56');
        await p.locator('#setting_first_day').selectOption('0');
        const storage = await p.evaluate(() => localStorage.getItem('timetrace_user_settings'));
        const url = p.url(), writeCount = writes.length;
        await p.locator('#appearance_light_theme').focus();
        await p.keyboard.press('Escape');
        check(await p.locator('#setting_calendar_density').inputValue() === '56', 'navbar Escape retains density draft');
        check(await p.locator('#setting_first_day').inputValue() === '0', 'navbar Escape retains other Browser field');
        check(await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), 'navbar Escape retains dirty Browser ownership');
        check(await p.evaluate(() => localStorage.getItem('timetrace_user_settings')) === storage, 'navbar Escape does not persist storage');
        check(p.url() === url, 'navbar Escape keeps URL');
        check(await p.evaluate(() => document.activeElement.id) === 'appearance_light_theme', 'navbar Escape keeps native focus');
        check(writes.length === writeCount, 'navbar Escape sends no HTTP writes');
        await p.locator('#setting_calendar_density').focus();
        await p.keyboard.press('Escape');
        check(await p.locator('#setting_calendar_density').inputValue() === '88', 'inside Browser Escape explicitly cancels own density');
        check(await p.locator('#setting_first_day').inputValue() === '1', 'inside Browser Escape cancels own other field');
        check(!await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), 'inside Browser Escape cleans only Browser');
        check(await p.evaluate(() => hasSettingsDrafts(['ai_behavior_settings'])), 'inside Browser Escape retains independent AI owner');
        check(writes.length === writeCount, 'scoped Cancel sends no HTTP writes');
        profiles.push({outsideEscape: true, writes});
    } finally { await context.close(); }
    check(errors.length === 0, 'actual pageerror array is empty', errors);
    return {verdict: failures.length ? 'FAIL' : 'PASS', checks, failures, errors, profiles,
        fakes: ['provider catalog via passive runner', 'ALL exact idle POSTs before goto; first rejects, subsequent ACK actual response key'],
        limits: ['Native Chromium keyboard, not physical touch/screen reader or other-engine certification', 'No real OS idle enabled or provider execution']};
}
