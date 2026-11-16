const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const settingsKey = 'timetrace_user_settings';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const settle = () => new Promise(setImmediate);
const status = enabled => ({is_running: false, is_frozen_idle: false, pending_idle_gap: null, idle_detection_enabled: enabled});

// Only DOM, HTTP, clock and storage are fixtures; all lifecycle/Save/navigation handlers are shipped source.
function page(order, preference, serviceIdle) {
    const storage = new Map(preference === undefined ? [] : [[settingsKey, JSON.stringify({idleDetectorEnabled: preference, unknown: {color: '#123456'}})]]);
    const storageWrites = [], writes = [], reads = [], intervals = [], listeners = {}, windowListeners = {};
    const elements = {};
    function element(id, type = '') {
        const classes = new Set();
        return elements[id] = {id, type, value: '', checked: false, disabled: false, textContent: '', innerText: '', dataset: {},
            classList: {contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c), toggle(c, force) { force ? classes.add(c) : classes.delete(c); }},
            setAttribute() {}, addEventListener(name, fn) { (this.listeners ||= {})[name] = fn; },
            querySelectorAll: () => [], focus() {}, appendChild(child) { elements[child.id] = child; }};
    }
    for (const id of ['settings_modal', 'settings_browser_category', 'settings_ai_category', 'settings_providers_category',
        'ai_behavior_settings', 'browser_save', 'browser_cancel', 'browser_reshuffle', 'browser_save_status',
        'idle_killer_switch_btn', 'idle_switch_label', 'timer_status_label', 'toggle_btn', 'timer_notice_text']) element(id);
    for (const [id, type] of [['setting_idle_detector', 'checkbox'], ['setting_first_day', 'select-one'],
        ['setting_hide_right_sidebar', 'select-one'], ['setting_totals_visible', 'checkbox'], ['setting_light_theme', 'select-one']]) element(id, type);
    elements.settings_modal.dataset = {settingsPageEditor: 'true', settingsDraftRetained: 'true'};
    elements.settings_modal.querySelectorAll = selector => Object.values(elements).filter(e => e.type && (!selector.startsWith('#') || e.id === selector.slice(1)));
    const p = {storage, storageWrites, elements, writes, reads, intervals, initial: null, post: null, serviceIdle};
    const location = {href: 'http://unit.invalid/settings', pathname: '/settings', search: ''};
    const context = vm.createContext({console: {error() {}}, Event, Intl, URL, URLSearchParams, setTimeout,
        setInterval: fn => intervals.push(fn),
        document: {title: '', activeElement: null, body: {append() {}},
            documentElement: {setAttribute() {}, style: {setProperty() {}}},
            getElementById: id => elements[id] || null, querySelectorAll: () => [],
            createElement: () => ({setAttribute() {}}),
            addEventListener: (name, fn) => (listeners[name] ||= []).push(fn),
            dispatchEvent: event => (listeners[event.type] || []).forEach(fn => fn(event))},
        localStorage: {getItem: k => storage.get(k) ?? null, setItem(k, v) { storageWrites.push(k); storage.set(k, v); }},
        sessionStorage: {getItem: () => null, setItem() {}, removeItem() {}},
        window: {location, history: {pushState(_a, _b, path) { Object.assign(location, {href: `http://unit.invalid${path}`, pathname: path.split('?')[0], search: path.includes('?') ? '?' + path.split('?')[1] : ''}); }},
            addEventListener: (name, fn) => (windowListeners[name] ||= []).push(fn)},
        fetch: async (url, config) => {
            if (config.method === 'GET') {
                reads.push(url);
                if (url !== '/timer/status') return response([]);
                if (p.initial) { const held = p.initial; p.initial = null; return response(await held.promise); }
                if (p.failure) throw Error('synthetic status failure');
                return response(status(p.serviceIdle));
            }
            const body = JSON.parse(config.body || 'null');
            writes.push({url, body});
            assert.equal(url, '/idle/toggle', 'no timer/session/domain write is allowed by these workflows');
            if (p.post) await p.post.promise;
            p.serviceIdle = typeof body.enabled === 'boolean' ? body.enabled : !p.serviceIdle;
            return response({idle_detection_enabled: p.serviceIdle});
        }});
    function response(data) { return {ok: true, headers: {get: () => 'application/json'}, json: async () => data}; }
    const files = order === 'footer' ? ['api_client.js', 'timer_control.js', 'settings.js', 'browser_preferences.js']
        : ['api_client.js', 'settings.js', 'browser_preferences.js', 'timer_control.js'];
    for (const file of files) vm.runInContext(fs.readFileSync(`src/timetrace/interfaces/api/static/js/${file}`, 'utf8'), context);
    p.run = code => vm.runInContext(code, context);
    p.boot = async () => { for (const fn of listeners.DOMContentLoaded) fn(); await settle(); };
    p.history = () => (windowListeners.popstate || []).forEach(fn => fn());
    return p;
}

for (const order of ['footer', 'deferred-navbar']) {
    for (const [preference, live] of [[undefined, false], [true, false], [false, true]]) {
        test(`${order}: entry/navigation/presentation/polls/Retry never apply stored ${preference} over service ${live}`, async () => {
            const p = page(order, preference, live), original = p.storage.get(settingsKey);
            await p.boot();
            assert.equal(p.intervals.length, 1, 'exactly one actual polling callback');
            assert.equal(p.run('timerStatusFresh'), true);
            assert.equal(p.run('lastTimerData.idle_detection_enabled'), live);
            assert.equal(p.run('idleDetectionEnabled'), live);
            assert.equal(p.storage.get(settingsKey), original, 'opening does not rewrite missing/unknown preferences');
            assert.equal(p.storageWrites.length, 0);
            p.elements.setting_first_day.value = '0';
            p.run("showSettingsCategory('providers', true); showSettingsCategory('ai', true); showSettingsCategory('browser', true)");
            p.history();
            await p.run('applyUserSettings()');
            await p.run('retryTimerRead()');
            await p.intervals[0]();
            assert.equal(p.elements.setting_first_day.value, '0');
            assert.equal(p.run('hasSettingsDrafts(["settings_modal"])'), true);
            assert.equal(p.storage.get(settingsKey), original);
            p.run("setAppearancePreference('lightTheme', 'stone'); reshuffleAutoColors()");
            await settle();
            assert.equal(p.run('getUserSettings().idleDetectorEnabled'), preference ?? true);
            assert.equal(p.elements.setting_idle_detector.checked, preference ?? true);
            assert.equal(p.elements.setting_first_day.value, '0');
            assert.equal(p.run('idleDetectionEnabled'), live);
            assert.deepEqual(p.writes, [], 'all automatic idle/config/domain writes forbidden under owner B');
        });
    }

    test(`${order}: initial/failed status remains unknown and direct idle control cannot write`, async () => {
        const p = page(order, undefined, false), held = deferred();
        p.initial = held;
        await p.boot();
        assert.equal(p.run('idleDetectionEnabled'), null);
        assert.equal(p.run('timerStatusFresh'), false);
        assert.equal(p.elements.idle_killer_switch_btn.disabled, true);
        assert.match(p.elements.idle_switch_label.innerText, /unknown/i);
        p.failure = true;
        held.reject(Error('synthetic initial GET failure'));
        await settle();
        await p.run('toggleIdleSwitch()');
        await p.run('toggleTimer()');
        assert.equal(p.run('lastTimerData'), null);
        assert.equal(p.run('timerStatusFresh'), false);
        assert.equal(p.storage.has(settingsKey), false);
        assert.deepEqual(p.writes, []);
        p.failure = false;
        await p.run('retryTimerRead()');
        assert.equal(p.run('idleDetectionEnabled'), false);
        assert.equal(p.elements.idle_killer_switch_btn.disabled, false);
        assert.match(p.elements.idle_switch_label.innerText, /OFF/);
        p.failure = true;
        await p.run('retryTimerRead()');
        assert.equal(p.run('idleDetectionEnabled'), false);
        assert.equal(p.elements.idle_killer_switch_btn.disabled, true);
        assert.match(p.elements.idle_switch_label.innerText, /last.known/i);
        assert.deepEqual(p.writes, []);
    });

    test(`${order}: held initial GET plus newer explicit Save sends only its captured idle value and checkpoints ACK only`, async () => {
        const p = page(order, false, false), initial = deferred(), ack = deferred();
        p.initial = initial;
        await p.boot();
        p.elements.setting_idle_detector.checked = true;
        p.post = ack;
        const save = p.run('saveSettingsFromModal()');
        assert.deepEqual(p.writes, [{url: '/idle/toggle', body: {enabled: true}}]);
        assert.notEqual(p.run('idleDetectionEnabled'), true, 'no optimistic live success before ACK');
        assert.equal(p.run('hasSettingsDrafts(["settings_modal"])'), true);
        p.elements.setting_first_day.value = '0';
        ack.resolve(); await save;
        initial.resolve(status(false)); await settle();
        await p.run('retryTimerRead()');
        assert.equal(p.run('idleDetectionEnabled'), true);
        assert.equal(p.elements.setting_first_day.value, '0');
        assert.equal(p.run('hasSettingsDrafts(["settings_modal"])'), true);
        assert.equal(p.run('getUserSettings().idleDetectorEnabled'), true);
        assert.equal(p.writes.length, 1, 'no initial-GET/poll replay');
    });

    test(`${order}: rejected Save retains pending/reversal drafts; only separate Save retries`, async () => {
        const p = page(order, false, false);
        await p.boot();
        const rejected = deferred(); p.post = rejected;
        p.elements.setting_idle_detector.checked = true;
        const save = p.run('saveSettingsFromModal()');
        rejected.reject(Error('synthetic idle rejection')); await save;
        assert.equal(p.run('idleDetectionEnabled'), false);
        assert.equal(p.run('getUserSettings().idleDetectorEnabled'), true);
        assert.equal(p.run('hasSettingsDrafts(["settings_modal"])'), true);
        assert.match(p.elements.browser_save_status.textContent, /not confirmed/);
        await p.run('applyUserSettings()'); await p.run('retryTimerRead()');
        assert.equal(p.writes.length, 1);
        p.elements.setting_idle_detector.checked = false;
        const ack = deferred(); p.post = ack;
        const retry = p.run('saveSettingsFromModal()');
        assert.deepEqual(p.writes.map(w => w.body.enabled), [true, false]);
        assert.equal(p.run('hasSettingsDrafts(["settings_modal"])'), true);
        ack.resolve(); await retry;
        assert.equal(p.run('hasSettingsDrafts(["settings_modal"])'), false);
    });

    test(`${order}: missing idle boolean never fabricates live ON/OFF or authorizes the idle control`, async () => {
        const p = page(order, true, undefined);
        await p.boot();
        assert.equal(p.run('idleDetectionEnabled'), null);
        assert.equal(p.elements.idle_killer_switch_btn.disabled, true);
        assert.match(p.elements.idle_switch_label.innerText, /unknown/i);
        await p.run('toggleIdleSwitch()');
        assert.deepEqual(p.writes, []);
        assert.equal(p.run('getUserSettings().idleDetectorEnabled'), true);
    });

    test(`${order}: explicit idle control validates fresh boolean, adopts ACK only and retains rejection honestly`, async () => {
        const p = page(order, false, false);
        await p.boot();
        const ack = deferred(); p.post = ack;
        const toggle = p.run('toggleIdleSwitch()'); await settle();
        assert.equal(p.run('idleDetectionEnabled'), false);
        assert.equal(p.writes.length, 1);
        assert.equal(p.elements.idle_killer_switch_btn.disabled, true);
        await p.run('toggleIdleSwitch()');
        assert.equal(p.writes.length, 1, 'pending duplicate cannot toggle again');
        ack.resolve(); await toggle;
        assert.equal(p.run('idleDetectionEnabled'), true);
        assert.equal(p.run('getUserSettings().idleDetectorEnabled'), false, 'idle control does not own browser storage');
        const rejected = deferred(); p.post = rejected;
        const failed = p.run('toggleIdleSwitch()'); await settle();
        rejected.reject(Error('synthetic toggle rejection'));
        await assert.rejects(failed, /synthetic toggle rejection/);
        assert.equal(p.run('idleDetectionEnabled'), true);
        assert.equal(p.run('getUserSettings().idleDetectorEnabled'), false);
        assert.equal(p.writes.length, 2);
    });
}
