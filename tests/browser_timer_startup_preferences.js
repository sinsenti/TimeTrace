/* Native owner-B checks. Real status/Save-false only; transport failures never invent live state. */
async (page, baseURL) => {
    const browser = page.context().browser();
    const checks = [], failures = [], errors = [], profiles = [], requests = [], responses = [], readbacks = [];
    const responseReads = [];
    const check = (condition, label, data = null) => {
        checks.push({label, passed: Boolean(condition), data});
        if (!condition) { failures.push({label, data}); throw Error(label); }
    };
    const snapshot = p => p.evaluate(() => ({
        storage: localStorage.getItem('timetrace_user_settings'), intent: getUserSettings().idleDetectorEnabled,
        live: idleDetectionEnabled, fresh: timerStatusFresh, status: lastTimerData,
        idleLabelPresent: Boolean(document.getElementById('idle_switch_label')),
        idleControlPresent: Boolean(document.getElementById('idle_killer_switch_btn')),
        label: document.getElementById('idle_switch_label')?.textContent ?? null,
        disabled: document.getElementById('idle_killer_switch_btn')?.disabled ?? null,
        startControlPresent: Boolean(document.getElementById('toggle_btn')),
        startDisabled: document.getElementById('toggle_btn')?.disabled ?? null,
        timerLabel: document.getElementById('timer_status_label')?.textContent ?? null,
        notice: document.getElementById('timer_notice_text')?.textContent ?? null,
        draftIdle: document.getElementById('setting_idle_detector')?.checked,
        draftWeek: document.getElementById('setting_first_day')?.value,
        dirty: typeof hasSettingsDrafts === 'function' && hasSettingsDrafts(['settings_modal']),
        path: location.pathname + location.search,
        appearance: document.documentElement.dataset.appearance,
        lightTheme: document.documentElement.dataset.lightTheme
    }));
    const newProfile = async (name, intent) => {
        const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
        if (intent !== undefined) await context.addInitScript(({origin, value}) => {
            if (location.origin === origin && localStorage.getItem('timetrace_user_settings') === null) {
                localStorage.setItem('timetrace_user_settings', JSON.stringify({idleDetectorEnabled: value, unknownB: {literal: '<retained>'}}));
            }
        }, {origin: baseURL, value: intent});
        const p = await context.newPage();
        p.on('pageerror', error => errors.push({profile: name, message: error.message, stack: error.stack}));
        p.on('request', request => {
            if (new URL(request.url()).origin === baseURL) requests.push({profile: name, method: request.method(), path: new URL(request.url()).pathname, query: new URL(request.url()).search, body: request.postData()});
        });
        p.on('response', response => {
            if (new URL(response.url()).origin !== baseURL) return;
            const item = {profile: name, method: response.request().method(), path: new URL(response.url()).pathname, status: response.status()};
            responses.push(item);
            responseReads.push((async () => {
                try {
                    if ((response.headers()['content-type'] || '').includes('application/json')) item.body = await response.json();
                    else item.contentType = response.headers()['content-type'];
                } catch (error) { item.transportReadError = error.message; }
            })());
        });
        profiles.push({name, seededIntent: intent === undefined ? 'none' : intent, origin: baseURL});
        return {context, p, name};
    };
    const ready = p => p.waitForFunction(() => typeof timerStatusFresh !== 'undefined' && timerStatusFresh && typeof lastTimerData?.idle_detection_enabled === 'boolean');
    const realRead = async (context, label) => {
        const r = await context.request.get(baseURL + '/timer/status');
        const body = await r.json(); readbacks.push({label, status: r.status(), body});
        check(r.ok() && body.idle_detection_enabled === false && !body.is_running && !body.is_frozen_idle && body.pending_idle_gap === null, `real daemon remains inactive/idle OFF: ${label}`, body);
    };
    const zeroWrites = name => check(requests.filter(r => r.profile === name && !['GET', 'HEAD'].includes(r.method) && r.path !== '/analytics/query').length === 0, `zero automatic configuration/domain writes: ${name}`);
    try {
        for (const path of ['/dashboard', '/tasks', '/settings', '/settings/ai', '/settings?category=providers']) {
            const {context, p, name} = await newProfile('fresh ' + path);
            try {
                await p.goto(baseURL + path); await ready(p);
                const initial = await snapshot(p); profiles.at(-1).initial = initial;
                check(initial.storage === null && initial.intent === true && initial.live === false && initial.status.idle_detection_enabled === false && !initial.idleLabelPresent && !initial.idleControlPresent && initial.label === null && initial.disabled === null, `fresh default true is not coerced to actual OFF: ${path}`, initial);
                check(await p.locator('script[src^="/static/js/timer_control.js"]').count() === 1, `one actual controller: ${path}`);
                await p.evaluate(async () => { await applyUserSettings(); await retryTimerRead(); });
                const afterRead = await snapshot(p);
                check(afterRead.storage === null && afterRead.live === false, `read/application leaves fresh storage absent: ${path}`, afterRead);
                if (path.startsWith('/settings')) {
                    check(initial.draftIdle === true, `fresh Browser draft retains true intent: ${path}`);
                    await p.locator('#settings_categories button[data-category="browser"]').click();
                    await p.locator('#setting_first_day').selectOption('0');
                    await p.locator('#settings_categories button[data-category="providers"]').click();
                    await p.locator('#settings_categories button[data-category="ai"]').click();
                    await p.goBack(); await p.goBack(); await p.goForward();
                    await p.locator('#settings_categories button[data-category="browser"]').click();
                    await p.locator('#appearance_light_theme').selectOption('stone');
                    await p.locator('#appearance_toggle').click();
                    await p.evaluate(() => reshuffleAutoColors());
                    const draft = await snapshot(p); profiles.at(-1).draft = draft;
                    check(draft.draftWeek === '0' && draft.draftIdle === true && draft.intent === true && draft.live === false && draft.dirty, `category/history/theme/color retains independent Browser draft: ${path}`, draft);
                } else {
                    await p.goto(baseURL + '/tasks'); await ready(p);
                    await p.goto(baseURL + '/dashboard'); await ready(p);
                    await p.goBack(); await ready(p); await p.goForward(); await ready(p);
                    check((await snapshot(p)).storage === null, `native Back/Forward retains absent browser storage: ${path}`);
                }
                zeroWrites(name); await realRead(context, name);
            } finally { await context.close(); }
        }
        for (const intent of [false, true]) {
            const {context, p, name} = await newProfile('stored ' + intent, intent);
            try {
                await p.goto(baseURL + '/settings'); await ready(p);
                const before = await snapshot(p);
                check(before.intent === intent && before.draftIdle === intent && before.live === false, `stored ${intent} remains separate from live OFF`, before);
                await p.locator('#setting_first_day').selectOption('0');
                await p.locator('#settings_categories button[data-category="ai"]').click();
                await p.locator('#settings_categories button[data-category="browser"]').click();
                await p.evaluate(async () => { await applyUserSettings(); await retryTimerRead(); });
                const after = await snapshot(p); profiles.at(-1).initial = before; profiles.at(-1).final = after;
                check(after.storage === before.storage && after.draftIdle === intent && after.draftWeek === '0' && after.dirty, `stored ${intent} bytes and unsaved draft unchanged`, after);
                zeroWrites(name); await realRead(context, name);
            } finally { await context.close(); }
        }
        for (const path of ['/dashboard', '/tasks', '/settings']) {
            const {context, p, name} = await newProfile('held initial ' + path);
            let release;
            const held = new Promise(resolve => { release = resolve; });
            let entered;
            const started = new Promise(resolve => { entered = resolve; });
            let mode = 'hold';
            const captured = [];
            await context.route('**/timer/status', async route => {
                const response = await route.fetch();
                captured.push({status: response.status(), body: await response.json(), mode});
                if (mode === 'hold') { entered(); await held; await route.abort('failed'); }
                else if (mode === 'fail') await route.abort('failed');
                else await route.fulfill({response});
            });
            try {
                await p.goto(baseURL + path); await started;
                await p.waitForFunction(() => typeof timerStatusFresh !== 'undefined' && !timerStatusFresh && idleDetectionEnabled === null);
                const unknown = await snapshot(p);
                check(unknown.live === null && !unknown.fresh && unknown.storage === null && !unknown.idleControlPresent && !unknown.idleLabelPresent && (path === '/dashboard' ? unknown.startDisabled === true && /Loading/.test(unknown.timerLabel) : !unknown.startControlPresent), `held actual GET remains unknown/no action; only Dashboard has disabled Start: ${path}`, unknown);
                mode = 'fail'; release();
                await p.waitForFunction(() => document.getElementById('timer_notice_text').textContent.includes('unavailable'));
                const failed = await snapshot(p);
                check(failed.live === null && !failed.fresh && /unavailable/.test(failed.notice) && !failed.idleControlPresent && failed.label === null, `failed initial real GET is not live ON/OFF: ${path}`, failed);
                mode = 'open';
                await p.locator('#timer_recovery_notice button[onclick="retryTimerRead()"]').click(); await ready(p);
                const recovered = await snapshot(p);
                check(recovered.live === false && recovered.fresh && recovered.status.idle_detection_enabled === false && recovered.notice === '' && recovered.storage === null, `explicit read-only Retry adopts actual OFF: ${path}`, recovered);
                mode = 'fail'; await p.evaluate(() => retryTimerRead());
                const stale = await snapshot(p);
                check(stale.live === false && !stale.fresh && /Last-known state/.test(stale.notice) && !stale.idleControlPresent && stale.label === null, `later failed actual read retains OFF and labels last-known state in notice: ${path}`, stale);
                profiles.at(-1).transportCaptures = captured;
                zeroWrites(name); await realRead(context, name);
            } finally { release(); await context.close(); }
        }
        // Saving false is a real allowed explicit write; the initial real read is held, not replaced.
        {
            const {context, p, name} = await newProfile('explicit Save false with held initial GET');
            let release, entered;
            const held = new Promise(resolve => { release = resolve; });
            const started = new Promise(resolve => { entered = resolve; });
            let first = true;
            await context.route('**/timer/status', async route => {
                const response = await route.fetch();
                if (first) { first = false; entered(); await held; }
                await route.fulfill({response});
            });
            try {
                await p.goto(baseURL + '/settings'); await started;
                await p.locator('#setting_idle_detector').uncheck();
                const ack = p.waitForResponse(r => new URL(r.url()).pathname === '/idle/toggle' && r.request().method() === 'POST');
                await p.locator('#browser_save').click(); const response = await ack;
                const body = await response.json();
                check(response.ok() && body.idle_detection_enabled === false, 'explicit Save false receives actual boolean ACK', body);
                release(); await ready(p);
                await p.waitForFunction(() => document.getElementById('browser_save_status').textContent === 'Browser preferences saved.');
                const saved = await snapshot(p); profiles.at(-1).final = saved;
                check(saved.intent === false && saved.draftIdle === false && saved.live === false && !saved.dirty, 'Save false checkpoints ACK without startup replay', saved);
                const writes = requests.filter(r => r.profile === name && !['GET', 'HEAD'].includes(r.method));
                check(writes.length === 1 && writes[0].path === '/idle/toggle' && JSON.parse(writes[0].body).enabled === false, 'exactly one explicit false POST; no implicit writes', writes);
                await realRead(context, name);
            } finally { release(); await context.close(); }
        }
        check(errors.length === 0, 'no uncaught page errors in any new profile', errors);
    } catch (error) {
        if (!failures.length) failures.push({label: 'native execution exception', error: error.stack || String(error)});
    }
    await Promise.all(responseReads);
    return {verdict: failures.length || errors.length ? 'FAIL' : 'PASS', checks, failures, errors, profiles, requests, responses, readbacks,
        fakes: ['passive runner provider catalog only', 'real status responses held/transport-aborted or passed unchanged'],
        limits: ['No dedicated idle switch/label is rendered by current templates; nullable presence is observed, not native switch ACK certification', 'No live idle-control POST {} or enable true; explicit Save false only', 'No native malformed/missing status success-body fake; unit tests cover that boundary', 'No real OS idle, providers, physical touch, screen readers or other browser engines', 'Browser appearance uses actual UI; reshuffle invokes the shipped public handler, not a physical pointer gesture']};
}
