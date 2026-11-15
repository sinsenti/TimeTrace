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
        appendChild(el) { if(el.parentNode) {const i=el.parentNode.children.indexOf(el);if(i>=0)el.parentNode.children.splice(i,1);} children.push(el);el.parentNode=this; return el;}, append(...els){els.forEach(el=>this.appendChild(el));}, replaceChildren(...els){children.splice(0);els.forEach(el=>this.appendChild(el));}, addEventListener:(name, fn)=>listeners[name]=fn,
        focus(){}, select(){}, setAttribute(k,v){this[k]=v;}, getAttribute(k){return this[k];}, removeEventListener(){}, remove(){this.removed = true;}, replaceWith(el){this.replacement = el;},
        querySelectorAll(selector) {return children.flatMap(el => [el, ...el.querySelectorAll(selector)]).filter(el => selector.split(',').some(s => {
            s = s.trim();
            if (s.includes(':not')) return el.id !== 'ai_setting_custom_instructions';
            if (s === '[data-day-text]') return !!el.dayText;
            if (s === '[data-day]') return !!el.dataset.day;
            if (s === '[data-action]') return !!el.dataset.action;
            if (s.startsWith('[data-day=')) return el.dataset.day === s.match(/="([^"]+)"/)[1];
            if (s.startsWith('[data-action=')) return el.dataset.action === s.match(/="([^"]+)"/)[1];
            if (s.startsWith('#')) return el.id === s.slice(1);
            if (s.startsWith('[id^=')) return el.id.startsWith(s.match(/\[id\^="([^"]+)"\]/)[1]);
            if (s.startsWith('.')) return el.classList.contains(s.slice(1));
            return el.tagName.toLowerCase() === s;
        }));}, querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
    };
}
function browser(elements, files, respond) {
    const writes = [], confirmations = [], events = {};
    const context = vm.createContext({URL, URLSearchParams, Intl, Event, TextDecoder, AbortController, console:{error(){}}, setTimeout:fn=>fn(),
        localStorage:{getItem:()=>null,setItem(){}},
        document:{body:node('body'), getElementById:id=>elements[id] || null, createElement:tag=>node('', '', tag), querySelectorAll:()=>[], querySelector:()=>null,
            addEventListener:(name, fn)=>(events[name] ||= []).push(fn), documentElement:{style:{setProperty(){}},setAttribute(){}}},
        window:{location:{href:'http://localhost/revision'},history:{pushState(){}},addEventListener(){},confirm:message=>{confirmations.push(message);return false;}},
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
    const fields = Object.fromEntries(['day_review_date_input','rev_tab_day','day_main_editor','day_history_editor','day_editor_store','day_history_toggle','day_history_panel','day_history_status','day_history_grid'].map(id=>[id,node(id)]));
    fields.day_review_date_input.value='2026-11-01';
    const names=['date','rating','highlights','friction','notes','ratings','status','breakdown','total','created-tasks','filter','filter-label','session-count','sessions'];
    fields.day_editor_template={content:{firstElementChild:{cloneNode(){
        const root=node();root.children.push(...names.map(name=>{
            const el=node();el.dataset.day=name;el.dayText=['rating','highlights','friction','notes'].includes(name);
            if(el.dayText)el.value=name==='rating'?'3':'';return el;
        }));
        root.children.push(...['save','dismiss','discard','retry','calendar','clear-filter','activity','tasks','promote'].map(action=>{
            const el=node('','','button');el.dataset.action=action;return el;
        }));return root;
    }}}};
    const pending=fields.day_editor_template.content.firstElementChild.cloneNode(true);
    const clone=fields.day_editor_template.content.firstElementChild.cloneNode;let first=true;
    fields.day_editor_template.content.firstElementChild.cloneNode=()=>{if(first){first=false;return pending;}return clone();};
    return new Proxy(fields,{get(target,key){
        if(key in target)return target[key];
        const roots=[...target.day_main_editor.children,...target.day_history_editor.children,...target.day_editor_store.children];
        const alias=key==='day_custom_ratings_container'?'ratings':String(key).startsWith('day_form_')?String(key).slice(9):null;
        const main=target.day_main_editor.children[0] || pending;
        if(alias)return main?.querySelector(`[data-day="${alias}"]`);
        return roots.flatMap(root=>[root,...root.querySelectorAll('input, select, textarea'),...root.children,...root.children.flatMap(el=>el.children)]).find(el=>el.id===key) || null;
    }});
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

// Widget-only HTML fixture: model standard select selectedness and real descendant
// structure. Other owners keep the original lightweight node/document fixtures.
function widgetNode(tag) {
    const el = node('', '', tag);
    Object.defineProperty(el, 'innerHTML', { set() { el.children.length = 0; } });
    el.querySelector = selector => el.querySelectorAll(selector)[0] || null;
    if (tag === 'select') {
        Object.defineProperty(el, 'options', { get: () => el.querySelectorAll('option') });
        Object.defineProperty(el, 'value', {
            get: () => el.options.find(option => option.selected)?.value || '',
            set: value => el.options.forEach(option => { option.selected = option.value === String(value); })
        });
        el.appendChild = option => {
            const selected = el.options.some(item => item.selected);
            el.children.push(option);
            if (!selected && !option.selected) option.selected = true;
            if (option.selected) el.options.forEach(item => { if (item !== option) item.selected = false; });
            return option;
        };
    }
    el.cloneNode = deep => {
        const copy = widgetNode(tag);
        for (const key of ['id', 'type', 'checked', 'disabled', 'htmlFor', 'selected']) copy[key] = el[key];
        copy.className = el.className;
        (el.className || '').split(/\s+/).filter(Boolean).forEach(name => copy.classList.add(name));
        if (deep) el.children.forEach(child => copy.appendChild(child.cloneNode(true)));
        copy.value = el.value;
        return copy;
    };
    return el;
}
function widgetElements() {
    const html = fs.readFileSync(path.join(js, '../../templates/components/widget_builder_modal.html'), 'utf8');
    const fields = {}, root = widgetNode('div'), stack = [root];
    for (const token of html.matchAll(/<!--[^]*?-->|<\/?[a-z][^>]*>|[^<]+/gi)) {
        const text = token[0];
        if (text.startsWith('<!--') || !text.startsWith('<')) continue;
        if (text.startsWith('</')) { stack.pop(); continue; }
        const tag = text.match(/^<(\w+)/)[1].toLowerCase();
        const el = widgetNode(tag);
        for (const [, name, value] of text.matchAll(/([\w-]+)="([^"]*)"/g)) {
            if (name === 'class') { el.className = value; value.split(/\s+/).forEach(x => el.classList.add(x)); }
            else if (name === 'for') el.htmlFor = value;
            else if (['id', 'type', 'value'].includes(name)) el[name] = value;
        }
        if (/\sselected(?:\s|>)/.test(text)) el.selected = true;
        if (el.id) fields[el.id] = el;
        stack.at(-1).appendChild(el);
        if (!['input', 'br', 'hr'].includes(tag)) stack.push(el);
    }
    return fields;
}
function widgetBrowser(fields, respond) {
    const b = browser(fields, ['widget_builder.js'], respond);
    const root = fields.widget_builder_modal;
    b.context.document.createElement = widgetNode;
    b.context.document.querySelectorAll = selector => {
        const descendant = selector.match(/^#([\w-]+) (.+)$/);
        if (descendant) return fields[descendant[1]].querySelectorAll(descendant[2]);
        return root.querySelectorAll(selector);
    };
    b.context.document.querySelector = selector => b.context.document.querySelectorAll(selector)[0] || null;
    b.context.document.getElementById = id => fields[id] || root.querySelectorAll(`#${id}`)[0] || null;
    return b;
}

const capabilities={sql_enabled:true,sources:[{source:'sessions',measures:[{value:'count',label:'Count'}],dimensions:[],filter_fields:[]}]};
for(const sql of [false,true]) test(`Widget ${sql ? 'SQL' : 'structured'} editor guards draft departure without metadata absorbing title changes`,async()=>{
    const fields=widgetElements(), preview=deferred();
    const b=widgetBrowser(fields,url=>url==='/analytics/capabilities' ? {json:capabilities} : url==='/analytics/sql' ? preview.promise : {json:{tables:[]}});
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
    await b.run('dismissDayReview()');
    if(failWrite) assert.match(fields.day_main_editor.children[0].querySelector('[data-day="status"]').textContent,/Dismiss incomplete/);await tick();
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
    await b.run('saveDayReviewForm()');
    assert.match(fields.day_main_editor.children[0].querySelector('[data-day="status"]').textContent,/Save incomplete/);
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
    const b=widgetBrowser(fields,url=>({json:url==='/analytics/capabilities'?capabilities:url==='/analytics/sql'?{columns:['amount'],rows:[[1]],row_count:1,elapsed_ms:1}:{tables:[]}}));
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
    const b=widgetBrowser(fields,()=>fail ? {status:503,json:{detail:'Synthetic capabilities failure'}} : {json:capabilities});
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
    fields.day_custom_ratings_container.children.push(rating);let hold=false, reads=0;
    const b=browser(fields,['revision_nav.js','ratings_config.js','day_review.js'],url=>url.startsWith('/rating-definitions') ? (reads++, hold ? held.promise : {json:[]}) : {json:{day_review:null,custom_ratings:[]}});
    await b.run('loadDayReviewData()');hold=true;
    const refresh=b.run('loadDayReviewData()');await tick();assert.equal(reads,2,'second definitions GET actually started');rating.value=5;held.resolve({json:[]});await refresh;
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
    const b=browser(fields,['revision_nav.js','ratings_config.js','day_review.js','day_history.js'],url=>({json:url.startsWith('/rating-definitions') || url.startsWith('/revision/day-reviews') || url.startsWith('/revision/day-history') ? [] : {day_review:null,custom_ratings:[]}}));
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
    if (kind === 'session') fields.session_rev_modal_status = node('session_rev_modal_status');
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
    await saving;
    assert.match(fields.session_rev_modal_status.textContent,/Second rating failed/);
    assert.equal(text.value,'Typed during PUT');assert.equal(b.run('followSettingsLink({})'),false);
    text.value='Submitted notes';ratings[1].value=3;
    assert.equal(b.run('followSettingsLink({})'),true,'persisted session text and first rating clean');
    assert.equal((await b.run("api.get('/sessions/session')")).notes,'Submitted notes','fake HTTP readback');
    ratings[1].value=5;retry();const retried=b.run('saveSessionReviewModal()');text.value='Next draft';await retried;
    assert.equal(text.value,'Next draft');assert.equal(fields.session_review_modal.classList.contains('hidden'),false);
    assert.equal(b.run('followSettingsLink({})'),false);
    text.value='Submitted notes';assert.equal(b.run('followSettingsLink({})'),true);
});

function sessionTaskElements() {
    const ids=['session_modal','edit_session_id','session_modal_start','session_modal_end','session_modal_notes',
        'session_modal_task_id','session_modal_task_search','session_modal_tags_input','task_modal','edit_task_id',
        'modal_input_title','modal_input_desc','modal_input_tags','modal_input_est'];
    const fields=Object.fromEntries(ids.map(id=>[id,node(id)]));
    fields.session_modal.children.push(...ids.filter(id=>id.startsWith('session_modal_')).map(id=>fields[id]));
    fields.task_modal.children.push(...ids.filter(id=>id.startsWith('modal_input_')).map(id=>fields[id]));
    return fields;
}
function sessionTaskBrowser(fields, respond) {
    const b=browser(fields,['utils.js','task_knowledge.js','tags_engine.js','task_attach.js','session_modal.js','task_modal.js'],respond);
    b.context.closeRecurringDeleteModal=()=>{};
    b.context.alert=()=>{};
    b.run("openCreateSessionModal(new Date('2026-10-01T10:00:00'),new Date('2026-10-01T10:30:00')); setupModalKeyboardListeners()");
    return b;
}
for(const edit of ['notes','time','tags']) test(`Session +Task keyboard handoff retains ${edit}-only ownership; nested Cancel resumes and explicit Cancel discards`,()=>{
    const f=sessionTaskElements(),b=sessionTaskBrowser(f,()=>({json:[]}));
    assert.equal(b.run('followSettingsLink({})'),true);
    if(edit==='notes') f.session_modal_notes.value='Retained Notes';
    if(edit==='time') f.session_modal_start.value='2026-10-01T09:45';
    if(edit==='tags') b.run("addTagChip('#retained')");
    f.session_modal_task_search.listeners.keydown({key:'+',preventDefault(){}});
    assert.equal(b.run('followSettingsLink({})'),false,'clean Task must not hide retained Session draft');
    b.run('closeTaskModal()');
    assert.equal(f.session_modal.classList.contains('hidden'),false,'nested Cancel resumes original editor');
    assert.equal(b.run('followSettingsLink({})'),false,'resumption must not replace the original baseline');
    if(edit==='notes') f.session_modal_notes.value='';
    if(edit==='time') f.session_modal_start.value='2026-10-01T10:00';
    if(edit==='tags') b.run("setTagChips('')");
    assert.equal(b.run('followSettingsLink({})'),true,'reversion remains clean');
    f.session_modal_notes.value='Explicit discard';b.run('closeSessionModal()');
    assert.equal(b.run('followSettingsLink({})'),true);assert.equal(b.writes.length,0);
});

for(const action of ['saveDayReviewForm','dismissDayReview']) test(`Late Day ${action} cannot clean or refresh a different initialized editor`,async()=>{
    const f=dayElements(),held=deferred(),reads=[];
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],(url,options)=>{
        if(options.method==='POST') return held.promise;
        reads.push(url);return {json:url.startsWith('/rating-definitions') ? [] : {day_review:null,custom_ratings:[]}};
    });
    await b.run('loadDayReviewData()');f.day_form_notes.value='X';f.day_form_rating.value='5';
    const saving=b.run(`${action}()`);await tick();assert.equal(b.writes.length,1);
    f.day_review_date_input.value='2026-11-02';await b.run('loadDayReviewData()');
    f.day_form_notes.value='X';f.day_form_rating.value='5';const before=reads.length;
    held.resolve({json:{}});await saving;await tick();
    assert.equal(b.run('followSettingsLink({})'),false,'B matching submitted A values must still be dirty');
    assert.equal(f.day_form_notes.value,'X');assert.equal(f.day_form_rating.value,'5');
    assert.equal(reads.length,before,'stale A must not start B refresh');assert.equal(b.writes.length,1);
    assert.equal(b.writes[0].body.date_str,'2026-11-01');
});

for(const failRefresh of [false,true]) test(`Task Save retains Session through ${failRefresh?'failed':'held'} metadata refresh and resumes unchanged fields without a Session write`,async()=>{
    const f=sessionTaskElements(),held=deferred();let refreshing=false;
    const task={id:'created-task',title:'Created nested',estimated_minutes:60,tags:'#tasktag'};
    const b=sessionTaskBrowser(f,(url,options)=>{
        if(options.method==='POST') return {json:task};
        refreshing=true;return held.promise;
    });
    f.session_modal_notes.value='Retained';f.session_modal_start.value='2026-10-01T09:45';
    b.run("addTagChip('#sessiontag'); openTaskModalFromSessionModal()");f.modal_input_title.value=task.title;
    const saving=b.run('saveTask()');await tick();assert.equal(refreshing,true);
    assert.equal(f.session_modal.classList.contains('hidden'),false);assert.equal(f.task_modal.classList.contains('hidden'),true);
    assert.equal(f.session_modal_task_id.value,task.id,'ACK attaches P before held metadata');
    assert.equal(b.run('followSettingsLink({})'),false,'same retained Session remains guarded after ACK handoff');
    held.resolve(failRefresh?{status:503,json:{detail:'Synthetic metadata failure'}}:{json:[task]});await saving;
    assert.equal(f.session_modal.classList.contains('hidden'),false);assert.equal(f.session_modal_notes.value,'Retained');
    assert.equal(f.session_modal_start.value,'2026-10-01T09:45');assert.equal(f.session_modal_end.value,'2026-10-01T10:30');
    assert.equal(b.run('currentTagChips.join(" ")'),'#sessiontag');assert.equal(f.session_modal_task_id.value,task.id);
    assert.equal(b.run('followSettingsLink({})'),false);assert.equal(b.writes.length,1);assert.equal(b.writes[0].url,'/api/tasks');
    b.run('closeSessionModal()');assert.equal(b.run('followSettingsLink({})'),true);
});

test('Failed nested Task Save retains owner; Cancel then unrelated Task Save cannot resurrect stale Session',async()=>{
    const f=sessionTaskElements();let fail=true;
    const b=sessionTaskBrowser(f,(url,options)=>({status:fail&&options.method==='POST'?503:200,json:options.method==='POST'?{id:'standalone',title:'Standalone'}:[]}));
    f.session_modal_notes.value='Keep';b.run('openTaskModalFromSessionModal()');f.modal_input_title.value='Failed task';
    await b.run('saveTask()');assert.equal(b.run('followSettingsLink({})'),false);
    b.run('closeTaskModal(); closeSessionModal(); openNewTaskModal()');f.modal_input_title.value='Standalone';fail=false;
    await b.run('saveTask()');assert.equal(f.session_modal.classList.contains('hidden'),true);
    assert.equal(b.run('followSettingsLink({})'),true);assert.equal(f.session_modal_task_id.value,'');
});

test('Clean/reverted suspension and standalone Task Cancel stay clean; unrelated Session reopen cancels late resumption',async()=>{
    const f=sessionTaskElements(),held=deferred();
    const b=sessionTaskBrowser(f,(url,options)=>options.method==='POST'?{json:{id:'created',title:'Nested'}}:held.promise);
    f.session_modal_notes.value='Reverted';f.session_modal_notes.value='';b.run('openTaskModalFromSessionModal()');
    assert.equal(b.run('followSettingsLink({})'),true);f.modal_input_title.value='Nested';
    const saving=b.run('saveTask()');await tick();
    b.run("openCreateSessionModal(new Date('2026-10-02T10:00:00'),new Date('2026-10-02T10:30:00'))");
    f.session_modal_notes.value='Different session';held.resolve({json:[{id:'created',title:'Nested'}]});await saving;
    assert.equal(f.session_modal_notes.value,'Different session');assert.equal(f.session_modal_task_id.value,'');
    b.run('closeSessionModal(); openNewTaskModal()');f.modal_input_title.value='Discard';b.run('closeTaskModal()');
    assert.equal(b.run('followSettingsLink({})'),true);
});

for(const action of ['saveDayReviewForm','dismissDayReview']) test(`Day ${action} A→B→A retains its owner and acknowledges only captured A fields`,async()=>{
    const f=dayElements(),held=deferred();let reads=0;
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],(url,options)=>{
        if(options.method==='POST') return held.promise;
        reads++;return {json:url.startsWith('/rating-definitions')?[]:{day_review:null,custom_ratings:[]}};
    });
    await b.run('loadDayReviewData()');f.day_form_notes.value='X';const saving=b.run(`${action}()`);await tick();
    f.day_review_date_input.value='2026-11-02';await b.run('loadDayReviewData()');
    f.day_review_date_input.value='2026-11-01';await b.run('loadDayReviewData()');f.day_form_notes.value='X';
    const before=reads;held.resolve({json:{}});await saving;await tick();
    assert.equal(b.run('followSettingsLink({})'),true);assert.equal(reads,before);assert.equal(f.day_form_notes.value,'X');
    assert.equal(b.writes[0].body.date_str,'2026-11-01');
});

test('Day Dismiss confirmation retains its captured date and never collects B payload',async()=>{
    const f=dayElements(),held=deferred();
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],url=>({json:url.startsWith('/rating-definitions')?[]:{day_review:null,custom_ratings:[]}}));
    await b.run('loadDayReviewData()');b.context.showCustomConfirm=()=>held.promise;
    const dismissing=b.run('dismissDayReview()');f.day_review_date_input.value='2026-11-02';await b.run('loadDayReviewData()');
    f.day_form_notes.value='B private draft';held.resolve(true);await dismissing;
    assert.equal(b.writes.length,1);assert.equal(b.writes[0].body.date_str,'2026-11-01');
    assert.notEqual(b.writes[0].body.notes,'B private draft');assert.equal(b.run('followSettingsLink({})'),false);
});

for(const boundary of ['write','read']) test(`Changing Day input before its next read completes invalidates old ${boundary} continuation`,async()=>{
    const f=dayElements(),held=deferred();let hold=false;
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],(url,options)=>hold&&(boundary==='read'||options.method==='POST')?held.promise:{json:url.startsWith('/rating-definitions')?[]:{day_review:null,custom_ratings:[]}});
    await b.run('loadDayReviewData()');f.day_form_notes.value='A';hold=true;
    const pending=b.run(boundary==='read'?'loadDayReviewData()':'saveDayReviewForm()');
    f.day_review_date_input.value='2026-11-02';f.day_form_notes.value='B selected, not read';
    held.resolve({json:{day_review:{rating:5,notes:'Late A'},custom_ratings:[]}});await pending;
    assert.equal(f.day_form_notes.value,'B selected, not read');assert.equal(b.run('followSettingsLink({})'),false);
    assert.equal(b.writes.length,boundary==='write'?1:0);
});

test('Same-day refresh does not invalidate a legitimate successful Day writer checkpoint',async()=>{
    const f=dayElements(),held=deferred();let saved=false;
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],(url,options)=>options.method==='POST'?held.promise:{json:url.startsWith('/rating-definitions')?[]:{day_review:saved?{rating:3,notes:'X'}:null,custom_ratings:[]}});
    await b.run('loadDayReviewData()');f.day_form_notes.value='X';const saving=b.run('saveDayReviewForm()');
    await b.run('loadDayReviewData()');saved=true;held.resolve({json:{}});await saving;await tick();
    assert.equal(b.run('followSettingsLink({})'),true);assert.equal(f.day_form_notes.value,'X');assert.equal(b.writes.length,1);
});

function mountDayRatings(f,values=[3,3]) {
    const inputs=values.map((value,i)=>{const input=node(`rating_range_input_${f.day_review_date_input.value}_${i}`,value);input.classList.add('custom-rating-input');f[input.id]=input;return input;});
    f.day_custom_ratings_container.children.splice(0,Infinity,...inputs);
    const query=f.day_custom_ratings_container.querySelectorAll.bind(f.day_custom_ratings_container);
    f.day_custom_ratings_container.querySelectorAll=s=>s==='[data-rating-def-id]'?inputs.map((input,i)=>({getAttribute:()=>String(i),querySelector:()=>input})):query(s);
    return inputs;
}
for(const phase of ['day POST','rating POST']) test(`Day Save cannot post another editor's rating values or refresh after pending ${phase}`,async()=>{
    const f=dayElements(),held=deferred();let hold=true,reads=0;
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],(url,options)=>{
        if(options.method==='POST') return hold&&url===(phase==='day POST'?'/revision/day-review':'/rating-entries')?held.promise:{json:{}};
        reads++;return {json:url.startsWith('/rating-definitions')?[]:{day_review:null,custom_ratings:[]}};
    });
    await b.run('loadDayReviewData()');const a=mountDayRatings(f);b.run("rememberSettingsDraft('day_custom_ratings_container','.custom-rating-input')");a[0].value=5;
    const saving=b.run('saveDayReviewForm()');await tick();
    f.day_review_date_input.value='2026-11-02';await b.run('loadDayReviewData()');const inputs=mountDayRatings(f);
    b.run("rememberSettingsDraft('day_custom_ratings_container','.custom-rating-input')");inputs[0].value=5;inputs[1].value=1;
    const before=reads;hold=false;held.resolve({json:{}});await saving;await tick();
    assert.equal(b.run('followSettingsLink({})'),false);assert.equal(reads,before);
    assert.equal(b.writes.length,3,'retained A finishes its frozen ratings only');
    assert.deepEqual(b.writes.filter(w=>w.url==='/rating-entries').map(w=>[w.body.target_id,w.body.score]),[['2026-11-01',5],['2026-11-01',3]]);
});

for(const entry of ['create','edit']) for(const phase of ['interaction','close','reopen']) test(`Task ${entry} initial focus yields after ${phase} without a stale title selection`,async()=>{
    const f=sessionTaskElements(),timers=[];
    const b=browser(f,['utils.js','task_knowledge.js','task_modal.js'],()=>({json:{id:'existing',title:'Existing task',tags:'#original',estimated_minutes:30}}));
    b.context.setTimeout=fn=>timers.push(fn);
    for(const el of Object.values(f)) el.focus=()=>{b.context.document.activeElement=el;};
    let selections=0;f.modal_input_title.select=()=>selections++;
    const open=()=>b.run(entry==='create'?'openNewTaskModal()':'openEditTaskModal("existing")');
    const flush=()=>{while(timers.length) timers.shift()();};
    await open();flush();
    assert.equal(b.context.document.activeElement,f.modal_input_title,'normal initialized Task focuses title');
    await open();
    if(phase==='close') b.run('closeTaskModal()');
    if(phase==='reopen') {b.run('closeTaskModal()');await open();}
    f.modal_input_tags.focus();f.modal_input_tags.value='#typed';const before=selections;
    flush();
    assert.equal(b.context.document.activeElement,f.modal_input_tags,'late initial focus must not steal interaction or focus a closed editor');
    assert.equal(selections,before,'late callback must not select title after interaction');
    assert.equal(f.modal_input_tags.value,'#typed');assert.equal(b.writes.length,0);
});

test('Revision dedicated-details link retains an unsaved inline review when departure is declined',async()=>{
    const {b,fields,text}=reviewBrowser('task');
    fields.inspect_task_details_link=node('inspect_task_details_link');
    await b.run("loadTaskInspectorStats('task')");text.value='Unsaved inline review';
    assert.equal(fields.inspect_task_details_link.href,'/task-inspector/task');
    assert.equal(fields.inspect_task_details_link.onclick({}),false);
    assert.equal(b.confirmations.length,1);
    assert.equal(text.value,'Unsaved inline review');
    assert.equal(b.writes.length,0);
});

test('Day workspace retains independent history drafts, grouping and filters through hide and promotion',async()=>{
    const f=dayElements();
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js','day_history.js'],url=>({json:url.startsWith('/rating-definitions')?[]:url.startsWith('/revision/day-history')?[
        {date_str:'2026-11-01',has_review:false},{date_str:'2026-11-02',has_review:false},{date_str:'2026-11-03',has_review:false}
    ]:{day_review:null,custom_ratings:[],sessions:[],tag_breakdown:[],task_breakdown:[]}}));
    await b.run('loadDayReviewData()');f.day_form_notes.value='A';
    b.run("toggleDayBreakdownFilter('tag','#a');dayReviewEditor.group='task';toggleDayHistory(true)");await tick();
    await b.run("expandDayHistory('2026-11-02')");
    const history=b.run("dayEditors.get('2026-11-02')");history.root.querySelector('[data-day="notes"]').value='B';
    b.run("toggleDayBreakdownFilter('task','__none__',dayEditors.get('2026-11-02'));toggleDayHistory(false);toggleDayHistory(true)");await tick();
    assert.equal(history.root.querySelector('[data-day="notes"]').value,'B');
    await b.run("expandDayHistory('2026-11-03')");assert.equal(history.root.classList.contains('hidden'),true);
    await b.run("expandDayHistory('2026-11-02')");
    b.run("jumpToDayReview('2026-11-02')");await tick();
    assert.equal(f.day_form_notes.value,'B');assert.equal(b.run('dayEditors.size'),3);
    assert.equal(b.run('expandedHistoryDate'),null);
    assert.deepEqual(JSON.parse(b.run('JSON.stringify(dayReviewEditor.filter)')),{type:'task',value:'__none__'});
    f.day_review_date_input.value='2026-11-01';await b.run('loadDayReviewData()');
    assert.equal(f.day_form_notes.value,'A');assert.equal(b.run('dayReviewEditor.group'),'task');
    assert.deepEqual(JSON.parse(b.run('JSON.stringify(dayReviewEditor.filter)')),{type:'tag',value:'#a'});
    assert.equal(b.run('followSettingsLink({})'),false);assert.equal(b.writes.length,0);
});

test('Day workspace partial-save retry skips acknowledged text and first rating while retaining B',async()=>{
    const f=dayElements();let fail=true;
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],(url,options)=>{
        if(url==='/rating-entries'&&JSON.parse(options.body).rating_definition_id==='1'&&fail){fail=false;return {status:503,json:{detail:'Controlled failure'}};}
        return {json:url.startsWith('/rating-definitions')?[]:{day_review:null,custom_ratings:[]}};
    });
    await b.run('loadDayReviewData()');const inputs=mountDayRatings(f);b.run("rememberSettingsDraft(dayField(dayReviewEditor,'ratings').id,'.custom-rating-input')");
    f.day_form_notes.value='A saved';inputs[0].value=1;inputs[1].value=2;
    await b.run('saveDayReviewForm()');assert.equal(b.writes.length,3);
    f.day_review_date_input.value='2026-11-02';await b.run('loadDayReviewData()');f.day_form_notes.value='B private';
    f.day_review_date_input.value='2026-11-01';await b.run('loadDayReviewData()');
    await b.run('saveDayReviewForm()');assert.equal(b.writes.length,4);
    assert.deepEqual(b.writes.slice(3).map(w=>[w.url,w.body.target_id,w.body.rating_definition_id]),[['/rating-entries','2026-11-01','1']]);
    assert.equal(b.run('followSettingsLink({})'),false,'B draft remains guarded after all A ACKs');
    f.day_review_date_input.value='2026-11-02';await b.run('loadDayReviewData()');assert.equal(f.day_form_notes.value,'B private');
});

test('Day Save freezes all ratings before day POST and ACK keeps later same-owner edits dirty',async()=>{
    const f=dayElements(),held=deferred();
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],(url,options)=>url==='/revision/day-review'&&options.method==='POST'?held.promise:{json:url.startsWith('/rating-definitions')?[]:{day_review:null,custom_ratings:[]}});
    await b.run('loadDayReviewData()');const inputs=mountDayRatings(f,[1,2]);b.run("rememberSettingsDraft(dayField(dayReviewEditor,'ratings').id,'.custom-rating-input')");
    f.day_form_notes.value='Submitted';const saving=b.run('saveDayReviewForm()');await tick();
    inputs[1].value=5;inputs[1].disabled=true;f.day_form_notes.value='Typed after submit';held.resolve({json:{}});await saving;
    assert.deepEqual(b.writes.filter(w=>w.url==='/rating-entries').map(w=>[w.body.score,w.body.dismissed]),[[1,false],[2,false]]);
    assert.equal(b.run('followSettingsLink({})'),false);assert.equal(f.day_form_notes.value,'Typed after submit');
});

test('Day late summary hydrates its retained date without replacing a newer main-date draft',async()=>{
    const f=dayElements(),held=deferred();
    const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],url=>url.includes('date_str=2026-11-01')?held.promise:{json:url.startsWith('/rating-definitions')?[]:{day_review:null,custom_ratings:[]}});
    const loading=b.run('loadDayReviewData()');f.day_review_date_input.value='2026-11-02';await b.run('loadDayReviewData()');f.day_form_notes.value='B private';
    held.resolve({json:{day_review:{rating:4,notes:'A persisted'},custom_ratings:[]}});await loading;
    assert.equal(f.day_form_notes.value,'B private');
    assert.equal(b.run("dayEditors.get('2026-11-01').root.querySelector('[data-day=\"notes\"]').value"),'A persisted');
    assert.equal(b.run('followSettingsLink({})'),false);assert.equal(b.writes.length,0);
});
for(const [type,value] of [['tag','#project'],['task','01920000-0000-7000-8000-000000000001'],['task','__none__']]) test(`Day Calendar handoff keeps its own date and ${type} ${value}`,async()=>{
    const f=dayElements();const b=browser(f,['revision_nav.js','ratings_config.js','day_review.js'],url=>({json:url.startsWith('/rating-definitions')?[]:{day_review:null,custom_ratings:[]}}));
    await b.run('loadDayReviewData()');const a=b.run('dayReviewEditor');
    f.day_review_date_input.value='2026-11-02';await b.run('loadDayReviewData()');
    b.context.handoffOwner=a;b.context.handoffType=type;b.context.handoffValue=value;
    b.run('toggleDayBreakdownFilter(handoffType,handoffValue,handoffOwner);jumpToCalendarForDay(handoffOwner)');
    const url=new URL(b.context.window.location.href,'http://localhost');
    assert.equal(url.searchParams.get('date'),'2026-11-01');assert.equal(url.searchParams.get(type),value);
    assert.equal(b.writes.length,0);
});

// Minimal rating markup fixture: exercise real renderer/Day handlers without a browser dependency.
function parseDayRatingControls(root) {
    Object.defineProperty(root,'innerHTML',{set(html){
        root.children.splice(0);
        for (const match of html.matchAll(/<div class="rev-card[^]*?<\/div>\s*<p[^]*?<\/div>/g)) {
            const text=match[0], card=node(), input=node(text.match(/id="(rating_range_input_[^"]+)"/)[1],text.match(/value="([^"]*)"/)[1]);
            card['data-rating-def-id']=text.match(/data-rating-def-id="([^"]+)"/)[1];
            card['data-required']=text.match(/data-required="([^"]+)"/)[1];
            input.type='range';input.min=text.match(/min="([^"]+)"/)[1];input.max=text.match(/max="([^"]+)"/)[1];
            input.disabled=/value="[^"]*" disabled/.test(text);input.classList.add('custom-rating-input');
            const label=node(text.match(/id="(score_label_[^"]+)"/)[1]);const button=node('','','button');
            card.append(label,button,input);input.replaceWith=function(other){const i=card.children.indexOf(this);card.children[i]=other;other.parentNode=card;};
            root.appendChild(card);
        }
    }});
    const original=root.querySelectorAll.bind(root);
    root.querySelectorAll=selector=>selector==='[data-rating-def-id]' ? root.children.filter(c=>c['data-rating-def-id']) : original(selector);
}
function ratingsDayBrowser() {
    const fields=dayElements();let defs=[{id:'scale',name:'Scale',min_score:1,max_score:10}], reads=0, fail=false, held=null, summaryHeld=null;
    const clone=fields.day_editor_template.content.firstElementChild.cloneNode;
    fields.day_editor_template.content.firstElementChild.cloneNode=()=>{const root=clone();parseDayRatingControls(root.querySelector('[data-day="ratings"]'));return root;};
    const b=browser(fields,['revision_nav.js','ratings_config.js','day_review.js'],url=>{
        if(url.startsWith('/rating-definitions')) {reads++;return held ? held.promise : fail ? {status:503,json:{detail:'held failure'}} : {json:defs};}
        return summaryHeld ? summaryHeld.promise : {json:{day_review:null,custom_ratings:[]}};
    });
    b.context.alert=()=>{};
    return {fields,b,setDefs:value=>defs=value,setFail:value=>fail=value,setHeld:value=>held=value,setSummaryHeld:value=>summaryHeld=value,reads:()=>reads,
        input:()=>fields.day_custom_ratings_container.querySelector('.custom-rating-input')};
}
test('Day admin add/range/delete Refresh reconciles clean controls and Save targets only fresh definitions',async()=>{
    const h=ratingsDayBrowser();await h.b.run('loadDayReviewData()');
    h.setDefs([{id:'scale',name:'Scale',min_score:1,max_score:10},{id:'new',name:'New scale',min_score:1,max_score:10}]);await h.b.run('loadDayReviewData()');
    assert.equal(h.fields.day_custom_ratings_container.querySelectorAll('[data-rating-def-id]').length,2,'admin add is visible');
    h.setDefs([{id:'scale',name:'Scale',min_score:1,max_score:10},{id:'new',name:'Changed scale',min_score:2,max_score:4}]);await h.b.run('loadDayReviewData()');
    assert.equal(h.fields.day_custom_ratings_container.querySelectorAll('.custom-rating-input')[1].max,'4','range edit is visible');
    h.setDefs([{id:'new',name:'Changed scale',min_score:2,max_score:4}]);await h.b.run('loadDayReviewData()');
    assert.equal(h.reads(),4);assert.match(h.input().id,/_new$/);assert.equal(h.input().min,'2');assert.equal(h.input().max,'4');
    await h.b.run('saveDayReviewForm()');assert.deepEqual(h.b.writes.filter(w=>w.url==='/rating-entries').map(w=>w.body.rating_definition_id),['new']);
});
test('Day dirty A/B, dismissal, ACKs and out-of-range/deleted drafts survive fresh definitions until explicit correction or Discard',async()=>{
    const h=ratingsDayBrowser();await h.b.run('loadDayReviewData()');const a=h.input();a.value='9';a.disabled=true;
    h.fields.day_review_date_input.value='2026-11-02';await h.b.run('loadDayReviewData()');const b=h.input();b.value='8';
    h.fields.day_review_date_input.value='2026-11-01';h.setDefs([{id:'scale',name:'Narrow',min_score:1,max_score:5}]);await h.b.run('loadDayReviewData()');
    assert.equal(h.input(),a);assert.equal(a.value,'9');assert.equal(a.disabled,true);assert.equal(a.type,'number','dirty out-of-range value is not clamped by a range input');assert.equal(b.value,'8');
    a.disabled=false;await h.b.run('saveDayReviewForm()');assert.equal(h.b.writes.length,0,'invalid rating blocks day POST');
    h.setDefs([]);await h.b.run('loadDayReviewData()');assert.equal(h.input(),a);assert.equal(h.fields.day_custom_ratings_container.ratingUnavailable,true);
    await h.b.run('saveDayReviewForm()');assert.equal(h.b.writes.length,0);
    await h.b.run('discardDayReview()');assert.equal(h.input(),null);assert.equal(b.value,'8');
});
test('Day refresh definition race preserves edits made during GET and stale reads cannot replace newer definitions',async()=>{
    const h=ratingsDayBrowser();await h.b.run('loadDayReviewData()');const input=h.input(),held=deferred();h.setHeld(held);
    const first=h.b.run('loadDayReviewData()');await tick();assert.equal(h.reads(),2);input.value='8';input.disabled=true;
    h.setHeld(null);h.setDefs([{id:'scale',name:'Newer',min_score:1,max_score:9}]);await h.b.run('loadDayReviewData()');
    held.resolve({json:[{id:'old',name:'Old',min_score:1,max_score:3}]});await first;
    assert.equal(h.input(),input);assert.equal(input.value,'8');assert.equal(input.disabled,true);assert.equal(input.max,'9');assert.equal(h.b.run('followSettingsLink({})'),false);
});
test('failed Day Discard Retry load retries definitions and does not silently keep initialized draft forever',async()=>{
    const h=ratingsDayBrowser();await h.b.run('loadDayReviewData()');h.input().value='9';h.setFail(true);
    await h.b.run('discardDayReview()');assert.equal(h.reads(),2);assert.equal(h.input().value,'9');
    h.setFail(false);const root=h.fields.day_main_editor.children[0];await root.querySelector('[data-action="retry"]').listeners.click();await tick();
    assert.equal(h.reads(),3);assert.equal(h.input().value,'6');assert.equal(h.b.run('followSettingsLink({})'),true);
});

test('definition refresh preserves known rating ACKs and only pending scores retry after partial failure',async()=>{
    const h=ratingsDayBrowser();await h.b.run('loadDayReviewData()');h.input().value='8';await h.b.run('saveDayReviewForm()');
    const ratings=h.fields.day_custom_ratings_container, ack=ratings.ratingAcknowledged.get('scale');
    h.setDefs([{id:'scale',name:'Renamed',min_score:1,max_score:10}]);await h.b.run('loadDayReviewData()');
    assert.equal(ratings.ratingAcknowledged.get('scale'),ack);
    h.input().value='8';await h.b.run('saveDayReviewForm()');assert.equal(h.b.writes.length,2,'known day/rating captures are not resent');
});
test('failed Discard retry preserves newer rating and text edits rather than consuming them',async()=>{
    const h=ratingsDayBrowser();await h.b.run('loadDayReviewData()');h.input().value='9';h.setFail(true);await h.b.run('discardDayReview()');
    h.input().value='8';h.fields.day_form_notes.value='Newer note';h.setFail(false);
    await h.fields.day_main_editor.children[0].querySelector('[data-action="retry"]').listeners.click();await tick();
    assert.equal(h.reads(),3);assert.equal(h.input().value,'8');assert.equal(h.fields.day_form_notes.value,'Newer note');assert.equal(h.b.run('followSettingsLink({})'),false);
});

test('stale Discard summary cannot start definitions or cancel newer Refresh hydration',async()=>{
    const h=ratingsDayBrowser();await h.b.run('loadDayReviewData()');
    const summary=deferred(),definitions=deferred();h.setSummaryHeld(summary);
    const discard=h.b.run('discardDayReview()');await tick();assert.equal(h.reads(),1,'Discard is held at summary');
    h.setSummaryHeld(null);h.setHeld(definitions);
    const refresh=h.b.run('loadDayReviewData()');await tick();assert.equal(h.reads(),2,'Refresh definitions actually started');
    assert.equal(h.b.run('dayReviewEditor.ratingsFresh'),false);
    summary.resolve({json:{day_review:null,custom_ratings:[]}});await tick();
    const readsAfterSummary=h.reads();
    definitions.resolve({json:[{id:'new-scale',name:'Fresh scale',min_score:2,max_score:4}]});
    await Promise.all([discard,refresh]);
    assert.equal(readsAfterSummary,2,'stale Discard must not issue a third definitions GET');
    assert.match(h.input().id,/_new-scale$/);assert.equal(h.input().min,'2');assert.equal(h.input().max,'4');
    assert.equal(h.b.run('dayReviewEditor.ratingsFresh'),true,'freshness follows actual winning hydration');
    await h.b.run('saveDayReviewForm()');
    assert.deepEqual(h.b.writes.filter(w=>w.url==='/rating-entries').map(w=>w.body.rating_definition_id),['new-scale']);
});
test('Day load cannot mark ratings fresh when its renderer was superseded without hydrating',async()=>{
    const h=ratingsDayBrowser();await h.b.run('loadDayReviewData()');const held=deferred();h.setHeld(held);
    const refresh=h.b.run('loadDayReviewData()');await tick();assert.equal(h.reads(),2);
    // Supersede the container render without advancing the Day load generation.
    const other=h.b.run("renderCustomRatingsInputs('day',dayReviewEditor.date,dayField(dayReviewEditor,'ratings').id,[],()=>false,dayField(dayReviewEditor,'ratings'))");
    await tick();assert.equal(h.reads(),3);
    held.resolve({json:[{id:'new',name:'New',min_score:1,max_score:4}]});await Promise.all([refresh,other]);
    assert.equal(h.b.run('dayReviewEditor.ratingsFresh'),false,'rejected renderer did not hydrate controls');
    assert.match(h.fields.day_main_editor.children[0].querySelector('[data-day="status"]').textContent,/Retry load/);
    h.setHeld(null);await h.b.run('saveDayReviewForm()');assert.equal(h.b.writes.length,0,'Save reloads before any write');
});
