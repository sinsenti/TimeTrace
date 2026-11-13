// Authored isolated native acceptance probe; run only on a disposable synthetic daemon.
async (page, baseURL) => {
    const checks = [];
    const check = (value, name) => { if (!value) throw Error(name); checks.push(name); };
    const origin = new URL(baseURL);
    if (!['localhost', '127.0.0.1'].includes(origin.hostname) || origin.port === '8002') throw Error('Use an isolated non-8002 daemon');
    const context = await page.context().browser().newContext();
    try {
        await context.addInitScript(({expectedOrigin}) => {
            if (location.origin !== expectedOrigin) return;
            localStorage.setItem('timetrace_dashboard_visible_sidebar_tabs', '[]');
            localStorage.setItem('timetrace_dashboard_custom_filter', JSON.stringify({query:'synthetic',status:'all',category:'all',estOp:'lte',estMins:37,priority:'all'}));
            localStorage.setItem('timetrace_left_sidebar_width','333');
        }, {expectedOrigin:origin.origin});
        const p = await context.newPage();
        await p.goto(baseURL + '/dashboard?task=__none__');
        await p.waitForFunction(() => typeof openCustomFilterModal === 'function');
        const chip = await p.locator('#breakdown_filter_chip').textContent();
        await p.locator('.custom-filter-trigger-btn').click();
        check(await p.locator('#filter_input_est_mins').inputValue() === '37', 'saved arbitrary estimate remains representable');
        await p.locator('#filter_input_query').fill('discard');
        await p.keyboard.press('Escape');
        await p.locator('.custom-filter-trigger-btn').click();
        check(await p.locator('#filter_input_query').inputValue() === 'synthetic', 'Escape discards uncommitted filter edits');
        await p.locator('#filter_input_query').fill('new synthetic');
        await p.keyboard.press('Control+Enter');
        check(await p.evaluate(() => JSON.parse(localStorage.getItem('timetrace_dashboard_custom_filter')).query) === 'new synthetic', 'Ctrl Enter applies saved filter');
        check(await p.locator('#breakdown_filter_chip').textContent() === chip, 'advanced task filter retains separate session chip');
        check(await p.evaluate(() => localStorage.getItem('timetrace_left_sidebar_width')) === '333', 'filter saves retain sidebar width');
        await p.evaluate(() => openSidebarTabsConfigModal());
        await p.locator('#sidebar_tab_config_modal').waitFor({state:'visible'});
        await p.waitForFunction(() => document.querySelectorAll('#sidebar_tab_config_list input').length > 0);
        check(await p.locator('#sidebar_tab_config_list input:checked').count() === 0, 'explicit empty tabs retained');
        await p.locator('#sidebar_tab_config_list input').first().check();
        await p.evaluate(() => closeSidebarTabsConfigModal());
        await p.locator('.custom-filter-trigger-btn').click();
        await p.getByRole('button',{name:'Clear Filter',exact:true}).click();
        check(await p.evaluate(() => JSON.parse(localStorage.getItem('timetrace_dashboard_custom_filter')).isActive) === false, 'Clear resets only advanced task filter');
        await p.route('**/api/tasks?*', route => route.fulfill({json:[
            {id:'019adc00-1234-7000-8000-000000000002',title:'synthetic matching',status:'Ready',category:'work',estimated_minutes:30,priority:'high'},
            {id:'019adc00-1234-7000-8000-000000000003',title:'synthetic excluded',status:'Ready',category:'work',estimated_minutes:45,priority:'high'}
        ]}));
        await p.route('**/api/tasks/statuses', route => route.fulfill({json:[{id:'019adc00-1234-7000-8000-000000000001',name:'Ready',position:0}]}));
        await p.goto(baseURL + '/tasks');
        await p.locator('#task_view_selector').selectOption('grouped');
        await p.locator('.custom-filter-trigger-btn').click();
        await p.locator('#filter_input_query').fill('synthetic');
        await p.locator('#filter_input_est_op').selectOption('lte');
        await p.locator('#filter_input_est_mins').selectOption('30');
        await p.keyboard.press('Control+Enter');
        await p.getByRole('link',{name:'synthetic matching',exact:true}).waitFor({state:'visible'});
        check(await p.getByRole('link',{name:'synthetic excluded',exact:true}).count() === 0, 'Grouped actual caller composes advanced estimate filter');
        check(await p.locator('#task_view_selector').inputValue() === 'grouped', 'Apply retains Grouped choice');
        await p.locator('.custom-filter-trigger-btn').click();
        await p.getByRole('button',{name:'Clear Filter',exact:true}).click();
        await p.getByRole('link',{name:'synthetic excluded',exact:true}).waitFor({state:'visible'});
        return {checks, unrun:['Combined07 Outline dirty inspector and21 fullscreen restoration require authorized integration','Physical touch and screen reader acceptance']};
    } finally { await context.close(); }
};
