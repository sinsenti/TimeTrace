/* Manual real-daemon regression: evaluate this async function with a Playwright page and an
 * isolated daemon baseURL. No runner/dependency is installed; the function owns its browser context. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    const p = await context.newPage();
    const measured = [];
    try {
        await p.goto(`${baseURL}/dashboard`);
        await p.waitForSelector('.fc-timegrid-slot-lane');
        // Independent expected row sizes for the three approved hourly densities.
        for (const [density, sizes] of [[56, [14, 28, 42, 56]], [72, [18, 36, 54, 72]], [88, [22, 44, 66, 88]]]) {
            await p.locator('#calendar_density').selectOption(String(density));
            for (const [index, slot] of [15, 30, 45, 60].entries()) {
                await p.getByRole('button', { name: 'Preferences', exact: true }).click();
                await p.locator('#setting_slot_duration').selectOption(String(slot));
                await p.locator('#settings_modal button[onclick="saveSettingsFromModal()"]').click();
                await p.waitForFunction(minutes => calendar.getOption('slotDuration') === `00:${String(minutes).padStart(2, '0')}:00`, slot);
                const heights = await p.locator('.fc-timegrid-slot-lane').evaluateAll(rows => rows.slice(1, 9).map(r => r.getBoundingClientRect().height));
                if (!heights.length || heights.some(h => Math.abs(h - sizes[index]) > 0.6)) {
                    throw Error(`${density}px/hour, ${slot}m slots: expected ${sizes[index]}px rows, got ${heights}`);
                }
                measured.push({ density, slot, heights });
            }
        }
        return { passed: measured.length, measured };
    } finally {
        await context.close();
    }
};
