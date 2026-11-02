const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; }
function node(id = '', value = '', tag = 'input') {
    const classes = new Set(), children = [], listeners = {};
    return {id, value, tagName:tag.toUpperCase(), type:'text', style:{}, dataset:{}, children, listeners, disabled:false,
        classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)), remove:(...xs)=>xs.forEach(x=>classes.delete(x)), contains:x=>classes.has(x), toggle(x, on = !classes.has(x)) {on ? classes.add(x) : classes.delete(x);}},
        appendChild(el) {children.push(el); return el;}, addEventListener:(name, fn)=>listeners[name]=fn,
        focus(){}, select(){}, setAttribute(){}, remove(){this.removed = true;}, replaceWith(el){this.replacement = el;},
        querySelectorAll(selector) {return children.flatMap(el => [el, ...el.querySelectorAll(selector)]).filter(el => selector.split(',').some(s => {
            s = s.trim();
            if (s.includes(':not')) return el.id !== 'ai_setting_custom_instructions';
            if (s.startsWith('#')) return el.id === s.slice(1);
            if (s.startsWith('[id^=')) return el.id.startsWith(s.match(/\[id\^="([^"]+)"\]/)[1]);
            if (s.startsWith('.')) return el.classList.contains(s.slice(1));
            return el.tagName.toLowerCase() === s;
        }));}, querySelector(){return null;}
    };
}
function browser(elements, files, respond) {
    const writes = [], confirmations = [], events = {};
    const context = vm.createContext({URL, Intl, Event, TextDecoder, console:{error(){}}, setTimeout:fn=>fn(),
        localStorage:{getItem:()=>null,setItem(){}},
        document:{getElementById:id=>elements[id] || null, createElement:tag=>node('', '', tag), querySelectorAll:()=>[], querySelector:()=>null,
            addEventListener:(name, fn)=>(events[name] ||= []).push(fn), documentElement:{style:{setProperty(){}},setAttribute(){}}},
        window:{location:{href:'http://localhost/revision'},addEventListener(){},confirm:message=>{confirmations.push(message);return false;}},
        fetch:async (url, options)=>{
            if(options.method !== 'GET') writes.push({url, body:JSON.parse(options.body)});
            const result = await respond(url, options);
            return {ok:(result.status || 200)<400, status:result.status || 200, headers:{get:()=> 'application/json'}, json:async()=>result.json};
        }, showCustomConfirm:async()=>true
    });
    const run = code => vm.runInContext(code, context);
    for(const file of ['api_client.js','settings.js',...files]) run(fs.readFileSync(path.join(js,file),'utf8'));
    return {run, context, writes, confirmations, events};
}
function dayElements() {
    const fields = Object.fromEntries(['day_form_rating','day_form_highlights','day_form_friction','day_form_notes','day_form_save_btn','day_review_date_input','rev_tab_day','day_custom_ratings_container'].map(id=>[id,node(id)]));
    fields.day_review_date_input.value = '2026-11-01';
    fields.rev_tab_day.children.push(...['day_form_rating','day_form_highlights','day_form_friction','day_form_notes'].map(id=>fields[id]));
    return fields;
}
for(const fail of [false,true]) test(`Day text/grade remains guarded across ${fail ? '503' : 'held successful'} rating-definition GET`,async()=>{
    const fields = dayElements(), held = deferred();
    const b = browser(fields,['revision_nav.js','ratings_config.js','day_review.js'],url=>url.startsWith('/rating-definitions') ? held.promise : {json:{day_review:null, custom_ratings:[]}});
    const loading = b.run('loadDayReviewData()'); await tick();
    fields.day_form_notes.value = 'Typed while ratings load'; fields.day_form_rating.value = '5';
    held.resolve(fail ? {status:503,json:{detail:'Synthetic definitions failure'}} : {json:[]}); await loading;
    assert.equal(b.run('followSettingsLink({})'),false);
    assert.equal(fields.day_form_notes.value,'Typed while ratings load'); assert.equal(fields.day_form_rating.value,'5');
    assert.equal(b.writes.length,0);
    if (fail) {
        await b.run('saveDayReviewForm()');
        assert.equal(b.writes.length,0);
        assert.equal(fields.day_form_notes.value,'Typed while ratings load');
    }
    fields.day_form_notes.value=''; fields.day_form_rating.value=3;
    assert.equal(b.run('followSettingsLink({})'),true);
});

function aiElements() {
    const html = fs.readFileSync(path.join(js,'../../templates/ai_settings.html'),'utf8');
    const fields = Object.fromEntries([...html.matchAll(/id="(ai_setting_[^"]+|ai_scope_[^"]+|ai_behavior_settings|ai_settings_save_status)"/g)].map(([,id])=>[id,node(id)]));
    fields.ai_behavior_settings.children.push(...Object.values(fields).filter(el=>el.id.startsWith('ai_setting_') || el.id.startsWith('ai_scope_')));
    return fields;
}
const aiSettings = {custom_instructions:'Persisted instructions', scheduling_window_days:14, batch_undo_retention_days:30, data_scope:{tasks:true,sessions:true}};
for(const fail of [false,true]) test(`AI initial ${fail ? '503' : 'held successful'} GET preserves typed behavior and instruction drafts without unknown writes`,async()=>{
    const fields = aiElements(), held = deferred();
    const b = browser(fields,['ai_settings_page.js'],()=>held.promise);
    const loading = b.run('aiLoadBehaviorSettings()');
    fields.ai_setting_custom_instructions.value='Typed during initial GET';
    fields.ai_setting_preferred_tags.value='draft';
    held.resolve(fail ? {status:503,json:{detail:'Synthetic read failure'}} : {json:aiSettings}); await loading;
    assert.equal(b.run('followSettingsLink({})'),false);
    assert.equal(fields.ai_setting_custom_instructions.value,'Typed during initial GET');
    assert.equal(fields.ai_setting_preferred_tags.value,'draft');
    if(fail) { await b.run('aiSaveBehaviorSettings()'); assert.equal(b.writes.length,0); }
    else {
        fields.ai_setting_custom_instructions.value='Persisted instructions'; fields.ai_setting_preferred_tags.value='';
        assert.equal(b.run('followSettingsLink({})'),true);
    }
});

for(const dirtyInstruction of [false,true]) test(`Accepted instruction HTTP action checkpoints only persisted instruction, preserving ${dirtyInstruction ? 'instruction' : 'other behavior/provider'} drafts`,async()=>{
    const fields = aiElements(); fields.ai_thread=node('ai_thread');
    const provider=node('ai_provider_form_section'); const providerName=node('provider_name','draft provider'); provider.children.push(providerName); fields.ai_provider_form_section=provider;
    const b = browser(fields,['ai_settings_page.js','ai_assistant.js'],url=>({json:url.endsWith('/accept') ? {settings:{custom_instructions:'Persisted instructions\nAccepted'},proposal:{id:'proposal',status:'accepted'}} : aiSettings}));
    await b.run('aiLoadBehaviorSettings()');
    b.run("rememberSettingsDraft('ai_provider_form_section')"); providerName.value='Changed provider';
    fields.ai_setting_preferred_tags.value='other draft';
    if(dirtyInstruction) fields.ai_setting_custom_instructions.value='My instruction draft';
    b.run("globalThis.card = aiBuildInstructionProposalNode({id:'proposal',status:'pending',proposed_instruction:'Accepted'}); document.getElementById('ai_thread').appendChild(card)");
    const card=b.context.card, actions=card.children.at(-1), save=actions.children[1];
    await save.listeners.click();
    assert.equal(fields.ai_setting_custom_instructions.value,dirtyInstruction ? 'My instruction draft' : 'Persisted instructions\nAccepted');
    fields.ai_setting_preferred_tags.value=''; providerName.value='draft provider';
    assert.equal(b.run('followSettingsLink({})'),dirtyInstruction ? false : true);
    assert.equal(b.writes.length,1);
});

test('Conflicting instruction acceptance preserves unsaved custom instructions on authoritative reload',async()=>{
    const fields=aiElements(); fields.ai_thread=node('ai_thread');
    const b=browser(fields,['ai_settings_page.js','ai_assistant.js'],url=>url.endsWith('/accept') ? {status:409,json:{detail:'Settings changed; conflict'}} : {json:aiSettings});
    await b.run('aiLoadBehaviorSettings()'); fields.ai_setting_custom_instructions.value='My unsaved instructions';
    b.run("globalThis.card=aiBuildInstructionProposalNode({id:'proposal',status:'pending',proposed_instruction:'Remember'}); document.getElementById('ai_thread').appendChild(card)");
    await b.context.card.children.at(-1).children[1].listeners.click();
    assert.equal(fields.ai_setting_custom_instructions.value,'My unsaved instructions');
    assert.equal(b.run('followSettingsLink({})'),false);
});

for(const edit of [false,true]) test(`Habit ${edit ? 'edit' : 'new'} form guards Settings; revert, Cancel and successful save are clean`,async()=>{
    const fields=Object.fromEntries(['habit_modal','edit_habit_id','modal_habit_title','modal_habit_name','modal_habit_type','modal_habit_target','modal_habit_unit','modal_habit_frequency','modal_habit_reminder','modal_habit_color','modal_habit_delete_btn','numeric_fields_group'].map(id=>[id,node(id)]));
    fields.habit_modal.children.push(...Object.values(fields).filter(el=>el.id.startsWith('modal_habit_') && !el.id.endsWith('title') && !el.id.endsWith('btn')));
    const b=browser(fields,['habits.js'],()=>({json:{}}));
    b.run("allHabits=[{id:'habit',name:'Original',habit_type:'numeric',target_value:3}]");
    b.run(edit ? "openEditHabitModal('habit')" : 'openNewHabitModal()');
    const original=fields.modal_habit_name.value;
    fields.modal_habit_name.value='Unsaved habit';
    assert.equal(b.run('followSettingsLink({})'),false); assert.equal(b.writes.length,0);
    fields.modal_habit_name.value=original;
    assert.equal(b.run('followSettingsLink({})'),true);
    fields.modal_habit_name.value='Canceled habit'; b.run('closeHabitModal()');
    assert.equal(b.run('followSettingsLink({})'),true); assert.equal(b.writes.length,0);
    b.run(edit ? "openEditHabitModal('habit')" : 'openNewHabitModal()');
    fields.modal_habit_name.value='Saved habit';
    await b.run('saveHabit()'); assert.equal(b.writes.length,1);
    assert.equal(b.run('followSettingsLink({})'),true);
});

function widgetElements() {
    const html=fs.readFileSync(path.join(js,'../../templates/components/widget_builder_modal.html'),'utf8');
    const fields=Object.fromEntries([...html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map(([,tag,id])=>{const el=node(id);el.tagName=tag.toUpperCase();
        if(tag==='select') { el.appendChild=function(opt){if(!this.children.length) this.value=opt.value;this.children.push(opt);}; }
        Object.defineProperty(el,'innerHTML',{set(){el.children.length=0;el.value='';}});
        return [id,el];}));
    fields.widget_builder_modal.children.push(...Object.values(fields).filter(el=>['INPUT','SELECT','TEXTAREA'].includes(el.tagName)));
    return fields;
}
const capabilities={sql_enabled:true,sources:[{source:'sessions',measures:[{value:'count',label:'Count'}],dimensions:[],filter_fields:[]}]};
for(const sql of [false,true]) test(`Widget ${sql ? 'SQL' : 'structured'} editor guards draft departure without metadata absorbing title changes`,async()=>{
    const fields=widgetElements(), preview=deferred();
    const b=browser(fields,['widget_builder.js'],url=>url==='/analytics/capabilities' ? {json:capabilities} : url==='/analytics/sql' ? preview.promise : {json:{tables:[]}});
    b.context.getWidgetById=()=>({title:'Original widget',spec:sql ? {mode:'sql',sql:{sql:'SELECT 1 AS amount',chart:'bar',label_column:'amount',value_column:'amount'}} : {mode:'structured',query:{source:'sessions',measure:'count',chart:'bar'}}});
    await b.run("openWidgetEditor('dashboard','widget')");
    assert.equal(b.run('followSettingsLink({})'),true);
    fields.wb_title.value='Unsaved title';
    if(sql) {preview.resolve({json:{columns:['amount'],rows:[[1]],row_count:1,elapsed_ms:1}});await tick();}
    assert.equal(b.run('followSettingsLink({})'),false);
    assert.equal(fields.wb_title.value,'Unsaved title');
    fields.wb_title.value='Original widget';
    assert.equal(b.run('followSettingsLink({})'),true);
    assert.equal(b.writes.filter(w=>w.url.includes('/widgets')).length,0);
    fields.wb_title.value='Discard';b.run('closeWidgetBuilder()');assert.equal(b.run('followSettingsLink({})'),true);
});

test('Add Status explicit Save form guards Settings and Cancel discards without a write',()=>{
    const fields=Object.fromEntries(['add_status_modal','modal_new_status_name','modal_new_status_color','new_status_color_hex'].map(id=>[id,node(id)]));
    fields.add_status_modal.children.push(fields.modal_new_status_name,fields.modal_new_status_color);
    const b=browser(fields,['kanban.js'],()=>({json:[]}));
    b.run('openAddStatusModal()');fields.modal_new_status_name.value='Draft status';
    assert.equal(b.run('followSettingsLink({})'),false);assert.equal(b.writes.length,0);
    fields.modal_new_status_name.value='';assert.equal(b.run('followSettingsLink({})'),true);
    fields.modal_new_status_name.value='Discard status';b.run('closeAddStatusModal()');assert.equal(b.run('followSettingsLink({})'),true);
});

test('Unsent composer remains protected with drawer closed; failed send restores draft and concurrent typing survives conversation lookup',async()=>{
    const fields={ai_drawer:node('ai_drawer'),ai_composer_input:node('ai_composer_input'),ai_thread:node('ai_thread')};
    fields.ai_drawer.children.push(fields.ai_composer_input);
    const held=deferred();
    const b=browser(fields,['ai_assistant.js'],url=>url.endsWith('/conversations') ? held.promise : {status:503,json:{detail:'Synthetic send failure'}});
    b.run('aiSetupDrawer()');fields.ai_composer_input.value='First message';
    b.run('closeAiDrawer()');assert.equal(b.run('followSettingsLink({})'),false);
    const sending=b.run('aiSendMessage()');fields.ai_composer_input.value='New text during lookup';
    held.resolve({json:[{id:'conversation'}]});await sending;
    assert.equal(fields.ai_composer_input.value,'New text during lookup');
    assert.equal(b.run('followSettingsLink({})'),false);
});

test('Standing instruction proposal editor guards changed text and reversion without accepting',()=>{
    const fields={ai_thread:node('ai_thread')};
    const b=browser(fields,['ai_assistant.js'],()=>({json:{}}));
    // Model the live document tree lookup for dynamically rendered editor roots.
    const get=b.context.document.getElementById;
    b.context.document.getElementById=id=>get(id) || fields.ai_thread.children.find(el=>el.id===id);
    b.run("globalThis.card=aiBuildInstructionProposalNode({id:'proposal',status:'pending',proposed_instruction:'Original'}); document.getElementById('ai_thread').appendChild(card)");
    const input=b.context.card.children[3].children[1];input.value='Edited proposal';
    assert.equal(b.run('followSettingsLink({})'),false);assert.equal(b.writes.length,0);
    input.value='Original';assert.equal(b.run('followSettingsLink({})'),true);
});

test('Inline AI proposal Edit guards Settings, failed PATCH remains dirty, successful PATCH cleans only submitted fields',async()=>{
    const fields={row:node('row')};let fail=true;
    const b=browser(fields,['ai_drafts.js'],()=>fail ? {status:503,json:{detail:'Synthetic PATCH failure'}} : {json:{}});
    b.context.document.getElementById=id=>fields[id] || fields.row.children.find(el=>el.id===id);
    b.context.aiRefreshCurrentBatchView=()=>{};
    b.run("aiToggleInlineEdit(document.getElementById('row'), {id:'item',entity_type:'task',proposed:{title:'Proposed title'}}, {id:'batch'})");
    const editor=fields.row.children[0], title=editor.children[0].children[0].children.at(-1);
    title.value='Changed proposal';assert.equal(b.run('followSettingsLink({})'),false);
    const save=editor.children.at(-1).children[0];await save.listeners.click();
    assert.equal(b.run('followSettingsLink({})'),false);
    fail=false;await save.listeners.click();assert.equal(b.run('followSettingsLink({})'),true);
    assert.equal(b.writes.length,2);
});

for(const failWrite of [false,true]) test(`Dismiss ${failWrite ? 'failure keeps text dirty' : 'success cleans text despite failed refresh but keeps rating drafts'}`,async()=>{
    const fields=dayElements();const rating=node('rating_range_input_one',3);rating.classList.add('custom-rating-input');
    fields.day_custom_ratings_container.children.push(rating);
    let refresh=false;
    const b=browser(fields,['revision_nav.js','ratings_config.js','day_review.js'],(url,options)=>options.method==='POST' ? (failWrite ? {status:503,json:{detail:'Synthetic Dismiss failure'}} : {json:{}}) : refresh ? {status:503,json:{detail:'Synthetic refresh failure'}} : {json:url.startsWith('/rating-definitions') ? [] : {day_review:null,custom_ratings:[]}});
    await b.run('loadDayReviewData()');fields.day_form_notes.value='Saved by Dismiss';rating.value=5;refresh=true;
    if(failWrite) await assert.rejects(b.run('dismissDayReview()'),/Synthetic Dismiss failure/);
    else await b.run('dismissDayReview()');await tick();
    assert.equal(b.run('followSettingsLink({})'),false);
    rating.value=3;assert.equal(b.run('followSettingsLink({})'),failWrite ? false : true);
});

test('Partial day Save cleans only successful text and rating writes; failed rating remains guarded',async()=>{
    const fields=dayElements();const ratings=['one','two'].map(id=>{const el=node('rating_range_input_'+id,3);el.classList.add('custom-rating-input');return el;});
    fields.day_custom_ratings_container.children.push(...ratings);
    const b=browser(fields,['revision_nav.js','ratings_config.js','day_review.js'],(url,options)=>url==='/rating-entries' && JSON.parse(options.body).rating_definition_id==='two' ? {status:503,json:{detail:'Second rating failed'}} : {json:url.startsWith('/rating-definitions') ? [] : {day_review:null,custom_ratings:[]}});
    const cards=ratings.map((input,i)=>({getAttribute:key=>key==='data-required' ? 'false' : ['one','two'][i],querySelector:()=>input}));
    const query=fields.day_custom_ratings_container.querySelectorAll.bind(fields.day_custom_ratings_container);
    fields.day_custom_ratings_container.querySelectorAll=selector=>selector==='[data-rating-def-id]' ? cards : query(selector);
    ratings.forEach(input=>fields[input.id]=input);
    b.context.document.querySelectorAll=()=>cards;
    await b.run('loadDayReviewData()');fields.day_form_notes.value='Saved text';ratings.forEach(el=>el.value=5);
    await assert.rejects(b.run('saveDayReviewForm()'),/Second rating failed/);
    assert.equal(b.run('followSettingsLink({})'),false);
    ratings[1].value=3;assert.equal(b.run('followSettingsLink({})'),true);
    assert.equal(b.writes.length,3);
});

test('Day retry after failed refresh preserves initialized custom-rating drafts instead of rebaselining them',async()=>{
    const fields=dayElements(),rating=node('rating_range_input_one',3);rating.classList.add('custom-rating-input');
    fields.day_custom_ratings_container.children.push(rating);let fail=false;
    const b=browser(fields,['revision_nav.js','ratings_config.js','day_review.js'],url=>fail ? {status:503,json:{detail:'Synthetic refresh failure'}} : {json:url.startsWith('/rating-definitions') ? [] : {day_review:null,custom_ratings:[]}});
    await b.run('loadDayReviewData()');rating.value=5;fail=true;
    await b.run('loadDayReviewData()');fail=false;
    await b.run('loadDayReviewData()');
    assert.equal(b.run('followSettingsLink({})'),false);
    assert.equal(rating.value,5);assert.equal(b.writes.length,0);
});

test('SQL preview metadata preserves saved column selections and cannot consume an unrelated title draft',async()=>{
    const fields=widgetElements();
    const b=browser(fields,['widget_builder.js'],url=>({json:url==='/analytics/capabilities'?capabilities:url==='/analytics/sql'?{columns:['amount'],rows:[[1]],row_count:1,elapsed_ms:1}:{tables:[]}}));
    b.context.getWidgetById=()=>({title:'Saved SQL',spec:{mode:'sql',sql:{sql:'SELECT 1 AS amount',chart:'bar',label_column:'amount',value_column:'amount'}}});
    await b.run("openWidgetEditor('dashboard','widget')");await tick();
    assert.equal(fields.wb_sql_label_column.value,'amount');
    fields.wb_title.value='Unsaved SQL title';await b.run('wbRunSqlPreview()');
    assert.equal(fields.wb_sql_label_column.value,'amount');
    assert.equal(fields.wb_sql_value_column.value,'amount');
    assert.equal(b.run('followSettingsLink({})'),false);
    fields.wb_title.value='Saved SQL';assert.equal(b.run('followSettingsLink({})'),true);
});

test('Widget failed capabilities GET exposes retry without editable unknown fields, then opens clean',async()=>{
    const fields=widgetElements();let fail=true;const alerts=[];
    const b=browser(fields,['widget_builder.js'],()=>fail ? {status:503,json:{detail:'Synthetic capabilities failure'}} : {json:capabilities});
    b.context.alert=message=>alerts.push(message);
    await b.run("openWidgetBuilder('dashboard')");
    assert.equal(fields.widget_builder_modal.classList.contains('hidden'),true);assert.match(alerts[0],/Reopen.*retry/);
    assert.equal(b.writes.length,0);fail=false;
    await b.run("openWidgetBuilder('dashboard')");
    assert.equal(fields.widget_builder_modal.classList.contains('hidden'),false);
    assert.equal(b.run('followSettingsLink({})'),true);
});

test('Day same-owner rating hydration cannot absorb edits made after the refresh started',async()=>{
    const fields=dayElements(),rating=node('rating_range_input_one',3),held=deferred();rating.classList.add('custom-rating-input');
    fields.day_custom_ratings_container.children.push(rating);let hold=false;
    const b=browser(fields,['revision_nav.js','ratings_config.js','day_review.js'],url=>url.startsWith('/rating-definitions') ? hold ? held.promise : {json:[]} : {json:{day_review:null,custom_ratings:[]}});
    await b.run('loadDayReviewData()');hold=true;
    const refresh=b.run('loadDayReviewData()');await tick();rating.value=5;held.resolve({json:[]});await refresh;
    assert.equal(b.run('followSettingsLink({})'),false);assert.equal(rating.value,5);assert.equal(b.writes.length,0);
});

for (const conflict of [false, true]) test(`Instruction ${conflict ? '409 reload' : 'acceptance'} advances authoritative baseline without consuming live draft`, async () => {
    const fields=aiElements(); fields.ai_thread=node('ai_thread'); let accepted=false;
    const b=browser(fields,['ai_settings_page.js','ai_assistant.js'],url=> {
        if (url.endsWith('/accept')) { accepted=true; return conflict ? {status:409,json:{detail:'Settings conflict'}} : {json:{settings:{custom_instructions:'Authoritative C'},proposal:{id:'proposal',status:'accepted'}}}; }
        return {json:{...aiSettings,custom_instructions:accepted ? 'Authoritative C' : 'Original A'}};
    });
    await b.run('aiLoadBehaviorSettings()'); fields.ai_setting_custom_instructions.value='Live B';
    b.run("globalThis.card=aiBuildInstructionProposalNode({id:'proposal',status:'pending',proposed_instruction:'C'}); document.getElementById('ai_thread').appendChild(card)");
    await b.context.card.children.at(-1).children[1].listeners.click();
    assert.equal(fields.ai_setting_custom_instructions.value,'Live B');
    fields.ai_setting_custom_instructions.value='Original A';
    assert.equal(b.run('followSettingsLink({})'),false,'obsolete A is unsaved against C');
    fields.ai_setting_custom_instructions.value='Authoritative C';
    assert.equal(b.run('followSettingsLink({})'),true,'authoritative C is clean');
    assert.equal(b.writes.length,1,'only explicit acceptance POST');
});

for(const fail of [false,true]) test(`Task detail unknown ${fail ? '503 and retry' : 'held tree'} blocks Save; first success initializes even preserveEdits retry`, async()=>{
    const ids=['inspector_task_id','task_properties_editor','task_properties_status','inspector_edit_title','inspector_edit_desc','inspector_edit_status','inspector_edit_category','inspector_edit_priority','inspector_edit_attachments'];
    const fields=Object.fromEntries(ids.map(id=>[id,node(id)]));
    fields.inspector_task_id.value='task'; fields.task_properties_editor.disabled=true;
    fields.task_properties_editor.children.push(...ids.filter(id=>id.startsWith('inspector_edit_')).map(id=>fields[id]));
    const held=deferred(); let first=true;
    const tree={id:'task',title:'Server title',description:'Server description',status:'To Do',subtasks:[]};
    const b=browser(fields,['utils.js','subtasks.js'],url=>url.endsWith('/tree') && first ? held.promise : {json:url.endsWith('/tree') ? tree : {sessions:[]}});
    b.context.taskKnowledge={state:()=>({generation:0}),viewResult(){},changed:async()=>{}};
    b.context.formatMinutesToDuration=()=> '15m'; b.context.alert=()=>{};
    const loading=b.run('loadTaskDetailTree()');
    // Even a keyboard/programmatic Save cannot write the unknown defaults.
    fields.inspector_edit_title.value='Unloaded title';
    await b.run('saveInspectorTaskProperties()');
    assert.equal(b.writes.length,0);
    held.resolve(fail ? {status:503,json:{detail:'Synthetic tree failure'}} : {json:tree}); await loading;
    if(fail) {
        assert.equal(fields.task_properties_editor.disabled,true);
        first=false;await b.run('loadTaskDetailTree(true)');
    }
    assert.equal(fields.task_properties_editor.disabled,false);
    assert.equal(fields.inspector_edit_desc.value,'Server description');
    fields.inspector_edit_desc.value='Draft description';
    assert.equal(b.run('followSettingsLink({})'),false);
    first=false;await b.run('loadTaskDetailTree(true)');
    assert.equal(fields.inspector_edit_desc.value,'Draft description');
    fields.inspector_edit_desc.value='Server description';assert.equal(b.run('followSettingsLink({})'),true);
});

for(const edit of ['notes','rating']) test(`Hidden retained Day ${edit} warns on Settings, survives show and reverted fields are clean`,async()=>{
    const fields=dayElements(); fields.rev_tab_day.dataset.settingsDraftRetained='true';
    fields.rev_tab_overview=node('rev_tab_overview');
    const b=browser(fields,['revision_nav.js','ratings_config.js','day_review.js','day_history.js'],url=>({json:url.startsWith('/rating-definitions') || url.startsWith('/revision/day-reviews') ? [] : {day_review:null,custom_ratings:[]}}));
    await b.run('loadDayReviewData()');
    const field=fields[`day_form_${edit}`], original=field.value;field.value=edit==='notes' ? 'Retained text' : 5;
    b.run("switchRevisionTab('overview',false)");
    assert.equal(b.run('followSettingsLink({})'),false);
    assert.equal(field.value,edit==='notes' ? 'Retained text' : 5);
    b.run("switchRevisionTab('day',false)");await tick();
    assert.equal(field.value,edit==='notes' ? 'Retained text' : 5);
    field.value=original;b.run("switchRevisionTab('overview',false)");
    assert.equal(b.run('followSettingsLink({})'),true);assert.equal(b.writes.length,0);
});

function reviewBrowser(kind) {
    const textIds=kind==='task' ? ['task_rev_difficulty','task_rev_went_well','task_rev_blockers','task_rev_takeaways'] : ['session_rev_modal_tags','session_rev_modal_notes','session_rev_modal_skip_check'];
    const owner=kind==='task' ? 'task_inspector_body' : 'session_review_modal';
    const fields=Object.fromEntries([...textIds,owner,`${kind}_custom_ratings_container`,'inspect_task_title','inspect_task_desc','inspect_task_status_badge','session_rev_modal_id','session_rev_modal_time'].map(id=>[id,node(id)]));
    fields[owner].children.push(...textIds.map(id=>fields[id]),fields[`${kind}_custom_ratings_container`]);
    const ratings=['one','two'].map(id=>{const el=node('rating_range_input_'+id,3);el.classList.add('custom-rating-input');return el;});
    fields[`${kind}_custom_ratings_container`].children.push(...ratings);
    const cards=ratings.map((input,i)=>({getAttribute:key=>key==='data-required' ? 'false' : ['one','two'][i],querySelector:()=>input}));
    const held=deferred();let fail=true,stored=null;
    const b=browser(fields,['ratings_config.js',kind==='task' ? 'task_inspector.js' : 'session_review.js'],async(url,options)=>{
        if(options.method==='GET') {
            if(url==='/api/tasks/task/stats') return {json:{task:{id:'task',title:'Synthetic'},sessions:[],custom_ratings:[],task_review:stored}};
            if(url==='/sessions/session') return {json:{id:'session',notes:stored?.notes || '',tags:stored?.tags || ''}};
            return {json:[]};
        }
        if(url==='/rating-entries') return JSON.parse(options.body).rating_definition_id==='two' && fail ? {status:503,json:{detail:'Second rating failed'}} : {json:{}};
        stored=JSON.parse(options.body);await held.promise;return {json:stored};
    });
    const query=fields[`${kind}_custom_ratings_container`].querySelectorAll.bind(fields[`${kind}_custom_ratings_container`]);
    fields[`${kind}_custom_ratings_container`].querySelectorAll=selector=>selector==='[data-rating-def-id]' ? cards : query(selector);
    ratings.forEach(input=>fields[input.id]=input);
    b.context.document.querySelectorAll=()=>cards;
    b.context.taskKnowledge={state:()=>({generation:0}),get:()=>null,viewResult(){}};
    b.context.loadCurrentRevisionView=()=>{};
    return {b,fields,ratings,owner,held,retry:()=>{fail=false;},text:fields[kind==='task' ? 'task_rev_went_well' : 'session_rev_modal_notes']};
}

test('Task review partial success cleans persisted text and first rating only, retaining failed and concurrent fields through retry',async()=>{
    const {b,fields,ratings,owner,held,retry,text}=reviewBrowser('task');
    await b.run("loadTaskInspectorStats('task')");text.value='Submitted review';ratings.forEach(el=>el.value=5);
    const saving=b.run('saveTaskReviewForm()');await tick();text.value='New draft while POST pending';held.resolve();
    await assert.rejects(saving,/Second rating failed/);
    assert.equal(b.run('followSettingsLink({})'),false);
    text.value='Submitted review';ratings[1].value=3;
    assert.equal(b.run('followSettingsLink({})'),true,'persisted text and first rating are clean');
    assert.equal((await b.run("api.get('/api/tasks/task/stats')")).task_review.what_went_well,'Submitted review','fake HTTP readback');
    ratings[1].value=5;retry();await b.run('saveTaskReviewForm()');await tick();
    assert.equal(b.run('followSettingsLink({})'),true);
    assert.equal(fields[owner].classList.contains('hidden'),false);
});

test('Session review partial success cleans submitted text and first rating, failed rating guards, retry retains new typing',async()=>{
    const {b,fields,ratings,held,retry,text}=reviewBrowser('session');
    await b.run("openSessionReviewModal('session')");text.value='Submitted notes';ratings.forEach(el=>el.value=5);
    const saving=b.run('saveSessionReviewModal()');await tick();text.value='Typed during PUT';held.resolve();
    await assert.rejects(saving,/Second rating failed/);
    assert.equal(text.value,'Typed during PUT');assert.equal(b.run('followSettingsLink({})'),false);
    text.value='Submitted notes';ratings[1].value=3;
    assert.equal(b.run('followSettingsLink({})'),true,'persisted session text and first rating clean');
    assert.equal((await b.run("api.get('/sessions/session')")).notes,'Submitted notes','fake HTTP readback');
    ratings[1].value=5;retry();const retried=b.run('saveSessionReviewModal()');text.value='Next draft';await retried;
    assert.equal(text.value,'Next draft');assert.equal(fields.session_review_modal.classList.contains('hidden'),false);
    assert.equal(b.run('followSettingsLink({})'),false);
    text.value='Submitted notes';assert.equal(b.run('followSettingsLink({})'),true);
});
