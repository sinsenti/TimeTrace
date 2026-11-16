const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function held() { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; }
function element(value = '') {
    const classes = new Set();
    return {value, checked:false, disabled:false, dataset:{}, style:{}, innerText:'', textContent:'', innerHTML:'',
        classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
        focus(){}, select(){}, addEventListener(){}, querySelectorAll:()=>[], setAttribute(){}};
}
function fixture(respond, realDrafts = false) {
    const ids = ['inspector_task_id','task_properties_editor','task_properties_status','inspector_save_btn',
        'inspector_edit_title','inspector_edit_tags','inspector_edit_desc','inspector_edit_status','inspector_edit_category',
        'inspector_edit_priority','inspector_edit_est','inspector_edit_attachments','inspector_edit_is_recurring',
        'inspector_edit_recurrence_rule','inspector_edit_assigned_date','inspector_edit_due_date',
        'detail_task_title_header','detail_task_sessions_list','subtasks_tree_container','detail_stat_logged',
        'detail_task_unscheduled','detail_accounting_note','detail_task_est_label',
        'edit_subtask_id','subtask_parent_id','modal_subtask_title','modal_subtask_tags','modal_subtask_est',
        'modal_subtask_status','modal_subtask_priority','subtask_modal','subtask_save_status','subtask_save_btn'];
    const fields = Object.fromEntries(ids.map(id=>[id,Object.assign(element(),{id,type:'text'})]));
    for (const root of ['task_properties_editor','subtask_modal']) {
        const list = Object.values(fields).filter(field => root === 'task_properties_editor' ? field.id.startsWith('inspector_edit_') : field.id.startsWith('modal_subtask_') || field.id === 'edit_subtask_id');
        fields[root].querySelectorAll = selector => selector.includes('#') ? list.filter(field=>selector.split(',').some(part=>part.trim() === '#'+field.id)) : list;
        fields[root].cloneNode = () => {
            const copy = Object.assign(element(),{id:root});const cloned = list.map(field=>Object.assign(element(field.value),{id:field.id,type:field.type,checked:field.checked}));
            copy.querySelectorAll = selector => selector.includes('#') ? cloned.filter(field=>selector.split(',').some(part=>part.trim() === '#'+field.id)) : cloned;
            return copy;
        };
    }
    fields.inspector_task_id.value='parent';
    const writes = [], alerts = [], checkpoints = [], events = {};
    let refreshes = 0;
    const context = vm.createContext({URL, console:{error(){}}, setTimeout:fn=>fn(),
        document:{getElementById:id=>fields[id] || null, addEventListener:(name,handler)=>(events[name] ||= []).push(handler), querySelectorAll:()=>[]},
        window:{location:{href:'original'}}, alert:message=>alerts.push(message),
        api:{get:url=>respond(url), put:async(url,body)=>{writes.push({url,body});return respond(url,body);},
            post:async(url,body)=>{writes.push({url,body});return respond(url,body);}},
        taskKnowledge:{state:()=>({generation:0}),viewResult(){},changed:async()=>{refreshes++;return context.loadTaskDetailTree(true);}},
        formatMinutesToDuration:value=>value == null ? '-' : `${value}m`, formatFlexibleDateForInput:x=>x,
        parseFlexibleDateInput:()=>null,parseDurationToMinutes:value=>parseFloat(value),
        escapeHtml:value=>String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
        roundVal:x=>x,rememberSettingsDraft(){},settingsDraftCheckpoint:(root)=>{const snapshot=typeof root === 'string' ? fields.inspector_edit_desc.value : root.querySelectorAll('#inspector_edit_desc')[0]?.value;return ()=>checkpoints.push(snapshot);},
        showCustomConfirm:async()=>true,handleCompletionPolicy:async()=>{}
    });
    if (realDrafts) vm.runInContext(fs.readFileSync(path.join(source,'settings.js'),'utf8'),context);
    vm.runInContext(fs.readFileSync(path.join(source,'subtasks.js'),'utf8'),context);
    const run = code=>vm.runInContext(code,context);
    return {fields,writes,alerts,checkpoints,events,run,context,get refreshes(){return refreshes;}};
}
const tree = {id:'parent',title:'Persisted',description:'Saved notes',status:'To Do',category:'work',estimated_minutes:60,tags:'#saved',subtasks:[]};
const stats = {logged_hours:2,scheduled_hours:1,remaining_hours:-1,unscheduled_hours:-2,progress_pct:200,is_unbounded:false,total_sessions:4,sessions:[]};

test('subtasks: pending property save suppresses double activation and retains concurrent notes after ACK',async()=>{
    const ack=held();
    const b=fixture((url,body)=>body ? ack.promise : Promise.resolve(url.endsWith('/tree') ? tree : stats));
    await b.run('loadTaskDetailTree()');
    b.fields.inspector_edit_desc.value='Submitted';
    const saving=b.run('saveInspectorTaskProperties()');
    const duplicate=b.run('saveInspectorTaskProperties()');
    b.fields.inspector_edit_desc.value='Typed during save';
    ack.resolve({...tree,description:'Submitted'}); await Promise.all([saving,duplicate]);
    assert.equal(b.writes.length,1);
    assert.equal(b.fields.inspector_edit_desc.value,'Typed during save');
    assert.equal(b.context.window.location.href,'original');
    assert.deepEqual(b.checkpoints,['Submitted']);
    assert.match(b.fields.task_properties_status.textContent,/saved/i);
});

test('subtasks: acknowledged save followed by failed stats read offers read-only retry without replay',async()=>{
    let fail=false;
    const b=fixture((url,body)=>{if(body) {fail=true;return Promise.resolve(tree);} if(url.endsWith('/tree')) return Promise.resolve(tree); return fail ? Promise.reject(Error('503')) : Promise.resolve(stats);});
    await b.run('loadTaskDetailTree()');
    await b.run('saveInspectorTaskProperties()');
    assert.equal(b.context.window.location.href,'original');
    assert.match(b.fields.task_properties_status.textContent,/saved.*refresh|refresh.*unavailable/i);
    fail=false;
    await b.run('loadTaskDetailTree(true)');
    assert.equal(b.writes.length,1);
});

test('subtasks: older same-generation tree read cannot replace newer detail owner',async()=>{
    const first=held(); let calls=0;
    const b=fixture(url=>url.endsWith('/tree') ? (++calls===1 ? first.promise : Promise.resolve({...tree,title:'New snapshot'})) : Promise.resolve(stats));
    const loading=b.run('loadTaskDetailTree()');
    await b.run('loadTaskDetailTree(true)');
    first.resolve({...tree,title:'Obsolete'});await loading;
    assert.equal(b.fields.detail_task_title_header.innerText,'New snapshot');
    assert.equal(b.fields.inspector_edit_title.value,'New snapshot');
});

test('subtasks: own history count is not mislabeled as the logged-session count; unscheduled zero is visible',async()=>{
    const b=fixture(url=>Promise.resolve(url.endsWith('/tree') ? tree : {...stats,scheduled_hours:0,unscheduled_hours:0}));
    await b.run('loadTaskDetailTree()');
    assert.equal(b.fields.detail_stat_logged.innerText,'2h');
    assert.match(b.fields.detail_task_unscheduled.innerText,/0h/);
    assert.equal(b.fields.detail_task_unscheduled.classList.contains('hidden'),false);
});

test('subtasks: child ACK adopts ID before fallible refresh, pending duplicate is ignored and concurrent draft retained',async()=>{
    const ack=held();let fail=false;
    const b=fixture((url,body)=>body ? ack.promise : fail ? Promise.reject(Error('503')) : Promise.resolve(url.endsWith('/tree') ? tree : stats));
    await b.run('loadTaskDetailTree()');b.run('openSubtaskCreationModal()');
    b.fields.modal_subtask_title.value='Submitted child';
    const saving=b.run('saveSubtaskFromModal()');const duplicate=b.run('saveSubtaskFromModal()');
    b.fields.modal_subtask_title.value='Concurrent child title';fail=true;ack.resolve({id:'child',title:'Submitted child'});
    await Promise.all([saving,duplicate]);
    assert.equal(b.writes.length,1);
    assert.equal(b.fields.edit_subtask_id.value,'child');
    assert.equal(b.fields.modal_subtask_title.value,'Concurrent child title');
    assert.equal(b.fields.subtask_modal.classList.contains('hidden'),false);
});

test('subtasks: returning to a different detail task ignores the old property ACK',async()=>{
    const ack=held();
    const b=fixture((url,body)=>body ? ack.promise : Promise.resolve(url.endsWith('/tree') ? {...tree,id:url.includes('other') ? 'other' : 'parent'} : stats));
    await b.run('loadTaskDetailTree()');const saving=b.run('saveInspectorTaskProperties()');
    b.fields.inspector_task_id.value='other';await b.run('loadTaskDetailTree()');
    ack.resolve(tree);await saving;
    assert.equal(b.context.window.location.href,'original');
    assert.deepEqual(b.checkpoints,[]);
});


test('subtasks canonical child receipt preserves parsed estimate across concurrent title and later explicit Save',async()=>{
    const ack=held();let serverTree=tree;
    const b=fixture((url,body)=>body ? (body.title==='ACK child [45m]' ? ack.promise : Promise.resolve({id:'child',...body})) : Promise.resolve(url.endsWith('/tree') ? serverTree : stats),true);
    await b.run('loadTaskDetailTree()');b.run('openSubtaskCreationModal()');
    b.fields.modal_subtask_title.value='ACK child [45m]';const saving=b.run('saveSubtaskFromModal()');
    b.fields.modal_subtask_title.value='Concurrent title';
    serverTree={...tree,subtasks:[{id:'child',title:'ACK child',estimated_minutes:45}]};
    ack.resolve({id:'child',title:'ACK child',estimated_minutes:45,tags:'#saved',status:'To Do',priority:'-'});await saving;
    assert.equal(b.fields.modal_subtask_est.value,'45m');
    assert.equal(b.fields.modal_subtask_title.value,'Concurrent title');
    assert.equal(b.run("hasSettingsDrafts(['subtask_modal'])"),true);
    await b.run('saveSubtaskFromModal()');
    assert.equal(b.writes[1].body.estimated_minutes,45);
    assert.equal(b.writes[1].url,'/api/tasks/child');
});

test('subtasks canonical property receipt updates clean title/estimate but retains dirty concurrent tags against canonical baseline',async()=>{
    const ack=held();const b=fixture((url,body)=>body ? ack.promise : Promise.resolve(url.endsWith('/tree') ? tree : stats),true);
    await b.run('loadTaskDetailTree()');
    b.fields.inspector_edit_title.value='Parsed title [45m] #canonical';const saving=b.run('saveInspectorTaskProperties()');
    b.fields.inspector_edit_tags.value='#concurrent';
    ack.resolve({...tree,title:'Parsed title',estimated_minutes:45,tags:'#canonical'});await saving;
    assert.equal(b.fields.inspector_edit_title.value,'Parsed title');assert.equal(b.fields.inspector_edit_est.value,'45m');
    assert.equal(b.fields.inspector_edit_tags.value,'#concurrent');
    assert.equal(b.run("hasSettingsDrafts(['task_properties_editor'])"),true);
    b.fields.inspector_edit_tags.value='#canonical';
    assert.equal(b.run("hasSettingsDrafts(['task_properties_editor'])"),false);
});

test('subtasks canonical ACK retains explicit estimate ABA edits and checkpoints the actual persisted estimate',async()=>{
    const ack=held();const b=fixture((url,body)=>body ? ack.promise : Promise.resolve(url.endsWith('/tree') ? tree : stats),true);
    await b.run('loadTaskDetailTree()');b.run('openSubtaskCreationModal()');
    b.fields.modal_subtask_title.value='ACK child [45m]';const saving=b.run('saveSubtaskFromModal()');
    for(const value of ['16m','15m']) {
        b.fields.modal_subtask_est.value=value;
        b.run("recordTaskFormEdit({target:document.getElementById('modal_subtask_est')})");
    }
    ack.resolve({id:'child',title:'ACK child',estimated_minutes:45,tags:'#saved',status:'To Do',priority:'-'});await saving;
    assert.equal(b.fields.modal_subtask_est.value,'15m');
    assert.equal(b.run("hasSettingsDrafts(['subtask_modal'])"),true);
    assert.equal(b.fields.subtask_modal.classList.contains('hidden'),false);
    b.fields.modal_subtask_est.value='45m';
    assert.equal(b.run("hasSettingsDrafts(['subtask_modal'])"),false);
});


test('subtasks delayed native change-on-blur is not a new title input after capture',async()=>{
    const ack=held();const b=fixture((url,body)=>body ? ack.promise : Promise.resolve(url.endsWith('/tree') ? tree : stats),true);
    await b.run('loadTaskDetailTree()');b.run('openSubtaskCreationModal()');
    b.fields.modal_subtask_title.value='Receipt title [45m]';
    for(const handler of b.events.input || []) handler({target:b.fields.modal_subtask_title});
    const saving=b.run('saveSubtaskFromModal()');
    for(const handler of b.events.change || []) handler({target:b.fields.modal_subtask_title});
    for(const value of ['16m','15m']) {
        b.fields.modal_subtask_est.value=value;
        for(const handler of b.events.input || []) handler({target:b.fields.modal_subtask_est});
    }
    ack.resolve({id:'child',title:'Receipt title',estimated_minutes:45,tags:'#saved',status:'To Do',priority:'-'});await saving;
    assert.equal(b.fields.modal_subtask_title.value,'Receipt title');
    assert.equal(b.fields.modal_subtask_est.value,'15m');
    assert.equal(b.run("hasSettingsDrafts(['subtask_modal'])"),true);
});


test('subtasks shows pending Save through ACK and held follow-up read without locking concurrent fields',async()=>{
    const ack=held(),read=held();let refreshing=false;
    const b=fixture((url,body)=>body ? ack.promise : url.endsWith('/tree') ? (refreshing ? read.promise : Promise.resolve(tree)) : Promise.resolve(stats));
    await b.run('loadTaskDetailTree()');b.run('openSubtaskCreationModal()');b.fields.modal_subtask_title.value='Child';
    const saving=b.run('saveSubtaskFromModal()');
    assert.equal(b.fields.subtask_save_btn.disabled,true);
    await b.run('saveSubtaskFromModal()');assert.equal(b.writes.length,1);
    b.fields.modal_subtask_title.value='Concurrent child';refreshing=true;ack.resolve({id:'child',title:'Child'});await tick();
    assert.equal(b.fields.edit_subtask_id.value,'child');assert.equal(b.fields.subtask_save_btn.disabled,true);
    assert.equal(b.fields.modal_subtask_title.disabled,false);
    read.resolve(tree);await saving;
    assert.equal(b.fields.subtask_save_btn.disabled,false);
});

test('details own history does not hide another tasks current session from Timer', async()=>{
    const past={id:'own',task_id:'parent',start_time:'2000-01-01T10:00:00Z',end_time:'2000-01-01T11:00:00Z'};
    const current={id:'other',task_id:'other',start_time:new Date(Date.now()-60000).toISOString(),end_time:new Date(Date.now()+600000).toISOString(),notes:'Other current work'};
    const b=fixture(url=>Promise.resolve(url==='/sessions' ? [past,current] : url.endsWith('/tree') ? tree : {...stats,sessions:[past]}));
    b.context.sessionStorage={getItem:()=>null};
    b.context.window.addEventListener=()=>{};
    b.context.taskKnowledge.get=()=>null;
    await b.run('loadTaskDetailTree()');
    vm.runInContext(fs.readFileSync(path.join(source,'timer_control.js'),'utf8'),b.context);
    await b.run('fetchGlobalSessionsIfNeeded()');b.run('updateDocumentTitle()');
    assert.match(b.context.document.title,/Other current work/);
});

test('details dirty links and subtask card navigation require discard consent',async()=>{
    const b=fixture(url=>Promise.resolve(url.endsWith('/tree') ? tree : stats),true);
    await b.run('loadTaskDetailTree()'); b.fields.inspector_edit_desc.value='Unsaved';
    b.context.window.confirm=()=>false;
    const link={href:'http://localhost/task-inspector/child',target:'',getAttribute:()=>'/task-inspector/child'};
    let prevented=false;
    const event={button:0,target:{closest:()=>link},preventDefault(){prevented=true;},stopPropagation(){}};
    for(const handler of b.events.click || []) handler(event);
    assert.equal(prevented,true,'parent/child anchors retain the dirty editor when discard is declined');
    const html=b.run("renderSubtaskCardHTML({id:'child',title:'Child',subtasks:[]})");
    const cardClick=html.match(/<div onclick="([^"]+)"/)[1];
    b.context.event={target:{closest:()=>null},preventDefault(){},stopPropagation(){}};
    b.run(cardClick);
    assert.equal(b.context.window.location.href,'original','subtask card also retains the dirty editor');
});

test('private child keyboard focus stays in the dialog and returns to its launcher',async()=>{
    const b=fixture(url=>Promise.resolve(url.endsWith('/tree') ? tree : stats));
    await b.run('loadTaskDetailTree()');
    const launcher={isConnected:true,focus(){b.context.document.activeElement=this;}};
    b.context.document.activeElement=launcher;
    let keyboard;
    b.fields.subtask_modal.addEventListener=(name,handler)=>{if(name==='keydown')keyboard=handler;};
    b.run('setupSubtaskModalKeyboard(); openSubtaskCreationModal()');
    const first={offsetParent:{},focus(){b.context.document.activeElement=this;}},last={offsetParent:{},focus(){b.context.document.activeElement=this;}};
    b.fields.subtask_modal.querySelectorAll=()=>[first,last];
    b.fields.subtask_modal.contains=el=>[first,last].includes(el);
    b.context.document.activeElement=last;
    let prevented=false;
    keyboard({key:'Tab',shiftKey:false,preventDefault(){prevented=true;},stopPropagation(){}});
    assert.equal(prevented,true);assert.equal(b.context.document.activeElement,first);
    b.context.document.activeElement=first;
    keyboard({key:'Tab',shiftKey:true,preventDefault(){},stopPropagation(){}});
    assert.equal(b.context.document.activeElement,last);
    b.run('closeSubtaskModal()');
    assert.equal(b.context.document.activeElement,launcher);
});

test('late child close does not take focus from a newer editor',async()=>{
    const b=fixture(url=>Promise.resolve(url.endsWith('/tree') ? tree : stats));
    await b.run('loadTaskDetailTree()');
    const launcher={isConnected:true,focus(){b.context.document.activeElement=this;}},newer={};
    b.context.document.activeElement=launcher;b.run('openSubtaskCreationModal()');
    b.fields.subtask_modal.contains=()=>false;
    b.context.document.activeElement=newer;b.run('closeSubtaskModal(true)');
    assert.equal(b.context.document.activeElement,newer);
});

test('accepted Settings navbar departure asks once through its existing shared handler',async()=>{
    const b=fixture(url=>Promise.resolve(url.endsWith('/tree') ? tree : stats),true);
    b.context.window.location.href='http://localhost/tasks-detail/parent';
    await b.run('loadTaskDetailTree()');b.fields.inspector_edit_desc.value='Unsaved';
    let prompts=0;b.context.window.confirm=()=>{prompts++;return true;};
    const link={target:'',getAttribute:name=>name==='onclick' ? 'return followSettingsLink(event)' : '/settings'};
    const event={button:0,target:{closest:()=>link},preventDefault(){},stopPropagation(){}};
    for(const handler of b.events.click || []) handler(event);
    b.context.event=event;b.run('followSettingsLink(event)');
    assert.equal(prompts,1);
});

test('clean nested child Save returns focus to a persistent launcher before subtree refresh disposes its opener',async()=>{
    const b=fixture((url,body)=>Promise.resolve(body ? {id:'child',...body} : url.endsWith('/tree') ? tree : stats));
    await b.run('loadTaskDetailTree()');
    const launcher={isConnected:true,focus(){b.context.document.activeElement=this;}},body={};
    const fallback={focus(){b.context.document.activeElement=this;}};
    b.fields.detail_add_subtask_btn=fallback;b.context.document.body=body;
    b.context.document.activeElement=launcher;b.run("openSubtaskCreationModal('parent')");
    b.fields.modal_subtask_title.value='Clean child';b.context.document.activeElement=b.fields.modal_subtask_title;
    b.fields.subtask_modal.contains=el=>el===b.fields.modal_subtask_title;
    Object.defineProperty(b.fields.subtasks_tree_container,'innerHTML',{set(){launcher.isConnected=false;if(b.context.document.activeElement===launcher)b.context.document.activeElement=body;}});
    await b.run('saveSubtaskFromModal()');
    assert.equal(b.context.document.activeElement,fallback);
});
