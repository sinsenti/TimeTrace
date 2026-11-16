const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function browser(saved = {}, path = '/dashboard') {
    const storage = new Map(Object.entries(saved));
    const elements = {};
    const listeners = {};
    function element() {
        const classes = new Set(['hidden']);
        return {value: '', children: [], dataset: {}, isConnected: true, textContent: '',
            classList: {contains: x => classes.has(x), add: x => classes.add(x), remove: x => classes.delete(x), toggle(x, on) { on ? classes.add(x) : classes.delete(x); }},
            setAttribute(k, v) { this[k] = v; }, appendChild(x) { this.children.push(x); }, replaceChildren(...xs) { this.children = xs; },
            get options() { return this.children; }, focus() { document.activeElement = this; }, select() {}, contains(x) { return Object.values(elements).includes(x); }};
    }
    for (const id of ['custom_filter_modal', 'filter_input_query', 'filter_input_status', 'filter_input_category', 'filter_input_est_op', 'filter_input_est_mins', 'filter_input_priority', 'filter_status_feedback', 'filter_status_retry', 'filter_persistence_feedback']) elements[id] = element();
    const launcher = element(); launcher.classList.remove('hidden');
    const document = {activeElement: launcher, getElementById: id => elements[id], createElement: element,
        querySelectorAll: selector => selector === '.custom-filter-trigger-btn' ? [launcher] : [], addEventListener() {}};
    let reads = [];
    let refreshes = 0;
    const ctx = vm.createContext({console, document, setTimeout: fn => fn(), localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v)},
        window: {location: {pathname: path}, addEventListener: (k,fn) => { listeners[k] = fn; }},
        api: {get: () => new Promise((resolve, reject) => reads.push({resolve,reject}))}, loadKanbanBoard: () => refreshes++});
    vm.runInContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/custom_filter.js', 'utf8'),ctx);
    return {ctx, elements, launcher, document, storage, reads, listeners, run: code => vm.runInContext(code,ctx), refreshes: () => refreshes};
}
test('malformed custom JSON retains valid legacy status and independently invalid fields fall back', () => {
    const b = browser({timetrace_dashboard_custom_filter: '{', timetrace_dashboard_status_filter: 'Waiting'});
    assert.equal(b.run('matchesCustomFilter({status: "To Do"})'), false);
    const c = browser({timetrace_dashboard_custom_filter: JSON.stringify({status:'Waiting', query: {}, category:'unusual', estOp:'bad', priority:[], estMins:Infinity})});
    assert.equal(c.run('matchesCustomFilter({status:"Waiting", category:"unusual"})'), true);
});
test('open retains unavailable saved choices, Cancel discards edits and stale status reads cannot overwrite reopening', async () => {
    const b = browser({timetrace_dashboard_custom_filter: JSON.stringify({status:'Custom <\'name>', category:'other', estMins:37, query:'saved'})});
    b.run('openCustomFilterModal()');
    assert.equal(b.elements.filter_input_status.value, 'Custom <\'name>');
    assert.ok(b.elements.filter_input_status.options.some(x => x.textContent.includes('unavailable')));
    b.elements.filter_input_query.value = 'discard'; b.run('closeCustomFilterModal(); openCustomFilterModal()');
    b.reads[1].resolve([{name:'Current'}]); await new Promise(setImmediate);
    b.reads[0].resolve([{name:'Stale'}]); await new Promise(setImmediate);
    assert.equal(b.elements.filter_input_query.value,'saved');
    assert.ok(!b.elements.filter_input_status.options.some(x => x.value === 'Stale'));
    assert.equal(b.elements.filter_input_category.value,'other');
    assert.equal(b.elements.filter_input_est_mins.value,'37');
});
test('Apply and Clear refresh actual page hook, preserve unrelated preferences and predicate semantics', () => {
    const b = browser({timetrace_user_settings:'unchanged'}, '/tasks-view');
    b.run('openCustomFilterModal()');
    Object.assign(b.elements.filter_input_query,{value:'TAG'});
    for (const [field,value] of Object.entries({status:'Waiting',category:'work',est_op:'lte',est_mins:'30',priority:'high'})) b.elements['filter_input_'+field].value = value;
    b.run('applyCustomFilterFromModal()');
    assert.equal(b.run('matchesCustomFilter({status:"Waiting",tags:"tag",priority:"high",estimated_minutes:30})'),true);
    assert.equal(b.run('matchesCustomFilter({status:"Waiting",tags:"tag",priority:"high",estimated_minutes:31})'),false);
    assert.equal(b.storage.get('timetrace_tasks_status_filter'),'Waiting');
    b.run('clearCustomFilter()');
    assert.equal(b.refreshes(),2); assert.equal(b.storage.get('timetrace_user_settings'),'unchanged');
    assert.equal(b.run('matchesCustomFilter({})'),true);
});
test('status read failure is retryable and blocked persistence keeps applied filter usable', async () => {
    const b = browser(); b.run('openCustomFilterModal()');
    b.reads[0].reject(Error('offline')); await new Promise(setImmediate);
    assert.match(b.elements.filter_status_feedback.textContent,/Could not load/);
    assert.equal(b.elements.filter_status_retry.classList.contains('hidden'),false);
    b.ctx.localStorage.setItem = () => { throw Error('blocked'); };
    b.elements.filter_input_query.value = 'needle'; b.run('applyCustomFilterFromModal()');
    assert.equal(b.run('matchesCustomFilter({title:"other"})'),false);
    assert.match(b.launcher.title,/this visit only/);
});
test('keyboard Cancel restores launcher and ignores shortcuts owned by a newer dialog', () => {
    const b = browser(); b.run('openCustomFilterModal()');
    b.elements.filter_input_query.value='cancelled';
    const event = {key:'Escape',preventDefault(){},stopPropagation(){}};
    b.listeners.keydown(event);
    assert.equal(b.document.activeElement,b.launcher);
    assert.equal(b.run('matchesCustomFilter({})'),true);
});
test('Apply and Clear reach real Kanban and Grouped dispatcher with search and estimate boundaries', async () => {
    for (const view of ['kanban','grouped']) {
        const b = browser({}, '/tasks');
        for (const id of ['task_view_selector','task_view_notice','tasks_search','kanban_columns_container','tasks_heading','tasks_workspace']) {
            const classes = new Set();
            b.elements[id] = {value:'',textContent:'',innerHTML:'',classList:{
                add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
                toggle(x, force) {
                    const on = force === undefined ? !classes.has(x) : Boolean(force);
                    on ? classes.add(x) : classes.delete(x);
                    return on;
                }
            },setAttribute(){},contains(){return false;}};
        }
        b.elements.tasks_search.value='needle';
        b.ctx.getUserSettings = () => ({taskView:view}); b.ctx.saveUserSettings = () => {};
        b.ctx.escapeHtml = x => String(x ?? ''); b.ctx.formatMinutesToDuration = x => `${x}m`;
        b.ctx.getTaskDateBadge = () => null;
        b.ctx.taskKnowledge = {state:()=>({generation:0}),viewResult(){},get(){return null;}};
        b.ctx.api.get = async url => url.includes('statuses') ? [{id:'019adc00-1234-7000-8000-000000000001',name:'Waiting'}] : [
            {id:'019adc00-1234-7000-8000-000000000002',title:'needle boundary',tags:'match',status:'Waiting',estimated_minutes:30,priority:'high'},
            {id:'019adc00-1234-7000-8000-000000000003',title:'needle smaller',tags:'match',status:'Waiting',estimated_minutes:15,priority:'high'},
            {id:'019adc00-1234-7000-8000-000000000004',title:'needle larger',tags:'match',status:'Waiting',estimated_minutes:45,priority:'high'},
            {id:'019adc00-1234-7000-8000-000000000005',title:'other search',tags:'match',status:'Waiting',estimated_minutes:30,priority:'high'}];
        for (const file of ['kanban.js','grouped_tasks.js']) vm.runInContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/'+file,'utf8'),b.ctx);
        b.run('setupTaskViewSelector()');
        for (const [op,small,boundary,large] of [['lt',true,false,false],['lte',true,true,false],['eq',false,true,false],['gte',false,true,true]]) {
            b.run('openCustomFilterModal()');
            for (const [id,value] of Object.entries({query:'match',status:'Waiting',category:'work',est_op:op,est_mins:'30',priority:'high'})) b.elements['filter_input_'+id].value=value;
            b.run('applyCustomFilterFromModal()'); await new Promise(setImmediate);
            const html = b.elements.kanban_columns_container.innerHTML;
            assert.equal(html.includes('needle smaller'),small,`${view} ${op} smaller`);
            assert.equal(html.includes('needle boundary'),boundary,`${view} ${op} boundary`);
            assert.equal(html.includes('needle larger'),large,`${view} ${op} larger`);
            assert.ok(!html.includes('other search'));
            assert.equal(b.run('selectedTaskView'),view);
        }
        b.run('clearCustomFilter()'); await new Promise(setImmediate);
        assert.match(b.elements.kanban_columns_container.innerHTML,/needle larger/);
    }
});
test('invalid status response preserves saved option and offers retry', async () => {
    const b = browser({timetrace_dashboard_status_filter:'Waiting'}); b.run('openCustomFilterModal()');
    b.reads[0].resolve(null); await new Promise(setImmediate);
    assert.equal(b.elements.filter_input_status.value,'Waiting');
    assert.ok(b.elements.filter_input_status.options.some(x => x.value==='Waiting'));
    assert.equal(b.elements.filter_status_retry.classList.contains('hidden'),false);
});

test('newer dialog keyboard ownership retains open filter and pending edits', () => {
    const b = browser(); b.run('openCustomFilterModal()');
    const otherInput = {};
    b.document.activeElement = otherInput;
    b.document.querySelectorAll = selector => selector === '[role="dialog"]' ? [{classList:{contains:()=>false},contains:x=>x===otherInput}] : [b.launcher];
    let prevented = false;
    b.listeners.keydown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){}});
    assert.equal(prevented,false);
    assert.equal(b.elements.custom_filter_modal.classList.contains('hidden'),false);
});
test('real Calendar handoff history and session chip remain independent from advanced task filters', () => {
    const b = browser({timetrace_dashboard_status_filter:'Waiting'});
    b.ctx.URL = URL; b.ctx.URLSearchParams = URLSearchParams;
    b.ctx.taskKnowledge = {get:()=>({title:'<deleted or hostile>'}),state:()=>({generation:0}),viewResult(){}};
    b.ctx.getUserSettings = () => ({lastSelectedView:'timeGridDay'});
    b.ctx.escapeHtml = x => String(x).replaceAll('<','&lt;').replaceAll('>','&gt;');
    b.elements.breakdown_filter_chip = {classList:{add(){},remove(){}},innerHTML:''};
    b.ctx.window.location.href='http://localhost/dashboard?date=2026-11-13&task=__none__&view=timeGridDay';
    b.ctx.window.location.search=new URL(b.ctx.window.location.href).search;
    const history = [b.ctx.window.location.href];
    b.ctx.history = {pushState:(_,__,url)=>{history.push(String(url)); b.ctx.window.location.href=String(url); b.ctx.window.location.search=new URL(url).search;}};
    b.run('let calendar = {view:{type:"timeGridDay"},getDate:()=>new Date(2026,10,13),refetchEvents(){},changeView(view,date){this.view.type=view;this.date=date;}};');
    b.run('const SUPPORTED_CALENDAR_VIEWS = ["timeGridDay","timeGridThreeDay"];');
    for (const file of ['sidebar_totals.js','calendar.js']) vm.runInContext(fs.readFileSync('src/timetrace/interfaces/api/static/js/'+file,'utf8'),b.ctx);
    b.run('restoreCalendarContext()');
    assert.equal(b.run('sessionMatchesBreakdownFilter({task_id:null})'),true);
    assert.equal(b.run('sessionMatchesBreakdownFilter({task_id:"019adc00-1234-7000-8000-000000000002"})'),false);
    assert.match(b.elements.breakdown_filter_chip.innerHTML,/Direct Session Log/);
    b.run('clearCustomFilter()');
    assert.equal(new URL(b.ctx.window.location.href).searchParams.get('task'),'__none__');
    b.run('toggleBreakdownFilter("tag","#work")');
    const tagURL=b.ctx.window.location.href;
    assert.equal(b.run('sessionMatchesBreakdownFilter({tags:"#work #rest"})'),true);
    assert.equal(b.run('sessionMatchesBreakdownFilter({tags:"#rest"})'),false);
    b.run('clearBreakdownFilter()');
    assert.equal(new URL(b.ctx.window.location.href).searchParams.has('tag'),false);
    b.ctx.window.location.href=tagURL; b.ctx.window.location.search=new URL(tagURL).search;
    b.run('restoreCalendarContext()');
    assert.equal(b.run('breakdownFilter.value'),'#work');
    assert.equal(b.run('calendar.date'),'2026-11-13');
    b.ctx.window.location.search=new URL(history.at(-1)).search; b.run('restoreCalendarContext()');
    assert.equal(b.run('breakdownFilter'),null);
    b.run('toggleBreakdownFilter("task","019adc00-1234-7000-8000-000000000002")');
    assert.match(b.elements.breakdown_filter_chip.innerHTML,/&lt;deleted or hostile&gt;/);
});
test('Cancel restores a connected filter launcher fallback when original launcher disappears', () => {
    const b=browser(); b.run('openCustomFilterModal()'); b.launcher.isConnected=false;
    let restored=false;
    const fallback={isConnected:true,focus(){restored=true;}};
    b.document.querySelectorAll=selector=>selector==='.custom-filter-trigger-btn'?[fallback]:[];
    b.run('closeCustomFilterModal()'); assert.equal(restored,true);
});
