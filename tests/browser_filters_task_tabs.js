// Authored isolated native acceptance probe; run only on a disposable synthetic daemon.
(() => {
    // One isolated capture cell per invocation; the caller owns screenshots and durable artifacts.
    const runDarkFilterContrastAcceptance = async (page, baseURL, options = {}) => {
        const origin = new URL(baseURL);
        if (!['localhost', '127.0.0.1'].includes(origin.hostname) || !origin.port || origin.port === '8002') {
            throw Error('Use an isolated non-8002 loopback daemon');
        }
        const surface = options.surface || 'calendar-filter';
        const width = typeof options.viewport === 'number' ? options.viewport : options.viewport?.width || options.width || 390;
        const treatment = options.lightTheme || options.theme || options.treatment || 'nord';
        if (!['calendar-filter', 'tasks-filter', 'calendar-tabs'].includes(surface)) throw Error(`Unknown surface: ${surface}`);
        if (![390, 1440].includes(width)) throw Error(`Unsupported capture width: ${width}`);
        if (!['refined', 'stone', 'porcelain', 'nord'].includes(treatment)) throw Error(`Unknown treatment: ${treatment}`);
        const viewport = {width, height: width === 390 ? 844 : 900};
        const dark = options.appearance ? options.appearance === 'dark' : treatment === 'nord';
        const appearance = options.appearance || (dark ? 'dark' : 'light');
        const route = surface === 'tasks-filter' ? '/tasks' : '/dashboard?task=__none__';
        const checks = [], measurements = [];
        await page.setViewportSize(viewport);
        if (page.url() === 'about:blank') await page.goto(origin.origin);
        await page.evaluate(({appearance, treatment}) => localStorage.setItem('timetrace_user_settings', JSON.stringify({
            appearance, lightTheme: treatment, theme: 'nord', idleDetectorEnabled: false, enableVimMotions: false
        })), {appearance, treatment});
        await page.goto(`${origin.origin}${route}`);
        await page.waitForFunction(({appearance, treatment}) => document.documentElement.dataset.appearance === appearance &&
            (appearance !== 'light' || document.documentElement.dataset.lightTheme === treatment) &&
            (appearance !== 'dark' || document.documentElement.dataset.theme === 'nord'), {appearance, treatment});
        const waitForStablePaint = async () => page.evaluate(async () => {
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
            for (const animation of document.getAnimations()) {
                if (animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)) {
                    await Promise.race([animation.finished.catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
                }
            }
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
        });
        const measure = async (selector, name, expectedText = null) => {
            const locator = page.locator(selector);
            if (!await locator.count()) {
                const entry = {name, selector, applicable: true, passed: false, visible: false, reason: `Missing selector: ${selector}`};
                measurements.push(entry);
                return entry;
            }
            await locator.waitFor({state: 'attached'});
            await waitForStablePaint();
            const sample = await locator.evaluate((element, expected) => {
                const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
                const text = (element.innerText || '').trim(), ariaLabel = (element.getAttribute('aria-label') || '').trim();
                const textMatches = !expected || text.includes(expected) || ariaLabel.includes(expected);
                const hasText = Boolean(text || ariaLabel);
                const ancestors = [];
                for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
                let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
                for (const node of ancestors) {
                    if (node === document.documentElement) continue;
                    const parentStyle = getComputedStyle(node), box = node.getBoundingClientRect();
                    if (/(hidden|clip|auto|scroll)/.test(`${parentStyle.overflow} ${parentStyle.overflowX} ${parentStyle.overflowY}`)) {
                        left = Math.max(left, box.left); top = Math.max(top, box.top);
                        right = Math.min(right, box.right); bottom = Math.min(bottom, box.bottom);
                    }
                }
                const clippedRect = {left: Math.max(rect.left, left), top: Math.max(rect.top, top),
                    right: Math.min(rect.right, right), bottom: Math.min(rect.bottom, bottom)};
                const visible = rect.width > 0 && rect.height > 0 && clippedRect.right > clippedRect.left &&
                    clippedRect.bottom > clippedRect.top && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
                    ancestors.every(node => { const parent = getComputedStyle(node); return parent.visibility !== 'hidden' && parent.display !== 'none' && Number(parent.opacity) > 0; });
                const fullyVisible = visible && Math.abs(rect.left - clippedRect.left) < 0.5 && Math.abs(rect.top - clippedRect.top) < 0.5 &&
                    Math.abs(rect.right - clippedRect.right) < 0.5 && Math.abs(rect.bottom - clippedRect.bottom) < 0.5;
                return {text, ariaLabel, visible, fullyVisible, textMatches, hasText, foregroundColor: style.color,
                    geometry: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}, clippedGeometry: clippedRect,
                    ancestorVisibility: ancestors.map(node => { const parent = getComputedStyle(node); return {
                        id: node.id, tag: node.tagName.toLowerCase(), visibility: parent.visibility, display: parent.display,
                        opacity: Number(parent.opacity), backgroundColor: parent.backgroundColor}; })};
            }, expectedText);
            if (!sample.visible || !sample.hasText || !sample.textMatches) {
                const entry = {name, selector, ...sample, ratio: null, backgroundColor: null,
                    applicable: sample.hasText && sample.textMatches, passed: false};
                measurements.push(entry);
                return entry;
            }
            let computed;
            try {
                computed = await locator.evaluate(element => {
                const rgba = color => {
                    const values = color.match(/[\d.]+/g)?.map(Number) || [];
                    if (values.length < 3) throw Error(`Unsupported computed color: ${color}`);
                    return [values[0], values[1], values[2], values[3] ?? 1];
                };
                const blend = (front, back) => [0, 1, 2].map(index => front[index] * front[3] + back[index] * (1 - front[3]));
                const ancestors = [];
                for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
                const chain = ancestors.map(node => {
                    const style = getComputedStyle(node);
                    return {id: node.id, tag: node.tagName.toLowerCase(), opacity: Number(style.opacity),
                        backgroundColor: style.backgroundColor};
                });
                if (chain.some(node => node.opacity !== 1)) return {paintStatus: 'unknown-ancestor-opacity', ancestorChain: chain};
                let opaqueIndex = -1, background = null;
                for (let index = chain.length - 1; index >= 0; index--) {
                    const color = rgba(chain[index].backgroundColor);
                    if (color[3] === 1) { opaqueIndex = index; background = color.slice(0, 3); break; }
                }
                if (background === null) return {paintStatus: 'unknown-no-opaque-ancestor', ancestorChain: chain};
                for (const node of chain.slice(opaqueIndex + 1)) {
                    const color = rgba(node.backgroundColor);
                    if (color[3] > 0) background = blend(color, background);
                }
                const foreground = blend(rgba(getComputedStyle(element).color), background);
                const luminance = color => color.map(channel => channel / 255)
                    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
                    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
                return {paintStatus: 'resolved', ancestorChain: chain,
                    backgroundColor: `rgb(${background.map(Math.round).join(', ')})`,
                    paintedForegroundColor: `rgb(${foreground.map(Math.round).join(', ')})`,
                    ratio: (Math.max(luminance(foreground), luminance(background)) + 0.05) /
                        (Math.min(luminance(foreground), luminance(background)) + 0.05)};
                });
            } catch (error) {
                const entry = {name, selector, ...sample, applicable: true, passed: false, ratio: null, error: String(error)};
                measurements.push(entry);
                return entry;
            }
            const entry = {name, selector, ...sample, ...computed, applicable: true,
                passed: sample.fullyVisible && sample.textMatches && computed.paintStatus === 'resolved' && (!dark || computed.ratio >= 4.5)};
            measurements.push(entry);
            checks.push(computed.paintStatus === 'resolved' ? `${name} sampled at ${entry.ratio.toFixed(3)}:1` : `${name} paint unresolved: ${computed.paintStatus}`);
            return entry;
        };

        if (surface === 'calendar-tabs') {
            await page.evaluate(() => openSidebarTabsConfigModal());
            await page.locator('#sidebar_tab_config_modal').waitFor({state: 'visible'});
            await page.locator('#sidebar_tab_config_list').waitFor();
            await measure('#sidebar_tab_config_modal > div > div:first-child > p', 'Calendar tabs description',
                'Drag or use Move up and Move down. Toggle to show or hide. Changes save immediately.');
            const feedback = page.locator('#sidebar_tab_config_feedback');
            const feedbackText = await feedback.textContent();
            if (feedbackText?.trim()) await measure('#sidebar_tab_config_feedback', 'Calendar tabs dynamic feedback');
            else measurements.push({name: 'Calendar tabs dynamic feedback', selector: '#sidebar_tab_config_feedback', text: '', visible: false, applicable: false,
                reason: 'Existing local status read produced no feedback text'});
            await measure('#sidebar_tab_config_modal button[aria-label="Close status tab configuration"]', 'Calendar tabs close control',
                'Close status tab configuration');
        } else {
            await page.locator('.custom-filter-trigger-btn').first().click();
            await measure('#custom_filter_modal button[aria-label="Close advanced task filters"]', `${surface} close control`,
                'Close advanced task filters');
        }
        return {surface, viewport, appearance, theme: treatment, checks, samples: measurements,
            passed: measurements.every(sample => !sample.applicable || sample.passed),
            nextAction: 'Caller persists evidence before closing or navigating; sampled dialog remains open',
            scope: 'One scoped surface/theme/viewport capture; not whole-app or general accessibility certification'};
    };

    const runExistingAcceptance = async (page, baseURL) => {
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
    runExistingAcceptance.runDarkFilterContrastAcceptance = runDarkFilterContrastAcceptance;
    return runExistingAcceptance;
})()
;
