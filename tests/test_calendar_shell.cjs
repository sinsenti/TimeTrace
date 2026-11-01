const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');

function browser(seed = {}, elements = {}) {
    const storage = new Map(Object.entries(seed));
    const attrs = {};
    const listeners = {};
    const context = vm.createContext({
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
        document: {
            documentElement: { setAttribute: (k, v) => attrs[k] = v, style: { setProperty() {} } },
            getElementById: id => elements[id] || null,
            querySelectorAll: () => [],
            addEventListener: (name, fn) => (listeners[name] ||= []).push(fn),
            dispatchEvent: event => (listeners[event.type] || []).forEach(fn => fn(event))
        },
        console, Intl, Event, setTimeout: fn => fn(), URL, URLSearchParams,
        window: { location: { href: 'http://localhost/dashboard', search: '' }, addEventListener() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(js, 'settings.js'), 'utf8'), context);
    return { context, storage, attrs, listeners, run: code => vm.runInContext(code, context) };
}

test('a new browser starts Refined Archive/light with Spacious density and closed totals', () => {
    const b = browser();
    const s = b.run('getUserSettings()');
    assert.equal(s.appearance, 'light');
    assert.equal(s.lightTheme, 'refined');
    assert.equal(s.calendarDensity, 88);
    assert.equal(s.totalsVisible, false);
    assert.equal(s.taskView, 'kanban');
    b.run('applyAppearance()');
    assert.equal(b.attrs['data-theme'], 'light');
});

test('existing dark palette, sidebar choices and unrelated user colors survive adoption and reload', () => {
    const b = browser({ timetrace_user_settings: JSON.stringify({
        theme: 'nord', colorSeed: 9, hideRightSidebar: 'auto', lastHideRightSidebar: false,
        firstDayOfWeek: 0, slotDuration: 30, customColor: '#123456', taskView: 'outline'
    }) });
    const s = b.run('getUserSettings()');
    assert.equal(s.appearance, 'dark');
    assert.equal(s.theme, 'nord');
    assert.equal(s.totalsVisible, true);
    assert.equal(s.taskView, 'outline');
    b.run('saveUserSettings(getUserSettings())');
    const reloaded = browser(Object.fromEntries(b.storage)).run('getUserSettings()');
    assert.equal(reloaded.customColor, '#123456');
    assert.equal(reloaded.colorSeed, 9);
    assert.equal(reloaded.firstDayOfWeek, 0);
    assert.equal(reloaded.slotDuration, 30);
    assert.equal(reloaded.appearance, 'dark');
});

test('invalid or missing individual preferences default without resetting valid neighbors', () => {
    const b = browser({ timetrace_user_settings: JSON.stringify({
        theme: 'dracula', appearance: 'automatic', lightTheme: 'rejected', calendarDensity: 7,
        totalsVisible: 'yes', taskView: 'unknown', firstDayOfWeek: 0, colorSeed: 12,
        hideLeftSidebar: 'true', lastSelectedView: 'timeGridDay'
    }) });
    const s = b.run('getUserSettings()');
    assert.equal(s.appearance, 'dark');
    assert.equal(s.lightTheme, 'refined');
    assert.equal(s.calendarDensity, 88);
    assert.equal(s.totalsVisible, false);
    assert.equal(s.taskView, 'kanban');
    assert.equal(s.firstDayOfWeek, 0);
    assert.equal(s.colorSeed, 12);
    assert.equal(s.hideLeftSidebar, 'true');
    assert.equal(s.lastSelectedView, 'timeGridDay');
    for (const raw of ['null', '[]', '1', '{broken']) {
        assert.equal(browser({timetrace_user_settings: raw}).run('getUserSettings().lightTheme'), 'refined');
    }
});

test('light choice and manual mode switching persist without data reloads or replacing focused drafts', () => {
    const notes = { value: 'Unsaved\nnotes' };
    const b = browser({ timetrace_user_settings: JSON.stringify({ theme: 'nord', colorSeed: 4 }) }, { session_modal_notes: notes });
    b.run("setAppearancePreference('lightTheme', 'stone'); setAppearancePreference('appearance', 'light')");
    assert.equal(b.attrs['data-theme'], 'light');
    assert.equal(b.attrs['data-light-theme'], 'stone');
    b.run("setAppearancePreference('appearance', 'dark')");
    assert.equal(b.attrs['data-theme'], 'nord');
    assert.equal(notes.value, 'Unsaved\nnotes');
    const reload = browser(Object.fromEntries(b.storage));
    reload.run('applyAppearance()');
    assert.equal(reload.attrs['data-theme'], 'nord');
    assert.equal(reload.attrs['data-light-theme'], 'stone');
    assert.equal(reload.run('getUserSettings().colorSeed'), 4);
});

function panel() {
    const classes = new Set();
    return { classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) } };
}

test('density and independent panel toggles retain the browser choices after reload', () => {
    const left = panel(), right = panel();
    const b = browser({}, { left_sidebar: left, right_sidebar: right });
    b.run("setCalendarDensity(56); toggleCalendarPanel('right'); toggleCalendarPanel('left')");
    const s = browser(Object.fromEntries(b.storage)).run('getUserSettings()');
    assert.equal(s.calendarDensity, 56);
    assert.equal(s.totalsVisible, true);
    assert.equal(s.lastHideLeftSidebar, true);
    assert.equal(right.classList.contains('hidden'), false);
    assert.equal(left.classList.contains('hidden'), true);
});

test('Calendar query chip updates the public URL and restores date/view/filter on history navigation', () => {
    const b = browser();
    b.context.window.location.href = 'http://localhost/dashboard?date=2026-09-16&tag=%23work&view=timeGridDay';
    b.context.window.location.search = '?date=2026-09-16&tag=%23work&view=timeGridDay';
    b.context.history = { pushState: (_, __, url) => { b.context.window.location.href = String(url); } };
    vm.runInContext('let breakdownFilter = null; let calendar = {view: {type: "timeGridDay"}, getDate: () => new Date(2026,8,16), refetchEvents() {}, changeView(view, date) { this.view.type = view; this.date = date; } }; function renderBreakdownLists() {} function renderBreakdownFilterChip() {}', b.context);
    vm.runInContext(fs.readFileSync(path.join(js, 'calendar.js'), 'utf8'), b.context);
    b.run('restoreCalendarContext()');
    assert.equal(b.run('breakdownFilter.value'), '#work');
    assert.equal(b.run('calendar.date'), '2026-09-16');
    b.run("breakdownFilter = {type: 'task', value: 'uuid-synthetic'}; syncCalendarContext()");
    const url = new URL(b.context.window.location.href);
    assert.equal(url.searchParams.get('task'), 'uuid-synthetic');
    assert.equal(url.searchParams.has('tag'), false);
    assert.equal(url.searchParams.get('date'), '2026-09-16');
    b.context.window.location.search = '?date=2026-09-15&tag=%23rest&view=timeGridThreeDay';
    b.run('restoreCalendarContext()');
    assert.equal(b.run('calendar.view.type'), 'timeGridThreeDay');
    assert.equal(b.run('calendar.date'), '2026-09-15');
    assert.equal(b.run('breakdownFilter.value'), '#rest');
});

test('planning actions search existing cards and open a task-attached session without writing data', () => {
    const b = browser();
    const cards = [{ dataset: {taskTitle: 'Write proposal'} }, {dataset: {taskTitle: 'Review plan'}}];
    b.context.document.querySelectorAll = () => cards;
    let opened;
    b.context.openCreateSessionModal = (...args) => opened = args;
    vm.runInContext('let calendar = { getDate: () => new Date(2026, 8, 16) };', b.context);
    vm.runInContext(fs.readFileSync(path.join(js, 'calendar.js'), 'utf8'), b.context);
    b.run("filterPlanningTasks('WRITE'); createPlanningSession('synthetic-task')");
    assert.equal(cards[0].hidden, false);
    assert.equal(cards[1].hidden, true);
    assert.equal(opened[0].getDate(), 16);
    assert.equal(opened[1], null);
    assert.equal(opened[2], 'synthetic-task');
});

test('Preferences traps Tab and restores its launcher on Escape without saving', () => {
    let focused = 'launcher';
    const first = { focus: () => focused = 'first' }, last = { focus: () => focused = 'last' };
    const modal = panel();
    modal.querySelectorAll = () => [first, last];
    const b = browser({}, { settings_modal: modal, setting_theme: first });
    b.context.document.activeElement = { focus: () => focused = 'launcher' };
    b.run('setupSettingsKeyboardShortcuts(); openSettingsModal()');
    b.context.document.activeElement = last;
    let prevented = false;
    b.listeners.keydown[0]({key: 'Tab', preventDefault: () => prevented = true});
    assert.equal(prevented, true);
    assert.equal(focused, 'first');
    b.listeners.keydown[0]({key: 'Escape', preventDefault() {}});
    assert.equal(focused, 'launcher');
    assert.equal(b.storage.has('timetrace_user_settings'), false);
});

test('Calendar Vim shortcuts do not consume keyboard activation of shell buttons', () => {
    const b = browser();
    b.context.document.activeElement = { tagName: 'BUTTON' };
    vm.runInContext(fs.readFileSync(path.join(js, 'vim_engine.js'), 'utf8'), b.context);
    b.run('setupVimKeyboardListeners()');
    let opened = 0;
    b.context.openCreateSessionModal = () => opened++;
    b.listeners.keydown[0]({key: 'Enter', preventDefault() {}});
    assert.equal(opened, 0);
});

test('planning search reports an honest empty state without clearing the task list', () => {
    const count = { textContent: '' };
    const b = browser({}, {selected_tasks_count: count});
    const card = {dataset:{taskTitle:'Synthetic task'}};
    b.context.document.querySelectorAll = () => [card];
    vm.runInContext(fs.readFileSync(path.join(js, 'calendar.js'), 'utf8'), b.context);
    b.run("filterPlanningTasks('absent')");
    assert.equal(count.textContent, 'No matching tasks');
    assert.equal(card.hidden, true);
    b.run("filterPlanningTasks('')");
    assert.equal(count.textContent, '1 task');
    assert.equal(card.hidden, false);
});

test('global Escape dismissal does not blur the Preferences launcher restored by its close handler', () => {
    const modal = panel();
    const b = browser({}, {settings_modal: modal});
    const launcher = {focus: () => b.context.document.activeElement = launcher, blur: () => b.context.document.activeElement = null};
    const field = {focus: () => b.context.document.activeElement = field, blur: () => b.context.document.activeElement = null};
    b.context.document.activeElement = launcher;
    b.context.document.getElementById = id => id === 'settings_modal' ? modal : id === 'setting_theme' ? field : null;
    let capture;
    b.context.window.addEventListener = (name, fn) => { if (name === 'keydown') capture = fn; };
    vm.runInContext(fs.readFileSync(path.join(js, 'utils.js'), 'utf8'), b.context);
    b.run('openSettingsModal()');
    capture({key:'Escape', preventDefault() {}, stopPropagation() {}});
    assert.equal(b.context.document.activeElement, launcher);
    assert.equal(modal.classList.contains('hidden'), true);
});

test('chart appearance changes neutral labels only and restores existing dark styling without replacing data', () => {
    const b = browser();
    b.context.getComputedStyle = () => ({getPropertyValue: key => key === '--text-muted' ? '#526158' : '#dce3de'});
    const data = {labels:['Synthetic'], datasets:[{data:[2],backgroundColor:'#123456'}]};
    const chart = {data, options:{plugins:{legend:{labels:{color:'#94a3b8'}}},scales:{x:{ticks:{color:'#64748b'},grid:{color:'#1a1c26'}}}}, update() {}};
    b.context.chart = chart;
    b.run('applyChartAppearance([chart])');
    assert.equal(chart.options.plugins.legend.labels.color, '#526158');
    assert.equal(chart.options.scales.x.ticks.color, '#526158');
    assert.equal(chart.options.scales.x.grid.color, '#dce3de');
    assert.equal(chart.data, data);
    assert.equal(chart.data.datasets[0].backgroundColor, '#123456');
    b.run("setAppearancePreference('appearance', 'dark'); applyChartAppearance([chart])");
    assert.equal(chart.options.plugins.legend.labels.color, '#94a3b8');
    assert.equal(chart.options.scales.x.ticks.color, '#64748b');
    assert.equal(chart.options.scales.x.grid.color, '#1a1c26');
});
