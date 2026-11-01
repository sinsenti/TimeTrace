/* Manual real-daemon regression. Pass a Playwright page and isolated daemon baseURL;
 * no dependency/runner is installed. Checks rendered geometry and measured contrast, not CSS text. */
async (page, baseURL) => {
    const context = await page.context().browser().newContext();
    const p = await context.newPage();
    const results = [];
    try {
        await p.goto(`${baseURL}/dashboard`);
        await p.waitForSelector('.fc-timegrid-slot');
        for (const width of [390, 768, 1024, 1440]) {
            await p.setViewportSize({ width, height: 1000 });
            for (const theme of ['refined', 'stone', 'porcelain']) {
                await p.locator('#appearance_light_theme').selectOption(theme);
                const geometry = await p.evaluate(() => {
                    const rect = selector => {
                        const r = document.querySelector(selector).getBoundingClientRect();
                        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
                    };
                    return { nav: rect('.app-navigation'), links: [...document.querySelectorAll('.app-navigation nav a')].map(a => a.getBoundingClientRect().top), timer: rect('#active_timer_pill') };
                });
                if (width <= 800 && (geometry.nav.width < width - 25 || Math.max(...geometry.links) - Math.min(...geometry.links) > 2 || geometry.timer.top < geometry.nav.bottom)) {
                    throw Error(`Collapsed or overlapping narrow navigation: ${JSON.stringify(geometry)}`);
                }
                const contrast = await p.locator('#vim_mode_indicator').evaluate(el => {
                    const s = getComputedStyle(el);
                    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
                    const a = luminance(s.color), b = luminance(s.backgroundColor);
                    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
                });
                if (contrast < 4.5) throw Error(`Unreadable Vim badge: ${width}/${theme} ${contrast}`);
                results.push({ width, theme, geometry, contrast });
            }
        }
        return { passed: results.length, results };
    } finally {
        await context.close();
    }
};
