const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const path = require('node:path');
const js = path.resolve(__dirname, '../src/timetrace/interfaces/api/static/js');
function node(id = '', tag = 'div') {
    const classes = new Set();
    return {id, tagName:tag.toUpperCase(), value:'', type:'text', dataset:{}, children:[], style:{}, innerHTML:'', textContent:'', disabled:false,
        classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},
        appendChild(el){this.children.push(el);return el;}, addEventListener(){}, setAttribute(){}, focus(){},
        querySelectorAll(){return this.children.filter(el=>el.tagName === 'INPUT');}};
}
function browser(respond = () => ({json:[]})) {
    const writes = [], elements = {habit_entry_owners:node('habit_entry_owners')};
    const context = vm.createContext({console, URL, Date, Intl, setTimeout:()=>{},
        document:{addEventListener(){},getElementById:id=>elements[id] || Object.values(elements).flatMap(root=>{const walk=el=>[el,...el.children.flatMap(walk)];return walk(root);}).find(el=>el.id===id) || null,createElement:tag=>node('',tag)},
        window:{location:{href:'http://localhost/habits-view'},addEventListener(){},confirm:()=>false},
        localStorage:{getItem:()=>null}, showCustomConfirm:async()=>true,
        fetch:async(url, options)=>{
            if(options.method !== 'GET') writes.push({url,body:JSON.parse(options.body)});
            const result = await respond(url,options);
            return {ok:(result.status || 200)<400,status:result.status || 200,headers:{get:()=> 'application/json'},json:async()=>result.json};
        }});
    const run = code=>vm.runInContext(code,context);
    for(const file of ['api_client.js','settings.js','habits.js']) run(fs.readFileSync(path.join(js,file),'utf8'));
    run(`allHabits = [{id:'a',name:'A',habit_type:'numeric',target_value:5,logs:{}}, {id:'b',name:'B',habit_type:'boolean',logs:{}}]`);
    return {run,writes,elements,context};
}
test('Numeric entry typing and Cancel never POST; explicit Save writes only captured habit/date',async()=>{
    const b=browser((url,options)=>({json:options.method==='GET' ? [] : {id:'row',date_str:'2026-11-01',value:3,status:'in_progress'}}));
    await b.run(`setHabitDirectValue('a','2026-11-01','3')`);
    assert.equal(b.writes.length,0,'Typing must remain a draft');
    b.run(`cancelHabitEntry('a','2026-11-01')`);
    assert.equal(b.writes.length,0);
    b.run(`setHabitDirectValue('a','2026-11-01','3')`);
    await b.run(`saveHabitEntry('a','2026-11-01')`);
    assert.deepEqual(b.writes,[{url:'/habits/a/log',body:{date_str:'2026-11-01',set_value:3}}]);
});
test('Cards expose independent day strips and explicit result choices without logging on navigation',()=>{
    const b=browser(); b.elements.habit_cards=node('habit_cards');
    b.run('renderHabitCards()');
    assert.match(b.elements.habit_cards.innerHTML,/Done/);
    assert.match(b.elements.habit_cards.innerHTML,/Failed/);
    assert.match(b.elements.habit_cards.innerHTML,/Skipped/);
    b.run(`navigateHabitWeek('a',-1)`);
    assert.equal(b.run(`habitCardViews.get('b').offset`),0);
    assert.equal(b.writes.length,0);
});
function deferred(){let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test('Held Save rejects double submission, preserves concurrent edits, and failed refresh retries reads only',async()=>{
    const held=deferred(); let failReads=true;
    const b=browser((url,options)=>options.method==='POST' ? held.promise : failReads ? {status:503,json:{detail:'offline'}} : {json:[]});
    b.run(`setHabitDirectValue('a','2026-11-01','3')`);
    const saving=b.run(`saveHabitEntry('a','2026-11-01')`);
    await b.run(`saveHabitEntry('a','2026-11-01')`);
    b.run(`setHabitDirectValue('a','2026-11-01','4')`);
    held.resolve({json:{id:'row',date_str:'2026-11-01',value:3,status:'in_progress'}}); await saving;
    assert.equal(b.writes.length,1);
    assert.equal(b.run(`JSON.parse(habitEntryDraft('a','2026-11-01').field.value).value`),4);
    assert.match(b.run('habitLoadError'),/refresh/i);
    failReads=false; await b.run('loadHabitsData()');
    assert.equal(b.writes.length,1);
    assert.equal(b.run(`JSON.parse(habitEntryDraft('a','2026-11-01').field.value).value`),4);
});
test('Clear continuation cannot erase a newly selected date or changed draft',async()=>{
    const b=browser(); const confirm=deferred(); b.context.showCustomConfirm=()=>confirm.promise;
    b.run(`allHabits[0].logs['2026-11-01']={id:'row',status:'pending',value:0}; selectHabitDay('a','2026-11-01')`);
    const clearing=b.run(`clearHabitEntry('a','2026-11-01')`);
    b.run(`selectHabitDay('a','2026-11-02'); selectHabitDay('a','2026-11-01')`);
    confirm.resolve(true); await clearing;
    assert.equal(b.writes.length,0);
});
test('Definition editor preserves nonpositive targets and stored freeform reminder/frequency',()=>{
    const b=browser();
    for(const id of ['edit_habit_id','modal_habit_title','modal_habit_name','modal_habit_type','modal_habit_target','modal_habit_unit','modal_habit_frequency','modal_habit_reminder','modal_habit_color','modal_habit_delete_btn','numeric_fields_group','habit_modal']) b.elements[id]=node(id,'input');
    b.elements.modal_habit_frequency.options=[]; b.elements.modal_habit_frequency.add=()=>{};
    b.run(`Object.assign(allHabits[0],{target_value:0,frequency:'Custom frequency',reminder_time:'Custom reminder'}); openEditHabitModal('a')`);
    assert.equal(b.elements.modal_habit_target.value,0);
    assert.equal(b.elements.modal_habit_frequency.value,'Custom frequency');
    assert.equal(b.elements.modal_habit_reminder.value,'Custom reminder');
});
function definitionElements(b) {
    for(const id of ['edit_habit_id','modal_habit_title','modal_habit_name','modal_habit_type','modal_habit_target','modal_habit_unit','modal_habit_frequency','modal_habit_reminder','modal_habit_color','modal_habit_delete_btn','numeric_fields_group','habit_modal','habit_definition_status']) b.elements[id]=node(id,'input');
    b.elements.modal_habit_frequency.options=[]; b.elements.modal_habit_frequency.add=()=>{};
    b.elements.habit_modal.children.push(...Object.values(b.elements).filter(el=>el.id.startsWith('modal_habit_')));
}
test('Held definition Save is single-flight and never closes a newer editor',async()=>{
    const held=deferred(); const b=browser((url,options)=>options.method==='GET' ? {json:[]} : held.promise);
    definitionElements(b); b.run(`openEditHabitModal('a')`);
    const saving=b.run('saveHabit()'); const duplicate=b.run('saveHabit()');
    assert.equal(b.writes.length,1);
    b.run(`closeHabitModal(); openEditHabitModal('b')`);
    held.resolve({json:{id:'a'}}); await saving; await duplicate;
    assert.equal(b.elements.habit_modal.classList.contains('hidden'),false);
    assert.equal(b.elements.edit_habit_id.value,'b');
});
test('Settings guard retains hidden date drafts, successful Save cleans only captured owner, and Cancel clears its owner',async()=>{
    const b=browser((url,options)=>({json:options.method==='GET' ? [] : {id:'row',date_str:'2026-11-01',value:3,status:'in_progress'}}));
    b.run(`setHabitDirectValue('a','2026-11-01','3'); stageHabitStatus('b','2026-10-30','failed'); navigateHabitWeek('a',-1)`);
    assert.equal(b.run('followSettingsLink({})'),false);
    await b.run(`saveHabitEntry('a','2026-11-01')`);
    assert.equal(b.run('followSettingsLink({})'),false,'B stays dirty');
    b.run(`cancelHabitEntry('b','2026-10-30')`);
    assert.equal(b.run('followSettingsLink({})'),true);
});
test('Late pre-write list read cannot replace acknowledged log or pending draft',async()=>{
    const held=deferred();let getCount=0;
    const b=browser((url,options)=> options.method==='GET' ? (++getCount===1 ? held.promise : {status:503,json:{detail:'offline'}}) : {json:{id:'row',value:2,status:'in_progress',date_str:'2026-11-01'}});
    const reading=b.run('loadHabitsData()');
    b.run(`setHabitDirectValue('a','2026-11-01','2')`);await b.run(`saveHabitEntry('a','2026-11-01')`);
    held.resolve({json:[]});await reading;
    assert.equal(b.run(`allHabits[0].logs['2026-11-01'].value`),2);
    assert.equal(b.run(`JSON.parse(habitEntryDraft('a','2026-11-01').field.value).value`),2);
});
test('Older unknown date remains non-authoritative; explicit saved receipt survives bounded GET omission',async()=>{
    const b=browser((url,options)=>({json:options.method==='GET' ? [{id:'a',name:'A',habit_type:'numeric',target_value:5,logs:{}}] : {id:'old-row',date_str:'2020-01-01',value:0,status:'pending',notes:'old metadata'}}));
    b.elements.habit_cards=node('habit_cards');
    b.run(`selectHabitDay('a','2020-01-01')`);
    assert.match(b.elements.habit_cards.innerHTML,/record may exist/);
    b.run(`setHabitDirectValue('a','2020-01-01','0')`);await b.run(`saveHabitEntry('a','2020-01-01')`);
    assert.equal(b.run(`habitRecord(allHabits[0],'2020-01-01').notes`),'old metadata');
    assert.equal(b.run(`JSON.parse(habitEntryDraft('a','2020-01-01').field.value).exists`),true);
});
test('Failed write retains dirty owner; numeric zero draft is distinct from no record',async()=>{
    const b=browser(()=>({status:503,json:{detail:'rejected'}}));
    b.run(`setHabitDirectValue('a','2026-11-01','-2')`);
    assert.equal(b.run(`JSON.parse(habitEntryDraft('a','2026-11-01').field.value).value`),0);
    assert.match(b.run(`habitEntryDraft('a','2026-11-01').message`),/clamped/);
    await b.run(`saveHabitEntry('a','2026-11-01')`);
    assert.equal(b.run('followSettingsLink({})'),false);
    b.run(`cancelHabitEntry('a','2026-11-01')`);
    assert.equal(b.run(`JSON.parse(habitEntryDraft('a','2026-11-01').field.value).exists`),false);
    assert.equal(b.run('followSettingsLink({})'),true);
});
test('Unchanged blank reminder preserves stored null rather than inventing a time or empty-string rewrite',async()=>{
    const b=browser((url,options)=>({json:options.method==='GET' ? [] : {id:'a'}}));definitionElements(b);
    b.run(`Object.assign(allHabits[0],{reminder_time:null,color:'#abc'}); openEditHabitModal('a')`);
    b.elements.modal_habit_name.value='Rename only';await b.run('saveHabit()');
    assert.equal(b.writes[0].body.reminder_time,null);
    assert.equal(b.writes[0].body.color,'#abc');
});
