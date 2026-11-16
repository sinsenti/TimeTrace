/* Manual real Chart.js disposal/recreation through actual numeric-habit selection controls. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    const p = await context.newPage();
    const errors = [], writes = [], habits = [];
    p.on('pageerror', error => errors.push(error.message));
    try {
        await context.route('**/api/ai/providers/catalog', route => route.fulfill({json:{}}));
        for (const data of [{name:'Synthetic numeric lifecycle',habit_type:'numeric',target_value:3,unit:'steps'}, {name:'Synthetic second lifecycle',habit_type:'boolean'}]) {
            const response = await context.request.post(`${baseURL}/habits`,{data});
            if (!response.ok()) throw Error(`Habit fixture: ${response.status()}`);
            habits.push(await response.json());
        }
        await p.goto(`${baseURL}/habits-view`);
        await p.locator('#habit_inspector_chips button').first().waitFor({state:'attached'});
        await p.locator('#tab_btn_charts').click();
        await p.getByRole('button',{name:'Deselect All',exact:true}).click();
        await p.locator('#habit_inspector_chips').getByRole('button',{name:habits[0].name,exact:true}).click();
        await p.waitForFunction(() => Object.values(Chart.instances).filter(c => c.canvas).length === 3);
        p.on('request', request => {if (request.method() !== 'GET') writes.push(request.url());});
        const adopt = async () => {
            const before = await p.evaluate(() => JSON.stringify(Object.values(Chart.instances).map(c => c.data)));
            for (const choice of ['stone','porcelain','refined','dark']) {
                await p.evaluate(choice => {
                    setAppearancePreference('appearance',choice === 'dark' ? 'dark' : 'light');
                    if (choice !== 'dark') setAppearancePreference('lightTheme',choice);
                },choice);
                const valid = await p.evaluate(() => {
                    const colors = chartAppearanceColors();
                    return Object.values(Chart.instances).every(chart => {
                        const labels = chart.options.plugins?.legend?.labels;
                        return (!labels || labels.color === colors.legend) && Object.values(chart.options.scales || {}).every(axis => !axis.ticks || axis.ticks.color === colors.ticks);
                    });
                });
                if (!valid) throw Error('Live charts did not adopt appearance');
            }
            if (before !== await p.evaluate(() => JSON.stringify(Object.values(Chart.instances).map(c => c.data)))) throw Error('Appearance changed chart data');
        };
        await p.locator('#habit_inspector_chips').getByRole('button',{name:habits[1].name,exact:true}).click();
        await p.waitForFunction(() => Object.values(Chart.instances).filter(c => c.canvas).length === 2);
        await adopt();
        await p.getByRole('button',{name:'Deselect All',exact:true}).click();
        await p.waitForFunction(() => Object.values(Chart.instances).length === 0);
        await adopt();
        await p.locator('#habit_inspector_chips').getByRole('button',{name:habits[0].name,exact:true}).click();
        await p.waitForFunction(() => Object.values(Chart.instances).filter(c => c.canvas).length === 3);
        await p.evaluate(id => openEditHabitModal(id),habits[0].id);
        await p.locator('#modal_habit_name').fill('Unsaved synthetic habit name');
        await adopt();
        if (await p.locator('#modal_habit_name').inputValue() !== 'Unsaved synthetic habit name' || writes.length || errors.length) throw Error(JSON.stringify({writes,errors}));
        return {lifecycle:['numeric goal','second selection hides goal','deselect all disposes','reselect recreates'],editor:'draft preserved',writes,errors};
    } finally {
        for (const habit of habits) await context.request.delete(`${baseURL}/habits/${habit.id}`);
        await context.close();
    }
};
