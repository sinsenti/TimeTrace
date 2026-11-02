/* Responsive/focus caller probe; real dialogs and keyboard, synthetic task fixtures only. */
async (page, baseURL) => {
    const check = (ok, message) => { if (!ok) throw Error(message); };
    const results = [];
    for (const width of [390, 768, 1024, 1440]) {
        const context = await page.context().browser().newContext({ viewport: { width, height: 850 } });
        await context.addInitScript(() => localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled:false})));
        const p = await context.newPage();
        try {
            await p.goto(`${baseURL}/dashboard`);
            await p.waitForSelector('.fc-timegrid-slot');
            const launcher = p.locator('button[onclick="createPlanningSession()"]');
            await launcher.click();
            await p.waitForFunction(() => document.activeElement.id === 'session_modal_task_search');
            const box = await p.locator('#session_modal > div').boundingBox();
            check(box.x >= 8 && box.x + box.width <= width - 8, `Session dialog fits ${width}px with safe margins`);
            check(await p.locator('#session_modal').getAttribute('role') === 'dialog', 'Session exposes a labeled modal dialog');
            const save = p.locator('#session_modal_save_btn');
            await save.focus(); await p.keyboard.press('Tab');
            check(await p.evaluate(() => document.getElementById('session_modal').contains(document.activeElement)), 'Tab stays inside the Session dialog');
            await p.keyboard.press('Shift+Tab');
            check(await save.evaluate(el => document.activeElement === el), 'Shift+Tab wraps back to Save');
            await p.keyboard.press('Escape');
            check(await launcher.evaluate(el => document.activeElement === el), 'Escape restores actual launcher focus');
            results.push({ width, box, keyboard: 'Tab/Shift+Tab/Escape restoration' });
        } finally { await context.close(); }
    }
    return results;
}
