const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const outlineCss = fs.readFileSync(path.resolve(__dirname, '../src/timetrace/interfaces/api/static/css/outline_tasks.css'), 'utf8');
function element(id, value = '') {
    const classes = new Set();
    return {id, value, isConnected: true, type: 'text', checked: false, disabled: false, dataset: {}, style: {}, textContent: '', innerHTML: '',
        classList: {add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, force) { if(force) classes.add(x); else classes.delete(x); }},
        setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name]; },
        querySelectorAll: () => [], contains: () => false, addEventListener() {}, focus() { this.focused = true; }};
}
function fixture({details = false, respond = async () => []} = {}) {
    const ids = ['task_view_selector', 'task_view_notice', 'tasks_search', 'kanban_columns_container', 'tasks_heading', 'tasks_workspace',
        'outline_inspector', 'outline_inspector_panel', 'outline_empty', 'outline_selection_notice', 'outline_details_link'];
    if (details) ids.push('inspector_task_id', 'task_properties_editor', 'task_properties_status', 'detail_task_title_header',
        'detail_task_sessions_list', 'subtasks_tree_container', 'subtask_modal', 'inspector_save_btn', 'inspector_cancel_btn', 'task_breadcrumbs',
        'edit_subtask_id','subtask_parent_id','modal_subtask_title','modal_subtask_tags','modal_subtask_est',
        'modal_subtask_status','modal_subtask_priority','subtask_save_btn','subtask_save_status','subtask_modal_heading',
        ...['title', 'tags', 'desc', 'status', 'category', 'priority', 'est', 'is_recurring', 'recurrence_rule', 'assigned_date', 'due_date', 'attachments'].map(key=>'inspector_edit_'+key));
    const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
    if (details) { elements.subtask_modal.classList.add('hidden'); elements.task_properties_editor.disabled = true; }
    const events = {}, writes = [], results = [];
    let settings = {taskView: 'outline', theme: 'nord', colorSeed: 42}, generation = 0, confirm = true;
    const document = {getElementById: id => elements[id] || null, activeElement: null, body: element('body'),
        querySelectorAll: () => [], addEventListener(name, handler) { (events[name] ||= []).push(handler); },
        createElement: tag=>({...element(''), tagName: tag.toUpperCase()})};
    const context = vm.createContext({document, console: {error() {}}, Date, encodeURIComponent,
        localStorage: {getItem: () => null, setItem() {}}, setTimeout: fn => fn(), alert() {},
        getUserSettings: () => settings, saveUserSettings: value => { settings = value; },
        taskKnowledge: {state: () => ({generation}), values: () => [], get: () => null, viewResult: (...args) => results.push(args),
            changed: async () => details ? context.loadTaskDetailTree(true) : undefined, load() {}},
        api: {get: url => respond(url), put: async (url, body) => { writes.push({url, body}); return {id: url.split('/').at(-1), ...body}; }},
        matchesCustomFilter: task => task.tags !== '#exclude'});
    context.window = context;
    context.appDialogs = {confirm:async ({message})=>context.confirm(message), alert:({message})=>context.alert(message)};
    context.addEventListener = () => {}; context.confirm = () => confirm;
    for (const file of ['utils.js', ...(details ? ['settings.js', 'subtasks.js'] : []), 'kanban.js', 'grouped_tasks.js', 'outline_tasks.js']) {
        if (fs.existsSync(path.join(source, file))) vm.runInContext(fs.readFileSync(path.join(source, file), 'utf8'), context);
    }
    // Use the real draft checkpoint with a DOM adapter for the mounted editor.
    if (details) {
        const fields = Object.values(elements).filter(el => el.id.startsWith('inspector_edit_'));
        const select = (items, selector) => selector.includes('#') ? items.filter(el => selector.split(',').some(s => s.trim() === '#'+el.id)) : items;
        elements.task_properties_editor.querySelectorAll = selector => select(fields, selector);
        const children=Object.values(elements).filter(el=>el.id.startsWith('modal_subtask_') || el.id==='edit_subtask_id');
        elements.subtask_modal.querySelectorAll=selector=>select(children,selector);
        elements.subtask_modal.cloneNode=()=>{const copies=children.map(el=>({...element(el.id,el.value),checked:el.checked,type:el.type})); return {...element('subtask_modal'),querySelectorAll:selector=>select(copies,selector)};};
        elements.task_properties_editor.cloneNode = () => {
            const children = fields.map(el=>({...element(el.id,el.value),checked:el.checked,type:el.type}));
            return {...element('task_properties_editor'),querySelectorAll: selector=>select(children,selector)};
        };
    }
    return {elements, context, writes, results, settings: () => settings, run: code => vm.runInContext(code, context),
        set confirm(value) { confirm = value; }, invalidate() {generation++;},
        input(id, value) {elements[id].value=value; for (const handler of events.input || []) handler({target: elements[id]});}, events};
}

test('outline preference renders Outline and retains unrelated preferences across three views', () => {
    const p = fixture();
    p.run('setupTaskViewSelector(); renderCurrentTaskView()');
    assert.equal(p.elements.tasks_workspace['aria-label'], 'Task outline and inspector');
    assert.equal(p.elements.task_view_notice.textContent, '');
    assert.match(p.elements.kanban_columns_container.innerHTML, /No matching tasks/);
    p.run('selectTaskView("grouped"); selectTaskView("outline")');
    assert.equal(p.settings().theme, 'nord'); assert.equal(p.settings().colorSeed, 42);
    assert.equal(p.settings().taskView, 'outline');
});

test('outline empty state honors hidden when its layout rule sets display:grid', () => {
    assert.match(outlineCss, /\.outline-empty-state\s*\{[^}]*display:\s*grid/s);
    assert.match(outlineCss, /#outline_empty\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test('Kanban cards separate tags into escaped chips and keep UUIDs quoted in handlers', () => {
    const p = fixture();
    p.context.task = {id:'0195e535-0000-7000-8000-00000000000a',title:'Chip task',status:'To Do',tags:'#one, #two <img>'};
    p.run('kanbanTasks = [task]; renderedCard = renderKanbanCard(task)');
    const html = p.context.renderedCard;
    assert.equal((html.match(/class="task-tag-chip"/g) || []).length, 3);
    assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
    assert.match(html, /data-task-id="0195e535-0000-7000-8000-00000000000a"/);
    assert.match(html, /navigateToTaskDetail\('0195e535-0000-7000-8000-00000000000a', true\)/);
});

test('filtered descendants retain labeled ancestor context; orphan/cycles render once with inert text', () => {
    const p = fixture();
    p.context.rows = [
        {id:'parent-uuid', title:'Excluded ancestor', tags:'#exclude', status:'Hidden'},
        {id:'child-uuid', parent_id:'parent-uuid', title:'needle <img onerror=boom>', status:'Todo'},
        {id:'lost-uuid', parent_id:'missing-uuid', title:'needle orphan', status:'Todo'},
        {id:'cycle-a', parent_id:'cycle-b', title:'needle cycle A', status:'Todo'},
        {id:'cycle-b', parent_id:'cycle-a', title:'needle cycle B', status:'Todo'},
        {id:'secret', title:'needle secret', status:'Hidden'}];
    p.elements.tasks_search.value='needle';
    p.run('renderOutlineTasks(document.getElementById("kanban_columns_container"), [{name:"Hidden", is_hide_by_default:true}], rows)');
    const html = p.elements.kanban_columns_container.innerHTML;
    assert.match(html, /Excluded ancestor/); assert.match(html, /Ancestor context/);
    assert.match(html, /&lt;img onerror=boom&gt;/); assert.doesNotMatch(html, /<img|needle secret/);
    assert.match(html, /Parent unavailable/);
    for (const id of ['parent-uuid','child-uuid','lost-uuid','cycle-a','cycle-b']) {
        assert.equal((html.match(new RegExp(`data-task-id="${id}"`, 'g')) || []).length, 1);
    }
});

const held = () => { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes; reject=no;}); return {promise,resolve,reject}; };
const tree = (id, title=id) => ({id, title, status:'To Do', category:'work', priority:'-', estimated_minutes:30, subtasks:[]});
test('A-B-A selection rejects earlier held reads and clears old history before loading', async () => {
    const first = held(); let count = 0;
    const p = fixture({details:true, respond: async url => {
        if (url.endsWith('/tree')) return ++count === 1 ? first.promise : tree(url.split('/')[3], 'Current '+count);
        return {sessions:[]};
    }});
    p.elements.detail_task_sessions_list.innerHTML='Old history';
    const a = p.run('selectOutlineTask("a-uuid")');
    await new Promise(setImmediate);
    assert.equal(p.elements.detail_task_sessions_list.innerHTML, '');
    await p.run('selectOutlineTask("b-uuid")');
    await p.run('selectOutlineTask("a-uuid")');
    first.resolve(tree('a-uuid','Stale first A')); await a;
    assert.equal(p.elements.inspector_task_id.value, 'a-uuid');
    assert.equal(p.elements.inspector_edit_title.value, 'Current 3');
    assert.equal(p.elements.task_properties_editor.disabled, false);
});

test('dirty selection Cancel preserves draft baseline; accepted discard switches and view refresh retains editor', async () => {
    const p = fixture({details:true, respond: async url => url.endsWith('/tree') ? tree(url.split('/')[3]) : {sessions:[]}});
    await p.run('selectOutlineTask("a-uuid")');
    p.input('inspector_edit_title', 'Unsaved draft'); p.confirm=false;
    const editor=p.elements.task_properties_editor;
    assert.equal(await p.run('selectOutlineTask("b-uuid")'), false);
    assert.equal(p.elements.inspector_task_id.value,'a-uuid');
    assert.equal(p.elements.inspector_edit_title.value,'Unsaved draft');
    assert.equal(p.run('hasSettingsDrafts(["task_properties_editor"])'),true);
    p.run('selectTaskView("kanban")'); assert.equal(p.elements.outline_inspector.inert,true);
    await p.run('loadTaskDetailTree(true)');
    p.run('selectTaskView("outline")'); assert.equal(p.elements.outline_inspector.inert,false);
    assert.equal(p.elements.task_properties_editor,editor);
    assert.equal(p.elements.inspector_edit_title.value,'Unsaved draft');
    p.run('cancelInspectorTaskProperties()');
    assert.equal(p.elements.inspector_edit_title.value,'a-uuid');
    assert.equal(p.run('hasSettingsDrafts(["task_properties_editor"])'),false);
    p.input('inspector_edit_title','Discard me'); p.confirm=true;
    await p.run('selectOutlineTask("b-uuid")');
    assert.equal(p.elements.inspector_edit_title.value,'b-uuid'); assert.equal(p.writes.length,0);
});

test('failed initial read gates editing and retry only initializes its current selection; generation invalidates held reads', async () => {
    let fail=true; const old=held(); let hold=false;
    const p=fixture({details:true,respond:async url=>{
        if(fail) throw Error('404');
        if(url.endsWith('/tree')) return hold ? old.promise : tree(url.split('/')[3]);
        return {sessions:[]};
    }});
    assert.equal(await p.run('selectOutlineTask("a-uuid")'),false);
    assert.equal(p.elements.task_properties_editor.disabled,true);
    await p.run('saveInspectorTaskProperties()'); assert.equal(p.writes.length,0);
    fail=false; await p.run('loadTaskDetailTree(true)');
    p.input('inspector_edit_title','Retained draft');
    hold=true; const reading=p.run('loadTaskDetailTree(true)'); p.invalidate();
    old.resolve(tree('a-uuid','Stale generation')); assert.equal(await reading,null);
    assert.equal(p.elements.inspector_edit_title.value,'Retained draft');
    fail=true; await p.run('loadTaskDetailTree(true)');
    assert.equal(p.elements.inspector_edit_title.value,'Retained draft');
    assert.match(p.elements.task_properties_status.textContent,/retained/);
    assert.equal(p.writes.length,0);
});

test('delayed delete confirmation cannot delete after another task takes selection', async () => {
    const confirmation=held(), deletes=[];
    const p=fixture({details:true,respond:async url=>url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]}});
    p.context.showCustomConfirm=()=>confirmation.promise;
    p.context.api.delete=async url=>deletes.push(url);
    await p.run('selectOutlineTask("a-uuid")');
    const deleting=p.run('deleteMainInspectorTask()');
    await p.run('selectOutlineTask("b-uuid")');
    confirmation.resolve(true); await deleting;
    assert.deepEqual(deletes,[]);
    assert.equal(p.elements.inspector_task_id.value,'b-uuid');
});

test('Session return focus yields to newer focus and uses stable inspector history after refresh', () => {
    const p=fixture({details:true});
    const session=element('session_modal'), history=element('detail_session_focus'), newer=element('assistant_input');
    p.context.document.getElementById=id=>({session_modal:session,detail_session_focus:history}[id] || p.elements[id] || null);
    p.context.document.activeElement=newer;
    p.context.savedOwner={launcher:history};
    p.run('restoreSessionModalFocus(savedOwner,true)');
    assert.equal(p.elements.tasks_heading.focused,undefined);
    session.contains=target=>target===session;
    p.context.document.activeElement=session;
    p.run('restoreSessionModalFocus(savedOwner,true)');
    assert.equal(history.focused,true);
});


test('visible completion follow-up blocks selection close and duplicate property writes until resolved', async () => {
    const p=fixture({details:true,respond:async url=>url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]}});
    const modal=element('completion_policy_modal'); modal.classList.add('hidden');
    const get=p.context.document.getElementById;
    p.context.document.getElementById=id=>id==='completion_policy_modal'?modal:get(id);
    p.context.handleCompletionPolicy=()=>modal.classList.remove('hidden');
    await p.run('selectOutlineTask("a-uuid")');
    p.input('inspector_edit_title','Saved title'); await p.run('saveInspectorTaskProperties()');
    assert.equal(p.writes.length,1);
    assert.equal(await p.run('selectOutlineTask("b-uuid")'),false);
    assert.equal(await p.run('closeOutlineInspector()'),false);
    await p.run('saveInspectorTaskProperties()'); assert.equal(p.writes.length,1);
    modal.classList.add('hidden'); await p.run('selectOutlineTask("b-uuid")');
    assert.equal(p.elements.inspector_task_id.value,'b-uuid');
});

test('pending Save blocks switching and duplicate writes; ACK keeps concurrent ABA edits and failed read retry never writes', async () => {
    let fail=false;
    const p=fixture({details:true,respond:async url=>{if(fail) throw Error('503'); return url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]};}});
    await p.run('selectOutlineTask("a-uuid")');
    const ack=held(); p.context.api.put=async (url,body)=>{p.writes.push({url,body}); return ack.promise;};
    p.input('inspector_edit_title','Submitted title');
    const saving=p.run('saveInspectorTaskProperties()');
    p.input('inspector_edit_title','Other'); p.input('inspector_edit_title','Submitted title');
    assert.equal(await p.run('selectOutlineTask("b-uuid")'),false);
    assert.equal(await p.run('closeOutlineInspector()'),false);
    assert.equal(p.elements.task_properties_editor.disabled,false,'Later typing remains enabled');
    await p.run('saveInspectorTaskProperties()'); assert.equal(p.writes.length,1);
    fail=true; ack.resolve({...tree('a-uuid','Canonical title')}); await saving;
    assert.equal(p.elements.inspector_edit_title.value,'Submitted title');
    assert.equal(p.run('hasSettingsDrafts(["task_properties_editor"])'),true);
    assert.match(p.elements.task_properties_status.textContent,/Task saved.*Refresh unavailable/);
    await p.run('loadTaskDetailTree(true)'); assert.equal(p.writes.length,1);
    p.run('cancelInspectorTaskProperties()');
    assert.equal(p.elements.inspector_edit_title.value,'Canonical title');
    assert.equal(p.run('hasSettingsDrafts(["task_properties_editor"])'),false);
});

test('inline shortcuts ignore hidden editor search and Assistant typing; visible properties keep explicit Save', async () => {
    const p=fixture({details:true,respond:async url=>url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]}});
    await p.run('selectOutlineTask("a-uuid")');
    p.run('setupInspectorKeyboardShortcuts()');
    const property=p.elements.inspector_edit_title;
    p.elements.outline_inspector.contains=el=>el===property;
    p.elements.task_properties_editor.contains=el=>el===property;
    const dispatch=target=>{const event={target,key:'Enter',ctrlKey:true,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
        for(const handler of p.events.keydown || []) handler(event);};
    p.elements.outline_inspector.hidden=true; dispatch(property);
    p.elements.outline_inspector.hidden=false; p.elements.outline_inspector.inert=false;
    dispatch(p.elements.tasks_search); dispatch(element('assistant_input'));
    assert.equal(p.writes.length,0);
    dispatch(property); assert.equal(p.writes.length,1);
    await Promise.resolve();
});

test('acknowledged deletion clears selected owner while failed deletion retains draft and no implicit selection', async () => {
    const p=fixture({details:true,respond:async url=>url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]}});
    p.context.showCustomConfirm=async()=>true;
    await p.run('selectOutlineTask("a-uuid")'); p.input('inspector_edit_title','Copy me');
    p.context.api.delete=async()=>{throw Error('503');};
    await p.run('deleteMainInspectorTask()');
    assert.equal(p.elements.inspector_edit_title.value,'Copy me');
    assert.equal(p.elements.inspector_task_id.value,'a-uuid');
    p.context.api.delete=async()=>{}; await p.run('deleteMainInspectorTask()');
    assert.equal(p.elements.inspector_task_id.value,'');
    assert.equal(p.elements.task_properties_editor.disabled,true);
    assert.equal(p.elements.tasks_heading.focused,true);
});

test('root order follows board snapshot even when the first matching descendant needs filtered ancestor context', () => {
    const p=fixture(); p.context.rows=[tree('first','First context'), {...tree('child','needle child'),parent_id:'first'}, tree('second','needle second')];
    p.elements.tasks_search.value='needle';
    p.run('renderOutlineTasks(document.getElementById("kanban_columns_container"), [], rows)');
    const html=p.elements.kanban_columns_container.innerHTML;
    assert.ok(html.indexOf('data-task-id="first"') < html.indexOf('data-task-id="second"'));
});


test('pending child creation blocks inspector switching and closing; ACK refresh preserves parent draft', async () => {
    const p=fixture({details:true,respond:async url=>url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]}});
    await p.run('selectOutlineTask("a-uuid")'); p.input('inspector_edit_title','Parent draft');
    p.run('openSubtaskCreationModal()'); p.input('modal_subtask_title','Child');
    const ack=held(); p.context.api.post=async(url,body)=>{p.writes.push({url,body});return ack.promise;};
    const saving=p.run('saveSubtaskFromModal()');
    assert.equal(await p.run('selectOutlineTask("b-uuid")'),false);
    assert.equal(await p.run('closeOutlineInspector()'),false);
    await p.run('saveSubtaskFromModal()'); assert.equal(p.writes.length,1);
    ack.resolve({...tree('child-uuid','Child'),parent_id:'a-uuid'}); await saving;
    assert.equal(p.elements.inspector_edit_title.value,'Parent draft');
    p.confirm=false; assert.equal(await p.run('selectOutlineTask("b-uuid")'),false);
    assert.equal(p.writes.length,1);
});

for (const seam of ['parent','stats']) test(`held ${seam} continuation cannot replace a later A-B-A inspector`, async () => {
    const old=held(); let aReads=0, heldReads=0;
    const p=fixture({details:true,respond:async url=>{
        if(url.endsWith('/tree')) { const id=url.split('/')[3]; if(id==='a-uuid') aReads++; return {...tree(id),parent_id:id+'-parent'}; }
        if(url.endsWith('-parent')) { if(seam==='parent' && url.endsWith('/a-uuid-parent') && aReads===1) {heldReads++; return old.promise;} return tree(url.split('/').at(-1)); }
        if(url.endsWith('/a-uuid/stats') && seam==='stats' && aReads===1) {heldReads++; return old.promise;}
        return {sessions:[]};
    }});
    const first=p.run('selectOutlineTask("a-uuid")');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(heldReads,1,'The declared read seam must actually be held');
    await p.run('selectOutlineTask("b-uuid")'); await p.run('selectOutlineTask("a-uuid")');
    old.resolve(seam==='parent'?tree('parent-uuid','Stale parent'):{sessions:[{id:'stale-session',notes:'Stale history'}]});
    assert.equal(await first,null);
    assert.doesNotMatch(p.elements.task_breadcrumbs.innerHTML,/Stale parent/);
    assert.doesNotMatch(p.elements.detail_task_sessions_list.innerHTML,/Stale history/);
    assert.equal(p.elements.inspector_task_id.value,'a-uuid');
});

// Execute the renderer's actual inline entry points rather than a mirrored navigation helper.
for (const activation of ['click', 'keydown']) test(`retained dirty Outline editor guards actual Kanban card ${activation} departure`, async () => {
    const p=fixture({details:true,respond:async url=>url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]}});
    p.context.location={href:'/tasks'};
    await p.run('selectOutlineTask("a-uuid")');
    p.input('inspector_edit_title','Retained navigation draft');
    p.run('selectTaskView("kanban")');
    const html=p.run('renderKanbanCard({id:"b-uuid",title:"Other",status:"To Do"})');
    const handler=html.match(new RegExp(`on${activation}="([^"]+)"`))[1];
    const card=element('kanban-card'); p.context.card=card;
    p.context.event={target:card,key:'Enter'};
    p.context.document.activeElement=card;
    let prompts=0; p.context.confirm=()=>{prompts++; return false;};
    p.run(`(function(event){${handler}}).call(card,event)`);
    await new Promise(setImmediate);
    assert.equal(prompts,1);
    assert.equal(p.context.location.href,'/tasks');
    assert.equal(p.elements.inspector_edit_title.value,'Retained navigation draft');
    assert.equal(p.elements.inspector_task_id.value,'a-uuid');
    assert.equal(p.context.document.activeElement,card);
    assert.equal(p.elements.outline_inspector.hidden,true);
    assert.equal(p.writes.length,0);
    p.context.confirm=()=>{prompts++; return true;};
    p.run(`(function(event){${handler}}).call(card,event)`);
    await new Promise(setImmediate);
    assert.equal(prompts,2);
    assert.equal(p.context.location.href,'/task-inspector/b-uuid');
    assert.equal(p.writes.length,0);
});

test('actual property Cancel cannot invalidate held successful DELETE; ACK clears and focuses Tasks', async () => {
    const ack=held(), started=held(), deletes=[];
    const p=fixture({details:true,respond:async url=>url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]}});
    p.context.showCustomConfirm=async()=>true;
    p.context.api.delete=async url=>{deletes.push(url); started.resolve(); return ack.promise;};
    await p.run('selectOutlineTask("a-uuid")'); p.input('inspector_edit_title','Delete-time draft');
    const deleting=p.run('deleteMainInspectorTask()'); await started.promise;
    const panel=fs.readFileSync(path.join(source,'../../templates/components/task_detail_panel.html'),'utf8');
    const handler=panel.match(/onclick="([^"]+)"[^>]*>Cancel property edits<\/button>/)[1];
    p.run(handler);
    assert.equal(p.elements.inspector_edit_title.value,'Delete-time draft');
    assert.equal(p.elements.inspector_cancel_btn.disabled,true);
    assert.equal(await p.run('selectOutlineTask("b-uuid")'),false);
    p.run('setupInspectorKeyboardShortcuts()');
    p.elements.outline_inspector.contains=target=>target===p.elements.inspector_edit_title;
    for (const listener of p.events.keydown || []) listener({key:'Escape',target:p.elements.inspector_edit_title,preventDefault(){}});
    assert.equal(p.elements.inspector_task_id.value,'a-uuid');
    ack.resolve(); await deleting;
    assert.deepEqual(deletes,['/api/tasks/a-uuid']);
    assert.equal(p.elements.inspector_task_id.value,'');
    assert.equal(p.elements.task_properties_editor.disabled,true);
    assert.equal(p.elements.tasks_heading.focused,true);
    assert.equal(p.elements.inspector_cancel_btn.disabled,false);
    assert.equal(p.writes.length,0);
});

test('clean Kanban card keeps normal dedicated navigation and Enter ignores child controls', async () => {
    const p=fixture({details:true,respond:async url=>url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]}});
    p.context.location={href:'/tasks'};
    await p.run('selectOutlineTask("a-uuid")'); p.run('selectTaskView("kanban")');
    let prompts=0; p.context.confirm=()=>{prompts++; return false;};
    const html=p.run('renderKanbanCard({id:"b-uuid",title:"Other",status:"To Do"})');
    p.context.card=element('card'); p.context.event={target:element('nested-button'),key:'Enter'};
    const keydown=html.match(/onkeydown="([^"]+)"/)[1];
    p.run(`(function(event){${keydown}}).call(card,event)`);
    assert.equal(p.context.location.href,'/tasks');
    p.context.event.target=p.context.card; p.context.event.key=' ';
    p.run(`(function(event){${keydown}}).call(card,event)`);
    assert.equal(p.context.location.href,'/tasks');
    const click=html.match(/onclick="([^"]+)"/)[1];
    p.run(`(function(event){${click}}).call(card,event)`);
    await new Promise(setImmediate);
    assert.equal(p.context.location.href,'/task-inspector/b-uuid');
    assert.equal(prompts,0); assert.equal(p.writes.length,0);
});

test('failed DELETE restores Cancel availability and retains the pending-time draft until explicit Cancel', async () => {
    const ack=held(), started=held();
    const p=fixture({details:true,respond:async url=>url.endsWith('/tree')?tree(url.split('/')[3]):{sessions:[]}});
    p.context.showCustomConfirm=async()=>true;
    p.context.api.delete=async()=>{started.resolve(); return ack.promise;};
    await p.run('selectOutlineTask("a-uuid")'); p.input('inspector_edit_title','Retain on failure');
    const deleting=p.run('deleteMainInspectorTask()'); await started.promise;
    p.run('cancelInspectorTaskProperties()'); ack.reject(Error('503')); await deleting;
    assert.equal(p.elements.inspector_edit_title.value,'Retain on failure');
    assert.equal(p.elements.inspector_task_id.value,'a-uuid');
    assert.equal(p.elements.inspector_cancel_btn.disabled,false);
    p.run('cancelInspectorTaskProperties()');
    assert.equal(p.elements.inspector_edit_title.value,'a-uuid');
    assert.equal(p.writes.length,0);
});


test('search caller retains each ancestor in its own row and probe uses the same row boundary', () => {
    const p = fixture();
    p.context.rows = [
        {id: 'parent-uuid', title: 'Parent', status: 'To Do'},
        {id: 'child-uuid', parent_id: 'parent-uuid', title: 'Child', status: 'To Do'},
        {id: 'grandchild-uuid', parent_id: 'child-uuid', title: 'Grandchild', status: 'To Do'},
        {id: 'other-uuid', title: 'Other', status: 'To Do'}];
    p.run('kanbanTasks = rows; allStatuses = [{name: "To Do"}]; setupTaskViewSelector(); renderCurrentTaskView()');
    const template = fs.readFileSync(path.join(source, '../../templates/tasks.html'), 'utf8');
    const searchTag = template.match(/<input\b[^>]*id="tasks_search"[^>]*>/)[0];
    const handler = searchTag.match(/oninput="([^"]+)"/)[1];
    p.elements.tasks_search.value = 'Grandchild';
    p.run(handler);
    const html = p.elements.kanban_columns_container.innerHTML;
    const rows = [...html.matchAll(/<li data-task-id="([^"]+)"><div class="outline-row"[^>]*>([\s\S]*?)<\/div><ul/g)];
    assert.deepEqual(rows.map(row => row[1]), ['parent-uuid', 'child-uuid', 'grandchild-uuid']);
    for (const [id, expected] of [['parent-uuid', 1], ['child-uuid', 1], ['grandchild-uuid', 0]]) {
        const ownRows = rows.filter(row => row[1] === id);
        assert.equal(ownRows.length, 1);
        assert.equal((ownRows[0][2].match(/class="outline-context"/g) || []).length, expected);
    }
    assert.equal((html.match(/class="outline-context"/g) || []).length, 2,
        'Both ancestors retain context; descendant labels must not be counted as the parent row');
    const probe = fs.readFileSync(path.join(__dirname, 'browser_outline_tasks.js'), 'utf8');
    assert.ok(probe.includes('[data-task-id="${parent.id}"] > .outline-row > .outline-context'),
        'Browser acceptance must count context in the parent own row');
    assert.ok(probe.includes('[data-task-id="${child.id}"] > .outline-row > .outline-context'),
        'Browser acceptance must retain child context too');
    assert.ok(probe.includes('[data-task-id="${grandchild.id}"] > .outline-row > .outline-context'),
        'Browser acceptance must check that the matching grandchild has no context label');
});
test('ui72 task estimate and Edit expose separate light-only appearance hooks without removing actions', () => {
    const p=fixture();
    const html=p.run('renderKanbanCard({id:"task-uuid",title:"Theme",status:"To Do",estimated_minutes:480})');
    assert.match(html,/class="task-estimate-badge [^"]*bg-purple-950/);
    assert.match(html,/class="task-edit-button [^"]*bg-purple-950\/80/);
    assert.match(html,/openEditTaskModal\('task-uuid'\)/);
});
