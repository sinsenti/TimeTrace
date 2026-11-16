/* Manual Chart.js public-interface regression; isolated daemon + synthetic data only. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    const p = await context.newPage();
    const writes = [];
    try {
        await p.goto(`${baseURL}/stats`);
        await p.waitForFunction(() => typeof Chart !== 'undefined' && Object.keys(Chart.instances).length > 0);
        await p.getByRole('button', { name: '+ Add Widget', exact: true }).click();
        await p.locator('#wb_title').fill('Unsaved synthetic widget');
        const dataBefore = await p.evaluate(() => JSON.stringify(Object.values(Chart.instances).map(chart => chart.data)));
        p.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
        const results = [];
        for (const theme of ['refined', 'stone', 'porcelain']) {
            await p.evaluate(choice => { setAppearancePreference('lightTheme', choice); setAppearancePreference('appearance', 'light'); }, theme);
            const light = await p.evaluate(() => {
                const expected = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
                return Object.values(Chart.instances).every(chart => chart.options.plugins.legend.labels.color === expected && Object.values(chart.options.scales || {}).every(axis => !axis.ticks || axis.ticks.color === expected));
            });
            if (!light) throw Error(`${theme}: chart labels do not follow light theme`);
            if (await p.locator('#wb_title').inputValue() !== 'Unsaved synthetic widget') throw Error('Theme replaced builder draft');
            await p.evaluate(() => setAppearancePreference('appearance', 'dark'));
            const dark = await p.evaluate(() => Object.values(Chart.instances).every(chart => chart.options.plugins.legend.labels.color === '#94a3b8' && Object.values(chart.options.scales || {}).every(axis => !axis.ticks || axis.ticks.color === '#64748b')));
            if (!dark) throw Error(`${theme}: previous dark neutral colors not restored`);
            results.push(theme);
        }
        const dataAfter = await p.evaluate(() => JSON.stringify(Object.values(Chart.instances).map(chart => chart.data)));
        if (dataAfter !== dataBefore || writes.length) throw Error(`Appearance changed chart data or sent writes: ${writes}`);
        return { passed: results.length, themes: results, writes };
    } finally {
        await context.close();
    }
};
