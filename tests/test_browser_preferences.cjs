const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function browser() {
    const storage = new Map([['timetrace_user_settings', JSON.stringify({idleDetectorEnabled: false, customColor: '#123456'})]]);
    const elements = {};
    const root = elements.settings_modal = {dataset: {settingsPageEditor: 'true', settingsDraftRetained: 'true'}, classList: {contains: () => false, remove() {}, add() {}}, querySelectorAll: (selector) => Object.values(elements).filter(e => e.type && (!selector?.startsWith('#') || e.id === selector.slice(1))), contains: el => Object.values(elements).includes(el)};
    for (const [id, type, value] of [['setting_appearance', 'select-one', 'light'], ['setting_light_theme', 'select-one', 'refined'], ['setting_theme', 'select-one', 'midnight'], ['setting_first_day', 'select-one', '1'], ['setting_idle_detector', 'checkbox', ''], ['setting_calendar_density', 'select-one', '88'], ['setting_task_view', 'select-one', 'kanban']]) {
        elements[id] = {id, type, value, checked: false, classList: {contains: () => false}, focus() {}};
    }
    elements.browser_save_status = {textContent: ''};
    const posts = [];
    const listeners = {};
    const ctx = vm.createContext({console, Event, Intl, URL, setTimeout, localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v)}, document: {activeElement: null, getElementById: id => elements[id], addEventListener: (type, fn) => (listeners[type] ||= []).push(fn), dispatchEvent: event => (listeners[event.type] || []).forEach(fn => fn(event)), documentElement: {setAttribute() {}, style: {setProperty() {}}}}, window: {location: {href: 'http://localhost/settings'}}, api: {post: async (path, body) => posts.push({path, body})}});
    vm.runInContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/settings.js', 'utf8'), ctx);
    const run = code => vm.runInContext(code, ctx);
    run('openSettingsModal()');
    return {ctx, run, elements, root, posts, storage, saved: () => JSON.parse(storage.get('timetrace_user_settings'))};
}

test('Browser Save persists density/task choice while retaining alternate-writer appearance and unknown colors', async () => {
    const b = browser();
    b.elements.setting_calendar_density.value = '56';
    b.elements.setting_task_view.value = 'outline';
    b.run("setAppearancePreference('lightTheme', 'stone')");
    await b.run('saveSettingsFromModal()');
    assert.equal(b.saved().calendarDensity, 56);
    assert.equal(b.saved().taskView, 'outline');
    assert.equal(b.saved().lightTheme, 'stone');
    assert.equal(b.saved().customColor, '#123456');
    assert.equal(b.posts.length, 0);
    assert.equal(b.run("hasSettingsDrafts(['settings_modal'])"), false);
});

test('storage rejection retains a dirty Browser draft and sends no daemon request', async () => {
    const b = browser();
    b.elements.setting_first_day.value = '0';
    b.ctx.localStorage.setItem = () => { throw Error('quota'); };
    await b.run('saveSettingsFromModal()');
    assert.equal(b.saved().firstDayOfWeek, undefined);
    assert.equal(b.posts.length, 0);
    assert.equal(b.run("hasSettingsDrafts(['settings_modal'])"), true);
    assert.match(b.elements.browser_save_status.textContent, /Could not save/);
});

test('idle pending/rejection never acknowledges concurrent Browser edits or repeats on theme-only changes', async () => {
    const b = browser();
    let reject;
    b.ctx.api.post = (path, body) => { b.posts.push({path, body}); return new Promise((_, no) => { reject = no; }); };
    b.elements.setting_idle_detector.checked = true;
    b.elements.setting_first_day.value = '0';
    const save = b.run('saveSettingsFromModal()');
    assert.match(b.elements.browser_save_status.textContent, /Updating daemon/);
    b.elements.setting_first_day.value = '1';
    b.run("setAppearancePreference('lightTheme', 'porcelain')");
    await b.run('saveSettingsFromModal()');
    assert.equal(b.posts.length, 1);
    reject(Error('synthetic idle failure'));
    await save;
    assert.equal(b.saved().firstDayOfWeek, 0);
    assert.equal(b.saved().lightTheme, 'porcelain');
    assert.equal(b.run("hasSettingsDrafts(['settings_modal'])"), true);
    assert.match(b.elements.browser_save_status.textContent, /not confirmed/);
    b.ctx.api.post = async (path, body) => b.posts.push({path, body});
    await b.run('saveSettingsFromModal()');
    assert.equal(b.posts.length, 2);
    assert.equal(b.saved().firstDayOfWeek, 1);
    assert.equal(b.run("hasSettingsDrafts(['settings_modal'])"), false);
});

test('Cancel restores saved values without writes and reopening the page owner retains drafts', () => {
    const b = browser();
    b.elements.setting_first_day.value = '0';
    b.run('openSettingsModal()');
    assert.equal(b.elements.setting_first_day.value, '0');
    b.run('closeSettingsModal()');
    assert.equal(b.elements.setting_first_day.value, '1');
    assert.equal(b.storage.size, 1);
    assert.equal(b.posts.length, 0);
    assert.equal(b.run("hasSettingsDrafts(['settings_modal'])"), false);
});

test('same-field alternate writers block stale saves rather than replace the newer preference', async () => {
    const b = browser();
    b.elements.setting_calendar_density.value = '56';
    b.run('setCalendarDensity(72)');
    await b.run('saveSettingsFromModal()');
    assert.equal(b.saved().calendarDensity, 72);
    assert.match(b.elements.browser_save_status.textContent, /changed elsewhere/);
    assert.equal(b.run("hasSettingsDrafts(['settings_modal'])"), true);
});

test('theme-only changes update clean Browser appearance controls but retain staged appearance edits', () => {
    const b = browser();
    b.run("setAppearancePreference('lightTheme', 'stone')");
    assert.equal(b.elements.setting_light_theme.value, 'stone');
    assert.equal(b.run("hasSettingsDrafts(['settings_modal'])"), false);
    b.elements.setting_light_theme.value = 'porcelain';
    b.run("setAppearancePreference('lightTheme', 'refined')");
    assert.equal(b.elements.setting_light_theme.value, 'porcelain');
    assert.equal(b.run("hasSettingsDrafts(['settings_modal'])"), true);
});

test('all published Browser fields and legacy individual storage survive a one-field Save and reload', async () => {
    const b = browser();
    const fixture = {
        theme: 'dracula', appearance: 'dark', lightTheme: 'porcelain', calendarDensity: 72,
        totalsVisible: true, taskView: 'grouped', colorSeed: 42, defaultView: 'timeGridDay',
        lastSelectedView: 'timeGridThreeDay', firstDayOfWeek: 0, slotDuration: 45,
        lastSelectedSlot: 60, idleDetectorEnabled: false, enableVimMotions: false,
        enableSessionReview: false, hideLeftSidebar: true, lastHideLeftSidebar: true,
        hideRightSidebar: 'false', lastHideRightSidebar: false, autoScrollNow: false,
        customColor: '#abcdef'
    };
    b.storage.set('timetrace_user_settings', JSON.stringify(fixture));
    b.storage.set('timetrace_left_sidebar_width', '320');
    b.storage.set('timetrace_right_sidebar_width', '280');
    b.storage.set('timetrace_slot_duration', '45');
    b.run('openSettingsModal(true)');
    b.elements.setting_calendar_density.value = '56';
    await b.run('saveSettingsFromModal()');
    assert.deepEqual(b.saved(), {...fixture, calendarDensity: 56});
    assert.equal(b.storage.get('timetrace_left_sidebar_width'), '320');
    assert.equal(b.storage.get('timetrace_right_sidebar_width'), '280');
    assert.equal(b.storage.get('timetrace_slot_duration'), '45');
    b.run('openSettingsModal(true)');
    assert.equal(b.elements.setting_calendar_density.value, '56');
    assert.equal(b.elements.setting_task_view.value, 'grouped');
});

test('explicit Totals sidebar policy and remembered visibility never checkpoint contradictory values', async () => {
    const b = browser();
    b.elements.setting_hide_right_sidebar = {id: 'setting_hide_right_sidebar', type: 'select-one', value: 'auto', classList: {contains: () => false}};
    b.elements.setting_totals_visible = {id: 'setting_totals_visible', type: 'checkbox', checked: false, classList: {contains: () => false}};
    b.run('openSettingsModal(true)');
    b.elements.setting_hide_right_sidebar.value = 'true';
    b.elements.setting_totals_visible.checked = true;
    await b.run('saveSettingsFromModal()');
    assert.equal(b.saved().totalsVisible, false);
    assert.equal(b.elements.setting_totals_visible.checked, false);
    assert.equal(b.run("hasSettingsDrafts(['settings_modal'])"), false);
});

test('color reshuffle never reconciles an unrelated pending daemon idle preference', async () => {
    const b = browser();
    b.run('let idleDetectionEnabled = false; const s = getUserSettings(); s.idleDetectorEnabled = true; saveUserSettings(s); reshuffleAutoColors();');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.posts.length, 0);
    assert.equal(b.saved().colorSeed, 1);
});
