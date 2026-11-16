/* Manual held/failed metadata boundary; public controls remain authoritative during startup. */
async (page, baseURL) => {
    const results = [];
    for (const failed of [false,true]) {
        const context = await page.context().browser().newContext({viewport:{width:1440,height:1000}});
        const p = await context.newPage();
        const errors = [];
        p.on('pageerror', error => errors.push(error.message));
        let release, entered;
        const held = new Promise(resolve => release = resolve);
        const intercepted = new Promise(resolve => entered = resolve);
        try {
            await context.route('**/api/ai/providers/catalog', route => route.fulfill({json:{}}));
            await context.route(url => url.pathname === '/api/tasks' && url.searchParams.get('status') === 'all', async route => {
                entered(); await held;
                if (failed) await route.fulfill({status:503,json:{detail:'Synthetic held metadata failure'}});
                else await route.continue();
            });
            await p.goto(`${baseURL}/dashboard?date=2026-10-17&view=timeGridThreeDay&tag=%23synthetic`,{waitUntil:'domcontentloaded'});
            await intercepted;
            await p.locator('#appearance_toggle').click();
            await p.locator('#appearance_light_theme').selectOption('porcelain');
            await p.locator('#calendar_density').selectOption('56');
            await p.locator('#btn_toggle_right_sidebar').click();
            release();
            await p.waitForSelector('.fc-timegrid-slot');
            await p.waitForFunction(() => typeof calendar !== 'undefined' && calendar && calendar.view.type === 'timeGridThreeDay');
            const state = await p.evaluate(() => ({
                appearance:document.documentElement.dataset.appearance,
                lightTheme:document.documentElement.dataset.lightTheme,
                height:document.documentElement.style.getPropertyValue('--calendar-slot-height'),
                totals:!document.getElementById('right_sidebar').classList.contains('hidden'),
                selectedDensity:document.getElementById('calendar_density').value,
                prefs:getUserSettings(),view:calendar.view.type,date:calendar.getDate().getDate(),
                tag:breakdownFilter?.value,url:new URL(location.href).searchParams.get('tag')
            }));
            if (state.appearance !== 'dark' || state.lightTheme !== 'porcelain' || state.height !== '14px' ||
                !state.totals || state.selectedDensity !== '56' || state.prefs.calendarDensity !== 56 ||
                state.prefs.appearance !== 'dark' || !state.prefs.totalsVisible || state.date !== 17 ||
                state.tag !== '#synthetic' || state.url !== '#synthetic' || errors.length) throw Error(JSON.stringify({failed,state,errors}));
            results.push({failed,state,errors});
        } finally {release(); await context.close();}
    }
    return {results};
};
