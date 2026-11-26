const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const templates = path.resolve(__dirname, '../src/timetrace/interfaces/api/templates');
const styles = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/css');

function browser(seed = {}, elements = {}) {
    const storage = new Map(Object.entries(seed));
    const attrs = {};
    const styles = {};
    const listeners = {};
    const context = vm.createContext({
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
        document: {
            documentElement: { setAttribute: (k, v) => attrs[k] = v, style: { setProperty: (k, v) => styles[k] = v } },
            getElementById: id => elements[id] || Object.values(elements).find(el => el.id === id) || null,
            querySelectorAll: () => [],
            addEventListener: (name, fn) => (listeners[name] ||= []).push(fn),
            dispatchEvent: event => (listeners[event.type] || []).forEach(fn => fn(event))
        },
        console, Intl, Event, setTimeout: fn => fn(), URL, URLSearchParams,
        window: { location: { href: 'http://localhost/dashboard', search: '' }, addEventListener() {} }
    });
    context.window.appDialogs={confirm:async ({message})=>context.window.confirm(message), alert:({message})=>context.alert?.(message), prompt:async()=>null};
    vm.runInContext(fs.readFileSync(path.join(js, 'settings.js'), 'utf8'), context);
    return { context, storage, attrs, styles, listeners, run: code => vm.runInContext(code, context) };
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


// Day now clones a date-owned template; these two Preferences scenarios retain their real handlers.
function installDayEditorFixture(fields) {
    const textNames=['rating','highlights','friction','notes'];
    const controls=Object.fromEntries(['date',...textNames,'ratings','status','breakdown','total','created-tasks','filter','filter-label','session-count','sessions'].map(name=>{
        const control=textNames.includes(name) ? fields[`day_form_${name}`] : {value:'',style:{}};
        Object.assign(control,{dataset:{day:name},addEventListener(){},replaceChildren(){},setAttribute(){},querySelectorAll:()=>[]});
        return [name,control];
    }));
    const actions=Object.fromEntries(['save','dismiss','discard','retry','calendar','clear-filter','activity','tasks','promote'].map(action=>[action,{dataset:{action},addEventListener(){},setAttribute(){}}]));
    const root={...panel(),dataset:{},addEventListener(){},
        querySelectorAll(selector){
            if(selector==='[data-day]')return Object.values(controls);
            if(selector==='[data-action]')return Object.values(actions);
            if(selector==='[data-day-text]'||selector==='input, select, textarea')return textNames.map(name=>controls[name]);
            return [];
        },querySelector(selector){const name=selector.match(/="([^"]+)"/)?.[1];return selector.includes('data-action')?actions[name]:controls[name];}
    };
    root.classList.toggle=(name,on)=>on ? root.classList.add(name):root.classList.remove(name);
    fields.day_fixture_root=root;
    fields.day_editor_template={content:{firstElementChild:{cloneNode:()=>root}}};
    for(const id of ['day_main_editor','day_history_editor','day_editor_store'])fields[id]={appendChild(){}};
}

test('Revision day drafts survive real Preferences Save, color reshuffle and irrelevant settings application', async () => {
    const fields = Object.fromEntries(['day_form_rating', 'day_form_highlights', 'day_form_friction', 'day_form_notes'].map(id => [id, {value:'', style:{}}]));
    fields.day_review_date_input = {value:'2026-11-01'};
    fields.setting_appearance = {value:'dark'};
    fields.rev_tab_btn_sessions = panel();
    installDayEditorFixture(fields);
    const b = browser({}, fields);
    b.context.api = {get: async url => url.startsWith('/rating-definitions') ? [] : ({day_review:null, custom_ratings:[], sessions:[], task_breakdown:[], tag_breakdown:[]})};
    for (const file of ['revision_nav.js', 'ratings_config.js', 'day_review.js']) vm.runInContext(fs.readFileSync(path.join(js, file), 'utf8'), b.context);
    b.run("currentActiveRevTab = 'day'");
    await b.run('loadDayReviewData()');
    fields.day_form_notes.value = 'Unsaved day reflection';
    fields.day_form_rating.value = '5';
    await b.run('saveSettingsFromModal()');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fields.day_form_notes.value, 'Unsaved day reflection');
    assert.equal(fields.day_form_rating.value, '5');
    b.run('reshuffleAutoColors()');
    await b.run('applyUserSettings()');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fields.day_form_notes.value, 'Unsaved day reflection');
    assert.equal(fields.day_form_rating.value, '5');
    b.run("saveUserSettings({...getUserSettings(), enableSessionReview:false}); updateSessionReviewTabVisibility()");
    assert.equal(fields.rev_tab_btn_sessions.classList.contains('hidden'), true);
});

test('Settings self navigation is inert; dirty Preferences cancel/leave/revert preserves separate owners', async () => {
    const appearance = {value:'light', type:'select-one'};
    const modal = panel(); modal.querySelectorAll = () => [appearance];
    const b = browser({}, {settings_modal:modal, setting_appearance:appearance});
    b.context.window.location.href = 'http://localhost/settings/ai';
    let confirmations = 0;
    b.context.window.confirm = () => { confirmations++; return false; };
    b.run('openSettingsModal()');
    appearance.value = 'dark';
    assert.equal(b.run('followSettingsLink({})'), false);
    assert.equal(b.run('followSettingsLink({metaKey:true})'), true);
    assert.equal(confirmations, 0);
    b.context.window.location.href = 'http://localhost/revision';
    assert.equal(b.run('followSettingsLink({})'), false);
    assert.equal(appearance.value, 'dark');
    assert.equal(confirmations, 1);
    b.context.window.confirm = () => true;
    assert.equal(b.run('followSettingsLink({})'), false);
    await new Promise(setImmediate);
    assert.equal(b.context.window.location.href, '/settings');
    b.context.window.location.href = 'http://localhost/revision';
    appearance.value = 'light';
    b.context.window.confirm = () => { throw Error('reverted forms are clean'); };
    assert.equal(b.run('followSettingsLink({})'), true);
    assert.equal(b.storage.size, 0);
});

test('Calendar delayed metadata startup adopts current preferences without reversing URL precedence', async () => {
    for (const failed of [false, true]) {
        const right = panel();
        const b = browser({}, {calendar:{}, right_sidebar:right});
        b.context.window.location.search = '?date=2026-10-17&view=timeGridDay&tag=%23synthetic';
        b.context.window.location.href += b.context.window.location.search;
        let release;
        b.context.fetchAllTasksRegistry = () => new Promise(resolve => release = () => resolve(failed ? null : []));
        const calendars = [];
        b.context.FullCalendar = {Calendar: class {
            constructor(_element, options) { this.options = options; calendars.push(this); }
            render() {} setOption(key, value) { this.options[key] = value; } refetchEvents() {} updateSize() {}
        }};
        for (const name of ['fetchCalendarEvents', 'setupModalKeyboardListeners', 'setupVimKeyboardListeners', 'fetchTasks', 'scrollToCurrentTime']) b.context[name] = () => {};
        b.context.getInitialScrollTime = () => '09:00:00';
        vm.runInContext('let breakdownFilter = null;', b.context);
        vm.runInContext(fs.readFileSync(path.join(js, 'calendar.js'), 'utf8'), b.context);
        vm.runInContext(fs.readFileSync(path.join(js, 'dashboard.js'), 'utf8'), b.context);
        const startup = b.listeners.DOMContentLoaded[1]();
        b.run("setAppearancePreference('appearance', 'dark'); setCalendarDensity(56); toggleCalendarPanel('right'); saveUserSettings({...getUserSettings(), firstDayOfWeek:0})");
        release();
        await startup;
        assert.equal(b.attrs['data-appearance'], 'dark');
        assert.equal(b.styles['--calendar-slot-height'], '14px');
        assert.equal(right.classList.contains('hidden'), false);
        assert.equal(calendars[0].options.firstDay, 0);
        assert.equal(calendars[0].options.initialView, 'timeGridDay');
        assert.equal(calendars[0].options.initialDate, '2026-10-17');
        assert.equal(b.run('breakdownFilter.value'), '#synthetic');
        assert.equal(b.run('getUserSettings().calendarDensity'), 56);
        assert.equal(b.run('getUserSettings().totalsVisible'), true);
    }
});

test('Habit chart selection, hidden goal, deselect and recreate tolerate appearance events', async () => {
    const elements = Object.fromEntries(['completeness_table_body','inspector_kpi_summary','goal_progression_card','inspector_habit_chips'].map(id => [id,panel()]));
    for (const id of ['chart_habit_doughnut','chart_habit_bar','chart_habit_goal_progression']) elements[id] = {getContext: () => ({canvas:{}})};
    const b = browser({}, elements);
    b.context.getComputedStyle = () => ({getPropertyValue: key => key === '--text-muted' ? '#526158' : '#dce3de'});
    const charts = [];
    b.context.Chart = class {
        constructor(ctx, config) { this.ctx = ctx; this.canvas = ctx.canvas; this.options = config.options; this.data = config.data; charts.push(this); }
        destroy() { this.canvas = null; this.ctx = null; }
        update() { assert.ok(this.canvas, 'destroyed charts must not receive updates'); }
    };
    b.context.api = {get: async () => ({goal_history:[{effective_from:'2026-11-01',target_value:3}],history:[]})};
    vm.runInContext(fs.readFileSync(path.join(js, 'habits.js'), 'utf8'), b.context);
    b.run("allHabits = [{id:'one',habit_type:'numeric',name:'Numeric',logs:{}},{id:'two',habit_type:'boolean',name:'Second',logs:{}}]; toggleHabitInspectorSelection('one')");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(charts.length, 3);
    b.run("toggleHabitInspectorSelection('two'); setAppearancePreference('appearance','dark')");
    b.run("deselectAllHabits(); setAppearancePreference('appearance','light')");
    assert.equal(charts.filter(chart => chart.canvas).length, 0);
    b.run("toggleHabitInspectorSelection('one')");
    await new Promise(resolve => setImmediate(resolve));
    b.run("setAppearancePreference('lightTheme','stone')");
    const live = charts.filter(chart => chart.canvas);
    assert.equal(live.length, 3);
    assert.equal(live[0].options.plugins.legend.labels.color, '#526158');
    // Valid missing/disposed lifecycle entries are harmless; malformed live charts still throw.
    b.context.disposed = charts[0];
    b.run('applyChartAppearance([null, undefined, disposed])');
    assert.throws(() => b.run('applyChartAppearance([{}])'));
});

test('supported Calendar views stay aligned across preference adoption and history restoration', () => {
    for (const view of ['timeGridDay','timeGridThreeDay','timeGridWeek','dayGridMonth','invalid']) {
        const b = browser({timetrace_user_settings:JSON.stringify({defaultView:view,lastSelectedView:view})});
        b.context.window.location.search = `?view=${view}`;
        vm.runInContext('let breakdownFilter = null; let calendar = {changeView(view) {this.view = view;},refetchEvents(){}}; function renderBreakdownLists(){} function renderBreakdownFilterChip(){}', b.context);
        vm.runInContext(fs.readFileSync(path.join(js, 'calendar.js'), 'utf8'), b.context);
        b.run('restoreCalendarContext()');
        assert.equal(b.run('calendar.view'), view === 'invalid' ? 'timeGridWeek' : view);
        assert.equal(b.run('getUserSettings().lastSelectedView'), view === 'invalid' ? 'timeGridWeek' : view);
        assert.equal(b.run('getUserSettings().defaultView'), view === 'invalid' ? 'auto' : view);
    }
});

test('Revision failed Save stays dirty and successful Save clears only its own draft even if the refresh fails', async () => {
    const fields = Object.fromEntries(['day_form_rating','day_form_highlights','day_form_friction','day_form_notes'].map(id => [id,{id,value:'',style:{}}]));
    fields.day_review_date_input = {value:'2026-11-01'};
    fields.rev_tab_day = {...panel(),id:'rev_tab_day',querySelectorAll: () => Object.values(fields).filter(el => el.id?.startsWith('day_form_'))};
    fields.settings_modal = {...panel(),dataset:{},id:'settings_modal',querySelectorAll: () => [fields.setting_appearance]};
    fields.setting_appearance = {id:'setting_appearance',value:'light'};
    installDayEditorFixture(fields);
    const b = browser({}, fields);
    b.context.window.location.href = 'http://localhost/revision';
    b.context.window.confirm = () => false;
    let failed = false;
    b.context.api = {get: async url => {if (failed) throw Error('synthetic refresh failure'); return url.startsWith('/rating-definitions') ? [] : {day_review:null,custom_ratings:[]};},post: async () => {if (failed) throw Error('synthetic save failure');}};
    for (const file of ['revision_nav.js','ratings_config.js','day_review.js']) vm.runInContext(fs.readFileSync(path.join(js,file),'utf8'),b.context);
    b.context.renderCustomRatingsInputs = async () => true; // This Save/Preferences fixture has no mounted rating controls.
    await b.run('loadDayReviewData()');
    fields.day_form_notes.value = 'Unsaved review';
    failed = true;
    await b.run('saveDayReviewForm()');
    assert.match(fields.day_fixture_root.querySelector('[data-day="status"]').textContent,/Save incomplete/);
    assert.equal(b.run('followSettingsLink({})'),false);
    b.run('openSettingsModal()');
    fields.setting_appearance.value = 'dark';
    b.context.api.post = async () => {};
    await b.run('saveDayReviewForm()');
    assert.equal(b.run('followSettingsLink({})'),false); // Preferences still belongs to its own Save.
    b.run('closeSettingsModal()');
    assert.equal(b.run('followSettingsLink({})'),true); // Failed read did not repeat/undo the successful Save.
});

test('late failed explicit idle-toggle Save cannot reverse newer browser density or totals; presentation never POSTs', async () => {
    const right = panel();
    const idle = {id:'setting_idle_detector',type:'checkbox',checked:false};
    const modal = {...panel(),id:'settings_modal',dataset:{settingsPageEditor:'true'},querySelectorAll: () => [idle]};
    const b = browser({}, {right_sidebar:right,settings_modal:modal,setting_idle_detector:idle});
    let reject, posts = 0;
    b.context.api = {post: () => { posts++; return new Promise((_resolve,no) => reject = no); }};
    b.run('let idleDetectionEnabled = true; saveUserSettings({...getUserSettings(), idleDetectorEnabled:false})');
    await b.run('applyUserSettings()');
    assert.equal(posts,0,'owner B forbids automatic idle reconciliation');
    assert.equal(b.run('idleDetectionEnabled'),true);
    assert.equal(b.run('getUserSettings().idleDetectorEnabled'),false);
    b.run('openSettingsModal()');
    const applying = b.run('saveSettingsFromModal()');
    assert.equal(posts,1,'only explicit Save requests the daemon change');
    b.run("setCalendarDensity(72); toggleCalendarPanel('right'); setAppearancePreference('appearance','dark')");
    reject(Error('synthetic idle-toggle failure'));
    await applying;
    assert.equal(posts,1,'failed Save must not replay through presentation');
    assert.equal(b.attrs['data-appearance'],'dark');
    assert.equal(b.styles['--calendar-slot-height'],'18px');
    assert.equal(right.classList.contains('hidden'),false);
    assert.equal(b.run('getUserSettings().calendarDensity'),72);
    assert.equal(b.run('getUserSettings().totalsVisible'),true);
});

test('Calendar day headers retain the established day and date markup', () => {
    const source = fs.readFileSync(path.join(js, 'dashboard.js'), 'utf8');
    const header = source.match(/dayHeaderContent: function\(arg\) \{([\s\S]*?)\n\s*\},\n\s*select:/);
    assert.ok(header, 'Calendar day header callback is present');
    const callback = vm.runInNewContext(`(function(arg) {${header[1]}\n})`);
    const date = new Date(2026, 10, 16);
    const monthHeader = callback({date, view: {type: 'dayGridMonth'}}).html;
    for (const type of ['timeGridDay', 'timeGridThreeDay', 'timeGridWeek']) {
        const rendered = callback({date, view: {type}}).html;
        assert.match(rendered, /class="flex flex-col items-center py-1"/);
        assert.match(rendered, /class="text-\[10px\] font-bold tracking-widest text-slate-500 uppercase">MON</);
        assert.match(rendered, /class="mt-1 text-base font-bold text-slate-200">16</);
    }
    assert.match(monthHeader, /class="flex flex-col items-center py-1"/);
    assert.match(monthHeader, /class="mt-1 text-base font-bold text-slate-200">16</);

    const appearance = fs.readFileSync(path.join(styles, 'appearance.css'), 'utf8');
    assert.match(appearance, /\.calendar-page > header \{ align-items:\s*flex-start; \}/);
    assert.doesNotMatch(appearance, /\.tt-calendar-day-header|\.tt-calendar-day-number|\.calendar-page \.tz-header-label|\.fc-timegrid-slot-label-cushion|\.fc-col-header-cell\.fc-day-today/);
    assert.match(appearance, /\.calendar-page \.fc-daygrid-dot-event \.fc-event-custom \{ color:\s*var\(--text-main\) !important; \}/);
    assert.match(appearance, /\.calendar-page \.fc-timegrid-slot-lane \{ line-height:\s*0 !important; \}/);
    assert.doesNotMatch(appearance, /\.fc-timegrid-slot-label-cushion\s*\{[^}]*padding-(?:top|bottom)|\.fc-timegrid-slot\s*\{[^}]*min-height/);
});

test('Calendar timer and Vim mode indicators use compact non-button header treatments', () => {
    const timer = fs.readFileSync(path.join(styles, 'timer.css'), 'utf8');
    const appearance = fs.readFileSync(path.join(styles, 'appearance.css'), 'utf8');
    const navbar = fs.readFileSync(path.join(templates, 'components/navbar.html'), 'utf8');
    const dashboard = fs.readFileSync(path.join(templates, 'dashboard.html'), 'utf8');
    assert.match(timer, /height:\s*32px; min-height:\s*32px; flex-wrap:\s*nowrap; gap:\s*6px; padding:\s*2px 6px/);
    assert.doesNotMatch(timer, /\.calendar-page #active_timer_pill\s*\{[^}]*overflow:/);
    assert.match(timer, /#active_timer_pill :is\(select, button\) \{ min-height:\s*24px/);
    assert.match(timer, /\.timer-recovery-card :is\(button, input, textarea\) \{[^}]*padding:\s*6px 9px/);
    assert.match(appearance, /#vim_mode_indicator\s*\{[\s\S]*?background:\s*transparent !important/);
    assert.doesNotMatch(appearance.match(/#vim_mode_indicator\s*\{[^}]+\}/)?.[0] || '', /display:\s*[^;]+!important/);
    assert.match(navbar, /id="vim_mode_indicator"[^>]*role="status"[^>]*aria-live="polite"/);
    const strip=fs.readFileSync(path.join(templates,'components/timer_workspace_bar.html'),'utf8');
    assert.match(strip, /timer\.css\?v=ui-review2-3/);
    assert.match(strip, /data-timer-selected/);
    assert.doesNotMatch(dashboard, /id="active_timer_pill"/);
    assert.match(dashboard, /appearance\.css\?v=/);
    assert.match(dashboard, /dashboard\.js\?v=/);
});
