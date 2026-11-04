async (page, baseURL) => {
    const checks = [];
    const check = (condition, name) => { if (!condition) throw Error(name); checks.push(name); };
    const context = await page.context().browser().newContext();
    await context.addInitScript(({expectedOrigin}) => {
        if (location.origin !== expectedOrigin) return;
        if (!localStorage.getItem('timetrace_user_settings')) localStorage.setItem('timetrace_user_settings', JSON.stringify({
            theme: 'nord', idleDetectorEnabled: false, firstDayOfWeek: 0, slotDuration: 30,
            lastSelectedSlot: 45, lastSelectedView: 'timeGridThreeDay', colorSeed: 19,
            hideLeftSidebar: 'true', taskView: 'outline', customColor: '<img src=x onerror=alert(1)>',
            enableVimMotions: false, enableSessionReview: false, autoScrollNow: false
        }));
        localStorage.setItem('timetrace_left_sidebar_width', '333');
    }, {expectedOrigin: new URL(baseURL).origin});
    const p = await context.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    const writes = [];
    p.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
    await p.goto(baseURL + '/settings');
    await p.waitForFunction(() => typeof browserSettingsBaseline !== 'undefined' && browserSettingsBaseline !== null && aiBehaviorReady);
    check(await p.locator('#setting_appearance').inputValue() === 'dark', 'valid legacy palette adopts manual dark');
    check(await p.locator('#setting_task_view').inputValue() === 'outline', 'legacy Outline retained');
    const before = await p.evaluate(() => localStorage.getItem('timetrace_user_settings'));
    await p.locator('#setting_calendar_density').selectOption('56');
    await p.locator('#setting_first_day').selectOption('1');
    await p.locator('[data-category=ai]').click();
    await p.locator('#ai_setting_custom_instructions').fill('Synthetic independent AI draft\n<img src=x onerror=alert(1)>');
    await p.locator('[data-category=providers]').click();
    await p.locator('#ai_provider_new_btn').click();
    await p.locator('#ai_provider_form_name').fill('Synthetic provider draft');
    await p.locator('[data-category=browser]').click();
    check(await p.locator('#setting_calendar_density').inputValue() === '56', 'Browser draft retained across categories');
    check(await p.evaluate(() => localStorage.getItem('timetrace_user_settings')) === before, 'category switching does not persist Browser draft');
    check(writes.length === 0, 'category switching writes no HTTP owners');
    await p.goBack();
    check(await p.locator('#settings_providers_category').isVisible(), 'Back restores Providers category');
    await p.goForward();
    check(await p.locator('#settings_browser_category').isVisible(), 'Forward restores Browser category');
    await p.locator('#setting_first_day').focus();
    await p.keyboard.press('Control+Enter');
    await p.waitForFunction(() => document.getElementById('browser_save_status').textContent === 'Browser preferences saved.');
    let saved = await p.evaluate(() => JSON.parse(localStorage.getItem('timetrace_user_settings')));
    check(saved.calendarDensity === 56 && saved.firstDayOfWeek === 1 && saved.colorSeed === 19 && saved.lastSelectedSlot === 45 && saved.customColor.includes('<img'), 'Save captures Browser fields and preserves remembered/colors/unknown data');
    check(writes.length === 0, 'non-idle Browser Save never writes DB or daemon');
    check(await p.evaluate(() => hasSettingsDrafts(['ai_behavior_settings', 'ai_provider_form_section'])), 'Browser Save leaves AI/provider owners dirty');
    await p.locator('#setting_calendar_density').selectOption('72');
    await p.locator('#appearance_toggle').click();
    saved = await p.evaluate(() => JSON.parse(localStorage.getItem('timetrace_user_settings')));
    check(saved.calendarDensity === 56 && saved.appearance === 'light', 'Theme-only writer does not save unsaved density');
    check(await p.locator('#setting_calendar_density').inputValue() === '72', 'Theme-only writer retains draft');
    await p.locator('#browser_cancel').click();
    check(await p.locator('#setting_calendar_density').inputValue() === '56', 'Cancel restores saved fields not factory defaults');
    check(await p.evaluate(() => hasSettingsDrafts(['ai_behavior_settings', 'ai_provider_form_section'])), 'Browser Cancel retains independent owners');
    let warned = false;
    p.once('dialog', async d => { warned = true; await d.dismiss(); });
    await p.locator('a[href="/tasks"]').click();
    check(warned && new URL(p.url()).pathname === '/settings', 'dirty hidden owners warn before departure');
    // Leave/reload explicitly discards only unsaved owner drafts, never autosaves them.
    p.on('dialog', d => d.accept());
    await p.reload();
    await p.waitForFunction(() => aiBehaviorReady && browserSettingsBaseline !== null);
    check(await p.locator('#setting_calendar_density').inputValue() === '56', 'actual reload reads saved Browser density');
    check(await p.locator('#setting_first_day').inputValue() === '1', 'actual reload reads saved week start');
    check(await p.locator('#ai_setting_custom_instructions').inputValue() === '', 'Browser Save did not save AI draft');
    await p.locator('[data-category=ai]').click();
    await p.locator('#ai_setting_custom_instructions').fill('Keyboard only');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Second line');
    await p.keyboard.press('Control+Enter');
    check(writes.length === 0, 'ordinary Enter and AI CtrlEnter do not trigger Browser save');
    await p.locator('[data-category=browser]').click();
    // Client storage failures are synthetic, not quota exhaustion on personal storage.
    await p.evaluate(() => { window.originalSetItem19 = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw Error('synthetic quota'); }; });
    await p.locator('#setting_first_day').selectOption('0');
    await p.locator('#browser_save').click();
    check((await p.locator('#browser_save_status').textContent()).includes('Could not save'), 'client storage rejection is not success');
    check(await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), 'storage failure retains dirty Browser draft');
    await p.evaluate(() => { Storage.prototype.setItem = window.originalSetItem19; });
    // Fake idle transport rejection; no real OS-idle detection is enabled.
    let finishIdle;
    await p.route('**/idle/toggle', async route => {
        await new Promise(resolve => { finishIdle = resolve; });
        await route.fulfill({status: 503, json: {detail: 'Synthetic idle failure'}});
    });
    await p.locator('#setting_idle_detector').check();
    await p.locator('#browser_save').click();
    await p.waitForFunction(() => document.getElementById('browser_save_status').textContent.includes('Updating daemon'));
    check(await p.locator('#browser_save').isDisabled(), 'held idle save blocks duplicate activation');
    await p.locator('#setting_first_day').selectOption('1');
    await p.locator('#appearance_toggle').click();
    check(writes.filter(url => url.endsWith('/idle/toggle')).length === 1, 'theme during held idle sends no additional idle write');
    await p.locator('#browser_reshuffle').click();
    check(writes.filter(url => url.endsWith('/idle/toggle')).length === 1, 'color-only reshuffle during pending idle sends no additional daemon write');
    check(await p.locator('#setting_first_day').inputValue() === '1' && await p.evaluate(() => getUserSettings().firstDayOfWeek) === 0, 'reshuffle retains concurrent unsaved form fields');
    finishIdle();
    await p.waitForFunction(() => document.getElementById('browser_save_status').textContent.includes('not confirmed'));
    check(await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), 'partial idle failure and concurrent edit remain guarded');
    await p.locator('#browser_cancel').click();
    check(await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), 'Cancel cannot disguise pending daemon acknowledgement');
    await p.unroute('**/idle/toggle');
    await p.route('**/idle/toggle', route => route.fulfill({json: {status: 'success', enabled: true}}));
    await p.locator('#browser_save').click();
    await p.waitForFunction(() => document.getElementById('browser_save_status').textContent === 'Browser preferences saved.');
    check(!await p.evaluate(() => hasSettingsDrafts(['settings_modal'])), 'explicit fake idle retry acknowledges only Browser owner');
    check(writes.filter(url => url.endsWith('/idle/toggle')).length === 2, 'idle failure requires exactly one explicit retry');
    await p.evaluate(() => { const s = getUserSettings(); s.idleDetectorEnabled = false; saveUserSettings(s); });
    await p.goto(baseURL + '/dashboard');
    await p.waitForFunction(() => typeof calendar !== 'undefined' && calendar && document.documentElement.style.getPropertyValue('--calendar-slot-height'));
    check(await p.evaluate(() => calendar.getOption('firstDay')) === 0, 'real Calendar consumes saved week-start after Cancel to captured stored value');
    check(await p.evaluate(() => document.documentElement.style.getPropertyValue('--calendar-slot-height')) === '28px', 'real Calendar consumes density and 30-minute slots');
    check(!await p.locator('#left_sidebar').isVisible(), 'real Calendar consumes saved sidebar preference');
    check(await p.evaluate(() => calendar.view.type) === 'timeGridThreeDay', 'real Calendar consumes remembered starting view');
    check(await p.evaluate(() => defaultDurationMinutes) === 30, 'real default session duration consumes saved slot interval');
    check((await p.locator('#vim_mode_indicator').textContent()).includes('VIM OFF'), 'real Vim indicator consumes disabled preference');
    check(await p.evaluate(() => document.getElementById('left_sidebar').style.width) === '333px', 'real sidebar resizer consumes separate stored width');
    check(await p.evaluate(() => getTaskColor({id: 'synthetic', color: '#123456'})) === '#123456', 'actual color caller preserves explicit task color');
    check(await p.evaluate(() => getUserSettings().autoScrollNow) === false, 'Calendar retains disabled auto-scroll preference');
    await p.goto(baseURL + '/revision#sessions');
    await p.waitForFunction(() => typeof currentActiveRevTab !== 'undefined');
    check(!await p.locator('#rev_tab_btn_sessions').isVisible(), 'real Revision hides disabled Session Review entry');
    check(await p.evaluate(() => currentActiveRevTab) !== 'sessions', 'real Revision redirects disabled Session Review deep link');
    await p.goto(baseURL + '/revision#day');
    await p.waitForFunction(() => dayReviewTextReady && dayReviewRatingsReady);
    await p.locator('#day_form_notes').fill('Retained synthetic day draft');
    await p.getByRole('button', {name: 'Preferences', exact: true}).click();
    await p.locator('#setting_enable_session_review').check();
    await p.locator('#settings_modal button[onclick="saveSettingsFromModal()"]').click();
    await p.waitForFunction(() => document.getElementById('settings_modal').classList.contains('hidden'));
    check(await p.locator('#rev_tab_btn_sessions').isVisible(), 'old Preferences entry still applies Session Review without navigation');
    check(await p.locator('#day_form_notes').inputValue() === 'Retained synthetic day draft', 'old Preferences Save preserves independent Day draft');
    check(await p.evaluate(() => localStorage.getItem('timetrace_left_sidebar_width')) === '333', 'separate sidebar storage is retained');
    check(errors.length === 0, 'vertical workflow has no pageerrors');
    await context.close();
    const samples = [];
    for (const width of [390, 768, 1024, 1440]) {
        for (const treatment of ['refined', 'stone', 'porcelain', 'dark']) {
            const c = await page.context().browser().newContext({viewport: {width, height: 900}});
            await c.addInitScript(({treatment, expectedOrigin}) => {
                if (location.origin !== expectedOrigin) return;
                localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, appearance: treatment === 'dark' ? 'dark' : 'light', lightTheme: treatment === 'dark' ? 'refined' : treatment}));
            }, {treatment, expectedOrigin: new URL(baseURL).origin});
            const q = await c.newPage();
            await q.goto(baseURL + '/settings');
            await q.waitForFunction(() => browserSettingsBaseline !== null);
            const sample = await q.evaluate(() => {
                const style = getComputedStyle(document.getElementById('setting_first_day'));
                const luminance = rgb => {
                    const c = rgb.match(/\d+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
                    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
                };
                const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
                return {width: innerWidth, scroll: document.documentElement.scrollWidth, foreground: style.color, background: style.backgroundColor,
                    textContrast: ratio(style.color, style.backgroundColor), borderContrast: ratio(style.borderTopColor, style.backgroundColor)};
            });
            check(sample.textContrast >= 4.5 && sample.borderContrast >= 3, `${width}/${treatment}: sampled input text and border contrast`);
            check(sample.scroll <= width, `${width}/${treatment}: no horizontal overflow`);
            await q.locator('#setting_first_day').focus();
            await q.keyboard.press('Tab');
            check(await q.evaluate(() => document.activeElement.id) === 'setting_slot_duration', `${width}/${treatment}: native Tab follows labeled inputs`);
            samples.push({...sample, treatment});
            await c.close();
        }
    }
    // Genuine fresh defaults and invalid-neighbor adoption in separate browser contexts.
    const fresh = await page.context().browser().newContext();
    const f = await fresh.newPage();
    await f.goto(baseURL + '/settings');
    await f.waitForFunction(() => browserSettingsBaseline !== null);
    check(await f.locator('#setting_light_theme').inputValue() === 'refined' && await f.locator('#setting_appearance').inputValue() === 'light', 'fresh browser starts Refined Archive/light');
    await f.evaluate(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({calendarDensity: 7, taskView: 'bad', firstDayOfWeek: 0, theme: 'dracula', colorSeed: 55, lightTheme: 'bad', customColor: '#abcdef', idleDetectorEnabled: false})));
    await f.reload();
    await f.waitForFunction(() => browserSettingsBaseline !== null);
    check(await f.locator('#setting_calendar_density').inputValue() === '88' && await f.locator('#setting_task_view').inputValue() === 'kanban' && await f.locator('#setting_first_day').inputValue() === '0', 'invalid individual fields default without resetting valid neighbor');
    await fresh.close();
    return {checks, samples, fakeBoundaries: ['provider catalog', 'idle toggle transport held/reject/ack'], limits: ['No real OS idle or provider execution', 'No physical touch, screen reader, other engines, zoom, reduced-motion or exhaustive accessibility certification']};
};
